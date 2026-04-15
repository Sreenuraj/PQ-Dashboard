import { api } from '../api.js';
import { renderErrorTrendChart, renderDoughnutChart } from '../components/charts.js';

const API_ERROR_CATEGORIES = [
  'api_failure', 'rate_limit_error', 'timeout_error', 'availability_error',
  'provider_error', 'auth_error', 'billing_error', 'moderation_error', 'prompt_error'
];

const TOOL_ERROR_CATEGORIES = ['tool_error', 'compliance_error'];

export async function renderErrors(container, dateRange = {}) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading errors...</p></div>`;
  const params = {};
  if (dateRange.from) params.from = dateRange.from;
  if (dateRange.to)   params.to   = dateRange.to;
  const data = await api.errors(params);
  const total = data.byCategory?.reduce((s, r) => s + r.count, 0) || 0;

  // Current filter state
  let activeFilter = 'all';
  let activeModelFilter = 'all';

  function getFilteredData() {
    let rawModels = data.byModel || [];
    let rawOverTime = data.overTime || [];

    if (activeFilter !== 'all') {
      const cats = activeFilter === 'api' ? API_ERROR_CATEGORIES : 
                   activeFilter === 'tool' ? TOOL_ERROR_CATEGORIES : [];
      
      const catCheck = (c) => activeFilter === 'other' 
        ? !API_ERROR_CATEGORIES.includes(c) && !TOOL_ERROR_CATEGORIES.includes(c)
        : cats.includes(c);

      rawModels = rawModels.filter(r => catCheck(r.error_category));
      rawOverTime = rawOverTime.filter(r => catCheck(r.error_category));
    }

    if (activeModelFilter !== 'all') {
      rawModels = rawModels.filter(r => r.model_id === activeModelFilter);
      rawOverTime = rawOverTime.filter(r => r.model_id === activeModelFilter);
    }

    // Aggregate byCategory from the filtered byModel data
    const catMap = {};
    rawModels.forEach(r => {
      if (!catMap[r.error_category]) catMap[r.error_category] = 0;
      catMap[r.error_category] += r.count;
    });
    const byCategory = Object.entries(catMap).map(([k, v]) => ({ error_category: k, count: v }));

    // Aggregate overTime (in case 'all' models is selected, we must collapse the same day/cat combinations)
    const timeMap = {};
    rawOverTime.forEach(r => {
      const key = r.day + '|' + r.error_category;
      if (!timeMap[key]) timeMap[key] = { day: r.day, error_category: r.error_category, count: 0 };
      timeMap[key].count += r.count;
    });
    const overTime = Object.values(timeMap);
    
    return { byCategory, byModel: rawModels, overTime };
  }

  function render() {
    const filtered = getFilteredData();
    const filteredTotal = filtered.byCategory?.reduce((s, r) => s + r.count, 0) || 0;

    container.innerHTML = `
    <div class="top-bar">
      <div>
        <h1 class="view-title">Error Analytics</h1>
        <p class="view-subtitle">${filteredTotal} error events${activeFilter !== 'all' ? ` (filtered from ${total})` : ''}</p>
      </div>
    </div>

    <div class="error-filter-bar" style="margin-bottom:16px;display:flex;gap:16px;flex-wrap:wrap;align-items:center">
      <div style="display:flex;gap:8px;align-items:center">
        <span style="font-size:12px;color:var(--text-3);margin-right:4px">Category:</span>
        ${['all', 'api', 'tool', 'other'].map(f => `
          <button class="filter-pill ${activeFilter === f ? 'active' : ''}" data-filter="${f}" id="error-filter-${f}">
            ${f === 'all' ? `All` : 
              f === 'api' ? `API Errors` :
              f === 'tool' ? `Tool Errors` :
              `Other`}
          </button>
        `).join('')}
      </div>

      <div style="display:flex;gap:8px;align-items:center">
        <span style="font-size:12px;color:var(--text-3)">Model:</span>
        <select id="error-model-select" class="filter-select" style="padding:4px 8px">
          <option value="all">All Models</option>
          ${[...new Set((data.byModel || []).map(r => r.model_id))].filter(Boolean).map(m => `
            <option value="${m}" ${activeModelFilter === m ? 'selected' : ''}>${m}</option>
          `).join('')}
        </select>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-title">Error Types Breakdown</div>
        <div class="panel-body chart-wrap tall" style="display:flex;align-items:center;justify-content:center">
          ${filtered.byCategory?.length ? `<canvas id="errorTypesDoughnut"></canvas>` : '<div style="color:var(--text-3);font-size:13px">No errors found 🎉</div>'}
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">Error Cascades / Trend</div>
        <div class="panel-body chart-wrap tall">
          <canvas id="errorTrendChart"></canvas>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-title">Errors by Model</div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Model</th><th>Error Type</th><th>Count</th></tr></thead>
            <tbody>
              ${(filtered.byModel || []).slice(0, 15).map(r => `
                <tr class="hover-row" onclick="window.location.hash='#/sessions?model_id=${encodeURIComponent(r.model_id)}&error_category=${encodeURIComponent(r.error_category)}'">
                  <td class="mono" style="font-size:11px">${r.provider_id ? `<span style="color:var(--text-3)">${r.provider_id}/</span>` : ''}${r.model_id || '—'}</td>
                  <td><span class="badge ${errorBadgeColor(r.error_category)}">${formatErrorCategory(r.error_category)}</span></td>
                  <td><strong>${r.count}</strong></td>
                </tr>
              `).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text-3)">No data</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <!-- Export panel -->
    <div class="panel" id="export-panel-section">
      <div class="panel-title">
        <span>Export Errors</span>
        <span class="panel-title-meta" id="export-count-label">${filteredTotal} errors will be exported</span>
      </div>
      <div class="panel-body" style="display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <div style="display:flex;gap:8px;align-items:center">
          <label style="font-size:12px;color:var(--text-2)">Format:</label>
          <select id="export-format" class="filter-select" style="padding:4px 10px">
            <option value="csv">CSV</option>
            <option value="json">JSON</option>
          </select>
        </div>
        <button class="btn-primary" id="export-btn" style="font-size:12px;padding:6px 16px">
          ↓ Export ${activeFilter !== 'all' ? `(${activeFilter} errors)` : 'All'}
        </button>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Error Categories Explained</div>
      <div class="panel-body" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px">
        ${ERROR_EXPLANATIONS.map(e => `
          <div style="padding:12px;background:var(--bg-3);border-radius:var(--radius-sm)">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
              <span class="badge ${errorBadgeColor(e.key)}">${formatErrorCategory(e.key)}</span>
            </div>
            <div style="font-size:12px;color:var(--text-2)">${e.desc}</div>
          </div>
        `).join('')}
      </div>
    </div>
  `;

    setTimeout(() => {
      renderErrorTrendChart('errorTrendChart', filtered.overTime || []);
      
      if (filtered.byCategory?.length) {
        // Group by category to build labels and data array
        const labels = filtered.byCategory.map(r => formatErrorCategory(r.error_category));
        const chartData = filtered.byCategory.map(r => r.count);
        renderDoughnutChart('errorTypesDoughnut', labels, chartData);
      }
    }, 0);

    // Wire filter pills
    container.querySelectorAll('.filter-pill').forEach(pill => {
      pill.addEventListener('click', () => {
        activeFilter = pill.dataset.filter;
        render();
      });
    });

    // Wire model select
    const modelSelect = container.querySelector('#error-model-select');
    if (modelSelect) {
      modelSelect.addEventListener('change', (e) => {
        activeModelFilter = e.target.value;
        render();
      });
    }

    // Wire export button
    const exportBtn = container.querySelector('#export-btn');
    if (exportBtn) {
      exportBtn.addEventListener('click', async () => {
        const format = container.querySelector('#export-format').value;
        const categories = activeFilter === 'all' ? '' :
          activeFilter === 'api' ? API_ERROR_CATEGORIES.join(',') :
          activeFilter === 'tool' ? TOOL_ERROR_CATEGORIES.join(',') : 'other';

        const exportParams = { format };
        if (dateRange.from) exportParams.from = dateRange.from;
        if (dateRange.to) exportParams.to = dateRange.to;
        if (categories) exportParams.categories = categories;
        if (activeModelFilter !== 'all') exportParams.model_id = activeModelFilter;

        try {
          exportBtn.textContent = 'Exporting...';
          exportBtn.disabled = true;
          const response = await fetch(`/api/analytics/errors/export?${new URLSearchParams(exportParams)}`);
          if (!response.ok) throw new Error(`Export failed: ${response.status}`);
          
          const blob = await response.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `pq-errors-export.${format}`;
          a.click();
          URL.revokeObjectURL(url);
        } catch (err) {
          console.error('Export error:', err);
          alert('Export failed: ' + err.message);
        } finally {
          exportBtn.textContent = `↓ Export ${activeFilter !== 'all' ? `(${activeFilter} errors)` : 'All'}`;
          exportBtn.disabled = false;
        }
      });
    }
  }

  render();
}

function countCats(data, categories) {
  return (data.byCategory || [])
    .filter(r => categories.includes(r.error_category))
    .reduce((s, r) => s + r.count, 0);
}

const ERROR_EXPLANATIONS = [
  { key: 'api_failure',      desc: 'API call returned zero tokens/cost — model busy, rate limited, or provider down (detected by cost=0 signal)' },
  { key: 'tool_error',       desc: 'Tool execution failed with an error message (e.g., file not found, invalid operation)' },
  { key: 'compliance_error', desc: 'Agent didn\'t follow tool-use instructions — "You did not use a tool" responses' },
  { key: 'rate_limit_error', desc: 'OpenRouter/provider returned HTTP 429 — too many requests' },
  { key: 'timeout_error',    desc: 'Request timed out (HTTP 408) — model took too long to respond' },
  { key: 'availability_error', desc: 'Model unavailable/busy (HTTP 503) — no provider instances available' },
  { key: 'provider_error',   desc: 'Bad gateway (HTTP 502) — upstream provider returned invalid response' },
  { key: 'auth_error',       desc: 'API key invalid or expired (HTTP 401)' },
  { key: 'billing_error',    desc: 'Insufficient credits (HTTP 402)' },
  { key: 'moderation_error', desc: 'Content flagged by provider safety filters (HTTP 403)' },
  { key: 'prompt_error',     desc: 'Context length exceeded or bad request parameters (HTTP 400)' },
  { key: 'interruption',     desc: 'Task was interrupted and resumed — model may have been unresponsive' },
];

function formatErrorCategory(cat) {
  return (cat || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function errorColor(cat) {
  const map = {
    api_failure: 'var(--red)',
    rate_limit_error: 'var(--yellow)',
    timeout_error: 'var(--yellow)',
    availability_error: 'var(--yellow)',
    provider_error: 'var(--red)',
    tool_error: 'var(--blue)',
    compliance_error: 'var(--purple)',
    auth_error: 'var(--red)',
    billing_error: 'var(--red)',
    moderation_error: 'var(--red)',
    prompt_error: 'var(--yellow)',
    interruption: 'var(--text-3)',
  };
  return map[cat] || 'var(--text-3)';
}

function errorBadgeColor(cat) {
  const high = ['api_failure','provider_error','auth_error','billing_error','moderation_error'];
  const med  = ['rate_limit_error','timeout_error','availability_error','prompt_error','tool_error'];
  if (high.includes(cat)) return 'red';
  if (med.includes(cat))  return 'yellow';
  if (cat === 'compliance_error') return 'purple';
  return 'grey';
}
