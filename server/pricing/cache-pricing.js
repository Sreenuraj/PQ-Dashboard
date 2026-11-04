/**
 * Per-model, TTL-aware prompt-cache pricing. Nothing here is hand-typed per model.
 *
 * Where prices come from (all dynamic, merged by server/model-registry.js):
 *   1. the extension's own catalog files   <globalStorage>/postqode.postqode/cache/*.json
 *   2. the live OpenRouter model list      (includes `input_cache_write_1h`)
 *   3. per-task calibration against the cost the extension logged (see calibrate.js) — this is the ground
 *      truth when a price changed over time or a model is not in any catalog.
 * If none of them can price a call, we say so and keep the logged cost; we never guess.
 *
 * Cost formula (the same shape the extension uses for Anthropic-style billing):
 *   tier  = first price tier with promptTokens <= upToTokens   (promptTokens = in + cacheWrite + cacheRead)
 *   cost  = in*tier.input + out*tier.output
 *         + (cW - cW1h)*tier.cacheWrite5m + cW1h*tier.cacheWrite1h + cR*tier.cacheRead      (USD per 1M tokens)
 */

let catalog = null; // injected in tests; null => model-registry

/** Test seam: `{ all(): Record<id, entry>, version(): number }`. Pass null to restore the live registry. */
function setCatalog(c) {
  catalog = c;
  index = null;
}

function liveCatalog() {
  if (catalog) return catalog;
  const reg = require('../model-registry');
  return { all: () => reg.getAllModels(), version: () => reg.getRegistryVersion() };
}

/** Lower-case, drop routing/provider prefixes and date suffixes, unify '.' and '-' (generic, not per vendor). */
function canon(id) {
  let s = String(id || '').trim().toLowerCase();
  s = s.replace(/^[a-z0-9_]+:/, '');            // "postqode:foo/bar" -> "foo/bar"
  s = s.replace(/^~/, '');                       // OpenRouter "~" alias marker
  s = s.replace(/^[a-z0-9_.-]+\//, '');          // "vendor/model" -> "model"
  s = s.replace(/^[a-z0-9_-]+\./, (m) => (/^(us|eu|global|apac)\.$/.test(m) ? '' : m)); // "us.model" region prefix
  s = s.replace(/:(free|batch|nitro|floor|online|beta|thinking)$/, '');
  s = s.replace(/-\d{8}$/, '');                  // date stamp
  s = s.replace(/\./g, '-');
  return s;
}

let index = null;
let indexVersion = -1;
function buildIndex(cat) {
  const v = cat.version();
  if (index && indexVersion === v) return index;
  index = { exact: new Map(), byCanon: new Map() };
  for (const [key, entry] of Object.entries(cat.all() || {})) {
    index.exact.set(key, entry);
    const c = canon(key);
    // when several ids canonicalise to the same name prefer the one that carries the most price data
    const prev = index.byCanon.get(c);
    if (!prev || richness(entry) > richness(prev)) index.byCanon.set(c, entry);
  }
  indexVersion = v;
  return index;
}
const richness = (e) => ['inputPrice', 'outputPrice', 'cacheReadsPrice', 'cacheWritesPrice', 'cacheWrites1hPrice'].filter((k) => e && e[k] != null).length + (e && e.tiers ? 1 : 0);

/**
 * Strict resolution (no substring guessing: "model-5" must never resolve to "model-5.5").
 * @returns {object|null} catalog entry
 */
function lookupEntry(modelId) {
  if (!modelId) return null;
  const idx = buildIndex(liveCatalog());
  if (idx.exact.has(modelId)) return idx.exact.get(modelId);
  const raw = String(modelId).replace(/^[a-z0-9_]+:(?=[^/]*\/)/i, '');
  if (idx.exact.has(raw)) return idx.exact.get(raw);
  return idx.byCanon.get(canon(modelId)) || null;
}

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Normalises a catalog entry into a pricing profile (USD / 1M tokens). */
function profileFromEntry(entry, key) {
  if (!entry) return null;
  const base = {
    input: num(entry.inputPrice),
    output: num(entry.outputPrice),
    cacheWrite5m: num(entry.cacheWritesPrice),
    cacheWrite1h: num(entry.cacheWrites1hPrice),
    cacheRead: num(entry.cacheReadsPrice),
  };
  const tiers = Array.isArray(entry.tiers)
    ? entry.tiers
        .map((t) => ({
          upToTokens: t.contextWindow == null || t.contextWindow >= Number.MAX_SAFE_INTEGER ? null : t.contextWindow,
          input: num(t.inputPrice), output: num(t.outputPrice),
          cacheWrite5m: num(t.cacheWritesPrice), cacheWrite1h: num(t.cacheWrites1hPrice), cacheRead: num(t.cacheReadsPrice),
        }))
        .sort((a, b) => (a.upToTokens == null ? Infinity : a.upToTokens) - (b.upToTokens == null ? Infinity : b.upToTokens))
    : [];
  const hasAnyPrice = [base.input, base.output, base.cacheRead, base.cacheWrite5m].some((v) => v != null);
  if (!hasAnyPrice) return null;
  return {
    key: key || null,
    source: 'catalog',
    supportsPromptCache: entry.supportsPromptCache === true || base.cacheRead != null,
    explicitCacheWrites: base.cacheWrite5m != null && base.cacheWrite5m > 0, // the provider bills writes separately (so a TTL exists)
    base, tiers,
  };
}

function getProfile(modelId) {
  const entry = lookupEntry(modelId);
  return profileFromEntry(entry, modelId);
}

/** Rates in force for a prompt of `promptTokens` (tier-aware; missing tier fields fall back to base). */
function ratesAt(profile, promptTokens) {
  const b = profile.base;
  if (!profile.tiers.length) return { ...b, upToTokens: null };
  let tier = profile.tiers[profile.tiers.length - 1];
  for (const t of profile.tiers) { if (t.upToTokens == null || promptTokens <= t.upToTokens) { tier = t; break; } }
  const out = { upToTokens: tier.upToTokens };
  for (const k of ['input', 'output', 'cacheWrite5m', 'cacheWrite1h', 'cacheRead']) out[k] = tier[k] != null ? tier[k] : b[k];
  return out;
}

/**
 * Prices one call with a profile.
 * Missing 1h price => 1h writes are priced at the 5m price and `approximated.write1h` is set (callers should prefer a calibrated profile).
 */
function priceWithProfile(profile, u) {
  if (!profile) return null;
  const tIn = u.tokensIn || 0, tOut = u.tokensOut || 0, cW = u.cacheWrites || 0, cR = u.cacheReads || 0;
  const cW1h = Math.min(Math.max(u.cacheWrites1h || 0, 0), cW);
  const cW5m = cW - cW1h;
  const promptTokens = tIn + cW + cR;
  const r = ratesAt(profile, promptTokens);
  const per = 1e6;
  const w1hRate = r.cacheWrite1h != null ? r.cacheWrite1h : (r.cacheWrite5m || 0);
  const cost = {
    input: (r.input || 0) * tIn / per,
    output: (r.output || 0) * tOut / per,
    write5m: (r.cacheWrite5m || 0) * cW5m / per,
    write1h: w1hRate * cW1h / per,
    read: (r.cacheRead || 0) * cR / per,
  };
  cost.total = cost.input + cost.output + cost.write5m + cost.write1h + cost.read;
  const hit = cost.input + cost.output + (r.cacheRead || 0) * (cR + cW) / per;
  return {
    rates: r, cost, promptTokens, tierUpTo: r.upToTokens,
    counterfactualHit: hit, excessIfMiss: cost.total - hit,
    approximated: { write1h: cW1h > 0 && r.cacheWrite1h == null },
  };
}

function priceCall(modelId, usage) {
  const p = getProfile(modelId);
  if (!p) return null;
  return { modelKey: modelId, supportsPromptCache: p.supportsPromptCache, ...priceWithProfile(p, usage) };
}

/** Rates for display at a given prompt size. */
function ratesFor(modelId, promptTokens = 0) {
  const p = getProfile(modelId);
  if (!p) return null;
  return { supportsPromptCache: p.supportsPromptCache, hasTiers: p.tiers.length > 0, ...ratesAt(p, promptTokens) };
}

/** "5m" -> 300, "1h" -> 3600, "90s" -> 90; null when the label is not a duration. */
function ttlToSeconds(label) {
  const m = /^(\d+(?:\.\d+)?)\s*(s|m|h|d)$/i.exec(String(label || '').trim());
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * { s: 1, m: 60, h: 3600, d: 86400 }[m[2].toLowerCase()]);
}

/**
 * TTL class of one call, from the log (see docs/cache-ttl-cost-plan.md section 3):
 *  1. cacheWrites1h covers all writes          -> '1h'   (source: log)
 *  2. part of the writes is 1h                 -> 'mixed'
 *  3. writes, log has the 1h field with 0      -> '5m'   (source: log)
 *  4. read-only call                           -> inherited from the cache entry it read ('inherited')
 *  5. writes, no 1h field in the log           -> '5m'   (assumed: build predates the 1h option)
 *  6. nothing known                            -> 'n/a'
 */
function ttlOfCall({ cacheWrites = 0, cacheWrites1h, hasField, inherited }) {
  if (cacheWrites > 0) {
    const w1 = cacheWrites1h || 0;
    if (w1 >= cacheWrites) return { ttl: '1h', source: 'log' };
    if (w1 > 0) return { ttl: 'mixed', source: 'log' };
    return { ttl: '5m', source: hasField ? 'log' : 'assumed-old-build' };
  }
  if (inherited) return { ttl: inherited, source: 'inherited' };
  return { ttl: 'n/a', source: 'none' };
}

/** Seconds a cache entry written with this TTL class stays alive ('mixed' is limited by its shortest part). */
function ttlSecondsOf(ttl) {
  if (ttl === 'mixed') return ttlToSeconds('5m');
  return ttlToSeconds(ttl);
}

module.exports = {
  setCatalog, canon, lookupEntry, getProfile, profileFromEntry, ratesAt, priceWithProfile, priceCall, ratesFor,
  ttlOfCall, ttlToSeconds, ttlSecondsOf,
};