/**
 * Prompt-cache analysis engine (pure: no I/O, no DB). Everything the Prompt Analytics page shows about cache
 * behaviour is derived here so it is testable and every sentence is backed by data.
 *
 * Input  : the task's API calls in order (+ optional proxy fingerprints and extension-log events)
 * Output : per call  -> { ttl, cost components, cache state, miss classification, evidence, human message }
 *          per task  -> totals, per-model rollup, waste by cause, 5m-vs-1h what-if
 *
 * Evidence levels (never claim more than the evidence supports):
 *   confirmed : the proxy captured BOTH requests, so we diffed them (provider / tools / system / message N)
 *   strong    : the task files or extension log directly record the cause (model/mode change, TTL gap, cancel+rebuild)
 *   inferred  : only the cR/cW signature is known; the message says so and names what would settle it
 */
const { priceWithProfile, ttlOfCall, ttlSecondsOf, ratesAt } = require('../pricing/cache-pricing');
const { calibrateModel } = require('../pricing/calibrate');
const { diffFingerprints } = require('./cache-fingerprint');

const MISS_READ_FRACTION = 0.10;   // read < 10% of what the previous call had cached  => miss
const PARTIAL_READ_FRACTION = 0.90;
const MIN_PROMPT_FOR_MISS = 20000; // ignore tiny prompts (a miss there costs cents and is noise)
const MIN_WRITE_FOR_MISS = 8000;   // a miss must rewrite at least this many tokens to count

const money = (n) => (Math.abs(n) >= 0.1 ? `$${n.toFixed(2)}` : `$${n.toFixed(3)}`);
const fmtTok = (n) => (n >= 1e6 ? (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + 'K' : String(n));
const fmtDur = (s) => {
  if (s == null) return 'unknown';
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)} min`;
  return `${(s / 3600).toFixed(1)} h`;
};

/** Cost of a call using the calibrated profile for its model (null when the model could not be priced). */
function priceWithCalibration(call, calib) {
  if (!calib || !calib.profile) return null;
  const p = priceWithProfile(calib.profile, { tokensIn: call.tokensIn, tokensOut: call.tokensOut, cacheWrites: call.cacheWrites, cacheWrites1h: call.cacheWrites1h, cacheReads: call.cacheReads });
  return p ? { source: calib.source, rates: p.rates, cost: p.cost, counterfactualHit: p.counterfactualHit, excessIfMiss: p.excessIfMiss, promptTokens: p.promptTokens, tierUpTo: p.tierUpTo, modelKey: calib.catalogKey, explicitWrites: calib.profile.explicitCacheWrites } : null;
}

/**
 * @param {Array} calls  ordered: {ts, modelId, providerId, mode, tokensIn, tokensOut, cacheWrites, cacheWrites1h, hasField1h, cacheReads, cost, uiMsgIndex, historyIndex, askEventsBetween?:string[], hasPruning?, trimmedFromPrevBytes?}
 * @param {object} [ctx]
 * @param {Array}  [ctx.fingerprints]   proxy fingerprints already matched to calls: Map<callIndex, fp> or array aligned to calls (null when unmatched)
 * @param {Array}  [ctx.extLog]         extension-log events for the task ({kind, detail})
 * @param {Array}  [ctx.uiMessages]     ui_messages.json (to read events between calls)
 */
function analyzeTaskCache(calls, ctx = {}) {
  const fps = ctx.fingerprints || [];
  const extLog = ctx.extLog || [];

  // 1. calibrate rates per model (cheap: one pass per model)
  const byModel = new Map();
  for (const c of calls) {
    if (!byModel.has(c.modelId)) byModel.set(c.modelId, []);
    byModel.get(c.modelId).push(c);
  }
  const calibration = new Map();
  for (const [mid, list] of byModel) calibration.set(mid, calibrateModel(mid, list));

  // extension-log facts keyed by previousApiReqIndex
  const buildsByIdx = new Map();
  let cancelSeen = false;
  for (const e of extLog) {
    if (e.kind === 'request_build') {
      const k = e.detail.previousApiReqIndex;
      if (!buildsByIdx.has(k)) buildsByIdx.set(k, []);
      buildsByIdx.get(k).push(e);
    }
    if (e.kind === 'task_cancel' || e.kind === 'task_aborted') cancelSeen = true;
  }
  const optByUsage = new Map();
  for (const e of extLog) if (e.kind === 'context_opt') optByUsage.set(e.detail.usageTokens, e);

  // 2. walk calls with one cache "thread" per model (a cache entry belongs to one model + one TTL class)
  const threads = new Map(); // modelId -> { lastTouchTs, ttl, prefixTokens, lastWriteTtl }
  const out = [];
  let prev = null;

  for (let i = 0; i < calls.length; i++) {
    const c = calls[i];
    const calib = calibration.get(c.modelId);
    const priced = priceWithCalibration(c, calib);
    const cW = c.cacheWrites || 0;
    const cR = c.cacheReads || 0;
    const prompt = (c.tokensIn || 0) + cW + cR;
    const th = threads.get(c.modelId) || null;

    const ttlInfo = ttlOfCall({ cacheWrites: cW, cacheWrites1h: c.cacheWrites1h, hasField: !!c.hasField1h, inherited: th ? th.ttl : null });
    const ttlSecActive = ttlSecondsOf(ttlInfo.ttl) || (th ? th.ttlSec : null) || null;

    const gapSec = prev ? Math.max(0, (c.ts - prev.ts) / 1000) : null;
    const sinceThreadTouchSec = th ? Math.max(0, (c.ts - th.lastTouchTs) / 1000) : null;
    const prevCached = th ? th.prefixTokens : 0;
    const expectedHit = !!th && th.prefixTokens > 0 && sinceThreadTouchSec != null && th.ttlSec != null && sinceThreadTouchSec <= th.ttlSec;

    const readFrac = prevCached > 0 ? cR / prevCached : (cR > 0 ? 1 : 0);
    let state;
    if (!th || prevCached === 0) state = cW > 0 ? 'cold_write' : (cR > 0 ? 'hit' : 'no_cache');
    else if (cR === 0 && cW === 0) state = 'no_cache';
    else if (readFrac < MISS_READ_FRACTION) state = 'miss';
    else if (readFrac < PARTIAL_READ_FRACTION && cW > MIN_WRITE_FOR_MISS) state = 'partial_miss';
    else state = cW > 0 ? 'hit_extend' : 'hit';
    const isSpike = (state === 'miss' || state === 'partial_miss') && prompt >= MIN_PROMPT_FOR_MISS && cW >= MIN_WRITE_FOR_MISS;

    const model = {
      id: c.modelId,
      switched: !!(prev && prev.modelId && c.modelId && prev.modelId !== c.modelId),
      from: prev ? prev.modelId : null,
      modeChanged: !!(prev && prev.mode && c.mode && prev.mode !== c.mode),
      fromMode: prev ? prev.mode : null,
    };

    // evidence ------------------------------------------------------------------------------------------------
    const fp = fps[i] || null;
    const prevFp = i > 0 ? fps[i - 1] || null : null;
    const fpDiff = fp && prevFp ? diffFingerprints(prevFp, fp) : null;
    const builds = c.historyIndex != null && prev ? (buildsByIdx.get(prev.uiMsgIndex) || []) : [];
    const rebuilt = builds.length > 1;
    const optEvt = optByUsage.get(prev ? (prev.tokensIn || 0) + (prev.cacheWrites || 0) + (prev.cacheReads || 0) : -1) || null;
    const askBetween = c.askEventsBetween || [];

    let cause = null;
    let level = null;
    const facts = {};
    if (state === 'cold_write' || state === 'hit' || state === 'hit_extend' || state === 'no_cache') {
      cause = state === 'cold_write' ? (i === 0 ? 'first_call' : (model.switched ? 'model_changed' : 'new_cache_entry')) : state;
      level = 'strong';
    } else {
      // miss / partial miss: first matching rule wins
      if (model.switched) { cause = 'model_changed'; level = 'strong'; }
      else if (th && sinceThreadTouchSec != null && th.ttlSec != null && sinceThreadTouchSec > th.ttlSec) {
        cause = 'ttl_expired'; level = 'strong';
        facts.sinceTouchSec = sinceThreadTouchSec; facts.ttl = th.ttl; facts.ttlSec = th.ttlSec;
        // data-driven hint: the profile advertises a 1h write price while this entry used a shorter TTL
        if (th.ttl === '5m' && calib && calib.profile && ratesAt(calib.profile, prompt).cacheWrite1h != null && sinceThreadTouchSec <= 3600) facts.longerTtlAvailable = '1-hour';
      } else if (fpDiff && fpDiff.providerChanged) { cause = 'provider_changed'; level = 'confirmed'; }
      else if (fpDiff && fpDiff.firstChange === 'tools') { cause = 'tools_changed'; level = 'confirmed'; }
      else if (fpDiff && fpDiff.firstChange === 'system') { cause = 'system_changed'; level = 'confirmed'; }
      else if (fpDiff && fpDiff.modeChanged) { cause = 'mode_changed'; level = 'confirmed'; }
      else if (fpDiff && fpDiff.firstChange === 'message') { cause = 'history_edited'; level = 'confirmed'; }
      else if (fpDiff && fpDiff.firstChange === 'none') { cause = 'provider_eviction'; level = 'confirmed'; }
      else if (model.modeChanged) { cause = 'mode_changed'; level = 'strong'; }
      else if (rebuilt || (cancelSeen && askBetween.includes('resume_task'))) { cause = 'task_rebuilt_after_cancel'; level = rebuilt ? 'strong' : 'inferred'; }
      else if (c.hasPruning || (c.trimmedFromPrevBytes || 0) > 100) { cause = 'history_edited'; level = 'strong'; facts.prunedBytes = c.trimmedFromPrevBytes || null; }
      else if (state === 'miss') { cause = 'unexplained_full_miss'; level = 'inferred'; }
      else { cause = 'unexplained_partial_miss'; level = 'inferred'; }
    }

    // does the read size tell us WHERE the prefix broke? (cR == a stable small prefix => tools+system ok, messages broke)
    let prefixSignal = null;
    if (state === 'miss' || state === 'partial_miss') {
      if (cR === 0) prefixSignal = 'nothing_read';
      else if (fp && fp.systemChars != null && cR < prevCached * 0.5) prefixSignal = 'only_early_prefix_read';
      else prefixSignal = 'partly_read';
    }

    const excess = isSpike && priced ? Math.max(0, priced.excessIfMiss) : 0;
    const rec = {
      index: i,
      ttl: ttlInfo.ttl,
      ttlSource: ttlInfo.source,
      ttlSeconds: ttlSecActive,
      write1hTokens: Math.min(c.cacheWrites1h || 0, cW),
      write5mTokens: cW - Math.min(c.cacheWrites1h || 0, cW),
      gapSec,
      sinceThreadTouchSec,
      expectedHit,
      state,
      isSpike,
      cause,
      evidenceLevel: level,
      prefixSignal,
      model,
      prompt,
      readFraction: Math.round(readFrac * 1000) / 1000,
      rateSource: priced ? priced.source : 'logged_only',
      rates: priced ? priced.rates : null,
      cost: priced ? priced.cost : null,
      loggedCost: c.cost || 0,
      counterfactualHitCost: priced ? priced.counterfactualHit : null,
      excessCost: excess,
      evidence: {
        proxy: fp ? { servedBy: fp.servedBy, systemHash: fp.systemHash, toolsHash: fp.toolsHash, nTools: fp.nTools, nMessages: fp.nMessages, generationId: fp.generationId, breakpoints: fp.breakpoints, routingOrder: fp.routingOrder, allowFallbacks: fp.allowFallbacks } : null,
        proxyDiff: fpDiff,
        extensionLog: { requestBuiltTimes: builds.length || null, taskCancelInLog: cancelSeen, contextOpt: optEvt ? optEvt.detail : null },
        eventsBetween: askBetween,
      },
      facts,
    };
    rec.message = buildMessage(rec, c, prev, th);
    out.push(rec);

    // update thread
    if (cW > 0 || cR > 0) {
      // A TTL class is only known when the log says so ('log'), when it is inherited from the entry that was read, or
      // when it was assumed for builds that predate the 1h option. With no cache WRITE ever seen (provider-managed
      // caching: no write fee, no TTL) it stays 'n/a' and expiry is never claimed.
      const ttl = ttlInfo.ttl !== 'n/a' ? ttlInfo.ttl : (th ? th.ttl : 'n/a');
      threads.set(c.modelId, { lastTouchTs: c.ts, ttl, ttlSec: ttl === 'n/a' ? null : (ttlSecondsOf(ttl) || null), prefixTokens: cR + cW });
    }
    prev = c;
  }

  return { calls: out, summary: summarize(out, calls, calibration) };
}

function ttlLabel(t) { return t === '1h' ? '1-hour' : t === '5m' ? '5-minute' : t; }

/** Human message for one call. Every number comes from the record. */
function buildMessage(r, c, prev, th) {
  const m = r.model.id || 'this model';
  const cost = r.cost ? ` Cost ${money(r.loggedCost)}; with a cache hit it would have been about ${money(r.counterfactualHitCost)} (${money(r.excessCost)} extra).` : ` Cost ${money(r.loggedCost)}.`;
  const ttl = r.ttl !== 'n/a' ? `${ttlLabel(r.ttl)} TTL` : null;
  const ex = r.evidence;
  const gap = r.sinceThreadTouchSec != null ? fmtDur(r.sinceThreadTouchSec) : null;
  const evid = { confirmed: 'Confirmed by diffing the two captured requests.', strong: 'Recorded in the task/extension logs.', inferred: 'Inferred from the cache numbers only.' }[r.evidenceLevel];

  switch (r.cause) {
    case 'first_call': return { title: 'First request', text: `No cache existed yet for ${m}, so the whole prompt (${fmtTok(r.prompt)} tokens) was written to cache${ttl ? ' with a ' + ttl : ''}.` };
    case 'new_cache_entry': return { title: 'New cache entry', text: `${fmtTok(c.cacheWrites)} tokens were written to cache${ttl ? ' (' + ttl + ')' : ''} with nothing to read from for ${m}.` };
    case 'hit': return { title: 'Cache hit', text: `${fmtTok(c.cacheReads)} of ${fmtTok(r.prompt)} prompt tokens were served from cache.` };
    case 'hit_extend': return { title: 'Cache hit', text: `${fmtTok(c.cacheReads)} tokens were read from cache and ${fmtTok(c.cacheWrites)} new tokens were appended to it${ttl ? ' (' + ttl + ')' : ''}.` };
    case 'no_cache': return { title: 'No cache activity', text: `The provider reported no cache reads or writes for this request${r.rateSource === 'logged_only' ? ' (model not known to support prompt caching)' : ''}.` };
    case 'model_changed':
      return { title: 'Model changed', text: `The model changed from ${r.model.from} to ${m}. Prompt cache is per model, so ${fmtTok(c.cacheWrites)} tokens were written fresh.${r.rates ? ` Rates now: cache write ${money((r.write1hTokens && r.rates.cacheWrite1h != null ? r.rates.cacheWrite1h : r.rates.cacheWrite5m) || 0)}/M, cache read ${money(r.rates.cacheRead || 0)}/M.` : ''}${cost}` };
    case 'ttl_expired':
      return { title: 'Cache expired', text: `Last cache use for ${m} was ${gap} earlier, longer than its ${ttlLabel(r.facts.ttl)} TTL, so the entry expired and ${fmtTok(c.cacheWrites)} tokens were rewritten.${r.facts.longerTtlAvailable ? ` This model also has a ${r.facts.longerTtlAvailable} cache write price, which would have kept the entry alive.` : ''}${cost}` };
    case 'provider_changed':
      return { title: 'Served by a different provider', text: `OpenRouter served this request from ${ex.proxyDiff.toProvider} instead of ${ex.proxyDiff.fromProvider}. Provider caches are separate, so the whole prompt (${fmtTok(c.cacheWrites)} tokens) was written again. Routing preference: ${JSON.stringify(ex.proxy && ex.proxy.routingOrder)}, fallbacks ${ex.proxy && ex.proxy.allowFallbacks}.${cost} ${evid}` };
    case 'tools_changed': {
      const d = ex.proxyDiff;
      const parts = [];
      if (d.toolsAdded.length) parts.push(`added ${d.toolsAdded.join(', ')}`);
      if (d.toolsRemoved.length) parts.push(`removed ${d.toolsRemoved.join(', ')}`);
      return { title: 'Tool list changed', text: `The set of tools sent to the model changed (${parts.join('; ') || 'definitions edited'}). Tools sit at the very start of the cached prefix, so everything after it was invalidated and ${fmtTok(c.cacheWrites)} tokens were rewritten${d.systemChanged ? '; the system prompt also changed (' + (d.systemCharsDelta >= 0 ? '+' : '') + d.systemCharsDelta + ' chars)' : ''}. This usually happens when a capability is enabled or disabled mid-session (for example subagents).${cost} ${evid}` };
    }
    case 'system_changed':
      return { title: 'System prompt changed', text: `The system prompt changed (${r.evidence.proxyDiff.systemCharsDelta >= 0 ? '+' : ''}${r.evidence.proxyDiff.systemCharsDelta} chars) while the tool list stayed the same. The system prompt is cached ahead of the conversation, so all ${fmtTok(c.cacheWrites)} tokens after it were rewritten.${cost} ${evid}` };
    case 'mode_changed':
      return { title: 'Mode changed', text: `The mode changed from ${r.model.fromMode || r.evidence.proxyDiff?.fromMode} to ${r.model.id ? (c.mode || r.evidence.proxyDiff?.toMode) : ''}; each mode builds its own system prompt, which invalidates the cached prefix.${cost} ${evid}` };
    case 'history_edited': {
      const d = r.evidence.proxyDiff;
      const where = d && d.firstDivergingMessage != null ? ` starting at message #${d.firstDivergingMessage}` : '';
      const read = c.cacheReads > 0 ? ` Only the first ${fmtTok(c.cacheReads)} tokens (tools + system prompt) still matched.` : '';
      return { title: 'Earlier conversation was edited', text: `Earlier messages changed${where}${r.facts.prunedBytes ? ` (about ${fmtTok(r.facts.prunedBytes)} bytes pruned/truncated)` : ''}, so the cached prefix no longer matched and ${fmtTok(c.cacheWrites)} tokens were rewritten.${read}${cost} ${evid}` };
    }
    case 'provider_eviction':
      return { title: 'Provider-side cache miss', text: `Nothing in the request changed compared with the previous call (same provider, tools, system prompt and messages) and the gap (${gap}) is inside the ${ttlLabel(r.ttl)} TTL, yet the provider did not return the cache. That is a provider-side eviction, not something the extension caused.${cost} ${evid}` };
    case 'task_rebuilt_after_cancel': {
      const times = ex.extensionLog.requestBuiltTimes;
      return { title: 'Request rebuilt after a cancel', text: `The extension log shows this request was built ${times && times > 1 ? times + ' times' : 'again'} after the task was cancelled/aborted (the "resume" prompt is created by that cancel). The gap since the last call (${gap}) is well inside the ${ttlLabel(r.ttl)} TTL, so expiry is ruled out. ${c.cacheReads === 0 ? 'Nothing was read from cache, which means the very start of the request (tools, system prompt or serving provider) was different from the cached one.' : 'Only the early part of the prompt matched.'} The proxy did not capture both requests, so which of those it was cannot be determined.${cost}` };
    }
    case 'unexplained_full_miss':
      return { title: 'Cache miss (cause not recorded)', text: `${fmtTok(c.cacheWrites)} tokens were rewritten with nothing read, ${gap ? gap + ' after the last call, ' : ''}inside the ${ttl || 'cache'} window; the model, mode and provider id did not change and no pruning was recorded. The first part of the request must have differed (system prompt, tool list or serving provider), but the task files do not keep those. Keep the Network Inspector running to capture them.${cost}` };
    case 'unexplained_partial_miss':
      return { title: 'Partial cache miss', text: `Only ${fmtTok(c.cacheReads)} of the ${fmtTok(r.prompt - c.tokensIn - 0)} previously cached tokens matched; ${fmtTok(c.cacheWrites)} were rewritten. Part of the earlier prompt changed, but no pruning or model change was recorded.${cost}` };
    default: return { title: r.cause, text: '' };
  }
}

function summarize(calls, raw, calibration) {
  const byCause = {};
  let totalLogged = 0, totalExcess = 0, w1h = 0, w5m = 0, reads = 0, spikes = 0;
  for (const r of calls) {
    totalLogged += r.loggedCost || 0;
    w1h += r.write1hTokens; w5m += r.write5mTokens;
    reads += raw[r.index].cacheReads || 0;
    if (r.isSpike) {
      spikes++;
      totalExcess += r.excessCost;
      const b = (byCause[r.cause] = byCause[r.cause] || { calls: 0, excessCost: 0, tokensRewritten: 0, evidence: {} });
      b.calls++; b.excessCost += r.excessCost; b.tokensRewritten += raw[r.index].cacheWrites || 0;
      b.evidence[r.evidenceLevel] = (b.evidence[r.evidenceLevel] || 0) + 1;
    }
  }
  const models = [...calibration.entries()].map(([id, c]) => ({ id, rateSource: c.source, reproduced: c.reproduced, total: c.total, catalogKey: c.catalogKey || null, fittedRates: c.rates || null }));

  // 1h vs 5m what-if: every 1h write would have cost the 5m price; every call that reused a cache across a gap >5m
  // (but <=1h) would instead have rewritten that prefix at the 5m write price.
  let premium = 0, avoided = 0;
  const lastTouch = new Map();
  for (const r of calls) {
    const c = raw[r.index];
    const rates = r.rates;
    if (rates && r.write1hTokens && rates.cacheWrite1h != null && rates.cacheWrite5m != null) premium += r.write1hTokens * (rates.cacheWrite1h - rates.cacheWrite5m) / 1e6;
    const t = lastTouch.get(c.modelId);
    if (t && rates && (c.cacheReads || 0) > 0) {
      const gap = (c.ts - t.ts) / 1000;
      if (gap > 300 && gap <= 3600 && t.ttl === '1h') avoided += (c.cacheReads * ((rates.cacheWrite5m || 0) - (rates.cacheRead || 0))) / 1e6;
    }
    if ((c.cacheWrites || 0) > 0 || (c.cacheReads || 0) > 0) lastTouch.set(c.modelId, { ts: c.ts, ttl: r.ttl === 'n/a' ? '5m' : r.ttl });
  }
  return {
    totalLoggedCost: totalLogged, spikes, totalExcessCost: totalExcess, excessPct: totalLogged > 0 ? (100 * totalExcess) / totalLogged : 0,
    write1hTokens: w1h, write5mTokens: w5m, cacheReadTokens: reads,
    byCause, models, ttlWhatIf: { premium1hPaid: premium, rewritesAvoidedBy1h: avoided, net: avoided - premium },
  };
}

module.exports = { analyzeTaskCache, priceWithCalibration, buildMessage, MISS_READ_FRACTION };