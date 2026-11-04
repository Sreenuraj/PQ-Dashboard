#!/usr/bin/env node
/**
 * Cost-model verification against every logged API call, using the SAME dynamic price sources as the server
 * (extension cache files + live OpenRouter list) plus per-task calibration.
 *
 * For each (task, model) it reports which stage explains the logged cost:
 *   catalog   - today's catalog price reproduces >=99% of calls
 *   fitted    - rates fitted from the log reproduce >=99% (price changed over time, or model not in any catalog)
 *   unmodeled - neither does (provider-specific billing): the dashboard keeps the logged cost and does no TTL math
 *
 *   node scripts/verify-cache-cost.js [tasksDir] [--offline] [--json out.json]
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { calibrateModel } = require('../server/pricing/calibrate');
const { bootRegistry } = require('./_registry');

const args = process.argv.slice(2);
const optVal = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--json');
const tasksDir = positional[0] ||
  path.join(os.homedir(), 'Library', 'Application Support', 'Code - Insiders', 'User', 'globalStorage', 'postqode.postqode', 'tasks');
const MAX_BYTES = 40 * 1024 * 1024;

(async () => {
  await bootRegistry({ live: !args.includes('--offline') });

  const groups = new Map(); // `${taskId}\u0000${modelId}` -> calls
  let files = 0, skipped = 0;
  for (const id of fs.readdirSync(tasksDir)) {
    const f = path.join(tasksDir, id, 'ui_messages.json');
    let st;
    try { st = fs.statSync(f); } catch { continue; }
    if (st.size > MAX_BYTES) { skipped++; continue; }
    let msgs;
    try { msgs = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { skipped++; continue; }
    files++;
    for (const m of msgs) {
      if (m.say !== 'api_req_started' || !m.text) continue;
      let j; try { j = JSON.parse(m.text); } catch { continue; }
      if (typeof j.cost !== 'number') continue;
      const modelId = (m.modelInfo && m.modelInfo.modelId) || 'unknown';
      const k = id + '\u0000' + modelId;
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push({ tokensIn: j.tokensIn, tokensOut: j.tokensOut, cacheWrites: j.cacheWrites, cacheWrites1h: j.cacheWrite1hTokens || 0, cacheReads: j.cacheReads, cost: j.cost });
    }
  }

  const perModel = new Map();
  let totalCalls = 0;
  for (const [k, calls] of groups) {
    const [taskId, modelId] = k.split('\u0000');
    const cal = calibrateModel(modelId, calls);
    let rec = perModel.get(modelId);
    if (!rec) perModel.set(modelId, (rec = { modelId, tasks: 0, calls: 0, catalog: 0, fitted: 0, unmodeled: 0, inCatalog: cal.catalogKey != null, zero: 0 }));
    rec.tasks++;
    rec.calls += calls.length;
    rec[cal.source] += calls.length;
    rec.zero += calls.filter((c) => c.cost === 0).length;
    totalCalls += calls.length;
  }

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`Scanned ${files} tasks (${skipped} skipped), ${totalCalls} calls, ${perModel.size} models\n`);
  console.log(pad('model (as logged)', 38) + pad('catalog?', 9) + pad('tasks', 6) + pad('calls', 7) + pad('catalog', 9) + pad('fitted', 8) + pad('unmodeled', 10) + 'zero-cost');
  const rows = [...perModel.values()].sort((a, b) => b.calls - a.calls);
  let c = 0, f = 0, u = 0;
  for (const r of rows) {
    c += r.catalog; f += r.fitted; u += r.unmodeled;
    console.log(pad(r.modelId, 38) + pad(r.inCatalog ? 'yes' : 'NO', 9) + pad(r.tasks, 6) + pad(r.calls, 7) + pad(r.catalog, 9) + pad(r.fitted, 8) + pad(r.unmodeled, 10) + r.zero);
  }
  const pct = (n) => (100 * n / Math.max(totalCalls, 1)).toFixed(1) + '%';
  console.log(`\nExplained by today's catalog price : ${c} (${pct(c)})`);
  console.log(`Explained after calibration        : ${f} (${pct(f)})  <- price changed over time, or model not in a catalog`);
  console.log(`Not explainable (logged cost only) : ${u} (${pct(u)})`);
  const out = optVal('--json');
  if (out) fs.writeFileSync(out, JSON.stringify(rows, null, 2));
})();