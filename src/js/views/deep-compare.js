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
  const comparedRows = rows.filter(r => !r.is_baseline);
  const baselines = baselinesData.baselines || [];

  // Calculate rankings of compared rows
  const ranked = comparedRows.map(r => {
    const details = calculateOverallIndex(r, rows, data.baseline);
    return {
      row: r,
      details: details
    };
  }).sort((a, b) => b.details.score - a.details.score);

  const winnerObj = ranked[0];
  const winner = winnerObj?.row;
  const winnerScore = winnerObj?.details.score || 0;

  let warningText = '';
  if (winner) {
    const failedPatterns = winner.tests?.results?.filter(r => r.status === 'fail').map(r => r.label || r.pattern) || [];
    if (failedPatterns.length > 0) {
      warningText = ` (Note: encountered ${failedPatterns.join(', ')} failures)`;
    }
  }

  let rankingsHtml = '';
  if (ranked.length > 0) {
    rankingsHtml = `
      <div style="margin-top:14px; display:flex; flex-direction:column; gap:10px;">
        <span style="font-size:11px; text-transform:uppercase; color:var(--text-3); font-weight:600; letter-spacing:0.5px">Session Rankings (Overall Index)</span>
        ${ranked.map((item, idx) => {
          const score = item.details.score;
          const label = labelFor(item.row.task);
          const barClass = scoreClass(score);
          return `
            <div style="display:flex; align-items:center; gap:12px; font-size:12px">
              <span style="width:20px; font-weight:bold; color:var(--text-3)">#${idx + 1}</span>
              <span style="width:180px; font-family:var(--font-mono); text-overflow:ellipsis; overflow:hidden; white-space:nowrap" title="${escAttr(label)}">${escHtml(label)}</span>
              <div class="progress-bar" style="flex:1; height:12px; background:var(--bg-3); border-radius:6px; overflow:hidden">
                <div class="progress-fill ${barClass}" style="height:100%; width:${score}%"></div>
              </div>
              <span style="width:40px; text-align:right; font-weight:bold">${score}%</span>
              <span style="width:80px; text-align:right; color:var(--green); font-size:11px">${fmtCost(item.row.task.total_cost || 0)}</span>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  container.innerHTML = `
    <style>
      .interactive-row {
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .interactive-row:hover {
        background: rgba(91, 158, 245, 0.05) !important;
      }
      .tip-banner {
        font-size: 11px;
        color: var(--accent);
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 6px;
      }
    </style>

    <div class="view-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:space-between;width:100%">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <a href="#/sessions" style="color:var(--text-3);text-decoration:none;font-size:13px">← Sessions</a>
          <h1 class="view-title" style="margin:0">Deep Compare</h1>
          <span class="badge grey">${comparedRows.length} task${comparedRows.length === 1 ? '' : 's'}</span>
          ${data.baseline ? `<span class="badge accent">Baseline: ${escHtml(data.baseline.name || data.baseline.id)}</span>` : ''}
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
      <div class="panel-title">Comparison Summary</div>
      <div class="panel-body">
        <div>
          ${winner ? `<strong>${escHtml(labelFor(winner.task))}</strong> leads the comparison with an overall performance index of <strong>${winnerScore}%</strong>${warningText}.` : 'No compared sessions loaded.'}
        </div>
        ${rankingsHtml}
      </div>
    </div>

    <div class="tip-banner">
      <span>💡</span>
      <span><strong>Tip:</strong> Click on any row in the comparison table to view detailed metrics and scoring explanations against the baseline.</span>
    </div>

    <div class="deep-compare-wrap">
      <table class="deep-compare-table">
        <thead>
          <tr>
            <th>Metric</th>
            ${comparedRows.map(r => `<th>${escHtml(labelFor(r.task))}</th>`).join('')}
          </tr>
        </thead>
        <tbody>
          <tr class="section-row"><td colspan="${comparedRows.length + 1}">Performance Summary</td></tr>
          <tr class="score-row interactive-row" data-metric="overall_index" style="background:rgba(91, 158, 245, 0.05)">
            <td><strong>Overall Performance Index</strong></td>
            ${comparedRows.map(r => {
              const details = calculateOverallIndex(r, rows, data.baseline);
              return `<td>
                <strong>${details.score}%</strong>
                <div class="progress-bar"><div class="progress-fill ${scoreClass(details.score)}" style="width:${details.score}%"></div></div>
                <div style="font-size:9px;color:var(--text-3);margin-top:4px;display:flex;flex-direction:column;gap:2px">
                  <div>60% behavior / 40% operations</div>
                  <div style="color:var(--text-4);font-family:var(--font-mono)">Ops: Cost ${details.costScore}%, Speed ${details.durationScore}%, Tools ${details.toolsScore}%, Errors ${details.errorsScore}%</div>
                </div>
              </td>`;
            }).join('')}
          </tr>
          <tr class="score-row interactive-row" data-metric="behavioral_score">
            <td>Behavioral Test Score</td>
            ${comparedRows.map(r => `<td><strong>${r.tests?.overall_score || 0}%</strong><div class="progress-bar"><div class="progress-fill ${scoreClass(r.tests?.overall_score || 0)}" style="width:${r.tests?.overall_score || 0}%"></div></div></td>`).join('')}
          </tr>

          <tr class="section-row"><td colspan="${comparedRows.length + 1}">Behavioral Pattern Scoring</td></tr>
          ${['tia','bcv','mtv','bse','erc','cec'].map(pattern => renderPatternRow(pattern, comparedRows)).join('')}
          
          <tr class="section-row"><td colspan="${comparedRows.length + 1}">Operational Efficiency</td></tr>
          ${metricRow('Cost', comparedRows, r => `<span style="color:var(--green);font-weight:600">${fmtCost(r.task.total_cost || 0)}</span>`, 'cost')}
          ${metricRow('Tokens In', comparedRows, r => fmtNum(r.task.total_tokens_in || 0), 'tokens_in')}
          ${metricRow('Tokens Out', comparedRows, r => fmtNum(r.task.total_tokens_out || 0), 'tokens_out')}
          ${metricRow('Cache Reads', comparedRows, r => fmtNum(r.task.total_cache_reads || 0), 'cache_reads')}
          ${metricRow('Duration', comparedRows, r => fmtDuration(r.task.duration || 0), 'duration')}
          ${metricRow('API Calls', comparedRows, r => r.task.api_call_count || 0, 'api_calls')}
          ${metricRow('Tool Calls', comparedRows, r => r.task.tool_call_count || 0, 'tool_calls')}
          ${metricRow('Errors', comparedRows, r => r.task.error_count || 0, 'errors')}
          ${metricRow('Context Condensation', comparedRows, r => r.task.has_context_reset ? '<span class="badge yellow">Yes</span>' : '<span class="badge green">No</span>')}
          ${metricRow('Status', comparedRows, r => `<span class="badge ${r.task.status === 'completed' ? 'green' : 'yellow'}">${escHtml(r.task.status)}</span>`)}
          ${metricRow('Activity', comparedRows, r => `<span class="badge grey">${escHtml(r.task.activity_category || 'general')}</span>`)}
          
          <tr class="section-row"><td colspan="${comparedRows.length + 1}">Task Completion & Feedback</td></tr>
          ${metricRow('Completion Summary', comparedRows, (r, idx) => {
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
          ${metricRow('User Rating', comparedRows, r => r.tests?.user_rating ? `<span style="color:#f59e0b;font-size:14px">${'★'.repeat(r.tests.user_rating)}${'☆'.repeat(5 - r.tests.user_rating)}</span>` : 'Not rated')}
          
          <tr class="section-row"><td colspan="${comparedRows.length + 1}">Baseline Essential Step Coverage</td></tr>
          ${renderEssentialStepsRows(comparedRows, data.baseline)}
        </tbody>
      </table>
    </div>
  `;

  // Wire baseline switcher
  document.getElementById('compare-baseline-select')?.addEventListener('change', e => {
    const next = e.target.value;
    window.location.hash = `#/deepcompare?tasks=${encodeURIComponent(ids.join(','))}${next ? `&baseline=${encodeURIComponent(next)}` : ''}`;
  });

  // Modal opening & interactive row click listener
  container.addEventListener('click', e => {
    const btn = e.target.closest('[data-view-completion]');
    if (btn) {
      e.stopPropagation(); // Avoid triggering row details
      const idx = parseInt(btn.dataset.viewCompletion);
      const row = comparedRows[idx];
      if (row) {
        showFullCompletionModal(labelFor(row.task), row.tests?.completion_message || '');
      }
      return;
    }

    const interactiveRow = e.target.closest('.interactive-row');
    if (interactiveRow) {
      const metric = interactiveRow.dataset.metric;
      if (metric) {
        showRowDetailsModal(metric, comparedRows, data.baseline);
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
    <tr class="interactive-row" data-metric="${pattern}">
      <td>${labels[pattern]}</td>
      ${rows.map(r => {
        const result = r.tests?.results?.find(x => x.pattern === pattern);
        return `<td><span class="badge ${statusColor(result?.status)}">${(result?.status || 'skip').toUpperCase()} ${result?.status === 'skip' ? '' : `${result?.score || 0}%`}</span></td>`;
      }).join('')}
    </tr>
  `;
}

function metricRow(label, rows, getter, metricKey = '') {
  return `<tr class="${metricKey ? 'interactive-row' : ''}" ${metricKey ? `data-metric="${metricKey}"` : ''}><td>${label}</td>${rows.map((r, idx) => `<td>${getter(r, idx)}</td>`).join('')}</tr>`;
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

function showFullRowDetailsModal(title, htmlContent) {
  let modal = document.getElementById('row-detail-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'row-detail-modal';
    modal.className = 'modal-backdrop';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-panel" style="width:min(720px, 95%)">
      <div class="modal-head">
        <div>
          <h2 style="margin:0">${escHtml(title)}</h2>
          <p style="margin:4px 0 0;font-size:11px;color:var(--text-3)">Detailed comparison against baseline reference</p>
        </div>
        <button class="page-btn modal-close-btn">Close</button>
      </div>
      <div class="modal-body" style="max-height:60vh;overflow-y:auto;line-height:1.6;font-size:13px;white-space:normal">
        ${htmlContent}
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

function formatEvidence(evidenceList) {
  if (!evidenceList || evidenceList.length === 0) return '<div style="color:var(--text-3)">No evidence details available</div>';
  return `<div style="display:flex; flex-direction:column; gap:6px; font-size:11px">
    ${evidenceList.map(e => {
      let colorClass = 'var(--text-2)';
      let symbol = 'ℹ';
      if (e.severity === 'critical' || e.severity === 'violation') {
        colorClass = 'var(--red)';
        symbol = '✕';
      } else if (e.severity === 'warning') {
        colorClass = 'var(--yellow)';
        symbol = '⚠️';
      } else if (e.type === 'expected' || e.type === 'pass' || (e.severity === 'info' && (e.value.toLowerCase().includes('pass') || e.value.toLowerCase().includes('correct') || e.value.toLowerCase().includes('success') || e.value.toLowerCase().includes('covered')))) {
        colorClass = 'var(--green)';
        symbol = '✓';
      }
      return `<div style="display:flex; gap:6px; line-height:1.4">
        <span style="color:${colorClass}; font-weight:bold">${symbol}</span>
        <span style="color:var(--text-3); font-weight:500; min-width:120px">${escHtml(e.label)}:</span>
        <span style="color:${colorClass}; font-family:var(--font-mono); word-break:break-all">${escHtml(e.value)}</span>
      </div>`;
    }).join('')}
  </div>`;
}

function showRowDetailsModal(metric, comparedRows, baseline) {
  const baselineMetrics = baseline?.reference_metrics || {};
  let title = '';
  let content = '';

  if (['tia','bcv','mtv','bse','erc','cec'].includes(metric)) {
    const labels = {
      tia: 'Tool Assertion (TIA)',
      bcv: 'Behavior Contract (BCV)',
      mtv: 'Tool Sequence & Essential Steps (MTV)',
      bse: 'Scope (BSE)',
      erc: 'Error Recovery (ERC)',
      cec: 'Context Efficiency (CEC)'
    };
    const descriptions = {
      tia: 'Validates usage of expected tools and penalizes invocation of excluded tools.',
      bcv: 'Verifies structural constraints, code blocks, required keywords, and excluded keywords in final response.',
      mtv: 'Validates that essential baseline steps were successfully executed and analyzes trace efficiency.',
      bse: 'Checks for destructive commands, execution outside workspace, and parses tool failures.',
      erc: 'Analyzes adaptability and recovery after encountering execution errors.',
      cec: 'Monitors token context window pressure relative to critical thresholds.'
    };
    
    title = labels[metric];
    content = `
      <p style="margin-bottom:12px">${descriptions[metric]}</p>
      
      ${metric === 'tia' && baseline ? `
      <div style="background:var(--bg-3); padding:10px; border-radius:4px; margin-bottom:14px; font-size:11px">
        <strong>Baseline Expected Tools:</strong> ${(baseline.expected_tools || []).map(t => `<code class="mono">${t}</code>`).join(', ') || 'None'}<br>
        <strong>Baseline Excluded Tools:</strong> ${(baseline.excluded_tools || []).map(t => `<code class="mono">${t}</code>`).join(', ') || 'None'}
      </div>` : ''}

      ${metric === 'bcv' && baseline && baseline.behavior_contract ? `
      <div style="background:var(--bg-3); padding:10px; border-radius:4px; margin-bottom:14px; font-size:11px">
        <strong>Required Keywords:</strong> ${(baseline.behavior_contract.output_keywords || []).map(k => `"${k}"`).join(', ') || 'None'}<br>
        <strong>Excluded Keywords:</strong> ${(baseline.behavior_contract.excluded_keywords || []).map(k => `"${k}"`).join(', ') || 'None'}<br>
        <strong>Constraints:</strong> Code Block: ${baseline.behavior_contract.has_code_block ? 'Yes' : 'No'} | Min Length: ${baseline.behavior_contract.output_min_length || baseline.behavior_contract.min_length || 0} chars
      </div>` : ''}

      ${metric === 'mtv' && baseline && baseline.tool_sequence?.filter(s => s.is_essential).length ? `
      <div style="background:var(--bg-3); padding:10px; border-radius:4px; margin-bottom:14px; font-size:11px">
        <strong>Essential Steps Configured in Baseline:</strong><br>
        ${baseline.tool_sequence.filter(s => s.is_essential).map((s, i) => `${i + 1}. <code class="mono">${s.tool_name}</code> ${s.file_path ? `→ <code class="mono">${s.file_path}</code>` : ''} (${escHtml(s.description || 'no description')})`).join('<br>')}
      </div>` : ''}

      ${!baseline ? `
      <div style="background:rgba(245, 158, 11, 0.1); border:1px solid rgba(245, 158, 11, 0.2); padding:10px; border-radius:4px; margin-bottom:14px; font-size:11px; color:#f59e0b">
        <strong>No baseline selected:</strong> Running in heuristic validation mode.
      </div>` : ''}

      <table class="data-table" style="font-size:12px">
        <thead>
          <tr>
            <th style="width:200px">Session</th>
            <th style="width:120px">Score</th>
            <th>Evidence & Validation Logs</th>
          </tr>
        </thead>
        <tbody>
          ${comparedRows.map(r => {
            const result = r.tests?.results?.find(x => x.pattern === metric) || {};
            return `
              <tr>
                <td class="mono" style="vertical-align:top; font-weight:600">${escHtml(labelFor(r.task))}</td>
                <td style="vertical-align:top">
                  <span class="badge ${statusColor(result.status)}">${(result.status || 'skip').toUpperCase()} ${result.score ?? 0}%</span>
                </td>
                <td>
                  ${formatEvidence(result.evidence)}
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }
  else if (metric === 'overall_index') {
    title = 'Overall Performance Index';
    content = `
      <p style="margin-bottom:12px">The Overall Performance Index balances behavioral compliance with operational efficiency:</p>
      <div style="background:var(--bg-3); padding:10px; border-radius:4px; margin-bottom:14px; font-family:var(--font-mono); font-size:11px">
         Overall Index = 60% Behavioral Score + 40% Operational Score
      </div>
      <table class="data-table" style="font-size:12px">
        <thead>
          <tr>
            <th>Session</th>
            <th>Behavioral Score (60%)</th>
            <th>Operational Score (40%)</th>
            <th>Operational Breakdown (Cost / Speed / Tools / Errors)</th>
          </tr>
        </thead>
        <tbody>
          ${comparedRows.map(r => {
            const details = calculateOverallIndex(r, comparedRows, baseline);
            return `
              <tr>
                <td class="mono">${escHtml(labelFor(r.task))}</td>
                <td><strong>${details.behavioralScore}%</strong></td>
                <td><strong>${details.operationalScore}%</strong></td>
                <td class="mono" style="font-size:10px; color:var(--text-3)">
                  Cost: ${details.costScore}%<br>
                  Speed: ${details.durationScore}%<br>
                  Tools: ${details.toolsScore}%<br>
                  Errors: ${details.errorsScore}%
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }
  else if (metric === 'behavioral_score') {
    title = 'Behavioral Test Score';
    content = `
      <p style="margin-bottom:12px">The Behavioral Test Score is calculated as a weighted average of automated pattern scores (TIA, BCV, MTV, BSE, ERC, CEC) minus any user interruption penalties:</p>
      <table class="data-table" style="font-size:12px">
        <thead>
          <tr>
            <th>Session</th>
            <th>Base Score</th>
            <th>Interruption Penalty</th>
            <th>Final Score</th>
          </tr>
        </thead>
        <tbody>
          ${comparedRows.map(r => {
            const suite = r.tests || {};
            return `
              <tr>
                <td class="mono">${escHtml(labelFor(r.task))}</td>
                <td>${suite.base_score || suite.overall_score || 0}%</td>
                <td>${suite.interruption_penalty > 0 ? `<span style="color:var(--red)">-${suite.interruption_penalty}% (${suite.interruption_count} interruptions)</span>` : '0%'}</td>
                <td><strong>${suite.overall_score || 0}%</strong></td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }
  else if (metric === 'cost') {
    title = 'Cost';
    const isHeuristic = !baseline || !baseline.reference_metrics;
    const baseCost = isHeuristic 
      ? Math.min(...comparedRows.map(x => x.task.total_cost || 0)) 
      : (baseline.reference_metrics.cost || 0);
      
    content = `
      <p style="margin-bottom:12px">Compares total dollar cost of each session against the reference cost.</p>
      <div style="background:var(--bg-3); padding:10px; border-radius:4px; margin-bottom:14px; font-size:11px">
        <strong>${isHeuristic ? 'Best-in-class Reference Cost (Heuristic)' : 'Baseline Cost Reference'}:</strong> <strong style="color:var(--green)">${fmtCost(baseCost)}</strong>
      </div>
      <table class="data-table" style="font-size:12px">
        <thead>
          <tr>
            <th>Session</th>
            <th>Actual Cost</th>
            <th>Difference</th>
          </tr>
        </thead>
        <tbody>
          ${comparedRows.map(r => {
            const cost = r.task.total_cost || 0;
            const diff = cost - baseCost;
            const diffText = diff > 0 
              ? `<span style="color:var(--red)">+${fmtCost(diff)} (${Math.round((diff / (baseCost || 0.0001)) * 100)}% higher)</span>` 
              : diff < 0 
                ? `<span style="color:var(--green)">-${fmtCost(Math.abs(diff))} (${Math.round((Math.abs(diff) / (baseCost || 0.0001)) * 100)}% savings)</span>` 
                : 'Equal';
            return `
              <tr>
                <td class="mono">${escHtml(labelFor(r.task))}</td>
                <td style="color:var(--green); font-weight:600">${fmtCost(cost)}</td>
                <td>${diffText}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }
  else if (metric === 'duration') {
    title = 'Duration';
    const isHeuristic = !baseline || !baseline.reference_metrics;
    const baseDur = isHeuristic 
      ? Math.min(...comparedRows.map(x => x.task.duration || 0)) 
      : (baseline.reference_metrics.duration || 0);
      
    content = `
      <p style="margin-bottom:12px">Compares execution time of each session against the reference duration.</p>
      <div style="background:var(--bg-3); padding:10px; border-radius:4px; margin-bottom:14px; font-size:11px">
        <strong>${isHeuristic ? 'Best-in-class Reference Duration (Heuristic)' : 'Baseline Duration Reference'}:</strong> <strong>${fmtDuration(baseDur)}</strong>
      </div>
      <table class="data-table" style="font-size:12px">
        <thead>
          <tr>
            <th>Session</th>
            <th>Actual Duration</th>
            <th>Difference</th>
          </tr>
        </thead>
        <tbody>
          ${comparedRows.map(r => {
            const dur = r.task.duration || 0;
            const diff = dur - baseDur;
            const diffText = diff > 0 
              ? `<span style="color:var(--red)">+${fmtDuration(diff)} slower</span>` 
              : diff < 0 
                ? `<span style="color:var(--green)">-${fmtDuration(Math.abs(diff))} faster</span>` 
                : 'Equal';
            return `
              <tr>
                <td class="mono">${escHtml(labelFor(r.task))}</td>
                <td>${fmtDuration(dur)}</td>
                <td>${diffText}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }
  else {
    const labelMapping = {
      tokens_in: 'Tokens In',
      tokens_out: 'Tokens Out',
      cache_reads: 'Cache Reads',
      api_calls: 'API Calls',
      tool_calls: 'Tool Calls',
      errors: 'Errors'
    };
    const dbKeyMapping = {
      tokens_in: 'total_tokens_in',
      tokens_out: 'total_tokens_out',
      cache_reads: 'total_cache_reads',
      api_calls: 'api_call_count',
      tool_calls: 'tool_call_count',
      errors: 'error_count'
    };
    const baselineKeyMapping = {
      tokens_in: 'tokens_in',
      tokens_out: 'tokens_out',
      cache_reads: 'cache_reads',
      api_calls: 'api_calls',
      tool_calls: 'tool_calls',
      errors: 'error_count'
    };

    const label = labelMapping[metric] || metric;
    const dbKey = dbKeyMapping[metric] || metric;
    const baseKey = baselineKeyMapping[metric] || metric;
    
    const isHeuristic = !baseline || !baseline.reference_metrics;
    const baseVal = isHeuristic 
      ? Math.min(...comparedRows.map(x => x.task[dbKey] || 0)) 
      : (baseline.reference_metrics[baseKey] || 0);

    title = label;
    content = `
      <p style="margin-bottom:12px">Compares ${label.toLowerCase()} counts side-by-side against the reference value.</p>
      <div style="background:var(--bg-3); padding:10px; border-radius:4px; margin-bottom:14px; font-size:11px">
        <strong>${isHeuristic ? `Best-in-class Reference ${label} (Heuristic)` : `Baseline ${label} Reference`}:</strong> <strong>${fmtNum(baseVal)}</strong>
      </div>
      <table class="data-table" style="font-size:12px">
        <thead>
          <tr>
            <th>Session</th>
            <th>Actual Count</th>
            <th>Difference</th>
          </tr>
        </thead>
        <tbody>
          ${comparedRows.map(r => {
            const val = r.task[dbKey] || 0;
            const diff = val - baseVal;
            const diffText = diff > 0 
              ? `<span style="color:var(--red)">+${fmtNum(diff)}</span>` 
              : diff < 0 
                ? `<span style="color:var(--green)">-${fmtNum(Math.abs(diff))}</span>` 
                : 'Equal';
            return `
              <tr>
                <td class="mono">${escHtml(labelFor(r.task))}</td>
                <td><strong>${fmtNum(val)}</strong></td>
                <td>${diffText}</td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  }

  showFullRowDetailsModal(title, content);
}
