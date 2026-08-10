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

function fmtDelta(bytes) {
  if (bytes === 0) return '<span class="pa-delta-zero" title="No size change from previous call">±0</span>';
  if (bytes > 0) return `<span class="pa-delta-up" title="Request size expanded by ${fmtBytes(bytes)}">▲ +${fmtBytes(bytes)}</span>`;
  return `<span class="pa-delta-down" title="Request size reduced by ${fmtBytes(Math.abs(bytes))}">▼ ${fmtBytes(Math.abs(bytes))}</span>`;
}

function estimateTokens(bytes) {
  return Math.round(bytes / 4);
}

// ── State ──
let currentTaskId = null;
let analyticsData = null;
let selectedCallIndex = null;
let hoveredCallIndex = null;
let comparisonData = null;
let chartCanvas = null;

let chartSeries = {
  requestSize: true,
  cacheReads: true,
  cacheWrites: true,
};

// ── Main Render ──
export async function renderPromptAnalytics(container, params) {
  const taskIdFromUrl = params?.get('task') || null;

  let tasks = [];
  try {
    const result = await api.tasks({ limit: 50, page: 1 });
    tasks = result.tasks || [];
  } catch (e) {
    console.error('Failed to load tasks:', e);
  }

  container.innerHTML = `
    <div class="view-header">
      <h1 class="view-title">🔬 Prompt Analytics & Context Reduction</h1>
      <p class="view-subtitle">Inspect how historical prompt content is trimmed across API requests</p>
    </div>

    <!-- Task Selector -->
    <div class="panel pa-selector-panel">
      <div class="panel-body" style="padding:12px 16px">
        <div class="pa-selector-row">
          <label class="pa-label">Select Task</label>
          <select id="pa-task-select" class="filter-select pa-task-select">
            <option value="">— Choose a task to analyze —</option>
            ${tasks.map(t => `
              <option value="${t.id}" ${t.id === taskIdFromUrl ? 'selected' : ''}>
                ${escHtml(t.first_message ? t.first_message.substring(0, 80) : 'Task ' + t.id)} 
                (${t.api_call_count || 0} calls, ${fmtCost(t.total_cost)})
              </option>
            `).join('')}
          </select>
          <button id="pa-load-btn" class="action-btn primary pa-load-btn">Analyze Task</button>
        </div>
      </div>
    </div>

    <!-- Content -->
    <div id="pa-content">
      ${taskIdFromUrl ? '<div class="loading-state"><div class="spinner"></div><p>Loading prompt analytics...</p></div>' : `
        <div class="empty-state" style="margin-top:40px">
          <div class="icon">🔬</div>
          <p>Select a task above to analyze its prompt history and context reductions</p>
        </div>
      `}
    </div>
  `;

  document.getElementById('pa-load-btn')?.addEventListener('click', () => {
    const select = document.getElementById('pa-task-select');
    const taskId = select?.value;
    if (taskId) {
      window.location.hash = `#/prompt-analytics?task=${taskId}`;
    }
  });

  document.getElementById('pa-task-select')?.addEventListener('change', (e) => {
    if (e.target.value) {
      window.location.hash = `#/prompt-analytics?task=${e.target.value}`;
    }
  });

  if (taskIdFromUrl) {
    await loadTaskAnalytics(taskIdFromUrl);
  }
}

async function loadTaskAnalytics(taskId) {
  currentTaskId = taskId;
  selectedCallIndex = null;
  hoveredCallIndex = null;
  comparisonData = null;

  const contentEl = document.getElementById('pa-content');
  if (!contentEl) return;

  contentEl.innerHTML = '<div class="loading-state"><div class="spinner"></div><p>Loading prompt analytics...</p></div>';

  try {
    analyticsData = await api.promptAnalytics(taskId);
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

  const calls = analyticsData.apiCalls;
  const pruneCall = calls.slice().reverse().find(c => c.hasPruning || c.trimmedFromPrevBytes > 1000);
  selectedCallIndex = pruneCall ? pruneCall.index : calls.length - 1;

  renderAnalytics(contentEl);
}

function renderAnalytics(contentEl) {
  const data = analyticsData;
  const calls = data.apiCalls;

  const totalCost = calls.reduce((s, c) => s + c.cost, 0);
  const totalTokensIn = calls.reduce((s, c) => s + c.tokensIn, 0);
  const totalTokensOut = calls.reduce((s, c) => s + c.tokensOut, 0);
  const maxSize = Math.max(...calls.map(c => c.requestSize));
  const pruningCallsCount = calls.filter(c => c.hasPruning || c.trimmedFromPrevBytes > 100).length;
  const totalBytesPruned = calls.reduce((s, c) => s + (c.trimmedFromPrevBytes || 0), 0);

  contentEl.innerHTML = `
    <!-- Summary Cards -->
    <div class="pa-summary-grid">
      <div class="pa-card" title="Total chat/completions API requests sent during this task session">
        <div class="pa-card-label">Total API Calls ℹ️</div>
        <div class="pa-card-value">${calls.length}</div>
        <div class="pa-card-sub">${data.totalMessages} messages total</div>
      </div>
      <div class="pa-card" title="Peak prompt payload size in bytes sent to the model context window">
        <div class="pa-card-label">Max Request Size ℹ️</div>
        <div class="pa-card-value">${fmtBytes(maxSize)}</div>
        <div class="pa-card-sub">~${fmtTokens(estimateTokens(maxSize))} tokens</div>
      </div>
      <div class="pa-card" title="Number of requests where context optimization trimmed historical prompt content from previous turns">
        <div class="pa-card-label">Context Pruning Turns ℹ️</div>
        <div class="pa-card-value pa-highlight-green">${pruningCallsCount}</div>
        <div class="pa-card-sub">${fmtBytes(totalBytesPruned)} total pruned</div>
      </div>
      <div class="pa-card" title="Total API cost calculated for input and output tokens">
        <div class="pa-card-label">Total Cost ℹ️</div>
        <div class="pa-card-value">${fmtCost(totalCost)}</div>
        <div class="pa-card-sub">${fmtTokens(totalTokensIn)} in / ${fmtTokens(totalTokensOut)} out</div>
      </div>
    </div>

    <!-- Timeline Chart -->
    <div class="panel pa-chart-panel">
      <div class="panel-title">
        <span>📊 Request Size Timeline <span style="font-size:11px;color:var(--text-3);font-weight:normal;margin-left:6px">(Green bars = Context Pruning on previous content | Click any bar to inspect)</span></span>
        <div class="pa-chart-legend">
          <button class="pa-legend-chip ${chartSeries.requestSize ? 'active' : ''}" data-series="requestSize">
            <span class="pa-legend-color" style="background:#38bdf8"></span> Request Size (Bars)
          </button>
          <button class="pa-legend-chip ${chartSeries.cacheReads ? 'active' : ''}" data-series="cacheReads">
            <span class="pa-legend-color" style="background:#10b981"></span> Cache Reads
          </button>
          <button class="pa-legend-chip ${chartSeries.cacheWrites ? 'active' : ''}" data-series="cacheWrites">
            <span class="pa-legend-color" style="background:#f59e0b"></span> Cache Writes
          </button>
        </div>
      </div>
      <div class="panel-body">
        <div class="pa-chart-container" style="position:relative">
          <canvas id="pa-timeline-chart"></canvas>
          <div id="pa-chart-tooltip" class="pa-chart-tooltip" style="display:none;pointer-events:none;z-index:100;position:absolute"></div>
        </div>
      </div>
    </div>

    <!-- Context Pruning & Content Comparison Section -->
    <div id="pa-comparison-section" class="panel pa-comparison-panel-full">
      <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center">
        <span id="pa-comp-heading">✂️ Context Reduction Analysis</span>
        <div id="pa-comp-select-wrapper"></div>
      </div>
      <div id="pa-comparison-body" class="panel-body" style="padding:16px">
        <div class="loading-state"><div class="spinner"></div><p>Loading pruning analysis...</p></div>
      </div>
    </div>
  `;

  bindAnalyticsEvents(calls);
  drawTimelineChart(calls);

  if (selectedCallIndex !== null) {
    loadComparisonForCall(selectedCallIndex, calls);
  }
}

async function loadComparisonForCall(callIndex, calls) {
  selectedCallIndex = callIndex;
  const compBody = document.getElementById('pa-comparison-body');
  const compHeading = document.getElementById('pa-comp-heading');
  const selectWrapper = document.getElementById('pa-comp-select-wrapper');

  if (!compBody) return;

  const currentCall = calls[callIndex];
  const prevIndex = callIndex > 0 ? callIndex - 1 : 0;
  const prevCall = calls[prevIndex];

  if (compHeading) {
    compHeading.innerHTML = `✂️ Context Reduction Analysis: <strong style="color:#38bdf8">Call #${callIndex + 1}</strong> vs <strong style="color:var(--text-2)">Call #${prevIndex + 1}</strong>`;
  }

  if (selectWrapper) {
    selectWrapper.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px">
        <label style="font-size:11px;color:var(--text-3)">Jump to Request:</label>
        <select id="pa-call-jump-select" class="filter-select" style="font-size:11px;padding:2px 8px">
          ${calls.map((c, i) => `
            <option value="${i}" ${i === callIndex ? 'selected' : ''}>
              Call #${i + 1} — ${fmtBytes(c.requestSize)} ${c.hasPruning ? '(✂️ ' + fmtBytes(c.trimmedFromPrevBytes) + ' pruned)' : ''}
            </option>
          `).join('')}
        </select>
      </div>
    `;

    document.getElementById('pa-call-jump-select')?.addEventListener('change', (e) => {
      const newIdx = parseInt(e.target.value);
      loadComparisonForCall(newIdx, calls);
    });
  }

  compBody.innerHTML = '<div class="loading-state" style="padding:20px"><div class="spinner"></div><p>Analyzing context reduction...</p></div>';

  try {
    comparisonData = await api.promptCompare(currentTaskId, prevIndex, callIndex);
    renderDetailedComparison(compBody, currentCall, prevCall, callIndex, prevIndex);
  } catch (e) {
    compBody.innerHTML = `<div class="empty-state"><p style="color:var(--red)">Failed to load comparison: ${escHtml(e.message)}</p></div>`;
  }
}

function renderDetailedComparison(body, currentCall, prevCall, callIndex, prevIndex) {
  const d = comparisonData;
  if (!d) return;

  const { call1, call2, pruningSummary, trimmedItems, addedItems } = d;
  const bytesSaved = pruningSummary?.bytesSaved || 0;
  const percentSaved = pruningSummary?.percentSaved || '0.0';

  const meaningfulTrimmed = trimmedItems.filter(item => item.bytesSaved > 10);

  body.innerHTML = `
    <!-- Top Stats Row -->
    <div class="pa-comp-stat-grid" style="margin-bottom:16px;background:var(--bg-3);padding:14px;border-radius:var(--radius-sm);border:1px solid var(--border)">
      <div class="pa-comp-stat">
        <span class="pa-comp-stat-label">Request #${prevIndex + 1} Total Payload</span>
        <span class="pa-comp-stat-value">${fmtBytes(call1.requestSize)}</span>
        <span class="pa-comp-stat-sub">${call1.messageCount} messages</span>
      </div>
      <div class="pa-comp-arrow">→</div>
      <div class="pa-comp-stat">
        <span class="pa-comp-stat-label">Request #${prevIndex + 1} Content in Request #${callIndex + 1}</span>
        <span class="pa-comp-stat-value" style="color:${bytesSaved > 0 ? 'var(--green)' : 'var(--text)'}">${fmtBytes(pruningSummary.req1ContentAfterPruning)}</span>
        <span class="pa-comp-stat-sub">${bytesSaved > 0 ? 'Trimmed by ' + percentSaved + '%' : 'Unmodified'}</span>
      </div>
      <div class="pa-comp-stat pa-comp-delta">
        <span class="pa-comp-stat-label">Bytes Saved by Pruning</span>
        <span class="pa-comp-stat-value" style="color:var(--green)">
          ${bytesSaved > 0 ? `✂️ -${fmtBytes(bytesSaved)}` : '±0 B'}
        </span>
        <span class="pa-comp-stat-sub">~${estimateTokens(bytesSaved).toLocaleString()} tokens saved</span>
      </div>
    </div>

    <!-- Side-by-Side Comparison Section -->
    <div style="margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="font-weight:bold;font-size:12px;color:var(--text)">
          ✂️ What Was Trimmed / Reduced from Request #${prevIndex + 1}'s Content in Request #${callIndex + 1} (${meaningfulTrimmed.length} items):
        </span>
        ${bytesSaved > 0 ? `
          <span style="font-size:11px;color:var(--green);font-weight:bold">
            Saved ${fmtBytes(bytesSaved)} (${percentSaved}% reduction on previous prompt payload)
          </span>
        ` : ''}
      </div>

      ${meaningfulTrimmed.length === 0 ? `
        <div style="background:var(--bg-3);padding:14px;border-radius:var(--radius-sm);border:1px solid var(--border);color:var(--text-3);font-size:11.5px">
          ✓ No items from Request #${prevIndex + 1}'s content were modified or trimmed in Request #${callIndex + 1}. Previous messages were kept intact.
        </div>
      ` : `
        <div style="display:flex;flex-direction:column;gap:14px">
          ${meaningfulTrimmed.map(item => renderSideBySideComparisonCard(item, prevIndex, callIndex)).join('')}
        </div>
      `}
    </div>

    <!-- Secondary Section: New Turn Additions in Request N -->
    <div style="background:var(--bg-3);padding:12px 14px;border-radius:var(--radius-sm);border:1px solid var(--border)">
      <div style="font-weight:600;font-size:11px;color:var(--text);margin-bottom:8px;display:flex;justify-content:space-between">
        <span>➕ New Turn Additions in Request #${callIndex + 1} (${addedItems.length} new messages)</span>
        <span class="mono" style="color:#38bdf8;font-size:10.5px">+${fmtBytes(addedItems.reduce((s, a) => s + a.size, 0))} new content</span>
      </div>
      ${addedItems.length === 0 ? `
        <span style="font-size:11px;color:var(--text-3)">No new messages added in this turn.</span>
      ` : `
        <div style="display:flex;flex-direction:column;gap:6px">
          ${addedItems.map(item => `
            <div style="background:var(--bg-2);padding:8px 10px;border-radius:var(--radius-sm);border:1px solid var(--border)">
              <div style="display:flex;justify-content:space-between;align-items:center;font-size:10.5px;margin-bottom:4px">
                <span style="font-weight:bold;color:#38bdf8">+ msg[${item.index}] <span style="text-transform:uppercase;color:var(--accent-2)">(${item.role})</span></span>
                <span class="mono" style="color:var(--text-3)">${fmtBytes(item.size)}</span>
              </div>
              <code class="pa-diff-code" style="max-height:50px;font-size:10px">${escHtml(item.preview)}</code>
            </div>
          `).join('')}
        </div>
      `}
    </div>
  `;

  bindSynchronizedScroll(body);
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

function renderSideBySideComparisonCard(item, prevIndex, callIndex) {
  const diff = item.diffChunks || {};
  const prefix = diff.prefix || '';
  const suffix = diff.suffix || '';
  const removedText = diff.removedText || '(Whole message removed)';
  const insertedText = diff.insertedText || '';

  return `
    <div class="pa-sbs-card panel" style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;background:var(--bg-2)">
      <!-- Card Header -->
      <div style="background:var(--bg-3);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)">
        <div>
          <strong style="color:var(--text);font-size:12px">msg[${item.index}]</strong>
          <span style="text-transform:uppercase;font-weight:700;color:var(--accent-2);margin-left:6px;font-size:10.5px">(${item.role})</span>
          <span style="color:var(--text-3);margin-left:10px;font-size:11px">Request #${prevIndex + 1} → Request #${callIndex + 1}</span>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <span class="mono" style="color:var(--green);font-weight:bold;font-size:12px;background:rgba(34,197,94,0.12);padding:3px 10px;border-radius:var(--radius-sm);border:1px solid rgba(34,197,94,0.3)">
            ✂️ Saved ${fmtBytes(item.bytesSaved)} (${fmtBytes(item.before.size)} → ${fmtBytes(item.after.size)})
          </span>
        </div>
      </div>

      <!-- Isolated Removed Chunk Highlight Banner -->
      <div style="background:rgba(239,68,68,0.08);border-bottom:1px solid rgba(239,68,68,0.25);padding:8px 14px;font-size:11px">
        <span style="color:var(--red);font-weight:bold">✂️ EXACT CONTENT REMOVED FROM REQUEST #${prevIndex + 1}:</span>
        <div class="mono" style="margin-top:4px;background:rgba(239,68,68,0.15);color:var(--red);padding:6px 10px;border-radius:var(--radius-sm);border-left:3px solid var(--red);max-height:90px;overflow-y:auto;white-space:pre-wrap;word-break:break-all">
          ${escHtml(removedText)}
        </div>
      </div>

      <!-- 2-Column Side-by-Side Synchronized Scroll Comparison -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border)">
        <!-- Left Column: Request N-1 -->
        <div style="background:var(--bg-2);padding:10px 12px">
          <div style="font-weight:bold;font-size:10.5px;color:var(--red);margin-bottom:6px;display:flex;justify-content:space-between">
            <span>🔴 BEFORE in Request #${prevIndex + 1} (Original)</span>
            <span class="mono">${fmtBytes(item.before.size)}</span>
          </div>
          <div class="mono pa-sbs-left" style="font-size:10.5px;line-height:1.45;color:var(--text-2);background:var(--bg-1);padding:8px;border-radius:var(--radius-sm);border:1px solid var(--border);max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-all">
            ${escHtml(prefix)}
            <span style="background:rgba(239,68,68,0.25);color:var(--red);font-weight:bold;padding:2px 4px;border-radius:2px">${escHtml(removedText)}</span>
            ${escHtml(suffix)}
          </div>
        </div>

        <!-- Right Column: Request N -->
        <div style="background:var(--bg-2);padding:10px 12px">
          <div style="font-weight:bold;font-size:10.5px;color:var(--green);margin-bottom:6px;display:flex;justify-content:space-between">
            <span>🟢 AFTER in Request #${callIndex + 1} (Sent Payload)</span>
            <span class="mono">${fmtBytes(item.after.size)}</span>
          </div>
          <div class="mono pa-sbs-right" style="font-size:10.5px;line-height:1.45;color:var(--text-2);background:var(--bg-1);padding:8px;border-radius:var(--radius-sm);border:1px solid var(--border);max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-all">
            ${escHtml(prefix)}
            ${insertedText ? `<span style="background:rgba(34,197,94,0.25);color:var(--green);font-weight:bold;padding:2px 4px;border-radius:2px">${escHtml(insertedText)}</span>` : ''}
            ${escHtml(suffix)}
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Timeline Canvas Drawing ──
function drawTimelineChart(calls) {
  const canvas = document.getElementById('pa-timeline-chart');
  if (!canvas) return;
  chartCanvas = canvas;

  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();

  canvas.width = rect.width * dpr;
  canvas.height = 260 * dpr;
  canvas.style.width = rect.width + 'px';
  canvas.style.height = '260px';
  ctx.scale(dpr, dpr);

  const w = rect.width;
  const h = 260;
  const pad = { top: 25, right: 30, bottom: 40, left: 70 };
  const chartW = w - pad.left - pad.right;
  const chartH = h - pad.top - pad.bottom;

  const isDark = document.documentElement.getAttribute('data-theme') !== 'light';
  ctx.fillStyle = isDark ? '#111827' : '#ffffff';
  ctx.fillRect(0, 0, w, h);

  if (calls.length === 0) return;

  const sizes = calls.map(c => c.requestSize);
  const cacheReads = calls.map(c => c.cacheReads);
  const cacheWrites = calls.map(c => c.cacheWrites);
  const maxSize = Math.max(...sizes, 1);
  const maxCache = Math.max(...cacheReads, ...cacheWrites, 1);

  const yScale = chartH / maxSize;
  const yCacheScale = chartH / maxCache;

  ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.06)';
  ctx.lineWidth = 1;
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (chartH / 5) * i;
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();
  }

  ctx.fillStyle = isDark ? 'rgba(255,255,255,0.5)' : 'rgba(0,0,0,0.5)';
  ctx.font = '10px Inter, sans-serif';
  ctx.textAlign = 'right';
  for (let i = 0; i <= 5; i++) {
    const y = pad.top + (chartH / 5) * i;
    const val = maxSize - (maxSize / 5) * i;
    ctx.fillText(fmtBytes(val), pad.left - 8, y + 3);
  }

  const colWidth = chartW / calls.length;
  const barWidth = Math.max(3, Math.min(20, colWidth - 2));

  const points = [];

  for (let i = 0; i < calls.length; i++) {
    const x = pad.left + i * colWidth + colWidth / 2;
    const barH = Math.max(2, sizes[i] * yScale);
    const barY = pad.top + chartH - barH;

    const readY = pad.top + chartH - (cacheReads[i] * yCacheScale);
    const writeY = pad.top + chartH - (cacheWrites[i] * yCacheScale);

    points.push({ x, barY, barH, readY, writeY, call: calls[i], index: i });

    if (hoveredCallIndex === i) {
      ctx.fillStyle = isDark ? 'rgba(56, 189, 248, 0.12)' : 'rgba(14, 165, 233, 0.1)';
      ctx.fillRect(pad.left + i * colWidth, pad.top, colWidth, chartH);
    }

    if (chartSeries.requestSize) {
      const hasHistoricalPruning = calls[i].hasPruning || calls[i].trimmedFromPrevBytes > 100;
      const isSelected = selectedCallIndex === i;
      const isHovered = hoveredCallIndex === i;

      const grad = ctx.createLinearGradient(x - barWidth / 2, barY, x - barWidth / 2, pad.top + chartH);

      if (hasHistoricalPruning) {
        grad.addColorStop(0, '#10b981');
        grad.addColorStop(1, 'rgba(16,185,129,0.35)');
      } else {
        grad.addColorStop(0, '#38bdf8');
        grad.addColorStop(1, 'rgba(14,165,233,0.2)');
      }

      ctx.fillStyle = grad;
      ctx.fillRect(x - barWidth / 2, barY, barWidth, barH);

      if (isSelected || isHovered) {
        ctx.strokeStyle = isSelected ? '#ffffff' : '#38bdf8';
        ctx.lineWidth = isSelected ? 2 : 1.5;
        ctx.strokeRect(x - barWidth / 2 - 1, barY - 1, barWidth + 2, barH + 2);
      }
    }

    const step = Math.max(1, Math.floor(calls.length / 15));
    if (i % step === 0 || i === calls.length - 1) {
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';
      ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), x, h - pad.bottom + 16);
    }
  }

  if (chartSeries.cacheReads && points.length > 0) {
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 2;
    ctx.beginPath();
    let started = false;

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (!started) {
        ctx.moveTo(pt.x, Math.max(pt.readY, pad.top));
        started = true;
      } else {
        ctx.lineTo(pt.x, Math.max(pt.readY, pad.top));
      }
    }
    ctx.stroke();

    for (const pt of points) {
      if (pt.call.cacheReads > 0) {
        ctx.fillStyle = '#10b981';
        ctx.beginPath();
        ctx.arc(pt.x, Math.max(pt.readY, pad.top), 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  if (chartSeries.cacheWrites && points.length > 0) {
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    let started = false;

    for (let i = 0; i < points.length; i++) {
      const pt = points[i];
      if (!started) {
        ctx.moveTo(pt.x, Math.max(pt.writeY, pad.top));
        started = true;
      } else {
        ctx.lineTo(pt.x, Math.max(pt.writeY, pad.top));
      }
    }
    ctx.stroke();
    ctx.setLineDash([]);

    for (const pt of points) {
      if (pt.call.cacheWrites > 0) {
        ctx.fillStyle = '#f59e0b';
        const s = 5;
        const wy = Math.max(pt.writeY, pad.top);
        ctx.fillRect(pt.x - s / 2, wy - s / 2, s, s);
      }
    }
  }

  ctx.fillStyle = isDark ? 'rgba(255,255,255,0.4)' : 'rgba(0,0,0,0.4)';
  ctx.font = '11px Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('API Call #', w / 2, h - 6);

  canvas._chartPoints = points;
  canvas._barWidth = barWidth;
  canvas._chartMeta = { chartW, padLeft: pad.left, padTop: pad.top, chartH };
}

function bindAnalyticsEvents(calls) {
  document.querySelectorAll('.pa-legend-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      const seriesKey = chip.dataset.series;
      if (seriesKey) {
        chartSeries[seriesKey] = !chartSeries[seriesKey];
        chip.classList.toggle('active', chartSeries[seriesKey]);
        drawTimelineChart(calls);
      }
    });
  });

  const chartEl = document.getElementById('pa-timeline-chart');
  if (chartEl) {
    chartEl.addEventListener('mousemove', (e) => {
      handleChartHover(e, calls);
    });
    chartEl.addEventListener('mouseleave', () => {
      hoveredCallIndex = null;
      drawTimelineChart(calls);
      const tooltip = document.getElementById('pa-chart-tooltip');
      if (tooltip) tooltip.style.display = 'none';
    });
    chartEl.addEventListener('click', (e) => {
      handleChartClick(e, calls);
    });
  }
}

function handleChartHover(e, calls) {
  const canvas = chartCanvas;
  const tooltip = document.getElementById('pa-chart-tooltip');
  if (!canvas || !canvas._chartMeta || !tooltip) return;

  const rect = canvas.getBoundingClientRect();
  const mouseX = e.clientX - rect.left;
  const mouseY = e.clientY - rect.top;

  const { chartW, padLeft } = canvas._chartMeta;
  if (mouseX < padLeft || mouseX > padLeft + chartW) {
    if (hoveredCallIndex !== null) {
      hoveredCallIndex = null;
      drawTimelineChart(calls);
    }
    tooltip.style.display = 'none';
    return;
  }

  const colWidth = chartW / calls.length;
  let colIdx = Math.floor((mouseX - padLeft) / colWidth);
  colIdx = Math.max(0, Math.min(calls.length - 1, colIdx));

  if (hoveredCallIndex !== colIdx) {
    hoveredCallIndex = colIdx;
    drawTimelineChart(calls);
  }

  const foundPt = canvas._chartPoints[colIdx];
  if (!foundPt) return;

  const c = foundPt.call;
  const prunedStr = c.trimmedFromPrevBytes > 0 ? `✂️ Context Pruned: <strong>${fmtBytes(c.trimmedFromPrevBytes)}</strong> from previous content` : 'No context pruning on previous content';

  tooltip.style.display = 'block';

  const tooltipWidth = 240;
  if (mouseX > rect.width / 2) {
    tooltip.style.left = `${Math.max(10, mouseX - tooltipWidth - 15)}px`;
  } else {
    tooltip.style.left = `${Math.min(mouseX + 15, rect.width - tooltipWidth - 10)}px`;
  }
  tooltip.style.top = `${Math.max(10, Math.min(mouseY - 30, rect.height - 120))}px`;

  tooltip.innerHTML = `
    <div style="font-weight:bold;color:var(--text);margin-bottom:4px;display:flex;justify-space-between">
      <span>API Call #${foundPt.index + 1}</span>
      <span style="color:var(--text-3);font-weight:normal">${fmtTime(c.ts)}</span>
    </div>
    <div style="color:#38bdf8;font-weight:600">📦 Total Request Size: <strong>${fmtBytes(c.requestSize)}</strong></div>
    <div style="font-size:10.5px;color:var(--green);margin-top:3px">${prunedStr}</div>
    <div style="font-size:10px;color:var(--text-3);margin-top:2px">Net Delta: ${fmtDelta(c.sizeDelta)}</div>
    <div style="font-size:10px;color:var(--text-2);margin-top:2px">Cost: <strong>${fmtCost(c.cost)}</strong></div>
    <div style="font-size:9.5px;color:var(--accent-2);margin-top:4px;font-weight:bold">👉 Click bar to inspect what was trimmed</div>
  `;
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

  selectedCallIndex = colIdx;
  drawTimelineChart(calls);
  loadComparisonForCall(colIdx, calls);
}
