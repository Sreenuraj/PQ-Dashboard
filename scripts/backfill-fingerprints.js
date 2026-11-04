#!/usr/bin/env node
/**
 * Persists the prompt-cache evidence that currently lives only in memory / rotating logs:
 *   1. request fingerprints from a RUNNING dashboard's Network Inspector buffer  (default http://localhost:3456)
 *   2. extension-log events (TaskCancel, request rebuilds, ContextOpt) from the editor's log folders
 *
 *   node scripts/backfill-fingerprints.js [--url http://localhost:3456] [--db ./data/dashboard.db] [--no-logs]
 *
 * New dashboards persist fingerprints automatically as requests flow through the proxy; this is for evidence
 * captured by an older build, or to snapshot the buffer before restarting the server.
 */
const path = require('path');
const { getDB, saveRequestFingerprint, saveExtensionLogEvents } = require('../server/cache/db');
const { buildFingerprint } = require('../server/analytics/cache-fingerprint');
const { ingestExtensionLogs } = require('../server/analytics/extension-log');
const { loadConfig } = require('../server/config');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 && args[i + 1] ? args[i + 1] : d; };

(async () => {
  const cfg = loadConfig();
  const dbPath = path.resolve(opt('--db', (cfg.cache && cfg.cache.db_path) || './data/dashboard.db'));
  const base = opt('--url', 'http://localhost:' + ((cfg.server && cfg.server.port) || 3456));
  const db = getDB(dbPath);
  console.log('db  :', dbPath);

  let saved = 0, seen = 0;
  try {
    const list = (await (await fetch(`${base}/api/network/requests?limit=5000`)).json()).requests || [];
    const chat = list.filter((r) => /chat\/completions|\/messages$|\/responses$/.test(r.path || '') && r.method === 'POST');
    for (const r of chat) {
      const d = await (await fetch(`${base}/api/network/requests/${r.id}`)).json();
      const fp = buildFingerprint(d);
      seen++;
      if (fp && fp.promptTokens != null && saveRequestFingerprint(db, null, fp)) saved++;
    }
    console.log(`proxy buffer @ ${base}: ${seen} LLM requests, ${saved} new fingerprints stored`);
  } catch (e) {
    console.log(`proxy buffer @ ${base}: skipped (${e.message})`);
  }

  if (!args.includes('--no-logs')) {
    const r = ingestExtensionLogs(db, saveExtensionLogEvents);
    console.log(`extension logs: ${r.files} files, ${r.parsed} events parsed, ${r.stored} new stored`);
  }
})();