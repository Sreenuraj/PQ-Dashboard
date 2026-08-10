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

// ── State ──
let currentTaskId = null;
let analyticsData = null;

let hoveredCallIndex = null;
let chartCanvas = null;

let activeCategoryFilter = 'ALL';

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
      <h1 class="view-title">🔬 Prompt Observability & Context Reduction</h1>
      <p class="view-subtitle">Executive summary and chronological trace of content pruned from LLM context windows</p>
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
  hoveredCallIndex = null;

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

  renderAnalytics(contentEl);
}

function renderAnalytics(contentEl) {
  const data = analyticsData;
  const calls = data.apiCalls;
  const cats = data.reductionCategories || {};
  const events = data.reductionEvents || [];

  const fileSaved = (cats.truncatedFiles || []).reduce((s, f) => s + f.bytesSaved, 0);
  const cmdSaved = (cats.truncatedCommands || []).reduce((s, c) => s + c.bytesSaved, 0);
  const envSaved = cats.environmentSnapshots?.bytesSaved || 0;

  contentEl.innerHTML = `
    <!-- Top Executive Pruning Category Summary Grid -->
    <div style="margin-bottom:16px">
      <div style="font-weight:bold;font-size:12.5px;color:var(--text);margin-bottom:10px">
        📌 Executive Context Reduction Summary — What Was Pruned During Task:
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
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
      </div>
    </div>

    <!-- Timeline Chart -->
    <div class="panel pa-chart-panel">
      <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center">
        <div>
          <span>📊 Request Size & Cache Timeline</span>
          <span style="font-size:11px;color:var(--text-3);font-weight:normal;margin-left:6px">
            (Toggle legends below to switch view modes | Click bars to inspect)
          </span>
        </div>
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

    <!-- Chronological Reduction Sequence Feed & Comparison Section -->
    <div id="pa-comparison-section" class="panel pa-comparison-panel-full" style="display:${chartSeries.requestSize ? 'block' : 'none'}">
      <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <span>📜 Chronological Context Reduction Sequence (${events.length} total events)</span>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="display:flex;align-items:center;gap:6px;font-size:11px">
            <span style="color:var(--text-3)">Category Filter:</span>
            <button class="action-btn secondary pa-cat-filter ${activeCategoryFilter === 'ALL' ? 'active' : ''}" data-cat="ALL" style="padding:2px 8px;font-size:10.5px">All (${events.length})</button>
            <button class="action-btn secondary pa-cat-filter ${activeCategoryFilter === 'FILE' ? 'active' : ''}" data-cat="FILE" style="padding:2px 8px;font-size:10.5px">Files (${events.filter(e => e.category === 'File Read Truncated').length})</button>
            <button class="action-btn secondary pa-cat-filter ${activeCategoryFilter === 'CMD' ? 'active' : ''}" data-cat="CMD" style="padding:2px 8px;font-size:10.5px">Commands (${events.filter(e => e.category === 'Terminal Output Truncated').length})</button>
            <button class="action-btn secondary pa-cat-filter ${activeCategoryFilter === 'ENV' ? 'active' : ''}" data-cat="ENV" style="padding:2px 8px;font-size:10.5px">Env Snapshots (${events.filter(e => e.category === 'Stale Environment Snapshot Removed').length})</button>
          </div>
        </div>
      </div>
      <div id="pa-comparison-body" class="panel-body" style="padding:16px">
        <div class="loading-state"><div class="spinner"></div><p>Loading chronological reduction sequence...</p></div>
      </div>
    </div>

    <!-- Dedicated Cache Observability & Savings Panel -->
    <div id="pa-cache-section" class="panel pa-comparison-panel-full" style="display:${!chartSeries.requestSize && (chartSeries.cacheReads || chartSeries.cacheWrites) ? 'block' : 'none'}">
      <div class="panel-title" style="display:flex;justify-content:space-between;align-items:center">
        <span>⚡ Prompt Cache Observability & Financial Savings</span>
        <div id="pa-cache-model-badge"></div>
      </div>
      <div id="pa-cache-body" class="panel-body" style="padding:16px">
        <!-- Rendered dynamically -->
      </div>
    </div>
  `;

  bindAnalyticsEvents(calls);
  drawTimelineChart(calls);

  renderReductionSequenceFeed(document.getElementById('pa-comparison-body'), events);
  renderCacheObservabilityPanel(document.getElementById('pa-cache-body'), calls);
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

/**
 * Builds paired rows for a TRUE two-column side-by-side prompt diff (unlike
 * the old unified +/- stacked view). Context lines pair 1:1; the changed
 * block pairs removed[j] with added[j] by index.
 * ponytail: index-pairing, not a real LCS/Myers line diff — good enough for
 * readable side-by-side; upgrade if misaligned pairing on reordered lines
 * becomes a complaint.
 */
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

/**
 * TRUE two-column side-by-side prompt diff (replaces the old unified
 * stacked +/- view used in the Cache table's expandable row).
 */
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

/**
 * Renders a banner explaining WHY a call had (or didn't have) a cache
 * read/write — model swap, TTL expiry, prefix invalidation, first call, etc.
 * Comes straight from the server's computeCacheExplanation().
 */
/**
 * Renders the real system prompt text (cross-referenced live from the
 * Network Inspector's in-memory proxy buffer, since it's never persisted
 * to any task file) when available, or an explanatory note when it isn't
 * (proxy wasn't running, buffer already evicted the record, etc).
 */
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
      <span><strong style="color:var(--text-2)">System prompt not shown:</strong> it's generated in-memory by the extension and never persisted to any task file. It's only recoverable live via the Network Inspector proxy, and no matching captured request was found in its buffer for this call (proxy wasn't running at the time, or the record has since been evicted).</span>
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
  // Unconfirmed guesses get an amber "unverified" treatment instead of the
  // confident blue used for evidenced explanations — don't let a guess look
  // as certain as a fact backed by actual log evidence.
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


/**
 * Renders a banner above the diff explaining WHY the prompt changed:
 * a model swap and/or a likely context condensation/reset — the two
 * causes that a raw text diff alone can't explain.
 */
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
          <strong>${sizeDropPct}%</strong> with early-conversation content (system context, task setup) rewritten, not just
          tail-end tool output trimmed. This usually means the framework compacted/summarized the running history.
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

function buildUnifiedDiffRows(beforeText, afterText) {
  const beforeLines = splitPromptLines(beforeText);
  const afterLines = splitPromptLines(afterText);

  if (beforeText === afterText) {
    return [
      { type: 'file', text: '--- prompt-before' },
      { type: 'file', text: '+++ prompt-after' },
      { type: 'note', text: 'No prompt text changed between these two calls.' },
    ];
  }

  let prefixLen = 0;
  const maxPrefix = Math.min(beforeLines.length, afterLines.length);
  while (prefixLen < maxPrefix && beforeLines[prefixLen] === afterLines[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  const maxSuffix = Math.min(beforeLines.length - prefixLen, afterLines.length - prefixLen);
  while (
    suffixLen < maxSuffix &&
    beforeLines[beforeLines.length - 1 - suffixLen] === afterLines[afterLines.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const context = 8;
  const beforeChangeEnd = beforeLines.length - suffixLen;
  const afterChangeEnd = afterLines.length - suffixLen;
  const contextStart = Math.max(0, prefixLen - context);
  const suffixBeforeStart = beforeChangeEnd;
  const suffixAfterStart = afterChangeEnd;
  const suffixVisible = Math.min(context, suffixLen);
  const rows = [
    { type: 'file', text: '--- prompt-before' },
    { type: 'file', text: '+++ prompt-after' },
  ];

  if (contextStart > 0) rows.push({ type: 'skip', text: `... ${contextStart} unchanged lines hidden ...` });

  for (let i = contextStart; i < prefixLen; i++) {
    rows.push({ type: 'ctx', oldLine: i + 1, newLine: i + 1, text: beforeLines[i] });
  }

  for (let i = prefixLen; i < beforeChangeEnd; i++) {
    rows.push({ type: 'del', oldLine: i + 1, newLine: '', text: beforeLines[i] });
  }

  for (let i = prefixLen; i < afterChangeEnd; i++) {
    rows.push({ type: 'add', oldLine: '', newLine: i + 1, text: afterLines[i] });
  }

  for (let i = 0; i < suffixVisible; i++) {
    rows.push({
      type: 'ctx',
      oldLine: suffixBeforeStart + i + 1,
      newLine: suffixAfterStart + i + 1,
      text: beforeLines[suffixBeforeStart + i],
    });
  }

  if (suffixLen > suffixVisible) rows.push({ type: 'skip', text: `... ${suffixLen - suffixVisible} unchanged lines hidden ...` });

  return rows;
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

function renderInlinePromptDiff(container, comp, prevIdx, idx) {
  container.innerHTML = renderInlinePromptDiffMarkup(comp, prevIdx, idx);
  bindSynchronizedScroll(container);
}

function renderInlinePromptDiffMarkup(comp, prevIdx, idx) {
  if (!comp) return '';

  const trimmedItems = comp.trimmedItems || [];

  if (trimmedItems.length === 0) {
    return `
      <div style="background:var(--bg-3);padding:10px 14px;border-radius:var(--radius-sm);font-size:11px;color:var(--text-3)">
        ✓ Call #${idx + 1}'s prompt prefix matched Call #${prevIdx + 1} exactly. No message content was pruned or modified.
      </div>
    `;
  }

  return `
    <div style="font-weight:bold;font-size:11.5px;color:var(--text);margin-bottom:8px">
      🔍 Prompt Content Comparison (Call #${prevIdx + 1} vs Call #${idx + 1}):
    </div>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${trimmedItems.map(item => renderDiffBoxMarkup(item, prevIdx, idx)).join('')}
    </div>
  `;
}

function renderFullPromptComparison(comp, prevIdx, idx) {
  if (!comp) return '';

  const changedItems = comp.changedItems || [];
  const addedItems = comp.addedItems || [];
  const removedItems = comp.removedItems || [];
  const hasChanges = changedItems.length > 0 || addedItems.length > 0 || removedItems.length > 0;
  const beforeSize = comp.call1?.requestSize || comp.prompt1?.requestSize || 0;
  const afterSize = comp.call2?.requestSize || comp.prompt2?.requestSize || 0;
  const delta = afterSize - beforeSize;
  const deltaText = delta >= 0 ? `+${fmtBytes(delta)}` : `-${fmtBytes(Math.abs(delta))}`;
  const deltaColor = delta >= 0 ? '#f59e0b' : 'var(--green)';

  if (!hasChanges) {
    return `
      <div style="background:var(--bg-3);padding:10px 14px;border-radius:var(--radius-sm);font-size:11px;color:var(--text-3)">
        Cache creation was recorded, but the reconstructed prompt body matched the previous call.
      </div>
    `;
  }

  return `
    <div style="background:var(--bg-2);border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden">
      <div style="background:var(--bg-3);padding:10px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:12px">
        <div>
          <div style="font-weight:bold;font-size:11.5px;color:#f59e0b">✍️ Cache Creation Prompt Comparison</div>
          <div style="font-size:10.5px;color:var(--text-3);margin-top:2px">Full effective prompt before and after cache creation, excluding the initial prompt case.</div>
        </div>
        <div class="mono" style="font-size:11px;color:${deltaColor};font-weight:bold">
          Call #${prevIdx + 1} ${fmtBytes(beforeSize)} → Call #${idx + 1} ${fmtBytes(afterSize)} (${deltaText})
        </div>
      </div>
      <div style="padding:12px;display:flex;flex-direction:column;gap:10px">
        ${changedItems.map(item => renderDiffBoxMarkup(item, prevIdx, idx)).join('')}
        ${addedItems.map(item => renderAddedPromptMessageMarkup(item, idx)).join('')}
        ${removedItems.map(item => renderRemovedPromptMessageMarkup(item, prevIdx)).join('')}
      </div>
    </div>
  `;
}

function renderAddedPromptMessageMarkup(item, idx) {
  return `
    <div class="panel" style="border:1px solid rgba(34,197,94,0.3);border-radius:var(--radius-sm);overflow:hidden;background:rgba(34,197,94,0.04)">
      <div style="background:var(--bg-3);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px">
          <strong style="color:var(--text);font-size:12px">msg[${item.index}]</strong>
          <span style="text-transform:uppercase;font-weight:700;color:var(--accent-2);font-size:10.5px">(${escHtml(item.role)})</span>
          <span style="color:var(--green);font-size:11px;font-weight:bold">Added in Call #${idx + 1}</span>
        </div>
        <span class="mono" style="color:var(--green);font-weight:bold;font-size:11px">${fmtBytes(item.after?.size || 0)}</span>
      </div>
      <div class="mono" style="font-size:10.5px;line-height:1.45;color:var(--text-2);background:var(--bg-1);padding:10px;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-all">
        ${escHtml(item.after?.fullText || '')}
      </div>
    </div>
  `;
}

function renderRemovedPromptMessageMarkup(item, prevIdx) {
  return `
    <div class="panel" style="border:1px solid rgba(239,68,68,0.3);border-radius:var(--radius-sm);overflow:hidden;background:rgba(239,68,68,0.04)">
      <div style="background:var(--bg-3);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px">
          <strong style="color:var(--text);font-size:12px">msg[${item.index}]</strong>
          <span style="text-transform:uppercase;font-weight:700;color:var(--accent-2);font-size:10.5px">(${escHtml(item.role)})</span>
          <span style="color:var(--red);font-size:11px;font-weight:bold">Removed after Call #${prevIdx + 1}</span>
        </div>
        <span class="mono" style="color:var(--red);font-weight:bold;font-size:11px">${fmtBytes(item.before?.size || 0)}</span>
      </div>
      <div class="mono" style="font-size:10.5px;line-height:1.45;color:var(--text-2);background:var(--bg-1);padding:10px;max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-all">
        ${escHtml(item.before?.fullText || '')}
      </div>
    </div>
  `;
}

function renderReductionSequenceFeed(body, events) {
  if (!body) return;

  let filteredEvents = events;
  if (activeCategoryFilter === 'FILE') {
    filteredEvents = events.filter(e => e.category === 'File Read Truncated');
  } else if (activeCategoryFilter === 'CMD') {
    filteredEvents = events.filter(e => e.category === 'Terminal Output Truncated');
  } else if (activeCategoryFilter === 'ENV') {
    filteredEvents = events.filter(e => e.category === 'Stale Environment Snapshot Removed');
  }

  if (filteredEvents.length === 0) {
    body.innerHTML = `
      <div class="empty-state">
        <p style="color:var(--text-3)">No reduction events match the selected category filter.</p>
      </div>
    `;
    return;
  }

  body.innerHTML = `
    <div style="font-size:11px;color:var(--text-3);margin-bottom:12px">
      Showing <strong>${filteredEvents.length}</strong> context reduction events in chronological order. Click any event card to view the exact side-by-side prompt diff:
    </div>

    <div style="display:flex;flex-direction:column;gap:12px">
      ${filteredEvents.map(ev => renderReductionEventCard(ev)).join('')}
    </div>
  `;

  bindSynchronizedScroll(body);

  document.querySelectorAll('.pa-cat-filter').forEach(btn => {
    btn.addEventListener('click', () => {
      activeCategoryFilter = btn.dataset.cat;
      document.querySelectorAll('.pa-cat-filter').forEach(b => b.classList.toggle('active', b === btn));
      renderReductionSequenceFeed(body, events);
    });
  });
}

function renderReductionEventCard(ev) {
  let icon = '✂️';
  let catColor = 'var(--green)';
  if (ev.category === 'File Read Truncated') {
    icon = '📁';
    catColor = 'var(--green)';
  } else if (ev.category === 'Terminal Output Truncated') {
    icon = '💻';
    catColor = '#38bdf8';
  } else if (ev.category === 'Stale Environment Snapshot Removed') {
    icon = '🌲';
    catColor = '#f59e0b';
  }

  const item = {
    index: ev.msgIndex,
    role: ev.role,
    before: { size: ev.beforeSize },
    after: { size: ev.afterSize },
    diffChunks: ev.diffChunks,
    bytesSaved: ev.bytesSaved,
  };

  return renderDiffBoxMarkup(item, ev.prevCallIndex, ev.callIndex, ev.category, ev.targetName, icon, catColor);
}

function renderDiffBoxMarkup(item, prevCallIdx, callIdx, category, targetName, icon, catColor) {
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
    : (isReduced ? `Saved ${fmtBytes(Math.abs(bytesDelta))}` : 'Modified');
  const bannerTitle = isExpanded
    ? `🟢 EXACT CONTENT ADDED IN CALL #${callIdx + 1}:`
    : (isReduced ? `✂️ EXACT CONTENT REMOVED FROM CALL #${prevCallIdx + 1}:` : '🔁 EXACT CONTENT CHANGED:');
  const bannerText = isExpanded ? insertedText : (removedText || insertedText || '(Content changed)');
  const bannerColor = isExpanded ? 'var(--green)' : (isReduced ? 'var(--red)' : '#38bdf8');
  const bannerBg = isExpanded ? 'rgba(34,197,94,0.08)' : (isReduced ? 'rgba(239,68,68,0.08)' : 'rgba(56,189,248,0.08)');

  const headerLabel = category ? `
    <span style="background:rgba(255,255,255,0.06);padding:2px 8px;border-radius:12px;font-size:10.5px;font-weight:bold;color:${catColor || 'var(--green)'}">
      ${icon || '✂️'} ${escHtml(category)}: <span style="color:var(--text)">${escHtml(targetName || '')}</span>
    </span>
  ` : '';

  return `
    <div class="pa-sbs-card panel" data-call="${callIdx}" data-target="${escHtml(targetName || '')}" style="border:1px solid var(--border);border-radius:var(--radius-sm);overflow:hidden;background:var(--bg-2)">
      <!-- Card Header -->
      <div style="background:var(--bg-3);padding:10px 14px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid var(--border)">
        <div style="display:flex;align-items:center;gap:10px">
          <strong style="color:var(--text);font-size:12px">msg[${item.index}]</strong>
          <span style="text-transform:uppercase;font-weight:700;color:var(--accent-2);font-size:10.5px">(${item.role})</span>
          <span style="color:var(--text-3);font-size:11px">Call #${prevCallIdx + 1} → Call #${callIdx + 1}</span>
          ${headerLabel}
        </div>
        <div>
          <span class="mono" style="color:${metricColor};font-weight:bold;font-size:12px;background:rgba(255,255,255,0.06);padding:3px 10px;border-radius:var(--radius-sm);border:1px solid rgba(255,255,255,0.12)">
            ${metricLabel} (${fmtBytes(beforeSize)} → ${fmtBytes(afterSize)})
          </span>
        </div>
      </div>

      <!-- Exact Changed Content Highlight Banner -->
      <div style="background:${bannerBg};border-bottom:1px solid rgba(255,255,255,0.12);padding:8px 14px;font-size:11px">
        <span style="color:${bannerColor};font-weight:bold">${bannerTitle}</span>
        <div class="mono" style="margin-top:4px;background:rgba(255,255,255,0.06);color:${bannerColor};padding:6px 10px;border-radius:var(--radius-sm);border-left:3px solid ${bannerColor};max-height:90px;overflow-y:auto;white-space:pre-wrap;word-break:break-all">
          ${escHtml(bannerText)}
        </div>
      </div>

      <!-- 2-Column Side-by-Side Synchronized Scroll Comparison -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--border)">
        <!-- Left Column: Request N-1 -->
        <div style="background:var(--bg-2);padding:10px 12px">
          <div style="font-weight:bold;font-size:10.5px;color:var(--red);margin-bottom:6px;display:flex;justify-content:space-between">
            <span>🔴 BEFORE in Call #${prevCallIdx + 1} (Original)</span>
            <span class="mono">${fmtBytes(beforeSize)}</span>
          </div>
          <div class="mono pa-sbs-left" style="font-size:10.5px;line-height:1.45;color:var(--text-2);background:var(--bg-1);padding:8px;border-radius:var(--radius-sm);border:1px solid var(--border);max-height:220px;overflow:auto;white-space:pre-wrap;word-break:break-all">
            ${escHtml(prefix)}
            ${removedText ? `<span style="background:rgba(239,68,68,0.25);color:var(--red);font-weight:bold;padding:2px 4px;border-radius:2px">${escHtml(removedText)}</span>` : ''}
            ${escHtml(suffix)}
          </div>
        </div>

        <!-- Right Column: Request N -->
        <div style="background:var(--bg-2);padding:10px 12px">
          <div style="font-weight:bold;font-size:10.5px;color:var(--green);margin-bottom:6px;display:flex;justify-content:space-between">
            <span>🟢 AFTER in Call #${callIdx + 1} (Sent Payload)</span>
            <span class="mono">${fmtBytes(afterSize)}</span>
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
      ctx.fillStyle = isDark ? 'rgba(56, 189, 248, 0.15)' : 'rgba(14, 165, 233, 0.12)';
      ctx.fillRect(pad.left + i * colWidth, pad.top, colWidth, chartH);
    }

    if (chartSeries.requestSize) {
      const hasHistoricalPruning = calls[i].hasPruning || calls[i].trimmedFromPrevBytes > 100;
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

      if (isHovered) {
        ctx.strokeStyle = '#38bdf8';
        ctx.lineWidth = 1.5;
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

        const compSec = document.getElementById('pa-comparison-section');
        const cacheSec = document.getElementById('pa-cache-section');
        if (!chartSeries.requestSize && (chartSeries.cacheReads || chartSeries.cacheWrites)) {
          if (compSec) compSec.style.display = 'none';
          if (cacheSec) cacheSec.style.display = 'block';
        } else {
          if (compSec) compSec.style.display = 'block';
          if (cacheSec) cacheSec.style.display = 'none';
        }
      }
    });
  });

  document.querySelectorAll('.pa-summary-row').forEach(row => {
    row.addEventListener('click', () => {
      const target = row.dataset.target;
      if (!target) return;

      const cards = document.querySelectorAll('.pa-sbs-card');
      for (const card of cards) {
        if (card.dataset.target === target || card.innerText.includes(target) || card.innerHTML.includes(target)) {
          card.scrollIntoView({ behavior: 'smooth', block: 'center' });
          card.style.outline = '2px solid var(--green)';
          card.style.boxShadow = '0 0 16px rgba(16, 185, 129, 0.4)';
          setTimeout(() => {
            card.style.outline = 'none';
            card.style.boxShadow = 'none';
          }, 3000);
          break;
        }
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
  const prunedStr = c.trimmedFromPrevBytes > 0 ? `✂️ Context Pruned: <strong>${fmtBytes(c.trimmedFromPrevBytes)}</strong>` : 'No context pruning';

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
    <div style="color:var(--green);font-size:10.5px">📖 Cache Reads: <strong>${fmtTokens(c.cacheReads)} tokens</strong></div>
    <div style="color:#f59e0b;font-size:10.5px">✍️ Cache Writes: <strong>${fmtTokens(c.cacheWrites)} tokens</strong></div>
    <div style="font-size:10px;color:var(--text-2);margin-top:2px">Cost: <strong>${fmtCost(c.cost)}</strong></div>
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

  if (!chartSeries.requestSize && (chartSeries.cacheReads || chartSeries.cacheWrites)) {
    const tableRow = document.querySelector(`.pa-cache-row[data-call-idx="${colIdx}"]`);
    if (tableRow) {
      tableRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
      tableRow.click();
    }
  } else {
    const targetCard = document.querySelector(`.pa-sbs-card[data-call="${colIdx}"]`);
    if (targetCard) {
      targetCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
      targetCard.style.outline = '2px solid var(--green)';
      setTimeout(() => { targetCard.style.outline = 'none'; }, 2500);
    }
  }
}
