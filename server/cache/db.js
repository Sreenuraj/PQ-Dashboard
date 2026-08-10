const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { computeSessionMetrics } = require('../analytics/metrics');

let db;

function getDB(dbPath) {
  if (db) return db;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  initSchema(db);
  return db;
}

function initSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      source TEXT,
      start_ts INTEGER,
      end_ts INTEGER,
      duration INTEGER,
      total_cost REAL DEFAULT 0,
      total_tokens_in INTEGER DEFAULT 0,
      total_tokens_out INTEGER DEFAULT 0,
      total_cache_reads INTEGER DEFAULT 0,
      total_cache_writes INTEGER DEFAULT 0,
      error_count INTEGER DEFAULT 0,
      tool_call_count INTEGER DEFAULT 0,
      api_call_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'unknown',
      has_reasoning INTEGER DEFAULT 0,
      has_context_reset INTEGER DEFAULT 0,
      first_message TEXT,
      focus_chain_completion REAL,
      environment TEXT,
      pq_version TEXT,
      event_count INTEGER DEFAULT 0,
      activity_category TEXT DEFAULT 'general',
      edit_turns INTEGER DEFAULT 0,
      oneshot_turns INTEGER DEFAULT 0,
      retry_cycles INTEGER DEFAULT 0,
      shell_command_count INTEGER DEFAULT 0,
      -- Phase 4: agent context (computed by parser; display name is "Agent")
      primary_agent TEXT,
      agent_count INTEGER DEFAULT 0,
      is_multi_agent INTEGER DEFAULT 0,
      agent_sequence_json TEXT
    );

    CREATE TABLE IF NOT EXISTS task_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      model_id TEXT,
      provider_id TEXT,
      mode TEXT,
      ts INTEGER
    );

    -- Stores system prompts captured from the proxy for each task.
    -- The system prompt is generated in-memory by the extension and is NEVER
    -- written to any task file on disk — this is the only way to persist it.
    -- One canonical row per task (INSERT OR IGNORE on first capture).
    CREATE TABLE IF NOT EXISTS task_system_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      captured_at_ts INTEGER,
      model_id TEXT,
      system_text TEXT,
      approx_tokens INTEGER,
      source TEXT DEFAULT 'proxy'
    );
    CREATE INDEX IF NOT EXISTS idx_task_sysprompt ON task_system_prompts(task_id);

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      ts INTEGER,
      type TEXT,
      sub_type TEXT,
      tool_name TEXT,
      command_text TEXT,
      error_message TEXT,
      error_category TEXT,
      cost REAL,
      tokens_in INTEGER,
      tokens_out INTEGER,
      cache_reads INTEGER,
      cache_writes INTEGER,
      model_id TEXT,
      provider_id TEXT,
      mode TEXT,
      reasoning_text TEXT,
      content_preview TEXT,
      model_switched INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS parse_meta (
      task_id TEXT PRIMARY KEY,
      source TEXT,
      file_hash TEXT,
      parsed_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id);
    CREATE INDEX IF NOT EXISTS idx_events_subtype ON events(sub_type);
    CREATE INDEX IF NOT EXISTS idx_events_error ON events(error_category);
    CREATE INDEX IF NOT EXISTS idx_tasks_start ON tasks(start_ts DESC);
    CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(source);
    CREATE INDEX IF NOT EXISTS idx_task_models_model ON task_models(model_id);
    -- Phase 4: agent context indexes
    CREATE INDEX IF NOT EXISTS idx_task_models_mode ON task_models(mode);
    CREATE INDEX IF NOT EXISTS idx_events_mode      ON events(mode);
    CREATE INDEX IF NOT EXISTS idx_tasks_primary_agent ON tasks(primary_agent);
    CREATE INDEX IF NOT EXISTS idx_tasks_multi_agent ON tasks(is_multi_agent);

    CREATE TABLE IF NOT EXISTS baselines (
      id TEXT PRIMARY KEY,
      source_task_id TEXT NOT NULL,
      name TEXT,
      description TEXT,
      tags TEXT,
      model_id TEXT,
      source TEXT,
      activity_category TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      prompts_json TEXT,
      expected_tools_json TEXT,
      excluded_tools_json TEXT,
      excluded_files_json TEXT,
      tool_sequence_json TEXT,
      behavior_contract_json TEXT,
      reference_metrics_json TEXT,
      contributing_sessions_json TEXT,
      failed_tools_json TEXT,
      completion_message TEXT,
      FOREIGN KEY (source_task_id) REFERENCES tasks(id)
    );

    CREATE INDEX IF NOT EXISTS idx_baselines_category ON baselines(activity_category);
    CREATE INDEX IF NOT EXISTS idx_baselines_model ON baselines(model_id);

    CREATE TABLE IF NOT EXISTS test_results (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      baseline_id TEXT,
      model_id TEXT,
      model_version TEXT,
      run_ts INTEGER NOT NULL,
      overall_score INTEGER,
      tia_status TEXT,
      tia_score INTEGER,
      tia_evidence_json TEXT,
      bcv_status TEXT,
      bcv_score INTEGER,
      bcv_evidence_json TEXT,
      mtv_status TEXT,
      mtv_score INTEGER,
      mtv_evidence_json TEXT,
      bse_status TEXT,
      bse_score INTEGER,
      bse_evidence_json TEXT,
      erc_status TEXT,
      erc_score INTEGER,
      erc_evidence_json TEXT,
      cec_status TEXT,
      cec_score INTEGER,
      cec_evidence_json TEXT,
      task_cost REAL,
      task_duration INTEGER,
      task_tokens_in INTEGER,
      task_tokens_out INTEGER,
      task_errors INTEGER,
      task_status TEXT,
      user_rating INTEGER,
      completion_message TEXT,
      interruption_count INTEGER DEFAULT 0,
      FOREIGN KEY (task_id) REFERENCES tasks(id),
      FOREIGN KEY (baseline_id) REFERENCES baselines(id)
    );

    CREATE INDEX IF NOT EXISTS idx_test_results_task ON test_results(task_id);
    CREATE INDEX IF NOT EXISTS idx_test_results_baseline ON test_results(baseline_id);
    CREATE INDEX IF NOT EXISTS idx_test_results_model ON test_results(model_id);
    CREATE INDEX IF NOT EXISTS idx_test_results_ts ON test_results(run_ts DESC);
  `);

  // Schema migrations — add new columns to existing tables
  const migrations = [
    'ALTER TABLE events ADD COLUMN request_text TEXT',
    'ALTER TABLE events ADD COLUMN retry_count INTEGER DEFAULT 0',
    'ALTER TABLE events ADD COLUMN context_pct INTEGER',
    'ALTER TABLE events ADD COLUMN response_text TEXT',
    // CodeBurn-inspired activity classification
    'ALTER TABLE tasks ADD COLUMN activity_category TEXT DEFAULT \'general\'',
    'ALTER TABLE tasks ADD COLUMN edit_turns INTEGER DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN oneshot_turns INTEGER DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN retry_cycles INTEGER DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN shell_command_count INTEGER DEFAULT 0',
    // Phase 3: Excluded files for baseline scope enforcement
    'ALTER TABLE baselines ADD COLUMN excluded_files_json TEXT',
    // Phase 4: agent context (additive; safe to run on existing DBs)
    'ALTER TABLE tasks ADD COLUMN primary_agent TEXT',
    'ALTER TABLE tasks ADD COLUMN agent_count INTEGER DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN is_multi_agent INTEGER DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN agent_sequence_json TEXT',
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (e) {
      // Column already exists — ignore
    }
  }

  // Shell commands frequency table
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_shell_commands (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      command_base TEXT,
      count INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_shell_cmd_task ON task_shell_commands(task_id);
    CREATE INDEX IF NOT EXISTS idx_shell_cmd_base ON task_shell_commands(command_base);
  `);

  // Phase 4: per-session heuristic metric cache (TUE/RD/CE/ERR)
  // Populated by the parser at insert time; consumed by /api/analytics/models
  // for cheap per-model rollups.
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_metrics (
      task_id TEXT PRIMARY KEY,
      tue INTEGER,
      rd  INTEGER,
      ce  INTEGER,
      err INTEGER,
      computed_at INTEGER,
      FOREIGN KEY (task_id) REFERENCES tasks(id)
    );
    CREATE INDEX IF NOT EXISTS idx_session_metrics_tue ON session_metrics(tue);
    CREATE INDEX IF NOT EXISTS idx_session_metrics_ce  ON session_metrics(ce);
  `);
}

function isTaskCached(db, taskId, fileHash) {
  const row = db.prepare('SELECT file_hash FROM parse_meta WHERE task_id = ?').get(taskId);
  return row && row.file_hash === fileHash;
}

function saveTask(db, taskId, source, summary, metadata, focusCompletion, events, hasContextReset, classification) {
  const env = metadata.environment || {};
  const status = deriveStatus(events, summary);
  const cls = classification || { category: 'general', editTurns: 0, oneShotTurns: 0, retryCycles: 0, shellCommands: {} };

  // Phase 4: compute denormalized agent context + per-session heuristic metrics.
  // The events are still in the input array at this point; once we insert them
  // we could re-query, but doing it inline avoids a second pass.
  const agentMeta = buildAgentMeta(events, metadata);
  const taskForMetrics = {
    error_count: summary.error_count,
    status,
  };
  const metrics = computeSessionMetrics(taskForMetrics, events);

  db.prepare(`INSERT OR REPLACE INTO tasks
    (id,source,start_ts,end_ts,duration,total_cost,total_tokens_in,total_tokens_out,
     total_cache_reads,total_cache_writes,error_count,tool_call_count,api_call_count,
     status,has_reasoning,has_context_reset,first_message,focus_chain_completion,
     environment,pq_version,event_count,
     activity_category,edit_turns,oneshot_turns,retry_cycles,shell_command_count,
     primary_agent,agent_count,is_multi_agent,agent_sequence_json)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    taskId, source,
    summary.first_ts, summary.last_ts, summary.duration,
    summary.total_cost, summary.total_tokens_in, summary.total_tokens_out,
    summary.total_cache_reads, summary.total_cache_writes,
    summary.error_count, summary.tool_call_count, summary.api_call_count,
    status,
    summary.has_reasoning ? 1 : 0,
    hasContextReset ? 1 : 0,
    summary.first_message,
    focusCompletion,
    JSON.stringify(env),
    env.pq_version || null,
    summary.event_count,
    cls.category,
    cls.editTurns,
    cls.oneShotTurns,
    cls.retryCycles,
    Object.values(cls.shellCommands).reduce((s, v) => s + v, 0),
    agentMeta.primary_agent,
    agentMeta.agent_count,
    agentMeta.is_multi_agent,
    agentMeta.agent_sequence_json
  );

  // Delete old events + related data for this task (replace)
  db.prepare('DELETE FROM events WHERE task_id = ?').run(taskId);
  db.prepare('DELETE FROM task_models WHERE task_id = ?').run(taskId);
  db.prepare('DELETE FROM task_shell_commands WHERE task_id = ?').run(taskId);
  db.prepare('DELETE FROM session_metrics WHERE task_id = ?').run(taskId);

  const insertEvent = db.prepare(`INSERT INTO events 
    (task_id,ts,type,sub_type,tool_name,command_text,error_message,error_category,
     cost,tokens_in,tokens_out,cache_reads,cache_writes,model_id,provider_id,mode,
     reasoning_text,content_preview,model_switched,request_text,retry_count,context_pct,response_text) 
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const insertEventBatch = db.transaction((events) => {
    for (const e of events) {
      insertEvent.run(
        taskId, e.ts, e.type, e.sub_type,
        e.tool_name, e.command_text, e.error_message, e.error_category,
        e.cost, e.tokens_in, e.tokens_out, e.cache_reads, e.cache_writes,
        e.model_id, e.provider_id, e.mode,
        e.reasoning_text, e.content_preview,
        e.model_switched ? 1 : 0,
        e.request_text || null,
        e.retry_count || 0,
        e.context_pct != null ? e.context_pct : null,
        e.response_text || null
      );
    }
  });
  insertEventBatch(events);

  // Shell commands
  if (cls.shellCommands && Object.keys(cls.shellCommands).length > 0) {
    const insertCmd = db.prepare('INSERT INTO task_shell_commands (task_id, command_base, count) VALUES (?,?,?)');
    const insertCmdBatch = db.transaction((cmds) => {
      for (const [base, count] of Object.entries(cmds)) {
        insertCmd.run(taskId, base, count);
      }
    });
    insertCmdBatch(cls.shellCommands);
  }

  // Task models
  const insertModel = db.prepare(`INSERT INTO task_models (task_id,model_id,provider_id,mode,ts) VALUES (?,?,?,?,?)`);
  const modelSeen = new Set();
  for (const m of (metadata.models || [])) {
    const key = `${m.model_id}::${m.mode}`;
    if (!modelSeen.has(key)) {
      modelSeen.add(key);
      insertModel.run(taskId, m.model_id, m.provider_id, m.mode, m.ts);
    }
  }

  // Phase 4: cache the 4 heuristic metric scores for cheap per-model rollups
  db.prepare(`INSERT OR REPLACE INTO session_metrics
    (task_id, tue, rd, ce, err, computed_at)
    VALUES (?,?,?,?,?,?)`).run(
      taskId,
      metrics.tue, metrics.rd, metrics.ce, metrics.err,
      Date.now()
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4: buildAgentMeta
//
// Computes the denormalized agent context for a task:
//   • primary_agent       — mode with the most events; tie-break by first appearance
//   • agent_count         — number of distinct modes
//   • is_multi_agent      — 1 if agent_count > 1
//   • agent_sequence_json — JSON array of phases, in first-appearance order.
//
// PHASE SEMANTICS (important for the UI):
//   Adjacent entries with the SAME (agent, model_id) are merged into one phase
//   (their ts range is widened). This treats model switches within a mode as
//   a single phase, while preserving re-entries of the same mode with a
//   different model as separate phases (verified against real task
//   1778148395003 which has [web_agent, plan(opus), plan(kimi), agent]).
//
// All percentages/counts are computed from the per-mode event stats so the
// agent_sequence_json can be rendered directly without re-querying.
// ─────────────────────────────────────────────────────────────────────────────
function buildAgentMeta(events, metadata) {
  const usage = (metadata?.models || []).slice().sort((a, b) => (a.ts || 0) - (b.ts || 0));
  const phases = usage.filter(u => u.mode).map((u, idx) => {
    const nextUsage = usage.slice(idx + 1).find(next => next.mode);
    const ts_first = u.ts;
    const ts_last = nextUsage ? nextUsage.ts : (events && events.length ? Math.max(...events.map(e => e.ts)) : u.ts);
    return {
      agent: u.mode,
      model_id: u.model_id,
      ts_first,
      ts_last,
    };
  });
  const merged = [];
  for (const p of phases) {
    const last = merged[merged.length - 1];
    if (last && last.agent === p.agent && last.model_id === p.model_id) {
      last.ts_last = p.ts_last;
    } else {
      merged.push({ ...p });
    }
  }

  // Per-mode event stats (filter out system events that have no mode)
  const eventStats = new Map();
  for (const e of (events || [])) {
    if (!e.mode) continue;
    const cur = eventStats.get(e.mode) || { event_count: 0, cost: 0 };
    cur.event_count += 1;
    cur.cost += e.cost || 0;
    eventStats.set(e.mode, cur);
  }
  for (const ph of merged) {
    const s = eventStats.get(ph.agent);
    ph.event_count = s?.event_count || 0;
    ph.cost = s?.cost || 0;
  }

  const distinctAgents = new Set(merged.map(p => p.agent));
  const primary = merged
    .slice()
    .sort((a, b) => (b.event_count - a.event_count) || ((a.ts_first || 0) - (b.ts_first || 0)))[0]?.agent || null;

  return {
    primary_agent: primary,
    agent_count: distinctAgents.size,
    is_multi_agent: distinctAgents.size > 1 ? 1 : 0,
    agent_sequence_json: merged.length ? JSON.stringify(merged) : null,
  };
}

function markParsed(db, taskId, source, fileHash) {
  db.prepare('INSERT OR REPLACE INTO parse_meta VALUES (?,?,?,?)').run(
    taskId, source, fileHash, Date.now()
  );
}

function deriveStatus(events, summary) {
  const hasCompletion = events.some(e => e.sub_type === 'completion_result' && (e.type === 'ask' || e.type === 'say'));
  if (hasCompletion) return 'completed';
  const hasResume = events.some(e => e.sub_type === 'resume_task');
  if (hasResume) return 'interrupted';
  if (summary.error_count > 0) return 'error';
  return 'unknown';
}

module.exports = { getDB, isTaskCached, saveTask, markParsed };
