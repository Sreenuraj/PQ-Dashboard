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
  
  let data, baselinesData;
  try {
    [data, baselinesData] = await Promise.all([
      api.compareDeep({ task_ids: ids, baseline_id: baselineId, include_tests: true }),
      api.baselines().catch(() => ({ baselines: [] }))
    ]);
  } catch (e) {
    container.innerHTML = `<div class="empty-state"><div class="icon">⚠</div><p>Error loading comparison: ${e.message}</p></div>`;
    return;
  }

  const rows = data.tasks || [];
  const baselines = baselinesData.baselines || [];

  // Calculate Overall Score for each row
  const overallScores = rows.map(r => ({
    row: r,
    details: calculateOverallIndex(r, rows, data.baseline)
  }));
  const winnerObj = [...overallScores].sort((a, b) => b.details.score - a.details.score)[0];
  const winner = winnerObj?.row;
  const winnerScore = winnerObj?.details.score || 0;

  let warningText = '';
  if (winner) {
    const failedPatterns = winner.tests?.results?.filter(r => r.status === 'fail').map(r => r.label || r.pattern) || [];
    if (failedPatterns.length > 0) {
      warningText = ` (Note: encountered ${failedPatterns.join(', ')} failures)`;
    }
  }

  container.innerHTML = `
    <div class="view-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:space-between;width:100%">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <a href="#/sessions" style="color:var(--text-3);text-decoration:none;font-size:13px">← Sessions</a>
          <h1 class="view-title" style="margin:0">Deep Compare</h1>
          <span class="badge grey">${rows.length} task${rows.length === 1 ? '' : 's'}</span>
          ${data.baseline ? '<span class="badge accent">Baseline reference</span>' : ''}
        </div>
        <div class="filters-bar" style="margin:0;border:none;background:transparent;padding:0">
          <label style="font-size:12px;color:var(--text-3);margin-right:6px">Baseline:</label>
          <select id="compare-baseline-select" class="filter-select" style="min-width:200px">
            <option value="">No baseline - heuristic rules</option>
            ${baselines.map(b => `<option value="${escAttr(b.id)}" ${b.id === (baselineId || data.baseline?.id) ? 'selected' : ''}>${escHtml(b.name || b.id)}</option>`).join('')}
          </select>
        </div>
      </div>
      <p class="view-subtitle" style="margin-top:6px">Operational efficiency and behavioral validation compared side-by-side.</p>
    </div>

    <div class="panel">
      <div class="panel-body">
        <strong>Summary:</strong>
        ${winner ? `${escHtml(labelFor(winner.task))} leads with ${winnerScore}% overall performance index at ${fmtCost(winner.task.total_cost || 0)}${warningText}.` : 'No comparable tasks loaded.'}
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
          <tr class="section-row"><td colspan="${rows.length + 1}">Performance Summary</td></tr>
          <tr class="score-row" style="background:rgba(91, 158, 245, 0.05)">
            <td><strong>Overall Performance Index</strong></td>
            ${rows.map(r => {
              const details = calculateOverallIndex(r, rows, data.baseline);
              return `<td class="${r.is_baseline ? 'deep-baseline-col' : ''}">
                <strong>${details.score}%</strong>
                <div class="progress-bar"><div class="progress-fill ${scoreClass(details.score)}" style="width:${details.score}%"></div></div>
                <div style="font-size:9px;color:var(--text-3);margin-top:4px;display:flex;flex-direction:column;gap:2px">
                  <div>60% behavior / 40% operations</div>
                  <div style="color:var(--text-4);font-family:var(--font-mono)">Ops: Cost ${details.costScore}%, Speed ${details.durationScore}%, Tools ${details.toolsScore}%, Errors ${details.errorsScore}%</div>
                </div>
              </td>`;
            }).join('')}
          </tr>
          <tr class="score-row">
            <td>Behavioral Test Score</td>
            ${rows.map(r => `<td class="${r.is_baseline ? 'deep-baseline-col' : ''}"><strong>${r.tests?.overall_score || 0}%</strong><div class="progress-bar"><div class="progress-fill ${scoreClass(r.tests?.overall_score || 0)}" style="width:${r.tests?.overall_score || 0}%"></div></div></td>`).join('')}
          </tr>

          <tr class="section-row"><td colspan="${rows.length + 1}">Behavioral Pattern Scoring</td></tr>
          ${['tia','bcv','mtv','bse','erc','cec'].map(pattern => renderPatternRow(pattern, rows)).join('')}
          
          <tr class="section-row"><td colspan="${rows.length + 1}">Operational Efficiency</td></tr>
          ${metricRow('Cost', rows, r => `<span style="color:var(--green);font-weight:600">${fmtCost(r.task.total_cost || 0)}</span>`)}
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
          
          <tr class="section-row"><td colspan="${rows.length + 1}">Task Completion & Feedback</td></tr>
          ${metricRow('Completion Summary', rows, (r, idx) => {
            if (!r.tests?.completion_message) return '-';
            const msg = r.tests.completion_message;
            const synopsis = msg.length > 120 ? `${msg.slice(0, 120)}...` : msg;
            return `
              <div class="completion-synopsis-box" data-view-completion="${idx}" 
                   style="cursor:pointer;padding:8px;border-radius:4px;background:var(--bg-3);border:1px dashed var(--border);font-style:italic;font-size:11px;transition:background 0.2s;line-height:1.4"
                   onmouseenter="this.style.background='var(--bg-4)'" 
                   onmouseleave="this.style.background='var(--bg-3)'">
                "${escHtml(synopsis)}"
                <div style="font-size:9px;color:var(--accent);margin-top:4px;text-align:right">Click to expand</div>
              </div>
            `;
          })}
          ${metricRow('User Rating', rows, r => r.tests?.user_rating ? `<span style="color:#f59e0b;font-size:14px">${'★'.repeat(r.tests.user_rating)}${'☆'.repeat(5 - r.tests.user_rating)}</span>` : 'Not rated')}
          
          <tr class="section-row"><td colspan="${rows.length + 1}">Baseline Essential Step Coverage</td></tr>
          ${renderEssentialStepsRows(rows, data.baseline)}
        </tbody>
      </table>
    </div>
  `;

  // Wire baseline switcher
  document.getElementById('compare-baseline-select')?.addEventListener('change', e => {
    const next = e.target.value;
    window.location.hash = `#/deepcompare?tasks=${encodeURIComponent(ids.join(','))}${next ? `&baseline=${encodeURIComponent(next)}` : ''}`;
  });

  // Modal opening listener
  container.addEventListener('click', e => {
    const btn = e.target.closest('[data-view-completion]');
    if (btn) {
      const idx = parseInt(btn.dataset.viewCompletion);
      const row = rows[idx];
      if (row) {
        showFullCompletionModal(labelFor(row.task), row.tests?.completion_message || '');
      }
    }
  });
}

async function renderBaselineComparePicker(container, baselineId) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading sessions...</p></div>`;
  const [baseline, tasks] = await Promise.all([
    api.baseline(baselineId),
    api.tasks({ limit: 100 }),
  ]);
  // Filter out baseline source task from candidate sessions list
  const candidates = (tasks.tasks || []).filter(t => t.id !== baseline.source_task_id);

  container.innerHTML = `
    <div class="view-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <a href="#/baselines" style="color:var(--text-3);text-decoration:none;font-size:13px">← Baselines</a>
        <h1 class="view-title" style="margin:0">Compare Against Baseline</h1>
        <span class="badge accent">${escHtml(baseline.name || baseline.id)}</span>
      </div>
      <p class="view-subtitle">Choose one or more sessions to evaluate against this baseline.</p>
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
                <td><span class="badge ${t.status === 'completed' ? 'green' : t.status === 'interrupted' ? 'yellow' : 'red'}">${escHtml(t.status)}</span></td>
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

function calculateOverallIndex(r, rows, baseline) {
  const task = r.task;
  const tests = r.tests || {};
  const behavioralScore = tests.overall_score || 0;

  // Determine reference values (baseline if present, else best-in-class among rows)
  let refCost, refDuration, refTools;
  if (baseline && baseline.reference_metrics) {
    refCost = baseline.reference_metrics.cost || 0.0001;
    refDuration = baseline.reference_metrics.duration || 1;
    refTools = baseline.reference_metrics.tool_calls || 1;
  } else {
    refCost = Math.min(...rows.map(x => x.task.total_cost || 0), 0.0001);
    refDuration = Math.min(...rows.map(x => x.task.duration || 0), 1);
    refTools = Math.min(...rows.map(x => x.task.tool_call_count || x.tool_sequence?.length || 0), 1);
  }

  // Cost Score
  const cost = task.total_cost || 0;
  let costScore = 100;
  if (cost > refCost) {
    costScore = Math.max(0, 100 - ((cost - refCost) / refCost) * 50);
  }

  // Duration Score
  const duration = task.duration || 0;
  let durationScore = 100;
  if (duration > refDuration) {
    durationScore = Math.max(0, 100 - ((duration - refDuration) / refDuration) * 50);
  }

  // Tools Score
  const tools = task.tool_call_count || r.tool_sequence?.length || 0;
  let toolsScore = 100;
  if (tools > refTools) {
    toolsScore = Math.max(0, 100 - ((tools - refTools) / refTools) * 50);
  }

  // Errors Score
  const errors = task.error_count || 0;
  const errorsScore = Math.max(0, 100 - errors * 20);

  // Operational Score (Weighted average of operational aspects)
  const operationalScore = 0.4 * costScore + 0.3 * durationScore + 0.2 * toolsScore + 0.1 * errorsScore;

  // Overall Index (60% Behavioral, 40% Operational)
  const overall = Math.round(0.6 * behavioralScore + 0.4 * operationalScore);

  return {
    score: overall,
    costScore: Math.round(costScore),
    durationScore: Math.round(durationScore),
    toolsScore: Math.round(toolsScore),
    errorsScore: Math.round(errorsScore),
    operationalScore: Math.round(operationalScore),
    behavioralScore: Math.round(behavioralScore)
  };
}

function renderPatternRow(pattern, rows) {
  const labels = { tia: 'Tool Assertion', bcv: 'Behavior Contract', mtv: 'Tool Sequence & Essential Steps', bse: 'Scope', erc: 'Error Recovery', cec: 'Context Efficiency' };
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
  return `<tr><td>${label}</td>${rows.map((r, idx) => `<td class="${r.is_baseline ? 'deep-baseline-col' : ''}">${getter(r, idx)}</td>`).join('')}</tr>`;
}

function renderEssentialStepsRows(rows, baseline) {
  const steps = baseline?.tool_sequence?.filter(s => s.is_essential) || [];
  if (steps.length === 0) {
    return `
      <tr>
        <td>Essential Step Coverage</td>
        ${rows.map(() => `<td style="color:var(--text-3)">No baseline selected or no essential steps configured</td>`).join('')}
      </tr>
    `;
  }

  let html = '';
  for (const s of steps) {
    html += `
      <tr>
        <td>
          <div style="font-weight:500">${escHtml(s.description || s.tool_name)}</div>
          <div style="font-size:10px;color:var(--text-3);font-family:var(--font-mono)">${escHtml(s.tool_name)} ${s.file_path ? `→ ${s.file_path}` : ''}</div>
        </td>
        ${rows.map(r => {
          if (r.is_baseline) {
            return `<td class="deep-baseline-col"><span style="color:var(--green);font-weight:bold">✓</span> <span style="font-size:10px;color:var(--text-3)">Baseline reference</span></td>`;
          }
          const match = (r.tool_sequence || []).find(t => t.tool_name === s.tool_name && isTargetMatch(t.file_path, s.file_path));
          if (match) {
            return `<td><span style="color:var(--green);font-weight:bold">✓</span> <span style="font-size:10px;color:var(--text-2);font-family:var(--font-mono)">${escHtml(match.tool_name)}</span></td>`;
          } else {
            return `<td><span style="color:var(--red);font-weight:bold">✗</span> <span style="font-size:10px;color:var(--text-3)">Missing</span></td>`;
          }
        }).join('')}
      </tr>
    `;
  }
  return html;
}

function isTargetMatch(pathA, pathB) {
  if (!pathA && !pathB) return true;
  if (!pathA || !pathB) return false;
  const cleanA = pathA.replace(/^[./\\]+/, '').toLowerCase();
  const cleanB = pathB.replace(/^[./\\]+/, '').toLowerCase();
  return cleanA === cleanB || cleanA.endsWith(cleanB) || cleanB.endsWith(cleanA);
}

function showFullCompletionModal(modelName, message) {
  let modal = document.getElementById('completion-detail-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'completion-detail-modal';
    modal.className = 'modal-backdrop';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-panel" style="width:min(720px, 95%)">
      <div class="modal-head">
        <div>
          <h2 style="margin:0">Completion Summary</h2>
          <p style="margin:4px 0 0;font-size:11px;color:var(--text-3)">Model: ${escHtml(modelName)}</p>
        </div>
        <button class="page-btn modal-close-btn">Close</button>
      </div>
      <div class="modal-body" style="max-height:60vh;overflow-y:auto;line-height:1.6;font-size:13px;white-space:normal">
        ${formatMarkdown(message)}
      </div>
      <div class="modal-actions">
        <button class="action-btn primary modal-close-btn">Close</button>
      </div>
    </div>
  `;
  modal.style.display = 'flex';
  
  modal.querySelectorAll('.modal-close-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.style.display = 'none';
    });
  });
}

function formatMarkdown(text) {
  if (!text) return '';
  return escHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code class="mono" style="background:var(--bg-4);padding:2px 4px;border-radius:3px">$1</code>')
    .replace(/\n/g, '<br>')
    .replace(/^- (.*?)(?:<br>|$)/gm, '<li>$1</li>');
}

function labelFor(task) {
  if (task.is_baseline_reference) {
    return task.name || task.models?.[0]?.model_id?.split('/').pop() || 'Baseline Reference';
  }
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

function escAttr(s) {
  return escHtml(s).replace(/`/g, '&#96;');
}
