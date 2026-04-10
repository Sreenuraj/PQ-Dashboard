import { api } from '../api.js';
import { fmtCost, fmtDuration, fmtDate, fmtDateTime } from '../utils.js';

let currentPage = 1;

export async function renderSessions(container, dateRange = {}, queryParams = new URLSearchParams()) {
  // Capture URL-based drilldown filters
  const urlStatus      = queryParams.get('status');
  const urlModel       = queryParams.get('model_id');
  const urlErrorCat    = queryParams.get('error_category');
  const urlTool        = queryParams.get('tool_name');
  const urlHasErrors   = queryParams.get('hasErrors');
  const urlHasReasoning= queryParams.get('hasReasoning');

  const activeFilters = [
    urlStatus       && { label: `Status: ${urlStatus}`,         key: 'status' },
    urlModel        && { label: `Model: ${urlModel.split('/').pop()}`, key: 'model_id' },
    urlErrorCat     && { label: `Error: ${urlErrorCat.replace(/_/g,' ')}`, key: 'error_category' },
    urlTool         && { label: `Tool: ${urlTool}`,             key: 'tool_name' },
    urlHasErrors === 'true'  && { label: 'Has Errors',          key: 'hasErrors' },
    urlHasReasoning === 'true'  && { label: '🧠 With Reasoning', key: 'hasReasoning' },
    urlHasReasoning === 'false' && { label: 'No Reasoning',      key: 'hasReasoning' },
  ].filter(Boolean);

  const hasUrlFilters  = activeFilters.length > 0;

  // Reset page on fresh render
  currentPage = 1;

  container.innerHTML = `
    <div class="top-bar">
      <div>
        <h1 class="view-title">Sessions</h1>
        <p class="view-subtitle">All PostQode agent task sessions</p>
        ${hasUrlFilters ? `
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-top:6px">
            <span style="font-size:11px;color:var(--text-3)">Filtered by:</span>
            ${activeFilters.map(f => `<span class="badge accent">${f.label}</span>`).join('')}
            <a href="#/sessions" style="font-size:11px;color:var(--red);text-decoration:none;margin-left:4px">✕ Clear filters</a>
          </div>` : ''}
      </div>
      <!-- date picker injected here -->
    </div>

    <div class="filters-bar">
      <input id="f-search" class="filter-input" placeholder="Search by task description..." />
      <select id="f-status" class="filter-select">
        <option value="">All Status</option>
        <option value="completed" ${urlStatus==='completed'?'selected':''}>Completed</option>
        <option value="interrupted" ${urlStatus==='interrupted'?'selected':''}>Interrupted</option>
        <option value="unknown" ${urlStatus==='unknown'?'selected':''}>Unknown</option>
      </select>
      <select id="f-source" class="filter-select">
        <option value="">All Sources</option>
        <option value="VS Code Insiders">VS Code Insiders</option>
        <option value="VS Code">VS Code</option>
      </select>
      <select id="f-errors" class="filter-select">
        <option value="">All Sessions</option>
        <option value="true" ${urlHasErrors==='true'?'selected':''}>Has Errors</option>
      </select>
      <select id="f-reasoning" class="filter-select">
        <option value="">All Reasoning</option>
        <option value="true"  ${urlHasReasoning==='true'?'selected':''}>🧠 With Reasoning</option>
        <option value="false" ${urlHasReasoning==='false'?'selected':''}>No Reasoning</option>
      </select>
    </div>

    <div class="panel" style="padding:0;overflow:hidden">
      <table class="data-table">
        <thead>
          <tr>
            <th>Session</th><th>Started</th><th>Duration</th>
            <th>Model(s)</th><th>Cost</th><th>Errors</th>
            <th>Reasoning</th><th>Status</th><th>Source</th>
          </tr>
        </thead>
        <tbody id="sessions-tbody">
          <tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-3)">Loading...</td></tr>
        </tbody>
      </table>
    </div>
    <div class="pagination" id="pagination"></div>
  `;

  const drilldown = { urlStatus, urlModel, urlErrorCat, urlTool, urlHasErrors, urlHasReasoning };

  // Wire filter controls
  let debounceTimer;
  document.getElementById('f-search')?.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { currentPage = 1; loadSessions(container, dateRange, drilldown); }, 350);
  });
  ['f-status', 'f-source', 'f-errors', 'f-reasoning'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      currentPage = 1; loadSessions(container, dateRange, drilldown);
    });
  });

  await loadSessions(container, dateRange, drilldown);
}

async function loadSessions(container, dateRange = {}, drilldown = {}) {
  const { urlStatus, urlModel, urlErrorCat, urlTool, urlHasErrors, urlHasReasoning } = drilldown;

  const hasReasoning = document.getElementById('f-reasoning')?.value;

  const filters = {
    page:           currentPage,
    limit:          25,
    search:         document.getElementById('f-search')?.value        || undefined,
    status:         urlStatus || document.getElementById('f-status')?.value || undefined,
    source:         document.getElementById('f-source')?.value        || undefined,
    hasErrors:      urlHasErrors || document.getElementById('f-errors')?.value || undefined,
    hasReasoning:   urlHasReasoning || (hasReasoning !== '' ? hasReasoning : undefined) || undefined,
    model:          urlModel        || undefined,
    error_category: urlErrorCat     || undefined,
    tool_name:      urlTool         || undefined,
    from:           dateRange?.from || undefined,
    to:             dateRange?.to   || undefined,
  };

  // Remove undefined/empty
  Object.keys(filters).forEach(k => { if (!filters[k]) delete filters[k]; });

  const tbody = document.getElementById('sessions-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:40px;color:var(--text-3)"><div class="spinner" style="margin:auto"></div></td></tr>`;

  const data = await api.tasks(filters);

  if (!data.tasks?.length) {
    if (tbody) tbody.innerHTML = `
      <tr><td colspan="9">
        <div class="empty-state">
          <div class="icon">◈</div>
          <p>No sessions match the current filters</p>
          ${Object.keys(filters).length > 2 ? '<p style="font-size:11px;margin-top:8px"><a href="#/sessions" style="color:var(--accent-2)">Clear all filters</a></p>' : ''}
        </div>
      </td></tr>`;
    return;
  }

  if (tbody) {
    tbody.innerHTML = data.tasks.map(t => `
      <tr data-id="${t.id}" class="session-row" style="cursor:pointer">
        <td>
          <div style="font-size:11px;color:var(--text-3);font-family:'JetBrains Mono',monospace">${t.id.substring(0,20)}…</div>
          <div style="font-size:12px;color:var(--text-2);margin-top:2px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${t.first_message || '—'}
          </div>
        </td>
        <td style="font-size:12px;color:var(--text-2);white-space:nowrap">${t.start_ts ? fmtDateTime(t.start_ts) : '—'}</td>
        <td style="font-size:12px;white-space:nowrap">${t.duration ? fmtDuration(t.duration) : '—'}</td>
        <td>
          ${(t.models || []).slice(0,2).map(m =>
            `<div class="mono" style="font-size:10px;color:var(--text-2)">${m.model_id?.split('/').pop() || '—'}</div>`
          ).join('')}
          ${(t.models||[]).length > 2 ? `<div style="font-size:10px;color:var(--text-3)">+${t.models.length-2} more</div>` : ''}
        </td>
        <td style="font-size:13px;font-weight:600;color:var(--green)">${fmtCost(t.total_cost)}</td>
        <td>
          ${t.error_count > 0
            ? `<span class="badge red">${t.error_count} err</span>`
            : `<span style="font-size:12px;color:var(--text-3)">—</span>`}
        </td>
        <td>${t.has_reasoning ? '<span class="badge purple" style="font-size:10px">🧠</span>' : '<span style="color:var(--text-3);font-size:11px">—</span>'}</td>
        <td>${statusBadge(t.status)}</td>
        <td style="font-size:11px;color:var(--text-3)">${t.source || '—'}</td>
      </tr>
    `).join('');
  }

  // Row click → timeline
  document.querySelectorAll('.session-row').forEach(row => {
    row.addEventListener('click', () => {
      window.location.hash = `#/timeline?task=${row.dataset.id}`;
    });
  });

  renderPagination(data.total, data.page, data.limit, container, dateRange, drilldown);
}

function renderPagination(total, page, limit, container, dateRange, drilldown) {
  const totalPages = Math.ceil(total / limit);
  const pag = document.getElementById('pagination');
  if (!pag) return;

  pag.innerHTML = `
    <span class="page-info">${total} sessions</span>
    <button class="page-btn" ${page <= 1 ? 'disabled' : ''} id="prev-page">← Prev</button>
    <span class="page-info">Page ${page} / ${Math.max(totalPages,1)}</span>
    <button class="page-btn" ${page >= totalPages ? 'disabled' : ''} id="next-page">Next →</button>
  `;

  document.getElementById('prev-page')?.addEventListener('click', () => { currentPage--; loadSessions(container, dateRange, drilldown); });
  document.getElementById('next-page')?.addEventListener('click', () => { currentPage++; loadSessions(container, dateRange, drilldown); });
}

function statusBadge(status) {
  const map = {
    completed:   ['green',  '✓ Done'],
    interrupted: ['yellow', '⏸ Paused'],
    error:       ['red',    '✕ Error'],
    unknown:     ['grey',   '? Unknown'],
  };
  const [color, label] = map[status] || ['grey', status || 'Unknown'];
  return `<span class="badge ${color}">${label}</span>`;
}
