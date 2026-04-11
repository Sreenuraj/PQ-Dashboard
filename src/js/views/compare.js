import { api } from '../api.js';
import { fmtDateTime, fmtDuration, fmtCost } from '../utils.js';

export async function renderCompare(container, taskIdsString) {
  if (!taskIdsString) {
    container.innerHTML = `<div class="empty-state">No tasks selected for comparison.</div>`;
    return;
  }

  const ids = taskIdsString.split(',').filter(Boolean);
  if (ids.length < 2) {
    container.innerHTML = `<div class="empty-state">Please select at least 2 tasks to compare.</div>`;
    return;
  }

  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Gathering comparison data...</p></div>`;

  try {
    const dataObjects = await Promise.all(ids.map(async id => {
        const [t, ev] = await Promise.all([api.task(id), api.evaluate(id).catch(() => null)]);
        return { task: t, eval: ev };
    }));
    
    // Calculate max values for bar charts
    const maxCost = Math.max(...dataObjects.map(d => d.task.total_cost || 0), 0.0001);
    const maxDuration = Math.max(...dataObjects.map(d => d.task.duration || 0), 1);
    
    container.innerHTML = `
      <div class="view-header" style="margin-bottom:20px;">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <a href="#/sessions" style="color:var(--text-3);text-decoration:none;font-size:13px">← Sessions</a>
          <h1 class="view-title" style="margin:0">Compare Tasks</h1>
          <span class="badge grey">${dataObjects.length} selected</span>
        </div>
        <p class="view-subtitle" style="margin-top:6px">Side-by-side comparison of execution metrics and automated agentic scores.</p>
      </div>

      <div style="display:flex;gap:20px;overflow-x:auto;padding-bottom:20px;">
        ${dataObjects.map(d => renderTaskColumn(d.task, d.eval, maxCost, maxDuration)).join('')}
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:var(--red)">Failed to load tasks: ${err.message}</div>`;
  }
}

function renderTaskColumn(t, ev, maxCost, maxDuration) {
  const costPct = Math.min(100, ((t.total_cost || 0) / maxCost) * 100);
  const durPct = Math.min(100, ((t.duration || 0) / maxDuration) * 100);
  
  let evalHtml = '<div style="font-size:11px;color:var(--text-3);padding:8px 0;text-align:center;">Evaluation unavailable</div>';
  if (ev && ev.metrics) {
      const { tue, ce, rd, err, overall } = ev.metrics;
      evalHtml = `
        <div style="background:var(--bg-3);padding:12px;border-radius:6px;margin-top:8px;">
          <div style="text-align:center;margin-bottom:12px;">
             <div style="font-size:10px;color:var(--text-3);margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px;">Auto Score</div>
             <div style="font-size:24px;font-weight:700;color:var(--accent)">
                ${overall}%
             </div>
          </div>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:11px;">
             <div style="display:flex;justify-content:space-between;"><span>Tool Efficacy (TUE)</span> <strong>${tue}%</strong></div>
             <div style="display:flex;justify-content:space-between;"><span>Error Recovery (ERR)</span> <strong>${err}%</strong></div>
             <div style="display:flex;justify-content:space-between;"><span>Reasoning Density (RD)</span> <strong>${rd}%</strong></div>
             <div style="display:flex;justify-content:space-between;"><span>Context Efficiency (CE)</span> <strong>${ce}%</strong></div>
          </div>
        </div>
      `;
  }

  return `
    <div class="panel" style="flex:1;min-width:300px;max-width:400px;display:flex;flex-direction:column;gap:16px;">
       <div>
         <div style="display:flex;justify-content:space-between;align-items:center;">
           <span class="mono" style="font-size:11px;color:var(--text-3)">${t.id.substring(0,8)}</span>
           ${statusBadge(t.status)}
         </div>
         <div style="font-size:12px;color:var(--text-2);margin-top:6px;">${fmtDateTime(t.start_ts)}</div>
       </div>

       <!-- Model Info -->
       <div style="background:var(--bg-2);padding:12px;border-radius:6px;border:1px solid var(--border);">
         <div style="font-size:10px;color:var(--text-3);margin-bottom:6px;">PRIMARY MODEL</div>
         <div style="font-size:13px;font-weight:500;" class="mono">${t.models?.[0]?.model_id || 'Unknown'}</div>
       </div>

       ${evalHtml}

       <!-- Stat Bars -->
       <div>
         <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;color:var(--text-2);">
           <span>Cost</span>
           <span style="font-weight:600;color:var(--green)">${fmtCost(t.total_cost)}</span>
         </div>
         <div style="width:100%;height:6px;background:var(--bg-3);border-radius:3px;overflow:hidden;margin-bottom:12px;">
           <div style="height:100%;background:var(--green);width:${costPct}%"></div>
         </div>

         <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;color:var(--text-2);">
           <span>Duration</span>
           <span style="font-weight:600;">${fmtDuration(t.duration)}</span>
         </div>
         <div style="width:100%;height:6px;background:var(--bg-3);border-radius:3px;overflow:hidden;margin-bottom:12px;">
           <div style="height:100%;background:var(--accent);width:${durPct}%"></div>
         </div>
         
         <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:4px;color:var(--text-2);">
           <span>Errors</span>
           <span style="font-weight:600;color:${t.error_count > 0 ? 'var(--red)' : 'var(--text-2)'}">${t.error_count || 0}</span>
         </div>
       </div>

       <!-- Prompt / First Message -->
       <div style="flex:1;">
         <div style="font-size:10px;color:var(--text-3);margin-bottom:6px;">TASK PROMPT</div>
         <div style="font-size:12px;color:var(--text);background:var(--bg-2);padding:10px;border-radius:4px;max-height:120px;overflow-y:auto;">
           ${escHtml(t.first_message || '-')}
         </div>
       </div>

    </div>
  `;
}

function statusBadge(status) {
  const map = { completed: ['green','✓'], interrupted: ['yellow','⏸'], error: ['red','✕'], unknown: ['grey','?'] };
  const [color, label] = map[status] || ['grey', status];
  return `<span class="badge ${color}">${label} ${status}</span>`;
}

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
