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
- **Task Investigation View:** A powerful deep-dive observability trace viewer. Intelligently displays full tool invocations, logic breakdowns, and payloads. Features an integrated live search across all task events (prompts, responses, errors, tools).
- **Task Comparison Dashboard:** Choose multiple tasks from your Session index and run a side-by-side flex grid comparison of execution variables, cost/duration bars, and automated agentic scorecard metrics.
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

## Architecture
- **Backend (`server/`):** Express.js + `better-sqlite3`. Contains the config loader, filesystem scanner, event extraction logic (`ui_messages.json` parsing), task cache deduplication, and REST API routes (including advanced on-the-fly sequence mapping and Sankey node generators).
- **Activity Classification (`server/classifier.js`):** Deterministic heuristics classify each task from tool usage, shell commands, and prompt keywords. The resulting category and retry metrics are stored in SQLite and power the Activity Intelligence page without any secondary LLM calls.
- **Frontend (`src/`):** A lightweight `Vite` setup using Vanilla HTML/JS/CSS. Dynamic routing logic and encapsulated API clients present the curated data visually alongside high-performance charts rendered via `d3-sankey` AND `chart.js`.
- **Cache (`data/`):** Local SQLite WAL-mode cache mapping historical task events dynamically.

## Troubleshooting
- **No data visible?** Make sure the paths under `sources:` in `pq-config.yaml` are correctly matching your filesystem structure and have `enabled: true`.
- **EADDRINUSE errors?** This means the ports 3456 or 5173 are blocked. Use `pkill -f "node server/index.js"` and `pkill -f "vite"` to free them.
