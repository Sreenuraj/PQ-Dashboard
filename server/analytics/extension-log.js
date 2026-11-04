/**
 * Extension-log ingestion.
 *
 * The PostQode extension writes a plain-text "PostQode" output channel (no timestamps) that records, per task:
 *   - every request build:  `[AutoCondense] threshold check: ... previousApiReqIndex=N`
 *       N is the index, inside the task's ui_messages.json, of the PREVIOUS `api_req_started`. It is therefore an
 *       exact join key: the call that follows ui index N is the one being built. Seeing the same N twice in a row
 *       means the request was built twice (first attempt aborted).
 *   - context optimiser decisions: `[ContextOpt] usage=U/W pressure=.. updates=.. saved=.. payoff=.. reverted=..`
 *   - cancellation:  `[TaskCancel] Resume ask failed ...`, `[Task] Failed to present message: ... aborted`
 *   - the owning task:  `INFO [Task <id>] ...`
 *
 * None of this is stored in task files, so we parse the log and keep the facts in `extension_log_events`.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const RE_TASK = /\[Task (\d{10,})\]/;
const RE_BUILD = /\[AutoCondense\] threshold check: .*previousApiReqIndex=(-?\d+)/;
const RE_GATE = /\[AutoCondense\] gate: .*model=(\S+) window=(\d+)/;
const RE_OPT = /\[ContextOpt\] usage=(\d+)\/(\d+) pressure=(\w+) cacheAware=(\w+) skipped=(\w+) updates=(\w+) saved=([\d.]+) payoff=([\d.]+) cappedImages=(\S+) keptForImages=(\w+) truncated=(\w+) reverted=(\w+)/;
const RE_CANCEL = /\[TaskCancel\]/;
const RE_ABORTED = /instance aborted/;
const RE_CONDENSE_START = /\[AutoCondense\].*(?:summariz|condens)\w*/i;

/**
 * @param {string} text   log file contents
 * @param {string} fileKey stable identifier of the log file (used for idempotent storage)
 * @returns {Array<{taskId:string|null, kind:string, detail:object, sourceFile:string, sourceLine:number}>}
 */
function parseExtensionLog(text, fileKey) {
  const events = [];
  let taskId = null;
  let pendingGate = null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const mt = RE_TASK.exec(line);
    if (mt) taskId = mt[1];

    let m;
    if ((m = RE_GATE.exec(line))) {
      pendingGate = { model: m[1], window: Number(m[2]) };
      continue;
    }
    if ((m = RE_BUILD.exec(line))) {
      events.push({
        taskId, kind: 'request_build',
        detail: { previousApiReqIndex: Number(m[1]), ...(pendingGate || {}) },
        sourceFile: fileKey, sourceLine: i + 1,
      });
      pendingGate = null;
      continue;
    }
    if ((m = RE_OPT.exec(line))) {
      events.push({
        taskId, kind: 'context_opt',
        detail: {
          usageTokens: Number(m[1]), budgetTokens: Number(m[2]), pressure: m[3] === 'true', cacheAware: m[4] === 'true',
          skipped: m[5] === 'true', updates: m[6] === 'true', savedUsd: Number(m[7]), payoffUsd: Number(m[8]),
          cappedImages: m[9], keptForImages: m[10] === 'true', truncated: m[11] === 'true', reverted: m[12] === 'true',
        },
        sourceFile: fileKey, sourceLine: i + 1,
      });
      continue;
    }
    if (RE_CANCEL.test(line)) {
      events.push({ taskId, kind: 'task_cancel', detail: { text: line.slice(0, 200) }, sourceFile: fileKey, sourceLine: i + 1 });
      continue;
    }
    if (RE_ABORTED.test(line)) {
      events.push({ taskId, kind: 'task_aborted', detail: { text: line.slice(0, 200) }, sourceFile: fileKey, sourceLine: i + 1 });
      continue;
    }
    if (RE_CONDENSE_START.test(line) && !RE_BUILD.test(line) && !RE_GATE.test(line)) {
      events.push({ taskId, kind: 'condense', detail: { text: line.slice(0, 200) }, sourceFile: fileKey, sourceLine: i + 1 });
    }
  }
  // A cancel/abort line can precede the first "[Task id]" line of the rebuilt task instance:
  // attribute task-less cancel/abort events to the next event that has a task id.
  let nextTask = null;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].taskId) nextTask = events[i].taskId;
    else if (nextTask && (events[i].kind === 'task_cancel' || events[i].kind === 'task_aborted')) events[i].taskId = nextTask;
  }
  return events;
}

/** Directories where VS Code-family editors keep their logs, per platform. */
function defaultLogRoots() {
  const home = os.homedir();
  const names = ['Code - Insiders', 'Code', 'Cursor', 'Windsurf', 'VSCodium'];
  const roots = [];
  if (process.platform === 'darwin') {
    for (const n of names) roots.push(path.join(home, 'Library', 'Application Support', n, 'logs'));
  } else if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
    for (const n of names) roots.push(path.join(appData, n, 'logs'));
  } else {
    for (const n of names) roots.push(path.join(home, '.config', n, 'logs'));
  }
  return roots.filter((r) => fs.existsSync(r));
}

/** Finds PostQode output-channel logs modified in the last `maxAgeDays`. */
function findExtensionLogFiles({ roots = defaultLogRoots(), maxAgeDays = 45 } = {}) {
  const cutoff = Date.now() - maxAgeDays * 86400000;
  const out = [];
  for (const root of roots) {
    let sessions;
    try { sessions = fs.readdirSync(root); } catch { continue; }
    for (const s of sessions) {
      const sdir = path.join(root, s);
      let windows;
      try { windows = fs.readdirSync(sdir).filter((w) => /^window\d+$/.test(w)); } catch { continue; }
      for (const w of windows) {
        const exthost = path.join(sdir, w, 'exthost');
        let chans;
        try { chans = fs.readdirSync(exthost).filter((d) => d.startsWith('output_logging_')); } catch { continue; }
        for (const c of chans) {
          const cdir = path.join(exthost, c);
          let files;
          try { files = fs.readdirSync(cdir).filter((f) => /^\d+-PostQode\.log$/.test(f)); } catch { continue; }
          for (const f of files) {
            const full = path.join(cdir, f);
            let st;
            try { st = fs.statSync(full); } catch { continue; }
            if (st.size > 0 && st.mtimeMs >= cutoff) out.push({ file: full, mtimeMs: st.mtimeMs, size: st.size, key: path.relative(root, full) });
          }
        }
      }
    }
  }
  return out.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

/**
 * Parses every recent log file and stores the events (idempotent via UNIQUE(source_file, source_line)).
 * Events from a still-growing log are re-read each time; the unique key makes that cheap and safe.
 */
function ingestExtensionLogs(db, saveFn, opts = {}) {
  const files = findExtensionLogFiles(opts);
  let parsed = 0;
  let stored = 0;
  for (const f of files) {
    let text;
    try { text = fs.readFileSync(f.file, 'utf8'); } catch { continue; }
    const evs = parseExtensionLog(text, f.key);
    // The log carries no timestamps; the file's mtime bounds the LAST event, which is enough for ordering across files.
    evs.forEach((e) => { e.ts = Math.round(f.mtimeMs); });
    parsed += evs.length;
    stored += saveFn(db, evs);
  }
  return { files: files.length, parsed, stored };
}

module.exports = { parseExtensionLog, findExtensionLogFiles, ingestExtensionLogs, defaultLogRoots };