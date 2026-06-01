const express = require('express');
const { extractBenchmarkSet } = require('../baselines/extract');

module.exports = (db) => {
  const router = express.Router();

  router.get('/', (req, res) => {
    const conditions = [];
    const params = [];
    if (req.query.category) { conditions.push('activity_category = ?'); params.push(req.query.category); }
    if (req.query.model) { conditions.push('model_id = ?'); params.push(req.query.model); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = db.prepare(`SELECT * FROM baselines ${where} ORDER BY created_at DESC`).all(...params).map(parseBaseline);
    res.json({ baselines: rows });
  });

  router.get('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM baselines WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Baseline not found' });
    res.json(parseBaseline(row));
  });

  router.get('/:id/prompts', (req, res) => {
    const row = db.prepare('SELECT id, prompts_json FROM baselines WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Baseline not found' });
    res.json({ baseline_id: row.id, prompts: parse(row.prompts_json, []) });
  });

  router.post('/', (req, res) => {
    const { task_id, name, tags = [] } = req.body || {};
    if (!task_id) return res.status(400).json({ error: 'task_id is required' });
    const task = loadTask(task_id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (task.status !== 'completed') return res.status(400).json({ error: 'Only completed tasks can be baselines' });
    const baseline = saveBaseline(task, name, tags);
    res.status(201).json(baseline);
  });

  router.put('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM baselines WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Baseline not found' });
    const name = req.body.name ?? row.name;
    const tags = req.body.tags ?? parse(row.tags, []);
    db.prepare('UPDATE baselines SET name = ?, tags = ? WHERE id = ?').run(name, JSON.stringify(tags), req.params.id);
    res.json(parseBaseline(db.prepare('SELECT * FROM baselines WHERE id = ?').get(req.params.id)));
  });

  router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM baselines WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  router.post('/:id/re-extract', (req, res) => {
    const row = db.prepare('SELECT * FROM baselines WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Baseline not found' });
    const task = loadTask(row.task_id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    res.json(saveBaseline(task, row.name, parse(row.tags, [])));
  });

  function loadTask(id) {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!task) return null;
    task.models = db.prepare('SELECT DISTINCT model_id, provider_id, mode FROM task_models WHERE task_id = ?').all(id);
    return task;
  }

  function saveBaseline(task, name, tags) {
    const events = db.prepare('SELECT * FROM events WHERE task_id = ? ORDER BY ts ASC').all(task.id);
    const benchmark = extractBenchmarkSet(task, events);
    const model = task.models?.[0]?.model_id || null;
    db.prepare(`
      INSERT OR REPLACE INTO baselines (
        id, task_id, name, tags, model_id, source, activity_category, created_at,
        prompts_json, expected_tools_json, tool_sequence_json, behavior_contract_json, reference_metrics_json
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      task.id, task.id, name || defaultName(task), JSON.stringify(tags || []), model, task.source,
      task.activity_category, Date.now(), JSON.stringify(benchmark.prompts),
      JSON.stringify(benchmark.expected_tools), JSON.stringify(benchmark.tool_sequence),
      JSON.stringify(benchmark.behavior_contract), JSON.stringify(benchmark.reference_metrics)
    );
    return parseBaseline(db.prepare('SELECT * FROM baselines WHERE id = ?').get(task.id));
  }

  return router;
};

function parseBaseline(row) {
  return {
    ...row,
    tags: parse(row.tags, []),
    prompts: parse(row.prompts_json, []),
    expected_tools: parse(row.expected_tools_json, []),
    tool_sequence: parse(row.tool_sequence_json, []),
    behavior_contract: parse(row.behavior_contract_json, {}),
    reference_metrics: parse(row.reference_metrics_json, {}),
  };
}

function defaultName(task) {
  const prompt = (task.first_message || task.id).replace(/\s+/g, ' ').trim();
  return prompt.length > 64 ? `${prompt.slice(0, 64)}...` : prompt;
}

function parse(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}
