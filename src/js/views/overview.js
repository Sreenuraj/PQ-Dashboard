// src/js/views/overview.js
// ─────────────────────────────────────────────────────────────────────────────
// Phase 4: Overview view with agent-context awareness.
//   • Master filter (agent chip row) — scopes every panel on the page.
//   • Top Models — sortable by TUE / RD / CE / ERR with hover-tooltip headers.
//   • Top Agents — new panel (replaces "Top Activities" spot if both exist).
//   • Stat cards + Reasoning Impact + Activity Snapshot — all agent-scoped.
//
// Renders the page twice: once with default filter set, and again whenever the
// user clicks an agent chip. The render is cheap because every fetch is keyed
// off the current filter set; no extra state lives outside the view.
// ─────────────────────────────────────────────────────────────────────────────

import { api } from '../api.js';
import { fmt, fmtCost, fmtDate, agentColor, agentChip } from '../utils.js';
import { metricTooltip, hydrateMetricTooltips } from '../components/metric-tooltip.js';

const STORAGE_KEY = 'pq-overview-agent-filter';

export async function renderOverview(container, dateRange = {}) {
  const initialAgent = readStoredAgent();
  const state = {
    from: dateRange.from,
    to: dateRange.to,
    agents: initialAgent ? [initialAgent] : [],
    sortKey: 'task_count',
    sortDir: 'desc',
  };

  const render = async () => {
    const params = buildParams(state);
    const [overview, models, agentsData, reasoning, activityData] = await Promise.all([
      api.overview(params),
      api.models(params),
      api.agents(params).catch(() => ({ agents: [] })),
      api.reasoning(params),
      api.activity(params).catch(() => []),
    ]);
    return { overview, models, agentsData, reasoning, activityData };
  };

  container.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Loading overview...</p></div>`;

  try {
    const { overview, models, agentsData, reasoning, activityData } = await render();
    paintOverview(container, { state, overview, models, agentsData, reasoning, activityData });
    await hydrateMetricTooltips();

    // Re-render handler: chip clicks mutate state.agents and re-fetch.
    container.addEventListener('click', async (e) => {
      const chip = e.target.closest('[data-agent-chip]');
      if (chip) {
        const agent = chip.dataset.agentChip;
        if (agent === '__all__') state.agents = [];
        else {
          const idx = state.agents.indexOf(agent);
          if (idx === -1) state.agents.push(agent);
          else state.agents.splice(idx, 1);
        }
        writeStoredAgent(state.agents[0] || null);
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
      }
    }, { once: false });
  } catch (e) {
    container.innerHTML = `<div class="error-state"><p>Failed to load overview: ${e.message}</p></div>`;
  }
}

function paintOverview(container, { state, overview, models, agentsData, reasoning, activityData }) {
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
  for (const a of (agentsData.agents || [])) allAgentNames.add(a.agent);
  for (const m of models) if (m.mode) allAgentNames.add(m.mode);
  const sortedAgentNames = [...allAgentNames].sort();
  const filterChipsHtml = renderFilterChips(state.agents, sortedAgentNames);

  container.innerHTML = `
    <div class="top-bar">
      <div>
        <h1 class="view-title">Overview</h1>
        <p class="view-subtitle">PostQode AI agent activity · ${fmt(overview.total_tasks)} sessions across all IDEs${state.agents.length ? ` · <span style="color:var(--accent-2)">filtered by agent</span>` : ''} · <span style="color:var(--accent-2);font-size:11px">Click any card or row to explore ↗</span></p>
      </div>
    </div>

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

    <div class="grid-2">
      <div class="panel">
        <div class="panel-title">
          <span>Top Models</span>
          <span class="panel-title-meta">${renderSortBadge(state)}<a href="#/models">View all ↗</a></span>
        </div>
        <div class="table-wrap" style="overflow-x:auto">
          <table class="data-table" style="font-size:11.5px">
            <thead>
              <tr>
                <th>Model</th>
                <th>${sortHeader('Sess',   'task_count', state)}</th>
                <th>${sortHeader('Cost',   'total_cost', state)}</th>
                <th>${sortHeader('TUE',    'avg_tue',    state, metricTooltip('tue'))}</th>
                <th>${sortHeader('RD',     'avg_rd',     state, metricTooltip('rd'))}</th>
                <th>${sortHeader('CE',     'avg_ce',     state, metricTooltip('ce'))}</th>
                <th>${sortHeader('ERR',    'avg_err',    state, metricTooltip('err'))}</th>
                <th>${sortHeader('Errs',   'total_errors', state)}</th>
              </tr>
            </thead>
            <tbody>
              ${sortedModels.slice(0, 7).map(m => {
                const tce = m.total_errors || 0;
                return `
                  <tr style="cursor:pointer" onclick="window.location.hash='#/sessions?model_id=${encodeURIComponent(m.model_id)}'">
                    <td>
                      <div class="mono" style="color:var(--text)">${m.model_id?.split('/').pop() || 'unknown'}</div>
                      <div style="font-size:10px;color:var(--text-3)">${m.provider_id || ''}${m.mode ? ' · ' + agentChip(m.mode, { clickable: false, size: 9 }) : ''}</div>
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

      <div class="panel">
        <div class="panel-title">
          <span>Top Agents</span>
          <span class="panel-title-meta">Click a row to apply as filter</span>
        </div>
        ${topAgents.length > 0 ? topAgents.map(a => `
          <div class="model-row" style="cursor:pointer"
            onclick="event.stopPropagation();window.location.hash='#/sessions?agent=${encodeURIComponent(a.agent)}'"
            title="Click to view sessions for ${escAttr(a.agent)}">
            <div class="model-primary">
              <div style="display:flex;align-items:center;gap:6px">
                ${agentChip(a.agent, { clickable: false, size: 11 })}
              </div>
              <div class="model-primary-meta">${a.event_count} events</div>
            </div>
            <span class="model-stat model-stat-sessions">${a.task_count} sess</span>
            <span class="model-stat model-stat-cost">${fmtCost(a.total_cost)}</span>
            ${(a.total_errors || 0) > 0
              ? `<span class="badge red model-stat-errors" style="font-size:10px">${a.total_errors} err</span>`
              : `<span class="model-stat-errors model-stat-errors-empty">0 err</span>`}
          </div>
        `).join('') : '<div class="empty-state"><p>No agent data yet</p></div>'}
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
  const map = {
    task_count: 'Sessions', total_cost: 'Cost', avg_tue: 'TUE', avg_rd: 'RD',
    avg_ce: 'CE', avg_err: 'ERR', total_errors: 'Errors',
  };
  const label = map[state.sortKey] || state.sortKey;
  return `<span style="font-size:10px;color:var(--text-3);margin-right:6px">Sorted by ${label} ${state.sortDir === 'asc' ? '↑' : '↓'}</span>`;
}

function renderFilterChips(activeAgents, allAgentNames) {
  const all = `<span data-agent-chip="__all__" class="badge" style="cursor:pointer;border:1px solid ${activeAgents.length === 0 ? 'var(--accent)' : 'var(--border)'}55;background:${activeAgents.length === 0 ? 'var(--accent)22' : 'transparent'};color:${activeAgents.length === 0 ? 'var(--accent)' : 'var(--text-2)'};font-size:10px;padding:3px 9px">All</span>`;
  const chips = allAgentNames.map(name => {
    const isActive = activeAgents.includes(name);
    const color = agentColor(name);
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

function readStoredAgent() {
  try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
}
function writeStoredAgent(agent) {
  try { agent ? localStorage.setItem(STORAGE_KEY, agent) : localStorage.removeItem(STORAGE_KEY); } catch {}
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
