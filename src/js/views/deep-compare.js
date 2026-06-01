import { api } from '../api.js';
import { fmtCost, fmtDuration } from '../utils.js';

export async function renderDeepCompare(container, params = new URLSearchParams()) {
  const ids = (params.get('tasks') || '').split(',').filter(Boolean);
  const baselineId = params.get('baseline');
  if (ids.length < 1 && !baselineId) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⇄</div><p>Select sessions to run a deep comparison.</p><p style="margin-top:8px"><a href="#/sessions" style="color:var(--accent)">Go to Sessions</a></p></div>`;
    return;
  }

  if (baselineId && ids.length < 1) {
    await renderBaselineComparePicker(container, baselineId);
    return;
  }

  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Running deep comparison...</p></div>`;
  const data = await api.compareDeep({ task_ids: ids, baseline_id: baselineId, include_tests: true });
  const rows = data.tasks || [];
  const winner = [...rows].sort((a, b) => (b.tests?.overall_score || 0) - (a.tests?.overall_score || 0))[0];

  container.innerHTML = `
    <div class="view-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <a href="#/sessions" style="color:var(--text-3);text-decoration:none;font-size:13px">← Sessions</a>
        <h1 class="view-title" style="margin:0">Deep Compare</h1>
        <span class="badge grey">${rows.length} task${rows.length === 1 ? '' : 's'}</span>
        ${data.baseline ? '<span class="badge accent">Baseline reference</span>' : ''}
      </div>
      <p class="view-subtitle">Behavioral tests, operational metrics, and tool sequence comparison.</p>
    </div>

    <div class="panel">
      <div class="panel-body">
        <strong>Summary:</strong>
        ${winner ? `${escHtml(labelFor(winner.task))} leads with ${winner.tests?.overall_score || 0}% behavioral score at ${fmtCost(winner.task.total_cost || 0)}.` : 'No comparable tasks loaded.'}
      </div>
    </div>

    <div class="deep-compare-wrap">
      <table class="deep-compare-table">
        <thead>
          <tr>
            <th>Metric</th>
            ${rows.map(r => `<th class="${r.is_baseline ? 'deep-baseline-col' : ''}">${r.is_baseline ? '<span class="badge accent">Baseline</span><br>' : ''}${escHtml(labelFor(r.task))}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          <tr class="section-row"><td colspan="${rows.length + 1}">Behavioral Tests</td></tr>
          ${['tia','bcv','mtv','bse','erc','cec'].map(pattern => renderPatternRow(pattern, rows)).join('')}
          <tr class="score-row"><td>Behavioral Score</td>${rows.map(r => `<td class="${r.is_baseline ? 'deep-baseline-col' : ''}"><strong>${r.tests?.overall_score || 0}%</strong><div class="progress-bar"><div class="progress-fill ${scoreClass(r.tests?.overall_score || 0)}" style="width:${r.tests?.overall_score || 0}%"></div></div></td>`).join('')}</tr>
          <tr class="section-row"><td colspan="${rows.length + 1}">Operational</td></tr>
          ${metricRow('Cost', rows, r => fmtCost(r.task.total_cost || 0))}
          ${metricRow('Tokens In', rows, r => fmtNum(r.task.total_tokens_in || 0))}
          ${metricRow('Tokens Out', rows, r => fmtNum(r.task.total_tokens_out || 0))}
          ${metricRow('Cache Reads', rows, r => fmtNum(r.task.total_cache_reads || 0))}
          ${metricRow('Duration', rows, r => fmtDuration(r.task.duration || 0))}
          ${metricRow('API Calls', rows, r => r.task.api_call_count || 0)}
          ${metricRow('Tool Calls', rows, r => r.task.tool_call_count || 0)}
          ${metricRow('Errors', rows, r => r.task.error_count || 0)}
          ${metricRow('Context Condensation', rows, r => r.task.has_context_reset ? '<span class="badge yellow">Yes</span>' : '<span class="badge green">No</span>')}
          ${metricRow('Status', rows, r => `<span class="badge ${r.task.status === 'completed' ? 'green' : 'yellow'}">${escHtml(r.task.status)}</span>`)}
          ${metricRow('Activity', rows, r => `<span class="badge grey">${escHtml(r.task.activity_category || 'general')}</span>`)}
          <tr class="section-row"><td colspan="${rows.length + 1}">Tool Sequence</td></tr>
          ${renderToolSequenceRows(rows)}
        </tbody>
      </table>
    </div>
  `;
}

async function renderBaselineComparePicker(container, baselineId) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading sessions...</p></div>`;
  const [baseline, tasks] = await Promise.all([
    api.baseline(baselineId),
    api.tasks({ limit: 100, status: 'completed' }),
  ]);
  const candidates = (tasks.tasks || []).filter(t => t.id !== baselineId);

  container.innerHTML = `
    <div class="view-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <a href="#/baselines" style="color:var(--text-3);text-decoration:none;font-size:13px">← Baselines</a>
        <h1 class="view-title" style="margin:0">Compare Against Baseline</h1>
        <span class="badge accent">${escHtml(baseline.name || baseline.id)}</span>
      </div>
      <p class="view-subtitle">Choose one or more completed sessions to evaluate against this baseline.</p>
    </div>
    <div class="panel">
      <div class="panel-title">
        <span>Session Picker</span>
        <span class="panel-title-meta">Baseline will be fixed as the first comparison column</span>
      </div>
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th style="width:34px"></th><th>Session</th><th>Model</th><th>Cost</th><th>Status</th></tr></thead>
          <tbody>
            ${candidates.map(t => `
              <tr>
                <td onclick="event.stopPropagation()"><input type="checkbox" class="deep-picker-checkbox" value="${escAttr(t.id)}" /></td>
                <td><div class="mono">${escHtml(t.id.slice(0, 18))}</div><div style="max-width:640px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.first_message || '')}</div></td>
                <td class="mono">${escHtml(t.models?.[0]?.model_id || 'Unknown')}</td>
                <td>${fmtCost(t.total_cost || 0)}</td>
                <td><span class="badge green">${escHtml(t.status)}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
    <div class="baseline-actions">
      <button id="deep-picker-compare" class="action-btn primary" disabled>Deep Compare Against Baseline</button>
      <a href="#/baselines" class="action-btn ghost">Cancel</a>
    </div>
  `;

  const button = document.getElementById('deep-picker-compare');
  const update = () => {
    const selected = [...document.querySelectorAll('.deep-picker-checkbox:checked')].map(cb => cb.value);
    button.disabled = selected.length === 0;
    button.textContent = selected.length ? `Deep Compare ${selected.length} Session${selected.length === 1 ? '' : 's'}` : 'Deep Compare Against Baseline';
  };
  document.querySelectorAll('.deep-picker-checkbox').forEach(cb => cb.addEventListener('change', update));
  button?.addEventListener('click', () => {
    const selected = [...document.querySelectorAll('.deep-picker-checkbox:checked')].map(cb => cb.value);
    if (selected.length) window.location.hash = `#/deepcompare?baseline=${encodeURIComponent(baselineId)}&tasks=${selected.map(encodeURIComponent).join(',')}`;
  });
}

function renderPatternRow(pattern, rows) {
  const labels = { tia: 'Tool Assertion', bcv: 'Behavior Contract', mtv: 'Trace Order', bse: 'Scope', erc: 'Error Recovery', cec: 'Context Efficiency' };
  return `
    <tr>
      <td>${labels[pattern]}</td>
      ${rows.map(r => {
        const result = r.tests?.results?.find(x => x.pattern === pattern);
        return `<td class="${r.is_baseline ? 'deep-baseline-col' : ''}"><span class="badge ${statusColor(result?.status)}">${(result?.status || 'skip').toUpperCase()} ${result?.status === 'skip' ? '' : `${result?.score || 0}%`}</span></td>`;
      }).join('')}
    </tr>
  `;
}

function metricRow(label, rows, getter) {
  return `<tr><td>${label}</td>${rows.map(r => `<td class="${r.is_baseline ? 'deep-baseline-col' : ''}">${getter(r)}</td>`).join('')}</tr>`;
}

function renderToolSequenceRows(rows) {
  const max = Math.min(20, Math.max(...rows.map(r => r.tool_sequence?.length || 0), 0));
  if (!max) return `<tr><td>Sequence</td>${rows.map(() => '<td>-</td>').join('')}</tr>`;
  let html = '';
  for (let i = 0; i < max; i++) {
    html += `<tr><td>${i + 1}</td>${rows.map(r => {
      const step = r.tool_sequence?.[i];
      return `<td class="${r.is_baseline ? 'deep-baseline-col' : ''}">${step ? `<span class="mono">${escHtml(step.tool_name)}</span><div style="font-size:10px;color:var(--text-3)">${escHtml(step.file_path || step.command || '')}</div>` : '-'}</td>`;
    }).join('')}</tr>`;
  }
  return html;
}

function labelFor(task) {
  return task.models?.[0]?.model_id?.split('/').pop() || task.id.slice(0, 8);
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString();
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
