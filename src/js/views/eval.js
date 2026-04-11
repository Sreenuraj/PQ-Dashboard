import { api } from '../api.js';
import { fmtDateTime, fmtDuration, fmtCost } from '../utils.js';

export async function renderEval(container, taskId) {
  if (!taskId) {
    container.innerHTML = `
      <div class="view-header">
        <h1 class="view-title">Evaluate Task</h1>
      </div>
      <div class="empty-state">
        <div class="icon">⟶</div>
        <p>No session selected. Go to <a href="#/sessions" style="color:var(--accent)">Sessions</a> and click a row.</p>
      </div>`;
    return;
  }

  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Calculating agentic metrics...</p></div>`;

  try {
    const [task, events, evaluations] = await Promise.all([
      api.task(taskId),
      api.taskEvents(taskId),
      api.evaluate(taskId)
    ]);

    // Try to find the prompt and final response
    let finalResponse = events.reverse().find(e => e.sub_type === 'completion_result' || e.sub_type === 'text' && e.content_preview)?.content_preview || 'No response captured.';
    events.reverse(); // put back in chronological order just in case
    let promptText = task.first_message || events.find(e => e.request_text)?.request_text || 'No prompt captured.';

    const { metrics, evidence } = evaluations;
    
    // Save these deterministic metrics to local storage so compare.js can grab them easily if wanted, 
    // though the compare view will fetch them from the API too.
    localStorage.setItem(`pq_auto_eval_${taskId}`, JSON.stringify(metrics));

    container.innerHTML = `
      <div class="view-header">
        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
          <a href="#/sessions" style="color:var(--text-3);text-decoration:none;font-size:13px">← Sessions</a>
          <h1 class="view-title" style="margin:0">Evaluate Task</h1>
          <span class="badge grey">${taskId}</span>
        </div>
        <p class="view-subtitle mono" style="margin-top:6px">Automated Agentic Observability Metrics</p>
      </div>

      <!-- Details -->
      <div class="panel" style="margin-bottom:20px;padding:16px">
        <div style="display:flex;gap:24px;font-size:13px;">
           <div><span style="color:var(--text-3)">Model:</span> <strong>${task.models?.map(m=>m.model_id).join(', ') || 'Unknown'}</strong></div>
           <div><span style="color:var(--text-3)">Cost:</span> <strong style="color:var(--green)">${fmtCost(task.total_cost)}</strong></div>
           <div><span style="color:var(--text-3)">Duration:</span> <strong>${fmtDuration(task.duration)}</strong></div>
           <div><span style="color:var(--text-3)">Date:</span> <strong>${fmtDateTime(task.start_ts)}</strong></div>
        </div>
      </div>

      <div style="display:flex;gap:20px;">
        <!-- Content Panel -->
        <div class="panel" style="flex:1;overflow:hidden;display:flex;flex-direction:column;gap:16px;">
          <div>
            <h3 style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--text)">User Prompt</h3>
            <pre style="background:var(--bg-2);padding:12px;border-radius:6px;border:1px solid var(--border);font-size:12px;max-height:200px;overflow-y:auto;white-space:pre-wrap;">${escHtml(promptText)}</pre>
          </div>
          <div>
            <h3 style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--text)">Model Response</h3>
            <pre style="background:var(--bg-2);padding:12px;border-radius:6px;border:1px solid var(--border);font-size:12px;max-height:400px;overflow-y:auto;white-space:pre-wrap;">${escHtml(finalResponse)}</pre>
          </div>
        </div>

        <!-- Eval Rubric Panel -->
        <div class="panel" style="width:380px;flex-shrink:0;">
          <h2 style="font-size:14px;font-weight:600;margin-bottom:16px;border-bottom:1px solid var(--border);padding-bottom:12px;display:flex;justify-content:space-between;align-items:center;">
            <span>Agentic Scorecard</span>
            <span style="color:var(--accent);font-size:18px;">${metrics.overall}%</span>
          </h2>
          
          <div style="display:flex;flex-direction:column;gap:16px;">
            ${renderAutoMetric('tue', 'Tool Utilization Efficacy', metrics.tue, evidence.tue)}
            ${renderAutoMetric('err', 'Error Recovery Rate', metrics.err, evidence.err)}
            ${renderAutoMetric('rd', 'Reasoning Density', metrics.rd, evidence.rd)}
            ${renderAutoMetric('ce', 'Context Efficiency', metrics.ce, evidence.ce)}
          </div>
        </div>
      </div>
    `;
  } catch (err) {
    container.innerHTML = `<div class="empty-state" style="color:var(--red)">Failed to load evaluation: ${err.message}</div>`;
  }
}

function renderAutoMetric(id, label, score, evidence) {
  const color = score >= 80 ? 'var(--green)' : score >= 50 ? 'var(--yellow)' : 'var(--red)';
  return `
    <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:6px;padding:12px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-size:13px;font-weight:600;">${label}</div>
        <div style="font-size:14px;font-weight:700;color:${color}">${score}%</div>
      </div>
      <!-- Gauge bar -->
      <div style="width:100%;height:6px;background:var(--bg-3);border-radius:3px;overflow:hidden;margin-bottom:8px;">
         <div style="height:100%;background:${color};width:${score}%;transition:width 1s ease-in-out;"></div>
      </div>
      <!-- Evidence block -->
      <details>
        <summary style="font-size:10px;color:var(--text-3);cursor:pointer;user-select:none;">Trace Evidence (Why?)</summary>
        <div style="margin-top:6px;font-size:11px;color:var(--text-2);padding:6px 8px;background:var(--bg-3);border-radius:4px;">
           ${escHtml(evidence)}
        </div>
      </details>
    </div>
  `;
}

function escHtml(s) {
  if (!s) return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
