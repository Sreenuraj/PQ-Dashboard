const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

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
      event_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS task_models (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT,
      model_id TEXT,
      provider_id TEXT,
      mode TEXT,
      ts INTEGER
    );

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
  `);

  // Schema migrations — add new columns to existing tables
  const migrations = [
    'ALTER TABLE events ADD COLUMN request_text TEXT',
    'ALTER TABLE events ADD COLUMN retry_count INTEGER DEFAULT 0',
    'ALTER TABLE events ADD COLUMN context_pct INTEGER',
    'ALTER TABLE events ADD COLUMN response_text TEXT',
  ];
  for (const sql of migrations) {
    try { db.exec(sql); } catch (e) {
      // Column already exists — ignore
    }
  }
}

function isTaskCached(db, taskId, fileHash) {
  const row = db.prepare('SELECT file_hash FROM parse_meta WHERE task_id = ?').get(taskId);
  return row && row.file_hash === fileHash;
}

function saveTask(db, taskId, source, summary, metadata, focusCompletion, events, hasContextReset) {
  const env = metadata.environment || {};
  const status = deriveStatus(events, summary);

  db.prepare(`INSERT OR REPLACE INTO tasks VALUES (
    ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?
  )`).run(
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
    summary.event_count
  );

  // Delete old events for this task (replace)
  db.prepare('DELETE FROM events WHERE task_id = ?').run(taskId);
  db.prepare('DELETE FROM task_models WHERE task_id = ?').run(taskId);

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
}

function markParsed(db, taskId, source, fileHash) {
  db.prepare('INSERT OR REPLACE INTO parse_meta VALUES (?,?,?,?)').run(
    taskId, source, fileHash, Date.now()
  );
}

function deriveStatus(events, summary) {
  const hasCompletion = events.some(e => e.sub_type === 'completion_result' && e.type === 'ask');
  if (hasCompletion) return 'completed';
  const hasResume = events.some(e => e.sub_type === 'resume_task');
  if (hasResume) return 'interrupted';
  if (summary.error_count > 0) return 'error';
  return 'unknown';
}

module.exports = { getDB, isTaskCached, saveTask, markParsed };
