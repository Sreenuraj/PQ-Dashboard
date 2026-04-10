import { api } from '../api.js';
import { fmtCost, fmtDuration } from '../utils.js';
import { renderRadarChart } from '../components/charts.js';

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

  const maxCost = Math.max(...models.map(m => m.total_cost || 0));
  const maxTasks = Math.max(...models.map(m => m.task_count || 0));

  container.innerHTML = `
    <div class="top-bar">
      <div>
        <h1 class="view-title">Model Analytics</h1>
        <p class="view-subtitle">${models.length} distinct models used across all sessions</p>
      </div>
      <!-- date picker injected here -->
    </div>

    <!-- RADAR CHART -->
    <div class="panel">
      <div class="panel-title">Model Efficiency Matrix</div>
      <div class="chart-wrap tall">
        <canvas id="modelRadarChart"></canvas>
      </div>
    </div>

    <div class="panel" style="padding:0;overflow:hidden">
      <table class="data-table">
        <thead>
          <tr>
            <th>Model</th>
            <th>Provider</th>
            <th>Mode</th>
            <th>Sessions</th>
            <th>Total Cost</th>
            <th>Avg Cost</th>
            <th>Errors</th>
            <th>Completion Rate</th>
            <th>Cache %</th>
            <th>Reasoning</th>
            <th>Tier</th>
          </tr>
        </thead>
        <tbody>
          ${models.map(m => {
            const errRate = m.total_api_calls > 0 ? (m.total_errors / m.total_api_calls * 100).toFixed(1) : 0;
            const completionPct = m.task_count > 0 ? Math.round(m.completed / m.task_count * 100) : 0;
            const cacheHit = (m.total_tokens_in + m.total_cache_reads) > 0
              ? Math.round(m.total_cache_reads / (m.total_tokens_in + m.total_cache_reads) * 100) : 0;
            const costWidth = maxCost > 0 ? (m.total_cost / maxCost * 100) : 0;

            return `
              <tr class="hover-row" style="cursor:pointer" onclick="window.location.hash='#/sessions?model_id=${encodeURIComponent(m.model_id)}'">
                <td style="padding-left:14px">
                  <div class="mono" style="font-size:12px">${m.model_id || '—'}</div>
                  <div style="margin-top:4px;width:${Math.max(costWidth,2)}%;height:3px;background:var(--accent);border-radius:99px;opacity:0.6"></div>
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
        <p class="view-subtitle">Total: <strong style="color:var(--green)">${fmtCost(totalCost)}</strong></p>
      </div>
      <!-- date picker injected here -->
    </div>

    <div class="panel">
      <div class="panel-title">Cost by Model</div>
      <div class="error-bar-list">
        ${models.sort((a,b) => b.total_cost - a.total_cost).map(m => {
          const pct = totalCost > 0 ? (m.total_cost / totalCost * 100) : 0;
          return `
            <div class="error-bar-item">
              <div class="error-bar-label mono" style="font-size:11px">${(m.model_id||'?').split('/').pop()}</div>
              <div class="error-bar-track">
                <div class="error-bar-fill" style="width:${pct}%;background:var(--accent)"></div>
              </div>
              <div style="font-size:12px;color:var(--green);min-width:60px;text-align:right">${fmtCost(m.total_cost)}</div>
            </div>`;
        }).join('') || '<div style="color:var(--text-3)">No data</div>'}
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
  const maxCount = Math.max(...(data.topTools||[]).map(t => t.count), 1);

  container.innerHTML = `
    <div class="top-bar">
      <div>
        <h1 class="view-title">Tool Usage</h1>
        <p class="view-subtitle">Agent tool calls across all sessions</p>
      </div>
      <!-- date picker injected here -->
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-title">Top Tools Used</div>
        <div class="error-bar-list">
          ${(data.topTools || []).map(t => `
            <div class="error-bar-item" style="cursor:pointer" onclick="window.location.hash='#/sessions?tool_name=${encodeURIComponent(t.tool_name)}'">
              <div class="error-bar-label mono" style="font-size:11px;color:var(--text)">${t.tool_name}</div>
              <div class="error-bar-track">
                <div class="error-bar-fill" style="width:${t.count/maxCount*100}%;background:var(--blue)"></div>
              </div>
              <div class="error-bar-count">${t.count}</div>
            </div>
          `).join('') || '<div style="color:var(--text-3)">No tool data</div>'}
        </div>
      </div>
      <div class="panel">
        <div class="panel-title">Common Commands</div>
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

    <div class="panel" style="margin-top:16px">
      <div class="panel-title">Common Tool Sequences</div>
      <table class="data-table">
        <thead><tr><th>Sequence (Step A → Step B)</th><th>Frequency</th></tr></thead>
        <tbody>
          ${(seqData.target || []).map(s => `
            <tr>
              <td>
                <span class="badge blue">${s.source}</span>
                <span style="color:var(--text-3);margin:0 8px">→</span>
                <span class="badge blue">${s.target}</span>
              </td>
              <td style="font-weight:600">${s.count}</td>
            </tr>
          `).join('') || '<tr><td colspan="2" style="text-align:center;color:var(--text-3)">No sequences detected</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

function fmtK(n) {
  if (!n) return '0';
  if (n >= 1000000) return (n/1000000).toFixed(1)+'M';
  if (n >= 1000) return (n/1000).toFixed(0)+'K';
  return n;
}
