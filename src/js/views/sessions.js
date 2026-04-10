import { api } from '../api.js';
import { fmtCost, fmtDuration, fmtDate, fmtDateTime } from '../utils.js';

let currentPage = 1;
let currentFilters = {};

export async function renderSessions(container, dateRange = {}, queryParams = new URLSearchParams()) {
  // Capture URL overrides
  const urlStatus = queryParams.get('status');
  const urlModel = queryParams.get('model_id');
  const urlErrorCat = queryParams.get('error_category');
  const urlTool = queryParams.get('tool_name');

  const hasUrlFilters = urlStatus || urlModel || urlErrorCat || urlTool;

  container.innerHTML = `
    <div class="top-bar">
      <div>
        <h1 class="view-title">Sessions</h1>
        <p class="view-subtitle">
          All PostQode agent task sessions 
          ${hasUrlFilters ? `<a href="#/sessions" class="badge red" style="margin-left:8px;text-decoration:none">✕ Clear Drilldown Filters</a>` : ''}
        </p>
      </div>
      <!-- date picker injected here -->
    </div>

    <div class="filters-bar">
      <input id="f-search" class="filter-input" placeholder="Search by task description..." />
      <select id="f-status" class="filter-select">
        <option value="">All Status</option>
        <option value="completed">Completed</option>
        <option value="interrupted">Interrupted</option>
        <option value="error">Error</option>
        <option value="unknown">Unknown</option>
      </select>
      <select id="f-source" class="filter-select">
        <option value="">All Sources</option>
        <option value="VS Code Insiders">VS Code Insiders</option>
        <option value="VS Code">VS Code</option>
      </select>
      <select id="f-errors" class="filter-select">
        <option value="">All Sessions</option>
        <option value="true">Has Errors</option>
      </select>
    </div>

    <div class="panel" style="padding:0;overflow:hidden">
      <table class="data-table">
        <thead>
          <tr>
            <th>Session</th>
            <th>Started</th>
            <th>Duration</th>
            <th>Model(s)</th>
            <th>Cost</th>
            <th>Errors</th>
            <th>Status</th>
            <th>Source</th>
          </tr>
        </thead>
        <tbody id="sessions-tbody">
          <tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-3)">Loading...</td></tr>
        </tbody>
      </table>
    </div>
    <div class="pagination" id="pagination"></div>
  `;

  // Wire filters
  let debounceTimer;
  const searchEl = document.getElementById('f-search');
  searchEl.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { currentPage = 1; loadSessions(container); }, 350);
  });
  ['f-status', 'f-source', 'f-errors'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => { currentPage = 1; loadSessions(container, {urlStatus, urlModel, urlErrorCat, urlTool}); });
  });

  await loadSessions(container, {urlStatus, urlModel, urlErrorCat, urlTool});
}

async function loadSessions(container, {urlStatus, urlModel, urlErrorCat, urlTool} = {}) {
  const filters = {
    page: currentPage,
    limit: 25,
    search: document.getElementById('f-search')?.value || '',
    status: urlStatus || document.getElementById('f-status')?.value || '',
    source: document.getElementById('f-source')?.value || '',
    hasErrors: document.getElementById('f-errors')?.value || '',
    model: urlModel || '',
    error_category: urlErrorCat || '',
    tool_name: urlTool || '',
  };

  // Remove empty
  Object.keys(filters).forEach(k => { if (!filters[k]) delete filters[k]; });

  const tbody = document.getElementById('sessions-tbody');
  if (tbody) tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-3)"><div class="spinner" style="margin:auto"></div></td></tr>`;

  const data = await api.tasks(filters);

  if (!data.tasks?.length) {
    if (tbody) tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><div class="icon">◈</div><p>No sessions found</p></td></tr>`;
    return;
  }

  if (tbody) {
    tbody.innerHTML = data.tasks.map(t => `
      <tr data-id="${t.id}" class="session-row">
        <td>
          <div style="font-size:12px;color:var(--text-2);font-family:'JetBrains Mono',monospace">${t.id}</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:2px;max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
            ${t.first_message || '—'}
          </div>
        </td>
        <td style="font-size:12px;color:var(--text-2);white-space:nowrap">${t.start_ts ? fmtDateTime(t.start_ts) : '—'}</td>
        <td style="font-size:12px;white-space:nowrap">${t.duration ? fmtDuration(t.duration) : '—'}</td>
        <td>
          ${(t.models || []).slice(0,2).map(m => `
            <div class="mono" style="font-size:11px;color:var(--text-2)">${m.model_id || '—'}</div>
          `).join('')}
          ${(t.models||[]).length > 2 ? `<div style="font-size:11px;color:var(--text-3)">+${t.models.length-2} more</div>` : ''}
        </td>
        <td style="font-size:13px;font-weight:600;color:var(--green)">${fmtCost(t.total_cost)}</td>
        <td>
          ${t.error_count > 0
            ? `<span class="badge red">${t.error_count} errors</span>`
            : `<span style="font-size:12px;color:var(--text-3)">—</span>`}
        </td>
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

  // Pagination
  renderPagination(data.total, data.page, data.limit, container);
}

function renderPagination(total, page, limit, container) {
  const totalPages = Math.ceil(total / limit);
  const pag = document.getElementById('pagination');
  if (!pag || totalPages <= 1) return;

  pag.innerHTML = `
    <span class="page-info">${total} sessions</span>
    <button class="page-btn" ${page <= 1 ? 'disabled' : ''} id="prev-page">← Prev</button>
    <span class="page-info">Page ${page} / ${totalPages}</span>
    <button class="page-btn" ${page >= totalPages ? 'disabled' : ''} id="next-page">Next →</button>
  `;

  document.getElementById('prev-page')?.addEventListener('click', () => { currentPage--; loadSessions(container); });
  document.getElementById('next-page')?.addEventListener('click', () => { currentPage++; loadSessions(container); });
}

function statusBadge(status) {
  const map = {
    completed: ['green', '✓ Completed'],
    interrupted: ['yellow', '⏸ Interrupted'],
    error: ['red', '✕ Error'],
    unknown: ['grey', '? Unknown'],
  };
  const [color, label] = map[status] || ['grey', status || 'Unknown'];
  return `<span class="badge ${color}">${label}</span>`;
}
