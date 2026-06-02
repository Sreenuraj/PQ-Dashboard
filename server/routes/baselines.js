const express = require('express');
const crypto = require('crypto');
const { extractBenchmarkSet } = require('../baselines/extract');
const { extractFailedTools } = require('../baselines/failed-tools');
const { describeToolCall } = require('../baselines/tool-descriptions');
const { toolEvents, parseToolTarget, getFinalOutput } = require('../testing/shared');

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

  // Phase 2: Create baseline from any session (not just completed)
  router.post('/', (req, res) => {
    const { task_id, name, description, tags = [] } = req.body || {};
    if (!task_id) return res.status(400).json({ error: 'task_id is required' });
    const task = loadTask(task_id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    // Phase 2: Allow any session status — removed completed-only restriction
    const baseline = saveBaseline(task, name, description, tags);
    res.status(201).json(baseline);
  });

  // Phase 2: Enhanced PUT — can update tools, keywords, descriptions, etc.
  router.put('/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM baselines WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Baseline not found' });

    const updates = {};
    if (req.body.name !== undefined) updates.name = req.body.name;
    if (req.body.description !== undefined) updates.description = req.body.description;
    if (req.body.tags !== undefined) updates.tags = JSON.stringify(req.body.tags);
    if (req.body.expected_tools !== undefined) updates.expected_tools_json = JSON.stringify(req.body.expected_tools);
    if (req.body.excluded_tools !== undefined) updates.excluded_tools_json = JSON.stringify(req.body.excluded_tools);
    if (req.body.tool_sequence !== undefined) updates.tool_sequence_json = JSON.stringify(req.body.tool_sequence);
    if (req.body.behavior_contract !== undefined) updates.behavior_contract_json = JSON.stringify(req.body.behavior_contract);

    if (Object.keys(updates).length === 0) {
      return res.json(parseBaseline(row));
    }

    updates.updated_at = Date.now();
    const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = [...Object.values(updates), req.params.id];
    db.prepare(`UPDATE baselines SET ${setClauses} WHERE id = ?`).run(...values);
    res.json(parseBaseline(db.prepare('SELECT * FROM baselines WHERE id = ?').get(req.params.id)));
  });

  router.delete('/:id', (req, res) => {
    const deleteTx = db.transaction((id) => {
      db.prepare('DELETE FROM test_results WHERE baseline_id = ?').run(id);
      db.prepare('DELETE FROM baselines WHERE id = ?').run(id);
    });
    deleteTx(req.params.id);
    res.json({ ok: true });
  });

  // Phase 2: Re-extract benchmark data from source session
  router.post('/:id/re-extract', (req, res) => {
    const row = db.prepare('SELECT * FROM baselines WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Baseline not found' });
    const task = loadTask(row.source_task_id);
    if (!task) return res.status(404).json({ error: 'Source task not found' });
    const events = db.prepare('SELECT * FROM events WHERE task_id = ? ORDER BY ts ASC').all(task.id);
    const benchmark = extractBenchmarkSet(task, events);
    const now = Date.now();
    db.prepare(`
      UPDATE baselines SET
        prompts_json = ?, expected_tools_json = ?, tool_sequence_json = ?,
        behavior_contract_json = ?, reference_metrics_json = ?,
        failed_tools_json = ?, completion_message = ?, updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(benchmark.prompts), JSON.stringify(benchmark.expected_tools),
      JSON.stringify(benchmark.tool_sequence), JSON.stringify(benchmark.behavior_contract),
      JSON.stringify(benchmark.reference_metrics), JSON.stringify(benchmark.failed_tools),
      benchmark.completion_message, now, req.params.id
    );
    res.json(parseBaseline(db.prepare('SELECT * FROM baselines WHERE id = ?').get(req.params.id)));
  });

  // Phase 2: Enrich baseline — analyze a session and return diff
  router.post('/:id/enrich', (req, res) => {
    const row = db.prepare('SELECT * FROM baselines WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Baseline not found' });
    const { session_id } = req.body || {};
    if (!session_id) return res.status(400).json({ error: 'session_id is required' });
    const task = loadTask(session_id);
    if (!task) return res.status(404).json({ error: 'Session not found' });

    const events = db.prepare('SELECT * FROM events WHERE task_id = ? ORDER BY ts ASC').all(session_id);
    const sessionTools = [...new Set(toolEvents(events).map(e => e.tool_name))];
    const sessionOutput = getFinalOutput(events);
    const sessionKeywords = topKeywords(sessionOutput, 20);
    const sessionFailed = extractFailedTools(events);

    const baseline = parseBaseline(row);
    const existingTools = new Set([...(baseline.expected_tools || []), ...(baseline.excluded_tools || [])]);
    const existingKeywords = new Set([
      ...(baseline.behavior_contract?.output_keywords || []),
      ...(baseline.behavior_contract?.excluded_keywords || []),
    ]);

    const newTools = sessionTools.filter(t => !existingTools.has(t)).map(t => {
      const count = toolEvents(events).filter(e => e.tool_name === t).length;
      return { tool_name: t, count };
    });

    const newKeywords = sessionKeywords.filter(k => !existingKeywords.has(k)).map(k => {
      const count = (sessionOutput.toLowerCase().match(new RegExp(k, 'g')) || []).length;
      return { keyword: k, count };
    });

    res.json({
      session_id,
      session_model: task.models?.[0]?.model_id || null,
      session_duration: task.duration,
      new_tools: newTools,
      new_keywords: newKeywords,
      failed_tools: sessionFailed,
      baseline_id: req.params.id,
    });
  });

  // Phase 2: Merge enrichment into baseline
  router.put('/:id/merge', (req, res) => {
    const row = db.prepare('SELECT * FROM baselines WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Baseline not found' });

    const { tools_to_add = [], tools_to_exclude = [], keywords_to_add = [], keywords_to_exclude = [], session_id } = req.body || {};
    const baseline = parseBaseline(row);

    // Merge tools
    const expectedTools = [...new Set([...(baseline.expected_tools || []), ...tools_to_add])];
    const excludedTools = [...new Set([...(baseline.excluded_tools || []), ...tools_to_exclude])];
    // Remove from expected if added to excluded
    const finalExpected = expectedTools.filter(t => !excludedTools.includes(t));

    // Merge keywords
    const contract = baseline.behavior_contract || {};
    const outputKeywords = [...new Set([...(contract.output_keywords || []), ...keywords_to_add])];
    const excludedKeywords = [...new Set([...(contract.excluded_keywords || []), ...keywords_to_exclude])];
    const finalKeywords = outputKeywords.filter(k => !excludedKeywords.includes(k));

    const updatedContract = { ...contract, output_keywords: finalKeywords, excluded_keywords: excludedKeywords };

    // Track contributing sessions
    const sessions = [...new Set([...(baseline.contributing_sessions || []), session_id].filter(Boolean))];

    const now = Date.now();
    db.prepare(`
      UPDATE baselines SET
        expected_tools_json = ?, excluded_tools_json = ?,
        behavior_contract_json = ?, contributing_sessions_json = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      JSON.stringify(finalExpected), JSON.stringify(excludedTools),
      JSON.stringify(updatedContract), JSON.stringify(sessions),
      now, req.params.id
    );

    res.json(parseBaseline(db.prepare('SELECT * FROM baselines WHERE id = ?').get(req.params.id)));
  });

  function loadTask(id) {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    if (!task) return null;
    task.models = db.prepare('SELECT DISTINCT model_id, provider_id, mode FROM task_models WHERE task_id = ?').all(id);
    return task;
  }

  function saveBaseline(task, name, description, tags) {
    const events = db.prepare('SELECT * FROM events WHERE task_id = ? ORDER BY ts ASC').all(task.id);
    const benchmark = extractBenchmarkSet(task, events);
    const model = task.models?.[0]?.model_id || null;
    const id = crypto.randomUUID();  // Phase 2: independent UUID
    const now = Date.now();
    db.prepare(`
      INSERT INTO baselines (
        id, source_task_id, name, description, tags, model_id, source, activity_category,
        created_at, updated_at, prompts_json, expected_tools_json, excluded_tools_json,
        tool_sequence_json, behavior_contract_json, reference_metrics_json,
        contributing_sessions_json, failed_tools_json, completion_message
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      id, task.id, name || defaultName(task), description || '', JSON.stringify(tags || []),
      model, task.source, task.activity_category, now, now,
      JSON.stringify(benchmark.prompts), JSON.stringify(benchmark.expected_tools),
      JSON.stringify(benchmark.excluded_tools), JSON.stringify(benchmark.tool_sequence),
      JSON.stringify(benchmark.behavior_contract), JSON.stringify(benchmark.reference_metrics),
      JSON.stringify([task.id]),  // Source session as first contributor
      JSON.stringify(benchmark.failed_tools), benchmark.completion_message
    );
    return parseBaseline(db.prepare('SELECT * FROM baselines WHERE id = ?').get(id));
  }

  return router;
};

function parseBaseline(row) {
  return {
    ...row,
    tags: parse(row.tags, []),
    prompts: parse(row.prompts_json, []),
    expected_tools: parse(row.expected_tools_json, []),
    excluded_tools: parse(row.excluded_tools_json, []),
    tool_sequence: parse(row.tool_sequence_json, []),
    behavior_contract: parse(row.behavior_contract_json, {}),
    reference_metrics: parse(row.reference_metrics_json, {}),
    contributing_sessions: parse(row.contributing_sessions_json, []),
    failed_tools: parse(row.failed_tools_json, []),
  };
}

function topKeywords(text, limit) {
  const stop = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'your', 'have', 'will', 'are', 'was', 'were', 'you', 'not']);
  const counts = new Map();
  String(text || '').toLowerCase().match(/[a-z][a-z0-9_]{3,}/g)?.forEach(word => {
    if (!stop.has(word)) counts.set(word, (counts.get(word) || 0) + 1);
  });
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([word]) => word);
}

function defaultName(task) {
  const prompt = (task.first_message || task.id).replace(/\s+/g, ' ').trim();
  return prompt.length > 64 ? `${prompt.slice(0, 64)}...` : prompt;
}

function parse(value, fallback) {
  try { return value ? JSON.parse(value) : fallback; } catch { return fallback; }
}
