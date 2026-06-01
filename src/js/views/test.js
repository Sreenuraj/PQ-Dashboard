import { api } from '../api.js';
import { fmtCost, fmtDuration, fmtDateTime } from '../utils.js';

export async function renderTest(container, params = new URLSearchParams()) {
  const taskId = params.get('task');
  const baselineId = params.get('baseline');
  if (!taskId) {
    await renderPicker(container, baselineId);
    return;
  }

  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Running behavioral tests...</p></div>`;
  const [suite, baselines] = await Promise.all([
    api.testTask(taskId, baselineId ? { baseline: baselineId } : {}),
    api.baselines().catch(() => ({ baselines: [] })),
  ]);
  const task = suite.task;

  container.innerHTML = `
    <div class="view-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <a href="#/sessions" style="color:var(--text-3);text-decoration:none;font-size:13px">← Sessions</a>
        <h1 class="view-title" style="margin:0">Test Session</h1>
        <span class="badge grey mono">${escHtml(taskId.slice(0, 12))}</span>
      </div>
      <p class="view-subtitle">Behavioral testing against the task event trace</p>
    </div>

    <div class="panel">
      <div class="panel-body">
        <div class="baseline-meta-grid">
          <div><span>Model</span><strong class="mono">${escHtml(task.models?.[0]?.model_id || 'Unknown')}</strong></div>
          <div><span>Cost</span><strong>${fmtCost(task.total_cost || 0)}</strong></div>
          <div><span>Duration</span><strong>${fmtDuration(task.duration || 0)}</strong></div>
          <div><span>Status</span><strong>${escHtml(task.status)}</strong></div>
          <div><span>Tools</span><strong>${task.tool_call_count || 0}</strong></div>
          <div><span>Errors</span><strong>${task.error_count || 0}</strong></div>
        </div>
        <div class="filters-bar" style="margin-top:14px;margin-bottom:0">
          <select id="baseline-select" class="filter-select">
            <option value="">No baseline - heuristic rules</option>
            ${(baselines.baselines || []).map(b => `<option value="${escAttr(b.id)}" ${b.id === baselineId ? 'selected' : ''}>${escHtml(b.name || b.id)}</option>`).join('')}
          </select>
          <button id="rerun-test" class="action-btn secondary">Re-run</button>
          <a class="action-btn secondary" href="#/deepcompare?tasks=${encodeURIComponent(taskId)}${baselineId ? `&baseline=${encodeURIComponent(baselineId)}` : ''}">Compare with another task</a>
        </div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-body">
        <div class="score-hero">
          <div>
            <div class="stat-label">Behavioral Score</div>
            <div class="stat-value">${suite.overall_score}%</div>
          </div>
          <div class="score-track"><div class="score-fill ${scoreClass(suite.overall_score)}" style="width:${suite.overall_score}%"></div></div>
        </div>
      </div>
    </div>

    <div class="test-results">
      ${suite.results.map(renderResult).join('')}
    </div>
  `;

  document.getElementById('baseline-select')?.addEventListener('change', e => {
    const next = e.target.value;
    window.location.hash = `#/test?task=${encodeURIComponent(taskId)}${next ? `&baseline=${encodeURIComponent(next)}` : ''}`;
  });
  document.getElementById('rerun-test')?.addEventListener('click', () => {
    window.location.hash = `#/test?task=${encodeURIComponent(taskId)}${baselineId ? `&baseline=${encodeURIComponent(baselineId)}&t=${Date.now()}` : `&t=${Date.now()}`}`;
  });
}

async function renderPicker(container, baselineId) {
  const [tasks, baselines] = await Promise.all([
    api.tasks({ limit: 50, status: 'completed' }),
    api.baselines().catch(() => ({ baselines: [] })),
  ]);
  container.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">Test Session</h1>
      <p class="view-subtitle">Choose a completed session to run behavioral tests.</p>
    </div>
    <div class="filters-bar">
      <select id="picker-baseline" class="filter-select">
        <option value="">No baseline - heuristic rules</option>
        ${(baselines.baselines || []).map(b => `<option value="${escAttr(b.id)}" ${b.id === baselineId ? 'selected' : ''}>${escHtml(b.name || b.id)}</option>`).join('')}
      </select>
    </div>
    <div class="panel">
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Session</th><th>Model</th><th>Started</th><th>Cost</th><th></th></tr></thead>
          <tbody>
            ${(tasks.tasks || []).map(t => `
              <tr>
                <td><div class="mono">${escHtml(t.id.slice(0, 18))}</div><div style="max-width:520px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.first_message || '')}</div></td>
                <td>${escHtml(t.models?.[0]?.model_id || 'Unknown')}</td>
                <td>${fmtDateTime(t.start_ts)}</td>
                <td>${fmtCost(t.total_cost || 0)}</td>
                <td><a class="action-btn primary" href="#/test?task=${encodeURIComponent(t.id)}${baselineId ? `&baseline=${encodeURIComponent(baselineId)}` : ''}">Test</a></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
  document.getElementById('picker-baseline')?.addEventListener('change', e => {
    window.location.hash = e.target.value ? `#/test?baseline=${encodeURIComponent(e.target.value)}` : '#/test';
  });
}

function renderResult(r) {
  return `
    <details class="panel test-result-card" open>
      <summary class="panel-title test-result-summary">
        <span>${escHtml(r.label)}</span>
        <span class="badge ${statusColor(r.status)}">${r.status.toUpperCase()} ${r.status === 'skip' ? '' : `${r.score}%`}</span>
      </summary>
      <div class="panel-body">
        <p style="font-size:12px;color:var(--text-2);margin-bottom:10px">${escHtml(r.details || '')}</p>
        <div class="evidence-list">
          ${(r.evidence || []).map(e => `
            <div class="evidence-row ${e.severity || 'info'}">
              <span>${escHtml(e.label)}</span>
              <strong>${escHtml(e.value)}</strong>
            </div>
          `).join('')}
        </div>
      </div>
    </details>
  `;
}

function statusColor(status) {
  return { pass: 'green', warn: 'yellow', fail: 'red', skip: 'grey' }[status] || 'grey';
}

function scoreClass(score) {
  return score >= 80 ? 'green' : score >= 40 ? 'yellow' : 'red';
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function escAttr(s) {
  return escHtml(s).replace(/`/g, '&#96;');
}
