import { api } from '../api.js';
import { fmtCost, fmtDuration, fmtDateTime, fmtMs } from '../utils.js';

// Major event types — these count toward the "2 before + 2 after" context window
const MAJOR_TYPES = new Set([
  'api_req_started', 'tool', 'error', 'command', 'reasoning',
  'completion_result', 'text'
]);

function isMajorEvent(e) {
  return MAJOR_TYPES.has(e.sub_type);
}

export async function renderTimeline(container, taskId) {
  if (!taskId) {
    container.innerHTML = `
      <div class="view-header">
        <h1 class="view-title">Task Timeline</h1>
        <p class="view-subtitle">Select a session from Sessions view to explore its event timeline</p>
      </div>
      <div class="empty-state">
        <div class="icon">⟶</div>
        <p>No session selected. Go to <a href="#/sessions" style="color:var(--accent)">Sessions</a> and click a row.</p>
      </div>`;
    return;
  }

  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading timeline...</p></div>`;

  const [task, events] = await Promise.all([
    api.task(taskId),
    api.taskEvents(taskId)
  ]);

  const models = (task.models || []).map(m => m.model_id).filter(Boolean);
  const uniqueModels = [...new Set(models)];
  const modelSwitchCount = events.filter(e => e.model_switched).length;

  container.innerHTML = `
    <div class="view-header">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <a href="#/sessions" style="color:var(--text-3);text-decoration:none;font-size:13px">← Sessions</a>
        <h1 class="view-title" style="margin:0">Task Timeline</h1>
        ${statusBadge(task.status)}
      </div>
      <p class="view-subtitle mono" style="margin-top:6px">${taskId}</p>
    </div>

    <!-- Task summary bar -->
    <div class="panel" style="padding:16px 24px;margin-bottom:20px">
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:16px">
        <div><div class="stat-label">Duration</div><div style="font-size:15px;font-weight:600">${fmtDuration(task.duration)}</div></div>
        <div><div class="stat-label">Total Cost</div><div style="font-size:15px;font-weight:600;color:var(--green)">${fmtCost(task.total_cost)}</div></div>
        <div><div class="stat-label">API Calls</div><div style="font-size:15px;font-weight:600">${task.api_call_count || 0}</div></div>
        <div><div class="stat-label">Tool Calls</div><div style="font-size:15px;font-weight:600">${task.tool_call_count || 0}</div></div>
        <div><div class="stat-label">Errors</div><div style="font-size:15px;font-weight:600;color:${task.error_count > 0 ? 'var(--red)' : 'var(--text-2)'}">${task.error_count || 0}</div></div>
        <div><div class="stat-label">Events</div><div style="font-size:15px;font-weight:600">${events.length}</div></div>
        <div><div class="stat-label">Model Switches</div><div style="font-size:15px;font-weight:600;color:${modelSwitchCount > 0 ? 'var(--blue)' : 'var(--text-2)'}">${modelSwitchCount}</div></div>
        <div><div class="stat-label">Started</div><div style="font-size:13px">${fmtDateTime(task.start_ts)}</div></div>
      </div>
      ${uniqueModels.length ? `
        <div style="margin-top:12px;padding-top:12px;border-top:1px solid var(--border)">
          <span style="font-size:11px;color:var(--text-3);margin-right:8px">MODELS</span>
          ${uniqueModels.map(m => `<span class="badge accent mono" style="margin-right:4px">${m}</span>`).join('')}
        </div>
      ` : ''}
    </div>

    <!-- Filter bar -->
    <div class="filters-bar" style="margin-bottom:14px">
      <span style="font-size:12px;color:var(--text-3)">Show:</span>
      ${renderLegend()}
    </div>

    <!-- Timeline -->
    <div class="panel">
      <div class="panel-title">Event Timeline (${events.length} events)</div>
      <div class="timeline-container" id="timeline-track-wrap">
        ${buildTimeline(events)}
      </div>
    </div>

    <!-- Detail panel -->
    <div id="event-detail-panel" style="display:none"></div>
  `;

  wireTimelineClicks(events);
}

function buildTimeline(events) {
  if (!events.length) return '<div class="empty-state"><p>No events</p></div>';

  // Group very dense events — show at most 200 nodes
  const nodes = events.slice(0, 200);

  return `<div class="timeline-track">
    ${nodes.map((e, i) => {
      const prev = i > 0 ? nodes[i - 1] : null;
      const gap = prev ? e.ts - prev.ts : 0;
      const isLargeGap = gap > 5000;

      // Model switch divider
      const modelSwitchDivider = (e.model_switched || e.model_switched === 1) ? `
        <div class="timeline-model-switch">
          <div class="timeline-model-switch-line"></div>
          <div class="timeline-model-switch-badge">
            🔄 <span class="mono">${e.provider_id ? e.provider_id + '/' : ''}${e.model_id || 'unknown'}</span>
          </div>
        </div>
      ` : '';

      // Context window badge for api_req_started
      const ctxBadge = (e.sub_type === 'api_req_started' && e.context_pct != null) ?
        `<div class="ctx-badge ${ctxColor(e.context_pct)}">ctx ${e.context_pct}%</div>` : '';

      // Retry badge
      const retryBadge = (e.retry_count && e.retry_count > 0) ?
        `<div class="retry-badge">↺${e.retry_count}</div>` : '';

      return `
        ${modelSwitchDivider}
        ${i > 0 && !modelSwitchDivider ? `<div class="timeline-connector ${e.error_category ? 'error-gap' : ''}"></div>` : ''}
        <div class="timeline-node" data-idx="${i}" title="${e.sub_type}: ${e.content_preview || ''}">
          <div class="timeline-node-dot ${nodeClass(e)}">
            ${nodeIcon(e)}
          </div>
          <div class="timeline-node-label">${e.sub_type?.replace('api_req_started','api')?.replace('checkpoint_created','ckpt') || '?'}</div>
          ${ctxBadge}
          ${retryBadge}
          ${isLargeGap ? `<div style="font-size:9px;color:var(--text-3);margin-top:2px">+${fmtMs(gap)}</div>` : ''}
        </div>
      `;
    }).join('')}
  </div>`;
}

function wireTimelineClicks(events) {
  document.querySelectorAll('.timeline-node').forEach(node => {
    node.addEventListener('click', () => {
      const idx = parseInt(node.dataset.idx);
      const e = events[idx];
      if (!e) return;

      // Highlight selected
      document.querySelectorAll('.timeline-node-dot').forEach(d => d.style.boxShadow = '');
      node.querySelector('.timeline-node-dot').style.boxShadow = '0 0 0 3px var(--accent)';

      // Build context: 2 major events before + 2 major events after
      const contextEvents = getContextEvents(events, idx, 2);

      const panel = document.getElementById('event-detail-panel');
      panel.style.display = 'block';
      panel.innerHTML = `
        <div class="panel" style="margin-top:16px">
          <!-- Context Log section -->
          <div style="margin-bottom:16px">
            <div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:10px;display:flex;align-items:center;gap:6px">
              📋 Context Log <span style="font-size:10px;font-weight:400;color:var(--text-3)">(±2 major events, minor events shown)</span>
            </div>
            <div class="context-log">
              ${contextEvents.map(ce => `
                <div class="context-log-entry ${ce.idx === idx ? 'context-log-selected' : ''} ${ce.isMajor ? '' : 'context-log-minor'}">
                  <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
                    <div style="display:flex;align-items:center;gap:6px">
                      <span class="badge ${eventBadgeColor(ce.event)}" style="font-size:10px;padding:2px 6px">${ce.event.sub_type?.replace('api_req_started','api') || '?'}</span>
                      ${ce.event.model_switched ? '<span style="font-size:9px;color:var(--blue)">🔄</span>' : ''}
                      ${ce.event.retry_count > 0 ? `<span class="retry-badge-inline">↺${ce.event.retry_count}</span>` : ''}
                      ${ce.event.context_pct != null ? `<span class="ctx-badge-inline ${ctxColor(ce.event.context_pct)}">ctx ${ce.event.context_pct}%</span>` : ''}
                    </div>
                    <span style="font-size:10px;color:var(--text-3)">${fmtDateTime(ce.event.ts)}</span>
                  </div>
                  <div style="font-size:11px;color:var(--text-2);margin-top:4px;word-break:break-all">
                    ${ce.event.error_message ? `<span style="color:var(--red)">⚠ ${escHtml(ce.event.error_message.substring(0, 120))}</span>` :
                      ce.event.tool_name ? `🔧 ${ce.event.tool_name}${ce.event.content_preview ? ' → ' + escHtml(ce.event.content_preview.substring(0, 80)) : ''}` :
                      ce.event.content_preview ? escHtml(ce.event.content_preview.substring(0, 120)) :
                      ce.event.model_id ? `Model: ${ce.event.model_id}` : '—'}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>

          <hr style="border:none;border-top:1px solid var(--border);margin:16px 0">

          <!-- Full Event Detail -->
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div>
              <span class="badge ${eventBadgeColor(e)}" style="margin-right:8px">${e.type}.${e.sub_type}</span>
              <span style="font-size:12px;color:var(--text-3)">${fmtDateTime(e.ts)}</span>
            </div>
            ${e.model_id ? `<span class="badge accent mono">${e.provider_id ? e.provider_id + '/' : ''}${e.model_id}</span>` : ''}
          </div>

          ${e.model_switched ? `
            <div style="padding:8px 12px;background:var(--blue-dim, rgba(59,130,246,0.1));border-radius:var(--radius-sm);color:var(--blue);font-size:12px;margin-bottom:10px;display:flex;align-items:center;gap:6px">
              🔄 Model switched to <strong class="mono">${e.provider_id ? e.provider_id + '/' : ''}${e.model_id}</strong>
            </div>
          ` : ''}

          ${e.retry_count > 0 ? `
            <div style="padding:8px 12px;background:var(--yellow-dim, rgba(234,179,8,0.1));border-radius:var(--radius-sm);color:var(--yellow);font-size:12px;margin-bottom:10px;display:flex;align-items:center;gap:6px">
              ↺ Retry attempt #${e.retry_count}
            </div>
          ` : ''}

          ${e.cost != null ? `
            <div style="display:flex;gap:20px;margin-bottom:12px;font-size:12px;color:var(--text-2);flex-wrap:wrap">
              <span>💰 ${fmtCost(e.cost)}</span>
              <span>↑ ${e.tokens_in || 0} in</span>
              <span>↓ ${e.tokens_out || 0} out</span>
              <span>💾 ${e.cache_reads || 0} cached</span>
              ${e.context_pct != null ? `<span class="ctx-badge-inline ${ctxColor(e.context_pct)}">Context: ${e.context_pct}% used</span>` : ''}
            </div>
          ` : ''}

          ${e.error_message ? `
            <div style="padding:10px;background:var(--red-dim);border-radius:var(--radius-sm);color:var(--red);font-size:12px;margin-bottom:10px">
              ⚠ <strong>${formatErrorCat(e.error_category)}</strong>: ${escHtml(e.error_message)}
            </div>
            ${buildTriggerSection(events, idx)}
          ` : ''}

          ${e.tool_name ? `
            <div style="font-size:12px;color:var(--text-2);margin-bottom:8px">
              🔧 Tool: <span class="mono">${e.tool_name}</span>
            </div>
          ` : ''}

          ${e.command_text ? `
            <div style="font-size:12px;color:var(--text-2);margin-bottom:8px">
              $ <span class="mono">${escHtml(e.command_text)}</span>
            </div>
          ` : ''}

          ${e.request_text ? `
            <details style="margin-bottom:10px">
              <summary style="font-size:11px;color:var(--text-3);cursor:pointer;margin-bottom:6px">📝 Request Text (click to expand)</summary>
              <div class="event-detail">
                <pre style="max-height:200px;overflow-y:auto;font-size:11px">${escHtml(e.request_text)}</pre>
              </div>
            </details>
          ` : ''}

          ${e.content_preview || e.reasoning_text ? `
            <div class="event-detail">
              <div style="font-size:11px;color:var(--text-3);margin-bottom:6px">${e.sub_type === 'reasoning' ? '🧠 Reasoning' : 'Content'}</div>
              <pre>${escHtml(e.reasoning_text || e.content_preview || '')}</pre>
            </div>
          ` : ''}
        </div>
      `;
      panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
}

/**
 * Get context events: 2 major events before and after the selected index.
 * Minor events (like checkpoint_created) are included but not counted.
 */
function getContextEvents(events, selectedIdx, majorCount) {
  const result = [];

  // Walk backward to collect 2 major events before
  let majorFound = 0;
  let startIdx = selectedIdx;
  for (let i = selectedIdx - 1; i >= 0 && majorFound < majorCount; i--) {
    startIdx = i;
    if (isMajorEvent(events[i])) majorFound++;
  }

  // Walk forward to collect 2 major events after
  majorFound = 0;
  let endIdx = selectedIdx;
  for (let i = selectedIdx + 1; i < events.length && majorFound < majorCount; i++) {
    endIdx = i;
    if (isMajorEvent(events[i])) majorFound++;
  }

  // Collect all events in the range (including minor ones)
  for (let i = startIdx; i <= endIdx; i++) {
    result.push({
      idx: i,
      event: events[i],
      isMajor: isMajorEvent(events[i]),
    });
  }

  return result;
}

/**
 * Build a "What triggered this?" section for error events.
 * Shows the preceding API call that likely caused the error.
 */
function buildTriggerSection(events, errorIdx) {
  // Look backward for the nearest api_req_started
  for (let i = errorIdx - 1; i >= 0; i--) {
    const e = events[i];
    if (e.sub_type === 'api_req_started') {
      return `
        <details style="margin-bottom:10px">
          <summary style="font-size:11px;color:var(--text-3);cursor:pointer">🔍 What triggered this error?</summary>
          <div style="padding:8px;background:var(--bg-3);border-radius:var(--radius-sm);margin-top:6px;font-size:11px">
            <div style="margin-bottom:4px"><strong>Preceding API call</strong> at ${fmtDateTime(e.ts)}</div>
            <div>Model: <span class="mono">${e.provider_id ? e.provider_id + '/' : ''}${e.model_id || '—'}</span></div>
            <div>Tokens: ↑${e.tokens_in || 0} ↓${e.tokens_out || 0} | Cost: ${fmtCost(e.cost)}</div>
            ${e.context_pct != null ? `<div>Context window: <span class="${ctxColor(e.context_pct)}">${e.context_pct}%</span></div>` : ''}
            
            ${e.request_text ? `
              <details style="margin-top:8px">
                <summary style="cursor:pointer;color:var(--text-2)">📝 Prompt (Request) Sent to Model</summary>
                <pre style="margin-top:6px;max-height:140px;overflow-y:auto;background:var(--bg-2);padding:6px;border:1px solid var(--border)">${escHtml(e.request_text.substring(0, 1000))}</pre>
              </details>
            ` : ''}

            ${e.response_text ? `
              <details style="margin-top:8px" open>
                <summary style="cursor:pointer;color:var(--purple);font-weight:600">🤖 Raw Model Response (Before Error)</summary>
                <pre style="margin-top:6px;max-height:220px;overflow-y:auto;background:var(--bg-2);padding:6px;border:1px solid var(--purple);color:var(--purple)">${escHtml(e.response_text)}</pre>
              </details>
            ` : ''}
          </div>
        </details>
      `;
    }
  }
  return '';
}

function renderLegend() {
  const types = [
    ['node-api', '◉', 'API Call'],
    ['node-tool', '🔧', 'Tool'],
    ['node-reasoning', '🧠', 'Reasoning'],
    ['node-error', '⚠', 'Error'],
    ['node-command', '$', 'Command'],
    ['node-checkpoint', '◆', 'Checkpoint'],
    ['node-complete', '✓', 'Complete'],
  ];
  return types.map(([cls, icon, label]) => `
    <span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px;font-size:11px;color:var(--text-3)">
      <span style="width:14px;height:14px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:8px" class="${cls}">${icon}</span>
      ${label}
    </span>
  `).join('');
}

function nodeClass(e) {
  if (e.error_category && e.error_category !== 'interruption') return 'node-error';
  switch (e.sub_type) {
    case 'reasoning': return 'node-reasoning';
    case 'api_req_started': return 'node-api';
    case 'tool': return 'node-tool';
    case 'command': return 'node-command';
    case 'checkpoint_created': return 'node-checkpoint';
    case 'completion_result': return 'node-complete';
    case 'error': return 'node-error';
    default: return 'node-text';
  }
}

function nodeIcon(e) {
  if (e.error_category === 'api_failure') return '✕';
  if (e.error_category) return '⚠';
  switch (e.sub_type) {
    case 'reasoning': return '🧠';
    case 'api_req_started': return '◉';
    case 'tool': return '⚙';
    case 'command': return '$';
    case 'checkpoint_created': return '◆';
    case 'completion_result': return '✓';
    case 'error': return '✕';
    case 'text': return e.type === 'say' ? '↩' : '↪';
    default: return '·';
  }
}

function eventBadgeColor(e) {
  if (e.error_category) return 'red';
  if (e.sub_type === 'reasoning') return 'purple';
  if (e.sub_type === 'api_req_started') return 'accent';
  if (e.sub_type === 'completion_result') return 'green';
  return 'grey';
}

function ctxColor(pct) {
  if (pct > 80) return 'ctx-red';
  if (pct > 50) return 'ctx-yellow';
  return 'ctx-green';
}

function formatErrorCat(cat) {
  return (cat || 'unknown').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function statusBadge(status) {
  const map = { completed: ['green','✓ Completed'], interrupted: ['yellow','⏸ Interrupted'], error: ['red','✕ Error'], unknown: ['grey','? Unknown'] };
  const [color, label] = map[status] || ['grey', status];
  return `<span class="badge ${color}">${label}</span>`;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
