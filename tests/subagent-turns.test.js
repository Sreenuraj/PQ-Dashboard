const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const { saveSubagentTurns, getSubagentTurns } = require('../server/cache/db');

test('subagent turns table schema and persistence', (t) => {
  // Use in-memory database for isolated self-check
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS task_subagent_turns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      parent_call_idx INTEGER NOT NULL,
      worker_index INTEGER NOT NULL,
      turn_number INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      duration_ms INTEGER,
      model_id TEXT,
      request_size INTEGER DEFAULT 0,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      cache_reads INTEGER DEFAULT 0,
      cache_writes INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      context_tokens INTEGER,
      context_window INTEGER,
      context_pct REAL,
      tool_calls_json TEXT,
      result_preview TEXT,
      UNIQUE(task_id, parent_call_idx, worker_index, turn_number)
    );
  `);

  const mockTurns = [
    {
      taskId: 'task-test-123',
      parentCallIdx: 10,
      workerIndex: 1,
      turnNumber: 1,
      ts: 1793941790000,
      durationMs: 1500,
      modelId: 'claude-sonnet-latest',
      requestSize: 12000,
      tokensIn: 3500,
      tokensOut: 120,
      cacheReads: 2000,
      cacheWrites: 500,
      cost: 0.015,
      contextTokens: 3620,
      contextWindow: 1000000,
      contextPct: 0.362,
      tools: [{ name: 'read_file', arguments: { path: 'test.md' } }],
      resultPreview: 'Reading test.md',
    },
    {
      taskId: 'task-test-123',
      parentCallIdx: 10,
      workerIndex: 1,
      turnNumber: 2,
      ts: 1793941792000,
      durationMs: 2200,
      modelId: 'claude-sonnet-latest',
      requestSize: 15000,
      tokensIn: 4500,
      tokensOut: 200,
      cacheReads: 3500,
      cacheWrites: 0,
      cost: 0.022,
      contextTokens: 4700,
      contextWindow: 1000000,
      contextPct: 0.47,
      tools: [{ name: 'execute_command', arguments: { command: 'git status' } }],
      resultPreview: 'Executed git status',
    },
    {
      taskId: 'task-test-123',
      parentCallIdx: 10,
      workerIndex: 2,
      turnNumber: 1,
      ts: 1793941791000,
      durationMs: 1800,
      modelId: 'claude-sonnet-latest',
      requestSize: 11000,
      tokensIn: 3100,
      tokensOut: 90,
      cacheReads: 1500,
      cacheWrites: 0,
      cost: 0.012,
      contextTokens: 3190,
      contextWindow: 1000000,
      contextPct: 0.319,
      tools: [{ name: 'list_files', arguments: { path: 'src/' } }],
      resultPreview: 'Listing src directory',
    },
  ];

  // 1. Save turns
  const count = saveSubagentTurns(db, mockTurns);
  assert.strictEqual(count, 3, 'Should insert 3 subagent turns');

  // 2. Fetch turns for task
  const allSaved = getSubagentTurns(db, 'task-test-123');
  assert.strictEqual(allSaved.length, 3, 'Should retrieve 3 turns');
  assert.strictEqual(allSaved[0].turn, 1);
  assert.strictEqual(allSaved[0].tools[0].name, 'read_file');
  assert.strictEqual(allSaved[0].tools[0].arguments.path, 'test.md');

  // 3. Filter by parent call idx
  const call10Turns = getSubagentTurns(db, 'task-test-123', 10);
  assert.strictEqual(call10Turns.length, 3);
  const call50Turns = getSubagentTurns(db, 'task-test-123', 50);
  assert.strictEqual(call50Turns.length, 0);

  // 4. Idempotency test (INSERT OR REPLACE)
  const count2 = saveSubagentTurns(db, mockTurns);
  assert.strictEqual(count2, 3);
  const afterReinsert = getSubagentTurns(db, 'task-test-123');
  assert.strictEqual(afterReinsert.length, 3, 'Should not create duplicate rows on re-insert');
});

