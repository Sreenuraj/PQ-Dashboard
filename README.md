# PQ Dashboard

A robust, incremental, and config-driven observability dashboard for analyzing your PostQode AI agent task history. This dashboard provides insightful behavioral analytics, timeline views, error classification, model economics, and tool usage statistics entirely locally.

## Features
- **Incremental Parsing:** Only new or changed tasks are processed when you click "Refresh Data", leveraging a lightweight, high-performance SQLite caching layer.
- **Config-Driven Source Paths:** Centralized configuration via `pq-config.yaml` lets you manage multiple IDE sources (VS Code, VS Code Insiders, Cursor, etc.).
- **Behavioral & Reasoning Analytics:** Track AI task completions vs interruptions, deep error classification (API failures, tool errors), and quantify the exact metric impact of 🧠 reasoning traces on success and cost metrics.
- **Interactive Timelines & Sequences:** Drill down into a per-task view revealing step-by-step reasoning traces, API calls, and tool usage sequences.
- **Advanced Visualizations:** Includes a D3.js powered *Activity Flow* Sankey diagram tracing task execution, and Chart.js powered *Model Efficiency Matrices* and *Error Cascades*.
- **Activity Intelligence Page:** A terminal-style analytics view that groups sessions into deterministic activity categories such as testing, coding, debugging, and exploration. It surfaces cost by activity, one-shot edit success rate, retry cycles, shell-command frequency, and daily activity trends directly from stored task/event traces.
- **Agentic Evaluation (Eval):** Deterministic, heuristic-backed evaluation metrics derived inspired by frameworks like DeepEval and Raga.ai Catalyst. Automatically calculate *Tool Utilization Efficacy (TUE)*, *Error Recovery Rate (ERR)*, *Reasoning Density (RD)*, and *Context Efficiency (CE)* natively from log traces without expensive secondary LLM judge calls.
- **Baseline Sessions & Behavioral Testing:** Mark a completed session as a baseline reference, extract its prompt chain, expected tools, tool sequence, behavior contract, and operational metrics, then test other sessions against that known-good execution.
- **Task Investigation View:** A powerful deep-dive observability trace viewer. Intelligently displays full tool invocations, logic breakdowns, and payloads. Features an integrated live search across all task events (prompts, responses, errors, tools).
- **Task Comparison Dashboard:** Choose multiple tasks from your Session index and run side-by-side comparisons of execution variables, cost/duration bars, automated agentic scorecard metrics, behavioral test results, and tool sequences.
- **PostQode Native Aesthetic:** Carefully matched styling to the modern PostQode dark theme for visual seamlessness.

## Prerequisites
- **Node.js** (v18+ recommended)
- **npm** (comes with Node)

## Installation
1. Clone this repository or navigate to this folder.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Check and adjust paths within `pq-config.yaml` to ensure your target IDEs are enabled.

## Running the Dashboard
With simple wrapper scripts, you can control the Node.js backend and Vite frontend effortlessly:

```bash
# Start backend, frontend, and open dashboard in your default browser
./start.sh
```

Alternatively, you can run them manually in two terminals:
- Terminal 1: `npm start` (Runs the backend on port 3456 & initial task parse)
- Terminal 2: `npm run dev` (Runs the Vite frontend on port 5173)

## Session Testing & Baselines (Phase 2)

PQ Dashboard features a powerful standalone behavioral testing workflow that allows you to manage baselines, customize execution boundaries, track agent reliability, and score completions:

1. **Standalone Editable Baselines:** Instead of simple static session snapshots, you can create standalone editable baselines from any session (regardless of completion status).
2. **Baseline Editor (`#/baseline-editor`):** A dual-list curator interface to manage expected and excluded tools, required and excluded contract keywords, descriptions, tags, and toggle essential steps.
3. **Enrichment & Merging (`#/baseline-enrich`):** Contrast any session trace against a baseline to discover new tools/keywords, and selectively merge them back into the baseline while maintaining a list of contributing sessions.
4. **Contextual Tool Sequences & Essential Steps:** Tool calls carry auto-derived descriptions (identifying file contexts). Instead of strict ordering, the MTV pattern validates coverage of **Essential Steps** and checks for baseline excluded tools/keywords.
5. **Session Health & Interruption Tracking:** Automatically tracks user interruptions (`resume_task` events) and context resets, applying automated tiered behavioral penalties (-5%, -15%, -25%).
6. **Failed Tool Extraction:** Intelligently extracts tool execution failures (such as MCP timeouts, missing parameters, execution errors) from log traces, surfacing warnings and impacting error recovery scores.
7. **Completion Message & Star Ratings:** Completion message text is parsed and rendered in formatted Markdown. You can rate task execution quality directly on the test page with a 1-5 Star Rating scale.
8. **Overall Performance Index:** Evaluates task success using a weighted index ($60\%$ Behavioral score, $40\%$ Operational efficiency based on cost, duration, tool calls, and error counts relative to baseline references).

### What a baseline captures

When a task is marked as a baseline, the dashboard stores a benchmark set in SQLite:
- **Prompt chain:** User prompts in order, plus tools used after each prompt.
- **Expected & Excluded tools:** Direct list of tools the agent should or should not use.
- **Essential Steps sequence:** Ordered tool calls with file paths, custom descriptions, and essential toggles.
- **Behavior contract:** Output structure, length bounds, code-block presence, required keywords, and excluded keywords.
- **Reference metrics:** Cost, tokens, duration, API calls, tool calls, errors, and context reset status.

### Behavioral test patterns

The test runner evaluates six deterministic patterns natively from log traces without expensive secondary LLM judge calls:
- **Tool Invocation Assertion (TIA):** Checks if expected tools were called, and fails if excluded tools were used (applying a 20% score penalty per infraction).
- **Behavior Contract Validation (BCV):** Checks if required keywords are present and verifies that excluded keywords are absent from the final response.
- **Multi-Step Trace Verification (MTV):** Validates coverage of configured baseline **Essential Steps**, and checks tool usage efficiency against reference benchmarks.
- **Boundary/Scope Enforcement (BSE):** Monitors command safety (detecting destructive commands like `rm -rf /` or `drop table`), limits max tool footprint, and extracts failed tool execution attempts.
- **Error Recovery Coherence (ERC):** Analyzes agent adaptation after errors, penalizing failed tool attempts and blind retry loops.
- **Context Efficiency Compliance (CEC):** Monitors context usage relative to token limits.

### Dynamic Baseline Switching & Deep Compare
- `#/baselines` — Manage baselines list, edit tags, copy prompt chains, and access editor/enrichment views.
- `#/baseline-editor?id=<id>` — Edit baseline tools, keywords, tags, metadata, and essential steps.
- `#/baseline-enrich?id=<id>` — Compare a session trace against a baseline and merge diffs.
- `#/test?task=<id>` — Run behavioral tests for a task (automatically resolves the baseline reference if previously tested).
- `#/deepcompare?tasks=<id1>,<id2>&baseline=<baseline_id>` — Compare tasks side-by-side. Features an **Overall Performance Index** breakdown, a Markdown completion synopsis details modal, and an on-the-fly **Baseline Switcher** dropdown that re-calculates all scores dynamically.

## Architecture
- **Backend (`server/`):** Express.js + `better-sqlite3`. Contains the config loader, filesystem scanner, event extraction logic (`ui_messages.json` parsing), task cache deduplication, and REST API routes (including advanced on-the-fly sequence mapping and Sankey node generators).
- **Activity Classification (`server/classifier.js`):** Deterministic heuristics classify each task from tool usage, shell commands, and prompt keywords. The resulting category and retry metrics are stored in SQLite and power the Activity Intelligence page without any secondary LLM calls.
- **Baseline Extraction (`server/baselines/`):** Extracts prompt chains, tool sets, ordered tool sequences, behavior contracts, and reference metrics from completed task traces.
- **Behavioral Testing (`server/testing/`):** Runs six deterministic test patterns against stored task events, using baseline data when provided and `test-rules.yaml` only as a no-baseline fallback.
- **Frontend (`src/`):** A lightweight `Vite` setup using Vanilla HTML/JS/CSS. Dynamic routing logic and encapsulated API clients present the curated data visually alongside high-performance charts rendered via `d3-sankey` AND `chart.js`.
- **Cache (`data/`):** Local SQLite WAL-mode cache mapping historical task events dynamically.

## Troubleshooting
- **No data visible?** Make sure the paths under `sources:` in `pq-config.yaml` are correctly matching your filesystem structure and have `enabled: true`.
- **EADDRINUSE errors?** This means the ports 3456 or 5173 are blocked. Use `pkill -f "node server/index.js"` and `pkill -f "vite"` to free them.
