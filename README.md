# PQ Dashboard

A local-first observability dashboard for analyzing PostQode AI agent task history. PQ Dashboard provides behavioral analytics, model ranking, agent-aware filtering, error classification, tool usage statistics, and deterministic evaluation metrics — all computed from log traces without LLM judge calls.

---

## Features

### Core Analytics
- **Incremental Parsing** — Only new or changed tasks are processed on refresh. A lightweight SQLite caching layer ensures sub-second reloads even with thousands of sessions.
- **Config-Driven Sources** — Centralized `pq-config.yaml` manages multiple IDE sources (VS Code, VS Code Insiders, Cursor, etc.) with per-source enable/disable.
- **Interactive Timelines** — Per-task drill-down revealing step-by-step reasoning traces, API calls, tool usage sequences, and agent handoffs.
- **Advanced Visualizations** — D3.js Sankey diagram for task execution flow, Chart.js radar charts for model efficiency, and heatmaps for model × agent cross-analysis.

### Agent-Aware Analytics
PQ Dashboard treats agents as first-class entities. Every session records which agent(s) handled the work (`web_agent`, `plan`, `agent`, `mobile_agent`, etc.), and the dashboard surfaces this across every view:

- **Agent Master Filter** — A chip-based filter bar on the Overview page scopes every stat, panel, and chart to specific agents. Supports multi-select.
- **Multi-Agent Sessions** — Sessions spanning multiple agents (e.g. `web_agent → plan → plan → agent`) are identified automatically. The full agent sequence is preserved, including re-entries with different models.
- **Per-Agent Breakdowns** — Top models per agent, errors per agent, activity by agent, and longest sessions per agent — answering questions like *"which model works best with web_agent?"*
- **Model × Agent Heatmap** — A cross-pivot matrix showing task counts for every model/agent combination. Click any cell to drill into those sessions.
- **Agent Timeline Band** — A color-coded band on the Timeline view shows which agent was active at every point, making handoffs visually obvious.
- **Agent Color Palette** — Stable, distinct colors per agent across every page. Known agents have hardcoded brand colors; unknown agents get hash-derived palette colors.

### Model Ranking — PQ-Score Algorithm

The dashboard computes a **PQ-Score (0–100)** for every model — a weighted composite that balances quality, cost, reliability, and usage confidence. This replaces naive session-count ordering to surface truly top-performing models.

#### How PQ-Score Works

| Component | Weight | What It Measures |
|-----------|--------|------------------|
| **Completion Rate** | 25% | Did the model finish the job? `completed / total_sessions × 100` |
| **Error Recovery** | 20% | Can the model recover from failures? `100` if completed despite errors, `0` if failed after errors |
| **Tool Use Efficacy** | 15% | Is it using tools correctly? `100 × (tool_calls − tool_failures) / tool_calls` |
| **Cost Efficiency** | 15% | Inverse percentile rank of average cost per session (cheapest = 100) |
| **Context Efficiency** | 10% | How well does it manage the context window? `100 − avg(context_pct)` |
| **Usage Confidence** | 10% | More sessions = more trustworthy score. `min(sessions / 10, 1) × 100` |
| **Error Rate (inverse)** | 5% | Penalizes error-prone models. `100 − (errors_per_session / max) × 100` |

#### Bayesian Smoothing

To prevent a model with 1 perfect session from outranking a model with 30 good sessions, PQ-Score applies **Bayesian smoothing**:

```
smoothed = (sessions × raw_score + 5 × global_avg) / (sessions + 5)
```

A model with 1 session at 100% completion gets pulled toward the global average, while a model with 30 sessions at 80% stays close to 80%. The `5` acts as a "virtual sample" of average-quality data.

#### Fairness Safeguards

- **Low Confidence Flag** — Models with fewer than 2 sessions show a `LOW CONF` badge. They're ranked but visually distinguished so you know the score is provisional.
- **Free-Tier Handling** — Models with `:free` suffix receive the median cost score (50) instead of infinite cost efficiency, preventing distortion.
- **Score Breakdown Tooltip** — Hover over any PQ-Score to see the exact contribution of each component.

#### Example Ranking

With real data, a model like `grok-4.1-fast` (PQ=80) can outrank `claude-sonnet-4.5` (PQ=75) despite having fewer total sessions — because its much lower cost ($0.05/session vs $1.14/session), decent completion rate, and high usage confidence produce a better composite score.

### Heuristic Evaluation Metrics

Four deterministic metrics are computed per session from log traces — no LLM judge calls required. These are defined once in `server/analytics/metrics.js` and used consistently across all views.

| Metric | Short | Formula | Interpretation |
|--------|-------|---------|----------------|
| **Tool Use Efficacy** | TUE | `100 × (tool_calls − tool_failures) / tool_calls` | Higher = tools used more effectively. 100 when no tool calls. |
| **Reasoning Density** | RD | `100 × reasoning_events / (reasoning + API + tool events)` | Higher = agent paused to think more often before acting. |
| **Context Efficiency** | CE | `100 − avg(context_pct)` | Higher = context window used more sparingly. 100 = never filled. |
| **Error Recovery** | ERR | `100` if no errors or completed despite errors, else `0` | Completed sessions always score 100, even with many errors. |

These metrics power the PQ-Score algorithm, the radar chart on the Models page, sortable columns on Overview and Models, and per-session evaluation reports.

### Activity Intelligence
- **Activity Classification** — Deterministic heuristics classify sessions into categories (coding, debugging, testing, exploration, planning, etc.) from tool usage, shell commands, and prompt keywords.
- **One-Shot Rate** — Percentage of edit turns that succeeded on the first try, surfaced per activity category.
- **Retry Cycles & Shell Commands** — Track how often the agent retried operations and which shell commands were executed most frequently.
- **Daily Activity Trends** — Cost and session counts broken down by activity category over time.

### Session Testing & Baselines

A standalone behavioral testing workflow for managing baselines, customizing execution boundaries, tracking agent reliability, and scoring completions:

- **Editable Baselines** — Create standalone baselines from any session. The Baseline Editor provides a dual-list curator for expected/excluded tools, required/excluded keywords, essential step toggles, and file scope enforcement.
- **Essential vs Optional** — Each expected tool and contract keyword can be marked **Essential** (must be present — missing causes a score penalty) or **Optional** (noted but no penalty). Essential items show a ★ badge.
- **Excluded Files** — Define glob patterns (`**/.env`, `*.key`, `src/internal/**`) for files the agent should not access. Violations incur scope penalties.
- **Enrichment & Merging** — Compare any session trace against a baseline to discover new tools/keywords, then selectively merge them back.
- **Session Health Tracking** — Automatically tracks user interruptions and context resets, applying tiered behavioral penalties.
- **Star Ratings** — Rate task execution quality on a 1–5 scale. The rating blends into the overall score (70% automated / 30% human judgment).

#### Behavioral Test Patterns

Six deterministic patterns evaluated natively from log traces:

| Pattern | What It Checks |
|---------|---------------|
| **Tool Invocation Assertion (TIA)** | Essential tools called, excluded tools avoided, unexpected tools flagged |
| **Behavior Contract Validation (BCV)** | Essential keywords present, code blocks exist, length bounds met, forbidden keywords absent |
| **Multi-Step Trace Verification (MTV)** | Coverage of essential steps, tool usage efficiency vs baseline |
| **Boundary/Scope Enforcement (BSE)** | Command safety (no `rm -rf /`), max tool footprint, excluded file access violations |
| **Error Recovery Coherence (ERC)** | Agent adaptation after errors, blind retry loop detection |
| **Context Efficiency Compliance (CEC)** | Context usage relative to token limits |

#### Key Views

| Route | Purpose |
|-------|---------|
| `#/baselines` | Manage baselines, edit tags, copy prompt chains |
| `#/baseline-editor?id=<id>` | Edit tools, keywords, essential steps, excluded files |
| `#/baseline-enrich?id=<id>` | Compare a session against a baseline, merge diffs |
| `#/test?task=<id>` | Run behavioral tests for a task |
| `#/deepcompare?tasks=<id1>,<id2>` | Side-by-side comparison with ranked performance index |

### Task Investigation & Comparison
- **Investigation View** — Full observability trace viewer with tool invocations, logic breakdowns, payloads, and live search across all events. Color-coded by active agent.
- **Task Comparison** — Side-by-side comparison of cost/duration, automated scorecard metrics, behavioral test results, and tool sequences.
- **Deep Compare** — Multi-task comparison with baseline switching, interactive detail modals, and ranked performance bars.

---

## Prerequisites

- **Node.js** v18+
- **npm** (bundled with Node)

## Installation

```bash
git clone <repo-url> && cd PQ-Dashboard
npm install
```

Check and adjust IDE source paths in `pq-config.yaml` to point to your PostQode task directories.

## Running the Dashboard

```bash
# Start backend + frontend + open browser
./start.sh
```

Or run manually in two terminals:

```bash
# Terminal 1: Backend (port 3456) + initial parse
npm start

# Terminal 2: Frontend dev server (port 5173)
npm run dev
```

---

## Architecture

```
PQ-Dashboard/
├── server/                     # Express.js backend
│   ├── index.js                # Entry point
│   ├── config.js               # pq-config.yaml loader
│   ├── classifier.js           # Deterministic activity classification
│   ├── model-registry.js       # OpenRouter/Vercel model metadata cache
│   ├── analytics/
│   │   └── metrics.js          # Single source of truth: TUE/RD/CE/ERR definitions + PQ-Score
│   ├── baselines/              # Baseline extraction (prompts, tools, contracts)
│   ├── cache/
│   │   └── db.js               # SQLite schema, migrations, parser denormalization
│   ├── parser/                 # Incremental task parser (ui_messages.json → events)
│   ├── routes/
│   │   ├── analytics.js        # /api/analytics/* (overview, models, agents, errors, etc.)
│   │   ├── baselines.js        # /api/baselines/*
│   │   └── tasks.js            # /api/tasks/* (list, detail, evaluate, test)
│   └── testing/                # Behavioral test runner (TIA/BCV/MTV/BSE/ERC/CEC)
├── src/                        # Vite frontend
│   ├── index.html
│   ├── css/                    # PostQode-matched dark theme
│   ├── js/
│   │   ├── app.js              # Router, view lifecycle
│   │   ├── api.js              # API client
│   │   ├── utils.js            # Agent colors, formatting, chip rendering
│   │   ├── components/
│   │   │   ├── charts.js       # Chart.js (radar, bar, line, doughnut)
│   │   │   ├── date-picker.js  # Date range picker
│   │   │   └── metric-tooltip.js # Metric definition tooltips
│   │   └── views/              # One file per page (overview, models, sessions, etc.)
│   └── img/
├── data/                       # SQLite database (WAL mode)
├── docs/                       # Design documents
├── pq-config.yaml              # IDE source configuration
├── test-rules.yaml             # Fallback behavioral test rules
└── vite.config.js              # Vite config with API proxy
```

### Key Design Decisions

- **All metrics are deterministic.** No LLM judge calls — everything is computed from log trace data (tool calls, errors, reasoning events, context usage).
- **Agent = display name for `mode`.** The DB stores `mode` as the column name; the UI displays it as "Agent" everywhere. The mapping is centralized in `utils.js`.
- **Pre-computed session metrics.** The `session_metrics` table caches TUE/RD/CE/ERR per session at parse time, making per-model aggregations a cheap `GROUP BY` instead of per-request recomputation.
- **PQ-Score is server-side.** The composite ranking is computed in `analytics.js` so the Overview and Models pages always agree on ordering.

---

## Data Model

### Core Tables

| Table | Purpose |
|-------|---------|
| `tasks` | One row per session. Stores cost, tokens, errors, status, activity category, agent metadata (`primary_agent`, `agent_count`, `is_multi_agent`, `agent_sequence_json`). |
| `events` | One row per parsed event (API call, tool use, error, reasoning). Stores `mode` (agent), `model_id`, cost, tokens, error classification. |
| `task_models` | Junction table: one row per (task, model, agent) combination. Powers the model analytics queries. |
| `session_metrics` | Cached per-session heuristic scores (TUE, RD, CE, ERR). Populated by the parser. |

### Supporting Tables

| Table | Purpose |
|-------|---------|
| `baselines` | Editable behavioral baselines with prompt chains, tool sets, contracts, and excluded files. |
| `test_results` | Behavioral test scores per task (TIA, BCV, MTV, BSE, ERC, CEC). |
| `task_shell_commands` | Shell command frequency per task. |
| `parse_meta` | File hash tracking for incremental parsing. |

---

## API Reference

### Analytics

| Endpoint | Description |
|----------|-------------|
| `GET /api/analytics/overview` | Aggregate stats (sessions, cost, tokens, errors, completion). Supports `?agent=` filter. |
| `GET /api/analytics/models` | Per-model breakdown with PQ-Score, heuristic metrics, and `low_confidence` flag. Supports `?agent=` filter. |
| `GET /api/analytics/agents` | Per-agent breakdown with sub-breakdowns (top models, activity mix, longest sessions). |
| `GET /api/analytics/agent-matrix` | Sparse pivot: agents × models/activities/statuses. `?dimension=model\|activity\|status` |
| `GET /api/analytics/errors` | Error breakdown by category, model, and time. |
| `GET /api/analytics/tools` | Top tools and shell commands. Supports `?agent=` filter. |
| `GET /api/analytics/activity` | Activity category breakdown with one-shot rates. Supports `?agent=` filter. |
| `GET /api/analytics/reasoning` | With-reasoning vs without-reasoning comparison. |
| `GET /api/analytics/metric-defs` | TUE/RD/CE/ERR definitions for UI tooltips (single source of truth). |

### Tasks

| Endpoint | Description |
|----------|-------------|
| `GET /api/tasks` | Session list with filtering (`?agent=`, `?multi_agent=1`, `?model_id=`, `?status=`, etc.) |
| `GET /api/tasks/:id` | Session detail with events. |
| `GET /api/tasks/:id/evaluate` | Per-session heuristic evaluation (TUE, RD, CE, ERR). |
| `GET /api/tasks/:id/test` | Run behavioral tests against baseline. |

### Baselines

| Endpoint | Description |
|----------|-------------|
| `GET/POST /api/baselines` | List and create baselines. |
| `GET/PUT/DELETE /api/baselines/:id` | CRUD operations on baselines. |
| `POST /api/baselines/:id/enrich` | Enrich baseline from another session's trace. |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| No data visible | Check `pq-config.yaml` — ensure source paths are correct and `enabled: true`. |
| EADDRINUSE error | Ports 3456/5173 are in use. Run `pkill -f "node server/index.js"` and `pkill -f "vite"`. |
| Stale data after schema change | Delete `data/dashboard.db` and restart the server to trigger a fresh parse. |
| Agent data missing | Agent metadata is computed at parse time. If sessions were parsed before agent support was added, delete the DB and re-parse. |
