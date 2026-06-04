// src/js/views/overview.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 4: Overview view with agent-context awareness.
//   • Master filter (agent chip row) — scopes every panel on the page.
//   • Top Models — full-width panel, sortable by any column; uses full
//     metric wordings (Sessions, Cost, Tool Use Efficacy, Reasoning Density,
//     Context Efficiency, Error Recovery, Errors) — no abbreviations.
//   • Stat cards + Reasoning Impact + Activity Snapshot — all agent-scoped.
//
// Renders the page twice: once with default filter set, and again whenever the
// user clicks an agent chip. The render is cheap because every fetch is keyed
// off the current filter set; no extra state lives outside the view.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from '../api.js';
import { fmt, fmtCost, fmtDate, agentColor, agentChip, agentColorsDistinct } from '../utils.js';
import { hydrateMetricTooltips } from '../components/metric-tooltip.js';

const STORAGE_KEY = 'pq-overview-agent-filter';

export async function renderOverview(container, dateRange = {}) {
  const initialAgents = readStoredAgents();
  const state = {
    from: dateRange.from,
    to: dateRange.to,
    agents: initialAgents,           // array — supports multi-select
    sortKey: 'task_count',
    sortDir: 'desc',
  };

  const render = async () => {
    const params = buildParams(state);
    const [overview, models, agentsData, reasoning, activityData, allAgentsData] = await Promise.all([
      api.overview(params),
      api.models(params),
      api.agents(params).catch(() => ({ agents: [] })),
      api.reasoning(params),
      api.activity(params).catch(() => []),
      api.agents({ from: dateRange.from, to: dateRange.to }).catch(() => ({ agents: [] })),
    ]);
    return { overview, models, agentsData, reasoning, activityData, allAgentsData };
  };

  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading overview...</p></div>`;

  try {
    const { overview, models, agentsData, reasoning, activityData, allAgentsData } = await render();

    // Validate stored agents against current data — remove stale entries
    // (e.g. an agent that was renamed or no longer has sessions).
    const liveAgentNames = new Set();
    for (const a of (allAgentsData.agents || [])) liveAgentNames.add(a.agent);
    const before = state.agents.length;
    state.agents = state.agents.filter(a => liveAgentNames.has(a));
    if (state.agents.length !== before) writeStoredAgents(state.agents);

    paintOverview(container, { state, overview, models, agentsData, reasoning, activityData, allAgentsData });
    await hydrateMetricTooltips();

    // Re-render handler: chip clicks mutate state.agents and re-fetch.
    container.addEventListener('click', async (e) => {
      const chip = e.target.closest('[data-agent-chip]');
      if (chip) {
        const agent = chip.dataset.agentChip;
        if (agent === '__all__') {
          state.agents = [];
        } else {
          const idx = state.agents.indexOf(agent);
          if (idx === -1) state.agents.push(agent);
          else state.agents.splice(idx, 1);
        }
        writeStoredAgents(state.agents);
        const next = await render();
        paintOverview(container, { state, ...next });
        await hydrateMetricTooltips();
        return;
      }
      const sortHeader = e.target.closest('[data-sort-key]');
      if (sortHeader) {
        const k = sortHeader.dataset.sortKey;
        if (state.sortKey === k) state.sortDir = state.sortDir === 'desc' ? 'asc' : 'desc';
        else { state.sortKey = k; state.sortDir = 'desc'; }
        const next = await render();
        paintOverview(container, { state, ...next });
        await hydrateMetricTooltips();
        return;
      }
    }, { once: false });
  } catch (e) {
    container.innerHTML = `<div class="error-state"><p>Failed to load overview: ${e.message}</p></div>`;
  }
}

function paintOverview(container, { state, overview, models, agentsData, reasoning, activityData, allAgentsData }) {
  const completionRate = overview.total_tasks > 0
    ? Math.round((overview.completed / overview.total_tasks) * 100) : 0;
  const cacheHitRate = (overview.total_tokens_in + overview.total_cache_reads) > 0
    ? Math.round((overview.total_cache_reads / (overview.total_tokens_in + overview.total_cache_reads)) * 100) : 0;
  const avgCost = overview.total_tasks > 0 ? (overview.total_cost || 0) / overview.total_tasks : 0;
  const errRate = overview.total_api_calls > 0
    ? ((overview.total_errors / overview.total_api_calls) * 100).toFixed(1) : 0;

  const providersList = aggregateProviders(models);
  const totalEdits = activityData.reduce((s, a) => s + (a.edit_turns || 0), 0);
  const totalOneShot = activityData.reduce((s, a) => s + (a.oneshot_turns || 0), 0);
  const oneShotRate = totalEdits > 0 ? Math.round((totalOneShot / totalEdits) * 100) : null;

  const activityLabels = ACTIVITY_LABELS;
  const activityColors = ACTIVITY_COLORS;
  const topActivities = activityData.slice(0, 5);
  const maxActivityCost = Math.max(...topActivities.map(a => a.total_cost || 0), 0.001);

  // Sort models according to the current sort key
  const sortedModels = sortModels(models, state.sortKey, state.sortDir);
  const topAgents = (agentsData.agents || []).slice(0, 5);

  // Filter chip row (with "All" + dynamic chips for every agent seen in data)
  const allAgentNames = new Set();
  for (const a of (allAgentsData.agents || [])) allAgentNames.add(a.agent);
  const sortedAgentNames = [...allAgentNames].sort();
  const filterChipsHtml = renderFilterChips(state.agents, sortedAgentNames);

  container.innerHTML = `
    <div class="top-bar">
      <div>
        <h1 class="view-title">Overview</h1>
        <p class="view-subtitle">PostQode AI agent activity · ${fmt(overview.total_tasks)} sessions across all IDEs${state.agents.length ? ` · <span style="color:var(--accent-2)">filtered by agent</span>` : ''} · <span style="color:var(--accent-2);font-size:11px">Click any card or row to explore ↗</span></p>
      </div>
    </div>

    <!--
      Agent-filter chip row.
      The list is built from api.agents() + api.models() every render, so
      a new agent (one that wasn't in the DB on previous load) will appear
      in the row automatically the next time the user lands on this page
      or clicks any chip (which re-fetches). No manual refresh needed.
      Colors come from utils.js agentColor(): hardcoded for known agents,
      hash-derived palette for unknown ones, both stable across renders.
    -->
    <div class="filter-chip-row" style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0 18px;padding:10px 12px;background:var(--bg-2);border:1px solid var(--border);border-radius:6px">
      <span style="font-size:11px;color:var(--text-3);margin-right:6px;font-weight:600">AGENT FILTER</span>
      ${filterChipsHtml}
    </div>

    <div class="stats-grid">
      ${clickCard('Sessions', fmt(overview.total_tasks),
        (overview.sources || []).map(s => `${s.source}: ${s.cnt}`).join(' · ') || '',
        'accent', '#/sessions')}
      ${clickCard('Total Cost', fmtCost(overview.total_cost),
        `Avg ${fmtCost(avgCost)} / session`, 'green', '#/costs')}
      ${clickCard('Errors', fmt(overview.total_errors),
        `${errRate}% of API calls`, overview.total_errors > 0 ? 'red' : '',
        '#/errors')}
      ${clickCard('Completion', `${completionRate}%`,
        `${overview.completed} done · ${overview.interrupted} interrupted`,
        '', '#/sessions?status=completed')}
      ${clickCard('Tokens', fmtTokens(overview.total_tokens_in + overview.total_tokens_out),
        `In: ${fmtTokens(overview.total_tokens_in)} · Out: ${fmtTokens(overview.total_tokens_out)}`,
        '', '#/costs')}
      ${clickCard('Cache Hit', `${cacheHitRate}%`,
        `${fmtTokens(overview.total_cache_reads)} tokens saved`, 'cyan', '#/models')}
      ${clickCard('Tool Calls', fmt(overview.total_tool_calls),
        `${overview.total_api_calls} API calls total`, '', '#/tools')}
      ${clickCard('Reasoning', fmt(overview.with_reasoning),
        'Sessions with thinking traces', 'purple', '#/sessions?hasReasoning=true')}
      ${oneShotRate !== null ? clickCard('1-Shot Rate', `${oneShotRate}%`,
        `${totalOneShot} of ${totalEdits} edits succeeded first try`,
        oneShotRate >= 80 ? 'green' : 'yellow', '#/activity') : ''}
    </div>

    <!-- Top Models (full-width, agent-scoped, sortable by any metric) -->
    <div class="panel">
      <div class="panel-title">
        <span>Top Models${state.agents.length === 1 ? ` <span style="font-weight:400;color:var(--text-3);font-size:11px;margin-left:6px">for ${escHtml(state.agents[0])}</span>` : state.agents.length > 1 ? ` <span style="font-weight:400;color:var(--text-3);font-size:11px;margin-left:6px">for ${escHtml(state.agents.join(' + '))}</span>` : ` <span style="font-weight:400;color:var(--text-3);font-size:11px;margin-left:6px">${sortedModels.length} total</span>`}</span>
        <span class="panel-title-meta">
          ${renderSortBadge(state)}
          <a href="#/models${state.agents.length ? '?agent=' + encodeURIComponent(state.agents.join(',')) : ''}">View all ↗</a>
        </span>
      </div>
      <div class="panel-body" style="padding:0">
        <div class="table-wrap" style="overflow-x:auto">
          <table class="data-table" style="font-size:12px">
            <thead>
              <tr>
                <th>Model</th>
                <th>${sortHeader('Sessions',          'task_count',  state)}</th>
                <th>${sortHeader('Cost',              'total_cost',  state)}</th>
                <th>${sortHeader('Tool Use Efficacy', 'avg_tue',     state)}</th>
                <th>${sortHeader('Reasoning Density', 'avg_rd',      state)}</th>
                <th>${sortHeader('Context Efficiency','avg_ce',     state)}</th>
                <th>${sortHeader('Error Recovery',    'avg_err',     state)}</th>
                <th>${sortHeader('Errors',            'total_errors',state)}</th>
              </tr>
            </thead>
            <tbody>
              ${sortedModels.slice(0, 10).map(m => {
                const tce = m.total_errors || 0;
                return `
                  <tr style="cursor:pointer" onclick="window.location.hash='#/sessions?model_id=${encodeURIComponent(m.model_id)}'">
                    <td>
                      <div class="mono" style="color:var(--text)">${m.model_id?.split('/').pop() || 'unknown'}</div>
                      <div style="font-size:10px;color:var(--text-3);display:flex;flex-wrap:wrap;gap:3px;align-items:center;margin-top:2px">
                        ${m.provider_id || ''}
                        ${(m.agents || m.mode ? [m.agents ? m.agents.split(',') : [m.mode]].flat().filter(Boolean) : []).map(a => agentChip(a, { clickable: false, size: 9 })).join('')}
                      </div>
                    </td>
                    <td><strong>${m.task_count}</strong></td>
                    <td style="color:var(--green)">${fmtCost(m.total_cost)}</td>
                    <td style="${scoreColor(m.avg_tue)}">${fmtScore(m.avg_tue)}</td>
                    <td style="${scoreColor(m.avg_rd, 10, 30)}">${fmtScore(m.avg_rd)}</td>
                    <td style="${scoreColor(m.avg_ce, 20)}">${fmtScore(m.avg_ce)}</td>
                    <td style="${scoreColor(m.avg_err, 30)}">${fmtScore(m.avg_err)}</td>
                    <td>${tce > 0 ? `<span class="badge red" style="font-size:10px">${tce}</span>` : '<span class="text-dim">0</span>'}</td>
                  </tr>
                `;
              }).join('') || '<tr><td colspan="8" style="text-align:center;color:var(--text-3);padding:18px">No model data</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    <div class="grid-2">
      <div class="panel">
        <div class="panel-title">Session Status</div>
        <div class="panel-body">
          ${clickStatusBar('Completed',   overview.completed,   overview.total_tasks, 'accent', '#/sessions?status=completed')}
          ${clickStatusBar('Interrupted', overview.interrupted, overview.total_tasks, 'yellow', '#/sessions?status=interrupted')}
          ${clickStatusBar('Has Errors',
            overview.total_errors > 0 ? overview.total_tasks - overview.completed - (overview.interrupted||0) : 0,
            overview.total_tasks, 'red', '#/sessions?hasErrors=true')}

          <div class="divider"></div>
          <div class="summary-label">Date Range</div>
          <div style="font-size:12.5px;color:var(--text-2)">
            <div>Earliest: <span style="color:var(--text)">${overview.earliest_task ? fmtDate(overview.earliest_task) : '—'}</span></div>
            <div style="margin-top:4px">Latest: <span style="color:var(--text)">${overview.latest_task ? fmtDate(overview.latest_task) : '—'}</span></div>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-title">
          <span>Reasoning Impact Analysis</span>
          <span class="panel-title-meta">Click row to filter sessions</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th>Task Type</th><th>Sessions</th><th>Avg Cost</th><th>Avg Errors</th><th>Completion Rate</th></tr></thead>
            <tbody>
              ${(reasoning || []).map(r => {
                const label = r.has_reasoning
                  ? '<span class="badge purple">🧠 With Reasoning</span>'
                  : '<span class="badge grey">No Reasoning</span>';
                const compRate = r.task_count > 0 ? Math.round(r.completed / r.task_count * 100) : 0;
                const href = r.has_reasoning ? '#/sessions?hasReasoning=true' : '#/sessions?hasReasoning=false';
                return `
                  <tr onclick="window.location.hash='${href}'">
                    <td>${label}</td>
                    <td><strong>${r.task_count}</strong></td>
                    <td style="color:var(--green)">${fmtCost(r.avg_cost)}</td>
                    <td style="color:${r.avg_errors > 0 ? 'var(--red)' : 'var(--text-3)'}">${(r.avg_errors || 0).toFixed(1)}</td>
                    <td>
                      <div style="display:flex;align-items:center;gap:8px">
                        <div class="progress-bar" style="width:60px">
                          <div class="progress-fill ${compRate > 70 ? 'green' : 'yellow'}" style="width:${compRate}%"></div>
                        </div>
                        <span style="font-size:11px;color:var(--text-3)">${compRate}%</span>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-3)">No reasoning data available</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>
    </div>

    ${topActivities.length > 0 ? `
      <div class="panel">
        <div class="panel-title" style="border-color:#F5C85B">
          <span style="color:#F5C85B">Activity Snapshot</span>
          <span class="panel-title-meta"><a href="#/activity">View all ↗</a></span>
        </div>
        <div class="data-table-header">
          <span style="flex:1"></span>
          <span class="data-table-col" style="width:70px">Cost</span>
          <span class="data-table-col" style="width:50px">Tasks</span>
          <span class="data-table-col" style="width:60px">1-Shot</span>
        </div>
        ${topActivities.map(a => {
          const label = activityLabels[a.category] || a.category;
          const color = activityColors[a.category] || '#666';
          const osr = a.oneshot_rate;
          const osColor = osr === null ? 'var(--text-3)' : osr >= 80 ? '#5BF58C' : osr >= 50 ? '#F5C85B' : '#F55B5B';
          const pct = maxActivityCost > 0 ? ((a.total_cost || 0) / maxActivityCost) * 100 : 0;
          return `
            <div class="data-row" style="cursor:pointer" onclick="window.location.hash='#/activity'"
                 title="${label}: ${a.task_count} tasks, ${fmtCost(a.total_cost)}">
              <div class="gradient-bar" style="width:120px"><div class="gradient-bar-fill" style="width:${pct}%"></div></div>
              <span class="data-category" style="color:${color}">${label}</span>
              <span class="data-val text-gold" style="width:70px">${fmtCost(a.total_cost)}</span>
              <span class="data-val" style="width:50px">${a.task_count}</span>
              <span class="data-val" style="width:60px;color:${osColor}">${osr !== null ? `${osr}%` : '—'}</span>
            </div>`;
        }).join('')}
      </div>
    ` : ''}
  `;
}

// ── Sort & chip helpers ────────────────────────────────────────────────────

const SORTABLE_NUMERIC = new Set(['task_count', 'total_cost', 'avg_tue', 'avg_rd', 'avg_ce', 'avg_err', 'total_errors']);

function sortModels(models, key, dir) {
  if (!SORTABLE_NUMERIC.has(key)) return models;
  const sign = dir === 'asc' ? 1 : -1;
  return models.slice().sort((a, b) => {
    const av = a[key], bv = b[key];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av - bv) * sign;
  });
}

function sortHeader(label, key, state, tipHtml = '') {
  const isActive = state.sortKey === key;
  const arrow = isActive ? (state.sortDir === 'asc' ? '↑' : '↓') : '⇅';
  return `<span data-sort-key="${key}" style="cursor:pointer;color:${isActive ? 'var(--accent)' : 'inherit'};font-weight:600">${label} <span style="font-size:9px;opacity:0.6">${arrow}</span></span>${tipHtml}`;
}

function renderSortBadge(state) {
  // Match the full-word column labels in the Top Models table.
  const map = {
    task_count:   'Sessions',
    total_cost:   'Cost',
    avg_tue:      'Tool Use Efficacy',
    avg_rd:       'Reasoning Density',
    avg_ce:       'Context Efficiency',
    avg_err:      'Error Recovery',
    total_errors: 'Errors',
  };
  const label = map[state.sortKey] || state.sortKey;
  return `<span style="font-size:10px;color:var(--text-3);margin-right:6px">Sorted by ${label} ${state.sortDir === 'asc' ? '↑' : '↓'}</span>`;
}

function renderFilterChips(activeAgents, allAgentNames) {
  // Use the distinct-color map so all chips in this row get unique colors
  // even when the underlying agent set is > the palette size.
  const colorMap = agentColorsDistinct(allAgentNames);
  const all = `<span data-agent-chip="__all__" class="badge" style="cursor:pointer;border:1px solid ${activeAgents.length === 0 ? 'var(--accent)' : 'var(--border)'}55;background:${activeAgents.length === 0 ? 'var(--accent)22' : 'transparent'};color:${activeAgents.length === 0 ? 'var(--accent)' : 'var(--text-2)'};font-size:10px;padding:3px 9px">All</span>`;
  const chips = allAgentNames.map(name => {
    const isActive = activeAgents.includes(name);
    const color = colorMap.get(name) || agentColor(name);
    return `<span data-agent-chip="${escAttr(name)}" class="badge" style="cursor:pointer;border:1px solid ${isActive ? color : color + '55'};background:${isActive ? color + '22' : 'transparent'};color:${isActive ? color : 'var(--text-2)'};font-size:10px;padding:3px 9px">${escHtml(name)}</span>`;
  }).join('');
  return all + chips;
}

// ── Stat-card helpers (preserved from the previous version) ───────────────

function clickCard(label, value, sub, color, href) {
  return `
    <div class="stat-card ${color}" style="cursor:pointer;transition:border-color 120ms,transform 120ms"
      onclick="window.location.hash='${href}'"
      onmouseenter="this.style.borderColor='var(--accent)';this.style.transform='translateY(-1px)'"
      onmouseleave="this.style.borderColor='';this.style.transform=''">
      <div class="stat-label">${label} <span style="font-size:9px;color:var(--accent-2);opacity:0.7">↗</span></div>
      <div class="stat-value">${value}</div>
      <div class="stat-sub">${sub}</div>
    </div>`;
}

function clickStatusBar(label, count, total, color, href) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return `
    <div style="margin-bottom:12px;cursor:pointer" onclick="window.location.hash='${href}'"
      title="Click to filter sessions">
      <div style="display:flex;justify-content:space-between;margin-bottom:5px">
        <span style="font-size:12px;color:var(--text-2)">${label} <span style="font-size:9px;color:var(--accent-2)">↗</span></span>
        <span style="font-size:12px;color:var(--text-3)">${count || 0} (${pct}%)</span>
      </div>
      <div class="progress-bar">
        <div class="progress-fill ${color === 'accent' ? '' : color}"
             style="width:${pct}%;${color === 'accent' ? 'background:var(--accent)' : ''}"></div>
      </div>
    </div>`;
}

function aggregateProviders(models) {
  const out = {};
  for (const m of models) {
    const prov = m.provider_id || 'unknown';
    if (!out[prov]) out[prov] = { count: 0, cost: 0 };
    out[prov].count += m.task_count;
    out[prov].cost += m.total_cost || 0;
  }
  return Object.entries(out).sort((a, b) => b[1].count - a[1].count);
}

function fmtScore(v) {
  if (v == null) return '—';
  return Math.round(v) + '%';
}

function scoreColor(v, warn = 50, bad = 25) {
  if (v == null) return 'color:var(--text-3)';
  if (v >= 80) return 'color:#5BF58C';
  if (v >= warn) return 'color:#F5C85B';
  if (v >= bad) return 'color:#F5A05B';
  return 'color:#F55B5B';
}

function fmtTokens(n) {
  if (!n) return '0';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(0) + 'K';
  return String(n);
}

function buildParams(state) {
  const p = {};
  if (state.from) p.from = state.from;
  if (state.to)   p.to   = state.to;
  if (state.agents?.length) p.agent = state.agents.join(',');
  return p;
}

// ── Multi-agent localStorage (stores a JSON array, not a single string) ───

function readStoredAgents() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(a => typeof a === 'string') : [];
  } catch { return []; }
}
function writeStoredAgents(agents) {
  try {
    if (agents.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(agents));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

// ── Constants ─────────────────────────────────────────────────────────────

const ACTIVITY_LABELS = {
  coding: 'Coding', debugging: 'Debugging', feature: 'Feature Dev',
  refactoring: 'Refactoring', testing: 'Testing', exploration: 'Exploration',
  planning: 'Planning', delegation: 'Delegation', git: 'Git Ops',
  'build/deploy': 'Build/Deploy', conversation: 'Conversation',
  brainstorming: 'Brainstorming', general: 'General',
};
const ACTIVITY_COLORS = {
  coding: '#5B9EF5', debugging: '#F55B5B', feature: '#5BF58C',
  refactoring: '#F5E05B', testing: '#E05BF5', exploration: '#5BF5E0',
  planning: '#7B9EF5', delegation: '#F5C85B', git: '#CCCCCC',
  'build/deploy': '#5BF5A0', conversation: '#888888',
  brainstorming: '#F55BE0', general: '#666666',
};

// ── HTML escape helpers (kept local to this view) ─────────────────────────

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function escAttr(s) {
  return escHtml(s);
}
