# Agent Context — Phase 4 Requirements

> **Version:** 4.1 (Draft)
> **Created:** 2026-06-03
> **Updated:** 2026-06-03
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
| Multi-agent sessions | Real sessions today span 2–4 agents with re-entries (e.g. `web_agent → plan → plan → agent`, where the second `plan` is a different model). Indistinguishable from single-agent sessions. | Dedicated "Agent handoff" panel on the session detail page, timeline dividers, and a "session is multi-agent" filter. |
| Per-session heuristic metrics (TUE/RD/CE/ERR) | Defined in **one** place (`routes/tasks.js` evaluate), but never aggregated per-model and not visible in the Overview at all. | Same definitions, exposed per-model in the Overview's Top Models section, sortable by each metric, scoped by the new agent filter. |
| Aggregation | "Top models" / "Top tools" / "Activity by category" exist. No breakdown by agent. | "Top agents", "Model × Agent matrix", "Longest tasks per agent", "Cost per agent", "Errors per agent". |
| Filtering | URL filters: `status`, `model_id`, `error_category`, `tool_name`, `hasErrors`, `hasReasoning`. | Add `agent` filter; add `multi_agent` filter. Compose with existing filters. |
| Baselines | "Set as Baseline" modal shows the model of the first model row, not the agent. | Surface the agent chain in the baseline metadata. |
| Test & Compare | Behavioral testing reports the model's score. | Report the **agent-aware** score: a baseline built from a `web_agent` session should compare only to other `web_agent` sessions by default, and the report should state which agent was active during each failure. |

### 1.2 What Phase 4 Delivers

| # | Area | Summary |
|---|------|---------|
| 1 | **Naming & schema** | Promote `mode` → `agent` (display) while keeping `mode` as the storage column. Add a `tasks` summary of the agents used (`primary_agent`, `agent_count`, `is_multi_agent`, `agent_sequence_json`). Add the missing indexes. **Preserve re-entries** in the agent sequence. |
| 2 | **Single source of truth for heuristic metrics** | New `server/analytics/metrics.js` exporting `computeSessionMetrics(task, events)` and `aggregateModelMetrics(metrics[])`. Replaces the ad-hoc block in `routes/tasks.js` evaluate. Same definitions used by Overview, Sessions, Compare, Deep-Compare, Test, Eval, and Models. |
| 3 | **Overview master filter** | A *natural*, always-visible agent filter at the top of the Overview — every Overview stat, panel, and chart is scoped by it. Default = "All agents". Implemented as a row of agent chips next to the date picker (not a buried dropdown). |
| 4 | **Metric-driven Top Models** | Top Models panel on Overview is sortable by Tool Use Efficacy, Error Recovery, Reasoning Density, Context Efficiency (the four heuristic metrics), as well as the existing dimensions. Each metric has a tooltip with the exact definition (one source of truth). |
| 5 | **Sessions page** | New "Agent" column with chips; URL filter `?agent=web_agent`; "Multi-agent only" toggle; agent shown in the Set-as-Baseline modal. |
| 6 | **Investigate & Timeline pages** | New "Agents" panel in the task summary. Timeline gets an agent-color band under each node; the event detail panel shows the active agent at the timestamp. Investigate list-item left border is color-coded by agent. |
| 7 | **Compare & Deep-Compare** | New "Agent" row in the comparison table. Deep Compare column header shows the agent chain (e.g. `web_agent → plan → plan → agent`). |
| 8 | **Models page** | Existing "Mode" badge upgraded to a clickable chip; new "Model × Agent" heatmap matrix; sortable by the 4 heuristic metrics. |
| 9 | **Activity page** | New "Activity by Agent" matrix on the Activity page. |
| 10 | **Errors page** | New "By Agent" breakdown alongside By Model and By Category. |
| 11 | **Baselines** | Surface the source session's agent chain on baseline cards and on the editor. |
| 12 | **Backend analytics** | New endpoints: `GET /api/analytics/agents`, `GET /api/analytics/agent-matrix`. Extend `/api/analytics/models` with per-model TUE/RD/CE/ERR aggregates. |
| 13 | **Test & Evaluate** | Test results and Evaluate report include the agent chain. Behavioral test evidence names the agent at failure time. |

### 1.3 Design Principles

1. **No data migration.** User will wipe `data/dashboard.db`. All schema changes are additive.
2. **No re-parse of old files.** The parser already populates `mode` per model usage, so everything is derivable in SQL from existing tables.
3. **`mode` stays as the storage column name.** Display name is "Agent" everywhere. The mapping is one constant in `utils.js`.
4. **Multi-agent is first-class, including re-entries.** Consecutive same-agent phases are real (e.g. `web_agent → plan → plan → agent` = exited plan and re-entered with a different model). We preserve the full ordered phase list in `agent_sequence_json`.
5. **Metric definitions are a single source of truth.** TUE / RD / CE / ERR are defined in one module and used everywhere. UI tooltips link to that definition.
6. **Master filter is natural, not bolted-on.** The Overview's agent filter sits in the same bar as the date picker, not as an "Advanced" section.
7. **Answers the user's questions out of the box.** The endpoint and the UI must support, on day one: *best model per agent, top agents, longest tasks per agent, cost per agent, errors per agent, multi-agent session list, agent handoff timeline, model ranking by TUE/RD/CE/ERR per agent*.

### 1.4 Findings from Real Task Files

I examined 9 real task folders under `<user-home-dir>/Library/Application Support/Code[-Insiders]/User/globalStorage/postqode.postqode/tasks/` and verified the following:

1. **Multi-agent + re-entries are real.** Task `1778148395003` has 4 `model_usage` entries — `web_agent (kimi)`, `plan (opus)`, `plan (kimi)`, `agent (kimi)` — and 451 events split across the 3 agents. The user went into plan, exited (which switched models), went back into plan with a different model, then exited to general.
2. **`task_models` already preserves the (model, mode) tuple per entry** — even when the same mode appears twice with different models. The `model_id::mode` dedup is correct as-is.
3. **`events.mode` is populated per event** for all agent-bound events. ~6% of events have `NULL` mode — these are system events (`command_output`, `resume_task`, `plan_mode_respond`, `deleted_api_reqs`) that don't belong to any agent. The aggregator must filter `mode IS NOT NULL` for per-agent counts but never error on NULL.
4. **59 tasks in /Code, 118 tasks in /Code - Insiders** (177 total folders; DB has 140 parsed — the rest will be picked up after the wipe and re-parse). The Insiders path is where the multi-agent sessions live; the Code path is currently all single-agent.
5. **Files in each task folder:** `api_conversation_history.json`, `focus_chain_taskid_<id>.md`, `task_metadata.json`, `ui_messages.json`. No surprises.

These findings drive the schema/UI decisions in §2 and §3.

---

## 2. Data Model

### 2.1 New `tasks` columns

Computed by the parser at insert time (one SQL aggregation over `task_models` and `events`):

```sql
ALTER TABLE tasks ADD COLUMN primary_agent TEXT;          -- mode with the most events; tie-break by first occurrence
ALTER TABLE tasks ADD COLUMN agent_count INTEGER DEFAULT 0; -- DISTINCT modes in task_models (deduped view)
ALTER TABLE tasks ADD COLUMN is_multi_agent INTEGER DEFAULT 0; -- 1 when agent_count > 1
ALTER TABLE tasks ADD COLUMN agent_sequence_json TEXT;     -- JSON array of phases, in order of first appearance (preserves re-entries)
```

### 2.2 New indexes

```sql
CREATE INDEX IF NOT EXISTS idx_task_models_mode ON task_models(mode);
CREATE INDEX IF NOT EXISTS idx_events_mode      ON events(mode);
CREATE INDEX IF NOT EXISTS idx_tasks_primary_agent ON tasks(primary_agent);
CREATE INDEX IF NOT EXISTS idx_tasks_multi_agent ON tasks(is_multi_agent);
```

The `events.mode` index is the heavy hitter — the event table holds 12k+ rows and every per-agent aggregation joins on it.

### 2.3 Why compute in the parser, not at query time?

The agent sequence is a denormalized JSON blob. The reasoning:

- The UI calls it on nearly every page (Sessions, Investigate, Timeline, Compare, Test, Baselines, Overview). Pre-computing avoids a 4-way join on every render.
- The first-appearance order is stable per session, so the JSON can be regenerated deterministically if the schema is ever changed.
- One-time cost on parse, zero per-render cost.

### 2.4 What `primary_agent` is *not*

- It is **not** a "best" agent — it's the one that ran the most events. For a `web_agent → plan → plan → agent` session, primary could be `web_agent` (lots of tool calls) while the user actually cared about `plan`.
- It is **not** authoritative for multi-agent sessions — the UI must always render the full chain, never just the primary.

### 2.5 Sample shape of `agent_sequence_json`

**Multi-agent with re-entries (the real `1778148395003`):**

```json
[
  { "agent": "web_agent",  "model_id": "moonshotai/kimi-k2.6",     "ts_first": 1778148395310, "ts_last": 1778153050000, "event_count": 417, "cost": 0.91 },
  { "agent": "plan",       "model_id": "anthropic/claude-opus-4.7", "ts_first": 1778153072237, "ts_last": 1778153133000, "event_count": 9,   "cost": 0.18 },
  { "agent": "plan",       "model_id": "moonshotai/kimi-k2.6",     "ts_first": 1778153133825, "ts_last": 1778153216000, "event_count": 5,   "cost": 0.04 },
  { "agent": "agent",      "model_id": "moonshotai/kimi-k2.6",     "ts_first": 1778153217026, "ts_last": 1778153600000, "event_count": 20,  "cost": 0.07 }
]
```

The UI may **collapse consecutive same-agent phases** for display (e.g. `web_agent → plan → agent` with a "(model switched)" badge on `plan`), but the raw JSON preserves the original 4 entries so the Investigate and Timeline views can show the full chronology.

### 2.6 Agent re-entry semantics

A real task may have model_usage like `[web_agent, plan, plan, agent]`. The parser must:

- **Keep all 4 entries in `task_models`** — done today via the `${model_id}::${mode}` dedup key. ✅
- **Emit 4 entries in `agent_sequence_json`** (one per `model_usage` row) in first-appearance order. Adjacent same-agent phases are NOT merged. ✅
- **Set `agent_count` to the number of distinct agents** (3 for the example), not the number of phases.
- **Set `is_multi_agent = 1` whenever `agent_count > 1`** — same as today.

This makes the UI able to show "this user went into plan twice" without losing fidelity.

### 2.7 NULL `events.mode` is normal

~6% of events have `mode = NULL`. They are system events (`command_output`, `resume_task`, `plan_mode_respond`, `deleted_api_reqs`) and are not associated with any agent. All per-agent aggregations filter `mode IS NOT NULL AND mode != ''`. NULL-mode events are still attributed to the task as a whole, so `tasks.total_cost == SUM(events.cost)` regardless of mode.

---

## 3. Backend Changes

### 3.1 Files to modify

| File | Change |
|---|---|
| `server/cache/db.js` | Add the 4 new `tasks` columns and 4 new indexes inside `initSchema()`. Add the same to the `migrations` array. |
| `server/parser/index.js` | After `saveTask`, compute the agent sequence (preserving re-entries) and write via the new `buildAgentMeta` helper. |
| **`server/analytics/metrics.js`** *(new)* | **Single source of truth for the 4 heuristic metrics.** Exports `computeSessionMetrics(task, events)` and `aggregateModelMetrics(perSessionMetrics[])`. See §6. |
| `server/routes/tasks.js` | Replace the inline metric block in `GET /:id/evaluate` with `computeSessionMetrics`. Extend `GET /api/tasks` filters to accept `agent` and `multi_agent=1`. Extend row payload with `primary_agent`, `agent_count`, `is_multi_agent`, `agent_sequence`. |
| `server/routes/analytics.js` | Add `GET /api/analytics/agents`, `GET /api/analytics/agent-matrix`. Extend `GET /api/analytics/models` with `avg_tue`, `avg_rd`, `avg_ce`, `avg_err` (per-model aggregates). |
| `server/routes/baselines.js` | No schema change on `baselines`. Add a derived `source_agents` field to the GET response. |
| `server/testing/index.js` | When a baseline is provided, the test runner includes the active agent in each evidence entry so reports say *"web_agent failed tool TIA at timestamp X"*. |

### 3.2 New analytics endpoints

#### `GET /api/analytics/agents`

One row per agent. Powers the Overview "Top Agents" card, the Errors "By Agent" tab, the Activity "By Agent" matrix, and the Models heatmap row labels.

```sql
SELECT
  e.mode AS agent,
  COUNT(DISTINCT e.task_id) AS task_count,
  COUNT(*)                 AS event_count,
  SUM(e.cost)              AS total_cost,
  SUM(e.tokens_in)         AS total_tokens_in,
  SUM(e.tokens_out)        AS total_tokens_out,
  COUNT(DISTINCT CASE WHEN e.error_category IS NOT NULL THEN e.task_id END) AS affected_task_count,
  SUM(CASE WHEN e.error_category IS NOT NULL THEN 1 ELSE 0 END)            AS total_errors,
  AVG(t.duration)          AS avg_duration,
  MAX(t.duration)          AS max_duration,
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
  { "agent": "web_agent", "task_count": 74, "event_count": 5600, "total_cost": 12.34, "avg_cost": 0.16, "avg_duration": 320000, "max_duration": 1850000, "completed": 60, "total_errors": 14, "affected_task_count": 9 },
  ...
]
```

Optional sub-breakdowns (returned alongside):
- `top_models_per_agent: { agent: [{model_id, task_count, avg_cost, completion_rate, avg_tue, avg_ce}, ...] }`
- `longest_sessions_per_agent: { agent: [task, task, task] }` — top 5 by `duration`
- `activity_by_agent: { agent: { category: task_count } }`

#### `GET /api/analytics/agent-matrix?dimension=model|activity|status`

Returns a sparse pivot. Example for `dimension=model`:

```json
{
  "rows":    ["web_agent", "agent", "mobile_agent"],
  "cols":    ["claude-3.5", "kimi-k2", "gpt-4o"],
  "values":  [ [12, 8, 4], [3, 2, 0], [9, 1, 0] ],
  "metric":  "task_count"
}
```

### 3.3 Extended `GET /api/analytics/models`

Add 4 columns (per-model aggregates of the heuristic metrics):

```sql
SELECT
  tm.model_id,
  ...existing columns...,
  AVG(m.tue) AS avg_tue,
  AVG(m.rd)  AS avg_rd,
  AVG(m.ce)  AS avg_ce,
  AVG(m.err) AS avg_err,
  COUNT(m.tue) AS scored_sessions     -- sessions that had a computable score for this metric
FROM task_models tm
INNER JOIN tasks t ON t.id = tm.task_id
LEFT JOIN session_metrics m ON m.task_id = t.id
...
```

The `session_metrics` table is a new cache (see §3.4).

### 3.4 New `session_metrics` table (optional but recommended)

```sql
CREATE TABLE IF NOT EXISTS session_metrics (
  task_id TEXT PRIMARY KEY,
  tue INTEGER,  -- 0-100; NULL if not computable
  rd  INTEGER,
  ce  INTEGER,
  err INTEGER,
  computed_at INTEGER,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);
CREATE INDEX IF NOT EXISTS idx_session_metrics_tue ON session_metrics(tue);
```

The parser computes the four metrics once per task and stores them. This makes per-model aggregations cheap (no per-rerun recalculation). The parser populates it; a one-shot backfill on existing rows is fine but optional (we're wiping the DB).

### 3.5 New filters on `GET /api/tasks`

| Param | SQL effect |
|---|---|
| `agent=web_agent` | `INNER JOIN task_models tm ON t.id = tm.task_id WHERE tm.mode = 'web_agent'` |
| `agent=web_agent,mobile_agent` | `tm.mode IN ('web_agent', 'mobile_agent')` (OR) |
| `multi_agent=1` | `t.is_multi_agent = 1` |
| `multi_agent=0` | `t.is_multi_agent = 0` (default) |

Both compose with every existing filter.

### 3.6 `POST /api/tasks/compare` agent payload

Each task in the response gets `primary_agent`, `agent_count`, `is_multi_agent`, `agent_sequence`. The deep-compare header then renders the chain as chips:

```
[ web_agent 0:54:11 ] → [ plan(opus) 0:01:00 ] → [ plan(kimi) 0:01:22 ] → [ agent 0:06:21 ]
```

(Adjacent same-agent phases may be collapsed to a single chip with a `(2 phases)` badge.)

---

## 4. Frontend Changes — Page by Page

### 4.0 Overview master filter (new — natural placement)

The Overview page is the first thing the user sees. A top bar carries:

```
[ Date range: Mar 1 – Jun 3 ]   Agents:  [ ● All  | web_agent | agent | mobile_agent | api_agent | +6 more ▾ ]
```

**Natural placement, not bolted on:**
- The agent chip row lives in the same `.top-bar` as the date picker, immediately to the right.
- "All" is the default; selected agent is highlighted with its color (see §7 palette).
- "+6 more ▾" reveals less-common agents in a dropdown (those with task_count below the median).
- Hovering any chip shows a tooltip: `web_agent · 74 sessions · 12.3 cost · 81% completion`.
- Clicking any chip reloads **only the Overview's data** with the agent filter applied. The URL is *not* changed (Overview is a "lens", not a page-state).
- A "Filter is active" pill at the top-right of every Overview panel subtly reminds the user that the numbers are scoped.

**What the filter does:**
- All `api.overview`, `api.models`, `api.reasoning`, `api.activity` calls are made with `agent=...` appended.
- All stat cards (Sessions, Total Cost, Errors, Completion, Tokens, Cache Hit, Tool Calls, Reasoning, 1-Shot Rate) reflect the scoped numbers.
- "Top Models" and "Top Agents" panels both reflect the scope. (If you pick `web_agent`, "Top Agents" still shows the relative weight inside that cohort — useful for spotting sub-agents within a multi-phase run.)
- "Activity Snapshot" and "Reasoning Impact Analysis" also reflect the scope.

**No URL state.** Overview is the launch pad; URL-based deep-linking into a filtered Overview isn't a use case worth supporting (clicking a card jumps to the relevant page with the right filter).

### 4.0b Metric-driven Top Models (new)

The "Top Models" panel on Overview is upgraded from a static sort-by-task_count table to a **sortable** table with these columns:

| Column | Default | Notes |
|---|---|---|
| Model | (always visible) | mono, shortened |
| Sessions | (visible) | `m.task_count` |
| Total Cost | (visible) | green, with cost bar |
| Errors | (visible) | badge |
| **Tool Use Efficacy** ⇅ | sortable | `m.avg_tue` (0–100) |
| **Error Recovery** ⇅ | sortable | `m.avg_err` (0–100) |
| **Reasoning Density** ⇅ | sortable | `m.avg_rd` (0–100) |
| **Context Efficiency** ⇅ | sortable | `m.avg_ce` (0–100) |
| Completion Rate | sortable | |
| Cache % | sortable | |
| Agent(s) | (visible) | chips |

**Sort UX:**
- Click a column header to sort ascending; click again for descending; click a third time to clear.
- The default sort is `Sessions DESC`. Sort selection is per-session (not URL-stored).
- Each metric header has a `?` icon whose tooltip shows the exact definition (linked to the source of truth in §6).

**Consistency with the rest of the app:** the same metric values appear on:
- `routes/tasks.js evaluate` (per-session) — already does this
- `routes/analytics.js /api/analytics/models` (per-model) — **new**
- `compare.js` and `deep-compare.js` (per-session in the comparison table) — already exist
- The Compare and Deep-Compare tooltips and modals show the *same* definition, not a reworded one.

### 4.1 `src/js/views/overview.js` — Top Agents + Top Models upgrades

- Implement §4.0 master filter.
- Upgrade Top Models per §4.0b.
- New "Top Agents" panel mirroring the (upgraded) "Top Models" panel. Each row shows: agent name, sessions, total cost, errors, completion rate. Click → opens Sessions filtered by that agent. (Click-to-filter is via `window.location.hash`, not the Overview-only lens.)

### 4.2 `src/js/views/sessions.js` — Agent column + filter

| Change | Detail |
|---|---|
| New column "Agent(s)" | Chip per phase. If `is_multi_agent`, prefix with a small `+N more` and a `⇌` badge. Each chip is clickable → filter by that agent. |
| New URL filter `?agent=` | Wires into the active-filter chip strip and a new `f-agent` dropdown. |
| New `f-agent` dropdown | Lists distinct agents + a "Multi-agent only" option. |
| Set-as-Baseline modal | Show the agent chain under the model line. |
| URL params for multi-agent | `?multi_agent=1` works alongside the dropdown. |

### 4.3 `src/js/views/investigate.js` — Agents panel + color-coded list

- New summary item "Agents" in the Task Summary. For multi-agent sessions, an expanded panel shows the full phase list with start/end timestamps, model used, and event count.
- The event list's left border is color-coded by the event's `mode` (using the palette in §7). Makes long sessions scannable for handoffs.

### 4.4 `src/js/views/timeline.js` — Agent band

- A 6px colored band above the existing timeline track shows the active agent across time. Handoff borders are hard edges.
- Event detail panel: include `Active agent: web_agent` alongside the model_id line.

### 4.5 `src/js/views/compare.js` — Agent row

- New "Agent" row in the comparison table. Click → modal with full sequence.

### 4.6 `src/js/views/deep-compare.js` — Agent chain in column header

- Column header shows the **agent chain chips** above the model short-name. Adjacent same-agent phases are visually merged with a `(2 phases)` badge.

### 4.7 `src/js/views/models.js` — Heatmap + metric sort

- Rename "Mode" column to "Agent" (label only — `m.mode` is unchanged).
- Add a click handler on the badge → Sessions filter.
- Add the **"Model × Agent matrix"** heatmap. Renders `/api/analytics/agent-matrix?dimension=model`. Cell click → Sessions with both `model_id` and `agent` filters.
- Add sortable metric columns to the Model Performance Table (same metrics as Overview's Top Models).

### 4.8 `src/js/views/activity.js` — Activity × Agent

- New "Activity by Agent" panel. Pivots `(agent, activity_category)` using the existing gradient-bar treatment. Answers *"is delegation only in mobile_agent?"*.

### 4.9 `src/js/views/errors.js` — By Agent tab

- Third tab "By Agent" alongside "By Category" and "By Model". Same layout: agent, error count, affected sessions, errors-per-session, sortable.

### 4.10 `src/js/views/baselines.js` + `baseline-editor.js`

- Each baseline card shows an "Agent(s)" chip in the summary. When `agent_count > 1`, an "Agents" row in the metadata grid shows the full chain.
- The baseline editor's header gets a read-only "Source Agent(s)" field.

### 4.11 `src/js/views/test.js` + `eval.js` + `server/testing/index.js`

- Test page header: show the session's agent chain next to the model line.
- Test evidence names the agent at failure time: *"Tool 'Bash' missing during web_agent phase (0:02:14–0:03:30)"*. The test runner reads `e.mode` from the events table for each violation.
- Evaluate page: add "Agents used" line in the task summary.

---

## 5. Filtering & URL Conventions

| URL fragment | Effect |
|---|---|
| `#/sessions?agent=web_agent` | Sessions where `web_agent` was one of the agents used. |
| `#/sessions?agent=web_agent,mobile_agent` | Sessions where **any** of the listed agents ran (OR). |
| `#/sessions?multi_agent=1` | Sessions with >1 distinct agent. |
| `#/sessions?agent=web_agent&multi_agent=1` | Composes (AND): web_agent sessions that are also multi-agent. |
| `#/sessions?agent=web_agent&model_id=claude-3.5` | web_agent sessions that used claude-3.5. |
| `#/models?agent=web_agent` | Models page filtered to only those that ran in `web_agent`. |
| `#/compare?tasks=A,B&agent=web_agent` | Compare only when all selected tasks are web_agent sessions; warns otherwise. |

The Sessions filter chip strip surfaces every active filter, including the new ones.

---

## 6. Metric Definitions — Single Source of Truth

All four heuristic metrics are defined in **`server/analytics/metrics.js`** (new file). The same module is consumed by:
- `server/routes/tasks.js` (`GET /:id/evaluate` per-session)
- `server/routes/analytics.js` (`/api/analytics/models` per-model aggregate)
- Frontend tooltips (served via `GET /api/analytics/metric-defs` so the UI never hard-codes the wording)

### 6.1 Definitions

| Metric | Direction | Formula | NULL when |
|---|---|---|---|
| **Tool Use Efficacy (TUE)** | higher = better | `100 * (tool_calls − tool_errors) / tool_calls`. `tool_errors` = events with `error_category IN ('tool_error','validation_error')` (see `server/testing/shared.js`). | No tool events. |
| **Error Recovery (ERR)** | higher = better | `100` if no errors. `100` if `status='completed'` regardless of errors. `0` if non-completed and `error_count > 0`. | Never. |
| **Reasoning Density (RD)** | higher = better | `100 * reasoning_events / (reasoning_events + api_events + tool_events)`. | No core actions. |
| **Context Efficiency (CE)** | higher = better | `100 − AVG(context_pct)` across `api_req_started` events with a non-null `context_pct`. | No `context_pct` data. |

### 6.2 `GET /api/analytics/metric-defs`

```json
{
  "tue": { "label": "Tool Use Efficacy", "short": "TUE", "unit": "%", "better": "higher",
            "formula": "100 × (tool calls − tool errors) ÷ tool calls",
            "details": "Excludes tool errors and validation errors. NULL when no tool calls were made." },
  "err": { "label": "Error Recovery", "short": "ERR", "unit": "%", "better": "higher",
            "formula": "100 if no errors, else 100 if completed, else 0",
            "details": "A session that completes despite many errors still scores 100." },
  "rd":  { "label": "Reasoning Density", "short": "RD", "unit": "%", "better": "higher",
            "formula": "100 × reasoning events ÷ (reasoning + API + tool events)",
            "details": "Reflects how often the agent paused to think before acting." },
  "ce":  { "label": "Context Efficiency", "short": "CE", "unit": "%", "better": "higher",
            "formula": "100 − average context_pct across API requests",
            "details": "100 = the context window was never used. 0 = the window was full on average." }
}
```

### 6.3 Naming hygiene

The behavioral test patterns are TIA / BCV / MTV / BSE / ERC / CEC. The heuristic metrics are TUE / RD / CE / ERR. They are different things and the names must stay distinct — the test pattern **CEC** ("Context Efficiency Compliance") and the heuristic **CE** ("Context Efficiency") look similar but mean different things. The UI must never abbreviate one to the other's label.

### 6.4 Module API

```js
// server/analytics/metrics.js
function computeSessionMetrics(task, events) {
  // returns { tue: number|null, rd: number|null, ce: number|null, err: number }
}

function aggregateModelMetrics(perSessionMetrics) {
  // returns { avg_tue, avg_rd, avg_ce, avg_err, scored_sessions } with NULL-safe averages
}

function metricDefs() { return /* the JSON from §6.2 */; }

module.exports = { computeSessionMetrics, aggregateModelMetrics, metricDefs };
```

---

## 7. Agent Color Palette

Stable across every page so a glance tells the user which agent handled a row/event/segment.

```js
export const AGENT_COLORS = {
  'web_agent':           '#5B9EF5',
  'agent':               '#F5C85B',
  'plan':                '#7B9EF5',
  'mobile_agent':        '#5BF58C',
  'api_agent':           '#F55BE0',
  'web-automation-pro':  '#5BF5E0',
  'web-performance-pro':  '#F5A05B',
  'api-performance-pro': '#E05BF5',
  'act':                 '#F55B5B',
  'code-reviewer':       '#CCCCCC',
};
// fallback: hash(agent) → palette[hash % palette.length]
```

Centralize in `src/js/utils.js`. The Overview master filter chip uses the same color for its selected state.

---

## 8. The Questions This Plan Answers

| Question | Answer path |
|---|---|
| "Which model works great with web_agent?" | Models page → Model × Agent heatmap → sort `web_agent` column by `avg_tue` or completion rate. |
| "Top used model in agent mode?" | Models page → Top Models → sort by Sessions; OR filter to `agent=agent`. |
| "Longest running tasks with api_agent?" | `GET /api/analytics/agents` → `longest_sessions_per_agent.api_agent`. UI: a "Top 5 longest" mini-panel on the Agents card. |
| "Sessions that used a plan agent?" | `#/sessions?agent=plan`. |
| "How often does web_agent hand off to plan?" | Aggregate from `agent_sequence_json` — count transitions `web_agent → plan`. Add as a small "Handoff matrix" panel on Overview (optional Phase 4.1 follow-up). |
| "Which agent has the lowest error rate?" | Errors page → By Agent tab, sorted ascending by errors-per-session. |
| "Did switching agents improve the outcome?" | Compare view → see `primary_agent` per row. Filter Sessions to `is_multi_agent=1` and compare completion rates against single-agent. |
| "What does an agent handoff look like in time?" | Timeline → agent band. Investigate → Agents panel with start/end timestamps. |
| "Best TUE for any model in web_agent?" | Overview → master filter `web_agent` → Top Models → sort by Tool Use Efficacy. |
| "Models with high context efficiency on api_agent?" | Overview → master filter `api_agent` → Top Models → sort by Context Efficiency. |
| "Did this model handle 90% CE with api_agent?" | Click a model in Top Models → Models page → sortable column confirms. |
| "Is there a model with 0% errors and high RD on mobile_agent?" | Overview → `mobile_agent` → sort by Error Recovery (desc) then Reasoning Density (desc). |

---

## 9. Implementation Plan (Build Order)

Each step is independently demoable.

| # | Step | Files touched | Demo outcome |
|---|------|---------------|--------------|
| 1 | `server/analytics/metrics.js` — single source of truth for TUE/RD/CE/ERR | new file | curl `metric-defs` returns the table. |
| 2 | `session_metrics` table + parser denormalization | `server/cache/db.js`, `server/parser/index.js` | Wipe DB, reparse → every task has `primary_agent`, `agent_sequence_json`, and 4 metric scores. |
| 3 | Task API filters + payload + new agent endpoints | `server/routes/tasks.js`, `server/routes/analytics.js` | curl `?agent=web_agent` works; `/api/analytics/agents` returns. |
| 4 | `src/js/utils.js` — `AGENT_COLORS`, `fmtAgentChain`, `agentChip` | `src/js/utils.js` | Reusable. |
| 5 | Overview master filter (lens) | `src/js/views/overview.js` | All panels respect the chip selection. |
| 6 | Overview Top Models sortable by metrics | `src/js/views/overview.js`, `src/js/components/charts.js` (helpers) | Sort by TUE, RD, CE, ERR works. |
| 7 | Top Agents card on Overview | `src/js/views/overview.js` | New card; click → Sessions. |
| 8 | Sessions: agent column + filter + multi-agent filter | `src/js/views/sessions.js` | New column and filter work. |
| 9 | Compare + Deep-Compare: agent row + column header | `src/js/views/compare.js`, `src/js/views/deep-compare.js` | Side-by-side shows the chain. |
| 10 | Investigate + Timeline: agent band + Agents panel | `src/js/views/investigate.js`, `src/js/views/timeline.js` | Visual handoff is visible. |
| 11 | Models: heatmap + Mode→Agent rename + metric sort | `src/js/views/models.js` | Heatmap answers "best model for web_agent". |
| 12 | Activity: Activity × Agent matrix | `src/js/views/activity.js` | Cross-pivot. |
| 13 | Errors: By Agent tab | `src/js/views/errors.js` | Per-agent breakdown. |
| 14 | Baselines: source agent chip + editor field | `src/js/views/baselines.js`, `src/js/views/baseline-editor.js` | Cards show the chain. |
| 15 | Test + Eval: agent context in headers and evidence | `src/js/views/test.js`, `src/js/views/eval.js`, `server/testing/index.js` | Reports name *which agent* during a failure. |
| 16 | Metric defs endpoint + UI tooltips (link from headers) | `server/routes/analytics.js`, all sortable-metric columns | Tooltips everywhere pull from `/api/analytics/metric-defs`. |
| 17 | Polish: filter composition, empty states, palette, handoff panel on Overview (optional) | All views | No regressions. |

---

## 10. Detailed Specs (selected)

### 10.1 Parser denormalization (`server/parser/index.js`)

```js
function buildAgentMeta(db, taskId, metadata) {
  const usage = (metadata?.models || []).slice().sort((a, b) => a.ts - b.ts);
  // First-appearance order, no merging of consecutive same-mode entries
  const phases = usage.filter(u => u.mode).map(u => ({
    agent: u.mode,
    model_id: u.model_id,
    ts_first: u.ts,
    ts_last: u.ts,
  }));
  // Merge consecutive same-(agent,model) entries (model switch within same mode is one phase)
  const merged = [];
  for (const p of phases) {
    const last = merged[merged.length - 1];
    if (last && last.agent === p.agent && last.model_id === p.model_id) {
      last.ts_last = p.ts;
    } else {
      merged.push({ ...p });
    }
  }
  // Per-mode event stats
  const eventStats = db.prepare(`
    SELECT mode, COUNT(*) as event_count, COALESCE(SUM(cost),0) as cost
    FROM events WHERE task_id = ? AND mode IS NOT NULL AND mode != ''
    GROUP BY mode
  `).all(taskId);
  const byMode = new Map(eventStats.map(s => [s.mode, s]));
  for (const ph of merged) {
    const s = byMode.get(ph.agent);
    ph.event_count = s?.event_count || 0;
    ph.cost = s?.cost || 0;
  }
  const distinctAgents = new Set(merged.map(p => p.agent));
  const primary = merged.slice().sort((a, b) =>
    (b.event_count - a.event_count) || (a.ts_first - b.ts_first)
  )[0]?.agent || null;
  return {
    primary_agent: primary,
    agent_count: distinctAgents.size,
    is_multi_agent: distinctAgents.size > 1 ? 1 : 0,
    agent_sequence_json: JSON.stringify(merged),
  };
}
```

### 10.2 `src/js/utils.js` additions

```js
export const AGENT_COLORS = { /* §7 */ };
const FALLBACK_PALETTE = ['#5B9EF5','#F5C85B','#7B9EF5','#5BF58C','#F55BE0','#5BF5E0','#F5A05B','#E05BF5','#F55B5B','#CCCCCC'];
function hashStr(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h); }
export function agentColor(agent) { return AGENT_COLORS[agent] || FALLBACK_PALETTE[hashStr(agent) % FALLBACK_PALETTE.length]; }

export function fmtAgentChain(sequence, { max = 3 } = {}) {
  if (!sequence?.length) return '—';
  // Collapse consecutive same-agent phases for display
  const collapsed = [];
  for (const s of sequence) {
    const last = collapsed[collapsed.length - 1];
    if (last && last.agent === s.agent) last.phase_count = (last.phase_count || 1) + 1;
    else collapsed.push({ agent: s.agent, phase_count: 1 });
  }
  const shown = collapsed.slice(0, max).map(c => c.agent + (c.phase_count > 1 ? ` ×${c.phase_count}` : ''));
  return shown.join(' → ') + (collapsed.length > max ? ` +${collapsed.length - max}` : '');
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

### 10.3 Overview master filter — render

```html
<div class="top-bar" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
  <div>
    <h1 class="view-title">Overview</h1>
    <p class="view-subtitle">${overview.total_tasks} sessions · ${topAgents.length} agents</p>
  </div>
  <div class="overview-filters" style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
    <!-- date picker -->
    <div class="agent-filter" style="display:flex;align-items:center;gap:6px">
      <span style="font-size:11px;color:var(--text-3)">Agents:</span>
      <button class="agent-chip ${state.agentFilter === null ? 'selected' : ''}" data-agent="">All</button>
      ${topAgents.map(a => `
        <button class="agent-chip ${state.agentFilter === a.agent ? 'selected' : ''}"
                data-agent="${escAttr(a.agent)}"
                style="--c:${agentColor(a.agent)}"
                title="${escAttr(a.agent)} · ${a.task_count} sessions · ${fmtCost(a.total_cost)}">
          ${escHtml(a.agent)}
        </button>
      `).join('')}
      ${overflowAgents.length ? `
        <select class="agent-overflow" data-agent-overflow>
          <option value="">+${overflowAgents.length} more…</option>
          ${overflowAgents.map(a => `<option value="${escAttr(a.agent)}">${escHtml(a.agent)} (${a.task_count})</option>`).join('')}
        </select>
      ` : ''}
    </div>
  </div>
</div>
```

```css
.agent-chip {
  background: transparent; border: 1px solid var(--border);
  color: var(--text-2); padding: 3px 9px; border-radius: 99px;
  font-size: 11px; font-family: var(--font-mono); cursor: pointer;
}
.agent-chip.selected { background: var(--c, var(--accent)); color: #fff; border-color: var(--c, var(--accent)); }
.agent-chip:hover { border-color: var(--c, var(--accent)); }
```

### 10.4 Metric-driven Top Models — sort handler

```js
let topModelsSort = { col: 'sessions', dir: 'desc' };

function applyTopModelsSort(models) {
  const { col, dir } = topModelsSort;
  const factor = dir === 'asc' ? 1 : -1;
  return [...models].sort((a, b) => {
    const av = a[col === 'sessions' ? 'task_count'
              : col === 'tue' ? (a.avg_tue ?? -1)
              : col === 'rd'  ? (a.avg_rd  ?? -1)
              : col === 'ce'  ? (a.avg_ce  ?? -1)
              : col === 'err' ? (a.avg_err ?? -1)
              : a[col]] ?? 0;
    const bv = b[col === 'sessions' ? 'task_count'
              : col === 'tue' ? (b.avg_tue ?? -1)
              : col === 'rd'  ? (b.avg_rd  ?? -1)
              : col === 'ce'  ? (b.avg_ce  ?? -1)
              : col === 'err' ? (b.avg_err ?? -1)
              : b[col]] ?? 0;
    return (av - bv) * factor;
  });
}
```

### 10.5 Metric tooltips

Each sortable metric header has a `?` icon. Hover loads the tooltip from `/api/analytics/metric-defs` (cached on first load in `window.PQ_METRIC_DEFS`). Example rendered tooltip for CE:

> **Context Efficiency** (CE) — higher is better
>
> `100 − average context_pct across API requests`
>
> 100 = context window never used. 0 = context was full on average.

### 10.6 Sessions page table row — new "Agent(s)" cell

```html
<td>
  <div style="display:flex;flex-wrap:wrap;gap:4px;align-items:center;max-width:240px">
    ${(t.agent_sequence || []).slice(0, 3).map(s => agentChip(s.agent)).join('')}
    ${(t.agent_sequence?.length || 0) > 3 ? `<span class="text-dim" style="font-size:10px">+${t.agent_sequence.length-3}</span>` : ''}
    ${t.is_multi_agent ? '<span class="badge purple" style="font-size:9px" title="Multiple agents in this session">⇌</span>' : ''}
  </div>
</td>
```

### 10.7 Timeline band (above the existing track)

```html
<div class="agent-band" style="display:flex;height:6px;border-radius:3px;overflow:hidden;margin-bottom:6px">
  ${(task.agent_sequence || []).map(s => `
    <div title="${escHtml(s.agent)} · ${fmtDuration(s.ts_last - s.ts_first)}"
         style="flex:${Math.max(1, s.ts_last - s.ts_first)};background:${agentColor(s.agent)}"></div>
  `).join('')}
</div>
```

### 10.8 Model × Agent heatmap

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

`heatmapColor(v, max)` returns `rgba(91,158,245, ${v/max * 0.85 + 0.05})`.

---

## 11. Verification

### 11.1 Schema

```bash
sqlite3 data/dashboard.db ".schema tasks" | grep -E "primary_agent|agent_count|is_multi_agent|agent_sequence"
sqlite3 data/dashboard.db ".schema session_metrics"
sqlite3 data/dashboard.db "SELECT name FROM sqlite_master WHERE type='index' AND (name LIKE 'idx_%agent%' OR name LIKE 'idx_%mode%');"
```

### 11.2 Data

```bash
# Coverage
sqlite3 data/dashboard.db "SELECT COUNT(*) total, COUNT(primary_agent) with_agent FROM tasks;"

# Multi-agent sessions
sqlite3 data/dashboard.db "SELECT id, primary_agent, agent_count, agent_sequence_json FROM tasks WHERE is_multi_agent = 1;"

# Re-entry check (phases > distinct agents)
sqlite3 data/dashboard.db "SELECT id, agent_count, json_array_length(agent_sequence_json) AS phases FROM tasks WHERE is_multi_agent = 1 AND json_array_length(agent_sequence_json) > agent_count;"
```

### 11.3 API

```bash
curl -s 'http://localhost:3456/api/analytics/agents' | jq
curl -s 'http://localhost:3456/api/analytics/metric-defs' | jq
curl -s 'http://localhost:3456/api/analytics/models' | jq '.[0] | {model_id, avg_tue, avg_rd, avg_ce, avg_err}'
curl -s 'http://localhost:3456/api/tasks?agent=web_agent&limit=5' | jq '.tasks[].agent_sequence'
curl -s 'http://localhost:3456/api/analytics/agent-matrix?dimension=model' | jq
```

### 11.4 UI smoke (manual)

1. Wipe `data/`, restart server, reparse → no errors.
2. **Overview master filter** — pick `web_agent`; every stat, panel, and chart updates; reset to "All".
3. **Overview Top Models** — sort by Tool Use Efficacy, then by Context Efficiency; numbers match `/api/analytics/models`.
4. **Overview Top Agents** — click an agent chip; jumps to Sessions filtered by that agent.
5. **Sessions** — Agent column shows; filter works; multi-agent filter works; Set-as-Baseline shows the chain.
6. **Investigate** — Agents panel expands for multi-agent sessions; list items color-coded.
7. **Timeline** — agent band visible; handoffs obvious; event detail mentions the active agent.
8. **Compare + Deep-Compare** — agent row present; deep-compare header shows the chain.
9. **Models** — heatmap renders; click drills into Sessions with both filters; metric sort works.
10. **Activity** — Activity × Agent matrix renders.
11. **Errors** — By Agent tab works.
12. **Baselines** — source agent chip on cards; field in editor.
13. **Test** — failure evidence names the agent.
14. **Filter composition** — `?agent=web_agent&multi_agent=1&status=completed&hasErrors=true` all work together.

### 11.5 Question-driven checks (regression-style)

| Question | Query |
|---|---|
| Best model for `web_agent` | `SELECT model_id, COUNT(DISTINCT task_id) c FROM task_models WHERE mode='web_agent' GROUP BY model_id ORDER BY c DESC LIMIT 3;` |
| Top agent | `SELECT primary_agent, COUNT(*) c FROM tasks GROUP BY primary_agent ORDER BY c DESC;` |
| Longest 5 `api_agent` sessions | `SELECT id, duration FROM tasks t WHERE EXISTS (SELECT 1 FROM task_models WHERE task_id=t.id AND mode='api_agent') ORDER BY duration DESC LIMIT 5;` |
| Most expensive agent | `SELECT e.mode, SUM(e.cost) c FROM events e GROUP BY e.mode ORDER BY c DESC;` |
| Error rate by agent | `SELECT e.mode, COUNT(*) errs, COUNT(DISTINCT e.task_id) tasks FROM events e WHERE e.error_category IS NOT NULL GROUP BY e.mode ORDER BY errs DESC;` |
| Multi-agent session count | `SELECT COUNT(*) FROM tasks WHERE is_multi_agent=1;` |
| Model with highest avg TUE | `SELECT model_id, avg_tue FROM session_metrics_per_model ORDER BY avg_tue DESC LIMIT 3;` |

---

## 12. Out of Scope (Explicit Non-Goals)

- **Renaming the `mode` column** to `agent` in the DB. Cost > benefit.
- **Migrating old data.** User will wipe and re-parse.
- **LLM-based agent detection.** Phase 4 only surfaces what the parser already captured.
- **Per-agent pricing tiers.** Separate phase.
- **Re-running the parser on old sessions.** Parser only runs on new sessions; schema migration is a one-time backfill.
- **Agent-level access control.** Out of scope.
- **URL state for the Overview master filter.** It's a lens, not a deep-link.
- **A dedicated `/agents` page.** The Overview, Models heatmap, and Agents card are sufficient. A dedicated page is a future phase.
- **Alerts/notifications on agent health.** Separate phase.

---

## 13. Risks & Mitigations

| # | Risk | Mitigation |
|---|---|---|
| 1 | The parser's `task_metadata.model_usage[].mode` may be missing on some sessions. Currently 91% event coverage; the rest default to `primary_agent = NULL`. | Treat NULL primary as "unknown" everywhere. The filter chip in the UI shows "(no agent)" for those. |
| 2 | The `event_count` and `cost` per phase in `agent_sequence_json` could drift from the `events` table. | Treat the JSON as a snapshot; if the user wants fresh numbers, the page re-fetches `/api/analytics/agents`. |
| 3 | Color collisions in the agent palette. | Hash-based fallback. Re-hashing the same agent always returns the same color (stable). |
| 4 | The `Models` table view currently uses `Mode` as one column. Renaming to `Agent` is a label change only. | Verified — `models.js` reads `m.mode` from the analytics endpoint. |
| 5 | The `events.mode` index adds write cost. | Event inserts are batched in a single transaction. Index cost is negligible vs. per-agent query speedup. |
| 6 | The same agent can be re-entered (e.g. `plan → plan` with different models). | `agent_sequence_json` preserves all phases; `agent_count` is distinct; UI may collapse for display. |
| 7 | Metric definitions diverge between the evaluate endpoint, analytics endpoint, and UI tooltips. | The new `server/analytics/metrics.js` is the single source of truth. UI tooltips fetch `/api/analytics/metric-defs` — no hard-coded wording. |
| 8 | The Overview master filter changes the meaning of every number on the page. Users may forget it's active. | A persistent "Filter: web_agent" pill at the top-right of every panel + an "× clear" link. |
| 9 | The metric column "Context Efficiency" in the heuristic metric set looks similar to the test pattern "CEC" (Context Efficiency Compliance). | §6.3 is explicit: keep the names distinct. UI never abbreviates one to the other. |
| 10 | The new `session_metrics` table requires a parser change. If the wipe happens after code lands but before re-parse, the table is empty. | The DB-level aggregations still work; the per-model metric columns just show `NULL` for unscored models. UI treats NULL as "no data" (greyed-out sort). |

---

## 14. Design Decisions

| # | Decision | Rationale |
|---|---|---|
| 1 | Keep DB column named `mode`; display name is "Agent" | Cheaper than a column rename. |
| 2 | Denormalize the agent sequence into `tasks.agent_sequence_json` | Avoids a join on every render. |
| 3 | `primary_agent` = mode with most events (tie-break by first appearance) | Captures "which agent did the work". |
| 4 | `is_multi_agent` is a separate column | Lets the API and UI use a single indexed column. |
| 5 | Agent URL filter is OR-composed (`?agent=A,B` = A or B) | Matches user mental model. |
| 6 | Agent + multi-agent filters compose with existing filters as AND | A `web_agent` multi-agent session is still a `web_agent` session. |
| 7 | Test evidence names the agent at failure time | A failure during `plan` is fundamentally different from the same failure during `web_agent`. |
| 8 | The model × agent heatmap is a separate panel on the Models page | Answers a different question than the per-model table. |
| 9 | The Agent band on the timeline is 6px tall, above the track | Visible at a glance, doesn't compete with node-level detail. |
| 10 | Multi-agent filter is a toggle, not a dropdown | Binary state; a dropdown with 2 options is just a checkbox. |
| 11 | The Overview master filter is a chip row, not a dropdown | Natural, scannable, fits in the same bar as the date picker. |
| 12 | The Overview master filter is a lens (no URL state) | Overview is a launch pad, not a deep-link target. |
| 13 | Metric definitions live in a single `metrics.js` module | One source of truth, no drift. |
| 14 | The 4 heuristic metrics are surfaced in Overview's Top Models as sortable columns | The user explicitly asked for this. |
| 15 | Test pattern "CEC" and heuristic "CE" stay distinct | They mean different things; abbreviating one to the other would mislead. |
| 16 | Adjacent same-agent phases are kept in `agent_sequence_json` but collapsed for display | Fidelity in storage, scannability in display. |
| 17 | `agent_count` is distinct agents, not phases | A re-entry isn't a "new agent". |
| 18 | NULL-mode events are filtered out of per-agent aggregations | ~6% of events are system events that have no agent. |

---

## 15. Estimated Surface Area

| Area | LOC estimate |
|---|---|
| `server/analytics/metrics.js` (new) | ~80 |
| Schema (4 tasks columns, 1 session_metrics table, 4+1 indexes) | ~20 |
| Parser denormalization (incl. session_metrics insert) | ~50 |
| `GET /api/analytics/agents` + matrix + metric-defs | ~120 |
| `GET /api/analytics/models` extension | ~20 |
| `GET /api/tasks` filter additions | ~20 |
| `GET /api/tasks/:id` payload additions | ~10 |
| `POST /api/tasks/compare` payload additions | ~10 |
| `server/routes/tasks.js evaluate` refactor to use metrics module | ~15 |
| `src/js/utils.js` (palette + helpers) | ~50 |
| Overview master filter | ~50 |
| Overview Top Models sortable by metrics | ~70 |
| Overview Top Agents card | ~40 |
| Sessions page | ~50 |
| Compare + Deep-Compare | ~50 |
| Investigate + Timeline | ~70 |
| Models (heatmap + metric sort + rename) | ~70 |
| Activity | ~40 |
| Errors | ~20 |
| Baselines + editor | ~20 |
| Test + Eval | ~30 |
| Metric tooltips (shared component) | ~25 |
| **Total** | **~960 LOC** |

No new top-level files except `server/analytics/metrics.js`. No new dependencies.
