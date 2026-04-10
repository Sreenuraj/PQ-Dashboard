import { api } from '../api.js';
import { fmt, fmtCost, fmtDate } from '../utils.js';

export async function renderOverview(container, dateRange = {}) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading overview...</p></div>`;

  const params = buildParams(dateRange);
  const [overview, models, reasoning] = await Promise.all([
    api.overview(params),
    api.models(params),
    api.reasoning(params)
  ]);

  const completionRate = overview.total_tasks > 0
    ? Math.round((overview.completed / overview.total_tasks) * 100) : 0;
  const cacheHitRate = (overview.total_tokens_in + overview.total_cache_reads) > 0
    ? Math.round((overview.total_cache_reads / (overview.total_tokens_in + overview.total_cache_reads)) * 100) : 0;
  const avgCost = overview.total_tasks > 0 ? overview.total_cost / overview.total_tasks : 0;
  const errRate = overview.total_api_calls > 0
    ? ((overview.total_errors / overview.total_api_calls) * 100).toFixed(1) : 0;

  container.innerHTML = `
    <div class="top-bar">
      <div>
        <h1 class="view-title">Overview</h1>
        <p class="view-subtitle">PostQode AI agent activity · ${overview.total_tasks} sessions across all IDEs · <span style="color:var(--accent-2);font-size:11px">Click any card or row to explore ↗</span></p>
      </div>
      <!-- date picker injected here -->
    </div>

    <div class="stats-grid">
      ${clickCard('Sessions', fmt(overview.total_tasks),
        overview.sources?.map(s => `${s.source}: ${s.cnt}`).join(' · ') || '',
        'accent', '#/sessions')}
      ${clickCard('Total Cost', fmtCost(overview.total_cost),
        `Avg ${fmtCost(avgCost)} / session`, 'green', '#/costs')}
      ${clickCard('Errors', fmt(overview.total_errors),
        `${errRate}% of API calls`, overview.total_errors > 0 ? 'red' : '',
        '#/errors')}
      ${clickCard('Completion', `${completionRate}%`,
        `${overview.completed} done · ${overview.interrupted} interrupted`,
        '', '#/sessions?status=completed')}
      ${clickCard('Tokens', fmtTokens(overview.total_tokens_in + overview.total_tokens_out),
        `In: ${fmtTokens(overview.total_tokens_in)} · Out: ${fmtTokens(overview.total_tokens_out)}`,
        '', '#/costs')}
      ${clickCard('Cache Hit', `${cacheHitRate}%`,
        `${fmtTokens(overview.total_cache_reads)} tokens saved`, 'cyan', '#/models')}
      ${clickCard('Tool Calls', fmt(overview.total_tool_calls),
        `${overview.total_api_calls} API calls total`, '', '#/tools')}
      ${clickCard('Reasoning', fmt(overview.with_reasoning),
        'Sessions with thinking traces', 'purple', '#/sessions?hasReasoning=true')}
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-title">Top Models <span style="float:right;font-weight:400;font-size:10px;text-transform:none;color:var(--accent-2)"><a href="#/models" style="color:inherit;text-decoration:none">View all ↗</a></span></div>
        ${models.slice(0, 7).map(m => `
          <div class="model-row" style="cursor:pointer" title="Click to see sessions for this model"
            onclick="window.location.hash='#/sessions?model_id=${encodeURIComponent(m.model_id)}'">
            <div>
              <div class="mono" style="color:var(--text)">${m.model_id?.split('/').pop() || 'unknown'}</div>
              <div style="font-size:11px;color:var(--text-3);margin-top:1px">${m.provider_id || ''}</div>
            </div>
            <span style="font-size:12.5px;font-weight:600;color:var(--text-2)">${m.task_count} sessions</span>
            <span style="font-size:12px;color:var(--green);font-weight:600">${fmtCost(m.total_cost)}</span>
            ${m.total_errors > 0
              ? `<span class="badge red" style="cursor:pointer" onclick="event.stopPropagation();window.location.hash='#/sessions?model_id=${encodeURIComponent(m.model_id)}&hasErrors=true'">${m.total_errors} err</span>`
              : `<span style="font-size:11px;color:var(--text-3)">0 err</span>`}
          </div>
        `).join('') || '<div class="empty-state"><p>No model data</p></div>'}
      </div>

      <div class="panel">
        <div class="panel-title">Session Status</div>
        ${clickStatusBar('Completed',   overview.completed,   overview.total_tasks, 'accent', '#/sessions?status=completed')}
        ${clickStatusBar('Interrupted', overview.interrupted, overview.total_tasks, 'yellow', '#/sessions?status=interrupted')}
        ${clickStatusBar('Has Errors',
          overview.total_errors > 0 ? overview.total_tasks - overview.completed - (overview.interrupted||0) : 0,
          overview.total_tasks, 'red', '#/sessions?hasErrors=true')}

        <div class="divider"></div>
        <div class="panel-title">Date Range</div>
        <div style="font-size:12.5px;color:var(--text-2)">
          <div>Earliest: <span style="color:var(--text)">${overview.earliest_task ? fmtDate(overview.earliest_task) : '—'}</span></div>
          <div style="margin-top:4px">Latest: <span style="color:var(--text)">${overview.latest_task ? fmtDate(overview.latest_task) : '—'}</span></div>
        </div>
      </div>
    </div>

    <div class="panel" style="margin-top:16px">
      <div class="panel-title">Reasoning Impact Analysis <span style="float:right;font-weight:400;font-size:10px;text-transform:none;color:var(--text-3)">Click row to filter sessions</span></div>
      <table class="data-table">
        <thead><tr><th>Task Type</th><th>Sessions</th><th>Avg Cost</th><th>Avg Errors</th><th>Completion Rate</th></tr></thead>
        <tbody>
          ${(reasoning || []).map(r => {
            const label = r.has_reasoning
              ? '<span class="badge purple">🧠 With Reasoning</span>'
              : '<span class="badge grey">No Reasoning</span>';
            const compRate = r.task_count > 0 ? Math.round(r.completed / r.task_count * 100) : 0;
            const href = r.has_reasoning ? '#/sessions?hasReasoning=true' : '#/sessions?hasReasoning=false';
            return `
              <tr style="cursor:pointer" onclick="window.location.hash='${href}'">
                <td>${label}</td>
                <td style="font-weight:600">${r.task_count}</td>
                <td style="color:var(--green)">${fmtCost(r.avg_cost)}</td>
                <td style="color:${r.avg_errors > 0 ? 'var(--red)' : 'var(--text-3)'}">${(r.avg_errors || 0).toFixed(1)}</td>
                <td>
                  <div style="display:flex;align-items:center;gap:8px">
                    <div class="progress-bar" style="width:60px">
                      <div class="progress-fill ${compRate > 70 ? 'accent' : 'yellow'}" style="width:${compRate}%"></div>
                    </div>
                    <span style="font-size:11px;color:var(--text-3)">${compRate}%</span>
                  </div>
                </td>
              </tr>
            `;
          }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-3)">No reasoning data available</td></tr>'}
        </tbody>
      </table>
    </div>
  `;
}

/** Stat card that navigates on click */
function clickCard(label, value, sub, color, href) {
  return `
    <div class="stat-card ${color}" style="cursor:pointer;transition:border-color 120ms,transform 120ms"
      onclick="window.location.hash='${href}'"
      onmouseenter="this.style.borderColor='var(--accent)';this.style.transform='translateY(-1px)'"
      onmouseleave="this.style.borderColor='';this.style.transform=''">
      <div class="stat-label">${label} <span style="font-size:9px;color:var(--accent-2);opacity:0.7">↗</span></div>
      <div class="stat-value">${value}</div>
      <div class="stat-sub">${sub}</div>
    </div>`;
}

/** Status progress bar that navigates on click */
function clickStatusBar(label, count, total, color, href) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return `
    <div style="margin-bottom:12px;cursor:pointer" onclick="window.location.hash='${href}'"
      title="Click to filter sessions">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px">
        <span style="font-size:12px;color:var(--text-2)">${label} <span style="font-size:9px;color:var(--accent-2)">↗</span></span>
        <span style="font-size:12px;color:var(--text-3)">${count || 0} (${pct}%)</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill ${color === 'accent' ? '' : color}"
             style="width:${pct}%;${color === 'accent' ? 'background:var(--accent)' : ''}"></div>
      </div>
    </div>`;
}

function buildParams(dateRange) {
  const p = {};
  if (dateRange.from) p.from = dateRange.from;
  if (dateRange.to)   p.to   = dateRange.to;
  return p;
}

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}
