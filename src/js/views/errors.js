import { api } from '../api.js';
import { renderErrorTrendChart } from '../components/charts.js';

export async function renderErrors(container, dateRange = {}) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading errors...</p></div>`;
  const params = {};
  if (dateRange.from) params.from = dateRange.from;
  if (dateRange.to)   params.to   = dateRange.to;
  const data = await api.errors(params);
  const total = data.byCategory?.reduce((s, r) => s + r.count, 0) || 0;

  container.innerHTML = `
    <div class="top-bar">
      <div>
        <h1 class="view-title">Error Analytics</h1>
        <p class="view-subtitle">${total} total error events detected</p>
      </div>
      <!-- date picker injected here -->
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-title">Error Types</div>
        <div class="error-bar-list">
          ${(data.byCategory || []).map(r => {
            const pct = total > 0 ? (r.count / total * 100) : 0;
            return `
              <div class="error-bar-item hover-row" style="cursor:pointer" onclick="window.location.hash='#/sessions?error_category=${encodeURIComponent(r.error_category)}'">
                <div class="error-bar-label">${formatErrorCategory(r.error_category)}</div>
                <div class="error-bar-track">
                  <div class="error-bar-fill" style="width:${pct}%;background:${errorColor(r.error_category)}"></div>
                </div>
                <div class="error-bar-count">${r.count}</div>
              </div>`;
          }).join('') || '<div style="color:var(--text-3);font-size:13px">No errors found 🎉</div>'}
        </div>
      </div>

      <div class="panel">
        <div class="panel-title">Error Cascades / Trend</div>
        <div class="chart-wrap tall">
          <canvas id="errorTrendChart"></canvas>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-title">Errors by Model</div>
        <table class="data-table">
          <thead><tr><th>Model</th><th>Error Type</th><th>Count</th></tr></thead>
          <tbody>
            ${(data.byModel || []).slice(0, 15).map(r => `
              <tr class="hover-row" style="cursor:pointer" onclick="window.location.hash='#/sessions?model_id=${encodeURIComponent(r.model_id)}&error_category=${encodeURIComponent(r.error_category)}'">
                <td class="mono" style="font-size:11px">${r.model_id || '—'}</td>
                <td><span class="badge ${errorBadgeColor(r.error_category)}">${formatErrorCategory(r.error_category)}</span></td>
                <td style="font-weight:600">${r.count}</td>
              </tr>
            `).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--text-3)">No data</td></tr>'}
          </tbody>
        </table>
      </div>
    </div>

    <div class="panel">
      <div class="panel-title">Error Categories Explained</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px">
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

  setTimeout(() => renderErrorTrendChart('errorTrendChart', data.overTime || []), 0);
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
