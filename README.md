# PQ Dashboard

A local-first observability dashboard for analyzing PostQode AI agent task history. PQ Dashboard provides behavioral analytics, model ranking, prompt analytics & context reduction tracking, live network traffic inspection, error classification, tool usage statistics, and deterministic evaluation metrics — all computed locally from log traces without LLM judge calls.

---

## Features

### Core Analytics
- **Incremental Parsing** — Only new or changed tasks are processed on refresh. A lightweight SQLite caching layer ensures sub-second reloads even with thousands of sessions.
- **Config-Driven Sources** — Centralized `pq-config.yaml` manages multiple IDE sources (VS Code, VS Code Insiders, Cursor, Windsurf, etc.) with automatic cross-platform OS path resolution (macOS, Windows, Linux).
- **Interactive Timelines** — Per-task drill-down revealing step-by-step reasoning traces, API calls, tool usage sequences, and agent handoffs.
- **Advanced Visualizations** — D3.js Sankey diagrams for task execution flow, Chart.js radar charts for model efficiency, and heatmaps for model × agent cross-analysis.

### Prompt Analytics & Context Reduction Observability
A comprehensive subsystem for reconstructing and inspecting the exact prompt payloads sent to the LLM at every API turn:

- **Exact Prompt Reconstruction** — Merges base `api_conversation_history.json` with Layer 2 context overlays (`context_history.json`) and live network captures to reconstruct the exact byte payload and message structure sent at each turn.
- **Context Reduction Tracking** — Tracks four distinct types of context reductions:
  - 📁 **File Read Truncations** — Source code files capped by `read_file` to preserve context window.
  - 💻 **Command Output Truncations** — Terminal command logs capped to compact head/tail snippets.
  - 🌲 **Environment Snapshots Pruned** — Historical workspace directory snapshots purged to eliminate duplication.
  - ⚡ **Immediate Scratch Offloads** — Bulk tool logs written directly to `scratch/` files on disk at write-time, keeping only compact summaries in the prompt.
- **4-Way Flexible Layout Switcher**:
  - **🪟 Explorer (Default)** — Two-pane Master-Detail inspector: browse through 100+ context reduction events in the sidebar while viewing synchronized side-by-side before/after diffs in the main pane without endless vertical scrolling.
  - **📁 File Matrix** — Compact, sortable overview table of all files/targets sorted by highest context space saved, with clickable turn pills and inline accordion diff expansion.
  - **📜 Feed** — Streamlined chronological stream of diff cards with synchronized scrolling and redundant banner elimination.
  - **🗂️ Grouped** — Target-centric folder grouping with turn count badges.
- **Interactive Timeline Graph** — Multi-series canvas visualizing Request Size (KB), Cumulative Cost ($), Cache Reads/Writes, Latency, and Context Window Utilization (%) with section zoom and interactive call isolation.
- **Step Quick-Jump Navigation** — Mini turn selector strip (`[#1] [#2] [#3⚡] [#4📁⚡] ...`) for instant turn-by-turn inspection.
- **Dynamic Live Model Registry** — Auto-syncs live pricing, context windows (e.g. Gemini 3.7 Flash 1.0M tokens, Claude 3.7 Sonnet 200K, etc.), and provider metadata from OpenRouter API (`https://openrouter.ai/api/v1/models`) with offline cache ingestion and heuristic fallbacks.
- **Side-by-Side Task Comparison (`#/prompt-analytics?mode=compare`)** — Compare up to 5 tasks side-by-side with shared proportional Y-axis scaling, combined cost curves, per-turn step scrubbers, and locally-scoped chart tooltips.
- **Prompt Cache Hit Observability & Scratch Inspector** — Detailed breakdown of prompt caching savings (90% read discounts, cache write costs) and a dedicated scratch file log viewer.

### Agent-Aware Analytics
PQ Dashboard treats agents as first-class entities. Every session records which agent(s) handled the work (`web_agent`, `plan`, `agent`, `mobile_agent`, etc.), and the dashboard surfaces this across every view:

- **Agent Master Filter** — A chip-based filter bar on the Overview page scopes every stat, panel, and chart to specific agents. Supports multi-select.
- **Multi-Agent Sessions** — Sessions spanning multiple agents (e.g. `web_agent → plan → plan → agent`) are identified automatically. The full agent sequence is preserved, including re-entries with different models.
- **Per-Agent Breakdowns** — Top models per agent, errors per agent, activity by agent, and longest sessions per agent — answering questions like *"which model works best with web_agent?"*
- **Model × Agent Heatmap** — A cross-pivot matrix showing task counts for every model/agent combination. Click any cell to drill into those sessions.
- **Agent Timeline Band** — A color-coded band on the Timeline view shows which agent was active at every point, making handoffs visually obvious.
- **Agent Color Palette** — Stable, distinct colors per agent across every page. Known agents have hardcoded brand colors; unknown agents get hash-derived palette colors.

### Model Ranking — PQ-Score Algorithm

The dashboard computes a **PQ-Score (0–100)** for every model — a weighted composite that balances quality, cost, reliability, and usage confidence:

| Component | Weight | What It Measures |
|-----------|--------|------------------|
| **Completion Rate** | 25% | Did the model finish the job? `completed / total_sessions × 100` |
| **Error Recovery** | 20% | Can the model recover from failures? `100` if completed despite errors, `0` if failed after errors |
| **Tool Use Efficacy** | 15% | Is it using tools correctly? `100 × (tool_calls − tool_failures) / tool_calls` |
| **Cost Efficiency** | 15% | Inverse percentile rank of average cost per session (cheapest = 100) |
| **Context Efficiency** | 10% | How well does it manage the context window? `100 − avg(context_pct)` |
| **Usage Confidence** | 10% | More sessions = more trustworthy score. `min(sessions / 10, 1) × 100` |
| **Error Rate (inverse)** | 5% | Penalizes error-prone models. `100 − (errors_per_session / max) × 100` |

#### Bayesian Smoothing & Fairness
- **Bayesian Smoothing**: `smoothed = (sessions × raw_score + 5 × global_avg) / (sessions + 5)` prevents models with 1 session from skewing rankings.
- **Low Confidence Flag**: Models with fewer than 2 sessions show a `LOW CONF` badge.
- **Free-Tier Handling**: Models with `:free` suffix receive the median cost score (50) instead of infinite cost efficiency.

### Heuristic Evaluation Metrics

Four deterministic metrics computed per session directly from log traces:

| Metric | Short | Formula | Interpretation |
|--------|-------|---------|----------------|
| **Tool Use Efficacy** | TUE | `100 × (tool_calls − tool_failures) / tool_calls` | Higher = tools used more effectively. 100 when no tool calls. |
| **Reasoning Density** | RD | `100 × reasoning_events / (reasoning + API + tool events)` | Higher = agent paused to think more often before acting. |
| **Context Efficiency** | CE | `100 − avg(context_pct)` | Higher = context window used more sparingly. 100 = never filled. |
| **Error Recovery** | ERR | `100` if no errors or completed despite errors, else `0` | Completed sessions always score 100, even with many errors. |

### Session Testing & Baselines

A standalone behavioral testing workflow for managing baselines, customizing execution boundaries, tracking agent reliability, and scoring completions:

- **Editable Baselines** — Create standalone baselines from any session with expected/excluded tools, required/excluded keywords, essential step toggles, and file scope enforcement.
- **Behavioral Test Patterns** — Six deterministic patterns: Tool Invocation Assertion (TIA), Behavior Contract Validation (BCV), Multi-Step Trace Verification (MTV), Boundary/Scope Enforcement (BSE), Error Recovery Coherence (ERC), and Context Efficiency Compliance (CEC).
- **Star Ratings** — Rate task execution quality on a 1–5 scale, blending into the overall score (70% automated / 30% human judgment).

### Network Inspector

A built-in MITM proxy (`port 3457`) that captures live HTTP/HTTPS network traffic from PostQode:

- **Real-Time WebSocket Streaming** — Live request stream with AI provider tagging (PostQode, OpenAI, Anthropic, Google, Groq, etc.).
- **Chrome DevTools UI** — Record/Pause, Clear, Export HAR, filter by host/method/status, search by URL, vertical scrolling with sticky headers.
- **Zlib Payload Decompression** — Automatically decompresses `Gzip`, `Deflate`, and `Brotli` payloads on the fly.
- **Request Breakpoints & Mock Interception** — Intercept, edit, replay, or mock responses directly from the local proxy.

---

## Prerequisites

- **Node.js** v18+
- **npm** (bundled with Node)

## Installation

```bash
git clone <repo-url> && cd PQ-Dashboard
npm install
```

---

## Running the Dashboard

### macOS / Linux (1-Click)
```bash
./start.sh
```

### Windows (1-Click)
Run in Command Prompt / PowerShell or double-click:
```cmd
start.cmd
```
*(Or double-click `start.bat`)*

The Windows script automatically:
1. Checks for Node.js and npm in your `PATH`.
2. Runs `scripts/init-platform-config.js` to scan `%APPDATA%` and auto-configure `pq-config.yaml` with valid Windows IDE paths.
3. Kills any stale processes on dashboard ports.
4. Starts backend and frontend servers, then opens `http://localhost:5173` in your default browser.

### Manual Startup (Two Terminals)
```bash
# Terminal 1: Backend (port 3456)
npm start

# Terminal 2: Frontend dev server (port 5173)
npm run dev
```

---

## HTTPS / SSL Proxy Certificate Trust

VS Code extensions run in separate processes and require trusting the proxy CA certificate for HTTPS interception:

- **macOS (Terminal)**:
  ```bash
  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "data/proxy-certs/certs/ca.pem"
  ```
- **Windows (Admin PowerShell)**:
  ```powershell
  Import-Certificate -FilePath "data\proxy-certs\certs\ca.pem" -CertStoreLocation Cert:\LocalMachine\Root
  ```

---

## Architecture

```
PQ-Dashboard/
├── server/                     # Express.js backend
│   ├── index.js                # Entry point
│   ├── config.js               # pq-config.yaml loader & path resolver
│   ├── classifier.js           # Deterministic activity classification
│   ├── model-registry.js       # Live OpenRouter model sync, cache scanning & inference
│   ├── analytics/
│   │   └── metrics.js          # Single source of truth: TUE/RD/CE/ERR definitions + PQ-Score
│   ├── baselines/              # Baseline extraction (prompts, tools, contracts)
│   ├── cache/
│   │   └── db.js               # SQLite schema, migrations, parser denormalization
│   ├── parser/                 # Incremental task parser (ui_messages.json → events)
│   ├── proxy/
│   │   ├── index.js            # MITM proxy server (HTTP/HTTPS interception on 3457)
│   │   ├── store.js            # In-memory circular buffer for captured requests
│   │   └── ws.js               # WebSocket server for real-time streaming
│   ├── routes/
│   │   ├── analytics.js        # /api/analytics/* (overview, models, agents, errors, etc.)
│   │   ├── baselines.js        # /api/baselines/*
│   │   ├── network.js          # /api/network/* (proxy status, captured requests, export)
│   │   ├── prompt-analytics.js # /api/prompt-analytics/* (turn diffs, reductions, metrics)
│   │   └── tasks.js            # /api/tasks/* (list, detail, evaluate, test)
│   └── testing/                # Behavioral test runner (TIA/BCV/MTV/BSE/ERC/CEC)
├── scripts/
│   └── init-platform-config.js # Auto-scans OS IDE task paths for pq-config.yaml
├── src/                        # Vite frontend
│   ├── index.html
│   ├── css/                    # PostQode-matched dark theme
│   ├── js/
│   │   ├── app.js              # Router, auto-refresh lifecycle
│   │   ├── api.js              # API client
│   │   ├── utils.js            # Agent colors, formatting, chip rendering
│   │   ├── components/         # Reusable chart & UI components
│   │   └── views/              # Page views (prompt-analytics, overview, models, etc.)
│   └── img/
├── data/                       # SQLite database (WAL mode) & proxy certs
├── pq-config.yaml              # IDE source configuration (macOS/Windows/Linux)
├── start.sh                    # macOS / Linux 1-click startup script
├── start.cmd                   # Windows 1-click startup script
├── start.bat                   # Windows batch alias
└── vite.config.js              # Vite config with API proxy
```

---

## API Reference

### Analytics & Tasks

| Endpoint | Description |
|----------|-------------|
| `GET /api/analytics/overview` | Aggregate stats (sessions, cost, tokens, errors, completion). Supports `?agent=` filter. |
| `GET /api/analytics/models` | Per-model breakdown with PQ-Score, heuristic metrics, and `low_confidence` flag. |
| `GET /api/analytics/agents` | Per-agent breakdown with sub-breakdowns (top models, activity mix, longest sessions). |
| `GET /api/analytics/agent-matrix` | Sparse pivot: agents × models/activities/statuses. |
| `GET /api/analytics/errors` | Error breakdown by category, model, and time. |
| `GET /api/tasks` | Session list with filtering (`?agent=`, `?multi_agent=1`, `?model_id=`, `?status=`). |
| `GET /api/tasks/:id` | Session detail with events trace. |

### Prompt Analytics

| Endpoint | Description |
|----------|-------------|
| `GET /api/prompt-analytics/:taskId` | Full prompt analytics: reconstructed turns, context reductions, scratch logs, financial breakdown. |
| `GET /api/prompt-analytics/compare` | Multi-task comparative analytics data (`?tasks=id1,id2`). |
| `GET /api/prompt-analytics/models` | Model pricing registry cache and context window lookup. |
| `POST /api/prompt-analytics/label/:taskId` | Update custom user label for a task. |

### Baselines & Network Inspector

| Endpoint | Description |
|----------|-------------|
| `GET/POST /api/baselines` | List and create behavioral baselines. |
| `GET /api/network/status` | Proxy status (running/stopped, port, buffer count, connected clients). |
| `GET /api/network/requests` | Paginated captured HTTP/HTTPS requests with provider tags and payload diffs. |
| `POST /api/network/replay/:id` | Replay a captured request. |
| `GET /api/network/export` | Export all buffered requests as HAR file. |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| **No data visible** | Check `pq-config.yaml` — ensure source paths are correct and `enabled: true`. On Windows, run `scripts/init-platform-config.js` to auto-detect paths. |
| **Port in use error (EADDRINUSE)** | Ports 3456 or 5173 are occupied. Run `./start.sh` (macOS) or `start.cmd` (Windows) which automatically terminates stale port listeners. |
| **Model Context Window Unknown** | The Model Registry automatically fetches live context windows from OpenRouter on startup. Ensure internet connectivity on launch or check local cache. |
| **HTTPS requests fail through proxy** | Add the CA cert from `data/proxy-certs/certs/ca.pem` to your system keychain (macOS) or Windows Certificate Store (`Import-Certificate`). |
| **Stale data after schema change** | Delete `data/dashboard.db` and trigger a refresh to perform a clean initial parse. |

