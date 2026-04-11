import { api } from '../api.js';
import { fmtDateTime, fmtDuration, fmtCost, fmtMs } from '../utils.js';

let allEvents = [];

export async function renderInvestigate(container, taskId) {
  if (!taskId) {
    container.innerHTML = `<div class="empty-state">No task selected.</div>`;
    return;
  }

  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Gathering observability data...</p></div>`;

  const [task, events] = await Promise.all([
    api.task(taskId),
    api.taskEvents(taskId)
  ]);

  allEvents = events;

  const models = [...new Set((task.models || []).map(m => m.model_id).filter(Boolean))];
  const uniqueTools = [...new Set(events.filter(e => e.tool_name).map(e => e.tool_name))];
  
  container.innerHTML = `
    <div class="view-header" style="margin-bottom:16px;">
      <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <a href="#/sessions" style="color:var(--text-3);text-decoration:none;font-size:13px">← Sessions</a>
        <h1 class="view-title" style="margin:0">Investigate Task</h1>
        ${statusBadge(task.status)}
      </div>
      <p class="view-subtitle mono" style="margin-top:6px;font-size:11px;">${taskId}</p>
    </div>

    <!-- Metrics Bar -->
    <div class="panel" style="display:flex;gap:32px;padding:16px 20px;margin-bottom:16px;flex-wrap:wrap">
       <div><span style="display:block;font-size:11px;color:var(--text-3);margin-bottom:4px">TOTAL COST</span><span style="font-size:16px;font-weight:600;color:var(--green)">${fmtCost(task.total_cost)}</span></div>
       <div><span style="display:block;font-size:11px;color:var(--text-3);margin-bottom:4px">DURATION</span><span style="font-size:16px;font-weight:600">${fmtDuration(task.duration)}</span></div>
       <div><span style="display:block;font-size:11px;color:var(--text-3);margin-bottom:4px">MODELS USED</span><span style="font-size:13px;font-weight:500" class="mono">${models.length ? models.join(', ') : 'None'}</span></div>
       <div><span style="display:block;font-size:11px;color:var(--text-3);margin-bottom:4px">ERRORS</span><span style="font-size:16px;font-weight:600;color:${task.error_count > 0 ? 'var(--red)' : 'var(--text)'}">${task.error_count || 0}</span></div>
       <div><span style="display:block;font-size:11px;color:var(--text-3);margin-bottom:4px">API CALLS</span><span style="font-size:16px;font-weight:600">${task.api_call_count || 0}</span></div>
       <div><span style="display:block;font-size:11px;color:var(--text-3);margin-bottom:4px">TOOLS USED</span><span style="font-size:13px;font-weight:500" class="mono">${uniqueTools.length ? uniqueTools.join(', ') : '0'}</span></div>
    </div>

    <!-- Search / Highlight Toolbar -->
    <div style="display:flex;gap:12px;margin-bottom:16px;align-items:center;">
       <input type="text" id="inv-search" placeholder="Search prompts, responses, tool payloads, or errors..." style="flex:1;background:var(--bg-2);border:1px solid var(--border);color:var(--text);padding:10px 14px;border-radius:6px;font-size:13px;" />
       <div id="search-matches" style="font-size:12px;color:var(--text-3);min-width:100px;"></div>
    </div>

    <div style="display:flex;gap:20px;">
       <!-- Side Navigation of Events -->
       <div class="panel" style="width:300px;flex-shrink:0;padding:0;overflow:hidden;display:flex;flex-direction:column;height:calc(100vh - 280px);">
          <div style="padding:12px 16px;background:var(--bg-2);border-bottom:1px solid var(--border);font-size:12px;font-weight:600;display:flex;justify-content:space-between;align-items:center;">
             <span>Event Stream</span>
             <span class="badge grey">${events.length}</span>
          </div>
          <div id="inv-event-list" style="overflow-y:auto;flex:1;">
             ${events.map((e, i) => renderListItem(e, i)).join('')}
          </div>
       </div>

       <!-- Main Details View -->
       <div class="panel" id="inv-detail-view" style="flex:1;height:calc(100vh - 280px);overflow-y:auto;display:flex;flex-direction:column;justify-content:center;align-items:center;color:var(--text-3);">
           <div style="font-size:24px;margin-bottom:12px;">👆</div>
           <p>Select an event from the stream to investigate its details.</p>
       </div>
    </div>
  `;

  // Wire search
  const searchInput = document.getElementById('inv-search');
  let debounce;
  searchInput.addEventListener('input', (e) => {
     clearTimeout(debounce);
     debounce = setTimeout(() => handleSearch(e.target.value.toLowerCase()), 300);
  });

  // Wire clicks
  document.querySelectorAll('.inv-list-item').forEach(item => {
      item.addEventListener('click', () => {
          document.querySelectorAll('.inv-list-item').forEach(el => el.style.borderLeftColor = 'transparent');
          item.style.borderLeftColor = 'var(--accent)';
          
          const idx = parseInt(item.dataset.idx);
          renderEventDetail(events[idx]);
      });
  });
}

function handleSearch(query) {
    const items = document.querySelectorAll('.inv-list-item');
    let matchCount = 0;
    
    if (!query) {
       items.forEach(el => { el.style.display = 'block'; el.style.opacity = '1'; });
       document.getElementById('search-matches').textContent = '';
       return;
    }

    items.forEach(el => {
        const idx = parseInt(el.dataset.idx);
        const e = allEvents[idx];
        const searchText = (
           (e.sub_type||'') + ' ' + 
           (e.content_preview||'') + ' ' + 
           (e.request_text||'') + ' ' + 
           (e.response_text||'') + ' ' + 
           (e.error_message||'') + ' ' + 
           (e.tool_name||'') + ' ' +
           (e.command_text||'')
        ).toLowerCase();

        if (searchText.includes(query)) {
           el.style.display = 'block';
           el.style.opacity = '1';
           matchCount++;
        } else {
           el.style.display = 'none';
        }
    });

    document.getElementById('search-matches').textContent = `${matchCount} matches`;
}

function renderListItem(e, i) {
    const bg = e.error_category ? 'var(--red-dim)' : 'transparent';
    const border = e.error_category ? 'var(--red)' : 'transparent';
    
    return `
      <div class="inv-list-item" data-idx="${i}" style="padding:12px 14px;border-bottom:1px solid var(--border);border-left:3px solid ${border};cursor:pointer;background:${bg};transition:background 0.2s;">
         <div style="display:flex;justify-content:space-between;margin-bottom:4px;">
            <span class="badge ${eventBadgeColor(e)}" style="padding:1px 6px;font-size:10px">${e.sub_type || 'unknown'}</span>
            <span style="font-size:10px;color:var(--text-3)">${fmtDateTime(e.ts).split(' ')[1]}</span>
         </div>
         <div style="font-size:11px;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">
            ${getTitle(e)}
         </div>
         ${e.error_message ? `<div style="font-size:10px;color:var(--red);margin-top:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">⚠ ${escHtml(e.error_message)}</div>` : ''}
      </div>
    `;
}

function getTitle(e) {
    if (e.tool_name) return '🔧 ' + e.tool_name;
    if (e.command_text) return '$ ' + e.command_text;
    if (e.sub_type === 'api_req_started') return e.model_id ? 'API: ' + e.model_id : 'API Request';
    if (e.sub_type === 'reasoning') return '🧠 Reasoning block';
    if (e.error_category) return 'Exception: ' + e.error_category.replace(/_/g,' ');
    if (e.content_preview) return escHtml(e.content_preview.substring(0,60));
    return 'Event';
}

function renderEventDetail(e) {
   const panel = document.getElementById('inv-detail-view');
   
   let html = `
     <div style="width:100%;max-width:800px;margin:0 auto;padding:24px;color:var(--text)">
       <div style="margin-bottom:20px">
          <span class="badge ${eventBadgeColor(e)}">${e.type}.${e.sub_type}</span>
          <span style="font-size:12px;color:var(--text-3);margin-left:12px">${fmtDateTime(e.ts)}</span>
       </div>
   `;

   if (e.model_id || e.cost != null) {
      html += `
       <div style="display:flex;gap:24px;background:var(--bg-2);padding:12px;border-radius:6px;border:1px solid var(--border);margin-bottom:20px;font-size:12px;">
         ${e.model_id ? `<div><div style="color:var(--text-3);margin-bottom:2px;font-size:10px;">MODEL</div><span class="mono">${e.provider_id ? e.provider_id+'/' : ''}${e.model_id}</span></div>` : ''}
         ${e.cost != null ? `<div><div style="color:var(--text-3);margin-bottom:2px;font-size:10px;">COST</div><span style="color:var(--green)">${fmtCost(e.cost)}</span></div>` : ''}
         ${e.tokens_in != null ? `<div><div style="color:var(--text-3);margin-bottom:2px;font-size:10px;">TOKENS</div><span>↑${e.tokens_in} &nbsp; ↓${e.tokens_out || 0}</span></div>` : ''}
         ${e.context_pct != null ? `<div><div style="color:var(--text-3);margin-bottom:2px;font-size:10px;">CONTEXT USED</div><span>${e.context_pct}%</span></div>` : ''}
       </div>
      `;
   }

   if (e.error_message) {
      html += `
        <div style="background:var(--red-dim);border:1px solid var(--red);padding:16px;border-radius:6px;margin-bottom:20px;">
          <h3 style="color:var(--red);margin:0 0 8px 0;font-size:14px;">⚠ ${e.error_category}</h3>
          <pre style="font-size:12px;white-space:pre-wrap;color:var(--red);margin:0;">${escHtml(e.error_message)}</pre>
        </div>
      `;
   }

   if (e.tool_name) {
      html += `<div style="font-size:14px;font-weight:600;margin-bottom:8px;">Tool Invocation: <span class="mono" style="color:var(--accent)">${e.tool_name}</span></div>`;
   }
   if (e.command_text) {
      html += `<div style="font-size:14px;font-weight:600;margin-bottom:8px;">Command Execution</div><pre style="background:#000;color:#0f0;padding:12px;border-radius:6px;font-size:12px;margin-bottom:20px;">$ ${escHtml(e.command_text)}</pre>`;
   }

   if (e.request_text) {
      html += `
        <div style="margin-bottom:20px;">
           <h3 style="font-size:13px;color:var(--text-2);margin-bottom:6px;">Request Payload (Prompt)</h3>
           <pre style="background:var(--bg-2);padding:16px;border-radius:6px;border:1px solid var(--border);font-size:12px;white-space:pre-wrap;max-height:400px;overflow-y:auto;">${escHtml(e.request_text)}</pre>
        </div>
      `;
   }

   if (e.response_text) {
      html += `
        <div style="margin-bottom:20px;">
           <h3 style="font-size:13px;color:var(--text-2);margin-bottom:6px;">Raw Response Payload</h3>
           <pre style="background:var(--bg-3);padding:16px;border-radius:6px;border:1px solid var(--border);font-size:12px;white-space:pre-wrap;max-height:400px;overflow-y:auto;">${escHtml(e.response_text)}</pre>
        </div>
      `;
   }

   if (e.reasoning_text) {
      html += `
        <div style="margin-bottom:20px;">
           <h3 style="font-size:13px;color:var(--purple);margin-bottom:6px;">🧠 Internal Reasoning</h3>
           <pre style="background:rgba(168,85,247,0.05);padding:16px;border-radius:6px;border:1px solid rgba(168,85,247,0.2);color:var(--text);font-size:12px;white-space:pre-wrap;max-height:400px;overflow-y:auto;">${escHtml(e.reasoning_text)}</pre>
        </div>
      `;
   }
   
   if (!e.request_text && !e.response_text && !e.reasoning_text && e.content_preview) {
       html += `
        <div style="margin-bottom:20px;">
           <h3 style="font-size:13px;color:var(--text-2);margin-bottom:6px;">Captured Content</h3>
           <pre style="background:var(--bg-2);padding:16px;border-radius:6px;border:1px solid var(--border);font-size:12px;white-space:pre-wrap;max-height:400px;overflow-y:auto;">${escHtml(e.content_preview)}</pre>
        </div>
      `;
   }

   html += `</div>`;
   panel.innerHTML = html;
   panel.style.justifyContent = 'flex-start';
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
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
