const express = require('express');
const router = express.Router();
const { runTestSuite, getBaseline } = require('../testing');
const { computeSessionMetrics } = require('../analytics/metrics');

module.exports = (db) => {

  // POST /api/tasks/compare — comparison payload with optional behavioral tests
  router.post('/compare', (req, res) => {
    const { task_ids = [], baseline_id = null, include_tests = false } = req.body || {};
    if (!Array.isArray(task_ids) || task_ids.length === 0) {
      return res.status(400).json({ error: 'task_ids must be a non-empty array' });
    }

    const inferredBaselineId = baseline_id || inferBaselineId(task_ids);

    let resolvedBaselineTaskId = null;
    let resolvedBaselineUUID = null;
    let baselineRow = null;

    if (inferredBaselineId) {
      // Check if it is a baseline UUID
      baselineRow = db.prepare('SELECT * FROM baselines WHERE id = ?').get(inferredBaselineId);
      if (baselineRow) {
        resolvedBaselineTaskId = baselineRow.source_task_id;
        resolvedBaselineUUID = baselineRow.id;
      } else {
        // Fallback: check if it is a task ID that has a baseline
        const bl = db.prepare('SELECT * FROM baselines WHERE source_task_id = ?').get(inferredBaselineId);
        if (bl) {
          baselineRow = bl;
          resolvedBaselineTaskId = bl.source_task_id;
          resolvedBaselineUUID = bl.id;
        } else {
          // If no baseline row exists at all, inferredBaselineId is a task ID
          resolvedBaselineTaskId = inferredBaselineId;
        }
      }
    }

    // Filter out resolved baseline UUID or inferred baseline ID to avoid duplicates if they were passed in task_ids
    const otherTaskIds = task_ids.filter(id => id !== resolvedBaselineUUID && id !== inferredBaselineId);

    const tasks = otherTaskIds.map(id => {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
      if (!task) return null;
      task.models = db.prepare('SELECT DISTINCT model_id, provider_id, mode, ts FROM task_models WHERE task_id = ? ORDER BY ts').all(id);
      task.environment = tryParse(task.environment);
      const events = db.prepare('SELECT * FROM events WHERE task_id = ? ORDER BY ts ASC').all(id);
      const tool_sequence = events
        .filter(e => e.tool_name && e.tool_name !== 'unknown')
        .map((e, index) => ({ index, tool_name: e.tool_name, file_path: extractTarget(e), command: e.command_text || null }));
      const tests = include_tests ? runTestSuite(db, id, resolvedBaselineUUID || inferredBaselineId, null, false) : null;
      return { task, tool_sequence, tests, is_baseline: false };
    }).filter(Boolean);

    // Prepend baseline column if resolved
    if (baselineRow) {
      const refMetrics = tryParse(baselineRow.reference_metrics_json, {});
      const prompts = tryParse(baselineRow.prompts_json, []);
      const baselineTask = {
        id: baselineRow.id, // Use baseline UUID as the task ID
        name: baselineRow.name,
        source: baselineRow.source,
        start_ts: baselineRow.created_at,
        end_ts: baselineRow.created_at,
        duration: refMetrics.duration || 0,
        total_cost: refMetrics.cost || 0,
        total_tokens_in: refMetrics.tokens_in || 0,
        total_tokens_out: refMetrics.tokens_out || 0,
        total_cache_reads: refMetrics.cache_reads || 0,
        error_count: refMetrics.error_count || 0,
        tool_call_count: refMetrics.tool_calls || 0,
        api_call_count: refMetrics.api_calls || 0,
        status: 'completed',
        activity_category: baselineRow.activity_category || 'general',
        first_message: prompts[0]?.text || '',
        models: [{ model_id: baselineRow.model_id }],
        is_baseline_reference: true
      };
      const tool_sequence = tryParse(baselineRow.tool_sequence_json, []);
      const tests = include_tests ? runTestSuite(db, resolvedBaselineTaskId, resolvedBaselineUUID || inferredBaselineId, null, false) : null;
      tasks.unshift({ task: baselineTask, tool_sequence, tests, is_baseline: true });
    } else if (resolvedBaselineTaskId) {
      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(resolvedBaselineTaskId);
      if (task) {
        task.models = db.prepare('SELECT DISTINCT model_id, provider_id, mode, ts FROM task_models WHERE task_id = ? ORDER BY ts').all(resolvedBaselineTaskId);
        task.environment = tryParse(task.environment);
        const events = db.prepare('SELECT * FROM events WHERE task_id = ? ORDER BY ts ASC').all(resolvedBaselineTaskId);
        const tool_sequence = events
          .filter(e => e.tool_name && e.tool_name !== 'unknown')
          .map((e, index) => ({ index, tool_name: e.tool_name, file_path: extractTarget(e), command: e.command_text || null }));
        const tests = include_tests ? runTestSuite(db, resolvedBaselineTaskId, resolvedBaselineUUID || inferredBaselineId, null, false) : null;
        tasks.unshift({ task, tool_sequence, tests, is_baseline: true });
      }
    }

    res.json({
      baseline: resolvedBaselineUUID ? getBaseline(db, resolvedBaselineUUID) : (inferredBaselineId ? getBaseline(db, inferredBaselineId) : null),
      tasks,
    });
  });

  function inferBaselineId(taskIds) {
    if (!taskIds || taskIds.length === 0) return null;
    const placeholders = taskIds.map(() => '?').join(',');

    // 1. Check if any of the taskIds is directly a baseline UUID
    let row = db.prepare(`SELECT id FROM baselines WHERE id IN (${placeholders})`).get(...taskIds);
    if (row) return row.id;

    // 2. Check if any of the taskIds is the source task of a baseline
    row = db.prepare(`SELECT id FROM baselines WHERE source_task_id IN (${placeholders})`).get(...taskIds);
    if (row) return row.id;

    // 3. Check if any of the taskIds has been tested against a baseline (from test_results)
    row = db.prepare(`SELECT baseline_id FROM test_results WHERE task_id IN (${placeholders}) AND baseline_id IS NOT NULL ORDER BY run_ts DESC LIMIT 1`).get(...taskIds);
    if (row) return row.baseline_id;

    return null;
  }

  // GET /api/tasks — paginated list with filters
  router.get('/', (req, res) => {
    const {
      page = 1, limit = 20,
      from, to, model, source,
      hasErrors, hasReasoning, status,
      error_category, tool_name, search,
      // Phase 4: agent filters
      agent, multi_agent
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];

    if (from) { conditions.push('t.start_ts >= ?'); params.push(new Date(from).getTime()); }
    if (to)   { conditions.push('t.start_ts <= ?'); params.push(new Date(to).getTime()); }
    if (source) { conditions.push('t.source = ?'); params.push(source); }
    if (status) { conditions.push('t.status = ?'); params.push(status); }
    if (hasErrors === 'true')  { conditions.push('t.error_count > 0'); }
    if (hasErrors === 'false') { conditions.push('t.error_count = 0'); }
    if (hasReasoning === 'true')  { conditions.push('t.has_reasoning = 1'); }
    if (hasReasoning === 'false') { conditions.push('t.has_reasoning = 0'); }
    if (search) { conditions.push('t.first_message LIKE ?'); params.push(`%${search}%`); }

    if (error_category) {
      conditions.push('t.id IN (SELECT task_id FROM events WHERE error_category = ?)');
      params.push(error_category);
    }
    if (tool_name) {
      conditions.push('t.id IN (SELECT task_id FROM events WHERE tool_name = ?)');
      params.push(tool_name);
    }

    let modelJoin = '';
    if (model) {
      modelJoin = 'INNER JOIN task_models tm ON t.id = tm.task_id';
      conditions.push('tm.model_id = ?');
      params.push(model);
    }

    // Phase 4: agent filter (OR-composed: agent=web_agent,mobile_agent)
    let agentJoin = '';
    if (agent) {
      const agents = String(agent).split(',').map(s => s.trim()).filter(Boolean);
      if (agents.length) {
        agentJoin = 'INNER JOIN task_models tm_ag ON t.id = tm_ag.task_id';
        conditions.push(`tm_ag.mode IN (${agents.map(() => '?').join(',')})`);
        params.push(...agents);
      }
    }
    if (multi_agent === '1' || multi_agent === 'true') {
      conditions.push('t.is_multi_agent = 1');
    } else if (multi_agent === '0' || multi_agent === 'false') {
      conditions.push('t.is_multi_agent = 0');
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    // Combine joins (we may have BOTH model and agent joins, both hitting task_models).
    // When both are present we need distinct join aliases; agent filter uses tm_ag,
    // model filter uses tm.
    const joinSql = [modelJoin, agentJoin].filter(Boolean).join(' ');

    const countRow = db.prepare(`SELECT COUNT(DISTINCT t.id) as cnt FROM tasks t ${joinSql} ${where}`).get(...params);
    const total = countRow?.cnt || 0;

    const rows = db.prepare(`
      SELECT DISTINCT t.* FROM tasks t ${joinSql} ${where}
      ORDER BY t.start_ts DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);

    // Attach models list + parsed agent context to each task
    const getModels = db.prepare('SELECT DISTINCT model_id, provider_id, mode FROM task_models WHERE task_id = ?');
    const tasks = rows.map(t => {
      const env = tryParse(t.environment);
      const agentSequence = tryParse(t.agent_sequence_json, []);
      return {
        ...t,
        environment: env,
        models: getModels.all(t.id),
        agent_sequence: agentSequence,
      };
    });

    res.json({ tasks, total, page: parseInt(page), limit: parseInt(limit) });
  });

  // GET /api/tasks/:id — full task detail
  router.get('/:id', (req, res) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const models = db.prepare('SELECT DISTINCT model_id, provider_id, mode, ts FROM task_models WHERE task_id = ? ORDER BY ts').all(req.params.id);
    task.models = models;
    task.environment = tryParse(task.environment);
    task.agent_sequence = tryParse(task.agent_sequence_json, []);

    res.json(task);
  });

  // GET /api/tasks/:id/events — events for timeline
  router.get('/:id/events', (req, res) => {
    const { types } = req.query;
    let query = 'SELECT * FROM events WHERE task_id = ? ORDER BY ts ASC';
    const params = [req.params.id];

    if (types) {
      const typeList = types.split(',').map(t => `'${t}'`).join(',');
      query = `SELECT * FROM events WHERE task_id = ? AND sub_type IN (${typeList}) ORDER BY ts ASC`;
    }

    const events = db.prepare(query).all(...params);
    res.json(events);
  });

  // GET /api/tasks/:id/evaluate — Automated heuristic metrics
  // Phase 4: refactored to use server/analytics/metrics.js as the single source
  // of truth. The local evidence strings below mirror the formula explanations
  // served via /api/analytics/metric-defs.
  router.get('/:id/evaluate', (req, res) => {
    const taskId = req.params.id;
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const events = db.prepare('SELECT * FROM events WHERE task_id = ? ORDER BY ts ASC').all(taskId);

    // Phase 4: single source of truth for the 4 metric numbers
    const m = computeSessionMetrics(task, events);

    // Local evidence strings (the metric values themselves come from the module)
    const evidence = { tue: '', rd: '', ce: '', err: '' };
    const toolEvents = events.filter(e => e.sub_type === 'tool');
    const errorEvents = events.filter(e => !!e.error_category);
    const toolErrors = errorEvents.filter(e => e.error_category === 'tool_failure' || e.error_category === 'validation_error');
    if (toolEvents.length > 0) {
       const successful = toolEvents.length - toolErrors.length;
       evidence.tue = `${successful} out of ${toolEvents.length} tool calls executed without failure.`;
    } else {
       evidence.tue = `No tool invocations were used.`;
    }
    const reasoningEvents = events.filter(e => e.sub_type === 'reasoning');
    const apiEvents = events.filter(e => e.sub_type === 'api_req_started');
    const totalActions = reasoningEvents.length + apiEvents.length + toolEvents.length;
    if (totalActions > 0) {
       evidence.rd = `${reasoningEvents.length} reasoning block(s) across ${totalActions} core actions.`;
    } else {
       evidence.rd = 'No core actions found.';
    }
    const ctxEvents = apiEvents.filter(e => e.context_pct != null);
    if (ctxEvents.length > 0) {
       const avgCtx = ctxEvents.reduce((acc, e) => acc + e.context_pct, 0) / ctxEvents.length;
       evidence.ce = `Average context window used: ${Math.round(avgCtx)}%.`;
    } else {
       evidence.ce = 'No context usage reported.';
    }
    const totalErrors = task.error_count || errorEvents.length;
    if (totalErrors === 0) {
       evidence.err = 'Task completed cleanly with zero errors.';
    } else if (task.status === 'completed') {
       evidence.err = `Task successfully completed despite encountering ${totalErrors} error(s). (Perfect recovery)`;
    } else {
       evidence.err = `Task failed/interrupted after encountering ${totalErrors} error(s).`;
    }

    // Fetch manual rating from test_results if exists
    const ratingRow = db.prepare('SELECT user_rating FROM test_results WHERE task_id = ? AND user_rating IS NOT NULL ORDER BY run_ts DESC LIMIT 1').get(taskId);
    const userRating = ratingRow ? ratingRow.user_rating : null;

    // Get completion message
    const { getCompletionMessage } = require('../testing/shared');
    const completionMessage = getCompletionMessage(events) || task.completion_message || null;

    // Add an Overall average score, factoring in manual rating (worth 30% if present)
    const metrics = { tue: m.tue, rd: m.rd, ce: m.ce, err: m.err };
    if (userRating != null) {
      const autoAvg = (metrics.tue + metrics.rd + metrics.ce + metrics.err) / 4;
      const ratingScore = userRating * 20; // convert 1-5 scale to 0-100
      metrics.overall = Math.round(0.7 * autoAvg + 0.3 * ratingScore);
    } else {
      metrics.overall = Math.round((metrics.tue + metrics.rd + metrics.ce + metrics.err) / 4);
    }

    res.json({ metrics, evidence, user_rating: userRating, completion_message: completionMessage });
  });

  return router;
};

function tryParse(str) {
  try { return str ? JSON.parse(str) : null; } catch { return null; }
}

function extractTarget(event) {
  const text = event.content_preview || '';
  return text.includes('→') ? text.split('→').slice(1).join('→').trim() || null : null;
}
