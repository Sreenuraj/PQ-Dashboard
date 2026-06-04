const express = require('express');
const router = express.Router();
const { metricDefs } = require('../analytics/metrics');

module.exports = (db) => {

  // GET /api/analytics/overview
  // Phase 4: optional ?agent= filter scopes all numbers to sessions involving
  // the given agent(s) (OR-composed).
  router.get('/overview', (req, res) => {
    const { from, to, agent } = req.query;
    const { where, params: dateParams } = buildDateFilter(from, to);
    const agentFilter = buildAgentTaskFilter(agent, []);

    const whereParts = [];
    const allParams = [...dateParams];
    if (where) whereParts.push(where);
    if (agentFilter.condition) { whereParts.push(agentFilter.condition); allParams.push(...agentFilter.params); }
    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const totals = db.prepare(`
      SELECT
        COUNT(DISTINCT t.id) as total_tasks,
        SUM(t.total_cost) as total_cost,
        SUM(t.total_tokens_in) as total_tokens_in,
        SUM(t.total_tokens_out) as total_tokens_out,
        SUM(t.total_cache_reads) as total_cache_reads,
        SUM(t.error_count) as total_errors,
        SUM(t.tool_call_count) as total_tool_calls,
        SUM(t.api_call_count) as total_api_calls,
        AVG(t.duration) as avg_duration,
        MIN(t.start_ts) as earliest_task,
        MAX(t.start_ts) as latest_task,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN t.status = 'interrupted' THEN 1 ELSE 0 END) as interrupted,
        SUM(CASE WHEN t.has_reasoning = 1 THEN 1 ELSE 0 END) as with_reasoning
      FROM tasks t
      ${whereClause}
    `).get(...allParams);

    const sources = db.prepare(`SELECT t.source, COUNT(DISTINCT t.id) as cnt FROM tasks t ${whereClause} GROUP BY t.source`).all(...allParams);

    res.json({ ...totals, sources });
  });

  // GET /api/analytics/models
  // Phase 4: extended with avg_tue/avg_rd/avg_ce/avg_err from session_metrics
  // (cheap rollups; session_metrics is pre-computed by the parser).
  router.get('/models', (req, res) => {
    const { from, to, agent } = req.query;
    const { where, params: dateParams } = buildDateFilter(from, to, 't.');

    // Phase 4: optional agent filter (OR-composed: agent=web_agent,mobile_agent)
    const agentFilter = buildAgentTaskFilter(agent, []);

    // Build WHERE clause properly — agent filter must be in WHERE, not swallowed by LEFT JOIN
    const whereParts = [];
    const allParams = [...dateParams];
    if (where) whereParts.push(where);
    if (agentFilter.condition) { whereParts.push(agentFilter.condition); allParams.push(...agentFilter.params); }
    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    // Always group by model_id only — one row per model.
    // The tm.mode IN (...) filter restricts which agent's usage is counted,
    // and GROUP_CONCAT(DISTINCT tm.mode) shows which of the selected agents
    // used this model. This way, selecting mobile_agent + web_agent shows
    // each model once with both agent chips, not split into separate rows.
    const agentList = agent ? String(agent).split(',').map(s => s.trim()).filter(Boolean) : [];
    const modeFilter = agentList.length
      ? `AND tm.mode IN (${agentList.map(() => '?').join(',')})`
      : '';
    const modeParams = agentList;
    const groupBy = 'tm.model_id';
    const selectMode = 'MAX(tm.mode) as mode';

    const models = db.prepare(`
      SELECT
        tm.model_id,
        MAX(tm.provider_id) as provider_id,
        ${selectMode},
        GROUP_CONCAT(DISTINCT tm.mode) as agents,
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
        CASE WHEN tm.model_id LIKE '%:free' THEN 1 ELSE 0 END as is_free,
        -- Phase 4: heuristic metric rollups from session_metrics
        AVG(sm.tue)  as avg_tue,
        AVG(sm.rd)   as avg_rd,
        AVG(sm.ce)   as avg_ce,
        AVG(sm.err)  as avg_err,
        COUNT(sm.tue) as scored_sessions
      FROM task_models tm
      INNER JOIN tasks t ON t.id = tm.task_id
      LEFT JOIN session_metrics sm ON sm.task_id = t.id
      ${whereClause}
      ${modeFilter}
      GROUP BY ${groupBy}
      ORDER BY task_count DESC
    `).all(...allParams, ...modeParams);

    res.json(models);
  });

  // ── Phase 4: agent-aware analytics ─────────────────────────────────────

  // GET /api/analytics/agents — per-agent breakdown
  // Powers the Overview "Top Agents" card, the Errors "By Agent" tab,
  // the Activity "By Agent" matrix, and the Models heatmap row labels.
  router.get('/agents', (req, res) => {
    const { from, to } = req.query;
    const { where, params } = buildDateFilter(from, to, 't.');

    const agents = db.prepare(`
      SELECT
        e.mode AS agent,
        COUNT(DISTINCT e.task_id) AS task_count,
        COUNT(*)                  AS event_count,
        SUM(COALESCE(e.cost, 0))  AS total_cost,
        SUM(COALESCE(e.tokens_in, 0))  AS total_tokens_in,
        SUM(COALESCE(e.tokens_out, 0)) AS total_tokens_out,
        COUNT(DISTINCT CASE WHEN e.error_category IS NOT NULL THEN e.task_id END) AS affected_task_count,
        SUM(CASE WHEN e.error_category IS NOT NULL THEN 1 ELSE 0 END)              AS total_errors,
        AVG(t.duration)          AS avg_duration,
        MAX(t.duration)          AS max_duration,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed
      FROM events e
      INNER JOIN tasks t ON t.id = e.task_id
      WHERE e.mode IS NOT NULL AND e.mode != ''
      ${where ? 'AND ' + where.slice(6) : ''}
      GROUP BY e.mode
      ORDER BY task_count DESC
    `).all(...params);

    // Sub-breakdowns: top 5 models per agent, activity mix per agent,
    // longest 5 sessions per agent.
    const agentNames = agents.map(a => a.agent);
    const topModelsPerAgent = {};
    const activityByAgent = {};
    const longestSessionsPerAgent = {};

    if (agentNames.length) {
      const placeholders = agentNames.map(() => '?').join(',');
      const topModelsRows = db.prepare(`
        SELECT
          e.mode AS agent,
          e.model_id,
          COUNT(DISTINCT e.task_id) AS task_count,
          AVG(t.total_cost)         AS avg_cost,
          SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS completed
        FROM events e
        INNER JOIN tasks t ON t.id = e.task_id
        WHERE e.mode IN (${placeholders}) AND e.model_id IS NOT NULL
        ${where ? 'AND ' + where.slice(6) : ''}
        GROUP BY e.mode, e.model_id
        ORDER BY e.mode, task_count DESC
      `).all(...agentNames, ...params);

      for (const r of topModelsRows) {
        if (!topModelsPerAgent[r.agent]) topModelsPerAgent[r.agent] = [];
        if (topModelsPerAgent[r.agent].length < 5) {
          topModelsPerAgent[r.agent].push({
            model_id: r.model_id,
            task_count: r.task_count,
            avg_cost: r.avg_cost,
            completion_rate: r.task_count > 0 ? Math.round((r.completed / r.task_count) * 100) : 0,
          });
        }
      }

      const activityRows = db.prepare(`
        SELECT
          e.mode AS agent,
          COALESCE(t.activity_category, 'general') AS category,
          COUNT(DISTINCT e.task_id) AS task_count
        FROM events e
        INNER JOIN tasks t ON t.id = e.task_id
        WHERE e.mode IN (${placeholders})
        ${where ? 'AND ' + where.slice(6) : ''}
        GROUP BY e.mode, category
      `).all(...agentNames, ...params);
      for (const r of activityRows) {
        if (!activityByAgent[r.agent]) activityByAgent[r.agent] = {};
        activityByAgent[r.agent][r.category] = r.task_count;
      }

      // Longest 5 sessions per agent (single round-trip via window function)
      const longestRows = db.prepare(`
        SELECT agent, task_id, duration, total_cost, status, primary_agent
        FROM (
          SELECT
            e.mode AS agent,
            t.id   AS task_id,
            t.duration,
            t.total_cost,
            t.status,
            t.primary_agent,
            ROW_NUMBER() OVER (PARTITION BY e.mode ORDER BY t.duration DESC) AS rn
          FROM events e
          INNER JOIN tasks t ON t.id = e.task_id
          WHERE e.mode IN (${placeholders})
          ${where ? 'AND ' + where.slice(6) : ''}
        )
        WHERE rn <= 5
        ORDER BY agent, duration DESC
      `).all(...agentNames, ...params);
      for (const r of longestRows) {
        if (!longestSessionsPerAgent[r.agent]) longestSessionsPerAgent[r.agent] = [];
        longestSessionsPerAgent[r.agent].push({
          id: r.task_id,
          duration: r.duration,
          total_cost: r.total_cost,
          status: r.status,
          primary_agent: r.primary_agent,
        });
      }
    }

    res.json({
      agents,
      top_models_per_agent: topModelsPerAgent,
      activity_by_agent: activityByAgent,
      longest_sessions_per_agent: longestSessionsPerAgent,
    });
  });

  // GET /api/analytics/agent-matrix?dimension=model|activity|status
  // Sparse pivot: rows = agents, cols = dimension values, values = task_count.
  router.get('/agent-matrix', (req, res) => {
    const { from, to, dimension = 'model' } = req.query;
    const { where, params } = buildDateFilter(from, to, 't.');

    let rows, cols, values, colExpr;
    if (dimension === 'model') {
      colExpr = `e.model_id`;
    } else if (dimension === 'activity') {
      colExpr = `COALESCE(t.activity_category, 'general')`;
    } else if (dimension === 'status') {
      colExpr = `t.status`;
    } else {
      return res.status(400).json({ error: `Unknown dimension: ${dimension}` });
    }

    const sql = `
      SELECT
        e.mode AS agent,
        ${colExpr} AS col_value,
        COUNT(DISTINCT e.task_id) AS task_count
      FROM events e
      INNER JOIN tasks t ON t.id = e.task_id
      WHERE e.mode IS NOT NULL AND e.mode != ''
      ${where ? 'AND ' + where.slice(6) : ''}
      GROUP BY e.mode, col_value
    `;
    const raw = db.prepare(sql).all(...params);

    // Build the (row, col) -> count map and the ordered row/col lists
    const rowSet = new Set();
    const colSet = new Set();
    const cell = new Map();
    for (const r of raw) {
      if (!r.agent || !r.col_value) continue;
      rowSet.add(r.agent);
      colSet.add(r.col_value);
      const key = `${r.agent}::${r.col_value}`;
      cell.set(key, (cell.get(key) || 0) + r.task_count);
    }
    rows = [...rowSet].sort();
    cols = [...colSet].sort();
    values = rows.map(a => cols.map(c => cell.get(`${a}::${c}`) || 0));

    res.json({ rows, cols, values, metric: 'task_count', dimension });
  });

  // GET /api/analytics/metric-defs — UI tooltips source of truth
  router.get('/metric-defs', (req, res) => {
    res.json(metricDefs());
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
  // Phase 4: optional ?agent= filter
  router.get('/reasoning', (req, res) => {
    const { from, to, agent } = req.query;
    const { where, params: dateParams } = buildDateFilter(from, to);
    const agentFilter = buildAgentTaskFilter(agent, []);

    const whereParts = [];
    const allParams = [...dateParams];
    if (where) whereParts.push(where);
    if (agentFilter.condition) { whereParts.push(agentFilter.condition); allParams.push(...agentFilter.params); }
    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const stats = db.prepare(`
      SELECT
        has_reasoning,
        COUNT(DISTINCT t.id) as task_count,
        SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) as completed,
        AVG(t.duration) as avg_duration,
        AVG(t.total_cost) as avg_cost,
        AVG(t.error_count) as avg_errors
      FROM tasks t
      ${whereClause}
      GROUP BY has_reasoning
    `).all(...allParams);
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
  // Phase 4: optional ?agent= filter
  router.get('/activity', (req, res) => {
    const { from, to, agent } = req.query;
    const { where, params: dateParams } = buildDateFilter(from, to);
    const agentFilter = buildAgentTaskFilter(agent, []);

    const whereParts = [];
    const allParams = [...dateParams];
    if (where) whereParts.push(where);
    if (agentFilter.condition) { whereParts.push(agentFilter.condition); allParams.push(...agentFilter.params); }
    const whereClause = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT
        activity_category as category,
        COUNT(DISTINCT t.id) as task_count,
        SUM(t.total_cost) as total_cost,
        SUM(t.tool_call_count) as total_turns,
        SUM(t.edit_turns) as edit_turns,
        SUM(t.oneshot_turns) as oneshot_turns,
        SUM(t.retry_cycles) as retry_cycles,
        AVG(t.duration) as avg_duration,
        SUM(t.error_count) as total_errors,
        SUM(t.total_tokens_in) as total_tokens_in,
        SUM(t.total_tokens_out) as total_tokens_out,
        SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) as completed
      FROM tasks t
      ${whereClause}
      GROUP BY activity_category
      ORDER BY total_cost DESC
    `).all(...allParams);

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

// Phase 4: helper for the agent lens on tasks-scoped endpoints. Returns
// `{ condition, params }` — caller ANDs `condition` into the WHERE clause.
// Uses EXISTS (not JOIN) to avoid duplicating task rows when a session has
// multiple model_usage entries (multi-agent sessions).
function buildAgentTaskFilter(agent, params) {
  if (!agent) return { condition: '', params: [] };
  const agents = String(agent).split(',').map(s => s.trim()).filter(Boolean);
  if (!agents.length) return { condition: '', params: [] };
  const placeholders = agents.map(() => '?').join(',');
  return {
    condition: `EXISTS (SELECT 1 FROM task_models tm_ag WHERE tm_ag.task_id = t.id AND tm_ag.mode IN (${placeholders}))`,
    params: [...agents],
  };
}
