import { api } from '../api.js';
import { fmtCost, agentColor } from '../utils.js';

/**
 * Activity Intelligence — CodeBurn-inspired view
 *
 * CodeBurn-style gradient horizontal bars, monospace data rows,
 * and rounded border panels. Adapted from CodeBurn's Ink TUI
 * for a web dashboard context.
 */

const CATEGORY_LABELS = {
  'coding':        'Coding',
  'debugging':     'Debugging',
  'feature':       'Feature Dev',
  'refactoring':   'Refactoring',
  'testing':       'Testing',
  'exploration':   'Exploration',
  'planning':      'Planning',
  'delegation':    'Delegation',
  'git':           'Git Ops',
  'build/deploy':  'Build/Deploy',
  'conversation':  'Conversation',
  'brainstorming': 'Brainstorming',
  'general':       'General',
};

const CATEGORY_COLORS = {
  'coding':        '#5B9EF5',
  'debugging':     '#F55B5B',
  'feature':       '#5BF58C',
  'refactoring':   '#F5E05B',
  'testing':       '#E05BF5',
  'exploration':   '#5BF5E0',
  'planning':      '#7B9EF5',
  'delegation':    '#F5C85B',
  'git':           '#CCCCCC',
  'build/deploy':  '#5BF5A0',
  'conversation':  '#888888',
  'brainstorming': '#F55BE0',
  'general':       '#666666',
};

function gradientBar(value, max, widthPx = 200) {
  const pct = max > 0 ? (value / max) * 100 : 0;
  return `
    <div class="gradient-bar" style="width:${widthPx}px">
      <div class="gradient-bar-fill" style="width:${pct}%"></div>
    </div>`;
}

function oneshotBar(rate) {
  if (rate === null || rate === undefined) return `<span class="text-dim">—</span>`;
  const color = rate >= 80 ? 'var(--green)' : rate >= 50 ? '#F5C85B' : 'var(--red)';
  return `
    <div class="oneshot-bar-bg">
      <div class="oneshot-bar-fill" style="width:${rate}%;background:${color}"></div>
    </div>
    <span class="oneshot-pct" style="color:${color}">${rate}%</span>`;
}

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}

function fmt(n) {
  if (!n) return '0';
  return Number(n).toLocaleString();
}

export async function renderActivity(container, dateRange = {}) {
  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading activity intelligence...</p></div>`;

  const params = buildParams(dateRange);
  const [activity, shellCmds, dailyData, agentActivityMatrix] = await Promise.all([
    api.activity(params),
    api.shellCommands(params),
    api.activityDaily(params),
    api.agentMatrix({ ...params, dimension: 'activity' }).catch(() => ({ rows: [], cols: [], values: [] })),
  ]);

  // Aggregate totals
  const totalCost = activity.reduce((s, a) => s + (a.total_cost || 0), 0);
  const totalTasks = activity.reduce((s, a) => s + a.task_count, 0);
  const totalEditTurns = activity.reduce((s, a) => s + (a.edit_turns || 0), 0);
  const totalOneShotTurns = activity.reduce((s, a) => s + (a.oneshot_turns || 0), 0);
  const aggregateOneShotRate = totalEditTurns > 0
    ? Math.round((totalOneShotTurns / totalEditTurns) * 100) : null;
  const totalTokens = activity.reduce((s, a) => s + (a.total_tokens_in || 0) + (a.total_tokens_out || 0), 0);
  const totalRetries = activity.reduce((s, a) => s + (a.retry_cycles || 0), 0);

  // Max values for bar scaling
  const maxActivityCost = Math.max(...activity.map(a => a.total_cost || 0), 0.001);
  const maxCmdCount = Math.max(...shellCmds.map(c => c.count), 1);

  // Daily chart data — aggregate into daily totals
  const dayMap = {};
  for (const r of dailyData) {
    if (!dayMap[r.day]) dayMap[r.day] = { cost: 0, tasks: 0 };
    dayMap[r.day].cost += r.cost || 0;
    dayMap[r.day].tasks += r.task_count;
  }
  const sortedDays = Object.keys(dayMap).sort().slice(-14);
  const maxDayCost = Math.max(...sortedDays.map(d => dayMap[d].cost), 0.001);

  container.innerHTML = `
    <div class="top-bar">
      <div>
        <h1 class="view-title">Activity Intelligence</h1>
        <p class="view-subtitle">Task classification · ${totalTasks} sessions analyzed</p>
      </div>
    </div>

    <!-- Overview banner -->
    <div class="metric-overview">
      <div class="metric-overview-row">
        <div class="metric-overview-stat">
          <span class="metric-overview-value text-gold">${fmtCost(totalCost)}</span>
          <span class="text-dim">cost</span>
        </div>
        <div class="metric-overview-stat">
          <span class="metric-overview-value">${fmt(totalTasks)}</span>
          <span class="text-dim">sessions</span>
        </div>
        <div class="metric-overview-stat">
          <span class="metric-overview-value">${fmtTokens(totalTokens)}</span>
          <span class="text-dim">tokens</span>
        </div>
        ${aggregateOneShotRate !== null ? `
        <div class="metric-overview-stat">
          <span class="metric-overview-value" style="color:${aggregateOneShotRate >= 80 ? 'var(--green)' : '#F5C85B'}">${aggregateOneShotRate}%</span>
          <span class="text-dim">1-shot rate</span>
        </div>` : ''}
        <div class="metric-overview-stat">
          <span class="metric-overview-value" style="color:${totalRetries > 0 ? '#F55B5B' : 'var(--text-2)'}">${totalRetries}</span>
          <span class="text-dim">retries</span>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <!-- By Activity (left) -->
      <div class="panel">
        <div class="panel-title" style="border-color:#F5C85B">
          <span style="color:#F5C85B">By Activity</span>
        </div>
        <div class="data-table-header">
          <span style="flex:1"></span>
          <span class="data-table-col" style="width:70px">cost</span>
          <span class="data-table-col" style="width:50px">tasks</span>
          <span class="data-table-col" style="width:60px">1-shot</span>
        </div>
        ${activity.map(a => {
          const label = CATEGORY_LABELS[a.category] || a.category;
          const color = CATEGORY_COLORS[a.category] || '#666';
          const oneShotPct = a.oneshot_rate;
          const oneShotColor = oneShotPct === null ? 'var(--text-3)'
            : oneShotPct >= 80 ? '#5BF58C'
            : oneShotPct >= 50 ? '#F5C85B' : '#F55B5B';
          return `
          <div class="data-row" title="${label}: ${a.task_count} tasks, ${fmtCost(a.total_cost)}, ${a.edit_turns} edits, ${a.oneshot_turns} one-shot">
            ${gradientBar(a.total_cost || 0, maxActivityCost, 120)}
            <span class="data-category" style="color:${color}">${label}</span>
            <span class="data-val text-gold" style="width:70px">${fmtCost(a.total_cost)}</span>
            <span class="data-val" style="width:50px">${a.task_count}</span>
            <span class="data-val" style="width:60px;color:${oneShotColor}">${oneShotPct !== null ? oneShotPct + '%' : '—'}</span>
          </div>`;
        }).join('')}
      </div>

      <!-- Daily Activity (right) -->
      <div class="panel">
        <div class="panel-title" style="border-color:#5B9EF5">
          <span style="color:#5B9EF5">Daily Activity</span>
        </div>
        <div class="data-table-header">
          <span style="flex:1"></span>
          <span class="data-table-col" style="width:70px">cost</span>
          <span class="data-table-col" style="width:50px">tasks</span>
        </div>
        ${sortedDays.map(day => {
          const d = dayMap[day];
          return `
          <div class="data-row">
            <span class="data-date">${day.slice(5)}</span>
            ${gradientBar(d.cost, maxDayCost, 130)}
            <span class="data-val text-gold" style="width:70px">${fmtCost(d.cost)}</span>
            <span class="data-val" style="width:50px">${d.tasks}</span>
          </div>`;
        }).join('') || '<div class="text-dim" style="padding:12px">No daily data available</div>'}
      </div>
    </div>

    <!-- Phase 4: Activity × Agent matrix (which agents drive which activity categories) -->
    <div class="panel" style="margin-top:16px">
      <div class="panel-title" style="border-color:#7B9EF5">
        <span style="color:#7B9EF5">Activity × Agent Matrix</span>
        <span class="panel-title-meta">Click a cell to filter sessions by activity AND agent</span>
      </div>
      <div class="panel-body">
        ${renderActivityAgentMatrix(agentActivityMatrix)}
      </div>
    </div>

    <div class="grid-2" style="margin-top:16px">
      <!-- Shell Commands (left) -->
      <div class="panel">
        <div class="panel-title" style="border-color:#F5A05B">
          <span style="color:#F5A05B">Shell Commands</span>
        </div>
        <div class="data-table-header">
          <span style="flex:1"></span>
          <span class="data-table-col" style="width:60px">calls</span>
          <span class="data-table-col" style="width:50px">tasks</span>
        </div>
        ${shellCmds.slice(0, 12).map(c => `
          <div class="data-row">
            ${gradientBar(c.count, maxCmdCount, 120)}
            <span class="data-category">${c.command_base}</span>
            <span class="data-val" style="width:60px">${c.count}</span>
            <span class="data-val" style="width:50px">${c.task_count}</span>
          </div>
        `).join('') || '<div class="text-dim" style="padding:12px">No shell commands recorded</div>'}
      </div>

      <!-- One-Shot Rates (right) -->
      <div class="panel">
        <div class="panel-title" style="border-color:#5BF5A0">
          <span style="color:#5BF5A0">One-Shot Success Rates</span>
        </div>
        <div class="data-table-header">
          <span style="flex:1"></span>
          <span class="data-table-col" style="width:50px">edits</span>
          <span class="data-table-col" style="width:60px">1-shot</span>
          <span class="data-table-col" style="width:100px">rate</span>
        </div>
        ${activity
          .filter(a => a.edit_turns > 0)
          .sort((a, b) => (b.oneshot_rate || 0) - (a.oneshot_rate || 0))
          .map(a => {
            const label = CATEGORY_LABELS[a.category] || a.category;
            const color = CATEGORY_COLORS[a.category] || '#666';
            return `
            <div class="data-row" title="${label}: ${a.oneshot_turns} of ${a.edit_turns} edit turns succeeded first try">
              <span class="data-category" style="color:${color};min-width:90px">${label}</span>
              <span class="data-val" style="width:50px">${a.edit_turns}</span>
              <span class="data-val" style="width:60px">${a.oneshot_turns}</span>
              <span style="width:100px;display:flex;align-items:center;gap:6px">
                ${oneshotBar(a.oneshot_rate)}
              </span>
            </div>`;
          }).join('') || '<div class="text-dim" style="padding:12px">No edit data — one-shot rates require edit→command→edit patterns</div>'}
      </div>
    </div>
  `;
}

/**
 * Phase 4: render a sparse Activity×Agent heatmap. Rows=agents, cols=activity
 * categories. Each cell shows task_count and is clickable.
 */
function renderActivityAgentMatrix(matrix) {
  if (!matrix || !matrix.rows?.length || !matrix.cols?.length) {
    return '<div class="empty-state"><p>No activity-agent data yet</p></div>';
  }
  const max = Math.max(1, ...matrix.values.flat());
  const colWidth = 90;
  const rowHeight = 24;
  const labelColWidth = 130;

  const header = matrix.cols.map(c => `
    <div style="background:var(--bg-2);padding:4px 6px;width:${colWidth}px;text-align:center;font-size:10px;font-weight:600;color:${CATEGORY_COLORS[c] || 'var(--text-2)'};border-bottom:1px solid var(--border);border-right:1px solid var(--border);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${c}">${CATEGORY_LABELS[c] || c}</div>
  `).join('');

  const rows = matrix.rows.map((agent, rIdx) => {
    const color = agentColor(agent);
    const cells = matrix.cols.map((c, cIdx) => {
      const v = matrix.values[rIdx][cIdx];
      if (!v) return `<div style="width:${colWidth}px;height:${rowHeight}px;background:transparent;border-right:1px solid var(--border);border-bottom:1px solid var(--border)"></div>`;
      const intensity = v / max;
      const bg = `${color}${Math.round((0.15 + intensity * 0.55) * 255).toString(16).padStart(2,'0')}`;
      return `<div title="${agent} on ${CATEGORY_LABELS[c] || c}: ${v} sessions" onclick="event.stopPropagation();window.location.hash='#/sessions?agent=${encodeURIComponent(agent)}'" style="cursor:pointer;width:${colWidth}px;height:${rowHeight}px;background:${bg};border-right:1px solid var(--border);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;color:${intensity > 0.5 ? 'var(--text)' : 'var(--text-2)'}">${v}</div>`;
    }).join('');
    return `
      <div style="display:flex">
        <div style="background:var(--bg-2);padding:4px 8px;width:${labelColWidth}px;font-size:11px;color:${color};font-weight:600;border-right:1px solid var(--border);border-bottom:1px solid var(--border);white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${agent}">${agent}</div>
        ${cells}
      </div>
    `;
  }).join('');

  return `
    <div style="overflow:auto;max-height:320px;border:1px solid var(--border);border-radius:6px">
      <div style="display:flex;background:var(--bg-2)">
        <div style="width:${labelColWidth}px;border-right:1px solid var(--border);border-bottom:1px solid var(--border)"></div>
        ${header}
      </div>
      ${rows}
    </div>
  `;
}

function buildParams(dateRange) {
  const p = {};
  if (dateRange.from) p.from = dateRange.from;
  if (dateRange.to)   p.to   = dateRange.to;
  return p;
}
