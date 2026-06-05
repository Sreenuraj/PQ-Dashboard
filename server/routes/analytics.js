const express = require('express');
const router = express.Router();
const { metricDefs } = require('../analytics/metrics');

module.exports = (db) => {

  // GET /api/analytics/overview
  // Phase 4: optional ?agent= filter scopes all numbers to sessions involving
  // the given agent(s) (OR-composed).
  router.get('/overview', (req, res) => {
    const { from, to, agent } = req.query;
    const { conditions, params: dateParams } = buildDateFilter(from, to);
    const agentFilter = buildAgentTaskFilter(agent, []);

    const allConditions = [...conditions];
    const allParams = [...dateParams];
    if (agentFilter.condition) {
      allConditions.push(agentFilter.condition);
      allParams.push(...agentFilter.params);
    }
    const whereClause = allConditions.length ? `WHERE ${allConditions.join(' AND ')}` : '';

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
  // Phase 5: PQ-Score composite ranking with Bayesian smoothing.
  //   • Fixes the JOIN fan-out double-counting bug by using DISTINCT task
  //     aggregation in a subquery before joining task-level fields.
  //   • Computes a weighted composite PQ-Score (0–100) server-side.
  //   • Marks models with <2 sessions as low_confidence.
  router.get('/models', (req, res) => {
    const { from, to, agent } = req.query;
    const { conditions, params: dateParams } = buildDateFilter(from, to, 't.');

    const allConditions = [...conditions];
    const allParams = [...dateParams];

    // Always group by model_id only — one row per model.
    const agentList = agent ? String(agent).split(',').map(s => s.trim()).filter(Boolean) : [];
    if (agentList.length) {
      allConditions.push(`tm.mode IN (${agentList.map(() => '?').join(',')})`);
      allParams.push(...agentList);
    }
    const whereClause = allConditions.length ? `WHERE ${allConditions.join(' AND ')}` : '';

    // Step 1: Get distinct (model_id, task_id) pairs, then aggregate task-level
    // fields exactly once per task. This prevents the JOIN fan-out bug where
    // SUM(t.total_cost) was inflated by multiple task_models rows per task.
    const models = db.prepare(`
      SELECT
        base.model_id,
        base.provider_id,
        base.mode,
        base.agents,
        base.task_count,
        base.total_cost,
        base.avg_cost,
        base.total_errors,
        base.total_tool_calls,
        base.total_api_calls,
        base.total_tokens_in,
        base.total_tokens_out,
        base.total_cache_reads,
        base.avg_duration,
        base.completed,
        base.with_reasoning,
        base.is_free,
        base.avg_tue,
        base.avg_rd,
        base.avg_ce,
        base.avg_err,
        base.scored_sessions,
        CASE WHEN base.task_count > 0
          THEN ROUND(CAST(base.total_errors AS REAL) / base.task_count, 2)
          ELSE 0 END as errors_per_session
      FROM (
        SELECT
          dm.model_id,
          MAX(dm.provider_id) as provider_id,
          MAX(dm.mode) as mode,
          GROUP_CONCAT(DISTINCT dm.mode) as agents,
          COUNT(DISTINCT dm.task_id) as task_count,
          -- Aggregate task-level fields using only DISTINCT task_ids
          -- to avoid double-counting from task_models fan-out
          SUM(t.total_cost)   / COUNT(*) * COUNT(DISTINCT dm.task_id) as total_cost_raw,
          COALESCE(SUM(t.total_cost) / NULLIF(COUNT(*), 0) * COUNT(DISTINCT dm.task_id), 0) as total_cost,
          COALESCE(SUM(t.total_cost) / NULLIF(COUNT(*), 0), 0) as avg_cost,
          CAST(SUM(t.error_count) AS REAL)   / COUNT(*) * COUNT(DISTINCT dm.task_id) as total_errors,
          CAST(SUM(t.tool_call_count) AS REAL) / COUNT(*) * COUNT(DISTINCT dm.task_id) as total_tool_calls,
          CAST(SUM(t.api_call_count) AS REAL)  / COUNT(*) * COUNT(DISTINCT dm.task_id) as total_api_calls,
          CAST(SUM(t.total_tokens_in) AS REAL) / COUNT(*) * COUNT(DISTINCT dm.task_id) as total_tokens_in,
          CAST(SUM(t.total_tokens_out) AS REAL) / COUNT(*) * COUNT(DISTINCT dm.task_id) as total_tokens_out,
          CAST(SUM(t.total_cache_reads) AS REAL) / COUNT(*) * COUNT(DISTINCT dm.task_id) as total_cache_reads,
          AVG(t.duration) as avg_duration,
          CAST(SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * COUNT(DISTINCT dm.task_id) as completed,
          CAST(SUM(CASE WHEN t.has_reasoning = 1 THEN 1 ELSE 0 END) AS REAL) / COUNT(*) * COUNT(DISTINCT dm.task_id) as with_reasoning,
          CASE WHEN dm.model_id LIKE '%:free' THEN 1 ELSE 0 END as is_free,
          AVG(sm.tue) as avg_tue,
          AVG(sm.rd)  as avg_rd,
          AVG(sm.ce)  as avg_ce,
          AVG(sm.err) as avg_err,
          COUNT(sm.tue) as scored_sessions
        FROM task_models dm
        INNER JOIN tasks t ON t.id = dm.task_id
        LEFT JOIN session_metrics sm ON sm.task_id = t.id
        ${whereClause}
        GROUP BY dm.model_id
      ) base
      ORDER BY base.task_count DESC
    `).all(...allParams);

    // Step 2: Compute PQ-Score with Bayesian smoothing
    const scored = computePqScores(models);

    res.json(scored);
  });

  // ── Phase 4: agent-aware analytics ─────────────────────────────────────

  // GET /api/analytics/agents — per-agent breakdown
  // Powers the Overview "Top Agents" card, the Errors "By Agent" tab,
  // the Activity "By Agent" matrix, and the Models heatmap row labels.
  // Phase 4: optional ?agent= filter (comma-separated, OR) scopes to specific agents.
  router.get('/agents', (req, res) => {
    const { from, to, agent } = req.query;
    const { conditions, params: dateParams } = buildDateFilter(from, to, 't.');
    const agentFilter = buildAgentTaskFilter(agent, []);

    const allConditions = [...conditions];
    const allParams = [...dateParams];
    if (agentFilter.condition) {
      allConditions.push(agentFilter.condition);
      allParams.push(...agentFilter.params);
    }

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
      ${allConditions.length ? 'AND ' + allConditions.join(' AND ') : ''}
      GROUP BY e.mode
      ORDER BY task_count DESC
    `).all(...allParams);

    // Sub-breakdowns: top 5 models per agent, activity mix per agent,
    // longest 5 sessions per agent.
    const agentNames = agents.map(a => a.agent);
    const topModelsPerAgent = {};
    const activityByAgent = {};
    const longestSessionsPerAgent = {};

    if (agentNames.length) {
      const placeholders = agentNames.map(() => '?').join(',');
      // Build the shared WHERE clause for sub-breakdowns (date + agent filter)
      const subConditions = [...conditions];
      const subParams = [...dateParams];
      if (agentFilter.condition) {
        subConditions.push(agentFilter.condition);
        subParams.push(...agentFilter.params);
      }
      const subWhereClause = subConditions.length ? 'AND ' + subConditions.join(' AND ') : '';

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
        ${subWhereClause}
        GROUP BY e.mode, e.model_id
        ORDER BY e.mode, task_count DESC
      `).all(...agentNames, ...subParams);

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
        ${subWhereClause}
        GROUP BY e.mode, category
      `).all(...agentNames, ...subParams);
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
          ${subWhereClause}
        )
        WHERE rn <= 5
        ORDER BY agent, duration DESC
      `).all(...agentNames, ...subParams);
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
    const { conditions, params } = buildDateFilter(from, to, 't.');
    const whereClause = conditions.length ? 'AND ' + conditions.join(' AND ') : '';

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
      ${whereClause}
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
    const { conditions, params } = buildDateFilter(from, to, 't.');
    const whereClause = conditions.length ? 'AND ' + conditions.join(' AND ') : '';

    const byCategory = db.prepare(`
      SELECT 
        e.error_category,
        COUNT(*) as count,
        COUNT(DISTINCT e.task_id) as affected_tasks,
        e.model_id
      FROM events e
      INNER JOIN tasks t ON t.id = e.task_id
      WHERE e.error_category IS NOT NULL ${whereClause}
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
      WHERE e.error_category IS NOT NULL ${whereClause}
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
      WHERE e.error_category IS NOT NULL AND e.model_id IS NOT NULL ${whereClause}
      GROUP BY e.provider_id, e.model_id, e.error_category
      ORDER BY count DESC
    `).all(...params);

    res.json({ byCategory, overTime, byModel });
  });

  // GET /api/analytics/tools
  // Phase 4: optional ?agent= filter (comma-separated, OR) scopes to specific agents.
  router.get('/tools', (req, res) => {
    const { from, to, agent } = req.query;
    const { conditions, params: dateParams } = buildDateFilter(from, to, 't.');
    const agentFilter = buildAgentTaskFilter(agent, []);

    const allConditions = [...conditions];
    const allParams = [...dateParams];
    if (agentFilter.condition) {
      allConditions.push(agentFilter.condition);
      allParams.push(...agentFilter.params);
    }
    const whereClause = allConditions.length ? 'AND ' + allConditions.join(' AND ') : '';

    const topTools = db.prepare(`
      SELECT 
        e.tool_name,
        COUNT(*) as count,
        COUNT(DISTINCT e.task_id) as task_count,
        COUNT(DISTINCT e.model_id) as model_count
      FROM events e
      INNER JOIN tasks t ON t.id = e.task_id
      WHERE e.tool_name IS NOT NULL AND e.tool_name != 'unknown' ${whereClause}
      GROUP BY e.tool_name
      ORDER BY count DESC
      LIMIT 20
    `).all(...allParams);

    const commandTypes = db.prepare(`
      SELECT 
        e.command_text,
        COUNT(*) as count
      FROM events e
      INNER JOIN tasks t ON t.id = e.task_id
      WHERE e.command_text IS NOT NULL ${whereClause}
      GROUP BY SUBSTR(e.command_text, 1, 30)
      ORDER BY count DESC
      LIMIT 15
    `).all(...allParams);

    res.json({ topTools, commandTypes });
  });

  // GET /api/analytics/costs
  router.get('/costs', (req, res) => {
    const { from, to, groupBy = 'day' } = req.query;
    const { conditions, params } = buildDateFilter(from, to);
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

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
      FROM tasks ${whereClause}
      GROUP BY period
      ORDER BY period ASC
    `).all(...params);

    res.json({ byTime });
  });

  // GET /api/analytics/sequences
  router.get('/sequences', (req, res) => {
    const { from, to } = req.query;
    const { conditions, params } = buildDateFilter(from, to, 't.');
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const events = db.prepare(`
      SELECT e.task_id, e.sub_type, e.tool_name, e.error_category
      FROM events e
      INNER JOIN tasks t ON t.id = e.task_id
      ${whereClause}
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
    const { conditions, params } = buildDateFilter(from, to);
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const tasks = db.prepare(`
      SELECT id, status, has_reasoning, tool_call_count, error_count 
      FROM tasks ${whereClause}
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
    const { conditions, params: dateParams } = buildDateFilter(from, to);
    const agentFilter = buildAgentTaskFilter(agent, []);

    const allConditions = [...conditions];
    const allParams = [...dateParams];
    if (agentFilter.condition) {
      allConditions.push(agentFilter.condition);
      allParams.push(...agentFilter.params);
    }
    const whereClause = allConditions.length ? `WHERE ${allConditions.join(' AND ')}` : '';

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
    const { conditions, params: dateParams } = buildDateFilter(from, to);
    const agentFilter = buildAgentTaskFilter(agent, []);

    const allConditions = [...conditions];
    const allParams = [...dateParams];
    if (agentFilter.condition) {
      allConditions.push(agentFilter.condition);
      allParams.push(...agentFilter.params);
    }
    const whereClause = allConditions.length ? `WHERE ${allConditions.join(' AND ')}` : '';

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
    const { conditions, params } = buildDateFilter(from, to, 't.');
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT 
        sc.command_base,
        SUM(sc.count) as count,
        COUNT(DISTINCT sc.task_id) as task_count
      FROM task_shell_commands sc
      INNER JOIN tasks t ON t.id = sc.task_id
      ${whereClause}
      GROUP BY sc.command_base
      ORDER BY count DESC
      LIMIT 20
    `).all(...params);

    res.json(rows);
  });

  // GET /api/analytics/activity/daily — Daily cost by activity category
  router.get('/activity/daily', (req, res) => {
    const { from, to } = req.query;
    const { conditions, params } = buildDateFilter(from, to);
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const rows = db.prepare(`
      SELECT 
        strftime('%Y-%m-%d', start_ts / 1000, 'unixepoch') as day,
        activity_category as category,
        SUM(total_cost) as cost,
        COUNT(*) as task_count
      FROM tasks ${whereClause}
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

// ── Phase 5: PQ-Score composite ranking algorithm ───────────────────────
//
// Weighted composite score (0–100) with Bayesian smoothing.
//
// Weights:
//   Completion Rate    25%  —  Most direct quality signal
//   Error Recovery     20%  —  Can the model recover from failures?
//   Tool Use Efficacy  15%  —  Is it using tools correctly?
//   Cost Efficiency    15%  —  Relative to peers (inverse percentile)
//   Context Efficiency 10%  —  How well does it manage context window?
//   Usage Confidence   10%  —  Higher sessions = more trustworthy score
//   Error Rate (inv.)   5%  —  Penalize error-prone models
//
// Bayesian smoothing:
//   smoothed = (n × raw + prior_n × prior) / (n + prior_n)
//   where prior_n = 5 (virtual sample of global-average quality)
//
// Free-tier handling:
//   Free models receive the median cost score so they don't distort rankings.
//
// Low confidence:
//   Models with < 2 sessions are flagged low_confidence = true.
// ────────────────────────────────────────────────────────────────────────

const PQ_WEIGHTS = {
  completion:       0.25,
  error_recovery:   0.20,
  tue:              0.15,
  cost_efficiency:  0.15,
  ce:               0.10,
  usage_confidence: 0.10,
  error_rate_inv:   0.05,
};

const PRIOR_SESSIONS = 5;        // virtual sample size for Bayesian smoothing
const MIN_CONFIDENT_SESSIONS = 2; // below this → low_confidence badge
const CONFIDENCE_THRESHOLD = 10;  // sessions needed for full usage_confidence score

function computePqScores(models) {
  if (!models || models.length === 0) return models;

  // ── Step A: Compute global priors (averages across all models) ──────
  const globalPrior = computeGlobalPriors(models);

  // ── Step B: Compute cost-efficiency percentile (inverse — lower cost = higher score)
  // Exclude free models from the cost ranking; they get the median score.
  const paidModels = models.filter(m => !m.is_free && m.avg_cost > 0);
  const costValues = paidModels.map(m => m.avg_cost).sort((a, b) => a - b);
  const medianCostScore = 50; // free models get this

  // ── Step C: Score each model ────────────────────────────────────────
  const scored = models.map(m => {
    const n = m.task_count || 0;

    // Raw metrics (0–100 scale)
    const rawCompletion = n > 0 ? (m.completed / n) * 100 : 0;
    const rawErrRecovery = m.avg_err ?? globalPrior.err;
    const rawTue = m.avg_tue ?? globalPrior.tue;
    const rawCe = m.avg_ce ?? globalPrior.ce;

    // Bayesian-smoothed metrics
    const completion = bayesianSmooth(rawCompletion, globalPrior.completion, n);
    const errRecovery = bayesianSmooth(rawErrRecovery, globalPrior.err, n);
    const tue = bayesianSmooth(rawTue, globalPrior.tue, n);
    const ce = bayesianSmooth(rawCe, globalPrior.ce, n);

    // Cost efficiency: percentile rank (lower cost = higher score)
    let costEfficiency;
    if (m.is_free || !m.avg_cost || m.avg_cost <= 0) {
      costEfficiency = medianCostScore;
    } else {
      const rank = costValues.filter(v => v <= m.avg_cost).length;
      // Invert: cheapest model gets 100, most expensive gets ~0
      costEfficiency = costValues.length > 1
        ? (1 - (rank - 1) / (costValues.length - 1)) * 100
        : 50;
    }

    // Usage confidence: min(sessions / threshold, 1) × 100
    const usageConfidence = Math.min(n / CONFIDENCE_THRESHOLD, 1) * 100;

    // Error rate (inverted): 100 when no errors, 0 when errors_per_session >= worst
    const errPerSession = m.errors_per_session || 0;
    const maxErrPerSession = Math.max(...models.map(m2 => m2.errors_per_session || 0), 1);
    const errorRateInv = 100 - (errPerSession / maxErrPerSession) * 100;

    // ── Weighted composite ────────────────────────────────────────────
    const pqScore = Math.round(
      completion      * PQ_WEIGHTS.completion +
      errRecovery     * PQ_WEIGHTS.error_recovery +
      tue             * PQ_WEIGHTS.tue +
      costEfficiency  * PQ_WEIGHTS.cost_efficiency +
      ce              * PQ_WEIGHTS.ce +
      usageConfidence * PQ_WEIGHTS.usage_confidence +
      errorRateInv    * PQ_WEIGHTS.error_rate_inv
    );

    return {
      ...m,
      pq_score: Math.max(0, Math.min(100, pqScore)),
      low_confidence: n < MIN_CONFIDENT_SESSIONS,
      // Expose components for tooltip/debug
      _pq_components: {
        completion: Math.round(completion),
        error_recovery: Math.round(errRecovery),
        tue: Math.round(tue),
        cost_efficiency: Math.round(costEfficiency),
        ce: Math.round(ce),
        usage_confidence: Math.round(usageConfidence),
        error_rate_inv: Math.round(errorRateInv),
      },
    };
  });

  // Sort by PQ-Score descending as the default order
  scored.sort((a, b) => b.pq_score - a.pq_score);

  return scored;
}

/** Compute global average priors across all models (weighted by session count). */
function computeGlobalPriors(models) {
  let totalSessions = 0;
  let sumCompletion = 0, sumErr = 0, sumTue = 0, sumCe = 0;
  let countErr = 0, countTue = 0, countCe = 0;

  for (const m of models) {
    const n = m.task_count || 0;
    totalSessions += n;
    if (n > 0) sumCompletion += (m.completed / n) * 100 * n;
    if (m.avg_err != null) { sumErr += m.avg_err * n; countErr += n; }
    if (m.avg_tue != null) { sumTue += m.avg_tue * n; countTue += n; }
    if (m.avg_ce  != null) { sumCe  += m.avg_ce  * n; countCe  += n; }
  }

  return {
    completion: totalSessions > 0 ? sumCompletion / totalSessions : 50,
    err:        countErr > 0      ? sumErr / countErr             : 50,
    tue:        countTue > 0      ? sumTue / countTue             : 50,
    ce:         countCe  > 0      ? sumCe  / countCe              : 50,
  };
}

/** Bayesian smoothing: blend raw score toward global prior based on sample size. */
function bayesianSmooth(rawScore, priorScore, sampleSize) {
  return (sampleSize * rawScore + PRIOR_SESSIONS * priorScore) / (sampleSize + PRIOR_SESSIONS);
}


function buildDateFilter(from, to, prefix = '') {
  const conditions = [];
  const params = [];
  if (from) { conditions.push(`${prefix}start_ts >= ?`); params.push(new Date(from).getTime()); }
  if (to)   { conditions.push(`${prefix}start_ts <= ?`); params.push(new Date(to).getTime()); }
  return { conditions, params };
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
