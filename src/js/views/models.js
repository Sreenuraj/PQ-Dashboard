import { api } from '../api.js';
import { fmtCost, agentColor } from '../utils.js';
import { renderRadarChart, renderCostChart, renderToolsChart } from '../components/charts.js';
import { metricTooltip, hydrateMetricTooltips } from '../components/metric-tooltip.js';

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
      <div class="panel-title">Model Efficiency Matrix <span style="font-weight:400;color:var(--text-3);font-size:10px;text-transform:none">(all models)</span></div>
      <div class="panel-body">
        <div class="chart-wrap tall">
          <canvas id="modelRadarChart"></canvas>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">
        <span>Model Performance Table</span>
        <span class="panel-title-meta">Relative cost bar appears beside each model · hover ${metricTooltip('tue').match(/pq-metric-tip-icon.{0,200}/)?.[0] ? '?' : '?'} for metric definitions</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Model</th>
              <th>Provider</th>
              <th>Agent</th>  <!-- Phase 4: Mode → Agent -->
              <th>Sessions</th>
              <th>Total Cost</th><th>Avg Cost</th>
              <th>${metricTooltip('tue')} Tool Use Efficacy</th>
              <th>${metricTooltip('rd')} Reasoning Density</th>
              <th>${metricTooltip('ce')} Context Efficiency</th>
              <th>${metricTooltip('err')} Error Recovery</th>
              <th>Errors</th>
              <th>Completion Rate</th><th>Cache %</th><th>Reasoning</th><th>Tier</th>
            </tr>
          </thead>
          <tbody>
            ${models.map(m => {
              const completionPct = m.task_count > 0 ? Math.round(m.completed / m.task_count * 100) : 0;
              const cacheHit = (m.total_tokens_in + m.total_cache_reads) > 0
                ? Math.round(m.total_cache_reads / (m.total_tokens_in + m.total_cache_reads) * 100) : 0;
              const costWidth = maxModelCost > 0 ? (m.total_cost / maxModelCost * 100) : 0;
              const tueScore = m.avg_tue == null ? '—' : `${Math.round(m.avg_tue)}%`;
              const rdScore  = m.avg_rd  == null ? '—' : `${Math.round(m.avg_rd)}%`;
              const ceScore  = m.avg_ce  == null ? '—' : `${Math.round(m.avg_ce)}%`;
              const errScore = m.avg_err == null ? '—' : `${Math.round(m.avg_err)}%`;
              const tueColor = m.avg_tue == null ? 'var(--text-3)' : (m.avg_tue >= 80 ? '#5BF58C' : m.avg_tue >= 50 ? '#F5C85B' : '#F55B5B');
              const rdColor  = m.avg_rd  == null ? 'var(--text-3)' : (m.avg_rd  >= 10 ? '#5BF58C' : m.avg_rd  >= 3 ? '#F5C85B' : '#F55B5B');
              const ceColor  = m.avg_ce  == null ? 'var(--text-3)' : (m.avg_ce  >= 50 ? '#5BF58C' : m.avg_ce  >= 20 ? '#F5C85B' : '#F55B5B');
              const errColor = m.avg_err == null ? 'var(--text-3)' : (m.avg_err >= 80 ? '#5BF58C' : m.avg_err >= 30 ? '#F5C85B' : '#F55B5B');

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
                  <td>${(m.agents || m.mode ? [m.agents ? m.agents.split(',') : [m.mode]].flat().filter(Boolean) : []).map(a => `<span class="badge" style="background:${agentColor(a)}22;color:${agentColor(a)};border:1px solid ${agentColor(a)}55;font-size:10px;margin:1px">${a}</span>`).join('') || '—'}</td>
                  <td><strong>${m.task_count}</strong></td>
                  <td style="color:var(--green);font-weight:600">${fmtCost(m.total_cost)}</td>
                  <td style="color:var(--text-2)">${fmtCost(m.avg_cost)}</td>
                  <td style="color:${tueColor};font-weight:600">${tueScore}</td>
                  <td style="color:${rdColor};font-weight:600">${rdScore}</td>
                  <td style="color:${ceColor};font-weight:600">${ceScore}</td>
                  <td style="color:${errColor};font-weight:600">${errScore}</td>
                  <td style="color:${m.total_errors > 0 ? 'var(--red)' : 'var(--text-3)'};font-weight:${m.total_errors > 0 ? '600' : '400'}">
                    ${m.total_errors}
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

  setTimeout(() => renderRadarChart('modelRadarChart', models), 0);
  await hydrateMetricTooltips();

  // Wire agent filter
  const agentSelect = container.querySelector('#models-agent-filter');
  if (agentSelect) {
    agentSelect.addEventListener('change', (e) => {
      const val = e.target.value;
      const newUrl = val ? `#/models?agent=${encodeURIComponent(val)}` : '#/models';
      window.location.hash = newUrl;
    });
  }
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
