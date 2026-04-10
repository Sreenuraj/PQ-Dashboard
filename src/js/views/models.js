import { api } from '../api.js';
import { fmtCost } from '../utils.js';
import { renderRadarChart, renderCostChart, renderToolsChart } from '../components/charts.js';

export async function renderModels(container, dateRange = {}) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading models...</p></div>`;
  const params = {};
  if (dateRange.from) params.from = dateRange.from;
  if (dateRange.to)   params.to   = dateRange.to;
  const models = await api.models(params);

  if (!models.length) {
    container.innerHTML = `<div class="empty-state"><div class="icon">◉</div><p>No model data yet. Run a refresh.</p></div>`;
    return;
  }

  container.innerHTML = `
    <div class="top-bar">
      <div>
        <h1 class="view-title">Model Analytics</h1>
        <p class="view-subtitle">${models.length} distinct models · <span style="color:var(--accent-2);font-size:11px">Click any row to see sessions for that model ↗</span></p>
      </div>
      <!-- date picker injected here -->
    </div>

    <!-- RADAR CHART -->
    <div class="panel">
      <div class="panel-title">Model Efficiency Matrix <span style="font-weight:400;color:var(--text-3);font-size:10px;text-transform:none">(top 5 models)</span></div>
      <div class="chart-wrap tall">
        <canvas id="modelRadarChart"></canvas>
      </div>
    </div>

    <div class="panel" style="padding:0;overflow:hidden">
      <table class="data-table">
        <thead>
          <tr>
            <th>Model <span style="font-weight:400;color:var(--text-3);font-size:9px">↕ bar = relative cost</span></th>
            <th>Provider</th><th>Mode</th><th>Sessions</th>
            <th>Total Cost</th><th>Avg Cost</th><th>Errors</th>
            <th>Completion Rate</th><th>Cache %</th><th>Reasoning</th><th>Tier</th>
          </tr>
        </thead>
        <tbody>
          ${models.map(m => {
            const maxCost = Math.max(...models.map(x => x.total_cost || 0));
            const completionPct = m.task_count > 0 ? Math.round(m.completed / m.task_count * 100) : 0;
            const cacheHit = (m.total_tokens_in + m.total_cache_reads) > 0
              ? Math.round(m.total_cache_reads / (m.total_tokens_in + m.total_cache_reads) * 100) : 0;
            const costWidth = maxCost > 0 ? (m.total_cost / maxCost * 100) : 0;

            return `
              <tr style="cursor:pointer" title="Click to view sessions for this model"
                onclick="window.location.hash='#/sessions?model_id=${encodeURIComponent(m.model_id)}'">
                <td style="padding-left:14px">
                  <div style="display:flex;align-items:center;gap:6px">
                    <div class="mono" style="font-size:12px">${m.model_id || '—'}</div>
                    <span style="font-size:9px;color:var(--accent-2);opacity:0.7">↗</span>
                  </div>
                  <div style="margin-top:4px;width:${Math.max(costWidth,2)}%;height:3px;background:var(--accent);border-radius:99px;opacity:0.5"></div>
                </td>
                <td style="font-size:12px;color:var(--text-2)">${m.provider_id || '—'}</td>
                <td><span class="badge grey" style="font-size:10px">${m.mode || '—'}</span></td>
                <td style="font-weight:600">${m.task_count}</td>
                <td style="color:var(--green);font-weight:600">${fmtCost(m.total_cost)}</td>
                <td style="color:var(--text-2)">${fmtCost(m.avg_cost)}</td>
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
  `;

  setTimeout(() => renderRadarChart('modelRadarChart', models), 0);
}

export async function renderCosts(container, dateRange = {}) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading cost data...</p></div>`;
  const params = {};
  if (dateRange.from) params.from = dateRange.from;
  if (dateRange.to)   params.to   = dateRange.to;
  const [costs, models] = await Promise.all([api.costs({ ...params, groupBy: 'day' }), api.models(params)]);
  const totalCost = models.reduce((s, m) => s + (m.total_cost || 0), 0);

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
      <div style="height:${Math.max(models.length * 36 + 24, 200)}px;position:relative">
        <canvas id="costByModelChart"></canvas>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Daily Cost Trend</div>
      <table class="data-table">
        <thead><tr><th>Date</th><th>Sessions</th><th>Cost</th><th>Tokens In</th><th>Tokens Out</th><th>Cached</th></tr></thead>
        <tbody>
          ${(costs.byTime || []).slice(-30).reverse().map(d => `
            <tr>
              <td>${d.period}</td>
              <td>${d.task_count}</td>
              <td style="color:var(--green);font-weight:600">${fmtCost(d.cost)}</td>
              <td style="font-size:12px;color:var(--text-2)">${fmtK(d.tokens_in)}</td>
              <td style="font-size:12px;color:var(--text-2)">${fmtK(d.tokens_out)}</td>
              <td style="font-size:12px;color:var(--cyan)">${fmtK(d.cache_reads)}</td>
            </tr>
          `).join('') || '<tr><td colspan="6" style="text-align:center;color:var(--text-3)">No data</td></tr>'}
        </tbody>
      </table>
    </div>
  `;

  setTimeout(() => renderCostChart('costByModelChart', models, totalCost), 0);
}

export async function renderTools(container, dateRange = {}) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading tool data...</p></div>`;
  const params = {};
  if (dateRange.from) params.from = dateRange.from;
  if (dateRange.to)   params.to   = dateRange.to;
  const [data, seqData] = await Promise.all([
    api.tools(params),
    api.sequences(params)
  ]);

  const tools = data.topTools || [];

  container.innerHTML = `
    <div class="top-bar">
      <div>
        <h1 class="view-title">Tool Usage</h1>
        <p class="view-subtitle">Agent tool calls across all sessions · <span style="color:var(--accent-2);font-size:11px">Click a bar to see sessions using that tool ↗</span></p>
      </div>
      <!-- date picker injected here -->
    </div>

    <div class="panel">
      <div class="panel-title">Top Tools Used <span style="font-weight:400;color:var(--text-3);font-size:10px;text-transform:none">(interactive — click to drilldown)</span></div>
      <div style="height:${Math.max(tools.length * 36 + 24, 220)}px;position:relative">
        <canvas id="toolsChart"></canvas>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-title">Common Tool Sequences <span style="font-weight:400;color:var(--text-3);font-size:10px;text-transform:none">(Step A → Step B)</span></div>
        <table class="data-table">
          <thead><tr><th>Sequence</th><th>Frequency</th></tr></thead>
          <tbody>
            ${(seqData.target || []).map(s => `
              <tr>
                <td>
                  <span class="badge blue">${s.source}</span>
                  <span style="color:var(--text-3);margin:0 8px">→</span>
                  <span class="badge accent">${s.target}</span>
                </td>
                <td style="font-weight:600">${s.count}</td>
              </tr>
            `).join('') || '<tr><td colspan="2" style="text-align:center;color:var(--text-3)">No sequences detected</td></tr>'}
          </tbody>
        </table>
      </div>
      <div class="panel">
        <div class="panel-title">Common Commands Executed</div>
        <table class="data-table">
          <thead><tr><th>Command</th><th>Count</th></tr></thead>
          <tbody>
            ${(data.commandTypes || []).map(c => `
              <tr>
                <td class="mono" style="font-size:11px">${c.command_text}</td>
                <td style="font-weight:600">${c.count}</td>
              </tr>
            `).join('') || '<tr><td colspan="2" style="text-align:center;color:var(--text-3)">No commands</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
  `;

  setTimeout(() => renderToolsChart('toolsChart', tools), 0);
}

function fmtK(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n/1000000).toFixed(1)+'M';
  if (n >= 1000) return (n/1000).toFixed(0)+'K';
  return n;
}
