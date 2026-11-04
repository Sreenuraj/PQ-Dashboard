/**
 * Glue between the Prompt Analytics route and the pure cache engine:
 *   - gathers evidence (proxy fingerprints from SQLite + the live proxy buffer, extension-log events)
 *   - runs analyzeTaskCache
 *   - returns a per-call patch + a task summary that the UI renders
 *
 * Evidence is persisted as soon as we see it (live buffer -> SQLite), because the proxy buffer is in-memory
 * FIFO and the extension log is rotated by VS Code; the next time the task is opened the evidence is still there.
 */
const { analyzeTaskCache } = require('./cache-analysis');
const { matchFingerprintsToCalls } = require('./fingerprint-match');
const { buildFingerprint } = require('./cache-fingerprint');
const { parseExtensionLog, findExtensionLogFiles } = require('./extension-log');
const fs = require('fs');
const {
  saveRequestFingerprint, getRequestFingerprintsInWindow, getRequestFingerprints,
  saveExtensionLogEvents, getExtensionLogEvents,
} = require('../cache/db');

const PAD_MS = 20 * 60 * 1000;

/** Pulls every chat/completions record out of the proxy's in-memory store and persists their fingerprints. */
function harvestLiveFingerprints(db, store) {
  if (!db || !store || !Array.isArray(store.requests)) return 0;
  let saved = 0;
  for (const rec of store.requests) {
    if (!rec || !rec.path || !/chat\/completions|\/messages$|\/responses$/.test(rec.path)) continue;
    if (rec.method !== 'POST' || !(rec.statusCode >= 200 && rec.statusCode < 300)) continue;
    try {
      const fp = buildFingerprint(rec);
      if (fp && fp.promptTokens != null && saveRequestFingerprint(db, null, fp)) saved++;
    } catch { /* never let evidence capture break the page */ }
  }
  return saved;
}

/** Re-reads recent extension logs and stores their events (idempotent). Cheap enough to run per page load. */
let lastLogIngest = 0;
function ingestLogsIfStale(db, minIntervalMs = 15000) {
  const now = Date.now();
  if (now - lastLogIngest < minIntervalMs) return null;
  lastLogIngest = now;
  let parsed = 0;
  let stored = 0;
  try {
    for (const f of findExtensionLogFiles()) {
      let text;
      try { text = fs.readFileSync(f.file, 'utf8'); } catch { continue; }
      const evs = parseExtensionLog(text, f.key);
      evs.forEach((e) => { e.ts = Math.round(f.mtimeMs); });
      parsed += evs.length;
      stored += saveExtensionLogEvents(db, evs);
    }
  } catch { /* logs are optional evidence */ }
  return { parsed, stored };
}

function toEngineCalls(apiCalls, uiMessages) {
  const out = [];
  let lastUi = -1;
  for (const c of apiCalls) {
    const between = [];
    for (let k = lastUi + 1; k < c.uiMsgIndex; k++) {
      const m = uiMessages[k];
      if (!m) continue;
      if (m.type === 'ask' && m.ask) between.push(m.ask);
      else if (m.say === 'user_feedback') between.push('user_feedback');
    }
    out.push({
      ts: c.ts, modelId: c.modelId, providerId: c.providerId, mode: c.mode || null,
      tokensIn: c.tokensIn, tokensOut: c.tokensOut, cacheWrites: c.cacheWrites, cacheWrites1h: c.cacheWrites1h || 0,
      hasField1h: !!c.hasField1h, cacheReads: c.cacheReads, cost: c.cost,
      uiMsgIndex: c.uiMsgIndex, historyIndex: c.historyIndex, askEventsBetween: between,
      hasPruning: !!c.hasPruning, trimmedFromPrevBytes: c.trimmedFromPrevBytes || 0,
    });
    lastUi = c.uiMsgIndex;
  }
  return out;
}

/**
 * @returns {{calls:Array, summary:object, evidence:object}}  `calls[i]` aligns with apiCalls[i]
 */
function buildCacheAnalysis({ db, store, taskId, apiCalls, uiMessages }) {
  if (!apiCalls.length) return { calls: [], summary: null, evidence: { fingerprints: 0, matched: 0, extensionLogEvents: 0 } };

  if (store) harvestLiveFingerprints(db, store);
  ingestLogsIfStale(db);

  const calls = toEngineCalls(apiCalls, uiMessages);
  const fromTs = (calls[0].ts || 0) - PAD_MS;
  const toTs = (calls[calls.length - 1].ts || 0) + PAD_MS;
  let candidates = [];
  try { candidates = getRequestFingerprintsInWindow(db, fromTs, toTs); } catch { /* table may be missing on old DBs */ }

  const matched = matchFingerprintsToCalls(calls, candidates);
  const extLog = getExtensionLogEvents(db, taskId);

  const res = analyzeTaskCache(calls, { fingerprints: matched, extLog });
  return {
    calls: res.calls,
    summary: res.summary,
    evidence: {
      fingerprints: candidates.length,
      matched: matched.filter(Boolean).length,
      extensionLogEvents: extLog.length,
      note: matched.some(Boolean)
        ? null
        : 'No Network Inspector captures matched this task, so causes that live in the system prompt, tool list or serving provider can only be inferred.',
    },
  };
}

module.exports = { buildCacheAnalysis, harvestLiveFingerprints, ingestLogsIfStale, toEngineCalls };