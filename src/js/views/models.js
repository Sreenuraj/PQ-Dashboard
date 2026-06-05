import { api } from '../api.js';
import { fmtCost, agentColor } from '../utils.js';
import { renderRadarChart, renderCostChart, renderToolsChart } from '../components/charts.js';

let sortKey = 'pq_score';
let sortDir = 'desc';
let radarChartInstance = null;

export async function renderModels(container, dateRange = {}, queryParams = new URLSearchParams()) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading models...</p></div>`;
  const params = {};
  if (dateRange.from) params.from = dateRange.from;
  if (dateRange.to)   params.to   = dateRange.to;
  // Phase 4: read agent filter from URL (e.g. ?agent=web_agent,mobile_agent)
  const urlAgent = queryParams.get('agent');
  if (urlAgent) params.agent = urlAgent;
  // Phase 4: also fetch the agent-matrix so we can render the Model×Agent heatmap
  const [models, agentMatrix, agentsData] = await Promise.all([
    api.models(params),
    api.agentMatrix({ ...params, dimension: 'model' }).catch(() => ({ rows: [], cols: [], values: [] })),
    api.agents({ from: dateRange.from, to: dateRange.to }).catch(() => ({ agents: [] })),
  ]);

  if (!models.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">◉</div><p>No model data yet. Run a refresh.</p></div>`;
    return;
  }

  const maxModelCost = Math.max(...models.map(m => m.total_cost || 0), 0);

  const paint = () => {
    const sortedModels = sortModelsList(models, sortKey, sortDir);

    container.innerHTML = `
      <div class="top-bar">
        <div>
          <h1 class="view-title">Model Analytics</h1>
          <p class="view-subtitle">${models.length} distinct models${urlAgent ? ` · <span style="color:var(--accent-2)">filtered by: ${escHtml(urlAgent)}</span>` : ''} · <span style="color:var(--accent-2);font-size:11px">Click any row to see sessions for that model ↗</span></p>
        </div>
        <!-- date picker injected here -->
      </div>

      <div class="filters-bar" style="margin-bottom:14px">
        <span style="font-size:12px;color:var(--text-3)">Agent:</span>
        <select id="models-agent-filter" class="filter-select" style="padding:4px 8px">
          <option value="">All Agents</option>
          ${(agentsData.agents || []).map(a => `
            <option value="${escAttr(a.agent)}" ${urlAgent === a.agent ? 'selected' : ''}>${escHtml(a.agent)} (${a.task_count})</option>
          `).join('')}
        </select>
      </div>

      <div class="panel">
        <div class="panel-title">Model Efficiency Matrix <span style="font-weight:400;color:var(--text-3);font-size:10px;text-transform:none" id="radar-chart-label">(top 5 models by ${getSortLabel(sortKey)})</span></div>
        <div class="panel-body">
          <div class="chart-wrap tall">
            <canvas id="modelRadarChart"></canvas>
          </div>
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">
          <span>Model Performance Table</span>
          <span class="panel-title-meta">Relative cost bar appears beside each model · click headers to sort</span>
        </div>
        <div class="table-wrap">
          <table class="data-table" style="font-size:12px">
            <thead>
              <tr>
                <th>${sortHeader('Model', 'model_id')}</th>
                <th>${sortHeader('Provider', 'provider_id')}</th>
                <th>Agent</th>  <!-- Phase 4: Mode → Agent -->
                <th>${sortHeader('PQ-Score', 'pq_score')}</th>
                <th>${sortHeader('Sessions', 'task_count')}</th>
                <th>${sortHeader('Total Cost', 'total_cost')}</th>
                <th>${sortHeader('Avg Cost', 'avg_cost')}</th>
                <th>${sortHeader('Tool Use Efficacy', 'avg_tue')}</th>
                <th>${sortHeader('Context Efficiency', 'avg_ce')}</th>
                <th>${sortHeader('Error Recovery', 'avg_err')}</th>
                <th>${sortHeader('Errors', 'total_errors')}</th>
                <th>${sortHeader('Completion Rate', 'completed')}</th>
                <th>${sortHeader('Cache %', 'cache_hit')}</th>
                <th>Reasoning</th>
                <th>Tier</th>
              </tr>
            </thead>
            <tbody>
              ${sortedModels.map(m => {
                const completionPct = m.task_count > 0 ? Math.round(m.completed / m.task_count * 100) : 0;
                const cacheHit = (m.total_tokens_in + m.total_cache_reads) > 0
                  ? Math.round(m.total_cache_reads / (m.total_tokens_in + m.total_cache_reads) * 100) : 0;
                const costWidth = maxModelCost > 0 ? (m.total_cost / maxModelCost * 100) : 0;
                const tueScore = m.avg_tue == null ? '—' : `${Math.round(m.avg_tue)}%`;
                const ceScore  = m.avg_ce  == null ? '—' : `${Math.round(m.avg_ce)}%`;
                const errScore = m.avg_err == null ? '—' : `${Math.round(m.avg_err)}%`;
                const tueColor = m.avg_tue == null ? 'var(--text-3)' : (m.avg_tue >= 80 ? '#5BF58C' : m.avg_tue >= 50 ? '#F5C85B' : '#F55B5B');
                const ceColor  = m.avg_ce  == null ? 'var(--text-3)' : (m.avg_ce  >= 50 ? '#5BF58C' : m.avg_ce  >= 20 ? '#F5C85B' : '#F55B5B');
                const errColor = m.avg_err == null ? 'var(--text-3)' : (m.avg_err >= 80 ? '#5BF58C' : m.avg_err >= 30 ? '#F5C85B' : '#F55B5B');
                const agents = (m.agents || m.mode ? [m.agents ? m.agents.split(',') : [m.mode]].flat().filter(Boolean) : []);
                // PQ-Score rendering
                const pqs = m.pq_score ?? 0;
                const pqColor = pqs >= 75 ? '#5BF58C' : pqs >= 50 ? '#F5C85B' : pqs >= 30 ? '#F5A05B' : '#F55B5B';
                const lcBadge = m.low_confidence ? '<span style="font-size:8px;color:var(--text-3);background:var(--bg-2);border:1px solid var(--border);border-radius:3px;padding:1px 4px;margin-left:3px" title="Fewer than 2 sessions">LOW CONF</span>' : '';
                // Build PQ component tooltip
                const comp = m._pq_components || {};
                const pqTooltip = `PQ-Score: ${pqs}/100\nCompletion: ${comp.completion ?? '—'}% (25%)\nError Recovery: ${comp.error_recovery ?? '—'}% (20%)\nTool Efficacy: ${comp.tue ?? '—'}% (15%)\nCost Efficiency: ${comp.cost_efficiency ?? '—'}% (15%)\nContext Eff: ${comp.ce ?? '—'}% (10%)\nUsage Confidence: ${comp.usage_confidence ?? '—'}% (10%)\nError Rate: ${comp.error_rate_inv ?? '—'}% (5%)`;

                return `
                  <tr title="Click to view sessions for this model"
                    onclick="window.location.hash='#/sessions?model_id=${encodeURIComponent(m.model_id)}'">
                    <td style="padding-left:14px">
                      <div style="display:flex;align-items:center;gap:6px">
                        <div class="mono data-primary" style="font-size:12px">${m.model_id || '—'}</div>
                        <span style="font-size:9px;color:var(--accent-2);opacity:0.7">↗</span>
                      </div>
                      <div style="margin-top:4px;width:${Math.max(costWidth, 2)}%;height:3px;background:var(--accent);border-radius:99px;opacity:0.5"></div>
                    </td>
                    <td style="font-size:12px;color:var(--text-2)">${m.provider_id || '—'}</td>
                    <td>
                      <div style="display:flex;flex-wrap:wrap;gap:2px;align-items:center;max-width:180px">
                        ${agents.slice(0, 3).map(a => `<span class="badge" style="background:${agentColor(a)}22;color:${agentColor(a)};border:1px solid ${agentColor(a)}55;font-size:10px;margin:1px">${a}</span>`).join('')}
                        ${agents.length > 3 ? `<span class="text-dim" style="font-size:10px;margin-left:2px">+${agents.length - 3}</span>` : ''}
                      </div>
                    </td>
                    <td title="${pqTooltip.replace(/"/g, '&quot;')}">
                      <div style="display:flex;align-items:center;gap:5px">
                        <div style="position:relative;width:32px;height:32px;display:flex;align-items:center;justify-content:center">
                          <svg width="32" height="32" viewBox="0 0 36 36" style="transform:rotate(-90deg)">
                            <circle cx="18" cy="18" r="15" fill="none" stroke="var(--border)" stroke-width="3"/>
                            <circle cx="18" cy="18" r="15" fill="none" stroke="${pqColor}" stroke-width="3" stroke-dasharray="${pqs * 0.9425} 94.25" stroke-linecap="round"/>
                          </svg>
                          <span style="position:absolute;font-size:9px;font-weight:700;color:${pqColor}">${pqs}</span>
                        </div>
                        ${lcBadge}
                      </div>
                    </td>
                    <td><strong>${m.task_count}</strong></td>
                    <td style="color:var(--green);font-weight:600">${fmtCost(m.total_cost)}</td>
                    <td style="color:var(--text-2)">${fmtCost(m.avg_cost)}</td>
                    <td style="color:${tueColor};font-weight:600">${tueScore}</td>
                    <td style="color:${ceColor};font-weight:600">${ceScore}</td>
                    <td style="color:${errColor};font-weight:600">${errScore}</td>
                    <td style="color:${m.total_errors > 0 ? 'var(--red)' : 'var(--text-3)'};font-weight:${m.total_errors > 0 ? '600' : '400'}">
                      ${Math.round(m.total_errors)}
                    </td>
                    <td>
                      <div style="display:flex;align-items:center;gap:8px">
                        <div class="progress-bar" style="width:60px">
                          <div class="progress-fill ${completionPct > 70 ? 'green' : completionPct > 40 ? '' : 'red'}" style="width:${completionPct}%"></div>
                        </div>
                        <span style="font-size:11px;color:var(--text-3)">${completionPct}%</span>
                      </div>
                    </td>
                    <td style="font-size:12px;color:${cacheHit > 20 ? 'var(--cyan)' : 'var(--text-3)'}">${cacheHit}%</td>
                    <td>${m.with_reasoning > 0 ? '<span class="badge purple">🧠 Yes</span>' : '<span style="color:var(--text-3);font-size:12px">—</span>'}</td>
                    <td>${m.is_free ? '<span class="badge yellow">Free</span>' : '<span class="badge green">Paid</span>'}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>

      <!-- Phase 4: Model × Agent heatmap (which agents each model is being used by) -->
      <div class="panel">
        <div class="panel-title">
          <span>Model × Agent Heatmap</span>
          <span class="panel-title-meta">Task counts — click a cell to filter sessions</span>
        </div>
        <div class="panel-body">
          ${renderModelAgentHeatmap(agentMatrix)}
        </div>
      </div>
    `;

    // Render Radar Chart with top 5 models of the currently sorted list
    if (radarChartInstance) radarChartInstance.destroy();
    radarChartInstance = renderRadarChart('modelRadarChart', sortedModels);

    // Wire agent filter
    const agentSelect = container.querySelector('#models-agent-filter');
    if (agentSelect) {
      agentSelect.addEventListener('change', (e) => {
        const val = e.target.value;
        const newUrl = val ? `#/models?agent=${encodeURIComponent(val)}` : '#/models';
        window.location.hash = newUrl;
      });
    }

    // Wire sorting headers
    container.querySelectorAll('[data-sort-key]').forEach(header => {
      header.addEventListener('click', () => {
        const key = header.dataset.sortKey;
        if (sortKey === key) {
          sortDir = sortDir === 'desc' ? 'asc' : 'desc';
        } else {
          sortKey = key;
          sortDir = 'desc';
        }
        paint();
      });
    });
  };

  paint();
}

const SORTABLE_NUMERIC = new Set([
  'model_id', 'provider_id', 'pq_score', 'task_count', 'total_cost', 'avg_cost',
  'avg_tue', 'avg_rd', 'avg_ce', 'avg_err', 'total_errors', 'completed', 'cache_hit'
]);

function sortModelsList(models, key, dir) {
  if (!SORTABLE_NUMERIC.has(key)) return models;
  const sign = dir === 'asc' ? 1 : -1;
  return models.slice().sort((a, b) => {
    let av = a[key];
    let bv = b[key];

    // Special mappings for calculated fields
    if (key === 'completed') {
      av = a.task_count ? (a.completed / a.task_count) : 0;
      bv = b.task_count ? (b.completed / b.task_count) : 0;
    } else if (key === 'cache_hit') {
      av = (a.total_tokens_in + a.total_cache_reads) > 0 ? (a.total_cache_reads / (a.total_tokens_in + a.total_cache_reads)) : 0;
      bv = (b.total_tokens_in + b.total_cache_reads) > 0 ? (b.total_cache_reads / (b.total_tokens_in + b.total_cache_reads)) : 0;
    }

    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;

    if (typeof av === 'string') {
      return av.localeCompare(bv) * sign;
    }
    return (av - bv) * sign;
  });
}

function sortHeader(label, key) {
  const isActive = sortKey === key;
  const arrow = isActive ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ' ⇅';
  return `<span data-sort-key="${key}" style="cursor:pointer;color:${isActive ? 'var(--accent)' : 'inherit'};font-weight:600;white-space:nowrap">${label}<span style="font-size:9px;opacity:0.6">${arrow}</span></span>`;
}

function getSortLabel(key) {
  const map = {
    model_id: 'Model Name',
    provider_id: 'Provider',
    pq_score: 'PQ-Score',
    task_count: 'Sessions',
    total_cost: 'Total Cost',
    avg_cost: 'Avg Cost',
    avg_tue: 'Tool Use Efficacy',
    avg_rd: 'Reasoning Density',
    avg_ce: 'Context Efficiency',
    avg_err: 'Error Recovery',
    total_errors: 'Errors',
    completed: 'Completion Rate',
    cache_hit: 'Cache Efficiency'
  };
  return map[key] || key;
}

/**
 * Phase 4: render the sparse Model×Agent heatmap. The API returns parallel
 * arrays {rows, cols, values} where rows=models and cols=agents. Each cell
 * is colored by intensity (darker = more sessions).
 */
function renderModelAgentHeatmap(matrix) {
  if (!matrix || !matrix.rows?.length || !matrix.cols?.length) {
    return '<div class="empty-state"><p>No agent-model data yet</p></div>';
  }
  const max = Math.max(1, ...matrix.values.flat());
  const colWidth = 110;
  const rowHeight = 26;

  // API returns: rows=agents, cols=models, values[row][col]
  // We render: rows=models (left labels), cols=agents (top headers)
  // so the heatmap reads naturally: "which agents use which models"
  const header = matrix.rows.map(a => `
    <div style="position:sticky;top:0;background:var(--bg-2);padding:4px 6px;width:${colWidth}px;text-align:center;font-size:10px;font-weight:600;color:${agentColor(a)};border-bottom:1px solid var(--border);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escAttr(a)}">${a}</div>
  `).join('');

  const rows = matrix.cols.map((model, cIdx) => {
    const cells = matrix.rows.map((agent, rIdx) => {
      const v = matrix.values[rIdx][cIdx];
      if (!v) return `<div style="width:${colWidth}px;height:${rowHeight}px;background:transparent;border-right:1px solid var(--border);border-bottom:1px solid var(--border)"></div>`;
      const intensity = v / max;
      const bg = `rgba(91,158,245,${0.15 + intensity * 0.6})`;
      return `<div title="${escAttr(model)} × ${escAttr(agent)}: ${v} sessions" onclick="event.stopPropagation();window.location.hash='#/sessions?model_id=${encodeURIComponent(model)}&agent=${encodeURIComponent(agent)}'" style="cursor:pointer;width:${colWidth}px;height:${rowHeight}px;background:${bg};border-right:1px solid var(--border);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;color:${intensity > 0.5 ? 'var(--text)' : 'var(--text-2)'}">${v}</div>`;
    }).join('');
    return `
      <div style="display:flex">
        <div style="position:sticky;left:0;background:var(--bg-2);padding:4px 8px;width:160px;font-size:11px;color:var(--text);border-right:1px solid var(--border);border-bottom:1px solid var(--border);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${escAttr(matrix.cols[cIdx])}">${model.split('/').pop()}</div>
        ${cells}
      </div>
    `;
  }).join('');

  return `
    <div style="overflow:auto;max-height:480px;border:1px solid var(--border);border-radius:6px">
      <div style="display:flex;background:var(--bg-2);position:sticky;top:0;z-index:1">
        <div style="position:sticky;left:0;background:var(--bg-2);width:160px;border-right:1px solid var(--border);border-bottom:1px solid var(--border)"></div>
        ${header}
      </div>
      ${rows}
    </div>
  `;
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"').replace(/'/g,'&#39;');
}

function escAttr(s) { return String(s).replace(/&/g,'&').replace(/</g,'<').replace(/>/g,'>').replace(/"/g,'"'); }

export async function renderCosts(container, dateRange = {}) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading cost data...</p></div>`;
  const params = {};
  if (dateRange.from) params.from = dateRange.from;
  if (dateRange.to)   params.to   = dateRange.to;
  const [costs, models] = await Promise.all([api.costs({ ...params, groupBy: 'day' }), api.models(params)]);
  // Sum from the costs API (tasks table, no double-counting) — matches Overview total_cost
  const totalCost = (costs.byTime || []).reduce((s, d) => s + (d.cost || 0), 0);

  container.innerHTML = `
    <div class="top-bar">
      <div>
        <h1 class="view-title">Cost & Tokens</h1>
        <p class="view-subtitle">Total spend: <strong style="color:var(--green)">${fmtCost(totalCost)}</strong> · <span style="color:var(--accent-2);font-size:11px">Click a bar to see sessions ↗</span></p>
      </div>
      <!-- date picker injected here -->
    </div>

    <div class="panel">
      <div class="panel-title">Cost by Model</div>
      <div class="panel-body">
        <div style="height:${Math.max(models.length * 36 + 24, 200)}px;position:relative">
          <canvas id="costByModelChart"></canvas>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Daily Cost Trend</div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Date</th><th>Sessions</th><th>Cost</th><th>Tokens In</th><th>Tokens Out</th><th>Cached</th></tr></thead>
          <tbody>
            ${(costs.byTime || []).slice(-30).reverse().map(d => `
              <tr>
                <td>${d.period}</td>
                <td><strong>${d.task_count}</strong></td>
                <td style="color:var(--green);font-weight:600">${fmtCost(d.cost)}</td>
                <td style="font-size:12px;color:var(--text-2)">${fmtK(d.tokens_in)}</td>
                <td style="font-size:12px;color:var(--text-2)">${fmtK(d.tokens_out)}</td>
                <td style="font-size:12px;color:var(--cyan)">${fmtK(d.cache_reads)}</td>
              </tr>
            `).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-3)">No data</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  setTimeout(() => renderCostChart('costByModelChart', models, totalCost), 0);
}

export async function renderTools(container, dateRange = {}, queryParams = new URLSearchParams()) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading tool data...</p></div>`;
  const params = {};
  if (dateRange.from) params.from = dateRange.from;
  if (dateRange.to)   params.to   = dateRange.to;
  // Phase 4: read agent filter from URL
  const urlAgent = queryParams.get('agent');
  if (urlAgent) params.agent = urlAgent;
  const [data, seqData, agentsData] = await Promise.all([
    api.tools(params),
    api.sequences(params),
    api.agents(params).catch(() => ({ agents: [] })),
  ]);

  const tools = data.topTools || [];

  container.innerHTML = `
    <div class="top-bar">
      <div>
        <h1 class="view-title">Tool Usage</h1>
        <p class="view-subtitle">Agent tool calls across all sessions${urlAgent ? ` · <span style="color:var(--accent-2)">filtered by: ${escHtml(urlAgent)}</span>` : ''} · <span style="color:var(--accent-2);font-size:11px">Click a bar to see sessions using that tool ↗</span></p>
      </div>
      <!-- date picker injected here -->
    </div>

    <div class="filters-bar" style="margin-bottom:14px">
      <span style="font-size:12px;color:var(--text-3)">Agent:</span>
      <select id="tools-agent-filter" class="filter-select" style="padding:4px 8px">
        <option value="">All Agents</option>
        ${(agentsData.agents || []).map(a => `
          <option value="${escAttr(a.agent)}" ${urlAgent === a.agent ? 'selected' : ''}>${escHtml(a.agent)} (${a.task_count})</option>
        `).join('')}
      </select>
    </div>

    <div class="panel">
      <div class="panel-title">Top Tools Used <span style="font-weight:400;color:var(--text-3);font-size:10px;text-transform:none">(interactive — click to drilldown)</span></div>
      <div class="panel-body">
        <div style="height:${Math.max(tools.length * 36 + 24, 220)}px;position:relative">
          <canvas id="toolsChart"></canvas>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-title">
          <span>Common Tool Sequences</span>
          <span class="panel-title-meta">Step A → Step B</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Sequence</th><th>Frequency</th></tr></thead>
            <tbody>
              ${(seqData.target || []).map(s => `
                <tr>
                  <td style="line-height:2.2">
                    ${s.steps.map((st, i) => `
                      <span class="badge ${i === 0 ? 'blue' : i === s.steps.length - 1 ? 'accent' : 'purple'}" style="white-space:nowrap">${st}</span>
                      ${i < s.steps.length - 1 ? `<span style="color:var(--text-3);margin:0 4px">→</span>` : ''}
                    `).join('')}
                  </td>
                  <td><strong>${s.count}</strong></td>
                </tr>
              `).join('') || '<tr><td colspan="2" style="text-align:center;color:var(--text-3)">No sequences detected</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-title">Common Commands Executed</div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Command</th><th>Count</th></tr></thead>
            <tbody>
              ${(data.commandTypes || []).map(c => `
                <tr>
                  <td class="mono" style="font-size:11px">${c.command_text}</td>
                  <td><strong>${c.count}</strong></td>
                </tr>
              `).join('') || '<tr><td colspan="2" style="text-align:center;color:var(--text-3)">No commands</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;

  setTimeout(() => renderToolsChart('toolsChart', tools), 0);

  // Wire agent filter
  const agentSelect = container.querySelector('#tools-agent-filter');
  if (agentSelect) {
    agentSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      const newUrl = val ? `#/tools?agent=${encodeURIComponent(val)}` : '#/tools';
      window.location.hash = newUrl;
    });
  }
}

function fmtK(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n/1000000).toFixed(1)+'M';
  if (n >= 1000) return (n/1000).toFixed(0)+'K';
  return n;
}
