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
      agent_sequence_json TEXT,
      parallel_tool_batches INTEGER DEFAULT 0,
      max_parallel_tools INTEGER DEFAULT 0,
      parallel_tool_calls INTEGER DEFAULT 0,
      concurrency_rate REAL DEFAULT 0,
      roundtrips_saved INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS task_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      model_id TEXT,
      provider_id TEXT,
      mode TEXT,
      ts INTEGER
    );

    -- Stores system prompts captured from the proxy for each task (main agent, subagents, and custom agents).
    -- The system prompt is generated in-memory by the extension and is NEVER
    -- written to any task file on disk — this is the only way to persist it.
    CREATE TABLE IF NOT EXISTS task_system_prompts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      captured_at_ts INTEGER,
      model_id TEXT,
      system_text TEXT,
      approx_tokens INTEGER,
      source TEXT DEFAULT 'proxy',
      agent_role TEXT DEFAULT 'main',
      subagent_index INTEGER DEFAULT NULL,
      agent_name TEXT DEFAULT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_task_sysprompt ON task_system_prompts(task_id);

    -- Timeline of physical system RAM, process heap, and token context per turn/worker
    CREATE TABLE IF NOT EXISTS task_memory_timeline (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      turn INTEGER DEFAULT 0,
      ts INTEGER NOT NULL,
      agent_role TEXT DEFAULT 'main',
      subagent_index INTEGER DEFAULT NULL,
      system_ram_used_bytes INTEGER,
      system_ram_total_bytes INTEGER,
      system_ram_pct REAL,
      process_rss_bytes INTEGER,
      process_heap_bytes INTEGER,
      context_tokens INTEGER,
      context_window INTEGER,
      context_pct REAL,
      active_threads INTEGER DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_mem_task ON task_memory_timeline(task_id, ts);

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
      model_switched INTEGER DEFAULT 0,
      is_parallel INTEGER DEFAULT 0,
      parallel_count INTEGER DEFAULT 1,
      parallel_index INTEGER DEFAULT 1,
      parallel_group_id TEXT,
      parallel_tools_json TEXT
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
    // Custom task label
    'ALTER TABLE tasks ADD COLUMN label TEXT',
    // Parallel Tool Execution metrics
    'ALTER TABLE tasks ADD COLUMN parallel_tool_batches INTEGER DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN max_parallel_tools INTEGER DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN parallel_tool_calls INTEGER DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN concurrency_rate REAL DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN roundtrips_saved INTEGER DEFAULT 0',
    'ALTER TABLE events ADD COLUMN is_parallel INTEGER DEFAULT 0',
    'ALTER TABLE events ADD COLUMN parallel_count INTEGER DEFAULT 1',
    'ALTER TABLE events ADD COLUMN parallel_index INTEGER DEFAULT 1',
    'ALTER TABLE events ADD COLUMN parallel_group_id TEXT',
    'ALTER TABLE events ADD COLUMN parallel_tools_json TEXT',
    // Subagents & Custom Agents System Prompt columns
    'ALTER TABLE task_system_prompts ADD COLUMN agent_role TEXT DEFAULT \'main\'',
    'ALTER TABLE task_system_prompts ADD COLUMN subagent_index INTEGER DEFAULT NULL',
    'ALTER TABLE task_system_prompts ADD COLUMN agent_name TEXT DEFAULT NULL',
    // Prompt-cache TTL awareness: 1h portion of cache writes (subset of cache_writes)
    'ALTER TABLE events ADD COLUMN cache_writes_1h INTEGER DEFAULT 0',
    'ALTER TABLE events ADD COLUMN has_cache_1h_field INTEGER DEFAULT 0',
    'ALTER TABLE tasks ADD COLUMN total_cache_writes_1h INTEGER DEFAULT 0',
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (e) {
      // Column already exists — ignore
    }
  }

  // Prompt-cache evidence: one compact fingerprint per LLM request seen by the Network Inspector proxy,
  // plus system/tools texts de-duplicated by hash (so a mid-task prompt change is never lost).
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_request_fingerprints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      captured_ts INTEGER NOT NULL,
      model TEXT,
      served_by TEXT,
      generation_id TEXT,
      prompt_tokens INTEGER,
      cached_tokens INTEGER,
      cache_write_tokens INTEGER,
      completion_tokens INTEGER,
      reported_cost REAL,
      n_messages INTEGER,
      n_tools INTEGER,
      system_hash TEXT,
      tools_hash TEXT,
      agent_label TEXT,
      subagent_index INTEGER,
      fingerprint_json TEXT NOT NULL,
      UNIQUE(generation_id)
    );
    CREATE INDEX IF NOT EXISTS idx_llmfp_task_ts ON llm_request_fingerprints(task_id, captured_ts);
    CREATE INDEX IF NOT EXISTS idx_llmfp_ts ON llm_request_fingerprints(captured_ts);

    CREATE TABLE IF NOT EXISTS llm_prompt_variants (
      hash TEXT NOT NULL,
      kind TEXT NOT NULL,           -- 'system' | 'tools'
      text TEXT NOT NULL,
      first_seen_ts INTEGER,
      PRIMARY KEY (hash, kind)
    );

    -- Extension-log facts (TaskCancel, request rebuilt, ContextOpt) joined to calls by index/timestamp
    CREATE TABLE IF NOT EXISTS extension_log_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      ts INTEGER,
      kind TEXT NOT NULL,           -- 'task_cancel' | 'task_aborted' | 'request_rebuilt' | 'context_opt'
      detail_json TEXT,
      source_file TEXT,
      source_line INTEGER,
      UNIQUE(source_file, source_line)
    );
    CREATE INDEX IF NOT EXISTS idx_extlog_task_ts ON extension_log_events(task_id, ts);
  `);

  // Create composite index for role/worker lookups if missing
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_task_sysprompt_role ON task_system_prompts(task_id, agent_role, subagent_index)');
    db.exec('CREATE INDEX IF NOT EXISTS idx_mem_task ON task_memory_timeline(task_id, ts)');
  } catch (e) {}

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

  // Preserve existing label if task re-parsed
  let existingLabel = null;
  try {
    const row = db.prepare('SELECT label FROM tasks WHERE id = ?').get(taskId);
    if (row && row.label) existingLabel = row.label;
  } catch (e) {}

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
     primary_agent,agent_count,is_multi_agent,agent_sequence_json,label,
     parallel_tool_batches,max_parallel_tools,parallel_tool_calls,concurrency_rate,roundtrips_saved,
     total_cache_writes_1h)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
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
    agentMeta.agent_sequence_json,
    existingLabel,
    summary.parallel_tool_batches || 0,
    summary.max_parallel_tools || 0,
    summary.parallel_tool_calls || 0,
    summary.concurrency_rate || 0,
    summary.roundtrips_saved || 0,
    summary.total_cache_writes_1h || 0
  );

  // Delete old events + related data for this task (replace)
  db.prepare('DELETE FROM events WHERE task_id = ?').run(taskId);
  db.prepare('DELETE FROM task_models WHERE task_id = ?').run(taskId);
  db.prepare('DELETE FROM task_shell_commands WHERE task_id = ?').run(taskId);
  db.prepare('DELETE FROM session_metrics WHERE task_id = ?').run(taskId);

  const insertEvent = db.prepare(`INSERT INTO events 
    (task_id,ts,type,sub_type,tool_name,command_text,error_message,error_category,
     cost,tokens_in,tokens_out,cache_reads,cache_writes,model_id,provider_id,mode,
     reasoning_text,content_preview,model_switched,request_text,retry_count,context_pct,response_text,
     is_parallel,parallel_count,parallel_index,parallel_group_id,parallel_tools_json,
     cache_writes_1h,has_cache_1h_field) 
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

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
        e.response_text || null,
        e.is_parallel ? 1 : 0,
        e.parallel_count || 1,
        e.parallel_index || 1,
        e.parallel_group_id || null,
        e.parallel_tools ? JSON.stringify(e.parallel_tools) : null,
        e.cache_writes_1h || 0,
        e.has_cache_1h_field ? 1 : 0
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

function recordMemorySnapshot(db, s = {}) {
  try {
    const stmt = db.prepare(`
      INSERT INTO task_memory_timeline (
        task_id, turn, ts, agent_role, subagent_index,
        system_ram_used_bytes, system_ram_total_bytes, system_ram_pct,
        process_rss_bytes, process_heap_bytes,
        context_tokens, context_window, context_pct, active_threads
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return stmt.run(
      s.taskId || 'unknown',
      s.turn || 0,
      s.ts || Date.now(),
      s.agentRole || 'main',
      s.subagentIndex || null,
      s.systemRamUsedBytes || null,
      s.systemRamTotalBytes || null,
      s.systemRamPct != null ? s.systemRamPct : null,
      s.processRssBytes || null,
      s.processHeapBytes || null,
      s.contextTokens || null,
      s.contextWindow || null,
      s.contextPct != null ? s.contextPct : null,
      s.activeThreads || 1
    );
  } catch (e) {
    console.warn('[db] recordMemorySnapshot error:', e.message);
  }
}

function getMemoryTimeline(db, taskId) {
  try {
    return db.prepare('SELECT * FROM task_memory_timeline WHERE task_id = ? ORDER BY ts ASC').all(taskId);
  } catch (e) {
    return [];
  }
}

function getTaskSystemPrompts(db, taskId) {
  try {
    return db.prepare('SELECT * FROM task_system_prompts WHERE task_id = ? ORDER BY id ASC').all(taskId);
  } catch (e) {
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt-cache evidence persistence (fingerprints, prompt variants, extension-log events)
// ─────────────────────────────────────────────────────────────────────────────

/** Persists one request fingerprint (and its de-duplicated system/tools texts). Idempotent per generation id. */
function saveRequestFingerprint(db, taskId, fp) {
  if (!fp) return false;
  const { _texts, ...slim } = fp;
  const tx = db.transaction(() => {
    if (_texts) {
      const putVariant = db.prepare('INSERT OR IGNORE INTO llm_prompt_variants (hash, kind, text, first_seen_ts) VALUES (?,?,?,?)');
      if (fp.systemHash && _texts.system) putVariant.run(fp.systemHash, 'system', _texts.system, fp.capturedTs);
      if (fp.toolsHash && _texts.tools) putVariant.run(fp.toolsHash, 'tools', _texts.tools, fp.capturedTs);
    }
    const r = db.prepare(`INSERT OR IGNORE INTO llm_request_fingerprints
      (task_id,captured_ts,model,served_by,generation_id,prompt_tokens,cached_tokens,cache_write_tokens,completion_tokens,
       reported_cost,n_messages,n_tools,system_hash,tools_hash,agent_label,subagent_index,fingerprint_json)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      taskId || null, fp.capturedTs, fp.model, fp.servedBy, fp.generationId,
      fp.promptTokens, fp.cachedTokens, fp.cacheWriteTokens, fp.completionTokens,
      fp.reportedCost, fp.nMessages, fp.nTools, fp.systemHash, fp.toolsHash,
      fp.agentLabel, fp.subagentIndex, JSON.stringify(slim)
    );
    return r.changes > 0;
  });
  return tx();
}

/** Fingerprints for a task, oldest first, with parsed JSON. */
function getRequestFingerprints(db, taskId) {
  try {
    return db.prepare('SELECT id, task_id, captured_ts, fingerprint_json FROM llm_request_fingerprints WHERE task_id = ? ORDER BY captured_ts ASC, id ASC')
      .all(taskId)
      .map((r) => ({ ...JSON.parse(r.fingerprint_json), _id: r.id, _taskId: r.task_id }));
  } catch { return []; }
}

/** Fingerprints (any task) captured inside [fromTs, toTs]. Used to match proxy captures to task calls by token counts. */
function getRequestFingerprintsInWindow(db, fromTs, toTs) {
  try {
    return db.prepare('SELECT id, task_id, captured_ts, fingerprint_json FROM llm_request_fingerprints WHERE captured_ts BETWEEN ? AND ? ORDER BY captured_ts ASC, id ASC')
      .all(fromTs, toTs)
      .map((r) => ({ ...JSON.parse(r.fingerprint_json), _id: r.id }));
  } catch { return []; }
}

function getPromptVariant(db, hash, kind) {
  try { return db.prepare('SELECT text, first_seen_ts FROM llm_prompt_variants WHERE hash = ? AND kind = ?').get(hash, kind) || null; } catch { return null; }
}

function saveExtensionLogEvents(db, events) {
  if (!events || !events.length) return 0;
  const ins = db.prepare('INSERT OR IGNORE INTO extension_log_events (task_id,ts,kind,detail_json,source_file,source_line) VALUES (?,?,?,?,?,?)');
  const tx = db.transaction((list) => {
    let n = 0;
    for (const e of list) n += ins.run(e.taskId || null, e.ts || null, e.kind, e.detail ? JSON.stringify(e.detail) : null, e.sourceFile || null, e.sourceLine == null ? null : e.sourceLine).changes;
    return n;
  });
  return tx(events);
}

function getExtensionLogEvents(db, taskId) {
  try {
    return db.prepare('SELECT ts, kind, detail_json FROM extension_log_events WHERE task_id = ? ORDER BY ts ASC, id ASC').all(taskId)
      .map((r) => ({ ts: r.ts, kind: r.kind, detail: r.detail_json ? JSON.parse(r.detail_json) : null }));
  } catch { return []; }
}

module.exports = {
  saveRequestFingerprint,
  getRequestFingerprints,
  getRequestFingerprintsInWindow,
  getPromptVariant,
  saveExtensionLogEvents,
  getExtensionLogEvents,
  getDB,
  isTaskCached,
  saveTask,
  markParsed,
  recordMemorySnapshot,
  getMemoryTimeline,
  getTaskSystemPrompts,
};