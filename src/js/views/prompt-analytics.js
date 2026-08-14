import { api } from '../api.js';

// ── Helpers ──
function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function fmtBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function fmtTokens(n) {
  if (!n || n === 0) return '0';
  if (n < 1000) return String(n);
  if (n < 1000000) return (n / 1000).toFixed(1) + 'K';
  return (n / 1000000).toFixed(2) + 'M';
}

function fmtCost(cost) {
  if (!cost) return '$0.00';
  if (cost < 0.01) return '$' + cost.toFixed(4);
  return '$' + cost.toFixed(3);
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function fmtDuration(ms) {
  if (!ms || ms <= 0) return '0s';
  const sec = Math.floor(ms / 1000);
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min === 0) return `${remSec}s`;
  return `${min}m ${remSec}s`;
}

function fmtDelta(bytes) {
  if (bytes === 0) return '<span class="pa-delta-zero" title="No size change from previous call">±0</span>';
  if (bytes > 0) return `<span class="pa-delta-up" title="Request size expanded by ${fmtBytes(bytes)}">▲ +${fmtBytes(bytes)}</span>`;
  return `<span class="pa-delta-down" title="Request size reduced by ${fmtBytes(Math.abs(bytes))}">▼ ${fmtBytes(Math.abs(bytes))}</span>`;
}

// ── State ──
let currentTaskId = null;
let analyticsData = null;
let allTasksList = [];

let activeMode = 'single'; // 'single' | 'compare'
let compareSelectedTaskIds = [];
let compareDataMap = {}; // taskId -> analyticsData
let compareStepIndex = 0;
let useSharedCompareScale = true;
const COMPARE_TASK_COLORS = ['#ec4899', '#06b6d4', '#f59e0b', '#a78bfa', '#10b981', '#ef4444', '#38bdf8'];

let hoveredCallIndex = null;
let chartCanvas = null;

let activeCategoryFilter = 'ALL';
let reductionSearchQuery = '';
let reductionViewMode = 'explorer'; // 'explorer' | 'timeline' | 'matrix' | 'grouped'
let reductionFeedLimit = 30;
let activeCallFocusIndex = null; // null = all calls, number = focused on specific API call index
let selectedExplorerEventIndex = 0;

let chartSeries = {
  requestSize: true,
  cacheReads: true,
  cacheWrites: true,
  contextWindow: true,
  cumulativeCost: true,
  cacheHitPct: true,
  stepLatency: false,
};

let requestSizeMode = 'accumulated'; // 'accumulated' | 'delta'
window.requestSizeMode = requestSizeMode;

let fullscreenZoomRange = [0, 100];

function renderLegendFilterMarkup(extraControlsHtml = '') {
  const reqMode = window.requestSizeMode || requestSizeMode || 'accumulated';
  return `
    <div class="pa-chart-legend" style="display:flex;gap:4px;align-items:center;flex-wrap:wrap">
      <button class="pa-legend-chip ${chartSeries.requestSize ? 'active' : ''}" data-series="requestSize" title="Toggle Request Size Bar Chart">
        <span class="pa-legend-color" style="background:#38bdf8"></span> Request Size (Bars)
      </button>
      <button class="pa-toggle-size-mode action-btn secondary" style="padding:2px 8px;font-size:10.5px;margin-right:2px;border:1px solid rgba(56,189,248,0.4);color:#38bdf8;font-weight:bold;cursor:pointer" title="Toggle between Total Accumulated Context Payload vs Per-Turn New Input Delta">
        ${reqMode === 'accumulated' ? '📦 Accumulated Context' : '⚡ Per-Turn New Input'}
      </button>
      <button class="pa-legend-chip ${chartSeries.cacheReads ? 'active' : ''}" data-series="cacheReads" title="Toggle Prompt Cache Read Tokens">
        <span class="pa-legend-color" style="background:#10b981"></span> Cache Reads
      </button>
      <button class="pa-legend-chip ${chartSeries.cacheWrites ? 'active' : ''}" data-series="cacheWrites" title="Toggle Prompt Cache Creation Tokens">
        <span class="pa-legend-color" style="background:#f59e0b"></span> Cache Writes
      </button>
      <button class="pa-legend-chip ${chartSeries.contextWindow ? 'active' : ''}" data-series="contextWindow" title="Toggle Context Window Utilization %">
        <span class="pa-legend-color" style="background:#a78bfa"></span> Context %
      </button>
      <button class="pa-legend-chip ${chartSeries.cumulativeCost ? 'active' : ''}" data-series="cumulativeCost" title="Toggle Cumulative Step Cost ($)">
        <span class="pa-legend-color" style="background:#ec4899"></span> Cumulative Cost ($)
      </button>
      <button class="pa-legend-chip ${chartSeries.cacheHitPct ? 'active' : ''}" data-series="cacheHitPct" title="Toggle Prompt Cache Hit %">
        <span class="pa-legend-color" style="background:#06b6d4"></span> Cache Hit %
      </button>
      <button class="pa-legend-chip ${chartSeries.stepLatency ? 'active' : ''}" data-series="stepLatency" title="Toggle Step Latency (s)">
        <span class="pa-legend-color" style="background:#6366f1"></span> Latency (s)
      </button>
      ${extraControlsHtml}
    </div>
  `;
}

function bindGlobalLegendEvents(container = document, refreshCallback = null) {
  container.querySelectorAll('.pa-legend-chip[data-series]').forEach(chip => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const seriesKey = chip.dataset.series;
      if (seriesKey) {
        chartSeries[seriesKey] = !chartSeries[seriesKey];
        document.querySelectorAll(`.pa-legend-chip[data-series="${seriesKey}"]`).forEach(c => {
          c.classList.toggle('active', chartSeries[seriesKey]);
        });
        if (refreshCallback) refreshCallback();
      }
    });
  });

  container.querySelectorAll('.pa-toggle-size-mode').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      requestSizeMode = (requestSizeMode === 'accumulated') ? 'delta' : 'accumulated';
      window.requestSizeMode = requestSizeMode;
      document.querySelectorAll('.pa-toggle-size-mode').forEach(b => {
        b.innerHTML = (requestSizeMode === 'accumulated') ? '📦 Accumulated Context' : '⚡ Per-Turn New Input';
      });
      if (refreshCallback) refreshCallback();
    });
  });
}

// ── Main Render ──
export async function renderPromptAnalytics(container, params) {
  const taskIdFromUrl = params?.get('task') || null;
  const modeFromUrl = params?.get('mode') || 'single';
  activeMode = modeFromUrl;

  try {
    const result = await api.tasks({ limit: 100, page: 1 });
    allTasksList = result.tasks || [];
    allTasksList.forEach(t => {
      t.label = getSavedTaskLabel(t.id, t.label);
    });
  } catch (e) {
    console.error('Failed to load tasks:', e);
  }

  container.innerHTML = `
    <!-- Top View Header with Mode Switcher -->
    <div class="view-header" style="display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:12px">
      <div>
        <h1 class="view-title">🔬 Prompt Observability & Context Reduction</h1>
        <p class="view-subtitle">Executive summary, cumulative cost/time curves, and chronological trace of context windows</p>
      </div>
      <div style="display:flex;gap:6px;background:var(--bg-3);padding:4px;border-radius:var(--radius-sm);border:1px solid var(--border)">
        <button id="pa-tab-single" class="action-btn ${activeMode === 'single' ? 'primary' : 'secondary'}" style="padding:4px 14px;font-size:11.5px">🔬 Single Task Analysis</button>
        <button id="pa-tab-compare" class="action-btn ${activeMode === 'compare' ? 'primary' : 'secondary'}" style="padding:4px 14px;font-size:11.5px">🔀 Compare Tasks</button>
      </div>
    </div>

    <!-- Task Selector Panel -->
    <div class="panel pa-selector-panel" style="margin-bottom:16px">
      <div class="panel-body" style="padding:12px 16px">
        <div id="pa-single-selector-container" style="display:${activeMode === 'single' ? 'block' : 'none'}">
          <div class="pa-selector-row" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <label class="pa-label" style="font-weight:bold;font-size:12px">Select Task</label>
            <select id="pa-task-select" class="filter-select pa-task-select" style="flex:1;min-width:280px">
              <option value="">— Choose a task to analyze —</option>
              ${allTasksList.map(t => {
                const displayName = t.label ? `🏷️ ${escHtml(t.label)}` : escHtml(t.first_message ? t.first_message.substring(0, 75) : 'Task ' + t.id);
                return `
                  <option value="${t.id}" ${t.id === taskIdFromUrl ? 'selected' : ''}>
                    ${displayName} (${t.api_call_count || 0} calls, ${fmtCost(t.total_cost)})
                  </option>
                `;
              }).join('')}
            </select>
            <button id="pa-load-btn" class="action-btn primary pa-load-btn">Analyze Task</button>
            <div id="pa-task-metrics-bar" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap"></div>
          </div>
        </div>

        <!-- Compare Task Selector -->
        <div id="pa-compare-selector-container" style="display:${activeMode === 'compare' ? 'block' : 'none'}">
          <div style="font-weight:bold;font-size:12px;margin-bottom:8px">Select 2 or more tasks to compare performance across prompt versions:</div>
          <div id="pa-compare-tasks-list" style="display:grid;grid-template-columns:repeat(auto-fill, minmax(280px, 1fr));gap:8px;max-height:180px;overflow-y:auto;background:var(--bg-3);padding:10px;border-radius:var(--radius-sm);border:1px solid var(--border)">
            ${allTasksList.map(t => {
              const displayName = t.label ? `🏷️ ${escHtml(t.label)}` : escHtml(t.first_message ? t.first_message.substring(0, 45) : t.id);
              return `
                <label style="display:flex;align-items:center;gap:8px;font-size:11px;cursor:pointer;background:var(--bg-2);padding:6px 10px;border-radius:4px;border:1px solid var(--border)">
                  <input type="checkbox" class="pa-compare-cb" value="${t.id}" ${compareSelectedTaskIds.includes(t.id) ? 'checked' : ''}>
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${t.label ? 'color:#38bdf8;font-weight:bold;' : ''}" title="${escHtml(t.first_message || t.id)}">
                    ${displayName}
                  </span>
                  <span class="mono" style="margin-left:auto;color:var(--text-3);font-size:10px;white-space:nowrap">${t.api_call_count || 0}c | ${fmtCost(t.total_cost)}</span>
                </label>
              `;
            }).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px">
            <span style="font-size:11px;color:var(--text-3)"><span id="pa-compare-count">${compareSelectedTaskIds.length}</span> tasks selected for side-by-side comparison</span>
            <button id="pa-run-compare-btn" class="action-btn primary" style="padding:6px 16px;font-size:12px">🔀 Run Side-by-Side Task Comparison</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Main Content Container -->
    <div id="pa-content">
      ${activeMode === 'single' ? (taskIdFromUrl ? '<div class="loading-state"><div class="spinner"></div><p>Loading prompt analytics...</p></div>' : `
        <div class="empty-state" style="margin-top:40px">
          <div class="icon">🔬</div>
          <p>Select a task above to analyze its prompt history and context reductions</p>
        </div>
      `) : `
        <div class="empty-state" style="margin-top:40px">
          <div class="icon">🔀</div>
          <p>Select 2 or more tasks above and click "Run Side-by-Side Task Comparison"</p>
        </div>
      `}
    </div>
  `;

  // Bind Mode Switcher
  document.getElementById('pa-tab-single')?.addEventListener('click', () => {
    activeMode = 'single';
    const taskId = currentTaskId || (allTasksList[0]?.id || '');
    window.location.hash = taskId ? `#/prompt-analytics?task=${taskId}&mode=single` : `#/prompt-analytics?mode=single`;
  });

  document.getElementById('pa-tab-compare')?.addEventListener('click', () => {
    activeMode = 'compare';
    window.location.hash = `#/prompt-analytics?mode=compare`;
  });

  document.getElementById('pa-load-btn')?.addEventListener('click', () => {
    const select = document.getElementById('pa-task-select');
    const taskId = select?.value;
    if (taskId) {
      window.location.hash = `#/prompt-analytics?task=${taskId}&mode=single`;
    }
  });

  document.getElementById('pa-task-select')?.addEventListener('change', (e) => {
    if (e.target.value) {
      window.location.hash = `#/prompt-analytics?task=${e.target.value}&mode=single`;
    }
  });

  // Bind Compare Checkboxes
  document.querySelectorAll('.pa-compare-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const selected = Array.from(document.querySelectorAll('.pa-compare-cb:checked')).map(c => c.value);
      compareSelectedTaskIds = selected;
      const cnt = document.getElementById('pa-compare-count');
      if (cnt) cnt.innerText = selected.length;
    });
  });

  document.getElementById('pa-run-compare-btn')?.addEventListener('click', () => {
    if (compareSelectedTaskIds.length < 1) {
      alert('Please select at least 1 or 2 tasks to compare');
      return;
    }
    loadCompareAnalytics(compareSelectedTaskIds);
  });

  if (activeMode === 'single' && taskIdFromUrl) {
    await loadTaskAnalytics(taskIdFromUrl);
  } else if (activeMode === 'compare' && compareSelectedTaskIds.length > 0) {
    await loadCompareAnalytics(compareSelectedTaskIds);
  }
}

async function loadTaskAnalytics(taskId) {
  currentTaskId = taskId;
  hoveredCallIndex = null;
  activeCategoryFilter = 'ALL';
  reductionSearchQuery = '';
  reductionViewMode = 'explorer';
  selectedExplorerEventIndex = 0;
  reductionFeedLimit = 30;

  const contentEl = document.getElementById('pa-content');
  if (!contentEl) return;

  contentEl.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading prompt analytics...</p></div>';

  try {
    analyticsData = await api.promptAnalytics(taskId);
    if (analyticsData) {
      if (!analyticsData.task) {
        analyticsData.task = { id: taskId };
      }
      analyticsData.task.label = getSavedTaskLabel(taskId, analyticsData.task.label);

      let item = allTasksList.find(t => t.id === taskId);
      if (!item) {
        item = {
          id: taskId,
          label: analyticsData.task.label,
          first_message: analyticsData.task.firstMessage || `Task ${taskId}`,
          total_cost: analyticsData.task.totalCost || 0,
          api_call_count: analyticsData.apiCalls?.length || 0,
        };
        allTasksList.unshift(item);
      } else {
        item.label = analyticsData.task.label;
      }

      const select = document.getElementById('pa-task-select');
      if (select) {
        select.innerHTML = `
          <option value="">— Choose a task to analyze —</option>
          ${allTasksList.map(t => {
            const displayName = t.label ? `🏷️ ${escHtml(t.label)}` : escHtml(t.first_message ? t.first_message.substring(0, 75) : 'Task ' + t.id);
            return `
              <option value="${t.id}" ${t.id === taskId ? 'selected' : ''}>
                ${displayName} (${t.api_call_count || 0} calls, ${fmtCost(t.total_cost)})
              </option>
            `;
          }).join('')}
        `;
      }
    }
  } catch (e) {
    contentEl.innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠</div>
        <p style="color:var(--red)">Failed to load analytics: ${escHtml(e.message)}</p>
      </div>
    `;
    return;
  }

  if (!analyticsData.apiCalls || analyticsData.apiCalls.length === 0) {
    contentEl.innerHTML = `
      <div class="empty-state">
        <div class="icon">📭</div>
        <p>No API calls found in this task</p>
      </div>
    `;
    return;
  }

  renderAnalytics(contentEl);
}

function getSavedTaskLabel(taskId, defaultLabel) {
  if (defaultLabel) return defaultLabel;
  try {
    return localStorage.getItem(`pq_task_label_${taskId}`) || null;
  } catch {
    return null;
  }
}

function setSavedTaskLabel(taskId, label) {
  try {
    if (label) localStorage.setItem(`pq_task_label_${taskId}`, label);
    else localStorage.removeItem(`pq_task_label_${taskId}`);
  } catch {}
}

function computeOverallCacheHitPct(calls) {
  let totalReads = 0;
  let totalPrompt = 0;
  (calls || []).forEach(c => {
    const reads = c.cacheReads || 0;
    const inTok = c.tokensIn || 0;
    totalReads += reads;
    if (reads > 0) {
      totalPrompt += (inTok >= reads ? inTok : (reads + inTok));
    } else {
      totalPrompt += inTok;
    }
  });
  if (totalPrompt <= 0) return { pct: '0.0', reads: totalReads, prompt: 0 };
  const pctVal = Math.min(100, Math.max(0, (totalReads / totalPrompt) * 100));
  const pctStr = (pctVal === 100 || totalReads === totalPrompt) ? '100.0' : pctVal.toFixed(1);
  return { pct: pctStr, reads: totalReads, prompt: totalPrompt };
}

function renderTaskMetricsBar(task, calls, overrideCost = null) {
  const bar = document.getElementById('pa-task-metrics-bar');
  if (!bar || !task) return;

  const totalCost = (overrideCost != null) ? overrideCost : (task.totalCost || calls.reduce((s, c) => s + (c.cost || 0), 0));
  const durationMs = (calls.length > 1 ? (calls[calls.length - 1].ts - calls[0].ts) : (task.duration || 0));
  const label = task.label || getSavedTaskLabel(task.id, null);
  task.label = label;
  const labelText = label ? escHtml(label) : '+ Add Label';

  // Synchronize dropdown option text with accurate live calls & cost
  const select = document.getElementById('pa-task-select');
  if (select) {
    const opt = select.querySelector(`option[value="${task.id}"]`);
    if (opt) {
      const displayName = label ? `🏷️ ${label}` : (task.firstMessage ? task.firstMessage.substring(0, 75) : 'Task ' + task.id);
      opt.innerText = `${displayName} (${calls.length} calls, ${fmtCost(totalCost)})`;
    }
  }

  bar.innerHTML = `
    <div style="display:flex;align-items:center;gap:6px;background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.3);padding:4px 10px;border-radius:14px;font-size:11px">
      <button id="pa-edit-label-btn" style="background:none;border:none;color:#38bdf8;font-weight:bold;cursor:pointer;display:flex;align-items:center;gap:4px;padding:0" title="Click to assign a unique custom label to this task">
        🏷️ <span id="pa-label-display">${labelText}</span>
        <span style="font-size:10px;opacity:0.7">✏️</span>
      </button>
    </div>

    <div style="display:flex;align-items:center;gap:12px;background:var(--bg-3);border:1px solid var(--border);padding:4px 12px;border-radius:var(--radius-sm);font-size:11px">
      <span title="Total number of LLM API calls made in task">📞 <strong>${calls.length}</strong> calls</span>
      <span style="color:var(--border)">|</span>
      <span title="Total financial cost spent on LLM requests">💰 <strong style="color:var(--green)">${fmtCost(totalCost)}</strong></span>
      <span style="color:var(--border)">|</span>
      <span title="Total duration of task execution">⏱️ <strong>${fmtDuration(durationMs)}</strong></span>
    </div>
  `;

  document.getElementById('pa-edit-label-btn')?.addEventListener('click', async () => {
    const currentLabel = task.label || getSavedTaskLabel(task.id, null) || '';
    const newLabel = prompt('Enter a unique label for this task (e.g. v1-baseline-prompt, claude-3.5-test):', currentLabel);
    if (newLabel !== null) {
      const cleanLabel = newLabel.trim() || null;
      task.label = cleanLabel;
      setSavedTaskLabel(task.id, cleanLabel);
      if (analyticsData && analyticsData.task) analyticsData.task.label = cleanLabel;

      // Update task list item label
      const taskItem = allTasksList.find(t => t.id === task.id);
      if (taskItem) taskItem.label = cleanLabel;

      renderTaskMetricsBar(task, calls, totalCost);

      // Update dropdown option text
      if (select) {
        const opt = select.querySelector(`option[value="${task.id}"]`);
        if (opt) {
          const displayName = cleanLabel ? `🏷️ ${cleanLabel}` : (task.firstMessage ? task.firstMessage.substring(0, 75) : 'Task ' + task.id);
          opt.innerText = `${displayName} (${calls.length} calls, ${fmtCost(totalCost)})`;
        }
      }

      // Sync with backend API in background
      try {
        await api.updateTaskLabel(task.id, cleanLabel);
      } catch (e) {
        console.warn('Backend task label sync warning:', e);
      }
    }
  });
}

function renderAnalytics(contentEl) {
  const data = analyticsData;
  const calls = data.apiCalls;
  const cats = data.reductionCategories || {};
  const events = data.reductionEvents || [];

  const fileSaved = (cats.truncatedFiles || []).reduce((s, f) => s + f.bytesSaved, 0);
  const cmdSaved = (cats.truncatedCommands || []).reduce((s, c) => s + c.bytesSaved, 0);
  const envSaved = cats.environmentSnapshots?.bytesSaved || 0;

  const scratchSum = data.scratchSummary || { count: 0, totalSavedBytes: 0 };
  const scratchSaved = scratchSum.totalSavedBytes || 0;
  const fb = data.financialBreakdown || {
    modelId: data.task?.model || 'unknown',
    totalCost: data.task?.totalCost || 0,
    input: { tokens: calls.reduce((s, c) => s + (c.tokensIn || 0), 0), cost: 0, pricePerM: 3.0 },
    output: { tokens: calls.reduce((s, c) => s + (c.tokensOut || 0), 0), cost: 0, pricePerM: 15.0 },
    cacheRead: { tokens: calls.reduce((s, c) => s + (c.cacheReads || 0), 0), cost: 0, pricePerM: 0.30 },
    cacheWrite: { tokens: calls.reduce((s, c) => s + (c.cacheWrites || 0), 0), cost: 0, pricePerM: 3.75 },
  };

  const accurateTotalCost = fb.totalCost || (data.task?.totalCost) || calls.reduce((s, c) => s + (c.cost || 0), 0);
  if (data.task) data.task.totalCost = accurateTotalCost;

  const fileCount = events.filter(e => e.category === 'File Read Truncated' || e.toolName === 'read_file' || e.toolName === 'replace_in_file' || (e.targetName && e.targetName.includes('.'))).length;
  const cmdCount = events.filter(e => e.category === 'Terminal Output Truncated' || e.toolName === 'execute_command').length;
  const scratchCount = events.filter(e => e.isScratch || e.scratchFilename || (e.category && e.category.includes('Scratch'))).length;

  renderTaskMetricsBar(data.task, calls, accurateTotalCost);

  contentEl.innerHTML = `
    <!-- Financial Cost & Token Breakdown Panel -->
    <div style="margin-bottom:16px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;box-shadow:var(--shadow-sm)">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;flex-wrap:wrap;gap:8px">
        <div style="font-weight:bold;font-size:12.5px;color:var(--text);display:flex;align-items:center;gap:6px">
          <span>💰 Task Financial Cost & Token Breakdown</span>
          <span style="background:rgba(56,189,248,0.15);color:#38bdf8;padding:2px 8px;border-radius:10px;font-size:10.5px;font-weight:bold" class="mono">🤖 ${escHtml(fb.modelId || 'Model')}</span>
        </div>
        <div style="font-size:11px;color:var(--text-3)">
          Calculated from exact LLM token counts & OpenRouter model rates
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(170px, 1fr));gap:10px">
        <!-- 1. Input Tokens -->
        <div style="background:var(--bg-3);border:1px solid var(--border);padding:10px;border-radius:var(--radius-sm);border-top:3px solid #38bdf8">
          <div style="font-size:10.5px;color:var(--text-3);margin-bottom:4px;font-weight:600">📥 Uncached Input</div>
          <div class="mono" style="font-size:15px;font-weight:bold;color:var(--text)">${fmtTokens(fb.input?.tokens || 0)}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:10px">
            <span style="color:#38bdf8;font-weight:bold">${fmtCost(fb.input?.cost || 0)}</span>
            <span style="color:var(--text-3)" class="mono">$${(fb.input?.pricePerM || 0).toFixed(2)}/1M</span>
          </div>
        </div>

        <!-- 2. Output Tokens -->
        <div style="background:var(--bg-3);border:1px solid var(--border);padding:10px;border-radius:var(--radius-sm);border-top:3px solid #e879f9">
          <div style="font-size:10.5px;color:var(--text-3);margin-bottom:4px;font-weight:600">📤 Output Generation</div>
          <div class="mono" style="font-size:15px;font-weight:bold;color:var(--text)">${fmtTokens(fb.output?.tokens || 0)}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:10px">
            <span style="color:#e879f9;font-weight:bold">${fmtCost(fb.output?.cost || 0)}</span>
            <span style="color:var(--text-3)" class="mono">$${(fb.output?.pricePerM || 0).toFixed(2)}/1M</span>
          </div>
        </div>

        <!-- 3. Cache Read Tokens -->
        <div style="background:var(--bg-3);border:1px solid var(--border);padding:10px;border-radius:var(--radius-sm);border-top:3px solid var(--green)">
          <div style="font-size:10.5px;color:var(--text-3);margin-bottom:4px;font-weight:600;display:flex;justify-content:space-between">
            <span>📖 Cache Reads</span>
            <span style="color:var(--green);font-size:9.5px;font-weight:bold">⚡ 90% Off</span>
          </div>
          <div class="mono" style="font-size:15px;font-weight:bold;color:var(--text)">${fmtTokens(fb.cacheRead?.tokens || 0)}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:10px">
            <span style="color:var(--green);font-weight:bold">${fmtCost(fb.cacheRead?.cost || 0)}</span>
            <span style="color:var(--text-3)" class="mono">$${(fb.cacheRead?.pricePerM || 0).toFixed(2)}/1M</span>
          </div>
        </div>

        <!-- 4. Cache Write Tokens -->
        <div style="background:var(--bg-3);border:1px solid var(--border);padding:10px;border-radius:var(--radius-sm);border-top:3px solid #f59e0b">
          <div style="font-size:10.5px;color:var(--text-3);margin-bottom:4px;font-weight:600">✍️ Cache Writes</div>
          <div class="mono" style="font-size:15px;font-weight:bold;color:var(--text)">${fmtTokens(fb.cacheWrite?.tokens || 0)}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:10px">
            <span style="color:#f59e0b;font-weight:bold">${fmtCost(fb.cacheWrite?.cost || 0)}</span>
            <span style="color:var(--text-3)" class="mono">$${(fb.cacheWrite?.pricePerM || 0).toFixed(2)}/1M</span>
          </div>
        </div>

        <!-- 5. Total Financial Cost -->
        <div style="background:rgba(34,197,94,0.08);border:1px solid rgba(34,197,94,0.3);padding:10px;border-radius:var(--radius-sm);border-top:3px solid var(--green)">
          <div style="font-size:10.5px;color:var(--green);margin-bottom:4px;font-weight:bold">💵 Total Financial Cost</div>
          <div class="mono" style="font-size:18px;font-weight:bold;color:var(--green)">${fmtCost(fb.totalCost || data.task?.totalCost || 0)}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px;font-size:10px;color:var(--text-2)">
            <span>${calls.length} API Calls</span>
            <span>100% Billable</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Executive Pruning Category Summary Grid -->
    <div style="margin-bottom:16px">
      <div style="font-weight:bold;font-size:12.5px;color:var(--text);margin-bottom:10px">
        📌 Executive Context Reduction Summary — What Was Pruned During Task:
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(240px, 1fr));gap:12px">
        <!-- Files Truncated Card -->
        <div class="panel" style="background:var(--bg-2);border:1px solid var(--border);border-left:4px solid var(--green);padding:12px;border-radius:var(--radius-sm)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-weight:bold;font-size:11.5px;color:var(--green)">📁 File Read Truncations</span>
            <span class="mono" style="font-size:11px;font-weight:bold;color:var(--green)">-${fmtBytes(fileSaved)}</span>
          </div>
          <div style="font-size:10.5px;color:var(--text-3);margin-bottom:8px">
            ${(cats.truncatedFiles || []).length} unique files truncated in context:
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;max-height:120px;overflow-y:auto">
            ${(cats.truncatedFiles || []).map(f => `
              <div class="pa-summary-row" title="Full File Path: ${escHtml(f.path)} &#10;Total Pruned: ${fmtBytes(f.bytesSaved)} (${f.count} times)" data-target="${escHtml(f.path)}" style="display:flex;justify-content:space-between;font-size:10px;background:var(--bg-3);padding:4px 8px;border-radius:3px;cursor:pointer;transition:background 0.15s">
                <span style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px;font-family:monospace" title="${escHtml(f.path)}">${escHtml(f.path)}</span>
                <span class="mono" style="color:var(--green);font-weight:bold;margin-left:6px">-${fmtBytes(f.bytesSaved)} (${f.count}x)</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Terminal Output Card -->
        <div class="panel" style="background:var(--bg-2);border:1px solid var(--border);border-left:4px solid #38bdf8;padding:12px;border-radius:var(--radius-sm)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-weight:bold;font-size:11.5px;color:#38bdf8">💻 Command Output Truncations</span>
            <span class="mono" style="font-size:11px;font-weight:bold;color:#38bdf8">-${fmtBytes(cmdSaved)}</span>
          </div>
          <div style="font-size:10.5px;color:var(--text-3);margin-bottom:8px">
            ${(cats.truncatedCommands || []).length} command outputs capped:
          </div>
          <div style="display:flex;flex-direction:column;gap:4px;max-height:120px;overflow-y:auto">
            ${(cats.truncatedCommands || []).map(c => `
              <div class="pa-summary-row" title="Full Command: ${escHtml(c.command)} &#10;Total Pruned: ${fmtBytes(c.bytesSaved)}" data-target="${escHtml(c.command)}" style="display:flex;justify-content:space-between;font-size:10px;background:var(--bg-3);padding:4px 8px;border-radius:3px;cursor:pointer;transition:background 0.15s">
                <span style="color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:190px;font-family:monospace" title="${escHtml(c.command)}">${escHtml(c.command)}</span>
                <span class="mono" style="color:#38bdf8;font-weight:bold;margin-left:6px">-${fmtBytes(c.bytesSaved)}</span>
              </div>
            `).join('')}
          </div>
        </div>

        <!-- Environment Details Card -->
        <div class="panel" style="background:var(--bg-2);border:1px solid var(--border);border-left:4px solid #f59e0b;padding:12px;border-radius:var(--radius-sm)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-weight:bold;font-size:11.5px;color:#f59e0b">🌲 Environment Snapshots Pruned</span>
            <span class="mono" style="font-size:11px;font-weight:bold;color:#f59e0b">-${fmtBytes(envSaved)}</span>
          </div>
          <div style="font-size:10.5px;color:var(--text-3);margin-bottom:8px">
            ${cats.environmentSnapshots?.count || 0} stale workspace snapshots removed to prevent context bloat.
          </div>
          <div style="font-size:11px;color:var(--text-2);background:var(--bg-3);padding:8px;border-radius:2px;margin-top:10px">
            ✓ Keeps latest workspace state while purging historical duplicates.
          </div>
        </div>

        <!-- Immediate Scratch Offloads Card -->
        <div class="panel" style="background:var(--bg-2);border:1px solid var(--border);border-left:4px solid #e879f9;padding:12px;border-radius:var(--radius-sm)">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <span style="font-weight:bold;font-size:11.5px;color:#e879f9">⚡ Immediate Scratch Offloads</span>
            <span class="mono" style="font-size:11px;font-weight:bold;color:#e879f9">-${fmtBytes(scratchSaved)}</span>
          </div>
          <div style="font-size:10.5px;color:var(--text-3);margin-bottom:8px">
            ${scratchSum.count || 0} tool outputs offloaded to scratch/ files:
          </div>
          <div style="font-size:11px;color:var(--text-2);background:var(--bg-3);padding:8px;border-radius:2px;margin-top:10px">
            ✓ Offloads raw bulk logs to disk at write-time, keeping only compact Head+Tail snippets in prompt.
          </div>
        </div>
      </div>
    </div>

    <!-- Timeline Chart Panel -->
    <div class="panel pa-chart-panel">
      <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span>📊 Request Size, Cumulative Cost & Cache Timeline</span>
          ${data.task?.label ? `<span style="background:rgba(56,189,248,0.15);color:#38bdf8;padding:2px 8px;border-radius:10px;font-size:10.5px;font-weight:bold">🏷️ ${escHtml(data.task.label)}</span>` : ''}
          <span style="background:rgba(236,72,153,0.15);border:1px solid rgba(236,72,153,0.5);color:#f472b6;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:bold;display:inline-flex;align-items:center;gap:6px">
            💰 Total Task Cost: <span class="mono" style="color:#ffffff">${fmtCost(data.task?.totalCost || (calls.length > 0 ? (calls[calls.length - 1]?.cumulativeCost || calls[calls.length - 1]?.cost || 0) : 0))}</span>
            <span style="font-weight:normal;color:var(--text-3);font-size:10px">(${fmtCost(calls.length > 0 ? ((data.task?.totalCost || (calls[calls.length - 1]?.cumulativeCost || 0)) / calls.length) : 0)}/call)</span>
          </span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          ${renderLegendFilterMarkup()}
          <button id="pa-detach-chart-btn" class="action-btn secondary" style="padding:3px 10px;font-size:11px;display:flex;align-items:center;gap:4px" title="Detach graph into interactive fullscreen mode with section zoom">
            ⛶ Fullscreen Zoom
          </button>
        </div>
      </div>
      <div class="panel-body">
        <!-- Visual Bar Color Key & Interactive Click Hint -->
        <div style="display:flex;align-items:center;justify-content:space-between;background:var(--bg-3);padding:6px 12px;border-radius:4px;border:1px solid var(--border);margin-bottom:10px;font-size:11px;color:var(--text-2);flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <span style="font-weight:600;color:var(--text)">Chart Bar Key:</span>
            <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#38bdf8;display:inline-block"></span> Normal Input</span>
            <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#10b981;display:inline-block"></span> 📁 File Truncated</span>
            <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#06b6d4;display:inline-block"></span> 💻 Cmd Truncated</span>
            <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#e879f9;display:inline-block"></span> ⚡ Scratch Offloaded</span>
            <span style="display:flex;align-items:center;gap:4px"><span style="width:10px;height:10px;border-radius:2px;background:#10b981;display:inline-block"></span> ✂️ History Pruned</span>
          </div>
          <span style="color:#38bdf8;font-weight:600;font-size:11px">💡 Tip: Click any bar in the graph to isolate & view that turn's files</span>
        </div>

        <div class="pa-chart-container" style="position:relative">
          <canvas id="pa-timeline-chart"></canvas>
          <div id="pa-chart-tooltip" class="pa-chart-tooltip" style="display:none;pointer-events:none;z-index:100;position:absolute"></div>
        </div>
        <div id="pa-step-jump-strip"></div>
        <div id="pa-chart-swimlane"></div>
      </div>
    </div>

    <!-- Chronological Reduction Sequence Feed & Comparison Section -->
    <div id="pa-comparison-section" class="panel pa-comparison-panel-full">
      <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span>📜 Context Reductions (<span id="pa-seq-total-count">${events.length}</span> total events)</span>
          <div style="display:inline-flex;background:var(--bg-3);border:1px solid var(--border);border-radius:4px;padding:2px">
            <button id="pa-btn-mode-explorer" class="pa-viewmode-btn action-btn ${reductionViewMode === 'explorer' ? 'primary' : 'secondary'}" data-mode="explorer" style="padding:2px 8px;font-size:10.5px;cursor:pointer">🪟 Explorer</button>
            <button id="pa-btn-mode-matrix" class="pa-viewmode-btn action-btn ${reductionViewMode === 'matrix' ? 'primary' : 'secondary'}" data-mode="matrix" style="padding:2px 8px;font-size:10.5px;cursor:pointer">📁 File Matrix</button>
            <button id="pa-btn-mode-timeline" class="pa-viewmode-btn action-btn ${reductionViewMode === 'timeline' ? 'primary' : 'secondary'}" data-mode="timeline" style="padding:2px 8px;font-size:10.5px;cursor:pointer">📜 Feed</button>
            <button id="pa-btn-mode-grouped" class="pa-viewmode-btn action-btn ${reductionViewMode === 'grouped' ? 'primary' : 'secondary'}" data-mode="grouped" style="padding:2px 8px;font-size:10.5px;cursor:pointer">🗂️ Grouped</button>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="position:relative;display:flex;align-items:center">
            <input id="pa-seq-search-input" type="text" placeholder="🔍 Search file / tool / cmd..." value="${escHtml(reductionSearchQuery)}" style="background:var(--bg-1);border:1px solid var(--border);border-radius:4px;padding:3px 20px 3px 8px;font-size:11px;color:var(--text);width:175px">
            ${reductionSearchQuery ? `<button id="pa-seq-search-clear" style="position:absolute;right:4px;background:none;border:none;color:var(--text-3);cursor:pointer;font-size:11px">✖</button>` : ''}
          </div>
          <div id="pa-cat-filters-bar" style="display:flex;align-items:center;gap:4px;font-size:11px;flex-wrap:wrap"></div>
        </div>
      </div>
      <div class="panel-body" id="pa-comparison-body" style="padding:0"></div>
    </div>

    <!-- Cache Observability Breakdown Section -->
    <div id="pa-cache-section" class="panel" style="display:none;margin-top:16px">
      <div class="panel-title">
        <span>⚡ Prompt Cache Hit Observability & Sub-Turn Performance</span>
      </div>
      <div class="panel-body" id="pa-cache-body" style="padding:0"></div>
    </div>

    <!-- Scratch Offload Inspector Panel -->
    <div id="pa-scratch-section" class="panel" style="display:none;margin-top:16px">
      <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>⚡ Scratch Offload Inspector (${(data.scratchEvents || []).length} Log Files Created)</span>
        <button id="pa-close-scratch-panel" class="action-btn secondary" style="padding:2px 8px;font-size:11px">✖ Close</button>
      </div>
      <div class="panel-body" id="pa-scratch-body"></div>
    </div>
  `;

  bindAnalyticsEvents(calls);
  drawTimelineChart(calls);
  renderCallPillsStrip(calls, document.getElementById('pa-step-jump-strip'));
  renderModelSwimlane(calls, document.getElementById('pa-chart-swimlane'));

  renderReductionSequenceFeed(document.getElementById('pa-comparison-body'), events);
  renderCacheObservabilityPanel(document.getElementById('pa-cache-body'), calls);
  renderScratchInspector(document.getElementById('pa-scratch-body'), data.scratchEvents || []);

  document.getElementById('pa-detach-chart-btn')?.addEventListener('click', () => {
    openFullscreenChartModal(calls, data.task);
  });
}

function openFullscreenChartModal(calls, task) {
  let modal = document.getElementById('pa-fullscreen-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'pa-fullscreen-modal';
    modal.style.cssText = `
      position:fixed;top:0;left:0;width:100vw;height:100vh;
      background:rgba(10,15,25,0.96);backdrop-filter:blur(8px);
      z-index:9999;display:flex;flex-direction:column;padding:20px;box-sizing:border-box;
    `;
    document.body.appendChild(modal);
  }

  fullscreenZoomRange = [0, 100];

  modal.style.display = 'flex';
  modal.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px">
      <div>
        <h2 style="font-size:18px;margin:0;color:var(--text);display:flex;align-items:center;gap:10px">
          <span>📊 Fullscreen Timeline Zoom & Section Analysis</span>
          ${task?.label ? `<span style="background:rgba(56,189,248,0.2);color:#38bdf8;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:bold">🏷️ ${escHtml(task.label)}</span>` : ''}
        </h2>
        <p style="font-size:11px;color:var(--text-3);margin:4px 0 0">Drag the stock-chart style section sliders below to zoom into specific call ranges and inspect spikes</p>
      </div>
      <button id="pa-fullscreen-close" class="action-btn secondary" style="padding:6px 14px;font-size:13px;font-weight:bold">✖ Close Fullscreen</button>
    </div>

    <!-- Fullscreen Metric Filters Bar -->
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px;background:var(--bg-3);padding:8px 14px;border-radius:var(--radius-sm);border:1px solid var(--border)">
      <div style="font-weight:bold;font-size:12px;color:var(--text)">
        📊 Metric Filters:
      </div>
      ${renderLegendFilterMarkup()}
    </div>

    <!-- Chart Canvas Container -->
    <div style="flex:1;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;display:flex;flex-direction:column;position:relative">
      <div style="flex:1;position:relative;min-height:360px">
        <canvas id="pa-fullscreen-canvas" data-height="380"></canvas>
        <div id="pa-fullscreen-tooltip" class="pa-chart-tooltip" style="display:none;pointer-events:none;z-index:100;position:absolute"></div>
      </div>

      <!-- Range Zoom Controls -->
      <div style="margin-top:14px;background:var(--bg-3);padding:12px;border-radius:var(--radius-sm);border:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;margin-bottom:8px">
          <span>🔍 <strong>Stock Chart Range Zoom (Brush Selector)</strong></span>
          <span id="pa-zoom-range-label" style="font-weight:bold;color:#38bdf8">Showing Calls #1 to #${calls.length}</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:10.5px;color:var(--text-3)">Start Call:</span>
          <input type="range" id="pa-zoom-min" min="0" max="95" value="0" style="flex:1">
          <span style="font-size:10.5px;color:var(--text-3)">End Call:</span>
          <input type="range" id="pa-zoom-max" min="5" max="100" value="100" style="flex:1">
          <button id="pa-zoom-reset" class="action-btn secondary" style="padding:2px 10px;font-size:10.5px">Reset Zoom</button>
        </div>
      </div>
    </div>
  `;

  const fsCanvas = document.getElementById('pa-fullscreen-canvas');

  const updateFsChart = () => {
    drawTimelineChart(calls, fsCanvas, fullscreenZoomRange);
    const startIdx = Math.floor((fullscreenZoomRange[0] / 100) * calls.length) + 1;
    const endIdx = Math.max(startIdx, Math.ceil((fullscreenZoomRange[1] / 100) * calls.length));
    const rangeLabel = document.getElementById('pa-zoom-range-label');
    if (rangeLabel) {
      rangeLabel.innerText = `Showing Calls #${startIdx} to #${endIdx} of ${calls.length} total calls`;
    }
  };

  updateFsChart();

  bindGlobalLegendEvents(modal, () => {
    updateFsChart();
    const mainCanvas = document.getElementById('pa-timeline-chart');
    if (mainCanvas && mainCanvas._calls) {
      drawTimelineChart(mainCanvas._calls, mainCanvas);
    }
  });

  document.getElementById('pa-fullscreen-close')?.addEventListener('click', () => {
    modal.style.display = 'none';
  });

  const minSlider = document.getElementById('pa-zoom-min');
  const maxSlider = document.getElementById('pa-zoom-max');

  minSlider?.addEventListener('input', (e) => {
    let val = parseInt(e.target.value);
    if (val >= fullscreenZoomRange[1] - 2) val = fullscreenZoomRange[1] - 2;
    fullscreenZoomRange[0] = val;
    updateFsChart();
  });

  maxSlider?.addEventListener('input', (e) => {
    let val = parseInt(e.target.value);
    if (val <= fullscreenZoomRange[0] + 2) val = fullscreenZoomRange[0] + 2;
    fullscreenZoomRange[1] = val;
    updateFsChart();
  });

  document.getElementById('pa-zoom-reset')?.addEventListener('click', () => {
    fullscreenZoomRange = [0, 100];
    if (minSlider) minSlider.value = 0;
    if (maxSlider) maxSlider.value = 100;
    updateFsChart();
  });

  if (fsCanvas) {
    fsCanvas._calls = calls;
    if (!fsCanvas._hasHoverBound) {
      fsCanvas._hasHoverBound = true;
      fsCanvas.addEventListener('mousemove', (e) => {
        handleChartHover(e, fsCanvas._calls, fsCanvas, 'pa-fullscreen-tooltip');
      });
      fsCanvas.addEventListener('mouseleave', () => {
        fsCanvas._hoveredIndex = null;
        updateFsChart();
        const tt = document.getElementById('pa-fullscreen-tooltip');
        if (tt) tt.style.display = 'none';
      });
    }
  }
}

// ── Multi-Task Comparison View Handler ──
async function loadCompareAnalytics(taskIds) {
  const contentEl = document.getElementById('pa-content');
  if (!contentEl) return;

  contentEl.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Fetching multi-task analytics data for comparison...</p></div>';

  compareDataMap = {};
  for (const id of taskIds) {
    try {
      const res = await api.promptAnalytics(id);
      if (res && res.apiCalls) {
        if (!res.task) res.task = { id };
        const taskItem = allTasksList.find(x => x.id === id);
        const resolvedLabel = taskItem?.label || res.task.label || getSavedTaskLabel(id, null);
        res.task.label = resolvedLabel;
        if (taskItem) taskItem.label = resolvedLabel;
        compareDataMap[id] = res;
      }
    } catch (e) {
      console.error(`Failed to load comparison data for ${id}:`, e);
    }
  }

  const validIds = Object.keys(compareDataMap);
  if (validIds.length === 0) {
    contentEl.innerHTML = `
      <div class="empty-state">
        <div class="icon">⚠</div>
        <p>No valid prompt analytics found for the selected tasks</p>
      </div>
    `;
    return;
  }

  renderCompareAnalyticsView(contentEl, validIds);
}

function renderCompareAnalyticsView(contentEl, taskIds) {
  const maxCallsAcrossTasks = Math.max(...taskIds.map(id => compareDataMap[id].apiCalls.length), 1);
  compareStepIndex = 0;

  contentEl.innerHTML = `
    <!-- Executive Side-by-Side Metrics Table -->
    <div class="panel" style="margin-bottom:16px">
      <div class="panel-title">🔀 Executive Side-by-Side Performance Comparison (${taskIds.length} tasks)</div>
      <div class="panel-body" style="padding:14px;overflow-x:auto">
        <table style="width:100%;border-collapse:collapse;font-size:11.5px">
          <thead>
            <tr style="background:var(--bg-3);color:var(--text-3);text-align:left">
              <th style="padding:10px">Task / Label</th>
              <th style="padding:10px">Total Calls</th>
              <th style="padding:10px">Total Cost ($)</th>
              <th style="padding:10px">Duration</th>
              <th style="padding:10px">Cache Hit %</th>
              <th style="padding:10px">Pruned Context</th>
              <th style="padding:10px">Primary Model</th>
            </tr>
          </thead>
          <tbody>
            ${taskIds.map(id => {
              const d = compareDataMap[id];
              const t = d.task || { id };
              const taskItem = allTasksList.find(x => x.id === id);
              const label = taskItem?.label || t.label || getSavedTaskLabel(id, null);
              t.label = label;
              const displayName = label ? `🏷️ ${escHtml(label)}` : escHtml(t.firstMessage ? t.firstMessage.substring(0, 50) : id);

              const calls = d.apiCalls || [];
              const totalCost = d.financialBreakdown?.totalCost || calls.reduce((s, c) => s + (c.cost || 0), 0) || t.totalCost || 0;
              const durationMs = t.duration || (calls.length > 1 ? (calls[calls.length - 1].ts - calls[0].ts) : 0);

              const { pct: cacheHitPct } = computeOverallCacheHitPct(calls);

              const cats = d.reductionCategories || {};
              const fileSaved = (cats.truncatedFiles || []).reduce((s, f) => s + f.bytesSaved, 0);
              const cmdSaved = (cats.truncatedCommands || []).reduce((s, c) => s + c.bytesSaved, 0);
              const scratchSaved = d.scratchSummary?.totalSavedBytes || 0;
              const totalPruned = fileSaved + cmdSaved + (cats.environmentSnapshots?.bytesSaved || 0) + scratchSaved;

              const modelLabel = d.financialBreakdown?.modelId || calls.find(c => c.modelId)?.modelId || 'Unknown';

              return `
                <tr style="border-bottom:1px solid var(--border)">
                  <td style="padding:10px;font-weight:bold">
                    <span style="${label ? 'color:#38bdf8' : ''}">${displayName}</span>
                  </td>
                  <td class="mono" style="padding:10px;font-weight:bold">${calls.length} calls</td>
                  <td class="mono" style="padding:10px;color:var(--green);font-weight:bold">${fmtCost(totalCost)}</td>
                  <td class="mono" style="padding:10px">${fmtDuration(durationMs)}</td>
                  <td class="mono" style="padding:10px;color:#06b6d4;font-weight:bold">${cacheHitPct}%</td>
                  <td class="mono" style="padding:10px;color:#38bdf8">${fmtBytes(totalPruned)}</td>
                  <td style="padding:10px;color:var(--text-2);font-family:monospace;font-size:10.5px">${escHtml(modelLabel)}</td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>

    <!-- Synchronized Step Slider Controls -->
    <div class="panel" style="margin-bottom:16px;background:var(--bg-2)">
      <div class="panel-body" style="padding:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-weight:bold;font-size:12.5px;color:var(--text)">
            ⏱️ Master Synchronized Step Slider — Inspect Turn-by-Turn Behavior Across Tasks
          </div>
          <div style="font-size:12px;font-weight:bold;color:#38bdf8">
            Inspecting Call #<span id="pa-compare-step-num">1</span> of ${maxCallsAcrossTasks}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:11px;color:var(--text-3)">Call #1</span>
          <input type="range" id="pa-compare-slider" min="0" max="${maxCallsAcrossTasks - 1}" value="0" style="flex:1">
          <span style="font-size:11px;color:var(--text-3)">Call #${maxCallsAcrossTasks}</span>
        </div>
      </div>
    </div>

    <!-- Synchronized Step State Comparison Inspector Grid -->
    <div style="margin-bottom:16px">
      <div style="font-weight:bold;font-size:12px;color:var(--text);margin-bottom:10px">
        🔍 Step Inspector — What happened at Call #<span id="pa-compare-inspector-num">1</span> for each selected task:
      </div>
      <div id="pa-compare-inspector-grid" style="display:grid;grid-template-columns:repeat(auto-fit, minmax(300px, 1fr));gap:12px">
        <!-- Rendered dynamically -->
      </div>
    </div>

    <!-- Global Comparison Legend Toggle Controls -->
    <div class="panel" style="margin-bottom:16px;background:var(--bg-2)">
      <div class="panel-body" style="padding:12px 14px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div style="font-weight:bold;font-size:12.5px;color:var(--text)">
            📊 Comparison Metric Lines:
          </div>
          <button id="pa-toggle-shared-scale-btn" class="pa-legend-chip ${useSharedCompareScale ? 'active' : ''}" style="--chip-color:#38bdf8;font-weight:bold;border:1px solid rgba(56,189,248,0.4)" title="When enabled, all side-by-side graphs share the exact same Y-axis scale so relative differences ($6.65 vs $12.56) are visually obvious">
            ⚖️ Shared Y-Axis Scale: <strong style="color:#38bdf8">${useSharedCompareScale ? 'ON (Proportional)' : 'OFF (Independent)'}</strong>
          </button>
        </div>
        ${renderLegendFilterMarkup()}
      </div>
    </div>

    <!-- Unified Multi-Task Cumulative Cost Overlay Panel -->
    <div class="panel" style="margin-bottom:16px;background:var(--bg-2)">
      <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <div style="display:flex;align-items:center;gap:8px">
          <span>📈 Unified Cumulative Cost Growth Comparison (Overlaid Tasks)</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;font-size:10.5px;flex-wrap:wrap">
          ${taskIds.map((id, tIdx) => {
            const d = compareDataMap[id];
            const t = d?.task || { id };
            const taskItem = allTasksList.find(x => x.id === id);
            const label = taskItem?.label || t.label || getSavedTaskLabel(id, null);
            const name = label ? `🏷️ ${label}` : (t.firstMessage ? t.firstMessage.substring(0, 20) : id);
            const color = COMPARE_TASK_COLORS[tIdx % COMPARE_TASK_COLORS.length];
            const cost = t.totalCost || (d?.apiCalls || []).reduce((s, c) => s + c.cost, 0);
            return `<span style="background:${color}22;color:${color};border:1px solid ${color}44;padding:2px 8px;border-radius:10px;font-weight:bold">${escHtml(name)}: ${fmtCost(cost)}</span>`;
          }).join('')}
        </div>
      </div>
      <div class="panel-body">
        <div style="position:relative">
          <canvas id="pa-compare-combined-canvas" data-height="220"></canvas>
        </div>
      </div>
    </div>

    <!-- Side-by-Side Timeline Charts -->
    <div style="display:grid;grid-template-columns:1fr;gap:16px;position:relative">
      <div id="pa-compare-tooltip" class="pa-chart-tooltip" style="display:none;pointer-events:none;z-index:100;position:absolute"></div>
      ${taskIds.map(id => {
        const d = compareDataMap[id];
        const t = d.task || { id };
        const taskItem = allTasksList.find(x => x.id === id);
        const label = taskItem?.label || t.label || getSavedTaskLabel(id, null);
        t.label = label;
        const displayName = label ? `🏷️ ${escHtml(label)}` : escHtml(t.firstMessage ? t.firstMessage.substring(0, 60) : id);

        return `
          <div class="panel">
            <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
              <span style="font-size:13px;font-weight:bold;${label ? 'color:#38bdf8' : ''}">
                📊 ${displayName}
              </span>
              <div style="display:flex;align-items:center;gap:8px">
                <span class="mono" style="font-size:11px;color:var(--green);font-weight:bold">${d.apiCalls.length} calls | ${fmtCost(t.totalCost)}</span>
                <button class="action-btn secondary pa-compare-fullscreen-btn" data-task-id="${id}" style="padding:2px 8px;font-size:10.5px;display:flex;align-items:center;gap:4px" title="Open fullscreen zoom for this task">
                  ⛶ Fullscreen Zoom
                </button>
              </div>
            </div>
            <div class="panel-body">
              <div style="position:relative">
                <canvas id="pa-compare-canvas-${id}" data-task-id="${id}" data-height="200"></canvas>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  const getGlobalCompareMaxes = () => {
    if (!useSharedCompareScale) return null;
    let maxCost = 0.01;
    let maxSize = 1;
    let maxCache = 1;
    let maxLatency = 1;
    const reqMode = window.requestSizeMode || requestSizeMode || 'accumulated';

    taskIds.forEach(id => {
      const calls = compareDataMap[id]?.apiCalls || [];
      calls.forEach(c => {
        const costVal = c.cumulativeCost || c.cost || 0;
        if (costVal > maxCost) maxCost = costVal;
        const targetSize = reqMode === 'accumulated'
          ? (c.requestSize || 1)
          : (c.turnDeltaSize || (c.sizeDelta ? Math.abs(c.sizeDelta) : (c.tokensIn ? c.tokensIn * 4 : 100)));
        if (targetSize > maxSize) maxSize = targetSize;
        if ((c.cacheReads || 0) > maxCache) maxCache = c.cacheReads;
        if ((c.cacheWrites || 0) > maxCache) maxCache = c.cacheWrites;
        if (((c.latencyMs || 0) / 1000) > maxLatency) maxLatency = (c.latencyMs || 0) / 1000;
      });
    });

    return { maxCost, maxSize, maxCache, maxLatency };
  };

  // Draw initial comparative charts
  const updateAllCompareCharts = (stepIdx) => {
    const stepLabel = document.getElementById('pa-compare-step-num');
    const inspLabel = document.getElementById('pa-compare-inspector-num');
    if (stepLabel) stepLabel.innerText = String(stepIdx + 1);
    if (inspLabel) inspLabel.innerText = String(stepIdx + 1);

    const sharedMaxes = getGlobalCompareMaxes();

    taskIds.forEach(id => {
      const canvas = document.getElementById(`pa-compare-canvas-${id}`);
      if (canvas && compareDataMap[id]) {
        canvas._calls = compareDataMap[id].apiCalls;
        drawTimelineChart(canvas._calls, canvas, null, stepIdx, sharedMaxes);
        if (!canvas._hasHoverBound) {
          canvas._hasHoverBound = true;
          canvas.addEventListener('mousemove', (e) => {
            handleChartHover(e, canvas._calls, canvas, 'pa-compare-tooltip');
          });
          canvas.addEventListener('mouseleave', () => {
            canvas._hoveredIndex = null;
            redrawTargetCanvas(canvas, canvas._calls);
            const tt = document.getElementById('pa-compare-tooltip');
            if (tt) tt.style.display = 'none';
          });
        }
      }
    });

    drawCombinedCompareChart(taskIds, stepIdx, sharedMaxes);
    renderCompareStepInspector(taskIds, stepIdx);
  };

  updateAllCompareCharts(0);

  // Bind Shared Y-Axis Scale toggle button
  document.getElementById('pa-toggle-shared-scale-btn')?.addEventListener('click', () => {
    useSharedCompareScale = !useSharedCompareScale;
    const btn = document.getElementById('pa-toggle-shared-scale-btn');
    if (btn) {
      btn.classList.toggle('active', useSharedCompareScale);
      btn.querySelector('strong').innerText = useSharedCompareScale ? 'ON (Proportional)' : 'OFF (Independent)';
    }
    updateAllCompareCharts(compareStepIndex);
  });

  bindGlobalLegendEvents(document.getElementById('pa-content'), () => {
    updateAllCompareCharts(compareStepIndex);
  });

  document.querySelectorAll('.pa-compare-fullscreen-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const tid = btn.dataset.taskId;
      if (tid && compareDataMap[tid]) {
        openFullscreenChartModal(compareDataMap[tid].apiCalls, compareDataMap[tid].task);
      }
    });
  });

  const slider = document.getElementById('pa-compare-slider');
  slider?.addEventListener('input', (e) => {
    compareStepIndex = parseInt(e.target.value);
    updateAllCompareCharts(compareStepIndex);
  });
}

function drawCombinedCompareChart(taskIds, stepIdx = null, sharedMaxes = null) {
  const canvas = document.getElementById('pa-compare-combined-canvas');
  if (!canvas) return;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const h = canvas.dataset.height ? parseInt(canvas.dataset.height) : 220;

  canvas.width = rect.width * dpr;
  canvas.height = h * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = h + 'px';
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const pad = { top: 25, right: 60, bottom: 35, left: 70 };
  const chartWeff = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  ctx.fillStyle = isDark ? '#111827' : '#ffffff';
  ctx.fillRect(0, 0, w, h);

  let maxCost = (sharedMaxes && sharedMaxes.maxCost) ? sharedMaxes.maxCost : 0.01;
  let maxCalls = 1;

  taskIds.forEach(id => {
    const calls = compareDataMap[id]?.apiCalls || [];
    if (calls.length > maxCalls) maxCalls = calls.length;
    if (!sharedMaxes || !sharedMaxes.maxCost) {
      calls.forEach(c => {
        const val = c.cumulativeCost || c.cost || 0;
        if (val > maxCost) maxCost = val;
      });
    }
  });

  // Grid lines
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (chartH / 5) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
  }

  // Left Y-axis (Cost $)
  ctx.fillStyle = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (chartH / 5) * i;
    const val = maxCost - (maxCost / 5) * i;
    ctx.fillText(fmtCost(val), pad.left - 8, y + 3);
  }

  // Draw cost curve for each task
  taskIds.forEach((id, tIdx) => {
    const d = compareDataMap[id];
    if (!d || !d.apiCalls || d.apiCalls.length === 0) return;

    const calls = d.apiCalls;
    const color = COMPARE_TASK_COLORS[tIdx % COMPARE_TASK_COLORS.length];
    const colWidth = chartWeff / (maxCalls > 1 ? maxCalls - 1 : 1);

    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.shadowColor = `${color}66`;
    ctx.shadowBlur = 4;
    ctx.beginPath();

    const points = [];
    calls.forEach((c, idx) => {
      const x = pad.left + idx * colWidth;
      const costVal = c.cumulativeCost || c.cost || 0;
      const y = pad.top + chartH * (1 - costVal / maxCost);
      points.push({ x, y, costVal, call: c, index: idx });

      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.stroke();
    ctx.shadowBlur = 0;

    // Point markers
    points.forEach(pt => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pt.x, Math.max(pt.y, pad.top), (stepIdx === pt.index) ? 5 : 2.5, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  // Vertical Crosshair line for stepIdx
  if (stepIdx != null && stepIdx < maxCalls) {
    const colWidth = chartWeff / (maxCalls > 1 ? maxCalls - 1 : 1);
    const x = pad.left + stepIdx * colWidth;
    ctx.strokeStyle = '#f43f5e';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(x, pad.top);
    ctx.lineTo(x, pad.top + chartH);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  ctx.fillStyle = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('API Call #', w / 2, h - 6);
}

function renderCompareStepInspector(taskIds, stepIdx) {
  const grid = document.getElementById('pa-compare-inspector-grid');
  if (!grid) return;

  grid.innerHTML = taskIds.map(id => {
    const d = compareDataMap[id];
    const t = d.task || { id };
    const calls = d.apiCalls || [];
    const call = calls[stepIdx];

    const taskItem = allTasksList.find(x => x.id === id);
    const label = taskItem?.label || t.label || getSavedTaskLabel(id, null);
    t.label = label;
    const displayName = label ? `🏷️ ${escHtml(label)}` : escHtml(t.firstMessage ? t.firstMessage.substring(0, 35) : id);

    const labelHeader = `<span style="font-weight:bold;font-size:11.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${label ? 'color:#38bdf8' : ''}">${displayName}</span>`;

    if (!call) {
      return `
        <div class="panel" style="background:var(--bg-2);border:1px solid var(--border);padding:12px;border-radius:var(--radius-sm);opacity:0.6">
          <div style="font-weight:bold;font-size:11.5px;color:var(--text-3);margin-bottom:6px;display:flex;align-items:center;gap:6px">
            ${labelHeader}
          </div>
          <div style="font-size:10.5px;color:var(--text-3);font-style:italic">
            (Task completed before Call #${stepIdx + 1})
          </div>
        </div>
      `;
    }

    const hitBadge = call.cacheReads > 0 ? '<span style="background:rgba(34,197,94,0.15);color:var(--green);padding:2px 6px;border-radius:8px;font-weight:bold;font-size:9.5px">🎯 Cache Hit</span>' : '<span style="color:var(--text-3);font-size:9.5px">Uncached</span>';

    return `
      <div class="panel" style="background:var(--bg-2);border:1px solid var(--border);border-left:4px solid #38bdf8;padding:12px;border-radius:var(--radius-sm)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:6px;overflow:hidden;max-width:210px">
            ${labelHeader}
          </div>
          ${hitBadge}
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:10.5px;background:var(--bg-3);padding:8px;border-radius:var(--radius-sm)">
          <div>
            <span style="color:var(--text-3)">📦 Payload:</span> <strong style="color:#38bdf8">${fmtBytes(call.requestSize)}</strong>
          </div>
          <div>
            <span style="color:var(--text-3)">⚡ New Input:</span> <strong style="color:#38bdf8">${fmtBytes(call.turnDeltaSize || Math.max(0, call.sizeDelta))}</strong>
          </div>
          <div>
            <span style="color:var(--text-3)">Call Cost:</span> <strong style="color:var(--green)">${fmtCost(call.cost)}</strong>
          </div>
          <div>
            <span style="color:var(--text-3)">Cumulative:</span> <strong style="color:#ec4899">${fmtCost(call.cumulativeCost || call.cost)}</strong>
          </div>
          <div>
            <span style="color:var(--text-3)">Cache Reads:</span> <strong style="color:#10b981">${fmtTokens(call.cacheReads)}</strong>
          </div>
          <div>
            <span style="color:var(--text-3)">Cache Writes:</span> <strong style="color:#f59e0b">${fmtTokens(call.cacheWrites)}</strong>
          </div>
          ${(call.scratchOffloadedBytes || 0) > 0 ? `<div style="grid-column:span 2;color:#e879f9;font-weight:bold"><span style="color:var(--text-3)">⚡ Scratch Offload:</span> ${fmtBytes(call.scratchOffloadedBytes)}</div>` : ''}
        </div>
        ${call.modelId ? `<div style="font-size:9.5px;color:var(--text-3);margin-top:6px;font-family:monospace">🤖 ${escHtml(call.modelId)}</div>` : ''}
      </div>
    `;
  }).join('');
}

function renderCacheObservabilityPanel(body, calls) {
  if (!body) return;

  const serverPricing = analyticsData?.modelPricing;
  let pricing = {
    name: 'Claude 3.5/3.7 Sonnet',
    uncached: 3.00,
    cacheRead: 0.30,
    cacheWrite: 3.75,
    discount: '90%',
    source: 'Default Rates',
  };

  if (serverPricing) {
    const u = serverPricing.inputPrice != null ? serverPricing.inputPrice : 3.00;
    const cr = serverPricing.cacheReadsPrice != null ? serverPricing.cacheReadsPrice : u * 0.1;
    const cw = serverPricing.cacheWritesPrice != null ? serverPricing.cacheWritesPrice : u * 1.25;
    const disc = u > 0 ? (((u - cr) / u) * 100).toFixed(0) + '%' : '90%';

    pricing = {
      name: serverPricing.modelKey || 'OpenRouter Model',
      uncached: u,
      cacheRead: cr,
      cacheWrite: cw,
      discount: disc,
      source: 'IDE Cache (openrouter_models.json)',
    };
  }

  const modelBadge = document.getElementById('pa-cache-model-badge');
  if (modelBadge) {
    modelBadge.innerHTML = `
      <span style="font-size:10.5px;background:rgba(56,189,248,0.12);color:#38bdf8;padding:3px 10px;border-radius:12px;border:1px solid rgba(56,189,248,0.3);font-weight:600" title="Model pricing loaded dynamically from ${escHtml(pricing.source)}">
        🏷️ Pricing Rates: <strong>${escHtml(pricing.name)}</strong> (Uncached: $${pricing.uncached.toFixed(2)}/1M | Cache Read: $${pricing.cacheRead.toFixed(3)}/1M [${pricing.discount} Off] | Cache Write: $${pricing.cacheWrite.toFixed(3)}/1M)
      </span>
    `;
  }

  const totalReads = calls.reduce((s, c) => s + c.cacheReads, 0);
  const totalWrites = calls.reduce((s, c) => s + c.cacheWrites, 0);
  const totalTokensIn = calls.reduce((s, c) => s + c.tokensIn, 0);
  const totalTokensOut = calls.reduce((s, c) => s + c.tokensOut, 0);

  const costWithoutCache = ((totalReads + totalTokensIn) / 1000000.0) * pricing.uncached + (totalTokensOut / 1000000.0) * 15.00;
  const costWithCache = (totalTokensIn / 1000000.0) * pricing.uncached + (totalReads / 1000000.0) * pricing.cacheRead + (totalWrites / 1000000.0) * pricing.cacheWrite + (totalTokensOut / 1000000.0) * 15.00;
  const costSaved = Math.max(0, costWithoutCache - costWithCache);
  const percentSaved = costWithoutCache > 0 ? ((costSaved / costWithoutCache) * 100).toFixed(1) : '0.0';

  const cacheHitsCount = calls.filter(c => c.cacheReads > 0).length;
  const hitRate = calls.length > 0 ? ((cacheHitsCount / calls.length) * 100).toFixed(1) : '0.0';
  const systemPromptNote = analyticsData?.systemPromptNote;

  body.innerHTML = `
    ${systemPromptNote ? `
      <div style="background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.25);border-radius:var(--radius-sm);padding:8px 14px;margin-bottom:14px;font-size:10.5px;color:var(--text-3);display:flex;align-items:flex-start;gap:8px">
        <span style="font-size:13px">📄</span>
        <span><strong style="color:var(--text-2)">Note:</strong> ${escHtml(systemPromptNote)}</span>
      </div>
    ` : ''}
    <!-- Top Executive Cache Metrics Grid -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:12px;margin-bottom:16px">
      <div style="background:var(--bg-3);padding:14px;border-radius:var(--radius-sm);border:1px solid var(--border);border-left:4px solid var(--green)">
        <div style="font-size:10.5px;color:var(--text-3);font-weight:bold;text-transform:uppercase">💰 Financial Cost Saved</div>
        <div class="mono" style="font-size:20px;font-weight:bold;color:var(--green);margin:4px 0">$${costSaved.toFixed(2)}</div>
        <div style="font-size:10.5px;color:var(--green);font-weight:bold">${percentSaved}% total token cost discount</div>
      </div>

      <div style="background:var(--bg-3);padding:14px;border-radius:var(--radius-sm);border:1px solid var(--border);border-left:4px solid #38bdf8">
        <div style="font-size:10.5px;color:var(--text-3);font-weight:bold;text-transform:uppercase">🎯 Cache Hit Rate</div>
        <div class="mono" style="font-size:20px;font-weight:bold;color:#38bdf8;margin:4px 0">${hitRate}%</div>
        <div style="font-size:10.5px;color:var(--text-3)">${cacheHitsCount} of ${calls.length} requests hit KV cache</div>
      </div>

      <div style="background:var(--bg-3);padding:14px;border-radius:var(--radius-sm);border:1px solid var(--border);border-left:4px solid var(--green)">
        <div style="font-size:10.5px;color:var(--text-3);font-weight:bold;text-transform:uppercase">📖 Total Cache Reads</div>
        <div class="mono" style="font-size:20px;font-weight:bold;color:var(--green);margin:4px 0">${fmtTokens(totalReads)}</div>
        <div style="font-size:10.5px;color:var(--text-3)">Served at ${pricing.discount} price discount ($${pricing.cacheRead.toFixed(2)}/1M)</div>
      </div>

      <div style="background:var(--bg-3);padding:14px;border-radius:var(--radius-sm);border:1px solid var(--border);border-left:4px solid #f59e0b">
        <div style="font-size:10.5px;color:var(--text-3);font-weight:bold;text-transform:uppercase">✍️ Total Cache Writes</div>
        <div class="mono" style="font-size:20px;font-weight:bold;color:#f59e0b;margin:4px 0">${fmtTokens(totalWrites)}</div>
        <div style="font-size:10.5px;color:var(--text-3)">KV Cache breakpoints created</div>
      </div>
    </div>

    <!-- How Cache Read / Write Works Explainer Card -->
    <div style="background:var(--bg-2);padding:14px;border-radius:var(--radius-sm);border:1px solid var(--border);margin-bottom:16px">
      <div style="font-weight:bold;font-size:12px;color:var(--text);margin-bottom:8px">
        💡 How Model Prompt Caching Works (Model: ${escHtml(pricing.name)}):
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;font-size:11px;line-height:1.5">
        <div style="background:var(--bg-3);padding:10px 12px;border-radius:var(--radius-sm);border-left:3px solid #f59e0b">
          <strong style="color:#f59e0b;font-size:11.5px">✍️ What is Cache Write?</strong>
          <p style="color:var(--text-2);margin-top:4px">
            When you send a request to <strong>${escHtml(pricing.name)}</strong>, the model provider checks for matching prompt prefixes in memory. If new system instructions, tools, or files are added, it writes the prompt prefix into memory as a <strong>5-minute KV Cache Breakpoint</strong>.
          </p>
          <div style="color:var(--text-3);font-size:10px;margin-top:4px">
            • <strong>Rate:</strong> $${pricing.cacheWrite.toFixed(2)} / 1M tokens (initial creation charge).
          </div>
        </div>

        <div style="background:var(--bg-3);padding:10px 12px;border-radius:var(--radius-sm);border-left:3px solid var(--green)">
          <strong style="color:var(--green);font-size:11.5px">📖 What is Cache Read?</strong>
          <p style="color:var(--text-2);margin-top:4px">
            On subsequent turns, the model matches your prompt prefix against active KV memory. Instead of re-reading and re-computing tokens, it reads them directly from memory!
          </p>
          <div style="color:var(--green);font-size:10px;margin-top:4px;font-weight:bold">
            • <strong>Rate:</strong> $${pricing.cacheRead.toFixed(2)} / 1M tokens (<strong>${pricing.discount} Discount</strong> vs $${pricing.uncached.toFixed(2)} uncached).
          </div>
        </div>
      </div>
    </div>

    <!-- Per-Call Cache Breakdown Table with Expandable Git Diff -->
    <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">
      <div style="background:var(--bg-3);padding:10px 14px;font-weight:bold;font-size:11.5px;color:var(--text);border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center">
        <span>📊 Per-Request Cache Usage & Breakpoints Breakdown (${calls.length} total calls)</span>
        <span style="font-size:10.5px;color:var(--text-3);font-weight:normal">👉 Click any row to expand exact prompt and before/after comparison</span>
      </div>
      <div style="max-height:450px;overflow-y:auto">
        <table style="width:100%;border-collapse:collapse;font-size:11px;text-align:left">
          <thead style="background:var(--bg-3);color:var(--text-3);position:sticky;top:0;z-index:2">
            <tr>
              <th style="padding:8px 12px;width:30px"></th>
              <th style="padding:8px 12px">Call #</th>
              <th style="padding:8px 12px">Timestamp</th>
              <th style="padding:8px 12px">Cache Reads</th>
              <th style="padding:8px 12px">Cache Writes</th>
              <th style="padding:8px 12px">Uncached Input</th>
              <th style="padding:8px 12px">Est. Cost</th>
              <th style="padding:8px 12px">Cache Status</th>
            </tr>
          </thead>
          <tbody>
            ${calls.map(c => {
              const isHit = c.cacheReads > 0;
              const isWrite = c.cacheWrites > 0;
              let badge = '<span style="color:var(--text-3)" title="No provider-reported prompt cache reads or writes for this request">Uncached</span>';
              if (isHit && isWrite) {
                badge = `<span style="background:rgba(34,197,94,0.15);color:var(--green);padding:2px 8px;border-radius:10px;font-weight:bold;font-size:10px" title="${fmtTokens(c.cacheReads)} input tokens were read from a matching cached prompt prefix at the cache-read rate; ${fmtTokens(c.cacheWrites)} tokens were also written as a new cache breakpoint for future requests.">🎯 Cache Read + Write</span>`;
              } else if (isHit) {
                badge = `<span style="background:rgba(34,197,94,0.15);color:var(--green);padding:2px 8px;border-radius:10px;font-weight:bold;font-size:10px" title="${fmtTokens(c.cacheReads)} input tokens were read from a matching cached prompt prefix at the cache-read rate, which is ${pricing.discount} cheaper than uncached input for this model.">🎯 Cache Read (${pricing.discount} cheaper)</span>`;
              } else if (isWrite) {
                badge = '<span style="background:rgba(245,158,11,0.15);color:#f59e0b;padding:2px 8px;border-radius:10px;font-weight:bold;font-size:10px" title="The provider wrote prompt-prefix tokens into its prompt cache so later requests can reuse them if the prefix matches.">✍️ Cache Write</span>';
              }

              return `
                <tr class="pa-cache-row" data-call-idx="${c.index}" style="border-bottom:1px solid var(--border);background:var(--bg-2);cursor:pointer">
                  <td style="padding:8px 12px;color:var(--text-3);font-size:10px">▶</td>
                  <td style="padding:8px 12px;font-weight:bold">Call #${c.index + 1}</td>
                  <td style="padding:8px 12px;color:var(--text-3)">${fmtTime(c.ts)}</td>
                  <td class="mono" style="padding:8px 12px;color:${isHit ? 'var(--green)' : 'var(--text-3)'};font-weight:${isHit ? 'bold' : 'normal'}">${fmtTokens(c.cacheReads)}</td>
                  <td class="mono" style="padding:8px 12px;color:${isWrite ? '#f59e0b' : 'var(--text-3)'}">${fmtTokens(c.cacheWrites)}</td>
                  <td class="mono" style="padding:8px 12px;color:var(--text-2)">${fmtTokens(c.tokensIn)}</td>
                  <td class="mono" style="padding:8px 12px;color:var(--text-2)">${fmtCost(c.cost)}</td>
                  <td style="padding:8px 12px">${badge}</td>
                </tr>
                <tr id="pa-cache-expand-${c.index}" style="display:none;background:var(--bg-1)">
                  <td colspan="8" style="padding:12px;border-bottom:1px solid var(--border)">
                    <div class="pa-cache-expand-content" data-loaded="false">
                      <div class="loading-state" style="padding:10px"><div class="spinner"></div><p>Loading prompt diff comparison for Call #${c.index + 1}...</p></div>
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;

  bindCacheTableEvents(calls);
}

function bindCacheTableEvents(calls) {
  document.querySelectorAll('.pa-cache-row').forEach(row => {
    row.addEventListener('click', async () => {
      const idx = parseInt(row.dataset.callIdx);
      const call = calls[idx];
      const expandTr = document.getElementById(`pa-cache-expand-${idx}`);
      if (!expandTr) return;

      const isExpanded = expandTr.style.display !== 'none';
      expandTr.style.display = isExpanded ? 'none' : 'table-row';
      row.querySelector('td').innerText = isExpanded ? '▶' : '▼';

      if (!isExpanded) {
        const contentContainer = expandTr.querySelector('.pa-cache-expand-content');
        if (contentContainer && contentContainer.dataset.loaded === 'false') {
          contentContainer.dataset.loaded = 'true';
          const prevIdx = idx - 1;

          try {
            if (idx === 0) {
              const promptData = await api.promptRequest(currentTaskId, idx);
              contentContainer.innerHTML =
                renderSystemPromptSection(promptData?.systemPrompt) +
                renderCacheExplanationBanner(call?.cacheExplanation) +
                renderInitialPromptDiffMarkup(promptData, idx);
            } else {
              const comp = await api.promptCompare(currentTaskId, prevIdx, idx, 'full');
              contentContainer.innerHTML =
                renderSystemPromptSection(comp?.systemPrompt2 || comp?.systemPrompt1) +
                renderCacheExplanationBanner(call?.cacheExplanation) +
                renderChangeAnnotationsBanner(comp?.annotations, prevIdx, idx) +
                renderSideBySidePromptDiffMarkup(comp, prevIdx, idx);
              bindSynchronizedScroll(contentContainer);
            }
          } catch (e) {
            contentContainer.innerHTML = renderPromptDetailsError('Prompt diff', e);
          }
        }
      }
    });
  });
}

function renderPromptDetailsError(label, error) {
  return `
    <div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);color:var(--red);padding:10px 14px;border-radius:var(--radius-sm);font-size:11px;margin-bottom:10px">
      ${escHtml(label)} unavailable: ${escHtml(error?.message || 'Unknown error')}
    </div>
  `;
}

function renderInitialPromptDiffMarkup(promptData, idx) {
  const prompt = promptData?.prompt || {};
  const rows = buildAddedFileDiffRows(prompt.text || '');
  return renderUnifiedDiffPanel({
    title: `Prompt for Call #${idx + 1}`,
    subtitle: 'Initial request prompt',
    beforeLabel: '/dev/null',
    afterLabel: `call-${idx + 1}-prompt`,
    beforeSize: 0,
    afterSize: prompt.requestSize || promptData?.call?.requestSize || 0,
    rows,
  });
}

function buildSideBySideDiffRows(beforeText, afterText) {
  const beforeLines = splitPromptLines(beforeText);
  const afterLines = splitPromptLines(afterText);

  if (beforeText === afterText) {
    return [{ type: 'note', text: 'No prompt text changed between these two calls.' }];
  }

  let prefixLen = 0;
  const maxPrefix = Math.min(beforeLines.length, afterLines.length);
  while (prefixLen < maxPrefix && beforeLines[prefixLen] === afterLines[prefixLen]) prefixLen++;

  let suffixLen = 0;
  const maxSuffix = Math.min(beforeLines.length - prefixLen, afterLines.length - prefixLen);
  while (
    suffixLen < maxSuffix &&
    beforeLines[beforeLines.length - 1 - suffixLen] === afterLines[afterLines.length - 1 - suffixLen]
  ) suffixLen++;

  const context = 8;
  const beforeChangeEnd = beforeLines.length - suffixLen;
  const afterChangeEnd = afterLines.length - suffixLen;
  const contextStart = Math.max(0, prefixLen - context);
  const suffixVisible = Math.min(context, suffixLen);

  const rows = [];

  if (contextStart > 0) rows.push({ type: 'skip', text: `... ${contextStart} unchanged lines hidden ...` });

  for (let i = contextStart; i < prefixLen; i++) {
    rows.push({ type: 'ctx', leftLine: i + 1, leftText: beforeLines[i], rightLine: i + 1, rightText: afterLines[i] });
  }

  const removedCount = beforeChangeEnd - prefixLen;
  const addedCount = afterChangeEnd - prefixLen;
  const maxCount = Math.max(removedCount, addedCount);

  for (let j = 0; j < maxCount; j++) {
    const leftIdx = j < removedCount ? prefixLen + j : null;
    const rightIdx = j < addedCount ? prefixLen + j : null;
    rows.push({
      type: 'change',
      leftLine: leftIdx != null ? leftIdx + 1 : '',
      leftText: leftIdx != null ? beforeLines[leftIdx] : null,
      rightLine: rightIdx != null ? rightIdx + 1 : '',
      rightText: rightIdx != null ? afterLines[rightIdx] : null,
    });
  }

  const suffixBeforeStart = beforeChangeEnd;
  const suffixAfterStart = afterChangeEnd;
  for (let i = 0; i < suffixVisible; i++) {
    rows.push({
      type: 'ctx',
      leftLine: suffixBeforeStart + i + 1,
      leftText: beforeLines[suffixBeforeStart + i],
      rightLine: suffixAfterStart + i + 1,
      rightText: afterLines[suffixAfterStart + i],
    });
  }

  if (suffixLen > suffixVisible) rows.push({ type: 'skip', text: `... ${suffixLen - suffixVisible} unchanged lines hidden ...` });

  return rows;
}

function renderSideBySideDiffRow(row) {
  if (row.type === 'note' || row.type === 'skip') {
    return `<div style="grid-column:1 / -1;color:var(--text-3);background:var(--bg-3);padding:3px 10px;font-style:italic">${escHtml(row.text)}</div>`;
  }

  const leftPresent = row.leftText != null;
  const rightPresent = row.rightText != null;
  const leftBg = row.type === 'change' && leftPresent ? 'rgba(239,68,68,0.12)' : 'transparent';
  const rightBg = row.type === 'change' && rightPresent ? 'rgba(34,197,94,0.12)' : 'transparent';
  const leftColor = row.type === 'change' && leftPresent ? 'var(--red)' : 'var(--text-2)';
  const rightColor = row.type === 'change' && rightPresent ? 'var(--green)' : 'var(--text-2)';

  return `
    <div style="display:grid;grid-template-columns:44px 1fr;gap:6px;background:${leftBg};color:${leftColor};padding:1px 8px;white-space:pre-wrap;word-break:break-word;border-right:1px solid var(--border)">
      <span style="color:var(--text-3);text-align:right;user-select:none">${leftPresent ? row.leftLine : ''}</span>
      <span>${leftPresent ? escHtml(row.leftText) : ''}</span>
    </div>
    <div style="display:grid;grid-template-columns:44px 1fr;gap:6px;background:${rightBg};color:${rightColor};padding:1px 8px;white-space:pre-wrap;word-break:break-word">
      <span style="color:var(--text-3);text-align:right;user-select:none">${rightPresent ? row.rightLine : ''}</span>
      <span>${rightPresent ? escHtml(row.rightText) : ''}</span>
    </div>
  `;
}

function renderSideBySidePromptDiffMarkup(comp, prevIdx, idx) {
  const beforeText = comp?.prompt1?.text || '';
  const afterText = comp?.prompt2?.text || '';
  const beforeSize = comp?.prompt1?.requestSize || comp?.call1?.requestSize || 0;
  const afterSize = comp?.prompt2?.requestSize || comp?.call2?.requestSize || 0;
  const delta = afterSize - beforeSize;
  const deltaText = delta >= 0 ? `+${fmtBytes(delta)}` : `-${fmtBytes(Math.abs(delta))}`;
  const deltaColor = delta >= 0 ? '#f59e0b' : 'var(--green)';

  const rows = buildSideBySideDiffRows(beforeText, afterText);

  return `
    <div class="pa-git-diff-card" style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;background:var(--bg-2)">
      <div class="pa-git-diff-header" style="background:var(--bg-3);padding:10px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <div style="font-weight:bold;font-size:12px;color:var(--text)">Prompt Diff: Call #${prevIdx + 1} → Call #${idx + 1}</div>
          <div style="font-size:10.5px;color:var(--text-3);margin-top:2px">${comp?.call1?.messageCount || 0} messages → ${comp?.call2?.messageCount || 0} messages</div>
        </div>
        <div class="mono" style="font-size:11px;color:${deltaColor};font-weight:bold">
          ${fmtBytes(beforeSize)} → ${fmtBytes(afterSize)} (${deltaText})
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;background:var(--bg-1);border-bottom:1px solid var(--border);font-size:10.5px;color:var(--text-3)">
        <div class="mono" style="padding:8px 14px;color:var(--red);border-right:1px solid var(--border)">🔴 call-${prevIdx + 1}-prompt (Before)</div>
        <div class="mono" style="padding:8px 14px;color:var(--green)">🟢 call-${idx + 1}-prompt (After)</div>
      </div>
      <div class="pa-git-diff-content mono" style="max-height:560px;overflow:auto;background:var(--bg-1);font-size:10.5px;line-height:1.45;display:grid;grid-template-columns:1fr 1fr">
        ${rows.map(renderSideBySideDiffRow).join('')}
      </div>
    </div>
  `;
}

function renderSystemPromptSection(systemPrompt) {
  if (systemPrompt && systemPrompt.text) {
    return `
      <details style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);margin-bottom:10px">
        <summary style="cursor:pointer;padding:8px 14px;font-size:11.5px;font-weight:bold;color:var(--text);display:flex;align-items:center;gap:8px">
          <span>🛰️</span> System Prompt (captured live via Network Inspector proxy)
          <span style="font-size:10px;color:var(--text-3);font-weight:normal">— not persisted to disk; only available while the proxy was capturing traffic</span>
        </summary>
        <div class="mono" style="font-size:10.5px;line-height:1.45;color:var(--text-2);background:var(--bg-1);padding:10px 14px;max-height:260px;overflow:auto;white-space:pre-wrap;word-break:break-word;border-top:1px solid var(--border)">${escHtml(systemPrompt.text)}</div>
      </details>
    `;
  }

  return `
    <div style="background:rgba(148,163,184,0.08);border:1px solid rgba(148,163,184,0.25);border-radius:var(--radius-sm);padding:8px 14px;margin-bottom:10px;font-size:10.5px;color:var(--text-3);display:flex;align-items:flex-start;gap:8px">
      <span style="font-size:13px">📄</span>
      <span><strong style="color:var(--text-2)">System prompt not shown:</strong> it's generated in-memory by the extension and never persisted to any task file. It's only recoverable live via the Network Inspector proxy.</span>
    </div>
  `;
}

function renderCacheExplanationBanner(explanation) {
  if (!explanation) return '';
  const iconMap = {
    first_call: '🆕',
    model_changed: '🔀',
    idle_wait_ttl: '⏳',
    ttl_expired_unconfirmed: '❓',
    prefix_invalidated: '✂️',
    prefix_extended: '➕',
    partial_hit: '🎯',
    full_hit: '✅',
    no_cache_activity: 'ℹ️',
  };
  const icon = iconMap[explanation.code] || 'ℹ️';
  const isUnconfirmed = explanation.code === 'ttl_expired_unconfirmed';
  const accent = isUnconfirmed ? '#f59e0b' : '#38bdf8';
  const bg = isUnconfirmed ? 'rgba(245,158,11,0.08)' : 'rgba(56,189,248,0.08)';
  const border = isUnconfirmed ? 'rgba(245,158,11,0.3)' : 'rgba(56,189,248,0.3)';
  const label = isUnconfirmed ? 'Possible cache behavior (unconfirmed):' : 'Why this cache behavior?';

  return `
    <div style="background:${bg};border:1px solid ${border};border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:10px;font-size:11.5px;color:var(--text);display:flex;align-items:flex-start;gap:8px">
      <span style="font-size:14px">${icon}</span>
      <span><strong style="color:${accent}">${label}</strong> ${escHtml(explanation.text)}</span>
    </div>
  `;
}

function renderChangeAnnotationsBanner(annotations, prevIdx, idx) {
  if (!annotations) return '';
  const { modelChanged, fromModelId, toModelId, possibleContextCondensation, sizeDropPct } = annotations;

  if (!modelChanged && !possibleContextCondensation) return '';

  const items = [];
  if (modelChanged) {
    items.push(`
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:14px">🔀</span>
        <span><strong style="color:#f59e0b">Model changed</strong> between Call #${prevIdx + 1} and Call #${idx + 1}:
          <span class="mono" style="color:var(--red)">${escHtml(fromModelId || 'unknown')}</span> →
          <span class="mono" style="color:var(--green)">${escHtml(toModelId || 'unknown')}</span>
        </span>
      </div>
    `);
  }
  if (possibleContextCondensation) {
    items.push(`
      <div style="display:flex;align-items:center;gap:8px">
        <span style="font-size:14px">🧹</span>
        <span><strong style="color:#f59e0b">Likely context condensation/reset</strong> detected — request size dropped by
          <strong>${sizeDropPct}%</strong>.
        </span>
      </div>
    `);
  }

  return `
    <div style="background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);border-radius:var(--radius-sm);padding:10px 14px;margin-bottom:10px;font-size:11.5px;color:var(--text);display:flex;flex-direction:column;gap:6px">
      ${items.join('')}
    </div>
  `;
}

function buildAddedFileDiffRows(text) {
  const lines = splitPromptLines(text);
  return [
    { type: 'file', text: '--- /dev/null' },
    { type: 'file', text: '+++ prompt' },
    ...lines.map((line, i) => ({ type: 'add', oldLine: '', newLine: i + 1, text: line })),
  ];
}

function splitPromptLines(text) {
  if (!text) return [''];
  return String(text).split('\n');
}

function renderUnifiedDiffPanel({ title, subtitle, beforeLabel, afterLabel, beforeSize, afterSize, rows }) {
  const delta = afterSize - beforeSize;
  const deltaText = delta >= 0 ? `+${fmtBytes(delta)}` : `-${fmtBytes(Math.abs(delta))}`;
  const deltaColor = delta >= 0 ? '#f59e0b' : 'var(--green)';

  return `
    <div class="pa-git-diff-card" style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;background:var(--bg-2)">
      <div class="pa-git-diff-header" style="background:var(--bg-3);padding:10px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <div style="font-weight:bold;font-size:12px;color:var(--text)">${escHtml(title)}</div>
          <div style="font-size:10.5px;color:var(--text-3);margin-top:2px">${escHtml(subtitle)}</div>
        </div>
        <div class="mono" style="font-size:11px;color:${deltaColor};font-weight:bold">
          ${fmtBytes(beforeSize)} → ${fmtBytes(afterSize)} (${deltaText})
        </div>
      </div>
      <div style="background:var(--bg-1);border-bottom:1px solid var(--border);padding:8px 14px;font-size:10.5px;color:var(--text-3)">
        <span class="mono" style="color:var(--red)">--- ${escHtml(beforeLabel)}</span>
        <span class="mono" style="color:var(--green);margin-left:14px">+++ ${escHtml(afterLabel)}</span>
      </div>
      <div class="pa-git-diff-content mono" style="max-height:560px;overflow:auto;background:var(--bg-1);font-size:10.5px;line-height:1.45">
        ${rows.map(renderUnifiedDiffRow).join('')}
      </div>
    </div>
  `;
}

function renderUnifiedDiffRow(row) {
  if (row.type === 'file') {
    const color = row.text.startsWith('---') ? 'var(--red)' : 'var(--green)';
    return `<div style="display:flex;color:${color};background:var(--bg-3);padding:2px 10px">${escHtml(row.text)}</div>`;
  }

  if (row.type === 'skip' || row.type === 'note') {
    return `<div style="display:flex;color:var(--text-3);background:var(--bg-3);padding:3px 10px;font-style:italic">${escHtml(row.text)}</div>`;
  }

  const mark = row.type === 'add' ? '+' : (row.type === 'del' ? '-' : ' ');
  const bg = row.type === 'add' ? 'rgba(34,197,94,0.12)' : (row.type === 'del' ? 'rgba(239,68,68,0.12)' : 'transparent');
  const color = row.type === 'add' ? 'var(--green)' : (row.type === 'del' ? 'var(--red)' : 'var(--text-2)');

  return `
    <div class="pa-diff-line" style="display:grid;grid-template-columns:52px 52px 18px 1fr;gap:8px;background:${bg};color:${color};padding:1px 10px;white-space:pre-wrap;word-break:break-word">
      <span style="color:var(--text-3);text-align:right;user-select:none">${row.oldLine || ''}</span>
      <span style="color:var(--text-3);text-align:right;user-select:none">${row.newLine || ''}</span>
      <span style="font-weight:bold;user-select:none">${mark}</span>
      <span>${escHtml(row.text)}</span>
    </div>
  `;
}

function filterReductionEvents(events, category, searchQuery = '') {
  if (!events || !Array.isArray(events)) return [];
  let res = events;

  if (category === 'SYSTEM') {
    res = res.filter(e => e.isSystemPrompt || e.category.includes('System'));
  } else if (category === 'FILE_READ') {
    res = res.filter(e => e.toolName === 'read_file' || (e.category === 'File Read Truncated' && !e.isScratch));
  } else if (category === 'FILE_EDIT') {
    res = res.filter(e => e.toolName === 'replace_in_file' || e.category === 'File Edit Output Truncated');
  } else if (category === 'FILE_ALL') {
    res = res.filter(e => e.toolName === 'read_file' || e.toolName === 'replace_in_file' || e.category.includes('File') || (e.targetName && e.targetName.includes('.')));
  } else if (category === 'BROWSER') {
    res = res.filter(e => e.toolName === 'postqode_browser_agent' || e.category.includes('Browser'));
  } else if (category === 'COMMAND' || category === 'CMD') {
    res = res.filter(e => e.toolName === 'execute_command' || e.category.includes('Terminal'));
  } else if (category === 'SKILL') {
    res = res.filter(e => e.toolName === 'use_skill' || e.category.includes('Skill'));
  } else if (category === 'ENV') {
    res = res.filter(e => e.category === 'Stale Environment Snapshot Removed');
  } else if (category === 'SCRATCH') {
    res = res.filter(e => e.isScratch || e.scratchFilename || (e.category && e.category.includes('Scratch')));
  }

  if (searchQuery && searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    res = res.filter(e => {
      return (e.targetName && e.targetName.toLowerCase().includes(q)) ||
             (e.scratchFilename && e.scratchFilename.toLowerCase().includes(q)) ||
             (e.toolName && e.toolName.toLowerCase().includes(q)) ||
             (e.category && e.category.toLowerCase().includes(q));
    });
  }

  return res;
}

function renderReductionSequenceFeed(body, events) {
  if (!body) return;
  const allEvents = events || [];

  // If focused on a specific call, filter to events belonging to that turn
  const callScopeEvents = activeCallFocusIndex !== null
    ? allEvents.filter(e => e.callIndex === activeCallFocusIndex)
    : allEvents;

  const queryFiltered = reductionSearchQuery ? callScopeEvents.filter(e => {
    const q = reductionSearchQuery.trim().toLowerCase();
    return (e.targetName && e.targetName.toLowerCase().includes(q)) ||
           (e.scratchFilename && e.scratchFilename.toLowerCase().includes(q)) ||
           (e.toolName && e.toolName.toLowerCase().includes(q)) ||
           (e.category && e.category.toLowerCase().includes(q));
  }) : callScopeEvents;

  let filteredEvents = filterReductionEvents(queryFiltered, activeCategoryFilter);

  // If active filter yields 0 events but queryFiltered has items, fallback to ALL
  if (filteredEvents.length === 0 && queryFiltered.length > 0 && activeCategoryFilter !== 'ALL') {
    activeCategoryFilter = 'ALL';
    filteredEvents = queryFiltered;
  }

  // Render Granular Category Filter Pills
  const countAll = queryFiltered.length;
  const countSys = filterReductionEvents(queryFiltered, 'SYSTEM').length;
  const countReads = filterReductionEvents(queryFiltered, 'FILE_READ').length;
  const countEdits = filterReductionEvents(queryFiltered, 'FILE_EDIT').length;
  const countBrowser = filterReductionEvents(queryFiltered, 'BROWSER').length;
  const countCmds = filterReductionEvents(queryFiltered, 'COMMAND').length;
  const countSkills = filterReductionEvents(queryFiltered, 'SKILL').length;
  const countEnv = filterReductionEvents(queryFiltered, 'ENV').length;
  const countScratch = filterReductionEvents(queryFiltered, 'SCRATCH').length;

  const filterBar = document.getElementById('pa-cat-filters-bar');
  if (filterBar) {
    const pills = [
      { cat: 'ALL', label: `All (${countAll})` },
      countSys > 0 ? { cat: 'SYSTEM', label: `🛡️ System (${countSys})` } : null,
      countReads > 0 ? { cat: 'FILE_READ', label: `📁 Reads (${countReads})` } : null,
      countEdits > 0 ? { cat: 'FILE_EDIT', label: `📝 Edits (${countEdits})` } : null,
      countBrowser > 0 ? { cat: 'BROWSER', label: `🌐 Browser (${countBrowser})` } : null,
      countCmds > 0 ? { cat: 'COMMAND', label: `💻 Cmds (${countCmds})` } : null,
      countSkills > 0 ? { cat: 'SKILL', label: `⚡ Skills (${countSkills})` } : null,
      countEnv > 0 ? { cat: 'ENV', label: `🌲 Env (${countEnv})` } : null,
      countScratch > 0 ? { cat: 'SCRATCH', label: `⚡ Scratch (${countScratch})` } : null,
    ].filter(Boolean);

    filterBar.innerHTML = pills.map(p => {
      const isActive = activeCategoryFilter === p.cat;
      const activeStyle = isActive
        ? 'background:#0284c7 !important;color:#ffffff !important;border:1px solid #38bdf8 !important;font-weight:bold !important;box-shadow:0 0 10px rgba(56,189,248,0.5) !important;'
        : 'background:var(--bg-2);color:var(--text-2);border:1px solid var(--border);';
      return `
        <button class="action-btn secondary pa-cat-filter ${isActive ? 'active' : ''}" data-cat="${p.cat}" style="padding:3px 9px;font-size:10.5px;cursor:pointer;border-radius:12px;transition:all 0.15s;${activeStyle}">
          ${p.label}
        </button>
      `;
    }).join('');

    filterBar.querySelectorAll('.pa-cat-filter').forEach(btn => {
      btn.onclick = () => {
        activeCategoryFilter = btn.dataset.cat;
        reductionFeedLimit = 30;
        renderReductionSequenceFeed(body, allEvents);
      };
    });
  }

  // Update Total counter
  const totalCntEl = document.getElementById('pa-seq-total-count');
  if (totalCntEl) totalCntEl.innerText = allEvents.length;

  // Render Search input and mode button handlers
  const searchInput = document.getElementById('pa-seq-search-input');
  if (searchInput && !searchInput._hasBound) {
    searchInput._hasBound = true;
    searchInput.addEventListener('input', (e) => {
      reductionSearchQuery = e.target.value;
      reductionFeedLimit = 30;
      renderReductionSequenceFeed(body, allEvents);
    });
  }
  const clearBtn = document.getElementById('pa-seq-search-clear');
  if (clearBtn) {
    clearBtn.onclick = () => {
      reductionSearchQuery = '';
      if (searchInput) searchInput.value = '';
      renderReductionSequenceFeed(body, allEvents);
    };
  }

  const callFocusBanner = activeCallFocusIndex !== null ? `
    <div class="pa-call-focus-banner" style="background:linear-gradient(90deg, rgba(16,185,129,0.18), rgba(56,189,248,0.18));border:1px solid #10b981;border-radius:6px;padding:10px 14px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 0 16px rgba(16,185,129,0.25)">
      <div style="display:flex;align-items:center;gap:10px">
        <span style="font-size:16px">🎯</span>
        <div>
          <div style="font-size:12.5px;font-weight:bold;color:#ffffff">
            Inspecting API Call #${activeCallFocusIndex + 1}
            <span style="font-size:11px;font-weight:normal;color:#38bdf8;margin-left:8px">(${filteredEvents.length} reduction event${filteredEvents.length === 1 ? '' : 's'} on this turn)</span>
          </div>
          <div style="font-size:10.5px;color:var(--text-2);margin-top:2px">
            Showing all files and diffs for Call #${activeCallFocusIndex + 1}. All cards are expanded below.
          </div>
        </div>
      </div>
      <button id="pa-clear-call-focus-btn" class="action-btn" style="background:#0284c7;color:#fff;border:1px solid #38bdf8;padding:4px 12px;font-size:11px;cursor:pointer;font-weight:bold;border-radius:4px;white-space:nowrap">
        ✖ Show All Calls
      </button>
    </div>
  ` : '';

  document.querySelectorAll('.pa-viewmode-btn').forEach(btn => {
    btn.onclick = () => {
      reductionViewMode = btn.dataset.mode;
      document.querySelectorAll('.pa-viewmode-btn').forEach(b => b.classList.toggle('primary', b === btn));
      document.querySelectorAll('.pa-viewmode-btn').forEach(b => b.classList.toggle('secondary', b !== btn));
      renderReductionSequenceFeed(body, allEvents);
    };
  });

  if (filteredEvents.length === 0) {
    body.innerHTML = `
      ${callFocusBanner}
      <div class="empty-state" style="padding:24px;text-align:center">
        <p style="color:var(--text-3);font-size:12px">No reduction events on this turn or matching the search query.</p>
        ${activeCallFocusIndex !== null ? `<button id="pa-clear-call-focus-empty-btn" class="action-btn primary" style="padding:4px 12px;font-size:11px;margin-top:10px;cursor:pointer">✖ Show All Calls</button>` : ''}
      </div>
    `;
    const clearBtn = document.getElementById('pa-clear-call-focus-empty-btn') || document.getElementById('pa-clear-call-focus-btn');
    if (clearBtn) {
      clearBtn.onclick = () => {
        activeCallFocusIndex = null;
        renderReductionSequenceFeed(body, allEvents);
        if (typeof redrawTargetCanvas === 'function' && typeof analyticsData !== 'undefined') redrawTargetCanvas(document.getElementById('pa-target-chart'), analyticsData.apiCalls);
      };
    }
    return;
  }

  if (reductionViewMode === 'explorer') {
    // ── TWO-PANE SPLIT EXPLORER VIEW ──
    body.innerHTML = callFocusBanner + renderSplitExplorerView(filteredEvents);
    bindExplorerViewEvents(body, filteredEvents, allEvents);
  } else if (reductionViewMode === 'matrix') {
    // ── FILE IMPACT MATRIX VIEW ──
    body.innerHTML = callFocusBanner + renderFileImpactMatrixView(filteredEvents);
    bindMatrixViewEvents(body);
  } else if (reductionViewMode === 'grouped') {
    // ── GROUPED BY FILE / TARGET VIEW ──
    const groups = {};
    filteredEvents.forEach(e => {
      const key = e.targetName || e.toolName || 'Unknown';
      if (!groups[key]) {
        groups[key] = {
          target: key,
          events: [],
          totalSaved: 0,
          cumulativeCost: 0,
          toolName: e.toolName,
          category: e.category,
          isScratch: e.isScratch,
        };
      }
      groups[key].events.push(e);
      groups[key].totalSaved += (e.bytesSaved || 0);
    });

    const sortedGroups = Object.values(groups).sort((a, b) => b.totalSaved - a.totalSaved || b.events.length - a.events.length);

    body.innerHTML = `
      ${callFocusBanner}
      <div style="font-size:11px;color:var(--text-3);margin-bottom:12px;padding:0 4px;display:flex;justify-content:space-between;align-items:center">
        <span>Grouped into <strong>${sortedGroups.length}</strong> unique targets (${filteredEvents.length} total events):</span>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px">
        ${sortedGroups.map((g, gIdx) => {
          let gIcon = '📁';
          if (g.toolName === 'execute_command' || g.category.includes('Terminal')) gIcon = '💻';
          else if (g.toolName === 'postqode_browser_agent' || g.category.includes('Browser')) gIcon = '🌐';
          else if (g.toolName === 'use_skill' || g.category.includes('Skill')) gIcon = '⚡';
          else if (g.toolName === 'replace_in_file') gIcon = '📝';
          else if (g.category === 'Stale Environment Snapshot Removed') gIcon = '🌲';

          return `
            <div class="panel pa-grouped-target-card" style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">
              <div class="pa-grouped-header" data-gidx="${gIdx}" style="background:var(--bg-3);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;cursor:pointer;user-select:none">
                <div style="display:flex;align-items:center;gap:8px;overflow:hidden">
                  <span style="font-size:14px">${gIcon}</span>
                  <strong class="mono" style="color:var(--text);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:550px" title="${escHtml(g.target)}">${escHtml(g.target)}</strong>
                  <span style="background:rgba(56,189,248,0.15);color:#38bdf8;padding:2px 8px;border-radius:10px;font-size:10px;font-weight:bold;white-space:nowrap">${g.events.length} event${g.events.length > 1 ? 's' : ''}</span>
                </div>
                <div style="display:flex;align-items:center;gap:12px">
                  <span class="mono" style="color:var(--green);font-weight:bold;font-size:11.5px">-${fmtBytes(g.totalSaved)} saved</span>
                  <button class="action-btn secondary pa-toggle-group-btn" data-gidx="${gIdx}" style="padding:2px 8px;font-size:10.5px">▼ Toggle Diffs (${g.events.length})</button>
                </div>
              </div>
              <div class="pa-grouped-body" id="pa-grouped-body-${gIdx}" style="padding:10px;display:${(activeCallFocusIndex !== null || gIdx === 0) ? 'flex' : 'none'};flex-direction:column;gap:10px;border-top:1px solid var(--border)">
                ${g.events.map(ev => renderReductionEventCard(ev, true)).join('')}
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;

    bindSynchronizedScroll(body);

    body.querySelectorAll('.pa-grouped-header, .pa-toggle-group-btn').forEach(el => {
      el.onclick = (e) => {
        e.stopPropagation();
        const gidx = el.dataset.gidx || el.closest('.pa-grouped-target-card')?.querySelector('.pa-grouped-header')?.dataset.gidx;
        const gBody = document.getElementById(`pa-grouped-body-${gidx}`);
        if (gBody) {
          const isHidden = gBody.style.display === 'none';
          gBody.style.display = isHidden ? 'flex' : 'none';
          const btn = el.closest('.pa-grouped-target-card')?.querySelector('.pa-toggle-group-btn');
          if (btn) btn.innerText = isHidden ? '▲ Hide Diffs' : `▼ Toggle Diffs`;
        }
      };
    });

  } else {
    // ── TIMELINE VIEW ──
    const isLimited = (activeCallFocusIndex === null) && (filteredEvents.length > reductionFeedLimit);
    const visibleSlice = isLimited ? filteredEvents.slice(0, reductionFeedLimit) : filteredEvents;
    const hasMore = isLimited && visibleSlice.length < filteredEvents.length;

    body.innerHTML = `
      ${callFocusBanner}
      <div style="font-size:11px;color:var(--text-3);margin-bottom:12px;padding:0 4px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
        <span>Showing <strong>${visibleSlice.length}</strong> of <strong>${filteredEvents.length}</strong> context reduction events:</span>
        <div style="display:flex;align-items:center;gap:6px">
          <button id="pa-expand-all-diffs-btn" class="action-btn secondary" style="padding:2px 8px;font-size:10px;cursor:pointer">📂 Expand All</button>
          <button id="pa-collapse-all-diffs-btn" class="action-btn secondary" style="padding:2px 8px;font-size:10px;cursor:pointer">📁 Collapse All</button>
          ${hasMore ? `<button id="pa-load-all-events-btn" class="action-btn secondary" style="padding:2px 8px;font-size:10.5px;color:#38bdf8;cursor:pointer">⚡ Load All (${filteredEvents.length})</button>` : ''}
        </div>
      </div>

      <div style="display:flex;flex-direction:column;gap:12px">
        ${visibleSlice.map((ev, idx) => renderReductionEventCard(ev, (activeCallFocusIndex !== null) || (idx < 5))).join('')}
      </div>

      ${hasMore ? `
        <div style="text-align:center;margin-top:16px;padding:12px">
          <button id="pa-load-more-events-btn" class="action-btn secondary" style="padding:6px 18px;font-size:12px;font-weight:bold;color:#38bdf8;cursor:pointer">
            ⬇ Show More Events (${filteredEvents.length - visibleSlice.length} remaining)
          </button>
        </div>
      ` : ''}
    `;

    bindSynchronizedScroll(body);

    document.getElementById('pa-expand-all-diffs-btn')?.addEventListener('click', () => {
      body.querySelectorAll('.pa-sbs-body').forEach(b => b.style.display = 'block');
      body.querySelectorAll('.pa-card-toggle-btn').forEach(btn => btn.innerText = '▲ Hide Diff');
    });

    document.getElementById('pa-collapse-all-diffs-btn')?.addEventListener('click', () => {
      body.querySelectorAll('.pa-sbs-body').forEach(b => b.style.display = 'none');
      body.querySelectorAll('.pa-card-toggle-btn').forEach(btn => btn.innerText = '▼ View Diff');
    });

    document.getElementById('pa-load-all-events-btn')?.addEventListener('click', () => {
      reductionFeedLimit = filteredEvents.length;
      renderReductionSequenceFeed(body, allEvents);
    });

    document.getElementById('pa-load-more-events-btn')?.addEventListener('click', () => {
      reductionFeedLimit += 50;
      renderReductionSequenceFeed(body, allEvents);
    });
  }

  const clearFocusBtn = document.getElementById('pa-clear-call-focus-btn');
  if (clearFocusBtn) {
    clearFocusBtn.onclick = () => {
      activeCallFocusIndex = null;
      renderReductionSequenceFeed(body, allEvents);
      if (typeof redrawTargetCanvas === 'function' && typeof analyticsData !== 'undefined') redrawTargetCanvas(document.getElementById('pa-target-chart'), analyticsData.apiCalls);
    };
  }
}

function renderSplitExplorerView(filteredEvents) {
  if (!filteredEvents || filteredEvents.length === 0) return '<div class="empty-state" style="padding:24px;text-align:center"><p style="color:var(--text-3)">No reduction events match your filter.</p></div>';
  const selectedIdx = Math.max(0, Math.min(filteredEvents.length - 1, selectedExplorerEventIndex || 0));
  const activeEv = filteredEvents[selectedIdx];

  return `
    <div class="pa-split-explorer" style="display:grid;grid-template-columns:340px 1fr;gap:12px;background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;min-height:550px">
      <!-- Left Sidebar: Event / File List -->
      <div style="background:var(--bg-3);border-right:1px solid var(--border);display:flex;flex-direction:column;max-height:720px">
        <div style="padding:10px 12px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;background:var(--bg-2)">
          <span style="font-weight:bold;font-size:11.5px;color:var(--text)">📁 Event Explorer (${filteredEvents.length})</span>
          <span style="font-size:10.5px;color:var(--text-3)">Select to inspect</span>
        </div>
        <div style="flex:1;overflow-y:auto;display:flex;flex-direction:column;gap:1px;background:var(--border)">
          ${filteredEvents.map((ev, idx) => {
            const isSelected = idx === selectedIdx;
            let icon = '📁';
            let catColor = 'var(--green)';
            if (ev.isSystemPrompt || ev.category.includes('System')) { icon = '🛡️'; catColor = '#38bdf8'; }
            else if (ev.toolName === 'execute_command' || ev.category.includes('Terminal')) { icon = '💻'; catColor = '#38bdf8'; }
            else if (ev.toolName === 'postqode_browser_agent' || ev.category.includes('Browser')) { icon = '🌐'; catColor = '#06b6d4'; }
            else if (ev.toolName === 'use_skill' || ev.category.includes('Skill')) { icon = '⚡'; catColor = '#e879f9'; }
            else if (ev.toolName === 'replace_in_file') { icon = '📝'; catColor = '#a78bfa'; }
            else if (ev.isScratch) { icon = '⚡'; catColor = '#e879f9'; }

            const savedStr = ev.bytesSaved > 0 ? `-${fmtBytes(ev.bytesSaved)}` : `${fmtBytes(ev.beforeSize || 0)}`;
            const bg = isSelected ? '#0284c7' : 'var(--bg-2)';
            const textColor = isSelected ? '#ffffff' : 'var(--text)';
            const subColor = isSelected ? 'rgba(255,255,255,0.85)' : 'var(--text-3)';

            return `
              <div class="pa-explorer-item" data-eidx="${idx}" style="background:${bg};padding:9px 12px;cursor:pointer;user-select:none;transition:all 0.12s;display:flex;flex-direction:column;gap:3px;border-left:3px solid ${isSelected ? '#38bdf8' : 'transparent'}">
                <div style="display:flex;justify-content:space-between;align-items:center;overflow:hidden">
                  <span style="font-size:11.5px;font-weight:600;color:${textColor};overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:215px;font-family:monospace" title="${escHtml(ev.targetName || '')}">
                    ${icon} ${escHtml(ev.targetName ? ev.targetName.split('/').pop() : 'Event #' + (idx+1))}
                  </span>
                  <span class="mono" style="font-size:10px;font-weight:bold;color:${isSelected ? '#ffffff' : (ev.bytesSaved > 0 ? 'var(--green)' : '#38bdf8')}">
                    ${savedStr}
                  </span>
                </div>
                <div style="display:flex;justify-content:space-between;align-items:center;font-size:10px;color:${subColor}">
                  <span>Call #${ev.callIndex + 1} (${ev.role})</span>
                  <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:140px">${escHtml(ev.category)}</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>

      <!-- Right Main Pane: Active File Diff Inspector -->
      <div style="padding:14px;overflow-y:auto;max-height:720px;display:flex;flex-direction:column;gap:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:10px;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-size:13px;font-weight:bold;color:var(--text);font-family:monospace;display:flex;align-items:center;gap:6px">
              <span>${escHtml(activeEv?.targetName || 'Event Details')}</span>
            </div>
            <div style="font-size:11px;color:var(--text-3);margin-top:2px">
              Call #${(activeEv?.callIndex || 0) + 1} (${activeEv?.role || 'user'}) • Category: <strong style="color:#38bdf8">${escHtml(activeEv?.category || '')}</strong>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <button id="pa-exp-prev-btn" class="action-btn secondary" style="padding:3px 10px;font-size:11px;cursor:pointer" ${selectedIdx === 0 ? 'disabled' : ''}>◀ Prev</button>
            <span style="font-size:11px;color:var(--text-3);font-weight:bold">${selectedIdx + 1} of ${filteredEvents.length}</span>
            <button id="pa-exp-next-btn" class="action-btn secondary" style="padding:3px 10px;font-size:11px;cursor:pointer" ${selectedIdx === filteredEvents.length - 1 ? 'disabled' : ''}>Next ▶</button>
          </div>
        </div>

        <div>
          ${activeEv ? renderReductionEventCard(activeEv, true) : '<p style="color:var(--text-3)">No event selected.</p>'}
        </div>
      </div>
    </div>
  `;
}

function bindExplorerViewEvents(body, filteredEvents, allEvents) {
  if (!body) return;

  bindSynchronizedScroll(body);

  body.querySelectorAll('.pa-explorer-item').forEach(item => {
    item.onclick = () => {
      const idx = parseInt(item.dataset.eidx, 10);
      selectedExplorerEventIndex = idx;
      renderReductionSequenceFeed(body, allEvents);
    };
  });

  const prevBtn = document.getElementById('pa-exp-prev-btn');
  if (prevBtn) {
    prevBtn.onclick = () => {
      if (selectedExplorerEventIndex > 0) {
        selectedExplorerEventIndex--;
        renderReductionSequenceFeed(body, allEvents);
      }
    };
  }

  const nextBtn = document.getElementById('pa-exp-next-btn');
  if (nextBtn) {
    nextBtn.onclick = () => {
      if (selectedExplorerEventIndex < filteredEvents.length - 1) {
        selectedExplorerEventIndex++;
        renderReductionSequenceFeed(body, allEvents);
      }
    };
  }
}

function renderFileImpactMatrixView(filteredEvents) {
  const fileMap = {};
  filteredEvents.forEach(e => {
    const key = e.targetName || e.toolName || 'Unknown';
    if (!fileMap[key]) {
      fileMap[key] = {
        target: key,
        toolName: e.toolName,
        category: e.category,
        isScratch: e.isScratch,
        calls: new Set(),
        rawBytes: 0,
        promptBytes: 0,
        bytesSaved: 0,
        events: [],
      };
    }
    fileMap[key].calls.add(e.callIndex);
    fileMap[key].rawBytes += (e.beforeSize || 0);
    fileMap[key].promptBytes += (e.afterSize || 0);
    fileMap[key].bytesSaved += (e.bytesSaved || 0);
    fileMap[key].events.push(e);
  });

  const sortedFiles = Object.values(fileMap).sort((a, b) => b.bytesSaved - a.bytesSaved || b.events.length - a.events.length);
  const totalSaved = sortedFiles.reduce((acc, f) => acc + f.bytesSaved, 0);

  return `
    <div style="margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;padding:0 4px;font-size:11.5px;color:var(--text-3);flex-wrap:wrap;gap:8px">
      <span>📁 File & Target Impact Matrix: <strong>${sortedFiles.length}</strong> unique files/targets across <strong>${filteredEvents.length}</strong> context events</span>
      <span class="mono" style="color:var(--green);font-weight:bold;background:rgba(16,185,129,0.1);padding:3px 10px;border-radius:12px;border:1px solid rgba(16,185,129,0.3)">
        Total Context Space Saved: -${fmtBytes(totalSaved)}
      </span>
    </div>

    <div class="panel" style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;padding:0">
      <div style="overflow-x:auto">
        <table class="data-table" style="width:100%;border-collapse:collapse;font-size:11.5px">
          <thead>
            <tr style="background:var(--bg-3);border-bottom:1px solid var(--border);text-align:left;color:var(--text-3);font-size:10.5px">
              <th style="padding:10px 14px">File / Target</th>
              <th style="padding:10px 12px">Category</th>
              <th style="padding:10px 12px">Turns Affected</th>
              <th style="padding:10px 12px;text-align:right">Raw Output</th>
              <th style="padding:10px 12px;text-align:right">Sent to LLM</th>
              <th style="padding:10px 14px;text-align:right">Context Saved</th>
              <th style="padding:10px 14px;text-align:center">Action</th>
            </tr>
          </thead>
          <tbody>
            ${sortedFiles.map((f, fIdx) => {
              let fIcon = '📁';
              let catColor = 'var(--green)';
              if (f.toolName === 'execute_command' || f.category.includes('Terminal')) { fIcon = '💻'; catColor = '#38bdf8'; }
              else if (f.toolName === 'postqode_browser_agent' || f.category.includes('Browser')) { fIcon = '🌐'; catColor = '#06b6d4'; }
              else if (f.toolName === 'use_skill' || f.category.includes('Skill')) { fIcon = '⚡'; catColor = '#e879f9'; }
              else if (f.toolName === 'replace_in_file') { fIcon = '📝'; catColor = '#a78bfa'; }
              else if (f.category.includes('System')) { fIcon = '🛡️'; catColor = '#38bdf8'; }

              const callPills = Array.from(f.calls).sort((a,b)=>a-b).map(cIdx => `
                <span class="pa-matrix-call-pill" data-call="${cIdx}" style="background:rgba(56,189,248,0.12);border:1px solid rgba(56,189,248,0.4);color:#38bdf8;padding:1px 6px;border-radius:10px;font-size:9.5px;font-weight:bold;cursor:pointer" title="Click to view Call #${cIdx + 1}">
                  #${cIdx + 1}
                </span>
              `).join(' ');

              return `
                <tr class="pa-matrix-row" data-fidx="${fIdx}" style="border-bottom:1px solid var(--border);cursor:pointer;transition:background 0.15s">
                  <td style="padding:10px 14px;font-family:monospace;font-size:11.5px;color:var(--text);font-weight:600;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escHtml(f.target)}">
                    <span style="font-size:13px;margin-right:6px">${fIcon}</span>${escHtml(f.target)}
                  </td>
                  <td style="padding:10px 12px">
                    <span style="background:rgba(255,255,255,0.06);padding:2px 8px;border-radius:10px;font-size:10px;font-weight:bold;color:${catColor}">
                      ${escHtml(f.category)}
                    </span>
                  </td>
                  <td style="padding:10px 12px">
                    <div style="display:flex;align-items:center;gap:4px;flex-wrap:wrap">
                      ${callPills}
                    </div>
                  </td>
                  <td class="mono" style="padding:10px 12px;text-align:right;color:var(--text-3);font-size:11px">
                    ${fmtBytes(f.rawBytes)}
                  </td>
                  <td class="mono" style="padding:10px 12px;text-align:right;color:var(--text-2);font-size:11px">
                    ${fmtBytes(f.promptBytes)}
                  </td>
                  <td class="mono" style="padding:10px 14px;text-align:right;color:var(--green);font-weight:bold;font-size:11.5px">
                    -${fmtBytes(f.bytesSaved)}
                  </td>
                  <td style="padding:10px 14px;text-align:center">
                    <button class="action-btn secondary pa-matrix-toggle-btn" data-fidx="${fIdx}" style="padding:2px 8px;font-size:10px;cursor:pointer">
                      ▼ View Diff
                    </button>
                  </td>
                </tr>
                <tr id="pa-matrix-diff-row-${fIdx}" style="display:none;background:var(--bg-1);border-bottom:1px solid var(--border)">
                  <td colspan="7" style="padding:12px">
                    <div style="display:flex;flex-direction:column;gap:10px">
                      ${f.events.map(ev => renderReductionEventCard(ev, true)).join('')}
                    </div>
                  </td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function bindMatrixViewEvents(body) {
  if (!body) return;

  body.querySelectorAll('.pa-matrix-row, .pa-matrix-toggle-btn').forEach(el => {
    el.onclick = (e) => {
      if (e.target.classList.contains('pa-matrix-call-pill')) return;
      const fIdx = el.dataset.fidx || el.closest('.pa-matrix-row')?.dataset.fidx;
      const diffRow = document.getElementById(`pa-matrix-diff-row-${fIdx}`);
      const btn = body.querySelector(`.pa-matrix-toggle-btn[data-fidx="${fIdx}"]`);
      if (diffRow) {
        const isHidden = diffRow.style.display === 'none';
        diffRow.style.display = isHidden ? 'table-row' : 'none';
        if (btn) btn.innerText = isHidden ? '▲ Hide Diff' : '▼ View Diff';
      }
    };
  });

  body.querySelectorAll('.pa-matrix-call-pill').forEach(pill => {
    pill.onclick = (e) => {
      e.stopPropagation();
      const callIdx = parseInt(pill.dataset.call, 10);
      activeCallFocusIndex = callIdx;
      selectedExplorerEventIndex = 0;
      renderReductionSequenceFeed(body, analyticsData?.reductionEvents || []);
      if (chartCanvas && analyticsData?.apiCalls) redrawTargetCanvas(chartCanvas, analyticsData.apiCalls);
      const compSec = document.getElementById('pa-comparison-section');
      if (compSec) compSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
}

function renderReductionEventCard(ev, defaultExpanded = false) {
  let icon = '✂️';
  let catColor = 'var(--green)';
  if (ev.isSystemPrompt || ev.category.includes('System')) {
    icon = '🛡️';
    catColor = '#38bdf8';
  } else if (ev.category === 'File Read Truncated' || ev.toolName === 'read_file') {
    icon = '📁';
    catColor = 'var(--green)';
  } else if (ev.category === 'Terminal Output Truncated' || ev.toolName === 'execute_command') {
    icon = '💻';
    catColor = '#38bdf8';
  } else if (ev.category === 'Stale Environment Snapshot Removed') {
    icon = '🌲';
    catColor = '#f59e0b';
  } else if (ev.toolName === 'postqode_browser_agent' || ev.category.includes('Browser')) {
    icon = '🌐';
    catColor = '#06b6d4';
  } else if (ev.toolName === 'use_skill' || ev.category.includes('Skill')) {
    icon = '⚡';
    catColor = '#e879f9';
  } else if (ev.toolName === 'replace_in_file' || ev.category.includes('Edit')) {
    icon = '📝';
    catColor = '#a78bfa';
  } else if (ev.isScratch) {
    icon = '⚡';
    catColor = '#e879f9';
  }

  const item = {
    index: ev.msgIndex,
    role: ev.role,
    before: { size: ev.beforeSize },
    after: { size: ev.afterSize },
    diffChunks: ev.diffChunks,
    bytesSaved: ev.bytesSaved,
    isScratch: ev.isScratch,
    isSystemPrompt: ev.isSystemPrompt,
    scratchFilename: ev.scratchFilename,
    toolName: ev.toolName,
  };

  return renderDiffBoxMarkup(item, ev.prevCallIndex, ev.callIndex, ev.category, ev.targetName, icon, catColor, defaultExpanded);
}

function renderDiffBoxMarkup(item, prevCallIdx, callIdx, category, targetName, icon, catColor, defaultExpanded = false) {
  const diff = item.diffChunks || {};
  const prefix = diff.prefix || '';
  const suffix = diff.suffix || '';
  const removedText = diff.removedText || '';
  const insertedText = diff.insertedText || '';
  const beforeSize = item.before?.size || 0;
  const afterSize = item.after?.size || 0;
  const bytesDelta = item.bytesDelta != null ? item.bytesDelta : (afterSize - beforeSize);
  const isExpanded = bytesDelta > 10;
  const isReduced = bytesDelta < -10;
  const metricColor = isExpanded ? '#f59e0b' : (isReduced ? 'var(--green)' : '#38bdf8');
  const metricLabel = isExpanded
    ? `Expanded ${fmtBytes(bytesDelta)}`
    : (isReduced ? `Saved ${fmtBytes(Math.abs(bytesDelta))}` : 'Base Context');
  const isScratch = !!item.isScratch;
  const isSys = !!item.isSystemPrompt;

  const bannerTitle = isSys
    ? `🛡️ SYSTEM INSTRUCTIONS & BASE CONTEXT SENT IN PROMPT:`
    : (isScratch
      ? `✂️ EXACT BULK OUTPUT OFFLOADED TO DISK (scratch/${escHtml(item.scratchFilename || '')}):`
      : (isExpanded
        ? `🟢 EXACT CONTENT ADDED IN CALL #${callIdx + 1}:`
        : (isReduced ? `✂️ EXACT CONTENT REMOVED FROM CALL #${prevCallIdx + 1}:` : '🔁 EXACT CONTENT CHANGED:')));
  const bannerText = isExpanded ? insertedText : (removedText || insertedText || '(Content changed)');
  const bannerColor = isSys ? '#38bdf8' : (isExpanded ? 'var(--green)' : (isReduced ? 'var(--red)' : '#38bdf8'));
  const bannerBg = isSys ? 'rgba(56,189,248,0.08)' : (isExpanded ? 'rgba(34,197,94,0.08)' : (isReduced ? 'rgba(239,68,68,0.08)' : 'rgba(56,189,248,0.08)'));
  const callSubtext = isSys ? `Call #1 (Base System Context)` : (isScratch ? `Call #${callIdx + 1} (Write-Time Scratch Offload)` : `Call #${prevCallIdx + 1} → Call #${callIdx + 1}`);
  const beforeHeader = isScratch ? `🔴 RAW UNTRUNCATED OUTPUT (scratch/${escHtml(item.scratchFilename || '')})` : `🔴 BEFORE in Call #${prevCallIdx + 1}`;
  const afterHeader = isScratch ? `🟢 RETAINED PROMPT (Sent to LLM in Call #${callIdx + 1})` : `🟢 AFTER in Call #${callIdx + 1}`;

  const headerLabel = category ? `
    <span style="background:rgba(255,255,255,0.06);padding:2px 8px;border-radius:12px;font-size:10.5px;font-weight:bold;color:${catColor || 'var(--green)'}">
      ${icon || '✂️'} ${escHtml(category)}: <span style="color:var(--text)">${escHtml(targetName || '')}</span>
    </span>
  ` : '';

  const isInitiallyExpanded = defaultExpanded || isSys;

  return `
    <div class="pa-sbs-card panel" data-call="${callIdx}" data-target="${escHtml(targetName || '')}" style="border:1px solid ${isSys ? 'rgba(56,189,248,0.35)' : 'var(--border)'};border-radius:var(--radius-sm);overflow:hidden;background:var(--bg-2)">
      <div class="pa-card-header" onclick="this.nextElementSibling.style.display = this.nextElementSibling.style.display === 'none' ? 'block' : 'none'; const btn = this.querySelector('.pa-card-toggle-btn'); if (btn) btn.innerText = this.nextElementSibling.style.display === 'none' ? '▼ View Diff' : '▲ Hide Diff';" style="background:var(--bg-3);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);cursor:pointer;user-select:none">
        <div style="display:flex;align-items:center;gap:10px;overflow:hidden">
          <strong style="color:var(--text);font-size:12px">msg[${item.index}]</strong>
          <span style="text-transform:uppercase;font-weight:700;color:var(--accent-2);font-size:10.5px">(${item.role})</span>
          <span style="color:var(--text-3);font-size:11px;white-space:nowrap">${callSubtext}</span>
          ${headerLabel}
        </div>
        <div style="display:flex;align-items:center;gap:10px;white-space:nowrap">
          <span class="mono" style="color:${metricColor};font-weight:bold;font-size:11.5px;background:rgba(255,255,255,0.06);padding:3px 8px;border-radius:var(--radius-sm);border:1px solid rgba(255,255,255,0.12)">
            ${isSys ? `🛡️ ${fmtBytes(beforeSize)} Base` : `${metricLabel} (${fmtBytes(beforeSize)} → ${fmtBytes(afterSize)})`}
          </span>
          <button class="action-btn secondary pa-card-toggle-btn" style="padding:2px 8px;font-size:10px">
            ${isInitiallyExpanded ? '▲ Hide Diff' : '▼ View Diff'}
          </button>
        </div>
      </div>

      <div class="pa-sbs-body" style="display:${isInitiallyExpanded ? 'block' : 'none'}">
        ${isSys ? `
          <div style="padding:12px 14px;background:var(--bg-2)">
            <div style="font-weight:bold;font-size:11px;color:#38bdf8;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
              <span>🛡️ INITIAL SYSTEM PROMPT INSTRUCTIONS (Static Base Context)</span>
              <div style="display:flex;align-items:center;gap:10px">
                <span class="mono" style="color:var(--text-3);font-size:10.5px">Size: <strong>${fmtBytes(beforeSize)}</strong></span>
                <button class="action-btn secondary pa-copy-sysprompt-btn" style="padding:2px 8px;font-size:10px;color:#38bdf8;cursor:pointer" onclick="navigator.clipboard.writeText(this.closest('.pa-sbs-body').querySelector('.mono-prompt').innerText); this.innerText = '✓ Copied'; setTimeout(() => this.innerText = '📋 Copy', 1500);">📋 Copy</button>
              </div>
            </div>
            <div class="mono mono-prompt" style="font-size:10.5px;line-height:1.45;color:var(--text);background:var(--bg-1);padding:10px 12px;border-radius:var(--radius-sm);border:1px solid var(--border);max-height:300px;overflow:auto;white-space:pre-wrap;word-break:break-all">
              ${escHtml(item.diffChunks?.insertedText || '')}
            </div>
          </div>
        ` : `
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border)">
            <div style="background:var(--bg-2);padding:10px 12px">
              <div style="font-weight:bold;font-size:10.5px;color:var(--red);margin-bottom:6px;display:flex;justify-content:space-between">
                <span>${beforeHeader}</span>
                <span class="mono">${fmtBytes(beforeSize)}</span>
              </div>
              <div class="mono pa-sbs-left" style="font-size:10.5px;line-height:1.45;color:var(--text-2);background:var(--bg-1);padding:8px;border-radius:var(--radius-sm);border:1px solid var(--border);max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-all">
                ${escHtml(prefix)}
                ${removedText ? `<span style="background:rgba(239,68,68,0.25);color:var(--red);font-weight:bold;padding:2px 4px;border-radius:2px">${escHtml(removedText)}</span>` : ''}
                ${escHtml(suffix)}
              </div>
            </div>

            <div style="background:var(--bg-2);padding:10px 12px">
              <div style="font-weight:bold;font-size:10.5px;color:var(--green);margin-bottom:6px;display:flex;justify-content:space-between">
                <span>${afterHeader}</span>
                <span class="mono">${fmtBytes(afterSize)}</span>
              </div>
              <div class="mono pa-sbs-right" style="font-size:10.5px;line-height:1.45;color:var(--text-2);background:var(--bg-1);padding:8px;border-radius:var(--radius-sm);border:1px solid var(--border);max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-all">
                ${escHtml(prefix)}
                ${insertedText ? `<span style="background:rgba(34,197,94,0.25);color:var(--green);font-weight:bold;padding:2px 4px;border-radius:2px">${escHtml(insertedText)}</span>` : ''}
                ${escHtml(suffix)}
              </div>
            </div>
          </div>
        `}
      </div>
    </div>
  `;
}

function bindSynchronizedScroll(container) {
  const cards = container.querySelectorAll('.pa-sbs-card');
  cards.forEach(card => {
    const leftPane = card.querySelector('.pa-sbs-left');
    const rightPane = card.querySelector('.pa-sbs-right');
    if (!leftPane || !rightPane) return;

    let isSyncingLeft = false;
    let isSyncingRight = false;

    leftPane.addEventListener('scroll', () => {
      if (!isSyncingLeft) {
        isSyncingRight = true;
        rightPane.scrollTop = leftPane.scrollTop;
        rightPane.scrollLeft = leftPane.scrollLeft;
      }
      isSyncingLeft = false;
    });

    rightPane.addEventListener('scroll', () => {
      if (!isSyncingRight) {
        isSyncingLeft = true;
        leftPane.scrollTop = rightPane.scrollTop;
        leftPane.scrollLeft = rightPane.scrollLeft;
      }
      isSyncingRight = false;
    });
  });
}

function renderCallPillsStrip(calls, container) {
  if (!container || !calls || calls.length === 0) return;

  container.innerHTML = `
    <div style="display:flex;align-items:center;gap:4px;overflow-x:auto;padding:6px 2px;margin-top:6px;border-top:1px dashed var(--border);user-select:none">
      <span style="font-size:10.5px;color:var(--text-3);font-weight:600;white-space:nowrap;margin-right:4px">Step Jump:</span>
      ${calls.map((c, idx) => {
        const isFocused = activeCallFocusIndex === idx;
        const hasFile = (c.fileTruncationBytes || 0) > 50 || c.hasFilePruning;
        const hasCmd = (c.commandTruncationBytes || 0) > 50 || c.hasCommandPruning;
        const hasScratch = (c.scratchOffloadedBytes || 0) > 50;
        const badge = hasFile ? (hasScratch ? '📁⚡' : '📁') : (hasCmd ? '💻' : (hasScratch ? '⚡' : ''));
        const bg = isFocused ? '#0284c7' : (hasFile ? 'rgba(16,185,129,0.15)' : (hasCmd ? 'rgba(6,182,212,0.15)' : (hasScratch ? 'rgba(232,121,249,0.15)' : 'var(--bg-3)')));
        const border = isFocused ? '#38bdf8' : (hasFile ? '#10b981' : (hasCmd ? '#06b6d4' : (hasScratch ? '#e879f9' : 'var(--border)')));
        const color = isFocused ? '#ffffff' : (hasFile ? '#10b981' : (hasCmd ? '#06b6d4' : (hasScratch ? '#e879f9' : 'var(--text-2)')));

        return `
          <button class="pa-call-pill-btn" data-call="${idx}" style="background:${bg};border:1px solid ${border};color:${color};padding:2px 7px;border-radius:4px;font-size:10.5px;font-weight:bold;cursor:pointer;white-space:nowrap;transition:all 0.15s;display:flex;align-items:center;gap:3px" title="Call #${idx + 1} (${fmtBytes(c.requestSize)}) - Click to isolate & view diff">
            #${idx + 1}${badge ? `<span style="font-size:9px">${badge}</span>` : ''}
          </button>
        `;
      }).join('')}
    </div>
  `;

  container.querySelectorAll('.pa-call-pill-btn').forEach(btn => {
    btn.onclick = () => {
      const callIdx = parseInt(btn.dataset.call, 10);
      if (activeCallFocusIndex === callIdx) {
        activeCallFocusIndex = null;
      } else {
        activeCallFocusIndex = callIdx;
        selectedExplorerEventIndex = 0;
        activeCategoryFilter = 'ALL';
      }
      renderReductionSequenceFeed(document.getElementById('pa-comparison-body'), analyticsData?.reductionEvents || []);
      if (chartCanvas && analyticsData?.apiCalls) redrawTargetCanvas(chartCanvas, analyticsData.apiCalls);
      renderCallPillsStrip(calls, container);

      const compSec = document.getElementById('pa-comparison-section');
      if (compSec) compSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });
}

function fmtContextWindow(tokens) {
  if (!tokens || tokens <= 0) return 'unknown';
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(tokens >= 1048000 && tokens <= 1049000 ? 0 : 1)}M tokens`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(0)}K tokens`;
  return `${tokens} tokens`;
}

function renderModelSwimlane(calls, container) {
  if (!container || !calls || calls.length === 0) return;

  const segments = [];
  let current = null;
  for (let i = 0; i < calls.length; i++) {
    const m = calls[i].modelId;
    if (!current || current.modelId !== m) {
      if (current) segments.push(current);
      current = { modelId: m, from: i, to: i, count: 1 };
    } else {
      current.to = i;
      current.count++;
    }
  }
  if (current) segments.push(current);

  const hasMultiple = segments.length > 1 || !segments[0]?.modelId;
  if (!hasMultiple && segments[0]?.modelId) {
    const cw = calls[0].contextWindowSize;
    container.innerHTML = `
      <div style="font-size:10.5px;color:var(--text-3);padding:6px 0 0;text-align:center">
        🤖 Model: <span style="color:var(--text);font-family:monospace;font-weight:600">${escHtml(segments[0].modelId)}</span>
        — Context Window: <span style="color:#a78bfa;font-weight:bold">${fmtContextWindow(cw)}</span>
      </div>
    `;
    return;
  }

  const MODEL_COLORS = ['#38bdf8','#f59e0b','#10b981','#e879f9','#f87171','#a78bfa','#34d399'];
  const modelColorMap = {};
  let colorIdx = 0;
  for (const seg of segments) {
    if (seg.modelId && !modelColorMap[seg.modelId]) {
      modelColorMap[seg.modelId] = MODEL_COLORS[colorIdx++ % MODEL_COLORS.length];
    }
  }

  container.innerHTML = `
    <div style="margin-top:6px;border-radius:4px;overflow:hidden;border:1px solid var(--border)">
      <div style="display:flex;height:20px">
        ${segments.map(seg => {
          const color = seg.modelId ? modelColorMap[seg.modelId] : 'var(--border)';
          const pct = (seg.count / calls.length * 100).toFixed(1);
          const label = seg.modelId ? seg.modelId.split('/').pop() : 'unknown';
          const cw = seg.modelId ? calls[seg.from]?.contextWindowSize : null;
          const cwLabel = cw ? fmtContextWindow(cw) : '';
          return `
            <div style="flex:${seg.count};background:${color}22;border-right:1px solid var(--border);display:flex;align-items:center;justify-content:center;overflow:hidden;min-width:0" title="Model: ${escHtml(seg.modelId || 'unknown')} | Calls ${seg.from + 1}–${seg.to + 1} (${pct}%) | Context Window: ${cwLabel || 'unknown'}">
              <span style="font-size:9px;color:${color};font-weight:bold;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;padding:0 4px">
                ${escHtml(label)} ${cwLabel ? `(${cwLabel})` : ''}
              </span>
            </div>`;
        }).join('')}
      </div>
    </div>
  `;
}

// ── Timeline Canvas Drawing (Supports zoom & crosshairs) ──
function drawTimelineChart(calls, targetCanvas = null, zoomRange = null, crosshairStepIndex = null, customMaxes = null) {
  const canvas = targetCanvas || document.getElementById('pa-timeline-chart');
  if (!canvas) return;
  if (!targetCanvas) chartCanvas = canvas;
  canvas._calls = calls;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  const h = canvas.dataset.height ? parseInt(canvas.dataset.height) : 260;

  canvas.width = rect.width * dpr;
  canvas.height = h * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = h + 'px';
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const pad = { top: 25, right: 60, bottom: 40, left: 70 };

  // Calculate slice if zoomRange is present
  let visibleCalls = calls;
  let startIndex = 0;
  if (zoomRange && Array.isArray(zoomRange) && (zoomRange[0] > 0 || zoomRange[1] < 100)) {
    startIndex = Math.floor((zoomRange[0] / 100) * calls.length);
    let endIndex = Math.ceil((zoomRange[1] / 100) * calls.length);
    startIndex = Math.max(0, Math.min(calls.length - 1, startIndex));
    endIndex = Math.max(startIndex + 1, Math.min(calls.length, endIndex));
    visibleCalls = calls.slice(startIndex, endIndex);
  }

  if (visibleCalls.length === 0) return;

  const reqMode = window.requestSizeMode || requestSizeMode || 'accumulated';
  const getTargetSize = (c) => {
    if (reqMode === 'accumulated') return c.requestSize || Math.max(10, (c.tokensIn || 0) * 4);
    if (c.turnDeltaSize != null && c.turnDeltaSize > 0) return c.turnDeltaSize;
    if (c.sizeDelta != null && c.sizeDelta > 0) return c.sizeDelta;
    if (c.index === 0 && c.requestSize > 0) return c.requestSize;
    return Math.max(10, (c.tokensIn || 0) * 4);
  };

  const sizes = visibleCalls.map(c => getTargetSize(c));
  const cacheReads = visibleCalls.map(c => c.cacheReads);
  const cacheWrites = visibleCalls.map(c => c.cacheWrites);
  const costs = visibleCalls.map(c => c.cumulativeCost || c.cost || 0);
  const latencies = visibleCalls.map(c => (c.latencyMs || 0) / 1000);

  const maxSize = (customMaxes && customMaxes.maxSize) ? customMaxes.maxSize : Math.max(...sizes, 1);
  const maxCache = (customMaxes && customMaxes.maxCache) ? customMaxes.maxCache : Math.max(...cacheReads, ...cacheWrites, 1);
  const maxCost = (customMaxes && customMaxes.maxCost) ? customMaxes.maxCost : Math.max(...costs, 0.01);
  const maxLatency = (customMaxes && customMaxes.maxLatency) ? customMaxes.maxLatency : Math.max(...latencies, 1);

  const chartWeff = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  ctx.fillStyle = isDark ? '#111827' : '#ffffff';
  ctx.fillRect(0, 0, w, h);

  // Horizontal Grid lines
  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (chartH / 5) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
  }

  // Left Y-axis (request size)
  ctx.fillStyle = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (chartH / 5) * i;
    const val = maxSize - (maxSize / 5) * i;
    ctx.fillText(fmtBytes(val), pad.left - 8, y + 3);
  }

  // Right Y-axis (cost $ or %)
  ctx.textAlign = 'left';
  ctx.fillStyle = chartSeries.cumulativeCost ? '#ec4899' : '#059669';
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (chartH / 5) * i;
    if (chartSeries.cumulativeCost) {
      const val = maxCost - (maxCost / 5) * i;
      ctx.fillText(fmtCost(val), w - pad.right + 6, y + 3);
    } else {
      const val = 100 - 20 * i;
      ctx.fillText(val + '%', w - pad.right + 6, y + 3);
    }
  }

  const colWidth = chartWeff / visibleCalls.length;
  const barWidth = Math.max(2, Math.min(24, colWidth - 2));

  const points = [];

  for (let i = 0; i < visibleCalls.length; i++) {
    const c = visibleCalls[i];
    const origIndex = startIndex + i;
    const x = pad.left + i * colWidth + colWidth / 2;

    const targetSize = getTargetSize(c);
    const barH = Math.max(6, (targetSize / maxSize) * chartH);
    const barY = pad.top + chartH - barH;

    const readY = pad.top + chartH - (c.cacheReads / maxCache) * chartH;
    const writeY = pad.top + chartH - (c.cacheWrites / maxCache) * chartH;
    const ctxY = c.contextUtilizationPct != null ? pad.top + chartH * (1 - c.contextUtilizationPct / 100) : null;
    const costY = pad.top + chartH * (1 - (c.cumulativeCost || 0) / maxCost);
    const hitPctY = pad.top + chartH * (1 - (c.cacheHitPct || 0) / 100);
    const latY = pad.top + chartH * (1 - ((c.latencyMs || 0) / 1000) / maxLatency);

    points.push({ x, barY, barH, readY, writeY, ctxY, costY, hitPctY, latY, call: c, index: origIndex, localIndex: i });

    const hoveredIdx = canvas._hoveredIndex != null ? canvas._hoveredIndex : null;
    const isHighlighted = (hoveredIdx === origIndex) || (crosshairStepIndex === origIndex) || (activeCallFocusIndex === origIndex);
    if (isHighlighted) {
      ctx.fillStyle = (activeCallFocusIndex === origIndex) ? 'rgba(16, 185, 129, 0.25)' : (isDark ? 'rgba(56, 189, 248, 0.18)' : 'rgba(14, 165, 233, 0.15)');
      ctx.fillRect(pad.left + i * colWidth, pad.top, colWidth, chartH);
    }

    if (chartSeries.requestSize) {
      const hasFilePruning = (c.fileTruncationBytes || 0) > 50 || c.hasFilePruning;
      const hasCommandPruning = (c.commandTruncationBytes || 0) > 50 || c.hasCommandPruning;
      const hasHistoricalPruning = c.hasPruning || (c.trimmedFromPrevBytes || 0) > 100;
      const hasScratchOffload = (c.scratchOffloadedBytes || 0) > 50;

      const grad = ctx.createLinearGradient(x - barWidth / 2, barY, x - barWidth / 2, pad.top + chartH);

      let barBorderColor = 'rgba(56, 189, 248, 0.85)';
      let badgeIcon = '';
      let badgeColor = '#38bdf8';

      if (hasFilePruning) {
        grad.addColorStop(0, '#10b981');
        grad.addColorStop(1, 'rgba(16, 185, 129, 0.45)');
        barBorderColor = 'rgba(16, 185, 129, 0.9)';
        badgeIcon = hasScratchOffload ? '📁⚡' : '📁';
        badgeColor = '#10b981';
      } else if (hasCommandPruning) {
        grad.addColorStop(0, '#06b6d4');
        grad.addColorStop(1, 'rgba(6, 182, 212, 0.45)');
        barBorderColor = 'rgba(6, 182, 212, 0.9)';
        badgeIcon = hasScratchOffload ? '💻⚡' : '💻';
        badgeColor = '#06b6d4';
      } else if (hasHistoricalPruning) {
        grad.addColorStop(0, '#10b981');
        grad.addColorStop(1, 'rgba(16, 185, 129, 0.45)');
        barBorderColor = 'rgba(16, 185, 129, 0.9)';
        badgeIcon = '✂️';
        badgeColor = '#10b981';
      } else if (hasScratchOffload) {
        grad.addColorStop(0, '#e879f9');
        grad.addColorStop(1, 'rgba(232, 121, 249, 0.45)');
        barBorderColor = 'rgba(232, 121, 249, 0.9)';
        badgeIcon = '⚡';
        badgeColor = '#e879f9';
      } else {
        grad.addColorStop(0, '#38bdf8');
        grad.addColorStop(1, 'rgba(14, 165, 233, 0.45)');
      }

      ctx.fillStyle = grad;
      ctx.fillRect(x - barWidth / 2, barY, barWidth, barH);

      ctx.strokeStyle = barBorderColor;
      ctx.lineWidth = 1;
      ctx.strokeRect(x - barWidth / 2, barY, barWidth, barH);

      if (badgeIcon) {
        ctx.fillStyle = badgeColor;
        ctx.font = 'bold 8.5px Inter, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(badgeIcon, x, Math.max(pad.top + 8, barY - 3));
      }

      if (isHighlighted) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(x - barWidth / 2 - 1, barY - 1, barWidth + 2, barH + 2);
      }
    }

    const step = Math.max(1, Math.floor(visibleCalls.length / 15));
    if (i % step === 0 || i === visibleCalls.length - 1) {
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';
      ctx.font = '10px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(String(origIndex + 1), x, h - pad.bottom + 16);
    }
  }

  // Draw Cache Reads line
  if (chartSeries.cacheReads && points.length > 0) {
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.beginPath();
    points.forEach((pt, idx) => {
      const y = Math.max(pt.readY, pad.top);
      if (idx === 0) ctx.moveTo(pt.x, y);
      else ctx.lineTo(pt.x, y);
    });
    ctx.stroke();
    points.forEach(pt => {
      if (pt.call.cacheReads > 0) {
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(pt.x, Math.max(pt.readY, pad.top), 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // Draw Cache Writes line
  if (chartSeries.cacheWrites && points.length > 0) {
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    points.forEach((pt, idx) => {
      const y = Math.max(pt.writeY, pad.top);
      if (idx === 0) ctx.moveTo(pt.x, y);
      else ctx.lineTo(pt.x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw Context Window % line
  if (chartSeries.contextWindow && points.some(p => p.ctxY != null)) {
    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (pt.ctxY == null) continue;
      const nextPt = i + 1 < points.length ? points[i + 1] : null;
      const pct = pt.call.contextUtilizationPct || 0;
      const lineColor = pct >= 80 ? '#ef4444' : pct >= 50 ? '#f59e0b' : '#a78bfa';

      if (nextPt && nextPt.ctxY != null) {
        ctx.beginPath();
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 2;
        ctx.moveTo(pt.x, Math.max(pt.ctxY, pad.top));
        ctx.lineTo(nextPt.x, Math.max(nextPt.ctxY, pad.top));
        ctx.stroke();
      }
      ctx.fillStyle = lineColor;
      ctx.beginPath();
      ctx.arc(pt.x, Math.max(pt.ctxY, pad.top), (hoveredCallIndex === pt.index) ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Draw Cumulative Cost Line Overlay (Vibrant pink line)
  if (chartSeries.cumulativeCost && points.length > 0) {
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgba(236, 72, 153, 0.5)';
    ctx.shadowBlur = 4;
    ctx.beginPath();
    points.forEach((pt, idx) => {
      const y = Math.max(pt.costY, pad.top);
      if (idx === 0) ctx.moveTo(pt.x, y);
      else ctx.lineTo(pt.x, y);
    });
    ctx.stroke();
    ctx.shadowBlur = 0;

    points.forEach(pt => {
      ctx.fillStyle = '#ec4899';
      ctx.beginPath();
      ctx.arc(pt.x, Math.max(pt.costY, pad.top), (hoveredCallIndex === pt.index) ? 5 : 3, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Draw Cache Hit % Line Overlay (Bright Cyan line)
  if (chartSeries.cacheHitPct && points.length > 0) {
    ctx.strokeStyle = '#06b6d4';
    ctx.lineWidth = 2.5;
    ctx.shadowColor = 'rgba(6, 182, 212, 0.4)';
    ctx.shadowBlur = 4;
    ctx.setLineDash([4, 2]);
    ctx.beginPath();
    points.forEach((pt, idx) => {
      const y = Math.max(pt.hitPctY, pad.top);
      if (idx === 0) ctx.moveTo(pt.x, y);
      else ctx.lineTo(pt.x, y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;

    points.forEach(pt => {
      if (pt.call.cacheHitPct > 0) {
        ctx.fillStyle = '#06b6d4';
        ctx.beginPath();
        ctx.arc(pt.x, Math.max(pt.hitPctY, pad.top), (hoveredCallIndex === pt.index) ? 5 : 3, 0, Math.PI * 2);
        ctx.fill();
      }
    });
  }

  // Draw Step Latency Line Overlay
  if (chartSeries.stepLatency && points.length > 0) {
    ctx.strokeStyle = '#6366f1';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    points.forEach((pt, idx) => {
      const y = Math.max(pt.latY, pad.top);
      if (idx === 0) ctx.moveTo(pt.x, y);
      else ctx.lineTo(pt.x, y);
    });
    ctx.stroke();
  }

  // Crosshair line for comparison mode
  if (crosshairStepIndex != null) {
    const pt = points.find(p => p.index === crosshairStepIndex);
    if (pt) {
      ctx.strokeStyle = '#f43f5e';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(pt.x, pad.top);
      ctx.lineTo(pt.x, pad.top + chartH);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  ctx.fillStyle = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('API Call #', w / 2, h - 6);

  canvas._chartPoints = points;
  canvas._barWidth = barWidth;
  canvas._chartMeta = { chartW: chartWeff, padLeft: pad.left, padTop: pad.top, chartH, startIndex };
}

function bindAnalyticsEvents(calls) {
  bindGlobalLegendEvents(document.getElementById('pa-content'), () => {
    drawTimelineChart(calls);
    const compSec = document.getElementById('pa-comparison-section');
    const cacheSec = document.getElementById('pa-cache-section');
    if (!chartSeries.requestSize && (chartSeries.cacheReads || chartSeries.cacheWrites)) {
      if (compSec) compSec.style.display = 'none';
      if (cacheSec) cacheSec.style.display = 'block';
    } else {
      if (compSec) compSec.style.display = 'block';
      if (cacheSec) cacheSec.style.display = 'none';
    }
  });

  document.querySelectorAll('.pa-summary-row').forEach(row => {
    row.onclick = () => {
      const target = row.dataset.target;
      if (!target) return;

      reductionSearchQuery = target;
      activeCategoryFilter = 'ALL';
      reductionViewMode = 'grouped';
      const searchInput = document.getElementById('pa-seq-search-input');
      if (searchInput) searchInput.value = target;

      renderReductionSequenceFeed(document.getElementById('pa-comparison-body'), analyticsData?.reductionEvents || []);

      const compSec = document.getElementById('pa-comparison-section');
      if (compSec) compSec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
  });

  document.querySelectorAll('.pa-cat-filter').forEach(btn => {
    btn.onclick = () => {
      activeCategoryFilter = btn.dataset.cat;
      reductionFeedLimit = 30;
      document.querySelectorAll('.pa-cat-filter').forEach(b => b.classList.toggle('active', b === btn));
      renderReductionSequenceFeed(document.getElementById('pa-comparison-body'), analyticsData?.reductionEvents || []);
    };
  });

  const chartEl = document.getElementById('pa-timeline-chart');
  if (chartEl) {
    chartEl._calls = calls;
    if (!chartEl._hasBoundEvents) {
      chartEl._hasBoundEvents = true;
      chartEl.addEventListener('mousemove', (e) => {
        handleChartHover(e, chartEl._calls, chartEl, 'pa-chart-tooltip');
      });
      chartEl.addEventListener('mouseleave', () => {
        chartEl._hoveredIndex = null;
        redrawTargetCanvas(chartEl, chartEl._calls);
        const tooltip = document.getElementById('pa-chart-tooltip');
        if (tooltip) tooltip.style.display = 'none';
      });
      chartEl.addEventListener('click', (e) => {
        handleChartClick(e, chartEl._calls);
      });
    }
  }
}

function redrawTargetCanvas(canvas, calls = null) {
  if (!canvas) return;
  const activeCalls = calls || canvas._calls;
  if (!activeCalls) return;

  if (canvas.id === 'pa-timeline-chart') {
    drawTimelineChart(activeCalls, canvas);
  } else if (canvas.id === 'pa-fullscreen-canvas') {
    drawTimelineChart(activeCalls, canvas, fullscreenZoomRange);
  } else if (canvas.id && canvas.id.startsWith('pa-compare-canvas-')) {
    const stepIdx = (compareStepIndex != null) ? compareStepIndex : 0;
    const validIds = Object.keys(compareDataMap);
    const reqMode = window.requestSizeMode || requestSizeMode || 'accumulated';
    const getGlobalCompareMaxes = () => {
      if (!useSharedCompareScale) return null;
      let maxCost = 0.01;
      let maxSize = 1;
      let maxCache = 1;
      let maxLatency = 1;

      validIds.forEach(id => {
        const cList = compareDataMap[id]?.apiCalls || [];
        cList.forEach(c => {
          const costVal = c.cumulativeCost || c.cost || 0;
          if (costVal > maxCost) maxCost = costVal;
          const targetSize = reqMode === 'accumulated'
            ? (c.requestSize || 1)
            : (c.turnDeltaSize || (c.sizeDelta ? Math.abs(c.sizeDelta) : (c.tokensIn ? c.tokensIn * 4 : 100)));
          if (targetSize > maxSize) maxSize = targetSize;
          if ((c.cacheReads || 0) > maxCache) maxCache = c.cacheReads;
          if ((c.cacheWrites || 0) > maxCache) maxCache = c.cacheWrites;
          if (((c.latencyMs || 0) / 1000) > maxLatency) maxLatency = (c.latencyMs || 0) / 1000;
        });
      });

      return { maxCost, maxSize, maxCache, maxLatency };
    };
    drawTimelineChart(activeCalls, canvas, null, stepIdx, getGlobalCompareMaxes());
  }
}

function handleChartHover(e, calls, targetCanvas = null, tooltipId = 'pa-chart-tooltip') {
  const canvas = targetCanvas || chartCanvas;
  const tooltip = document.getElementById(tooltipId);
  if (!canvas || !canvas._chartMeta || !tooltip) return;

  const activeCalls = canvas._calls || calls;
  if (!activeCalls) return;

  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  const { chartW, padLeft } = canvas._chartMeta;
  if (mouseX < padLeft || mouseX > padLeft + chartW) {
    if (canvas._hoveredIndex !== null && canvas._hoveredIndex !== undefined) {
      canvas._hoveredIndex = null;
      redrawTargetCanvas(canvas, activeCalls);
    }
    tooltip.style.display = 'none';
    return;
  }

  const points = canvas._chartPoints || [];
  if (points.length === 0) return;

  const colWidth = chartW / points.length;
  let localIdx = Math.floor((mouseX - padLeft) / colWidth);
  localIdx = Math.max(0, Math.min(points.length - 1, localIdx));
  const origIdx = points[localIdx].index;

  if (canvas._hoveredIndex !== origIdx) {
    canvas._hoveredIndex = origIdx;
    redrawTargetCanvas(canvas, activeCalls);
  }

  const foundPt = points[localIdx];
  if (!foundPt) return;

  const c = foundPt.call;
  const prunedStr = c.trimmedFromPrevBytes > 0 ? `✂️ Context Pruned: <strong>${fmtBytes(c.trimmedFromPrevBytes)}</strong>` : 'No context pruning';

  let reductionBadges = [];
  if ((c.fileTruncationBytes || 0) > 0) reductionBadges.push(`<span style="color:#10b981">📁 File Read Truncated: <strong>-${fmtBytes(c.fileTruncationBytes)}</strong></span>`);
  if ((c.commandTruncationBytes || 0) > 0) reductionBadges.push(`<span style="color:#06b6d4">💻 Terminal Truncated: <strong>-${fmtBytes(c.commandTruncationBytes)}</strong></span>`);
  if ((c.trimmedFromPrevBytes || 0) > 0) reductionBadges.push(`<span style="color:#10b981">✂️ Context Pruned: <strong>-${fmtBytes(c.trimmedFromPrevBytes)}</strong></span>`);
  if ((c.scratchOffloadedBytes || 0) > 0 && !c.fileTruncationBytes && !c.commandTruncationBytes) {
    reductionBadges.push(`<span style="color:#e879f9">⚡ Scratch Offload: <strong>-${fmtBytes(c.scratchOffloadedBytes)}</strong></span>`);
  }
  const reductionHtml = reductionBadges.length > 0
    ? `<div style="font-size:10.5px;margin-top:4px;padding-top:4px;border-top:1px dashed rgba(255,255,255,0.15)">${reductionBadges.join('<br>')}</div>`
    : '';

  let ctxStr = '';
  if (c.contextUtilizationPct != null && c.contextWindowSize) {
    const pct = c.contextUtilizationPct.toFixed(1);
    const total = fmtTokens(c.totalTokensInContext);
    const limit = fmtTokens(c.contextWindowSize);
    const pctColor = c.contextUtilizationPct >= 80 ? '#ef4444' : c.contextUtilizationPct >= 50 ? '#f59e0b' : '#a78bfa';
    ctxStr = `<div style="color:${pctColor};font-size:10.5px;margin-top:2px">🪟 Context Window: <strong>${pct}%</strong> (${total} / ${limit})</div>`;
  }

  const modelStr = c.modelId ? `<div style="font-size:10px;color:var(--text-3);margin-top:2px">🤖 ${escHtml(c.modelId)}</div>` : '';

  tooltip.style.display = 'block';

  const tooltipWidth = 280;
  if (mouseX > rect.width / 2) {
    tooltip.style.left = `${Math.max(10, mouseX - tooltipWidth - 15)}px`;
  } else {
    tooltip.style.left = `${Math.min(mouseX + 15, rect.width - tooltipWidth - 10)}px`;
  }
  tooltip.style.top = `${Math.max(10, Math.min(mouseY - 30, rect.height - 180))}px`;

  const elapsedStr = c.elapsedSeconds != null ? `+${fmtDuration(c.elapsedSeconds * 1000)}` : '';
  const latStr = c.latencyMs ? `(step latency ${fmtDuration(c.latencyMs)})` : '';

  const scratchStr = (c.scratchOffloadedBytes || 0) > 0
    ? `<div style="color:#e879f9;font-weight:bold;font-size:10.5px">⚡ Scratch Offloaded: <strong>${fmtBytes(c.scratchOffloadedBytes)}</strong></div>`
    : '';

  tooltip.innerHTML = `
    <div style="font-weight:bold;color:var(--text);margin-bottom:4px;display:flex;justify-content:space-between">
      <span>API Call #${foundPt.index + 1}</span>
      <span style="color:var(--text-3);font-weight:normal">${fmtTime(c.ts)} ${elapsedStr ? `<strong style="color:#38bdf8">${elapsedStr}</strong>` : ''}</span>
    </div>
    ${modelStr}
    <div style="color:#38bdf8;font-weight:600;font-size:10.5px">📦 Accumulated Payload: <strong>${fmtBytes(c.requestSize)}</strong></div>
    <div style="color:#38bdf8;font-size:10.5px">⚡ Per-Turn New Input: <strong>${fmtBytes(c.turnDeltaSize || Math.max(0, c.sizeDelta))}</strong></div>
    ${reductionHtml || scratchStr}
    ${ctxStr}
    <div style="color:#ec4899;font-weight:bold;font-size:10.5px">📈 Cumulative Price: <strong>${fmtCost(c.cumulativeCost || c.cost)}</strong></div>
    <div style="color:#06b6d4;font-weight:bold;font-size:10.5px">🎯 Cache Hit Rate: <strong>${(c.cacheHitPct || 0).toFixed(1)}%</strong></div>
    <div style="color:var(--green);font-size:10px">📖 Cache Reads: <strong>${fmtTokens(c.cacheReads)}</strong></div>
    <div style="color:#f59e0b;font-size:10px">✍️ Cache Writes: <strong>${fmtTokens(c.cacheWrites)}</strong></div>
    <div style="font-size:10px;color:var(--text-2);margin-top:2px">${prunedStr}</div>
    <div style="font-size:10px;color:var(--text-3)">Call Cost: <strong>${fmtCost(c.cost)}</strong> ${latStr}</div>
  `;
}

function showChartToast(msg) {
  let toast = document.getElementById('pa-chart-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'pa-chart-toast';
    toast.style.cssText = `
      position: absolute;
      top: 12px;
      right: 12px;
      background: rgba(15, 23, 42, 0.92);
      border: 1px solid #38bdf8;
      color: #38bdf8;
      padding: 6px 12px;
      border-radius: var(--radius-sm);
      font-size: 11px;
      font-weight: bold;
      pointer-events: none;
      z-index: 50;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      transition: opacity 0.25s ease;
    `;
    const chartContainer = document.querySelector('.pa-chart-container');
    if (chartContainer) chartContainer.appendChild(toast);
  }
  toast.innerText = msg;
  toast.style.opacity = '1';
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => { toast.style.display = 'none'; }, 300);
  }, 2500);
}

function handleChartClick(e, calls) {
  const canvas = chartCanvas;
  if (!canvas || !canvas._chartMeta) return;

  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;

  const { chartW, padLeft } = canvas._chartMeta;
  if (mouseX < padLeft || mouseX > padLeft + chartW) return;

  const colWidth = chartW / calls.length;
  let colIdx = Math.floor((mouseX - padLeft) / colWidth);
  colIdx = Math.max(0, Math.min(calls.length - 1, colIdx));

  if (!chartSeries.requestSize && (chartSeries.cacheReads || chartSeries.cacheWrites)) {
    const tableRow = document.querySelector(`.pa-cache-row[data-call-idx="${colIdx}"]`);
    if (tableRow) {
      tableRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      tableRow.click();
    }
    return;
  }

  // Toggle or focus on the clicked API call
  if (activeCallFocusIndex === colIdx) {
    activeCallFocusIndex = null;
    showChartToast(`Showing all calls`);
  } else {
    activeCallFocusIndex = colIdx;
    selectedExplorerEventIndex = 0;
    reductionSearchQuery = '';
    activeCategoryFilter = 'ALL';
    const allEvs = analyticsData?.reductionEvents || [];
    const matching = allEvs.filter(e => e.callIndex === colIdx);
    showChartToast(`🎯 Call #${colIdx + 1}: ${matching.length} event${matching.length === 1 ? '' : 's'} inspected`);
  }

  const searchInput = document.getElementById('pa-seq-search-input');
  if (searchInput) searchInput.value = '';

  renderReductionSequenceFeed(document.getElementById('pa-comparison-body'), analyticsData?.reductionEvents || []);
  redrawTargetCanvas(canvas, calls);

  const compSection = document.getElementById('pa-comparison-section');
  if (compSection) {
    compSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

export async function silentRefreshPromptAnalytics() {
  try {
    const result = await api.tasks({ limit: 100, page: 1 });
    allTasksList = result.tasks || [];
    allTasksList.forEach(t => {
      t.label = getSavedTaskLabel(t.id, t.label);
    });

    const select = document.getElementById('pa-task-select');
    if (select) {
      const selectedVal = select.value || currentTaskId;
      select.innerHTML = `
        <option value="">— Choose a task to analyze —</option>
        ${allTasksList.map(t => {
          const displayName = t.label ? `🏷️ ${escHtml(t.label)}` : escHtml(t.first_message ? t.first_message.substring(0, 75) : 'Task ' + t.id);
          return `
            <option value="${t.id}" ${t.id === selectedVal ? 'selected' : ''}>
              ${displayName} (${t.api_call_count || 0} calls, ${fmtCost(t.total_cost)})
            </option>
          `;
        }).join('')}
      `;
    }

    if (activeMode === 'single' && currentTaskId) {
      const res = await api.promptAnalytics(currentTaskId);
      if (res && res.apiCalls) {
        analyticsData = res;
        if (!analyticsData.task) analyticsData.task = { id: currentTaskId };
        analyticsData.task.label = getSavedTaskLabel(currentTaskId, analyticsData.task.label);

        const contentEl = document.getElementById('pa-content');
        if (contentEl) {
          const modal = document.getElementById('pa-fullscreen-modal');
          const isModalOpen = modal && modal.style.display === 'flex';

          renderAnalytics(contentEl);

          if (isModalOpen) {
            const fsCanvas = document.getElementById('pa-fullscreen-canvas');
            if (fsCanvas) {
              fsCanvas._calls = analyticsData.apiCalls;
              drawTimelineChart(analyticsData.apiCalls, fsCanvas, fullscreenZoomRange);
            }
          }
        }
      }
    } else if (activeMode === 'compare' && compareSelectedTaskIds.length > 0) {
      for (const id of compareSelectedTaskIds) {
        try {
          const res = await api.promptAnalytics(id);
          if (res && res.apiCalls) {
            if (!res.task) res.task = { id };
            const taskItem = allTasksList.find(x => x.id === id);
            const label = taskItem?.label || res.task.label || getSavedTaskLabel(id, null);
            res.task.label = label;
            compareDataMap[id] = res;
          }
        } catch {}
      }

      const validIds = Object.keys(compareDataMap);
      if (validIds.length > 0) {
        const getGlobalCompareMaxes = () => {
          if (!useSharedCompareScale) return null;
          let maxCost = 0.01;
          let maxSize = 1;
          let maxCache = 1;
          let maxLatency = 1;

          validIds.forEach(id => {
            const calls = compareDataMap[id]?.apiCalls || [];
            calls.forEach(c => {
              const costVal = c.cumulativeCost || c.cost || 0;
              if (costVal > maxCost) maxCost = costVal;
              if ((c.requestSize || 0) > maxSize) maxSize = c.requestSize;
              if ((c.cacheReads || 0) > maxCache) maxCache = c.cacheReads;
              if ((c.cacheWrites || 0) > maxCache) maxCache = c.cacheWrites;
              if (((c.latencyMs || 0) / 1000) > maxLatency) maxLatency = (c.latencyMs || 0) / 1000;
            });
          });

          return { maxCost, maxSize, maxCache, maxLatency };
        };

        const sharedMaxes = getGlobalCompareMaxes();
        validIds.forEach(id => {
          const canvas = document.getElementById(`pa-compare-canvas-${id}`);
          if (canvas && compareDataMap[id]) {
            drawTimelineChart(compareDataMap[id].apiCalls, canvas, null, compareStepIndex, sharedMaxes);
          }
        });

        drawCombinedCompareChart(validIds, compareStepIndex, sharedMaxes);
      }
    }
  } catch (e) {
    console.error('Silent refresh failed:', e);
  }
}

let scratchSortMode = 'chrono';

function renderScratchInspector(container, scratchEvents) {
  if (!container) return;
  if (!scratchEvents || scratchEvents.length === 0) {
    container.innerHTML = `
      <div class="empty-state" style="padding:20px">
        <p style="color:var(--text-3);font-size:12px">No write-time scratch offloads detected for this task.</p>
      </div>
    `;
    return;
  }

  const sortedEvents = [...scratchEvents].sort((a, b) => {
    if (scratchSortMode === 'bytes') return b.bytesSaved - a.bytesSaved;
    return a.callIndex - b.callIndex || a.filename.localeCompare(b.filename);
  });

  const chronoBtn = document.getElementById('pa-scratch-sort-chrono');
  const bytesBtn = document.getElementById('pa-scratch-sort-bytes');
  if (chronoBtn && bytesBtn && !chronoBtn._hasBoundSort) {
    chronoBtn._hasBoundSort = true;
    chronoBtn.addEventListener('click', () => {
      scratchSortMode = 'chrono';
      chronoBtn.classList.add('active');
      bytesBtn.classList.remove('active');
      renderScratchInspector(container, scratchEvents);
    });
    bytesBtn.addEventListener('click', () => {
      scratchSortMode = 'bytes';
      bytesBtn.classList.add('active');
      chronoBtn.classList.remove('active');
      renderScratchInspector(container, scratchEvents);
    });
  }

  container.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      ${sortedEvents.map(evt => {
        const rawSizeStr = fmtBytes(evt.rawBytes);
        const promptSizeStr = fmtBytes(evt.promptBytes);
        const savedStr = fmtBytes(evt.bytesSaved);
        const savingsPct = evt.rawBytes > 0 ? ((evt.bytesSaved / evt.rawBytes) * 100).toFixed(1) : '0';

        const rawText = evt.rawPreviewText || '';
        const promptText = evt.promptSnippetText || '';

        // Compute exact diff chunks
        let prefixLen = 0;
        const maxPrefix = Math.min(rawText.length, promptText.length);
        while (prefixLen < maxPrefix && rawText[prefixLen] === promptText[prefixLen]) prefixLen++;

        let suffixLen = 0;
        const maxSuffix = Math.min(rawText.length - prefixLen, promptText.length - prefixLen);
        while (suffixLen < maxSuffix && rawText[rawText.length - 1 - suffixLen] === promptText[promptText.length - 1 - suffixLen]) suffixLen++;

        const prefix = rawText.substring(0, prefixLen);
        const removedText = rawText.substring(prefixLen, rawText.length - suffixLen);
        const insertedText = promptText.substring(prefixLen, promptText.length - suffixLen);
        const suffix = rawText.substring(rawText.length - suffixLen);

        const bannerText = removedText.length > 500 ? removedText.substring(0, 500) + `\n... [${removedText.length - 500} more chars offloaded to disk]` : (removedText || rawText.substring(0, 500));

        return `
          <div class="pa-sbs-card panel" data-call="${evt.callIndex}" data-target="${escHtml(evt.filename)}" style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;background:var(--bg-2)">
            <div style="background:var(--bg-3);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border);flex-wrap:wrap;gap:8px">
              <div style="display:flex;align-items:center;gap:10px">
                <span style="background:rgba(232,121,249,0.15);color:#e879f9;padding:2px 8px;border-radius:12px;font-size:10.5px;font-weight:bold;border:1px solid rgba(232,121,249,0.3)">
                  ⚡ ${escHtml(evt.toolName)}
                </span>
                <strong style="color:var(--text);font-size:11.5px" class="mono">${escHtml(evt.targetPath || evt.filename)}</strong>
                ${evt.targetPath && evt.targetPath !== evt.filename ? `<span style="color:var(--text-3);font-size:10px" class="mono">(${escHtml(evt.filename)})</span>` : ''}
                <span style="color:var(--text-3);font-size:11px">Call #${evt.callIndex + 1}</span>
              </div>
              <div>
                <span class="mono" style="color:#e879f9;font-weight:bold;font-size:12px;background:rgba(232,121,249,0.1);padding:3px 10px;border-radius:var(--radius-sm);border:1px solid rgba(232,121,249,0.25)">
                  Saved ${savedStr} (${savingsPct}%)
                </span>
              </div>
            </div>

            <!-- Banner Highlight -->
            <div style="background:rgba(232,121,249,0.08);border-bottom:1px solid rgba(255,255,255,0.12);padding:8px 14px;font-size:11px">
              <span style="color:#e879f9;font-weight:bold">✂️ EXACT BULK OUTPUT OFFLOADED TO DISK (scratch/${escHtml(evt.filename)}):</span>
              <div class="mono" style="margin-top:4px;background:rgba(255,255,255,0.06);color:#e879f9;padding:6px 10px;border-radius:var(--radius-sm);border-left:3px solid #e879f9;max-height:90px;overflow-y:auto;white-space:pre-wrap;word-break:break-all">
                ${escHtml(bannerText)}
              </div>
            </div>

            <!-- Side-by-Side Diff Panes -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border)">
              <div style="background:var(--bg-2);padding:10px 12px">
                <div style="font-weight:bold;font-size:10.5px;color:var(--red);margin-bottom:6px;display:flex;justify-content:space-between">
                  <span>🔴 RAW UNTRUNCATED OUTPUT (scratch/${escHtml(evt.filename)})</span>
                  <span class="mono">${rawSizeStr}</span>
                </div>
                <div class="mono pa-sbs-left" style="font-size:10.5px;line-height:1.45;color:var(--text-2);background:var(--bg-1);padding:8px;border-radius:var(--radius-sm);border:1px solid var(--border);max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-all">
                  ${escHtml(prefix.length > 150 ? '...' + prefix.substring(prefix.length - 150) : prefix)}
                  ${removedText ? `<span style="background:rgba(239,68,68,0.25);color:var(--red);font-weight:bold;padding:2px 4px;border-radius:2px">${escHtml(removedText.length > 500 ? removedText.substring(0, 500) + '\n... [' + (removedText.length - 500) + ' more chars]' : removedText)}</span>` : ''}
                  ${escHtml(suffix.length > 150 ? suffix.substring(0, 150) + '...' : suffix)}
                </div>
              </div>

              <div style="background:var(--bg-2);padding:10px 12px">
                <div style="font-weight:bold;font-size:10.5px;color:var(--green);margin-bottom:6px;display:flex;justify-content:space-between">
                  <span>🟢 RETAINED PROMPT PAYLOAD (Sent to LLM)</span>
                  <span class="mono">${promptSizeStr}</span>
                </div>
                <div class="mono pa-sbs-right" style="font-size:10.5px;line-height:1.45;color:var(--text-2);background:var(--bg-1);padding:8px;border-radius:var(--radius-sm);border:1px solid var(--border);max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-all">
                  ${escHtml(prefix.length > 150 ? '...' + prefix.substring(prefix.length - 150) : prefix)}
                  ${insertedText ? `<span style="background:rgba(34,197,94,0.25);color:var(--green);font-weight:bold;padding:2px 4px;border-radius:2px">${escHtml(insertedText.length > 500 ? insertedText.substring(0, 500) + '\n... [' + (insertedText.length - 500) + ' more chars]' : insertedText)}</span>` : ''}
                  ${escHtml(suffix.length > 150 ? suffix.substring(0, 150) + '...' : suffix)}
                </div>
              </div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;

  bindSynchronizedScroll(container);
}
