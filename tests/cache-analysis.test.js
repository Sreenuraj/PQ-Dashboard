/**
 * Prompt-cache analysis tests. Run: node --test tests/
 *
 * Scenarios mirror real tasks seen in the field:
 *   - task 1793790091972  : 107 s gap, 1h TTL, nothing read, request built twice after a cancel
 *   - task 1793782172847  : 3.3 h gap on a 1h TTL (genuine expiry) and subagents enabled mid-session (tools 27 -> 31)
 *   - task 1793333476479  : only system+tools prefix read (15,123) after history was edited
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { analyzeTaskCache } = require('../server/analytics/cache-analysis');
const { diffFingerprints, buildFingerprint, stripCacheControl } = require('../server/analytics/cache-fingerprint');
const { matchFingerprintsToCalls } = require('../server/analytics/fingerprint-match');
const { parseExtensionLog } = require('../server/analytics/extension-log');
const { setCatalog, priceCall, lookupEntry, ttlOfCall, canon, ttlToSeconds, ratesFor } = require('../server/pricing/cache-pricing');
const { calibrateModel, fitRates } = require('../server/pricing/calibrate');

// Synthetic catalog: made-up models and prices. The project ships NO model data; prices are looked up at runtime
// (extension catalog files + live OpenRouter list) and calibrated against logged costs.
const ALPHA = 'acme/alpha-1';   // explicit 5m/1h cache writes
const BETA = 'acme/beta-1';     // cheaper sibling
const TIERED = 'acme/tiered-1'; // long-context price tier above 100K tokens
const AUTO = 'acme/auto-1';     // provider-managed cache: read discount, no write fee, no TTL
const CATALOG = {
  [ALPHA]: { inputPrice: 4, outputPrice: 20, cacheWritesPrice: 5, cacheWrites1hPrice: 8, cacheReadsPrice: 0.2, supportsPromptCache: true },
  [BETA]: { inputPrice: 2, outputPrice: 10, cacheWritesPrice: 2.5, cacheWrites1hPrice: 4, cacheReadsPrice: 0.1, supportsPromptCache: true },
  [TIERED]: {
    inputPrice: 1, outputPrice: 5, cacheWritesPrice: 1.25, cacheWrites1hPrice: 2, cacheReadsPrice: 0.1, supportsPromptCache: true,
    tiers: [{ contextWindow: 100000, inputPrice: 1, outputPrice: 5, cacheWritesPrice: 1.25, cacheWrites1hPrice: 2, cacheReadsPrice: 0.1 },
            { contextWindow: Number.MAX_SAFE_INTEGER, inputPrice: 2, outputPrice: 10, cacheWritesPrice: 2.5, cacheWrites1hPrice: 4, cacheReadsPrice: 0.2 }],
  },
  [AUTO]: { inputPrice: 3, outputPrice: 12, cacheReadsPrice: 0.3, supportsPromptCache: true },
};
setCatalog({ all: () => CATALOG, version: () => 1 });
const OPUS = ALPHA;
const SONNET = BETA;

function call(i, o) {
  const base = { ts: 1_000_000 + i * 20_000, modelId: OPUS, providerId: 'postqode', mode: 'agent', tokensIn: 4, tokensOut: 300, cacheWrites: 2000, cacheWrites1h: 2000, hasField1h: true, cacheReads: 100_000, uiMsgIndex: i * 6, historyIndex: i * 2 + 1, askEventsBetween: [], cost: 0 };
  const c = { ...base, ...o };
  if (o && o.cost == null) {
    const p = priceCall(c.modelId, { tokensIn: c.tokensIn, tokensOut: c.tokensOut, cacheWrites: c.cacheWrites, cacheWrites1h: c.cacheWrites1h, cacheReads: c.cacheReads });
    c.cost = p ? p.cost.total : 0;
  }
  return c;
}
function series(n, o = {}) {
  const out = [];
  let reads = 0;
  for (let i = 0; i < n; i++) {
    out.push(call(i, { cacheReads: i === 0 ? 0 : reads, cacheWrites: i === 0 ? 50_000 : 2000, cacheWrites1h: i === 0 ? 50_000 : 2000, ...o }));
    reads = (out[i].cacheReads || 0) + out[i].cacheWrites;
  }
  return out;
}

/** Calls whose token columns vary independently (as real tasks do), so rates are identifiable by least squares. */
function variedSeries(n, o = {}) {
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(call(i, {
      tokensIn: 4 + ((i * 7919) % 3300), tokensOut: 120 + ((i * 104729) % 1900),
      cacheWrites: 400 + ((i * 15485863) % 9000), cacheWrites1h: 400 + ((i * 15485863) % 9000), cacheReads: 8000 + ((i * 32452843) % 90000),
      cost: 0, ...o,
    }));
  }
  return out;
}

/* ───────────────────────── pricing ───────────────────────── */

test('opus 5.5 1h write is priced at the 1h rate, 5m write at the 5m rate', () => {
  const p1h = priceCall(OPUS, { tokensIn: 0, tokensOut: 0, cacheWrites: 1_000_000, cacheWrites1h: 1_000_000, cacheReads: 0 });
  const p5m = priceCall(OPUS, { tokensIn: 0, tokensOut: 0, cacheWrites: 1_000_000, cacheWrites1h: 0, cacheReads: 0 });
  assert.ok(Math.abs(p1h.cost.total - 8) < 1e-9);
  assert.ok(Math.abs(p5m.cost.total - 5) < 1e-9);
});

test('a whole-prompt rewrite at 1h write rates costs ~25x a cache hit (spike arithmetic)', () => {
  const p = priceCall(ALPHA, { tokensIn: 4, tokensOut: 1887, cacheWrites: 307316, cacheWrites1h: 307316, cacheReads: 0 });
  assert.ok(Math.abs(p.cost.total - (4 * 4 + 1887 * 20 + 307316 * 8) / 1e6) < 1e-9);
  assert.ok(Math.abs(p.counterfactualHit - (4 * 4 + 1887 * 20 + 307316 * 0.2) / 1e6) < 1e-9);
  assert.ok(p.excessIfMiss > 2.3);
});

test('model id lookup is generic and STRICT (no substring guessing)', () => {
  assert.equal(canon('vendor/Some-Model.2:free'), 'some-model-2');
  assert.equal(canon('postqode:acme/alpha-1'), 'alpha-1');
  assert.equal(canon('acme/model-20250101'), 'model');
  assert.ok(lookupEntry('acme/alpha-1'));
  assert.ok(lookupEntry('other-vendor/alpha-1'), 'same model under another vendor prefix resolves');
  assert.ok(lookupEntry('~acme/alpha-1:free'));
  assert.equal(lookupEntry('acme/alpha'), null, 'a prefix of a real id must NOT match');
  assert.equal(lookupEntry('acme/alpha-1-pro'), null, 'a longer id must NOT match');
  assert.equal(lookupEntry('definitely/not-a-model'), null);
});

test('prices come from the injected catalog, so a catalog refresh is picked up (nothing cached statically)', () => {
  const before = ratesFor(ALPHA).cacheRead;
  setCatalog({ all: () => ({ ...CATALOG, [ALPHA]: { ...CATALOG[ALPHA], cacheReadsPrice: 0.5 } }), version: () => 2 });
  assert.equal(ratesFor(ALPHA).cacheRead, 0.5);
  setCatalog({ all: () => CATALOG, version: () => 1 });
  assert.equal(ratesFor(ALPHA).cacheRead, before);
});

test('TTL labels are parsed generically', () => {
  assert.equal(ttlToSeconds('5m'), 300);
  assert.equal(ttlToSeconds('1h'), 3600);
  assert.equal(ttlToSeconds('24h'), 86400);
  assert.equal(ttlToSeconds('forever'), null);
});

test('long-context tier is selected from TOTAL prompt tokens (input + cache writes + cache reads)', () => {
  const big = priceCall(TIERED, { tokensIn: 1_000_000, tokensOut: 0, cacheWrites: 0, cacheReads: 0 });
  assert.ok(Math.abs(big.cost.input - 2) < 1e-9);          // >100K tier: $2/M
  const tiny = priceCall(TIERED, { tokensIn: 50_000, tokensOut: 0, cacheWrites: 0, cacheReads: 0 });
  assert.ok(Math.abs(tiny.cost.input - 0.05) < 1e-9);      // <=100K tier: $1/M
  const viaReads = priceCall(TIERED, { tokensIn: 10, tokensOut: 0, cacheWrites: 0, cacheReads: 150_000 });
  assert.ok(Math.abs(viaReads.cost.read - 150_000 * 0.2 / 1e6) < 1e-9); // cache reads push the call into the big tier
});

test('ttlOfCall priority: log 1h > log 5m > inherited > assumed old build', () => {
  assert.deepEqual(ttlOfCall({ cacheWrites: 10, cacheWrites1h: 10, hasField: true }), { ttl: '1h', source: 'log' });
  assert.deepEqual(ttlOfCall({ cacheWrites: 10, cacheWrites1h: 4, hasField: true }), { ttl: 'mixed', source: 'log' });
  assert.deepEqual(ttlOfCall({ cacheWrites: 10, cacheWrites1h: 0, hasField: true }), { ttl: '5m', source: 'log' });
  assert.deepEqual(ttlOfCall({ cacheWrites: 0, hasField: false, inherited: '1h' }), { ttl: '1h', source: 'inherited' });
  assert.deepEqual(ttlOfCall({ cacheWrites: 10, hasField: false }), { ttl: '5m', source: 'assumed-old-build' });
});

test('calibration: table matches -> table; changed price -> fitted exactly; unknown model -> unmodeled', () => {
  // Columns must be linearly independent or no least-squares fit can separate the rates.
  const rows = [
    [1200, 310, 5200, 21000], [4, 950, 1800, 64000], [3300, 120, 9000, 8000], [90, 2100, 400, 130000],
    [700, 640, 12000, 45000], [15, 80, 700, 99000], [2500, 1500, 3100, 15000], [60, 400, 6400, 77000],
  ];
  const mk = (rIn, rOut, rW, rR) => rows.map(([tin, tout, cw, cr]) => {
    const c = { tokensIn: tin, tokensOut: tout, cacheWrites: cw, cacheWrites1h: 0, cacheReads: cr };
    c.cost = (rIn * c.tokensIn + rOut * c.tokensOut + rW * c.cacheWrites + rR * c.cacheReads) / 1e6;
    return c;
  });
  assert.equal(calibrateModel(SONNET, mk(2, 10, 2.5, 0.1)).source, 'catalog');
  const fitted = calibrateModel(SONNET, mk(2, 10, 2.5, 0.2)); // price from before the cache-read cut
  assert.equal(fitted.source, 'fitted');
  assert.ok(Math.abs(fitted.rates.cacheRead - 0.2) < 1e-4);
  assert.equal(fitted.profile.base.cacheWrite1h, 4, 'a rate the task never exercised (1h write) still comes from the catalog');
  assert.equal(calibrateModel('nobody/unknown-model', mk(1, 1, 1, 1)).source, 'fitted'); // consistent linear costs are reproducible even with no catalog entry
  const noisy = mk(1, 1, 1, 1).map((c, i) => ({ ...c, cost: c.cost * (i % 2 ? 3.3 : 0.2) }));
  assert.equal(calibrateModel('nobody/unknown-model', noisy).source, 'unmodeled');
  assert.ok(fitRates(mk(2, 10, 2.5, 0.1)));
});

/* ───────────────────────── engine ───────────────────────── */

test('healthy session: no spikes, TTL is 1h, hits are classified', () => {
  const r = analyzeTaskCache(series(8));
  assert.equal(r.summary.spikes, 0);
  assert.equal(r.calls[0].cause, 'first_call');
  assert.equal(r.calls[0].ttl, '1h');
  assert.ok(r.calls.slice(1).every((c) => c.state === 'hit_extend'));
  assert.equal(r.summary.totalExcessCost, 0);
});

test('idle gap inside a 1h TTL is NOT reported as TTL expiry (task 1793790091972 / call #44)', () => {
  const calls = series(10);
  // call 5: nothing read, whole prompt rewritten, only 107 s after the previous call
  const prevTotal = calls[4].cacheReads + calls[4].cacheWrites;
  calls[5] = call(5, { cacheReads: 0, cacheWrites: prevTotal + 2000, cacheWrites1h: prevTotal + 2000, ts: calls[4].ts + 107_000, askEventsBetween: ['resume_task', 'user_feedback'] });
  for (let i = 6; i < 10; i++) { calls[i] = call(i, { cacheReads: calls[i - 1].cacheWrites, cacheWrites: 1500, cacheWrites1h: 1500 }); }
  const extLog = [
    { kind: 'request_build', detail: { previousApiReqIndex: calls[4].uiMsgIndex } },
    { kind: 'task_cancel', detail: {} },
    { kind: 'request_build', detail: { previousApiReqIndex: calls[4].uiMsgIndex } },
  ];
  const r = analyzeTaskCache(calls, { extLog });
  const c = r.calls[5];
  assert.equal(c.isSpike, true);
  assert.equal(c.cause, 'task_rebuilt_after_cancel');
  assert.notEqual(c.cause, 'ttl_expired');
  assert.equal(c.ttl, '1h');
  assert.match(c.message.text, /1-hour TTL/);
  assert.doesNotMatch(c.message.text, /5-minute/);
  assert.ok(c.excessCost > 0);
});

test('gap longer than the 1h TTL IS reported as expiry with the real TTL in the text', () => {
  const calls = series(6);
  calls[3] = call(3, { cacheReads: 0, cacheWrites: calls[2].cacheReads + calls[2].cacheWrites, cacheWrites1h: calls[2].cacheReads + calls[2].cacheWrites, ts: calls[2].ts + 3.3 * 3600 * 1000 });
  const r = analyzeTaskCache(calls);
  assert.equal(r.calls[3].cause, 'ttl_expired');
  assert.match(r.calls[3].message.text, /1-hour TTL/);
});

test('5-minute TTL: the same 6 minute gap expires the cache and the message says 5-minute', () => {
  const mk = (i, o) => call(i, { cacheWrites1h: 0, ...o });
  const calls = [mk(0, { cacheReads: 0, cacheWrites: 60_000 }), mk(1, { cacheReads: 60_000, cacheWrites: 2000 }), mk(2, { cacheReads: 0, cacheWrites: 62_000, ts: 1_000_000 + 20_000 + 6 * 60_000 })];
  const r = analyzeTaskCache(calls);
  assert.equal(r.calls[2].cause, 'ttl_expired');
  assert.equal(r.calls[2].ttl, '5m');
  assert.match(r.calls[2].message.text, /5-minute TTL/);
});

test('model switch: rates of EACH call use that call\'s model; spike is attributed to the switch', () => {
  const calls = series(4);
  const sw = call(4, { modelId: SONNET, cacheReads: 0, cacheWrites: 60_000, cacheWrites1h: 60_000 });
  const r = analyzeTaskCache([...calls, sw]);
  const last = r.calls[4];
  assert.equal(last.cause, 'model_changed');
  assert.equal(last.rates.cacheWrite1h, 4);       // sonnet 5.5 1h write, not opus's 8
  assert.equal(r.calls[3].rates.cacheWrite1h, 8); // opus call keeps opus rates
  assert.equal(r.summary.models.length, 2);
});

test('switching back to a model within TTL can still hit its own cache thread', () => {
  const a1 = call(0, { cacheReads: 0, cacheWrites: 40_000, cacheWrites1h: 40_000 });
  const b1 = call(1, { modelId: SONNET, cacheReads: 0, cacheWrites: 40_000, cacheWrites1h: 40_000 });
  const a2 = call(2, { cacheReads: 40_000, cacheWrites: 1000, cacheWrites1h: 1000 });
  const r = analyzeTaskCache([a1, b1, a2]);
  assert.equal(r.calls[2].state, 'hit_extend');
  assert.equal(r.summary.spikes, 0);
});

test('tools changed between calls (proxy fingerprints) is CONFIRMED and names the added tools', () => {
  const calls = series(5);
  calls[3] = call(3, { cacheReads: 0, cacheWrites: calls[2].cacheReads + calls[2].cacheWrites, cacheWrites1h: calls[2].cacheReads + calls[2].cacheWrites });
  const mkfp = (n, tools) => ({ capturedTs: 1, model: OPUS, servedBy: 'Claude Platform on AWS', systemHash: 'sys1', systemChars: 1000, toolsHash: 'h' + tools.length, toolNames: tools, nTools: tools.length, msgHashes: Array.from({ length: n }, (_, i) => 'm' + i), breakpoints: [], routingOrder: ['Claude Platform on AWS'], allowFallbacks: true, xMode: 'agent' });
  const t27 = Array.from({ length: 27 }, (_, i) => 't' + i);
  const t31 = [...t27, 'task_create', 'use_subagents', 'task_output', 'task_stop'];
  const fps = [mkfp(10, t27), mkfp(11, t27), mkfp(12, t27), { ...mkfp(13, t31), systemChars: 1296 }, mkfp(14, t31)];
  const r = analyzeTaskCache(calls, { fingerprints: fps });
  const c = r.calls[3];
  assert.equal(c.cause, 'tools_changed');
  assert.equal(c.evidenceLevel, 'confirmed');
  assert.match(c.message.text, /use_subagents/);
  assert.match(c.message.text, /subagents/);
});

test('provider fallback is detected from the serving provider and explains cR = 0 + full rewrite', () => {
  const calls = series(4);
  calls[2] = call(2, { cacheReads: 0, cacheWrites: calls[1].cacheReads + calls[1].cacheWrites, cacheWrites1h: calls[1].cacheReads + calls[1].cacheWrites });
  const base = { capturedTs: 1, model: OPUS, systemHash: 's', systemChars: 5, toolsHash: 't', toolNames: ['a'], nTools: 1, msgHashes: ['x'], breakpoints: [], routingOrder: ['A'], allowFallbacks: true };
  const fps = [{ ...base, servedBy: 'A' }, { ...base, servedBy: 'A' }, { ...base, servedBy: 'B' }, { ...base, servedBy: 'B' }];
  const r = analyzeTaskCache(calls, { fingerprints: fps });
  assert.equal(r.calls[2].cause, 'provider_changed');
  assert.match(r.calls[2].message.text, /B instead of A/);
});

test('nothing changed + inside TTL => provider-side eviction (confirmed), never blamed on the user or extension', () => {
  const calls = series(4);
  calls[2] = call(2, { cacheReads: 0, cacheWrites: calls[1].cacheReads + calls[1].cacheWrites, cacheWrites1h: calls[1].cacheReads + calls[1].cacheWrites });
  const fp = { capturedTs: 1, model: OPUS, servedBy: 'A', systemHash: 's', systemChars: 5, toolsHash: 't', toolNames: ['a'], nTools: 1, msgHashes: ['x'], breakpoints: [], routingOrder: ['A'], allowFallbacks: true };
  const fps = [fp, { ...fp, msgHashes: ['x', 'y'] }, { ...fp, msgHashes: ['x', 'y', 'z'] }, { ...fp, msgHashes: ['x', 'y', 'z', 'w'] }];
  const r = analyzeTaskCache(calls, { fingerprints: fps });
  assert.equal(r.calls[2].cause, 'provider_eviction');
  assert.equal(r.calls[2].evidenceLevel, 'confirmed');
});

test('no evidence at all => honest "cause not recorded", level inferred, says what would settle it', () => {
  const calls = series(4);
  calls[2] = call(2, { cacheReads: 0, cacheWrites: calls[1].cacheReads + calls[1].cacheWrites, cacheWrites1h: calls[1].cacheReads + calls[1].cacheWrites });
  const r = analyzeTaskCache(calls);
  assert.equal(r.calls[2].cause, 'unexplained_full_miss');
  assert.equal(r.calls[2].evidenceLevel, 'inferred');
  assert.match(r.calls[2].message.text, /Network Inspector/);
});

test('unmodeled model keeps the logged cost and never fabricates an excess cost', () => {
  const odd = series(4, { modelId: 'acme/mystery-1' }).map((c) => ({ ...c, cost: 0.123 }));
  const r = analyzeTaskCache(odd);
  assert.ok(r.calls.every((c) => c.rateSource === 'logged_only'));
  assert.equal(r.summary.totalExcessCost, 0);
});

test('small prompts do not count as spikes (noise guard)', () => {
  const calls = [call(0, { cacheReads: 0, cacheWrites: 3000, cacheWrites1h: 3000 }), call(1, { cacheReads: 0, cacheWrites: 3500, cacheWrites1h: 3500 })];
  const r = analyzeTaskCache(calls);
  assert.equal(r.summary.spikes, 0);
});

test('1h what-if: premium paid and avoided rewrites are both reported', () => {
  const calls = series(3);
  calls[2] = { ...calls[2], ts: calls[1].ts + 20 * 60_000 }; // 20 min gap, still a hit thanks to 1h TTL
  const r = analyzeTaskCache(calls);
  assert.ok(r.summary.ttlWhatIf.premium1hPaid > 0);
  assert.ok(r.summary.ttlWhatIf.rewritesAvoidedBy1h > 0);
});

/* ───────────────────────── fingerprints ───────────────────────── */

test('cache_control markers are ignored when hashing (breakpoints move every call)', () => {
  const body = (bp) => JSON.stringify({ model: OPUS, messages: [{ role: 'system', content: [{ type: 'text', text: 'SYS', cache_control: { type: 'ephemeral', ttl: '1h' } }] }, { role: 'user', content: [{ type: 'text', text: 'hi', ...(bp ? { cache_control: { type: 'ephemeral' } } : {}) }] }], tools: [{ type: 'function', function: { name: 'read_file' } }] });
  const a = buildFingerprint({ requestBody: body(true), responseBody: '', timestamp: '2026-01-01T00:00:00Z' });
  const b = buildFingerprint({ requestBody: body(false), responseBody: '', timestamp: '2026-01-01T00:00:00Z' });
  assert.equal(a.systemHash, b.systemHash);
  assert.equal(a.toolsHash, b.toolsHash);
  assert.equal(a.msgHashes[0], b.msgHashes[0]);
  assert.deepEqual(stripCacheControl({ a: { cache_control: 1, b: 2 } }), { a: { b: 2 } });
});

test('diffFingerprints reports the earliest divergence in prefix order: provider, tools, system, message', () => {
  const base = { servedBy: 'A', toolsHash: 't', systemHash: 's', toolNames: ['a'], systemChars: 1, msgHashes: ['1', '2', '3'], breakpoints: [], routingOrder: null, allowFallbacks: null };
  assert.equal(diffFingerprints(base, { ...base, servedBy: 'B' }).firstChange, 'provider');
  assert.equal(diffFingerprints(base, { ...base, toolsHash: 't2', toolNames: ['a', 'b'] }).firstChange, 'tools');
  assert.equal(diffFingerprints(base, { ...base, systemHash: 's2' }).firstChange, 'system');
  const m = diffFingerprints(base, { ...base, msgHashes: ['1', 'X', '3', '4'] });
  assert.equal(m.firstChange, 'message');
  assert.equal(m.firstDivergingMessage, 1);
  assert.equal(diffFingerprints(base, { ...base, msgHashes: ['1', '2', '3', '4'] }).firstChange, 'none');
});

test('fingerprints join to task calls by exact prompt/write tokens and model, each used once', () => {
  const calls = [{ ts: 1000, modelId: OPUS, tokensIn: 4, cacheWrites: 100, cacheReads: 900 }, { ts: 2000, modelId: OPUS, tokensIn: 4, cacheWrites: 50, cacheReads: 1000 }];
  const fps = [{ capturedTs: 2500, model: OPUS, promptTokens: 1054, cacheWriteTokens: 50 }, { capturedTs: 1500, model: OPUS, promptTokens: 1004, cacheWriteTokens: 100 }];
  const m = matchFingerprintsToCalls(calls, fps);
  assert.equal(m[0].promptTokens, 1004);
  assert.equal(m[1].promptTokens, 1054);
});

/* ───────────────────────── extension log ───────────────────────── */

test('extension log: duplicate previousApiReqIndex, cancel and abort are extracted and attributed to the task', () => {
  const log = [
    'INFO [Task 1793790091972] Using StandaloneTerminalManager for backgroundExec mode',
    'DEBUG [AutoCondense] gate: useAutoCondense=true model=anthropic/claude-opus-5.5 window=1000000 currentlySummarizing=false failures=0',
    'DEBUG [AutoCondense] threshold check: shouldCompact=false threshold=0.75 previousApiReqIndex=328',
    'DEBUG [ContextOpt] usage=297229/750000 pressure=true cacheAware=true skipped=false updates=true saved=0.330 payoff=0.591 cappedImages=0 keptForImages=false truncated=false reverted=true',
    'LOG [TaskCancel] Resume ask failed (task may have been cleared): Error: Current ask promise was ignored',
    'INFO [Task 1793790091972] Using StandaloneTerminalManager for backgroundExec mode',
    'DEBUG [Task] Failed to present message: Error: PostQode instance aborted',
    'DEBUG [AutoCondense] threshold check: shouldCompact=false threshold=0.75 previousApiReqIndex=328',
  ].join('\n');
  const ev = parseExtensionLog(log, 'k');
  assert.equal(ev.filter((e) => e.kind === 'request_build' && e.detail.previousApiReqIndex === 328).length, 2);
  assert.equal(ev.filter((e) => e.kind === 'task_cancel').length, 1);
  assert.equal(ev.filter((e) => e.kind === 'task_aborted').length, 1);
  assert.ok(ev.every((e) => e.taskId === '1793790091972'));
  assert.equal(ev.find((e) => e.kind === 'context_opt').detail.reverted, true);
});
/* ───────────────────────── dynamic-pricing behaviour ───────────────────────── */

test('provider-managed cache (no write fee, no TTL): never claims expiry, even after hours', () => {
  const a = call(0, { modelId: AUTO, cacheReads: 0, cacheWrites: 0, cacheWrites1h: 0, hasField1h: false, tokensIn: 40_000 });
  const b = call(1, { modelId: AUTO, cacheReads: 30_000, cacheWrites: 0, cacheWrites1h: 0, hasField1h: false, tokensIn: 12_000, ts: a.ts + 20_000 });
  const c = call(2, { modelId: AUTO, cacheReads: 0, cacheWrites: 0, cacheWrites1h: 0, hasField1h: false, tokensIn: 45_000, ts: b.ts + 5 * 3600 * 1000 });
  const r = analyzeTaskCache([a, b, c]);
  assert.notEqual(r.calls[2].cause, 'ttl_expired');
  assert.equal(r.calls[2].ttl, 'n/a');
});

test('model unknown to every catalog: calibrated from logged costs, else logged-only; never invented', () => {
  const calls = variedSeries(9, { modelId: 'nobody/unlisted-1' }).map((c) => ({ ...c, cost: (c.tokensIn * 3 + c.tokensOut * 9 + c.cacheWrites * 4 + c.cacheReads * 0.3) / 1e6 }));
  const r = analyzeTaskCache(calls);
  assert.equal(r.summary.models[0].rateSource, 'fitted');
  assert.equal(r.summary.models[0].catalogKey, null);
  assert.ok(Math.abs(r.summary.models[0].fittedRates.cacheRead - 0.3) < 1e-4);
});

test('a price change over time is absorbed by calibration (old task priced with the old rate)', () => {
  const old = variedSeries(9).map((c) => ({ ...c, cost: (c.tokensIn * 4 + c.tokensOut * 20 + c.cacheWrites * 8 + c.cacheReads * 0.4) / 1e6 })); // read was 0.4 then
  const r = analyzeTaskCache(old);
  assert.equal(r.summary.models[0].rateSource, 'fitted');
  assert.ok(Math.abs(r.summary.models[0].fittedRates.cacheRead - 0.4) < 1e-4);
});

test('expiry message offers a longer-TTL hint only when the catalog really has a longer write price', () => {
  const mk = (id) => {
    const a = call(0, { modelId: id, cacheWrites1h: 0, hasField1h: true, cacheReads: 0, cacheWrites: 60_000 });
    const b = call(1, { modelId: id, cacheWrites1h: 0, hasField1h: true, cacheReads: 0, cacheWrites: 60_000, ts: a.ts + 8 * 60_000 });
    return analyzeTaskCache([a, b]).calls[1].message.text;
  };
  assert.match(mk(ALPHA), /1-hour cache write price/);
  assert.doesNotMatch(mk(AUTO), /1-hour cache write price/);
});
