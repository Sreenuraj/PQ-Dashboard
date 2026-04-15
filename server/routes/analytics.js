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
        e.model_id,
        COUNT(*) as count
      FROM events e
      INNER JOIN tasks t ON t.id = e.task_id
      WHERE e.error_category IS NOT NULL ${where ? 'AND ' + where.slice(6) : ''}
      GROUP BY day, e.error_category, e.model_id
      ORDER BY day ASC
    `).all(...params);

    const byModel = db.prepare(`
      SELECT 
        e.provider_id,
        e.model_id,
        e.error_category,
        COUNT(*) as count
      FROM events e
      INNER JOIN tasks t ON t.id = e.task_id
      WHERE e.error_category IS NOT NULL AND e.model_id IS NOT NULL ${where ? 'AND ' + where.slice(6) : ''}
      GROUP BY e.provider_id, e.model_id, e.error_category
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
    let history = [];
    let lastTask = null;

    events.forEach(e => {
      if (e.task_id !== lastTask) {
        history = [];
        lastTask = e.task_id;
      }
      if (e.sub_type === 'tool' && e.tool_name) {
        history.push(e.tool_name);
        if (history.length > 4) history.shift();

        // Track pairs
        if (history.length >= 2) {
          const k2 = `${history[history.length-2]}->${history[history.length-1]}`;
          transitions[k2] = (transitions[k2] || 0) + 1;
        }
        // Track triplets
        if (history.length >= 3) {
          const k3 = `${history[history.length-3]}->${history[history.length-2]}->${history[history.length-1]}`;
          transitions[k3] = (transitions[k3] || 0) + 1;
        }
      }
    });

    const sequenceList = Object.entries(transitions)
      .map(([key, count]) => ({ steps: key.split('->'), count }))
      .filter(s => s.count > 1) // Only meaningful sequences
      .sort((a, b) => {
        // Prioritize longer chains if counts are close, but primarily sort by frequency
        if (b.count === a.count) return b.steps.length - a.steps.length;
        return b.count - a.count;
      })
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

  // GET /api/analytics/errors/export — download error events as CSV or JSON
  router.get('/errors/export', (req, res) => {
    const { from, to, categories, model_id, format = 'csv' } = req.query;
    
    // Build date filter based on task start_ts
    const conditions = ['e.error_category IS NOT NULL'];
    const params = [];
    
    if (from) { conditions.push('t.start_ts >= ?'); params.push(new Date(from).getTime()); }
    if (to)   { conditions.push('t.start_ts <= ?'); params.push(new Date(to).getTime()); }
    
    // Category filter
    if (categories && categories !== 'other') {
      const cats = categories.split(',').map(c => c.trim()).filter(Boolean);
      if (cats.length > 0) {
        conditions.push(`e.error_category IN (${cats.map(() => '?').join(',')})`);
        params.push(...cats);
      }
    } else if (categories === 'other') {
      // Exclude API and tool error categories
      const apiCats = ['api_failure','rate_limit_error','timeout_error','availability_error','provider_error','auth_error','billing_error','moderation_error','prompt_error'];
      const toolCats = ['tool_error','compliance_error'];
      const allKnown = [...apiCats, ...toolCats];
      conditions.push(`e.error_category NOT IN (${allKnown.map(() => '?').join(',')})`);
      params.push(...allKnown);
    }

    if (model_id) {
      conditions.push('e.model_id = ?');
      params.push(model_id);
    }

    const rows = db.prepare(`
      SELECT 
        e.task_id,
        e.ts,
        e.error_category,
        e.error_message,
        e.model_id,
        e.provider_id,
        e.tokens_in,
        e.tokens_out,
        e.cost,
        e.request_text,
        e.response_text,
        e.retry_count,
        e.context_pct
      FROM events e
      INNER JOIN tasks t ON t.id = e.task_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY e.ts DESC
    `).all(...params);

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename=pq-errors-export.json');
      return res.json(rows);
    }

    // CSV format
    const headers = ['task_id','timestamp','error_category','error_message','model_id','provider_id','tokens_in','tokens_out','cost','request_text','response_text','retry_count','context_pct'];
    const csvLines = [headers.join(',')];
    
    for (const row of rows) {
      csvLines.push([
        row.task_id,
        row.ts ? new Date(row.ts).toISOString() : '',
        row.error_category || '',
        csvEscape(row.error_message || ''),
        row.model_id || '',
        row.provider_id || '',
        row.tokens_in || 0,
        row.tokens_out || 0,
        row.cost || 0,
        csvEscape(row.request_text || ''),
        csvEscape(row.response_text || ''),
        row.retry_count || 0,
        row.context_pct != null ? row.context_pct : '',
      ].join(','));
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=pq-errors-export.csv');
    res.send(csvLines.join('\n'));
  });

  // ── CodeBurn-inspired Activity Intelligence endpoints ──

  // GET /api/analytics/activity — Activity category breakdown with one-shot rates
  router.get('/activity', (req, res) => {
    const { from, to } = req.query;
    const { where, params } = buildDateFilter(from, to);

    const rows = db.prepare(`
      SELECT 
        activity_category as category,
        COUNT(*) as task_count,
        SUM(total_cost) as total_cost,
        SUM(tool_call_count) as total_turns,
        SUM(edit_turns) as edit_turns,
        SUM(oneshot_turns) as oneshot_turns,
        SUM(retry_cycles) as retry_cycles,
        AVG(duration) as avg_duration,
        SUM(error_count) as total_errors,
        SUM(total_tokens_in) as total_tokens_in,
        SUM(total_tokens_out) as total_tokens_out,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM tasks ${where}
      GROUP BY activity_category
      ORDER BY total_cost DESC
    `).all(...params);

    // Compute one-shot rate per category
    const result = rows.map(r => ({
      ...r,
      oneshot_rate: r.edit_turns > 0 ? Math.round((r.oneshot_turns / r.edit_turns) * 100) : null,
    }));

    res.json(result);
  });

  // GET /api/analytics/shell-commands — Top shell command frequency
  router.get('/shell-commands', (req, res) => {
    const { from, to } = req.query;
    const { where, params } = buildDateFilter(from, to, 't.');

    const rows = db.prepare(`
      SELECT 
        sc.command_base,
        SUM(sc.count) as count,
        COUNT(DISTINCT sc.task_id) as task_count
      FROM task_shell_commands sc
      INNER JOIN tasks t ON t.id = sc.task_id
      ${where}
      GROUP BY sc.command_base
      ORDER BY count DESC
      LIMIT 20
    `).all(...params);

    res.json(rows);
  });

  // GET /api/analytics/activity/daily — Daily cost by activity category
  router.get('/activity/daily', (req, res) => {
    const { from, to } = req.query;
    const { where, params } = buildDateFilter(from, to);

    const rows = db.prepare(`
      SELECT 
        strftime('%Y-%m-%d', start_ts / 1000, 'unixepoch') as day,
        activity_category as category,
        SUM(total_cost) as cost,
        COUNT(*) as task_count
      FROM tasks ${where}
      GROUP BY day, activity_category
      ORDER BY day ASC
    `).all(...params);

    res.json(rows);
  });

  return router;
};

function csvEscape(str) {
  if (typeof str !== 'string') return str;
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function buildDateFilter(from, to, prefix = '') {
  const conditions = [];
  const params = [];
  if (from) { conditions.push(`${prefix}start_ts >= ?`); params.push(new Date(from).getTime()); }
  if (to)   { conditions.push(`${prefix}start_ts <= ?`); params.push(new Date(to).getTime()); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return { where, params };
}
