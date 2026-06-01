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

## Session Testing & Baselines

PQ Dashboard now supports a baseline-first behavioral testing workflow:

1. Open **Sessions** and select one completed task.
2. Click **Set as Baseline** to create a reference execution.
3. Review extracted prompts, tools, sequence, and contract data in **Baselines**.
4. Run **Test Session** against another task, optionally selecting the baseline.
5. Use **Deep Compare** to compare operational metrics and behavioral scores across tasks.

### What a baseline captures

When a task is marked as a baseline, the dashboard stores a benchmark set in SQLite:

- Prompt chain: user prompts in order, plus tools used after each prompt.
- Expected tools: distinct tools used by the baseline task.
- Tool sequence: ordered tool calls with extracted file paths or commands when available.
- Behavior contract: output structure, length bounds, code-block presence, and keywords derived from the baseline response.
- Operational metrics: cost, tokens, duration, API calls, tool calls, errors, and context reset status.

With a baseline selected, behavioral tests compare against this extracted benchmark data. Without a baseline, tests use deterministic fallback rules from `test-rules.yaml`.

### Behavioral test patterns

The test runner is deterministic and does not call another LLM. It currently evaluates:

- **Tool Invocation Assertion:** Did the task use the expected tools?
- **Behavior Contract Validation:** Did the final output match structural expectations?
- **Multi-Step Trace Verification:** Did tool calls follow a sensible order?
- **Boundary/Scope Enforcement:** Were tools and commands within the known safe scope?
- **Error Recovery Coherence:** Did the agent adapt after errors?
- **Context Efficiency Compliance:** Did context usage stay reasonable?

### New dashboard views

- `#/baselines` — Manage baseline sessions, copy prompt chains, and inspect benchmark summaries.
- `#/test?task=<id>` — Run behavioral tests for one task.
- `#/test?task=<id>&baseline=<baseline_id>` — Run behavioral tests against a baseline.
- `#/deepcompare?tasks=<id1>,<id2>` — Compare multiple tasks with behavioral and operational metrics.
- `#/deepcompare?tasks=<id>&baseline=<baseline_id>` — Compare tasks with a fixed baseline reference.

### Test rules fallback

`test-rules.yaml` is only the fallback/configuration layer for tests that run without a baseline. Baseline-backed testing uses the baseline’s extracted benchmark set as the primary source of truth.

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
