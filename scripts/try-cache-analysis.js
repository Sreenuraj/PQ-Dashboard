#!/usr/bin/env node
/** Dev helper: run the cache engine on a real task and print the spikes.  node scripts/try-cache-analysis.js <taskId> [--all] */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { analyzeTaskCache } = require('../server/analytics/cache-analysis');
const { parseExtensionLog, findExtensionLogFiles } = require('../server/analytics/extension-log');
const { buildFingerprint } = require('../server/analytics/cache-fingerprint');
const { matchFingerprintsToCalls } = require('../server/analytics/fingerprint-match');

const taskId = process.argv[2];
const all = process.argv.includes('--all');
const dir = path.join(os.homedir(), 'Library/Application Support/Code - Insiders/User/globalStorage/postqode.postqode/tasks', taskId);
const ui = JSON.parse(fs.readFileSync(path.join(dir, 'ui_messages.json'), 'utf8'));

const calls = [];
let lastIdx = -1;
ui.forEach((m, i) => {
  if (m.say !== 'api_req_started' || !m.text) return;
  let j; try { j = JSON.parse(m.text); } catch { return; }
  const between = ui.slice(lastIdx + 1, i).filter((x) => x.type === 'ask' || x.say === 'user_feedback').map((x) => x.ask || x.say);
  calls.push({
    ts: m.ts, modelId: m.modelInfo && m.modelInfo.modelId, providerId: m.modelInfo && m.modelInfo.providerId, mode: m.modelInfo && m.modelInfo.mode,
    tokensIn: j.tokensIn, tokensOut: j.tokensOut, cacheWrites: j.cacheWrites, cacheWrites1h: j.cacheWrite1hTokens || 0, hasField1h: j.cacheWrite1hTokens !== undefined,
    cacheReads: j.cacheReads, cost: j.cost, uiMsgIndex: i, historyIndex: m.conversationHistoryIndex, askEventsBetween: between,
  });
  lastIdx = i;
});

let extLog = [];
for (const f of findExtensionLogFiles()) {
  const evs = parseExtensionLog(fs.readFileSync(f.file, 'utf8'), f.key).filter((e) => e.taskId === taskId);
  extLog = extLog.concat(evs);
}
async function liveFingerprints() {
  const get = async (u) => (await fetch(u)).json();
  const list = (await get('http://localhost:3456/api/network/requests?limit=3000')).requests.filter((r) => r.path.includes('chat/completions'));
  const fps = [];
  for (const r of list) {
    const d = await get('http://localhost:3456/api/network/requests/' + r.id);
    const fp = buildFingerprint(d);
    if (fp) fps.push(fp);
  }
  return fps;
}

(async () => {
const live = process.argv.includes('--live');
const fps = live ? matchFingerprintsToCalls(calls, await liveFingerprints()) : [];
if (live) console.log('matched fingerprints:', fps.filter(Boolean).length, '/', calls.length);
const res = analyzeTaskCache(calls, { extLog, fingerprints: fps });
console.log(`task ${taskId}: ${calls.length} calls, logged $${res.summary.totalLoggedCost.toFixed(3)}, spikes ${res.summary.spikes}, excess ${res.summary.totalExcessCost.toFixed(3)} (${res.summary.excessPct.toFixed(1)}%)`);
console.log('models:', JSON.stringify(res.summary.models.map((m) => ({ id: m.id, src: m.rateSource, ok: `${m.reproduced}/${m.total}` }))));
console.log('1h what-if:', JSON.stringify(res.summary.ttlWhatIf));
console.log('byCause:', JSON.stringify(res.summary.byCause));
const show = res.calls.filter((r) => (all ? true : r.isSpike));
for (const r of show) {
  console.log(`\n#${r.index + 1} state=${r.state} cause=${r.cause} [${r.evidenceLevel}] ttl=${r.ttl}(${r.ttlSource}) gap=${r.gapSec && r.gapSec.toFixed(0)}s read=${(r.readFraction * 100).toFixed(0)}% excess=$${r.excessCost.toFixed(3)} rates=${r.rateSource}`);
  console.log(`   ${r.message.title}: ${r.message.text}`);
}
})();
