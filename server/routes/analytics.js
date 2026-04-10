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
        MAX(tm.provider_id) as provider_id,
        MAX(tm.mode) as mode,
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
      GROUP BY tm.model_id
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

  // GET /api/analytics/sequences
  router.get('/sequences', (req, res) => {
    const { from, to } = req.query;
    const { where, params } = buildDateFilter(from, to, 't.');

    const events = db.prepare(`
      SELECT e.task_id, e.sub_type, e.tool_name, e.error_category
      FROM events e
      INNER JOIN tasks t ON t.id = e.task_id
      ${where}
      ORDER BY e.task_id, e.ts ASC
    `).all(...params);

    const transitions = {};
    let lastTool = null;
    let lastTask = null;

    events.forEach(e => {
      if (e.task_id !== lastTask) {
        lastTool = null;
        lastTask = e.task_id;
      }
      if (e.sub_type === 'tool' && e.tool_name) {
        if (lastTool) {
          const key = `${lastTool}->${e.tool_name}`;
          transitions[key] = (transitions[key] || 0) + 1;
        }
        lastTool = e.tool_name;
      }
    });

    const sequenceList = Object.entries(transitions)
      .map(([key, count]) => {
        const [source, target] = key.split('->');
        return { source, target, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 30);

    res.json({ target: sequenceList });
  });

  // GET /api/analytics/flow
  router.get('/flow', (req, res) => {
    const { from, to } = req.query;
    const { where, params } = buildDateFilter(from, to);

    const tasks = db.prepare(`
      SELECT id, status, has_reasoning, tool_call_count, error_count 
      FROM tasks ${where}
    `).all(...params);

    let nodesHash = { 'Task Start': 0, 'Reasoning': 1, 'No Reasoning': 2, 'Tools Used': 3, 'No Tools': 4, 'Completed': 5, 'Interrupted': 6, 'Error': 7, 'Has API Errors': 8 };
    let nIdx = 9;
    
    // Sankey requires: nodes: [{name}], links: [{source, target, value}]
    // We will build a flow from Start -> Reasoning -> Tools -> Errors -> Status
    
    let linksMap = {};
    const addLink = (src, tgt) => {
      const key = `${src}->${tgt}`;
      linksMap[key] = (linksMap[key] || 0) + 1;
    };

    tasks.forEach(t => {
      // 1. Start to Reasoning
      const rNode = t.has_reasoning ? 'Reasoning' : 'No Reasoning';
      addLink('Task Start', rNode);

      // 2. Reasoning to Tools
      const tNode = t.tool_call_count > 0 ? 'Tools Used' : 'No Tools';
      addLink(rNode, tNode);

      // 3. Tools to Errors
      let eNode = tNode; // pass through
      if (t.error_count > 0) {
        eNode = 'Has API Errors';
        addLink(tNode, eNode);
      }

      // 4. to Final status
      const sNode = t.status === 'completed' ? 'Completed' : t.status === 'interrupted' ? 'Interrupted' : 'Error';
      addLink(eNode, sNode);
    });

    const nodes = Object.keys(nodesHash).map(name => ({ name }));
    const links = Object.entries(linksMap).map(([k, v]) => {
      const [src, tgt] = k.split('->');
      return { source: nodesHash[src], target: nodesHash[tgt], value: v };
    });

    res.json({ nodes, links });
  });

  // GET /api/analytics/reasoning
  router.get('/reasoning', (req, res) => {
    const { from, to } = req.query;
    const { where, params } = buildDateFilter(from, to);
    
    const stats = db.prepare(`
      SELECT 
        has_reasoning,
        COUNT(*) as task_count,
        SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) as completed,
        AVG(duration) as avg_duration,
        AVG(total_cost) as avg_cost,
        AVG(error_count) as avg_errors
      FROM tasks
      ${where}
      GROUP BY has_reasoning
    `).all(...params);
    res.json(stats);
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
