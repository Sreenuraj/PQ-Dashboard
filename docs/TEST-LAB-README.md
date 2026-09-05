# PostQode Test Lab

Automated release-testing studio for the PostQode VS Code extension, built into PQ Dashboard.  
Covers the full **PostQode Release Test Checklist** sheet-by-sheet — from provider selection to chat streaming to history state — with both **Mocked** (free, deterministic) and **Live** (real API) execution modes.

> **Methodology: Live-Capture-Then-Mock**  
> Tests are designed using real captured behavior: each feature is first run live with `postqode:moonshotai/kimi-k3`, the actual SSE stream, tool call names, UI button labels, and DOM changes are observed and recorded, then used to build accurate deterministic mocks. This ensures tests assert **real behavior**, not guesses.

---

## Quick Start

```bash
# 1. Start the dashboard
npm run dev          # http://localhost:3456

# 2. Open Test Lab
# Navigate to http://localhost:3456/#/postqode-test
```

---

## Architecture

```
server/postqode-test/
  runner.js              ← Orchestrates scenario execution (setup → run → teardown)
  cdp-controller.js      ← CDP (Chrome DevTools Protocol) — drives VS Code webviews
  sse-mock-scenarios.js  ← Mock SSE server for deterministic AI response simulation
  allure-reporter.js     ← Generates the Allure-style HTML report with model details

src/js/views/postqode-test/
  index.js               ← Main orchestrator (wires all modules)
  template.js            ← HTML scaffold for the Test Lab view
  checklist.js           ← Sheet accordion, select-toggle, presets, mode switcher
  runner.js              ← SSE stream, execution state machine, pause/resume/stop
  report.js              ← Report rendering, KPI cards, matrix table, screenshot gallery
  scenarios/
    index.js             ← Barrel combining all sheets
    providers-models.js  ← PROV-01 to PROV-10
    gui-editor.js        ← GUI-01, GUI-02, GUI-07, UI-03
    install-activation.js← INS-01, INS-02, INS-07
    settings-flags.js    ← SET-01
    mcp.js               ← MCP-01
    history-state.js     ← HIST-01, HIST-02
    chat-agent.js        ← CHAT-01 to CHAT-12 (CHAT-13 is Manual-only)
    files-tools.js       ← FILE-01
```

---

## Execution Modes

| Mode | Description | Cost |
|------|-------------|------|
| **Mocked** | SSE responses intercepted via PQ proxy (port 3457). Deterministic tool calls. | Free |
| **Live** | Real API calls via PostQode Cloud (default model: `moonshotai/kimi-k3`). | Token cost |

### Mocked Mode

All LLM tests use the `sse-mock-scenarios.js` server to replay pre-crafted SSE streams (tool calls, think-tag streams, retry faults, etc.).  
Tests that require a live model (`liveOnly: true`) are **automatically disabled** in Mocked mode.

### Live Mode

The default model is `moonshotai/kimi-k3` (cost-effective coding model).  
Select any supported model from the dropdown in the Test Lab UI.  
Third-party provider tests (PROV-04 Anthropic, PROV-05 OpenRouter) require an API key entered directly in the UI — they remain disabled until a key is provided.

---

## Test Lifecycle

Every test run follows this sequence:

```
Setup (sandbox)
  └─ Launch isolated VS Code profile (/tmp/pq-profile-<id>)
  └─ Copy extension into profile
  └─ Attach CDP debugger

Run scenarios (sequential)
  └─ Each scenario: navigate → interact → assert → screenshot

Teardown
  └─ Kill VS Code process
  └─ Delete /tmp/pq-profile-<id>
  └─ Verify 0 orphan processes
```

Teardown runs on:
- **Normal completion** — automatically after last scenario
- **Stop button** — immediately, sandboxes torn down
- **Test error** — runner catches and calls teardown before exiting

---

## Sheets & Checklist IDs

| Sheet | IDs | Auto? |
|-------|-----|-------|
| Providers & Models | PROV-01, 02, 03*, 04†, 05†, 08, 09, 10 | ✅ (03 = Live only; 04, 05 = key required) |
| GUI & Editor Integration | GUI-01, GUI-02, GUI-07, UI-03 | ✅ |
| Install & Activation | INS-01, INS-02, INS-07 | ✅ |
| Settings & Feature Flags | SET-01 | ✅ |
| MCP | MCP-01 | ✅ |
| Checkpoints, History & State | HIST-01, HIST-02 | ✅ |
| Chat & Agent Mode | CHAT-01 to CHAT-12 | ✅ |
| Chat & Agent Mode | CHAT-13 | ❌ Manual (multi-window lock) |
| Files & Terminal Tools | FILE-01 | ✅ |
| Slash Commands | SLASH-01 `/newtask`, SLASH-02 `/compact`, SLASH-03 `/init`, SLASH-04 `/newrule`, SLASH-05 `/globalrule`, SLASH-06 `/workflow`, SLASH-07 `/globalworkflow`, SLASH-08 `/reportbug`, SLASH-09 `/deep-planning`, SLASH-10 `/explain-changes` | ✅ |
| Workflows, Rules & Skills | FLOW-01 to FLOW-03, RULE-01 to RULE-02, SKILL-01 to SKILL-03 | ✅ |

---

## UI Features

### Checklist Panel
- **Sheet accordion** — sheets collapsed by default; click header to expand
- **☐ Select Sheet** toggle — click to select/deselect all tests in a sheet; turns ☑ when selected
- **▶ Run Sheet** — run only that sheet's tests immediately
- **Presets** — `P0 Sanity`, `Providers & Models`, `Chat & Agent`, `Fullscreen & GUI`, `Lifecycle`, `Select All`
- **Category tabs** — filter checklist to one sheet
- **Quick Sheet dropdown** — top-level "Run Sheet:" selector + Run button

### Execution Panel
- **Live step cards** — real-time pass/fail/running state per scenario
- **Terminal log stream** — raw execution logs
- **⏸ Pause / ▶ Resume** — freeze execution; sandbox stays alive during pause
- **⏹ Stop & Teardown** — hard stop; all sandboxes destroyed immediately

### Report Panel
- **KPI cards** — Pass Rate, Scenarios Passed, Duration, Target Sandbox, PostQode Version, Host OS, Default Model
- **Release Matrix Table** — per-test: ID, Sheet, Scenario, **Model**, Expected Result, Assertions, Duration, Status, Screenshots, Re-run button
- **▶ Re-run** (per row) — re-run a single test from the report
- **🔄 Re-run Failed** — re-queue only failed tests
- **📊 View Allure Report** — opens the full Allure-style HTML report in a new tab
- **Re-run from Allure** — each test detail in the Allure report has a "Re-run in Dashboard" button

### Run History
- Lists all past runs with timestamp, host, mode, pass rate, duration
- **View** — loads the report inline
- **📊 Allure** — opens the Allure report for that run
- **📦 Zip** — downloads the full evidence bundle

---

## Report Metadata

Every run's `report.json` and Allure HTML include:

| Field | Source |
|-------|--------|
| `postqodeVersion` | Detected from installed extension `package.json` |
| `os` | `os.type() + os.release() + os.arch()` |
| `host` | IDE target (e.g. `vscode-insiders`) |
| `mode` | `mocked` or `live` |
| `defaultModel` | Selected model (or `Mock Engine (model)` in mocked mode) |
| `model` (per test) | Exact model used (e.g. `Mock SSE (write_to_file)`, `UI / DOM`, `moonshotai/kimi-k3`) |

---

## Adding a New Sheet

1. **Create** `src/js/views/postqode-test/scenarios/<sheet-name>.js`
2. **Export** your scenario array (see existing files for the schema)
3. **Add** the import + spread to `scenarios/index.js`
4. **Add** the sheet `<option>` to `template.js` (quick-sheet dropdown)
5. **Add** the `<button class="testlab-tab">` to the category tabs in `template.js`
6. **Implement** the server-side scenario handlers in `server/postqode-test/runner.js`

---

## Environment Variables / Config

No `.env` required for Mocked mode.  
For Live mode, API keys are entered directly in the UI (never stored in config files).

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| "Host not detected" | Ensure VS Code Insiders is installed and PostQode extension is active |
| Tests stuck "Running" after completion | Build has been updated — hard-refresh the page (`Cmd+Shift+R`) |
| CDP attach timeout | Another VS Code process may be holding the port — kill stale processes with `pkill -f "code-insiders"` |
| Mock SSE not responding | Verify proxy is running on port 3457: `curl http://localhost:3457` |
| VSIX upload fails | Check `/tmp` has write access; VSIX must be < 200 MB |
| Many VS Code windows, none closing | The teardown `pkill -9 -f <profile>` now runs after every scenario. If stuck, run `pkill -9 -f pq-profile` manually |
| INS-01/INS-07 ETIMEDOUT | Fixed: install/uninstall tests now use filesystem verification instead of blocking CLI calls |
| Slash command button not found | Tests now wait for PostQode to finish processing the tool call (3s grace + 15s polling) before asserting button visibility |
| `TypeError: controller.waitForMessageContaining is not a function` | Fixed: method is now present in cdp-controller.js |

---

## PostQode Tool Names (Source of Truth)

Confirmed from PostQode extension source (`dist/github-review-bot.js`):

| Tool Enum | Tool Name Used in SSE |
|-----------|---------------------|
| `CONDENSE` | `condense` |
| `NEW_TASK` | `new_task` |
| `NEW_RULE` | `new_rule` |
| `NEW_WORKFLOW` | `new_workflow` |
| `NEW_GLOBAL_RULE` | `new_global_rule` |
| `NEW_GLOBAL_WORKFLOW` | `new_global_workflow` |
| `FILE_NEW` | `write_to_file` |
| `FILE_EDIT` | `replace_in_file` |
| `ASK` | `ask_followup_question` |
| `BASH` | `execute_command` |
| `REPORT_BUG` | `report_bug` |
| `USE_SKILL` | `use_skill` |
