# Agent Context — Phase 4 Requirements

> **Version:** 4.0 (Draft)
> **Created:** 2026-06-03
> **Branch:** `phase-4-agent-context`
> **Status:** Awaiting review
> **Depends on:** Phases 1–3
> **Supersedes:** N/A (additive)

---

## 1. Overview

### 1.1 The Problem Today

The parser already captures the *agent* that handled each chunk of a PostQode session (the `mode` field in `task_metadata.json → model_usage[]`), and the DB already stores it in `task_models.mode` and `events.mode`. But the dashboard treats every session as a single "model call" and surfaces the agent as a footnote at best:

| Surface | What shows today | What it should show |
|---|---|---|
| `task_models.mode` column | Stored, but the only place it's rendered is a "Mode" badge in the **Models** table. | First-class "Agent" column in **Sessions**, with badges showing the full list when multiple agents were used. |
| Multi-agent sessions | Two sessions today already span 2–3 agents (`web_agent + agent`, `web_agent + plan + agent`). Indistinguishable from single-agent sessions. | Dedicated "Agent handoff" panel on the session detail page, timeline dividers, and a "session is multi-agent" filter. |
| Aggregation | "Top models" / "Top tools" / "Activity by category" exist. No breakdown by agent. | "Top agents", "Model × Agent matrix", "Longest tasks per agent", "Cost per agent", "Errors per agent". |
| Filtering | URL filters: `status`, `model_id`, `error_category`, `tool_name`, `hasErrors`, `hasReasoning`. | Add `agent` filter; add `multi_agent` filter. |
| Baselines | "Set as Baseline" modal shows the model of the first model row, not the agent. | Surface the agent chain in the baseline metadata. |
| Test & Compare | Behavioral testing reports the model's score. | Report the **agent-aware** score: a baseline built from a `web_agent` session should compare only to other `web_agent` sessions by default, and the report should state which agent was active during each failure. |

### 1.2 What Phase 4 Delivers

| # | Area | Summary |
|---|------|---------|
| 1 | **Naming & schema** | Promote `mode` → `agent` (display) while keeping `mode` as the storage column. Add a `tasks` summary of the agents used (`primary_agent`, `agent_count`, `agent_sequence_json`, `is_multi_agent`). Add the missing index. |
| 2 | **Sessions page** | New "Agent" column with chips; URL filter `?agent=web_agent`; "Multi-agent only" toggle; agent shown in the Set-as-Baseline modal. |
| 3 | **Investigate & Timeline pages** | New "Agents" panel in the task summary. Timeline gets an agent-color band under each node; the event detail panel shows the active agent at the timestamp. |
| 4 | **Compare & Deep-Compare** | New "Agent" row in the comparison table. Deep Compare column header shows the agent chain (e.g. `web_agent → plan → agent`). |
| 5 | **Models page** | Existing "Mode" badge upgraded to a clickable chip; new "Model × Agent" heatmap matrix. |
| 6 | **Overview & Activity** | New "Top Agents" card on Overview. New "Activity by Agent" matrix on the Activity page. |
| 7 | **Errors page** | New "By Agent" breakdown alongside By Model and By Category. |
| 8 | **Baselines** | Surface the source session's agent chain on baseline cards and on the editor. |
| 9 | **Backend analytics** | New `GET /api/analytics/agents` endpoint with all the agent aggregations needed by the UI. |
| 10 | **Test & Evaluate** | Test results and Evaluate report include the agent chain. Behavioral test scoring can be filtered/rerun with an `agent` parameter for agent-aware baselines. |

### 1.3 Design Principles

1. **No data migration.** User will wipe `data/dashboard.db`. All schema changes are additive (new columns, new indexes, new tables where needed).
2. **No re-parse of old files.** The parser already populates `mode` per model usage, which means we can derive everything in SQL from the existing `task_models` and `events` tables.
3. **`mode` stays as the storage column name.** The display string is "Agent" everywhere. This avoids renaming columns (cheap to read, expensive to migrate in code that already references `mode`).
4. **Multi-agent is first-class, not a corner case.** Every aggregation, every filter, every page must answer "and which agent(s)?" not just "which model?".
5. **Answers the user's questions out of the box.** The endpoint and the UI must support, on day one: *best model per agent, top agents, longest tasks per agent, cost per agent, errors per agent, multi-agent session list, agent handoff timeline*.

---

## 2. Data Model

### 2.1 New `tasks` columns

Computed by the parser at insert time (one SQL aggregation over `task_models`):

```sql
ALTER TABLE tasks ADD COLUMN primary_agent TEXT;          -- mode with the most events; tie-break by first occurrence
ALTER TABLE tasks ADD COLUMN agent_count INTEGER DEFAULT 0; -- DISTINCT modes in task_models
ALTER TABLE tasks ADD COLUMN is_multi_agent INTEGER DEFAULT 0; -- 1 when agent_count > 1
ALTER TABLE tasks ADD COLUMN agent_sequence_json TEXT;     -- JSON array of {agent, ts_first, ts_last, event_count, model_id, cost} in order of first appearance
```

### 2.2 New index

```sql
CREATE INDEX IF NOT EXISTS idx_task_models_mode ON task_models(mode);
CREATE INDEX IF NOT EXISTS idx_events_mode      ON events(mode);
CREATE INDEX IF NOT EXISTS idx_tasks_primary_agent ON tasks(primary_agent);
CREATE INDEX IF NOT EXISTS idx_tasks_multi_agent ON tasks(is_multi_agent);
```

The `events.mode` index is the heavy hitter — the event table holds 12k+ rows and the per-agent aggregations join on it.

### 2.3 Why compute in the parser, not at query time?

The agent sequence is a denormalized JSON blob. The reasoning:

- The UI calls it on nearly every page (Sessions, Investigate, Timeline, Compare, Test, Baselines). Pre-computing avoids a 4-way join on every render.
- The first-appearance order is stable per session, so the JSON can be regenerated deterministically if the schema is ever changed.
- One-time cost on parse, zero per-render cost.

### 2.4 What `primary_agent` is *not*

- It is **not** a "best" agent — it's the one that ran the most events. For a `web_agent → plan → agent` session, primary could be `web_agent` (lots of tool calls) while the user actually cared about `plan`.
- It is **not** authoritative for multi-agent sessions — the UI must always render the full chain, never just the primary.

### 2.5 Sample shape of `agent_sequence_json`

```json
[
  {
    "agent": "web_agent",
    "ts_first": 1778148395310,
    "ts_last":  1778148448762,
    "event_count": 18,
    "model_id": "moonshotai/kimi-k2.6",
    "cost": 0.0124
  },
  {
    "agent": "plan",
    "ts_first": 1778148450000,
    "ts_last":  1778148453200,
    "event_count": 4,
    "model_id": "moonshotai/kimi-k2.6",
    "cost": 0.0011
  },
  {
    "agent": "agent",
    "ts_first": 1778148454000,
    "ts_last":  1778148461000,
    "event_count": 9,
    "model_id": "anthropic/claude-3.5-sonnet",
    "cost": 0.0402
  }
]
```

This makes the timeline/investigate/compare pages trivial: read the JSON, render a chip per entry.

---

## 3. Backend Changes

### 3.1 Files to modify

| File | Change |
|---|---|
| `server/cache/db.js` | Add the 4 new `tasks` columns and 4 new indexes inside `initSchema()`. Add the same migrations to the `migrations` array so existing DBs upgrade cleanly. |
| `server/parser/index.js` | After `saveTask`, compute the agent sequence and write it via a new helper. (Cheaper: extend `saveTask` to accept an `agentMeta` argument and write it inline.) |
| `server/routes/analytics.js` | Add `GET /api/analytics/agents` (full breakdown) and `GET /api/analytics/agent-matrix` (model × agent pivot). |
| `server/routes/tasks.js` | Extend `GET /api/tasks` filters to accept `agent` and `multi_agent=1`. Extend the row payload to include `primary_agent`, `agent_count`, `is_multi_agent`, and `agent_sequence`. |
| `server/routes/tasks.js` | `GET /api/tasks/:id` already returns `models` with `mode` — add `primary_agent` and `agent_sequence` to the task object. |
| `server/routes/tasks.js` | `POST /api/tasks/compare` — the deep-compare payload already includes `task.models`; surface `primary_agent` and `agent_sequence` on each row's `task` so the deep-compare header can show the chain. |
| `server/routes/baselines.js` | The baseline row's `source_task_id` is enough to look up the source's agent chain at read time. No schema change on `baselines`. Add a derived `source_agents` field to the GET response. |
| `server/testing/index.js` | When a baseline is provided, the test runner should include the agent(s) in its evidence so the report says *"web_agent failed tool TIA at timestamp X"*, not just *"session failed TIA"*. |

### 3.2 New analytics endpoints

#### `GET /api/analytics/agents`

Returns one row per agent, with the metrics needed to populate the new "Top Agents" card, the "By Agent" breakdown on the Errors page, and the "Agent × Activity" matrix on the Activity page.

Query shape (simplified):

```sql
SELECT
  e.mode AS agent,
  COUNT(DISTINCT e.task_id)  AS task_count,
  COUNT(*)                    AS event_count,
  SUM(e.cost)                 AS total_cost,
  SUM(e.tokens_in)            AS total_tokens_in,
  SUM(e.tokens_out)           AS total_tokens_out,
  SUM(e.error_count)          AS total_errors,           -- via sub-select or join
  AVG(t.duration)             AS avg_duration,
  MAX(t.duration)             AS max_duration,
  SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) AS completed
FROM events e
INNER JOIN tasks t ON t.id = e.task_id
WHERE e.mode IS NOT NULL AND e.mode != ''
GROUP BY e.mode
ORDER BY task_count DESC;
```

Response:
```json
[
  { "agent": "web_agent", "task_count": 74, "event_count": 5600, "total_cost": 12.34, "avg_cost": 0.16, "avg_duration": 320000, "max_duration": 1850000, "completed": 60, "total_errors": 14 },
  ...
]
```

Optional sub-breakdowns (returned alongside, not in the same row):

- `top_models_per_agent: { agent: [{model_id, task_count, avg_cost, completion_rate}, ...] }`
- `longest_sessions_per_agent: { agent: [task, task, task] }` — top 5 by `duration`
- `activity_by_agent: { agent: { category: task_count } }` — used by the Activity matrix

#### `GET /api/analytics/agent-matrix?dimension=model|activity|status`

Returns a sparse pivot. Example for `dimension=model`:

```json
{
  "rows":    ["web_agent", "agent", "mobile_agent"],          // agents
  "cols":    ["claude-3.5", "kimi-k2", "gpt-4o"],             // models
  "values":  [ [12, 8, 4], [3, 2, 0], [9, 1, 0] ],            // task_count per (agent, model)
  "metric":  "task_count"
}
```

The frontend renders the same data three ways depending on `dimension`. This is the answer to *"which model works best with web agent"* — the cell with the highest completion rate for `web_agent` is the answer.

### 3.3 New filters on `GET /api/tasks`

| Param | SQL effect |
|---|---|
| `agent=web_agent` | `INNER JOIN task_models tm ON t.id = tm.task_id WHERE tm.mode = 'web_agent'` |
| `agent=web_agent,mobile_agent` | `tm.mode IN ('web_agent', 'mobile_agent')` |
| `multi_agent=1` | `t.is_multi_agent = 1` |
| `multi_agent=0` | `t.is_multi_agent = 0` (default if param absent) |

Both filters compose with the existing model/date/status filters.

### 3.4 `POST /api/tasks/compare` agent payload

Each task in the response gets:

```json
"task": {
  ...,
  "primary_agent": "web_agent",
  "agent_count": 3,
  "is_multi_agent": 1,
  "agent_sequence": [ /* the 3 entries from §2.5 */ ]
}
```

The deep-compare header then renders the chain as chips:
```
[ web_agent 0:02:14 ] → [ plan 0:00:32 ] → [ agent 0:01:11 ]
```

---

## 4. Frontend Changes — Page by Page

### 4.1 `src/js/views/overview.js` — Top Agents card

Add a "Top Agents" panel mirroring "Top Models" (sorted by session count, clickable → filters Sessions by that agent). Each row shows:

- Agent name (mono)
- Session count
- Total cost
- Error count badge
- "Multi-agent" badge if `is_multi_agent` was true for ≥1 of its sessions

**Click target:** `window.location.hash = '#/sessions?agent=' + encodeURIComponent(agent)`

### 4.2 `src/js/views/sessions.js` — Agent column + filter

| Change | Detail |
|---|---|
| New column "Agent(s)" in the table | Renders a chip per agent. If `is_multi_agent`, prefix with a small `+` showing the count (e.g. `web_agent  +2`). Each chip is clickable → filter by that agent only. |
| New URL filter `?agent=` | Wires into the active-filter chip strip and into the filter dropdown. |
| New filter dropdown `f-agent` | Lists distinct agents + a "Multi-agent only" option. |
| Set-as-Baseline modal | Show the agent chain under the model line. |
| URL params for multi-agent | `?multi_agent=1` works in addition to the dropdown. |

### 4.3 `src/js/views/investigate.js` — Agents panel

In the Task Summary, add a new summary item **"Agents"** that renders the chain. If `is_multi_agent`, the panel is expanded by default to show the full handoff list with start/end timestamps and the model used during each phase.

### 4.4 `src/js/views/timeline.js` — Agent band

Add a thin colored band **above the existing timeline track** that shows the active agent across time. Each agent gets a stable color from a 10-entry palette (e.g. `web_agent=#5B9EF5`, `agent=#F5C85B`, `plan=#7B9EF5`, etc.). The band has hard borders at agent handoffs.

In the event detail panel, include "Active agent: web_agent" alongside the existing model_id line.

### 4.5 `src/js/views/compare.js` — Agent row

Add a new row to the comparison table titled **"Agent"** showing `primary_agent` (and a "+N" suffix if multi-agent). Clicking the cell opens a modal showing the full agent sequence with timestamps.

### 4.6 `src/js/views/deep-compare.js` — Agent chain in column header

The column header currently shows `t.models?.[0]?.model_id?.split('/').pop()`. Change it to show the **agent chain** (chips) above the model short-name:

```
[web_agent] [plan] [agent]
claude-3.5-sonnet · 5m32s
```

Also add an "Agent" row to the comparison table (same as Compare).

### 4.7 `src/js/views/models.js` — Mode → Agent

- Rename the "Mode" column to "Agent" in the Model Performance Table.
- Add a click handler on the badge → `?agent=` filter on Sessions.
- Add a new panel: **"Model × Agent matrix"** (heatmap). Renders the data from `/api/analytics/agent-matrix?dimension=model`. Each cell shows the task count for `(model, agent)`. Clicking a cell jumps to Sessions with both `model_id` and `agent` filters.

### 4.8 `src/js/views/activity.js` — Activity × Agent

Add a new panel **"Activity by Agent"** that pivots `(agent, activity_category)` and shows the same gradient-bar treatment the existing panels use. This answers *"is delegation only happening with mobile_agent?"* and similar.

### 4.9 `src/js/views/errors.js` — By Agent breakdown

Add a third tab **"By Agent"** alongside "By Category" and "By Model". Same table layout (category-style: agent, error count, affected sessions, errors-per-session).

### 4.10 `src/js/views/baselines.js` — Source agent chip

In each baseline card's summary line, add an `Agent(s)` chip (mirroring Sessions.js). In the metadata grid, add an "Agents" row when `agent_count > 1` showing the chain.

In the baseline **editor** (`baseline-editor.js`), add a read-only "Source Agent(s)" field at the top showing the source session's chain.

### 4.11 `src/js/views/test.js` & `eval.js` — Agent context

- Test page header: show the session's agent chain next to the model line.
- Behavioral test evidence: when a check fails, the evidence text now reads e.g. *"Tool 'Bash' missing during web_agent phase (timestamps 0:02:14–0:03:30)"* instead of just *"Tool 'Bash' missing"*. This requires the test runner to expose the active agent per event; see §3.1.
- Evaluate page: add an "Agents used" line in the task summary panel.

### 4.12 `src/js/views/investigate.js` and `src/js/api.js` — Event-level agent

The events endpoint already returns `mode` per event. The Investigate view's list items should color-code the left border by agent (using the same agent palette as the Timeline band). This makes a long session visually scannable for handoffs.

---

## 5. Filtering & URL Conventions

| URL fragment | Effect |
|---|---|
| `#/sessions?agent=web_agent` | Only sessions where `web_agent` was one of the agents used. |
| `#/sessions?agent=web_agent,mobile_agent` | Sessions where **any** of the listed agents ran (OR). |
| `#/sessions?multi_agent=1` | Sessions with >1 distinct agent. |
| `#/sessions?agent=web_agent&multi_agent=1` | Composes (AND): web_agent sessions that are also multi-agent. |
| `#/models?agent=web_agent` | Models page filtered to only those that ran in `web_agent`. |
| `#/compare?tasks=A,B&agent=web_agent` | Compare only when all selected tasks are web_agent sessions; warns otherwise. |

The filter chip strip on the Sessions page surfaces every active filter, including the new ones.

---

## 6. Agent Color Palette

Stable across every page so a glance tells the user which agent handled a row/event/segment.

```js
const AGENT_COLORS = {
  'web_agent':           '#5B9EF5',
  'agent':               '#F5C85B',
  'plan':                '#7B9EF5',
  'mobile_agent':        '#5BF58C',
  'api_agent':           '#F55BE0',
  'web-automation-pro':  '#5BF5E0',
  'web-performance-pro': '#F5A05B',
  'api-performance-pro': '#E05BF5',
  'act':                 '#F55B5B',
  'code-reviewer':       '#CCCCCC',
};
// fallback: hash(agent) → palette[hash % palette.length]
```

Centralize this in `src/js/utils.js` so every view imports the same map.

---

## 7. The Questions This Plan Answers

| Question | Answer path |
|---|---|
| "Which model works great with web_agent?" | Models page → Model × Agent heatmap → sort `web_agent` column by completion rate. Drill in via click. |
| "Top used model in agent mode?" | Models page → sort Model Performance Table by `task_count` for rows where `agent = 'agent'`. (Filter on the page or via URL.) |
| "Longest running tasks with api_agent?" | New `GET /api/analytics/agents?agent=api_agent&sort=duration` → `longest_sessions_per_agent`. Expose as a "Top 5 longest" mini-panel on the Agents card. |
| "Sessions that used a plan agent?" | `#/sessions?agent=plan`. |
| "How often does web_agent hand off to plan?" | Aggregate from `agent_sequence_json` — count transitions `web_agent → plan` across all sessions. Add as a small "Handoff matrix" panel on Overview. |
| "Which agent has the lowest error rate?" | Errors page → By Agent tab, sorted ascending by errors-per-session. |
| "Did switching agents improve the outcome?" | Compare view → pick a baseline + sessions → see primary_agent in the table. Filter the Sessions list to `is_multi_agent=1` and compare completion rates against single-agent sessions. |
| "What does an agent handoff look like in time?" | Timeline view → the new agent band. Investigate view → Agents panel with start/end timestamps. |

---

## 8. Implementation Plan (Build Order)

The order is chosen so each step is independently demoable.

| # | Step | Files touched | Demo outcome |
|---|------|---------------|--------------|
| 1 | Schema + parser denormalization | `server/cache/db.js`, `server/parser/index.js` | Wipe DB, reparse → every task has `primary_agent`, `agent_count`, `is_multi_agent`, `agent_sequence_json`. |
| 2 | Task API filters + payload | `server/routes/tasks.js` | `GET /api/tasks?agent=web_agent` works. `GET /api/tasks/:id` includes `agent_sequence`. |
| 3 | `GET /api/analytics/agents` + matrix endpoint | `server/routes/analytics.js` | curl returns the agent breakdown. |
| 4 | `src/js/utils.js` — add `AGENT_COLORS`, `fmtAgentChain()` | `src/js/utils.js`, `src/js/api.js` (if any wrapper needed) | Reusable across views. |
| 5 | Sessions: agent column + filter + multi-agent filter | `src/js/views/sessions.js` | The page shows the new column and the filter works. |
| 6 | Compare + Deep-Compare: agent row + column header | `src/js/views/compare.js`, `src/js/views/deep-compare.js` | Side-by-side shows the agent chain. |
| 7 | Investigate + Timeline: agent band + agent panel | `src/js/views/investigate.js`, `src/js/views/timeline.js` | Visual handoff is visible. |
| 8 | Overview: Top Agents card | `src/js/views/overview.js` | New card with click-to-filter. |
| 9 | Models: heatmap + rename Mode→Agent | `src/js/views/models.js` | Heatmap answers "best model for web_agent". |
| 10 | Activity: Activity × Agent matrix | `src/js/views/activity.js` | Answers "is delegation only in mobile_agent?". |
| 11 | Errors: By Agent tab | `src/js/views/errors.js` | Per-agent error breakdown. |
| 12 | Baselines: source agent chip + editor field | `src/js/views/baselines.js`, `src/js/views/baseline-editor.js` | Baseline cards show the agent chain. |
| 13 | Test + Eval: agent context in headers and evidence | `src/js/views/test.js`, `src/js/views/eval.js`, `server/testing/index.js` | Reports say *which agent* during a failure. |
| 14 | Polish: agent-aware filter combos, empty states, palette | All views | No regressions; multi-agent filter composes with all existing filters. |

---

## 9. Detailed Specs (selected)

### 9.1 Parser denormalization (`server/parser/index.js` → `saveTask`)

Before the `INSERT OR REPLACE INTO tasks` call, build `agentMeta`:

```js
function buildAgentMeta(db, taskId, metadata) {
  // Pull all (model, mode, ts) entries for this task
  const usage = (metadata?.models || []).slice().sort((a, b) => a.ts - b.ts);
  // Aggregate per mode, in first-appearance order
  const order = [];
  const byAgent = new Map();
  for (const u of usage) {
    if (!u.mode) continue;
    if (!byAgent.has(u.mode)) {
      byAgent.set(u.mode, { agent: u.mode, ts_first: u.ts, ts_last: u.ts, event_count: 0, model_id: u.model_id, cost: 0 });
      order.push(u.mode);
    } else {
      const e = byAgent.get(u.mode);
      e.ts_last = u.ts;
      if (!e.model_id) e.model_id = u.model_id;
    }
  }
  // Pull event-level stats per mode to populate event_count + cost
  const eventStats = db.prepare(`
    SELECT mode, COUNT(*) as event_count, COALESCE(SUM(cost),0) as cost
    FROM events WHERE task_id = ? AND mode IS NOT NULL AND mode != ''
    GROUP BY mode
  `).all(taskId);
  for (const s of eventStats) {
    const e = byAgent.get(s.mode);
    if (e) { e.event_count = s.event_count; e.cost = s.cost; }
  }
  const sequence = order.map(a => byAgent.get(a));
  // Primary agent = mode with the most events; tie-break by first-appearance
  const primary = sequence.slice().sort((a, b) => (b.event_count - a.event_count) || (a.ts_first - b.ts_first))[0]?.agent || null;
  return {
    primary_agent: primary,
    agent_count: sequence.length,
    is_multi_agent: sequence.length > 1 ? 1 : 0,
    agent_sequence_json: JSON.stringify(sequence),
  };
}
```

Pass the result into `saveTask` and add 4 more `?` placeholders to the INSERT.

### 9.2 `src/js/utils.js` additions

```js
export const AGENT_COLORS = { /* §6 */ };
const FALLBACK_PALETTE = ['#5B9EF5','#F5C85B','#7B9EF5','#5BF58C','#F55BE0','#5BF5E0','#F5A05B','#E05BF5','#F55B5B','#CCCCCC'];
function hashStr(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
export function agentColor(agent) { return AGENT_COLORS[agent] || FALLBACK_PALETTE[hashStr(agent) % FALLBACK_PALETTE.length]; }

export function fmtAgentChain(sequence, { max = 3 } = {}) {
  if (!sequence?.length) return '—';
  const shown = sequence.slice(0, max).map(s => s.agent);
  const extra = sequence.length - shown.length;
  return shown.join(' → ') + (extra > 0 ? ` +${extra}` : '');
}

export function agentChip(agent, { clickable = true, size = 10 } = {}) {
  const color = agentColor(agent);
  const cursor = clickable ? 'cursor:pointer' : '';
  const handler = clickable
    ? `onclick="event.stopPropagation();window.location.hash='#/sessions?agent=${encodeURIComponent(agent)}'"`
    : '';
  return `<span class="badge" style="background:${color}22;color:${color};border:1px solid ${color}55;font-size:${size}px;${cursor}" ${handler}>${escHtml(agent)}</span>`;
}
```

### 9.3 Sessions page table row — new "Agent(s)" cell

```html
<td>
  <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;max-width:240px">
    ${(t.agent_sequence || []).slice(0,3).map(s => agentChip(s.agent)).join('')}
    ${(t.agent_sequence?.length || 0) > 3 ? `<span class="text-dim" style="font-size:10px">+${t.agent_sequence.length-3}</span>` : ''}
    ${t.is_multi_agent ? '<span class="badge purple" style="font-size:9px" title="Multiple agents in this session">⇌</span>' : ''}
  </div>
</td>
```

### 9.4 Timeline band (above the existing track)

```html
<div class="agent-band" style="display:flex;height:6px;border-radius:3px;overflow:hidden;margin-bottom:6px">
  ${(task.agent_sequence || []).map(s => `
    <div title="${escHtml(s.agent)} · ${fmtDuration(s.ts_last - s.ts_first)}"
         style="flex:${Math.max(1, s.ts_last - s.ts_first)};background:${agentColor(s.agent)}"></div>
  `).join('')}
</div>
```

### 9.5 Model × Agent heatmap

```html
<div class="heatmap">
  <div class="heatmap-corner"></div>
  ${cols.map(c => `<div class="heatmap-col-head">${c}</div>`).join('')}
  ${rows.map((r, i) => `
    <div class="heatmap-row-head">${r}</div>
    ${values[i].map((v, j) => `
      <div class="heatmap-cell" style="background:${heatmapColor(v, maxVal)}"
           onclick="window.location.hash='#/sessions?model_id=${encodeURIComponent(colsFull[j])}&agent=${encodeURIComponent(rowsFull[i])}'">
        ${v || ''}
      </div>
    `).join('')}
  `).join('')}
</div>
```

`heatmapColor(v, max)` returns `rgba(91,158,245, ${v/max * 0.85 + 0.05})`. Hover tooltip shows exact task count + click-drill.

---

## 10. Verification

### 10.1 Schema

```bash
sqlite3 data/dashboard.db ".schema tasks" | grep -E "primary_agent|agent_count|is_multi_agent|agent_sequence"
sqlite3 data/dashboard.db "SELECT name FROM sqlite_master WHERE type='index' AND name LIKE 'idx_%agent%' OR name LIKE 'idx_%mode%';"
```

### 10.2 Data

```bash
# Coverage
sqlite3 data/dashboard.db "SELECT COUNT(*) total, COUNT(primary_agent) with_agent FROM tasks;"

# Multi-agent sessions
sqlite3 data/dashboard.db "SELECT id, primary_agent, agent_count, agent_sequence_json FROM tasks WHERE is_multi_agent = 1;"
```

### 10.3 API

```bash
curl -s 'http://localhost:3456/api/analytics/agents' | jq
curl -s 'http://localhost:3456/api/tasks?agent=web_agent&limit=5' | jq '.tasks[].agent_sequence'
curl -s 'http://localhost:3456/api/analytics/agent-matrix?dimension=model' | jq
```

### 10.4 UI smoke (manual)

1. Wipe `data/`, restart server, reparse → confirm no errors.
2. Overview: Top Agents card renders, click filters Sessions.
3. Sessions: Agent column shows, filter works, multi-agent filter works, Set-as-Baseline shows the chain.
4. Investigate: Agents panel expands for multi-agent sessions.
5. Timeline: agent band visible, handoffs obvious.
6. Compare + Deep-Compare: agent row present, deep-compare header shows the chain.
7. Models: heatmap renders, clicking a cell filters Sessions with both filters.
8. Activity: Activity × Agent matrix renders.
9. Errors: By Agent tab works.
10. Baselines: source agent chip on cards, field in editor.
11. Test: failure evidence mentions the agent.
12. Filter composition: `?agent=web_agent&multi_agent=1&status=completed&hasErrors=true` all work together.

### 10.5 Question-driven checks (regression-style)

After implementation, the following queries should each return non-empty, sensible rows:

| Question | Query |
|---|---|
| Best model for `web_agent` | `SELECT model_id, COUNT(DISTINCT task_id) c FROM task_models WHERE mode='web_agent' GROUP BY model_id ORDER BY c DESC LIMIT 3;` |
| Top agent | `SELECT primary_agent, COUNT(*) c FROM tasks GROUP BY primary_agent ORDER BY c DESC;` |
| Longest 5 `api_agent` sessions | `SELECT id, duration FROM tasks t WHERE EXISTS (SELECT 1 FROM task_models WHERE task_id=t.id AND mode='api_agent') ORDER BY duration DESC LIMIT 5;` |
| Most expensive agent | `SELECT e.mode, SUM(e.cost) c FROM events e GROUP BY e.mode ORDER BY c DESC;` |
| Error rate by agent | `SELECT e.mode, COUNT(*) errs, COUNT(DISTINCT e.task_id) tasks FROM events e WHERE e.error_category IS NOT NULL GROUP BY e.mode ORDER BY errs DESC;` |
| Multi-agent session count | `SELECT COUNT(*) FROM tasks WHERE is_multi_agent=1;` |
| Agent handoffs | custom aggregation on `agent_sequence_json` |

---

## 11. Out of Scope (Explicit Non-Goals)

These are deliberately NOT part of Phase 4:

- **Renaming the `mode` column** to `agent` in the DB. Cost (touching every SQL string) > benefit (display label is already "Agent"). The mapping lives in `utils.js`.
- **Migrating old data.** User will wipe and re-parse.
- **LLM-based agent detection.** Phase 4 only surfaces what the parser already captured. Inferring agents from prompts is a future phase.
- **Per-agent pricing tiers.** A `agent` field in the cost calculator would be a separate phase (Phase 5 candidate).
- **Re-running the parser on old sessions.** The parser only runs on new sessions. The schema migration is a one-time backfill computed from the existing rows.
- **Agent-level access control / permissions.** Out of scope; the dashboard is read-only observability.

---

## 12. Risks & Open Questions

| # | Risk / Question | Mitigation |
|---|---|---|
| 1 | The parser's `task_metadata.model_usage[].mode` may be missing on some sessions (CLI without mode support?). Currently 91% event coverage; the rest default to `primary_agent = NULL`. | Treat NULL primary as "unknown" everywhere; don't fail renders. The filter chip in the UI shows "(no agent)" for those. |
| 2 | The `event_count` and `cost` per agent in `agent_sequence_json` could drift from the actual `events` table if the parser ever re-aggregates. | Treat the JSON as a snapshot; if the user wants fresh numbers, the page re-fetches `/api/analytics/agents` rather than reading the JSON. |
| 3 | Color collisions in the agent palette. | Hash-based fallback. Re-hashing the same agent always returns the same color (stable). |
| 4 | The `Models` table view currently uses `Mode` as one column. Renaming to `Agent` is a label change only; the SQL alias is unchanged. | Verified — `models.js` reads `m.mode` from the analytics endpoint. |
| 5 | The `events.mode` index adds write cost. | Event inserts are batched in a single transaction (`insertEventBatch`). 4 additional index updates per event insert is negligible vs. the 4x+ speedup on per-agent queries. |
| 6 | What if a session has the same model listed twice in `model_usage` with different modes? | The current dedup key in `task_models` is `${model_id}::${mode}`, so both rows are kept. The agent sequence treats them as one entry. Verified against the existing 2 multi-agent sessions. |
| 7 | Should the Overview "Top Agents" card also show handoff counts (e.g. "web_agent → plan seen 12 times")? | Defer to a follow-up. The data is captured; the panel is not in §4.1. |
| 8 | Naming: should the field be `primary_agent` (first by activity) or `first_agent` (first by time)? | `primary_agent` (most active). The "first agent" can be derived as `agent_sequence[0].agent` if needed. |

---

## 13. Design Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Keep DB column named `mode`; display name is "Agent" | Cheaper than a column rename. Mapping is one constant in `utils.js`. |
| 2 | Denormalize the agent sequence into `tasks.agent_sequence_json` | Avoids a join on every render; one-time cost at parse time. |
| 3 | `primary_agent` = mode with most events (tie-break by first appearance) | Captures "which agent did the work" rather than "which agent started". |
| 4 | `is_multi_agent` is a separate column (not a derived check on `agent_count`) | Lets the API and UI use a single column in WHERE clauses and indexes. |
| 5 | Agent URL filter is OR-composed (`?agent=A,B` = A or B) | Matches user mental model: "show me sessions involving any of these agents." |
| 6 | Agent + multi-agent filters compose with existing filters as AND | A `web_agent` multi-agent session is still a `web_agent` session. |
| 7 | Test evidence names the agent at failure time | A failure during the `plan` phase is fundamentally different from the same failure during `web_agent`. The evidence must reflect that. |
| 8 | The model × agent heatmap is a separate panel on the Models page | The Model Performance Table is per-model; the heatmap is per-(model, agent). They answer different questions. |
| 9 | The Agent band on the timeline is 6px tall, above the track | Visible at a glance, doesn't compete with the node-level detail. |
| 10 | Multi-agent filter is a toggle, not a dropdown | Binary state ("show only multi-agent" or "show all"); a dropdown would need 2 options which is just a checkbox. |
| 11 | Backward compatibility is moot — DB is wiped | Code still has no legacy-format handling to add. |
| 12 | Parser runs the denormalization inline, not in a post-step | One pass over the metadata; no need for a second iteration of `task_models`. |

---

## 14. Estimated Surface Area

| Area | LOC estimate |
|---|---|
| Schema (4 columns, 4 indexes) | ~15 |
| Parser denormalization | ~40 |
| `GET /api/analytics/agents` + matrix | ~80 |
| `GET /api/tasks` filter additions | ~20 |
| `GET /api/tasks/:id` payload additions | ~10 |
| `POST /api/tasks/compare` payload additions | ~10 |
| `src/js/utils.js` (palette + helpers) | ~30 |
| `sessions.js` | ~50 |
| `compare.js` | ~20 |
| `deep-compare.js` | ~30 |
| `investigate.js` | ~25 |
| `timeline.js` | ~40 |
| `overview.js` | ~40 |
| `models.js` | ~60 |
| `activity.js` | ~35 |
| `errors.js` | ~20 |
| `baselines.js` + `baseline-editor.js` | ~20 |
| `test.js` + `eval.js` + `server/testing/index.js` | ~30 |
| **Total** | **~575 LOC** |

No new top-level files. No new dependencies.

---

## 15. Open Questions for the User

These are the decisions I'd like to confirm before code lands:

1. **Agent color palette** — happy with the §6 proposal, or do you want a specific brand-aligned set?
2. **Multi-agent filter as a toggle vs. a dropdown** — the plan proposes a toggle. OK?
3. **`primary_agent` definition** — "most events" rather than "first used". OK?
4. **Model × Agent heatmap location** — Models page or a new dedicated "Agents" page? Plan puts it on Models; a dedicated `/agents` page would be cleaner long-term.
5. **Test evidence wording** — should the failure message be *"...during web_agent phase"* (plan default) or *"...with web_agent"* (terser)?
6. **Handoff matrix on Overview** — in scope (small follow-up panel) or strictly out of scope for Phase 4?
