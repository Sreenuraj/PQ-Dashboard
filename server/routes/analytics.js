const express = require('express');
const router = express.Router();

module.exports = (db) => {

  // GET /api/analytics/overview
  router.get('/overview', (req, res) => {
    const { from, to } = req.query;
    const { where, params } = buildDateFilter(from, to);

    const totals = db.prepare(`
      SELECT 
        COUNT(*) as total_tasks,
        SUM(total_cost) as total_cost,
        SUM(total_tokens_in) as total_tokens_in,
        SUM(total_tokens_out) as total_tokens_out,
        SUM(total_cache_reads) as total_cache_reads,
        SUM(error_count) as total_errors,
        SUM(tool_call_count) as total_tool_calls,
        SUM(api_call_count) as total_api_calls,
        AVG(duration) as avg_duration,
        MIN(start_ts) as earliest_task,
        MAX(start_ts) as latest_task,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'interrupted' THEN 1 ELSE 0 END) as interrupted,
        SUM(CASE WHEN has_reasoning = 1 THEN 1 ELSE 0 END) as with_reasoning
      FROM tasks ${where}
    `).get(...params);

    const sources = db.prepare(`SELECT source, COUNT(*) as cnt FROM tasks ${where} GROUP BY source`).all(...params);

    res.json({ ...totals, sources });
  });

  // GET /api/analytics/models
  router.get('/models', (req, res) => {
    const { from, to } = req.query;
    const { where, params } = buildDateFilter(from, to, 't.');

    const models = db.prepare(`
      SELECT 
        tm.model_id,
        tm.provider_id,
        tm.mode,
        COUNT(DISTINCT tm.task_id) as task_count,
        SUM(t.total_cost) as total_cost,
        AVG(t.total_cost) as avg_cost,
        SUM(t.error_count) as total_errors,
        SUM(t.tool_call_count) as total_tool_calls,
        SUM(t.api_call_count) as total_api_calls,
        SUM(t.total_tokens_in) as total_tokens_in,
        SUM(t.total_tokens_out) as total_tokens_out,
        SUM(t.total_cache_reads) as total_cache_reads,
        AVG(t.duration) as avg_duration,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN t.has_reasoning = 1 THEN 1 ELSE 0 END) as with_reasoning,
        CASE WHEN tm.model_id LIKE '%:free' THEN 1 ELSE 0 END as is_free
      FROM task_models tm
      INNER JOIN tasks t ON t.id = tm.task_id
      ${where}
      GROUP BY tm.model_id, tm.provider_id, tm.mode
      ORDER BY task_count DESC
    `).all(...params);

    res.json(models);
  });

  // GET /api/analytics/errors
  router.get('/errors', (req, res) => {
    const { from, to } = req.query;
    const { where, params } = buildDateFilter(from, to, 't.');

    const byCategory = db.prepare(`
      SELECT 
        e.error_category,
        COUNT(*) as count,
        COUNT(DISTINCT e.task_id) as affected_tasks,
        e.model_id
      FROM events e
      INNER JOIN tasks t ON t.id = e.task_id
      WHERE e.error_category IS NOT NULL ${where ? 'AND ' + where.slice(6) : ''}
      GROUP BY e.error_category
      ORDER BY count DESC
    `).all(...params);

    const overTime = db.prepare(`
      SELECT 
        strftime('%Y-%m-%d', e.ts / 1000, 'unixepoch') as day,
        e.error_category,
        COUNT(*) as count
      FROM events e
      INNER JOIN tasks t ON t.id = e.task_id
      WHERE e.error_category IS NOT NULL ${where ? 'AND ' + where.slice(6) : ''}
      GROUP BY day, e.error_category
      ORDER BY day ASC
    `).all(...params);

    const byModel = db.prepare(`
      SELECT 
        e.model_id,
        e.error_category,
        COUNT(*) as count
      FROM events e
      INNER JOIN tasks t ON t.id = e.task_id
      WHERE e.error_category IS NOT NULL AND e.model_id IS NOT NULL ${where ? 'AND ' + where.slice(6) : ''}
      GROUP BY e.model_id, e.error_category
      ORDER BY count DESC
    `).all(...params);

    res.json({ byCategory, overTime, byModel });
  });

  // GET /api/analytics/tools
  router.get('/tools', (req, res) => {
    const { from, to } = req.query;
    const { where, params } = buildDateFilter(from, to, 't.');

    const topTools = db.prepare(`
      SELECT 
        e.tool_name,
        COUNT(*) as count,
        COUNT(DISTINCT e.task_id) as task_count,
        COUNT(DISTINCT e.model_id) as model_count
      FROM events e
      INNER JOIN tasks t ON t.id = e.task_id
      WHERE e.tool_name IS NOT NULL AND e.tool_name != 'unknown' ${where ? 'AND ' + where.slice(6) : ''}
      GROUP BY e.tool_name
      ORDER BY count DESC
      LIMIT 20
    `).all(...params);

    const commandTypes = db.prepare(`
      SELECT 
        e.command_text,
        COUNT(*) as count
      FROM events e
      INNER JOIN tasks t ON t.id = e.task_id
      WHERE e.command_text IS NOT NULL ${where ? 'AND ' + where.slice(6) : ''}
      GROUP BY SUBSTR(e.command_text, 1, 30)
      ORDER BY count DESC
      LIMIT 15
    `).all(...params);

    res.json({ topTools, commandTypes });
  });

  // GET /api/analytics/costs
  router.get('/costs', (req, res) => {
    const { from, to, groupBy = 'day' } = req.query;
    const { where, params } = buildDateFilter(from, to);

    const fmt = groupBy === 'week'
      ? `strftime('%Y-W%W', start_ts / 1000, 'unixepoch')`
      : `strftime('%Y-%m-%d', start_ts / 1000, 'unixepoch')`;

    const byTime = db.prepare(`
      SELECT 
        ${fmt} as period,
        SUM(total_cost) as cost,
        SUM(total_tokens_in) as tokens_in,
        SUM(total_tokens_out) as tokens_out,
        SUM(total_cache_reads) as cache_reads,
        COUNT(*) as task_count
      FROM tasks ${where}
      GROUP BY period
      ORDER BY period ASC
    `).all(...params);

    res.json({ byTime });
  });

  return router;
};

function buildDateFilter(from, to, prefix = '') {
  const conditions = [];
  const params = [];
  if (from) { conditions.push(`${prefix}start_ts >= ?`); params.push(new Date(from).getTime()); }
  if (to)   { conditions.push(`${prefix}start_ts <= ?`); params.push(new Date(to).getTime()); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}
