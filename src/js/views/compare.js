import { api } from '../api.js';
import { fmtDateTime, fmtDuration, fmtCost, agentChainChips } from '../utils.js';

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
        const [t, ev, events] = await Promise.all([
          api.task(id),
          api.evaluate(id).catch(() => null),
          api.taskEvents(id).catch(() => [])
        ]);
        return { task: t, eval: ev, events: events };
    }));
    
    // Calculate max values for bar charts
    const maxCost = Math.max(...dataObjects.map(d => d.task.total_cost || 0), 0.0001);
    const maxDuration = Math.max(...dataObjects.map(d => d.task.duration || 0), 1);
    
    container.innerHTML = `
      <style>
        .interactive-metric {
          cursor: pointer;
          transition: background 0.15s;
          padding: 4px;
          border-radius: 4px;
        }
        .interactive-metric:hover {
          background: var(--bg-4) !important;
        }
        .view-completion-btn {
          color: var(--accent);
          background: none;
          border: none;
          padding: 4px 0 0;
          font-size: 11px;
          cursor: pointer;
          font-weight: 600;
          text-align: left;
        }
        .view-completion-btn:hover {
          text-decoration: underline;
        }
        @media print {
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          body, #app, #main, .view-container {
            background: var(--bg) !important;
            color: var(--text) !important;
          }
          #sidebar, .navbar, .view-header, .tip-banner, #print-compare-btn, .modal-backdrop, .modal-close-btn, .view-completion-btn, #date-range-wrapper {
            display: none !important;
          }
          .view-container, #app-root {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
          }
          .compare-columns-container {
            display: flex !important;
            flex-direction: row !important;
            flex-wrap: wrap !important;
            gap: 20px !important;
          }
          .compare-column-card {
            border: 1px solid var(--border) !important;
            box-shadow: none !important;
            background: var(--bg-2) !important;
            color: var(--text) !important;
            break-inside: avoid !important;
            flex: 1 1 300px !important;
          }
          .print-header {
            display: block !important;
            margin-bottom: 20px !important;
          }
        }
        @media screen {
          .print-header {
            display: none !important;
          }
        }
      </style>

      <div class="print-header">
        <h1 style="margin:0; font-size:24px; color:var(--text)">Compare Sessions Report</h1>
        <p style="margin:4px 0 20px; font-size:12px; color:var(--text-3)">Generated on ${new Date().toLocaleString()}</p>
      </div>

      <div class="view-header" style="margin-bottom:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:16px">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <a href="#/sessions" style="color:var(--text-3);text-decoration:none;font-size:13px">← Sessions</a>
          <h1 class="view-title" style="margin:0">Compare Tasks</h1>
          <span class="badge grey">${dataObjects.length} selected</span>
        </div>
        <button class="action-btn primary" id="print-compare-btn" style="display:flex; align-items:center; gap:6px; font-size:12px; padding:6px 12px">
          <span style="font-size:13px">🖨️</span> Print Report
        </button>
      </div>

      <div class="tip-banner" style="font-size: 11px; color: var(--accent); margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
        <span>💡</span>
        <span><strong>Tip:</strong> Click on score metrics (e.g. Tool Efficacy) to view evaluation traces, or click on operational metrics (Cache, Tools, Errors) to open detailed diagnostic sequence logs.</span>
      </div>

      <div class="compare-columns-container" style="display:flex;gap:20px;overflow-x:auto;padding-bottom:20px;">
        ${dataObjects.map((d, colIdx) => renderTaskColumn(d.task, d.eval, maxCost, maxDuration, colIdx)).join('')}
      </div>
    `;

    // Bind listeners
    container.querySelectorAll('.interactive-metric').forEach(el => {
      el.addEventListener('click', () => {
        const title = el.getAttribute('data-title');
        const desc = el.getAttribute('data-desc');
        showMetricDetailModal(title, desc);
      });
    });

    container.querySelectorAll('.view-completion-btn').forEach(el => {
      el.addEventListener('click', () => {
        const model = el.getAttribute('data-model');
        const msg = el.getAttribute('data-msg');
        showFullCompletionModal(model, msg);
      });
    });

    container.querySelectorAll('.interactive-op').forEach(el => {
      el.addEventListener('click', () => {
        const type = el.getAttribute('data-type');
        const idx = parseInt(el.getAttribute('data-idx'));
        const dataObj = dataObjects[idx];
        if (!dataObj) return;

        if (type === 'tools') {
          showToolsModal(dataObj.task.id, dataObj.events);
        } else if (type === 'cache') {
          showCacheModal(dataObj.task.id, dataObj.task, dataObj.events);
        } else if (type === 'errors') {
          showErrorsModal(dataObj.task.id, dataObj.events);
        }
      });
      // Add hover effect
      el.addEventListener('mouseenter', () => {
        el.style.background = 'var(--bg-4)';
      });
      el.addEventListener('mouseleave', () => {
        el.style.background = 'none';
      });
    });

    container.querySelector('#print-compare-btn')?.addEventListener('click', () => {
      window.print();
    });

  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:var(--red)">Failed to load tasks: ${err.message}</div>`;
  }
}

function renderTaskColumn(t, ev, maxCost, maxDuration, colIdx) {
  const costPct = Math.min(100, ((t.total_cost || 0) / maxCost) * 100);
  const durPct = Math.min(100, ((t.duration || 0) / maxDuration) * 100);
  
  let evalHtml = '<div style="font-size:11px;color:var(--text-3);padding:8px 0;text-align:center;">Evaluation unavailable</div>';
  let starsHtml = '<span style="color:var(--text-3); font-size:11px">Not rated</span>';
  let completionMessageHtml = '';
  
  if (ev && ev.metrics) {
    const { tue, ce, rd, err, overall } = ev.metrics;
    const userRating = ev.user_rating;
    
    if (userRating != null) {
      starsHtml = `
        <span style="color:#f59e0b; font-size:14px" title="Rated ${userRating}/5 stars">
          ${'★'.repeat(userRating)}${'☆'.repeat(5 - userRating)}
        </span>
      `;
    }

    evalHtml = `
      <div style="background:var(--bg-3); padding:14px; border-radius:8px; border:1px solid var(--border); display:flex; flex-direction:column; gap:12px">
        <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--border); padding-bottom:8px">
          <div>
            <div style="font-size:9px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.5px">Performance Index</div>
            <div style="font-size:24px; font-weight:700; color:var(--accent)">${overall}%</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:9px; color:var(--text-3); text-transform:uppercase; letter-spacing:0.5px">Manual Rating</div>
            <div style="margin-top:2px">${starsHtml}</div>
          </div>
        </div>

        <div style="display:flex; flex-direction:column; gap:8px;">
          <!-- Metric TUE -->
          <div class="interactive-metric" data-title="Tool Efficacy (TUE)" data-desc="${escAttr(ev.evidence.tue)}" style="display:flex; flex-direction:column; gap:4px">
            <div style="display:flex; justify-content:space-between; font-size:11px">
              <span style="color:var(--text-2)">Tool Efficacy</span>
              <strong style="color:var(--text)">${tue}%</strong>
            </div>
            <div class="progress-bar" style="height:6px; background:var(--bg-4); border-radius:3px; overflow:hidden">
              <div class="progress-fill ${scoreClass(tue)}" style="height:100%; width:${tue}%"></div>
            </div>
          </div>

          <!-- Metric ERR -->
          <div class="interactive-metric" data-title="Error Recovery (ERR)" data-desc="${escAttr(ev.evidence.err)}" style="display:flex; flex-direction:column; gap:4px">
            <div style="display:flex; justify-content:space-between; font-size:11px">
              <span style="color:var(--text-2)">Error Recovery</span>
              <strong style="color:var(--text)">${err}%</strong>
            </div>
            <div class="progress-bar" style="height:6px; background:var(--bg-4); border-radius:3px; overflow:hidden">
              <div class="progress-fill ${scoreClass(err)}" style="height:100%; width:${err}%"></div>
            </div>
          </div>

          <!-- Metric RD -->
          <div class="interactive-metric" data-title="Reasoning Density (RD)" data-desc="${escAttr(ev.evidence.rd)}" style="display:flex; flex-direction:column; gap:4px">
            <div style="display:flex; justify-content:space-between; font-size:11px">
              <span style="color:var(--text-2)">Reasoning Density</span>
              <strong style="color:var(--text)">${rd}%</strong>
            </div>
            <div class="progress-bar" style="height:6px; background:var(--bg-4); border-radius:3px; overflow:hidden">
              <div class="progress-fill ${scoreClass(rd)}" style="height:100%; width:${rd}%"></div>
            </div>
          </div>

          <!-- Metric CE -->
          <div class="interactive-metric" data-title="Context Efficiency (CE)" data-desc="${escAttr(ev.evidence.ce)}" style="display:flex; flex-direction:column; gap:4px">
            <div style="display:flex; justify-content:space-between; font-size:11px">
              <span style="color:var(--text-2)">Context Efficiency</span>
              <strong style="color:var(--text)">${ce}%</strong>
            </div>
            <div class="progress-bar" style="height:6px; background:var(--bg-4); border-radius:3px; overflow:hidden">
              <div class="progress-fill ${scoreClass(ce)}" style="height:100%; width:${ce}%"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    if (ev.completion_message) {
      completionMessageHtml = `
        <div>
          <div style="font-size:10px; color:var(--text-3); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px">COMPLETION SUMMARY</div>
          <div style="font-size:12px; background:var(--bg-2); padding:10px; border-radius:4px; border:1px solid var(--border); max-height:110px; overflow:hidden; display:flex; flex-direction:column; gap:6px">
            <div style="display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden; line-height:1.4">
              ${formatMarkdown(ev.completion_message)}
            </div>
            <button class="view-completion-btn" data-model="${escAttr(t.models?.[0]?.model_id || 'Model')}" data-msg="${escAttr(ev.completion_message)}">
              Read full completion message →
            </button>
          </div>
        </div>
      `;
    }
  }

  return `
    <div class="panel compare-column-card" style="flex:1; min-width:320px; max-width:420px; display:flex; flex-direction:column; gap:16px">
       <div class="panel-title" style="display:flex; justify-content:space-between; align-items:center; padding-bottom:8px; border-bottom:1px solid var(--border)">
         <span class="mono" style="font-size:11px; color:var(--text-2); font-weight:bold">${t.id}</span>
         ${statusBadge(t.status)}
       </div>
       <div class="panel-body" style="display:flex; flex-direction:column; gap:16px; flex:1">
         
         <!-- Model Info -->
         <div style="background:var(--bg-2); padding:12px; border-radius:6px; border:1px solid var(--border)">
           <div style="font-size:10px; color:var(--text-3); margin-bottom:4px; text-transform:uppercase; letter-spacing:0.5px">PRIMARY MODEL</div>
           <div style="font-size:13px; font-weight:600" class="mono">${t.models?.[0]?.model_id || 'Unknown'}</div>
           <div style="font-size:10px; color:var(--text-3); margin-top:6px">${fmtDateTime(t.start_ts)}</div>
         </div>

         <!-- Phase 4: Agent chain (so reviewers see which agent(s) drove this session) -->
         <div style="background:var(--bg-2); padding:12px; border-radius:6px; border:1px solid var(--border)">
           <div style="font-size:10px; color:var(--text-3); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px">AGENT CHAIN</div>
           <div style="display:flex;align-items:center;flex-wrap:wrap;gap:4px">
             ${(t.agent_sequence && t.agent_sequence.length)
               ? agentChainChips(t.agent_sequence, { max: 6, clickable: false })
               : '<span style="font-size:11px;color:var(--text-3)">—</span>'}
           </div>
         </div>

         ${evalHtml}

         <!-- Stat Bars & Operational Metrics -->
         <div style="background:var(--bg-2); padding:12px; border-radius:6px; border:1px solid var(--border); display:flex; flex-direction:column; gap:10px">
           <div>
             <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px; color:var(--text-2)">
               <span>Cost</span>
               <span style="font-weight:600; color:var(--green)">${fmtCost(t.total_cost)}</span>
             </div>
             <div style="width:100%; height:6px; background:var(--bg-3); border-radius:3px; overflow:hidden">
               <div style="height:100%; background:var(--green); width:${costPct}%"></div>
             </div>
           </div>

           <div>
             <div style="display:flex; justify-content:space-between; font-size:11px; margin-bottom:4px; color:var(--text-2)">
               <span>Duration</span>
               <span style="font-weight:600; color:var(--text)">${fmtDuration(t.duration)}</span>
             </div>
             <div style="width:100%; height:6px; background:var(--bg-3); border-radius:3px; overflow:hidden">
               <div style="height:100%; background:var(--accent); width:${durPct}%"></div>
             </div>
           </div>
           
           <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-2); padding:4px 0">
             <span>Tokens</span>
             <span style="font-weight:600" class="mono">${fmtNum(t.total_tokens_in || 0)} In / ${fmtNum(t.total_tokens_out || 0)} Out</span>
           </div>

           <!-- Interactive Cache Details -->
           <div class="interactive-op" data-type="cache" data-idx="${colIdx}" style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-2); cursor:pointer; padding:6px 4px; border-radius:4px; transition: background 0.15s">
             <span>Cache Accesses</span>
             <span style="font-weight:600; display:flex; align-items:center; gap:4px" class="mono">
               ${fmtNum(t.total_cache_reads || 0)} R / ${fmtNum(t.total_cache_writes || 0)} W 
               <span style="font-size:10px; color:var(--text-3)">🔍</span>
             </span>
           </div>

           <!-- Interactive Tool Details -->
           <div class="interactive-op" data-type="tools" data-idx="${colIdx}" style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-2); cursor:pointer; padding:6px 4px; border-radius:4px; transition: background 0.15s">
             <span>Tools Invoked</span>
             <span style="font-weight:600; display:flex; align-items:center; gap:4px" class="mono">
               ${t.tool_call_count || 0} calls 
               <span style="font-size:10px; color:var(--text-3)">🔍</span>
             </span>
           </div>

           <!-- Interactive Errors Encountered -->
           <div class="interactive-op" data-type="errors" data-idx="${colIdx}" style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-2); cursor:pointer; padding:6px 4px; border-radius:4px; transition: background 0.15s">
             <span>Errors Encountered</span>
             <span style="font-weight:600; display:flex; align-items:center; gap:4px; color:${t.error_count > 0 ? 'var(--red)' : 'var(--text-2)'}" class="mono">
               ${t.error_count || 0} 
               <span style="font-size:10px; color:var(--text-3)">🔍</span>
             </span>
           </div>
         </div>

         <!-- Prompt -->
         <div>
           <div style="font-size:10px; color:var(--text-3); margin-bottom:6px; text-transform:uppercase; letter-spacing:0.5px">TASK PROMPT</div>
           <div style="font-size:11px; color:var(--text-2); background:var(--bg-2); padding:10px; border-radius:4px; max-height:80px; overflow-y:auto; font-family:var(--font-sans)">
             ${escHtml(t.first_message || '-')}
           </div>
         </div>

         ${completionMessageHtml}
       </div>
    </div>
  `;
}

function statusBadge(status) {
  const map = { completed: ['green','✓'], interrupted: ['yellow','⏸'], error: ['red','✕'], unknown: ['grey','?'] };
  const [color, label] = map[status] || ['grey', status];
  return `<span class="badge ${color}">${label} ${status}</span>`;
}

function fmtNum(n) {
  return Number(n || 0).toLocaleString();
}

function scoreClass(score) {
  return score >= 80 ? 'green' : score >= 40 ? 'yellow' : 'red';
}

function escHtml(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
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

function showMetricDetailModal(title, description) {
  let modal = document.getElementById('simple-metric-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'simple-metric-modal';
    modal.className = 'modal-backdrop';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-panel" style="width:min(600px, 95%)">
      <div class="modal-head">
        <div>
          <h2 style="margin:0">${escHtml(title)}</h2>
          <p style="margin:4px 0 0;font-size:11px;color:var(--text-3)">Detailed evaluation trace and evidence</p>
        </div>
        <button class="modal-close-btn" style="background:none; border:none; color:var(--text-3); font-size:24px; cursor:pointer; padding:4px 8px; line-height:1; transition:color 0.2s" onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--text-3)'">&times;</button>
      </div>
      <div class="modal-body" style="max-height:60vh;overflow-y:auto;line-height:1.6;font-size:13px;white-space:normal;color:var(--text)">
        ${escHtml(description)}
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

function showFullCompletionModal(modelName, message) {
  let modal = document.getElementById('simple-completion-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'simple-completion-modal';
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
        <button class="modal-close-btn" style="background:none; border:none; color:var(--text-3); font-size:24px; cursor:pointer; padding:4px 8px; line-height:1; transition:color 0.2s" onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--text-3)'">&times;</button>
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

function showDetailedPopup(title, contentHtml) {
  let modal = document.getElementById('simple-compare-detail-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'simple-compare-detail-modal';
    modal.className = 'modal-backdrop';
    document.body.appendChild(modal);
  }
  modal.innerHTML = `
    <div class="modal-panel" style="width:min(680px, 95%)">
      <div class="modal-head">
        <div>
          <h2 style="margin:0">${escHtml(title)}</h2>
        </div>
        <button class="modal-close-btn" style="background:none; border:none; color:var(--text-3); font-size:24px; cursor:pointer; padding:4px 8px; line-height:1; transition:color 0.2s" onmouseover="this.style.color='var(--text)'" onmouseout="this.style.color='var(--text-3)'">&times;</button>
      </div>
      <div class="modal-body" style="max-height:60vh;overflow-y:auto;line-height:1.6;font-size:13px;white-space:normal;color:var(--text)">
        ${contentHtml}
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

function showToolsModal(taskId, events) {
  const toolSequence = events.filter(e => e.tool_name && e.tool_name !== 'unknown');
  
  let html = '';
  if (toolSequence.length === 0) {
    html = `<div style="color:var(--text-3); text-align:center; padding:20px;">No tools were invoked in this session.</div>`;
  } else {
    html = `
      <div class="table-wrap" style="max-height: 50vh; overflow-y: auto;">
        <table class="data-table" style="font-size:11px">
          <thead>
            <tr>
              <th style="width:50px">Step</th>
              <th style="width:150px">Tool Name</th>
              <th>Target / Arguments</th>
            </tr>
          </thead>
          <tbody>
            ${toolSequence.map((e, idx) => {
              const target = e.content_preview && e.content_preview.includes('→') ? e.content_preview.split('→').slice(1).join('→').trim() : null;
              return `
                <tr>
                  <td class="mono" style="font-weight:bold">#${idx + 1}</td>
                  <td class="mono" style="color:var(--accent)">${escHtml(e.tool_name)}</td>
                  <td class="mono" style="color:var(--text-2); word-break:break-all; white-space:pre-wrap">${escHtml(target || e.command_text || '-')}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  showDetailedPopup(`Tool Sequence — ${taskId}`, html);
}

function showErrorsModal(taskId, events) {
  const errors = events.filter(e => e.error_category || e.type === 'error' || e.error_message);

  let html = '';
  if (errors.length === 0) {
    html = `<div style="color:var(--text-3); text-align:center; padding:20px;">No errors were encountered in this session.</div>`;
  } else {
    html = `
      <div style="display:flex; flex-direction:column; gap:12px; max-height: 50vh; overflow-y: auto; padding-right: 4px;">
        ${errors.map((e, idx) => `
          <div style="background:var(--bg-3); border:1px solid var(--border); border-radius:6px; padding:10px; font-size:12px">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px">
              <span class="badge red" style="text-transform:uppercase">${escHtml(e.error_category || 'error')}</span>
              <span style="font-size:10px; color:var(--text-3); font-family:var(--font-mono)">${new Date(e.ts).toLocaleTimeString()}</span>
            </div>
            <div class="mono" style="color:var(--red); word-break:break-all; white-space:pre-wrap; background:var(--bg-4); padding:8px; border-radius:4px; border:1px solid var(--border-2)">
              ${escHtml(e.error_message || 'Unknown execution error')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  showDetailedPopup(`Errors Encountered — ${taskId}`, html);
}

function showCacheModal(taskId, task, events) {
  const apiCalls = events.filter(e => e.sub_type === 'api_req_started');
  
  let html = `
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:16px">
      <div style="background:var(--bg-3); padding:10px; border-radius:6px; text-align:center; border:1px solid var(--border)">
        <span style="display:block; color:var(--text-3); font-size:10px; text-transform:uppercase">Total Cache Reads</span>
        <strong style="font-size:18px; color:var(--text)">${fmtNum(task.total_cache_reads || 0)}</strong>
      </div>
      <div style="background:var(--bg-3); padding:10px; border-radius:6px; text-align:center; border:1px solid var(--border)">
        <span style="display:block; color:var(--text-3); font-size:10px; text-transform:uppercase">Total Cache Writes</span>
        <strong style="font-size:18px; color:var(--text)">${fmtNum(task.total_cache_writes || 0)}</strong>
      </div>
    </div>
  `;

  if (apiCalls.length === 0) {
    html += `<div style="color:var(--text-3); text-align:center; padding:10px;">No API cache metrics reported.</div>`;
  } else {
    html += `
      <h3 style="font-size:11px; text-transform:uppercase; color:var(--text-3); margin-bottom:8px; letter-spacing:0.5px">API Call Cache Breakdown</h3>
      <div class="table-wrap" style="max-height: 40vh; overflow-y: auto;">
        <table class="data-table" style="font-size:11px">
          <thead>
            <tr>
              <th style="width:40px">Call</th>
              <th>Model</th>
              <th style="width:80px; text-align:right">Reads</th>
              <th style="width:80px; text-align:right">Writes</th>
              <th style="width:80px; text-align:right">Cost</th>
            </tr>
          </thead>
          <tbody>
            ${apiCalls.map((e, idx) => `
              <tr>
                <td class="mono" style="font-weight:bold">#${idx + 1}</td>
                <td class="mono" style="color:var(--text-2)">${escHtml(e.model_id ? e.model_id.split('/').pop() : 'Unknown')}</td>
                <td class="mono" style="text-align:right; color:var(--green)">${fmtNum(e.cache_reads || 0)}</td>
                <td class="mono" style="text-align:right; color:var(--accent)">${fmtNum(e.cache_writes || 0)}</td>
                <td class="mono" style="text-align:right">${fmtCost(e.cost || 0)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  showDetailedPopup(`Cache Access Details — ${taskId}`, html);
}
