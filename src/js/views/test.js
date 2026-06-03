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
            ${suite.user_rating ? `
              <div style="font-size:11px;color:var(--text-3);margin-top:4px">
                (includes -${suite.interruption_penalty}% interruption penalty, 
                 rating: ${'★'.repeat(suite.user_rating)}${'☆'.repeat(5-suite.user_rating)} 
                 → blended at 70/30)
              </div>
            ` : suite.interruption_penalty > 0 ? `
              <div style="font-size:11px;color:var(--text-3);margin-top:4px">(includes -${suite.interruption_penalty}% interruption penalty)</div>
            ` : ''}
          </div>
          <div class="score-track"><div class="score-fill ${scoreClass(suite.overall_score)}" style="width:${suite.overall_score}%"></div></div>
        </div>
      </div>
    </div>

    <!-- Session Health Card -->
    <div class="panel">
      <div class="panel-title">Session Health</div>
      <div class="panel-body" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(120px, 1fr));gap:12px">
        <div style="background:var(--bg-3);padding:10px;border-radius:var(--radius-sm)">
          <span style="display:block;color:var(--text-3);font-size:10px;text-transform:uppercase">User Interruptions</span>
          <strong style="font-size:16px;color:var(--text)">${suite.interruption_count || 0}</strong>
        </div>
        <div style="background:var(--bg-3);padding:10px;border-radius:var(--radius-sm)">
          <span style="display:block;color:var(--text-3);font-size:10px;text-transform:uppercase">Context Resets</span>
          <strong style="font-size:16px;color:var(--text)">${task.has_context_reset ? 1 : 0}</strong>
        </div>
        <div style="background:var(--bg-3);padding:10px;border-radius:var(--radius-sm)">
          <span style="display:block;color:var(--text-3);font-size:10px;text-transform:uppercase">Tool Failures</span>
          <strong style="font-size:16px;color:var(--text)">${suite.failed_tools?.length || 0}</strong>
        </div>
      </div>
    </div>

    <!-- Tool Failures Section -->
    ${suite.failed_tools?.length > 0 ? `
      <div class="panel">
        <div class="panel-title" style="color:var(--red)">Tool Failures (${suite.failed_tools.length})</div>
        <div class="panel-body">
          <div class="evidence-list">
            ${suite.failed_tools.map(f => `
              <div class="evidence-row warning">
                <span class="mono">${escHtml(f.tool_name)}</span>
                <strong>${escHtml(ftCategoryLabel(f.error_category))} (${f.count} attempt(s)): "${escHtml(f.error_message)}"</strong>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    ` : ''}

    <div class="test-results">
      ${suite.results.map(renderResult).join('')}
    </div>

    <!-- Task Completion & Rating Section -->
    <div class="panel" style="margin-top:20px">
      <div class="panel-title">Task Completion & Rating</div>
      <div class="panel-body">
        <div style="background:var(--bg-3);padding:14px;border-radius:var(--radius-sm);border:1px solid var(--border);margin-bottom:12px;color:var(--text-2);white-space:normal;line-height:1.6">
          ${formatMarkdown(suite.completion_message || 'No completion message captured for this session.')}
        </div>
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <span style="font-size:12px">Rate this completion:</span>
          <div class="star-rating" id="test-completion-rating" data-rating="${suite.user_rating || 0}">
            ${[1,2,3,4,5].map(val => `
              <span class="star ${suite.user_rating >= val ? 'selected' : ''}" data-value="${val}">★</span>
            `).join('')}
          </div>
          <button id="save-rating-btn" class="action-btn primary" style="padding:4px 10px;min-height:auto" disabled>Save Rating</button>
          <span id="rating-status" style="font-size:11px;color:var(--green)"></span>
        </div>
      </div>
    </div>
  `;

  document.getElementById('baseline-select')?.addEventListener('change', e => {
    const next = e.target.value;
    window.location.hash = `#/test?task=${encodeURIComponent(taskId)}${next ? `&baseline=${encodeURIComponent(next)}` : ''}`;
  });
  document.getElementById('rerun-test')?.addEventListener('click', () => {
    window.location.hash = `#/test?task=${encodeURIComponent(taskId)}${baselineId ? `&baseline=${encodeURIComponent(baselineId)}&t=${Date.now()}` : `&t=${Date.now()}`}`;
  });

  // Star Rating Listeners
  const ratingEl = document.getElementById('test-completion-rating');
  const saveRatingBtn = document.getElementById('save-rating-btn');
  const ratingStatus = document.getElementById('rating-status');
  let chosenRating = suite.user_rating || 0;

  if (ratingEl && saveRatingBtn) {
    const stars = ratingEl.querySelectorAll('.star');
    stars.forEach(star => {
      star.addEventListener('mouseenter', () => {
        const val = parseInt(star.dataset.value);
        stars.forEach(s => {
          s.classList.toggle('hover', parseInt(s.dataset.value) <= val);
        });
      });

      star.addEventListener('mouseleave', () => {
        stars.forEach(s => s.classList.remove('hover'));
      });

      star.addEventListener('click', () => {
        chosenRating = parseInt(star.dataset.value);
        ratingEl.dataset.rating = chosenRating;
        stars.forEach(s => {
          s.classList.toggle('selected', parseInt(s.dataset.value) <= chosenRating);
        });
        saveRatingBtn.disabled = false;
      });
    });

    saveRatingBtn.addEventListener('click', async () => {
      saveRatingBtn.textContent = 'Saving...';
      saveRatingBtn.disabled = true;
      try {
        await api.rateTestResult(suite.id, { rating: chosenRating });
        ratingStatus.textContent = '✓ Rating saved successfully!';
        saveRatingBtn.textContent = 'Save Rating';
        setTimeout(() => { ratingStatus.textContent = ''; }, 3000);
      } catch (err) {
        saveRatingBtn.textContent = 'Save Rating';
        saveRatingBtn.disabled = false;
        alert('Failed to save rating: ' + err.message);
      }
    });
  }
}

function ftCategoryLabel(cat) {
  return {
    mcp_not_connected: 'MCP Server Not Connected',
    missing_params: 'Missing Required Parameters',
    tool_execution_error: 'Tool Execution Error',
    unknown_tool: 'Unknown Tool Name'
  }[cat] || cat;
}

async function renderPicker(container, baselineId) {
  const [tasks, baselines] = await Promise.all([
    api.tasks({ limit: 50 }),
    api.baselines().catch(() => ({ baselines: [] })),
  ]);
  container.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">Test Session</h1>
      <p class="view-subtitle">Choose a session to run behavioral tests.</p>
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
          <thead><tr><th>Session</th><th>Model</th><th>Started</th><th>Cost</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${(tasks.tasks || []).map(t => `
              <tr>
                <td><div class="mono">${escHtml(t.id.slice(0, 18))}</div><div style="max-width:520px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(t.first_message || '')}</div></td>
                <td>${escHtml(t.models?.[0]?.model_id || 'Unknown')}</td>
                <td>${fmtDateTime(t.start_ts)}</td>
                <td>${fmtCost(t.total_cost || 0)}</td>
                <td><span class="badge ${t.status === 'completed' ? 'green' : t.status === 'interrupted' ? 'yellow' : 'red'}">${escHtml(t.status)}</span></td>
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

function formatMarkdown(text) {
  if (!text) return '';
  return escHtml(text)
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`(.*?)`/g, '<code class="mono" style="background:var(--bg-4);padding:2px 4px;border-radius:3px">$1</code>')
    .replace(/\n/g, '<br>')
    .replace(/^- (.*?)(?:<br>|$)/gm, '<li>$1</li>');
}
