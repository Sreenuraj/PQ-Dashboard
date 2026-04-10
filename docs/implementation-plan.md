# PQ Dashboard — Implementation Plan

> **Version:** 1.0  
> **Created:** 2026-04-10  
> **Status:** In Progress  
> **Approach:** Incremental — build, test, iterate per phase  

---

## Architecture

### Backend: Node.js (Express) + SQLite

```
pq-config.yaml → Task Scanner → Parser Modules → SQLite Cache → REST API → Vite Frontend
```

- **Config-driven**: YAML file specifies IDE paths, date filters, volume limits
- **Multi-IDE**: Supports any number of VS Code-based IDEs
- **Incremental**: After first parse, only processes new/modified tasks
- **Memory-safe**: Stream parsing for large files, configurable max file size

### Frontend: Vite + Vanilla JS + Chart.js + D3.js

- Dark mode with glassmorphism
- Sidebar navigation between views
- Inter font (Google Fonts)

---

## Phases

### Phase 1: Foundation ✅
> Goal: Config + parser + backend + empty shell. Prove the data pipeline works.

- [x] Initialize project (package.json, Vite config, Express setup)
- [x] Create `pq-config.yaml` with user's two IDE paths
- [x] Build config loader (YAML parsing, `~` path resolution)
- [x] Build task scanner (walk dirs, apply date/size filters, sort)
- [x] Build `ui_messages.json` parser (extract all event types)
- [x] Build `task_metadata.json` parser
- [x] Build `focus_chain` parser (markdown checkbox → %)
- [x] Build error classifier
- [x] Set up SQLite schema + write parsed data
- [x] Build incremental processing (file hash tracking)
- [x] Build REST API routes (tasks list, task detail, analytics)
- [x] Build frontend shell (dark theme, sidebar, router)
- [x] **RESULT**: 56 tasks parsed, 0 errors, incremental cache working

### Phase 2: Session Explorer + Timeline ✅
> Goal: First usable views. Browse tasks and see event timelines.

- [x] Session Explorer view (paginated task list with filters)
- [x] Task Timeline Explorer (interactive per-task event timeline)
- [x] Event detail side panel (click node → see full content)
- [x] **TEST**: Navigate tasks, verify timeline accuracy

### Phase 3: Error & Tool Analytics ✅
> Goal: Behavioral analysis dashboards.

- [x] Error & Failure Analytics view (error types, rates, cascades)
- [x] Tool Usage Analytics view (frequency, sequences, success rates)
- [x] **TEST**: Verify error detection, tool extraction accuracy

### Phase 4: Model & Cost Analytics ✅
> Goal: Model comparison and cost tracking.

- [x] Model Comparison Matrix (dynamic multi-model table + radar)
- [x] Cost & Token Economics (spend tracking, cache efficiency)
- [x] **TEST**: Verify cost totals match raw data

### Phase 5: Advanced Views ✅
> Goal: Reasoning analysis and flow visualization.

- [x] Reasoning Quality Analyzer (scoring, correlation)
- [x] Activity → Consequence Flow (Sankey diagram)
- [x] **TEST**: Verify reasoning extraction, flow categorization

---

## Config File Reference

```yaml
sources:
  - name: "VS Code Insiders"
    path: "~/Library/Application Support/Code - Insiders/User/globalStorage/postqode.postqode/tasks"
    enabled: true
  - name: "VS Code"
    path: "~/Library/Application Support/Code/User/globalStorage/postqode.postqode/tasks"
    enabled: true

processing:
  from_date: null        # ISO date string or null
  to_date: null          # ISO date string or null
  max_tasks: null         # Number or null (unlimited)
  min_task_size: 100      # Bytes
  skip_empty_tasks: true
  max_file_size: 10485760 # 10MB

cache:
  db_path: "./data/dashboard.db"
  incremental: true

server:
  port: 3456
  host: "localhost"
```

---

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/tasks` | Paginated task list with filters |
| GET | `/api/tasks/:id` | Full task detail with events |
| GET | `/api/tasks/:id/events` | Filtered events for timeline |
| GET | `/api/analytics/overview` | Summary stats |
| GET | `/api/analytics/models` | Per-model stats |
| GET | `/api/analytics/errors` | Error breakdown |
| GET | `/api/analytics/tools` | Tool usage stats |
| GET | `/api/analytics/costs` | Cost trends |
| POST | `/api/refresh` | Re-scan and parse new tasks |
| GET | `/api/config` | Current config |
| PUT | `/api/config` | Update config |

---

## SQLite Schema

```sql
-- Core tables
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  source TEXT,
  start_ts INTEGER,
  end_ts INTEGER,
  duration INTEGER,
  total_cost REAL,
  total_tokens_in INTEGER,
  total_tokens_out INTEGER,
  total_cache_reads INTEGER,
  total_cache_writes INTEGER,
  error_count INTEGER,
  tool_call_count INTEGER,
  api_call_count INTEGER,
  status TEXT,             -- completed, interrupted, abandoned, error
  has_reasoning INTEGER,
  has_context_reset INTEGER,
  first_message TEXT,      -- task description (first user message)
  focus_chain_completion REAL,
  environment_json TEXT    -- JSON: os, vscode version, pq version
);

CREATE TABLE task_models (
  task_id TEXT,
  model_id TEXT,
  provider_id TEXT,
  mode TEXT,
  ts INTEGER,
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT,
  ts INTEGER,
  type TEXT,               -- say, ask
  sub_type TEXT,           -- text, reasoning, tool, error, api_req_started, etc.
  tool_name TEXT,
  command_text TEXT,
  error_message TEXT,
  error_category TEXT,     -- tool_error, api_failure, compliance_error, etc.
  cost REAL,
  tokens_in INTEGER,
  tokens_out INTEGER,
  cache_reads INTEGER,
  cache_writes INTEGER,
  model_id TEXT,
  provider_id TEXT,
  mode TEXT,
  reasoning_text TEXT,
  reasoning_score REAL,
  content_preview TEXT,    -- First 200 chars of text (for search)
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE TABLE parse_meta (
  task_id TEXT PRIMARY KEY,
  source TEXT,
  last_modified INTEGER,
  file_hash TEXT,
  parsed_at INTEGER
);

-- Indexes for fast queries
CREATE INDEX idx_events_task ON events(task_id);
CREATE INDEX idx_events_type ON events(sub_type);
CREATE INDEX idx_events_error ON events(error_category);
CREATE INDEX idx_tasks_start ON tasks(start_ts);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_task_models_model ON task_models(model_id);
```

---

## Error Classification Rules

| Pattern | Category | Severity |
|---------|----------|----------|
| `"say":"error"` event | `tool_error` | medium |
| `cost=0` + `tokensIn=0` in api_req_started | `api_failure` | high |
| `[ERROR]` in message text | `compliance_error` | low |
| `[TASK RESUMPTION]` in request text | `interruption` | medium |
| Consecutive `ask.resume_task` events | `unresponsive` | high |
| `modelInfo` change between events | `model_switch` | info |
| `context_history.json` exists | `context_overflow` | info |
| Time gap >60s after api_req_started | `possible_timeout` | medium |

---

## Progress Log

| Date | Phase | Notes |
|------|-------|-------|
| 2026-04-10 | Planning | Requirements + implementation plan created |
| 2026-04-10 | Phase 1 ✅ | 56 tasks parsed (0 errors), SQLite cache, incremental working |
| 2026-04-10 | Phase 2 ✅ | Session Explorer, Timeline, Errors, Models, Costs, Tools views built |
| 2026-04-10 | Bug Fix | Fixed Express IPv4 binding + Vite proxy config for dev server |
| 2026-04-10 | Bug Fix | Fixed issue where date-range wrapper was destroyed on view re-render |
| 2026-04-10 | Phase 3-5 ✅ | Added Chart.js, D3.js, Radar Chart, Sankey Diagram, Error Cascade and Reasoning Analyzer |
