import { api } from '../api.js';
import { fmtCost, fmtDuration, fmtDateTime, fmtMs } from '../utils.js';

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
        <div><div class="stat-label">Started</div><div style="font-size:13px">${fmtDateTime(task.start_ts)}</div></div>
        <div><div class="stat-label">Source</div><div style="font-size:13px">${task.source || '—'}</div></div>
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

      return `
        ${i > 0 ? `<div class="timeline-connector ${e.error_category ? 'error-gap' : ''}"></div>` : ''}
        <div class="timeline-node" data-idx="${i}" title="${e.sub_type}: ${e.content_preview || ''}">
          <div class="timeline-node-dot ${nodeClass(e)}">
            ${nodeIcon(e)}
          </div>
          <div class="timeline-node-label">${e.sub_type?.replace('api_req_started','api')?.replace('checkpoint_created','ckpt') || '?'}</div>
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

      const panel = document.getElementById('event-detail-panel');
      panel.style.display = 'block';
      panel.innerHTML = `
        <div class="panel">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <div>
              <span class="badge ${eventBadgeColor(e)}" style="margin-right:8px">${e.type}.${e.sub_type}</span>
              <span style="font-size:12px;color:var(--text-3)">${fmtDateTime(e.ts)}</span>
            </div>
            ${e.model_id ? `<span class="badge accent mono">${e.model_id}</span>` : ''}
          </div>
          ${e.cost != null ? `
            <div style="display:flex;gap:20px;margin-bottom:12px;font-size:12px;color:var(--text-2)">
              <span>💰 ${fmtCost(e.cost)}</span>
              <span>↑ ${e.tokens_in || 0} in</span>
              <span>↓ ${e.tokens_out || 0} out</span>
              <span>💾 ${e.cache_reads || 0} cached</span>
            </div>
          ` : ''}
          ${e.error_message ? `
            <div style="padding:10px;background:var(--red-dim);border-radius:var(--radius-sm);color:var(--red);font-size:12px;margin-bottom:10px">
              ⚠ ${e.error_category}: ${e.error_message}
            </div>
          ` : ''}
          ${e.tool_name ? `
            <div style="font-size:12px;color:var(--text-2);margin-bottom:8px">
              🔧 Tool: <span class="mono">${e.tool_name}</span>
            </div>
          ` : ''}
          ${e.command_text ? `
            <div style="font-size:12px;color:var(--text-2);margin-bottom:8px">
              $ <span class="mono">${e.command_text}</span>
            </div>
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

function statusBadge(status) {
  const map = { completed: ['green','✓ Completed'], interrupted: ['yellow','⏸ Interrupted'], error: ['red','✕ Error'], unknown: ['grey','? Unknown'] };
  const [color, label] = map[status] || ['grey', status];
  return `<span class="badge ${color}">${label}</span>`;
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
