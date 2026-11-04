/**
 * Prompt-cache fingerprints.
 *
 * The extension never persists the system prompt, the tool list, the routing preference or which backend
 * served a request, yet those are exactly the things that decide whether Anthropic's prefix cache hits.
 * The Network Inspector proxy sees all of them, so for every chat/completions call we keep a *compact*
 * fingerprint (hashes + a few facts, ~3 KB) and, deduplicated by hash, the full system/tools text.
 *
 * Two fingerprints of the same task can then be diffed to say, with evidence, WHY a call missed the cache:
 *   provider changed | system prompt changed | tool list changed (+added/removed names) | message #N changed |
 *   nothing changed (provider-side eviction).
 *
 * Cache semantics reminder (Anthropic prefix cache): the cached prefix is  tools -> system -> messages.
 * `cache_control` markers only choose breakpoints; they are NOT part of the matched content, so they are
 * stripped before hashing.
 */
const crypto = require('crypto');

const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
const short = (s, n = 8) => md5(s).slice(0, n);

/** Deep clone without any `cache_control` keys (breakpoint markers move between calls). */
function stripCacheControl(v) {
  if (Array.isArray(v)) return v.map(stripCacheControl);
  if (v && typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) if (k !== 'cache_control') o[k] = stripCacheControl(v[k]);
    return o;
  }
  return v;
}

function stableStringify(v) {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  if (v && typeof v === 'object') {
    return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
  }
  return JSON.stringify(v);
}

function textOfContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((b) => (typeof b === 'string' ? b : b.text || '')).join('\n');
  return '';
}

/** Reads an OpenRouter/OpenAI-style SSE (or plain JSON) response body. */
function parseResponse(body) {
  const out = { provider: null, model: null, usage: null, generationId: null, finish: null };
  if (!body || typeof body !== 'string') return out;
  const consume = (j) => {
    if (!j || typeof j !== 'object') return;
    if (j.provider) out.provider = j.provider;
    if (j.model) out.model = j.model;
    if (j.id && !out.generationId) out.generationId = j.id;
    if (j.usage) out.usage = j.usage;
    const fr = j.choices && j.choices[0] && j.choices[0].finish_reason;
    if (fr) out.finish = fr;
  };
  if (body.includes('data:')) {
    for (const line of body.split('\n')) {
      if (!line.startsWith('data:') || line.includes('[DONE]')) continue;
      try { consume(JSON.parse(line.slice(5).trim())); } catch { /* partial line */ }
    }
  } else {
    try { consume(JSON.parse(body)); } catch { /* not json */ }
  }
  return out;
}

/** Position + ttl of every cache_control marker in an OpenAI-style messages array. */
function findBreakpoints(messages) {
  const bps = [];
  (messages || []).forEach((m, mi) => {
    if (Array.isArray(m.content)) {
      m.content.forEach((b, bi) => {
        if (b && typeof b === 'object' && b.cache_control) {
          bps.push({ msg: mi, block: bi, role: m.role, type: b.cache_control.type || null, ttl: b.cache_control.ttl || '5m' });
        }
      });
    } else if (m && m.cache_control) {
      bps.push({ msg: mi, block: null, role: m.role, type: m.cache_control.type || null, ttl: m.cache_control.ttl || '5m' });
    }
  });
  return bps;
}

/**
 * @param {object} rec  proxy record: { timestamp, requestBody, responseBody, requestHeaders, responseHeaders, statusCode, agentLabel, subagentIndex }
 * @returns {null | object} fingerprint (JSON-serialisable) plus `_texts` ({system,tools}) for variant storage
 */
function buildFingerprint(rec) {
  let req;
  try { req = typeof rec.requestBody === 'string' ? JSON.parse(rec.requestBody) : rec.requestBody; } catch { return null; }
  if (!req || !Array.isArray(req.messages)) return null;

  const res = parseResponse(rec.responseBody);
  const u = res.usage || {};
  const pd = u.prompt_tokens_details || {};
  const messages = req.messages;
  const first = messages[0];
  const sysIsMsg = first && (first.role === 'system' || first.role === 'developer');
  const systemMsg = sysIsMsg ? first : null;
  const rest = sysIsMsg ? messages.slice(1) : messages;
  const tools = Array.isArray(req.tools) ? req.tools : [];

  const systemClean = systemMsg ? stableStringify(stripCacheControl(systemMsg)) : '';
  const toolsClean = tools.length ? stableStringify(stripCacheControl(tools)) : '';
  const toolNames = tools.map((t) => (t.function && t.function.name) || t.name || '?');
  const msgHashes = rest.map((m) => short(stableStringify(stripCacheControl(m)), 8));

  const prov = req.provider || {};
  const hdr = rec.requestHeaders || {};
  const rh = rec.responseHeaders || {};
  const ts = rec.timestamp ? new Date(rec.timestamp).getTime() : Date.now();

  return {
    capturedTs: ts,
    model: req.model || null,
    respModel: res.model,
    servedBy: res.provider,
    routingOrder: Array.isArray(prov.order) ? prov.order : null,
    allowFallbacks: prov.allow_fallbacks == null ? null : !!prov.allow_fallbacks,
    xMode: hdr['x-mode'] || null,
    status: rec.statusCode || null,
    generationId: rh['x-generation-id'] || res.generationId || null,
    finish: res.finish,
    promptTokens: u.prompt_tokens != null ? u.prompt_tokens : null,
    cachedTokens: pd.cached_tokens != null ? pd.cached_tokens : null,
    cacheWriteTokens: pd.cache_write_tokens != null ? pd.cache_write_tokens : null,
    completionTokens: u.completion_tokens != null ? u.completion_tokens : null,
    reportedCost: typeof u.cost === 'number' ? u.cost : null,
    nMessages: rest.length,
    nTools: tools.length,
    toolNames,
    toolsHash: tools.length ? short(toolsClean, 10) : null,
    systemHash: systemMsg ? short(systemClean, 10) : null,
    systemChars: systemMsg ? textOfContent(systemMsg.content).length : 0,
    msgHashes,
    breakpoints: findBreakpoints(messages),
    agentLabel: rec.agentLabel || null,
    subagentIndex: rec.subagentIndex == null ? null : rec.subagentIndex,
    _texts: {
      system: systemMsg ? textOfContent(systemMsg.content) : null,
      tools: tools.length ? JSON.stringify(tools) : null,
    },
  };
}

/**
 * Explains how `cur` differs from `prev` in the order the provider evaluates the prefix.
 * `firstChange` is the earliest layer that differs: 'provider' | 'system' | 'tools' | 'message' | 'none'.
 * (tools come before system in Anthropic's prefix order, so a tools change invalidates everything.)
 */
function diffFingerprints(prev, cur) {
  if (!prev || !cur) return null;
  const d = {
    providerChanged: !!(prev.servedBy && cur.servedBy && prev.servedBy !== cur.servedBy),
    fromProvider: prev.servedBy || null,
    toProvider: cur.servedBy || null,
    modelChanged: !!(prev.model && cur.model && prev.model !== cur.model),
    fromModel: prev.model || null,
    toModel: cur.model || null,
    toolsChanged: prev.toolsHash !== cur.toolsHash,
    toolsAdded: [],
    toolsRemoved: [],
    systemChanged: prev.systemHash !== cur.systemHash,
    systemCharsDelta: (cur.systemChars || 0) - (prev.systemChars || 0),
    modeChanged: !!(prev.xMode && cur.xMode && prev.xMode !== cur.xMode),
    fromMode: prev.xMode || null,
    toMode: cur.xMode || null,
    routingChanged: JSON.stringify(prev.routingOrder) !== JSON.stringify(cur.routingOrder) || prev.allowFallbacks !== cur.allowFallbacks,
    firstDivergingMessage: null, // index within the non-system messages
    messagesChangedBeforeLastPrev: 0,
    messagesAppended: 0,
    messagesRemoved: 0,
    breakpointTtlChanged: false,
    firstChange: 'none',
  };
  if (d.toolsChanged) {
    const a = new Set(prev.toolNames || []);
    const b = new Set(cur.toolNames || []);
    d.toolsAdded = [...b].filter((x) => !a.has(x)).sort();
    d.toolsRemoved = [...a].filter((x) => !b.has(x)).sort();
  }
  const pm = prev.msgHashes || [];
  const cm = cur.msgHashes || [];
  const common = Math.min(pm.length, cm.length);
  for (let i = 0; i < common; i++) {
    if (pm[i] !== cm[i]) {
      d.firstDivergingMessage = i;
      break;
    }
  }
  if (d.firstDivergingMessage != null) {
    let changed = 0;
    for (let i = d.firstDivergingMessage; i < common; i++) if (pm[i] !== cm[i]) changed++;
    d.messagesChangedBeforeLastPrev = changed;
  }
  d.messagesAppended = Math.max(0, cm.length - pm.length);
  d.messagesRemoved = Math.max(0, pm.length - cm.length);
  const ttlSet = (fp) => JSON.stringify([...new Set((fp.breakpoints || []).map((b) => b.ttl))].sort());
  d.breakpointTtlChanged = ttlSet(prev) !== ttlSet(cur);

  if (d.providerChanged) d.firstChange = 'provider';
  else if (d.toolsChanged) d.firstChange = 'tools';
  else if (d.systemChanged) d.firstChange = 'system';
  else if (d.firstDivergingMessage != null || d.messagesRemoved > 0) d.firstChange = 'message';
  return d;
}

module.exports = { buildFingerprint, diffFingerprints, parseResponse, findBreakpoints, stripCacheControl, stableStringify, short };