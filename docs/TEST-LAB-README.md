# PostQode Test Lab

Automated release-testing studio for the PostQode VS Code extension, built into PQ Dashboard.  
Covers the full **PostQode Release Test Checklist** sheet-by-sheet — from provider selection and chat streaming to slash commands, workflows, rules, and skills — with both **Mocked** (free, deterministic) and **Live** (real API) execution modes.

---

## Core Philosophy: Truth to Existence & Meaningful Tests

> **The Non-Negotiable Standard:**  
> *"All tests in the suite must have a purpose to prove that PostQode is working in the right way. No dummy or shallow tests. Understand the functionality, do test manually and observe everything — not just execution, but tool invocation, results, and changes in UI. Use a live model, intercept real network and DOM behaviors, and use those details for mocking."*

Every single test in this suite is truthful to its existence. A test does not simply pass because an async function finished without throwing; it must explicitly verify the full contract across four rigorous phases:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     PHASE 1     │     │     PHASE 2     │     │     PHASE 3     │     │     PHASE 4     │
│  Request Sent   │ ──▶ │  Tools Called   │ ──▶ │ Response Stream │ ──▶ │ UI & Side Effects│
│  Dispatched     │     │  Payload & Args │     │ Markdown/Cards  │     │ Disk/DOM/Secrets│
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

### The 4-Phase Verification Contract

1. **Phase 1 — Request Sent (Dispatched Action)**  
   The scenario dispatches an explicit prompt, slash command, UI button click, or configuration change to the PostQode webview or host IDE. We assert that the input is received and reflected in the active task context.
2. **Phase 2 — Tools Called (Invocation & Arguments)**  
   When the agent decides to take action, we verify that the correct PostQode tool is invoked (e.g., `write_to_file`, `replace_in_file`, `execute_command`, `new_rule`, `new_workflow`, `use_skill`, `condense`, `new_task`) with validated argument signatures.
3. **Phase 3 — Response Handled (Streaming & Completion)**  
   We verify that PostQode streams and parses incoming chunks: reasoning blocks (`<think>`), tool call approval cards, response markdown, and completion signals without malformed syntax, truncation, or UI lockup.
4. **Phase 4 — UI Changes & Physical Side Effects**  
   We do not stop at UI rendering. We verify real, concrete physical side effects:
   - **Filesystem mutations:** Files created or edited on disk (`hello.py`, `calculator.js`, `.postqode/rules/`, `.postqode/workflows/`) are verified using `fs.existsSync` and `fs.readFileSync`.
   - **Credential boundaries:** Verifying VS Code `SecretStorage` isolation so API keys are never exposed in plaintext configurations or chat DOM.
   - **IDE & Viewport State:** Editor side-by-side splits, fullscreen mode toggles, and input focus shifts.
   - **History & Checkpoints:** Snapshot persistence and rollback recovery.

---

## Quick Start

```bash
# 1. Start the PQ Dashboard (Server & Web Client)
npm start            # Backend server on http://localhost:3456 & Proxy on 3457
npm run dev          # Or Vite dev client on http://localhost:5173

# 2. Open Test Lab in your browser
# Navigate to: http://localhost:3456/#/postqode-test
```

---

## Architecture & File Map

```
server/postqode-test/
  runner.js              ← Orchestrates scenario execution (sandbox setup → run → teardown)
  scenarios-metadata.js  ← Central catalog of all 50 scenarios (Purpose, 4-Phase Contract, Side Effects)
  cdp-controller.js      ← CDP (Chrome DevTools Protocol) — drives VS Code webviews & DOM
  sse-mock-scenarios.js  ← Mock SSE server for deterministic AI response & tool call simulation
  allure-reporter.js     ← Generates the standalone Allure HTML report with 4-phase contract cards

src/js/views/postqode-test/
  index.js               ← Main frontend orchestrator
  template.js            ← HTML scaffold for Test Lab (Checklist, Terminal, KPIs, Report Table)
  checklist.js           ← Accordion rendering, Purpose callouts, 4-phase expandable details, badges
  runner.js              ← SSE event stream consumer, execution state machine, pause/resume/stop
  report.js              ← Release matrix table, KPI computation, 4-phase contract details, gallery
  scenarios/             ← Scenario definitions enriched with meaning, pipeline, and side effects
    providers-models.js  ← PROV-01 to PROV-10 (10 scenarios)
    gui-editor.js        ← GUI-01, GUI-02, GUI-07, UI-03 (4 scenarios)
    install-activation.js← INS-01, INS-02, INS-07 (3 scenarios)
    settings-flags.js    ← SET-01 (1 scenario)
    mcp.js               ← MCP-01 (1 scenario)
    history-state.js     ← HIST-01, HIST-02 (2 scenarios)
    chat-agent.js        ← CHAT-01 to CHAT-12 (12 scenarios; CHAT-13 is manual)
    files-tools.js       ← FILE-01 (1 scenario)
    slash-commands.js    ← SLASH-01 to SLASH-10 (10 scenarios)
    workflows-rules-skills.js ← FLOW-01..03, RULE-01..02, SKILL-01..03 (7 scenarios)
```

---

## Methodology: Live-Capture-Then-Mock

To ensure deterministic mocks never drift from reality:
1. **Live Interception:** We run the feature live against `postqode:moonshotai/kimi-k3` or Claude via PostQode Cloud with our MITM proxy (port 3457).
2. **Observability Capture:** We record the exact SSE events, tool call names, tool parameters, thinking chunks, and resulting webview DOM mutations.
3. **Deterministic Mock Creation:** We copy the observed structure into `sse-mock-scenarios.js`.
4. **Contract Verification:** The test asserts that PostQode handles the exact streaming payload, creates physical disk artifacts, and renders the expected UI cards.

---

## PostQode Tool Names (Source of Truth)

Directly confirmed from the compiled PostQode extension source (`dist/github-review-bot.js`):

| Tool Enum | SSE / Extension Tool Name | Purpose & Verification |
|-----------|---------------------------|------------------------|
| `FILE_NEW` | `write_to_file` | Creates a new file on disk with given content |
| `FILE_EDIT` | `replace_in_file` | Performs targeted search-and-replace on file |
| `BASH` | `execute_command` | Executes terminal commands in the workspace |
| `NEW_TASK` | `new_task` | Spawns a fresh task / context thread |
| `CONDENSE` | `condense` | Summarizes and compacts long conversation history |
| `NEW_RULE` | `new_rule` | Creates a project-specific rule in `.postqode/rules/` |
| `NEW_GLOBAL_RULE` | `new_global_rule` | Creates a global user rule in global storage |
| `NEW_WORKFLOW` | `new_workflow` | Generates a multi-step workflow in `.postqode/workflows/` |
| `NEW_GLOBAL_WORKFLOW` | `new_global_workflow`| Generates a global reusable workflow |
| `USE_SKILL` | `use_skill` | Ingests and executes a specialized skill definition |
| `ASK` | `ask_followup_question` | Halts execution to solicit structured user input |
| `REPORT_BUG` | `report_bug` | Bundles diagnostics and pre-fills an issue template |

---

## Comprehensive Suite Catalog (50 Scenarios)

Every test in the 50-test suite is cataloged below with its architectural purpose, 4-phase contract, and verified side effect:

### 1. Providers & Models (10 Scenarios)
| ID | Scenario | Architectural Purpose / Meaning | Verified Side Effect |
|----|----------|---------------------------------|----------------------|
| **PROV-01** | PostQode Provider & Default Model Selection | Validates that selecting PostQode provider correctly defaults to `kimi-k3` and persists across reloads. | Config State & Model Dropdown |
| **PROV-02** | Switching Models within PostQode Provider | Proves provider model selector updates context window limit indicators and chat tags. | Context Window & Model Badge |
| **PROV-03** | Live PostQode Model Verification | Tests genuine outbound API handshake and live token generation via PostQode Cloud. | Live Network Handshake |
| **PROV-04** | Third-Party Provider (Anthropic) Setup | Verifies third-party provider activation and API key validation flow. | SecretStorage Credential Boundary |
| **PROV-05** | OpenRouter Provider Setup | Verifies OpenRouter model directory discovery and routing configuration. | SecretStorage Credential Boundary |
| **PROV-06** | Ollama Local Provider Setup | Ensures local Ollama instance URL configuration and model listing work offline. | Local Endpoint Handshake |
| **PROV-07** | LM Studio Local Provider Setup | Tests local OpenAI-compatible endpoint handshake without external egress. | Local Endpoint Handshake |
| **PROV-08** | Plan vs Agent Mode Toggle | Proves switching between Plan and Agent mode changes permission level and tool access. | Mode Pill & System Instruction State |
| **PROV-09** | Error Handling for Invalid API Key | Verifies graceful error cards when upstream returns 401 Unauthorized without crashing IDE. | DOM Error Card & Retry Button |
| **PROV-10** | Context Window Limit Warning | Proves extension warns user when approaching model context window threshold. | Context Token Meter & Alert DOM |

### 2. GUI & Editor Integration (4 Scenarios)
| ID | Scenario | Architectural Purpose / Meaning | Verified Side Effect |
|----|----------|---------------------------------|----------------------|
| **GUI-01** | PostQode Activity Bar & Webview Activation | Proves extension registers custom activity container and webview boots without blank screen. | VS Code Container & Webview Mount |
| **GUI-02** | Side-by-Side Editor & Chat Split | Validates that PostQode operates correctly alongside an active text editor in split view. | Workbench Multi-Column Layout |
| **GUI-07** | Fullscreen / Expand Chat Panel | Proves expanding chat into full workbench tab resizes message layout and responsive cards. | Fullscreen Tab Resize & Layout Reset |
| **UI-03** | Mode Dropdown & Quick Actions | Verifies quick action pills (Agent, Plan, Ask) immediately switch prompt routing context. | Active Mode Selector State |

### 3. Install & Activation (3 Scenarios)
| ID | Scenario | Architectural Purpose / Meaning | Verified Side Effect |
|----|----------|---------------------------------|----------------------|
| **INS-01** | VSIX Extension Installation | Verifies clean installation of VSIX package into isolated VS Code profile directory. | Filesystem Extension Manifest |
| **INS-02** | PostQode Activation on Startup | Confirms extension activates automatically upon VS Code launch without hanging event loop. | VS Code Extension Host Process |
| **INS-07** | Extension Deactivation & Cleanup | Ensures deactivating extension stops all child processes and clears transient file locks. | Clean Process & File Lock Release |

### 4. Settings & Feature Flags (1 Scenario)
| ID | Scenario | Architectural Purpose / Meaning | Verified Side Effect |
|----|----------|---------------------------------|----------------------|
| **SET-01** | Settings Panel & Configuration Persistence | Proves user preferences in Settings panel persist to VS Code global and workspace storage. | VS Code Global & Workspace Storage |

### 5. MCP (Model Context Protocol) (1 Scenario)
| ID | Scenario | Architectural Purpose / Meaning | Verified Side Effect |
|----|----------|---------------------------------|----------------------|
| **MCP-01** | MCP Server Discovery & Tool Listing | Verifies PostQode discovers configured MCP servers and exposes tools to prompt context. | MCP Server Config & Tool Badges |

### 6. Checkpoints, History & State (2 Scenarios)
| ID | Scenario | Architectural Purpose / Meaning | Verified Side Effect |
|----|----------|---------------------------------|----------------------|
| **HIST-01** | Task History Persistence & Reload | Proves past conversation sessions persist across VS Code restarts and restore intact. | Session Storage & Task List DOM |
| **HIST-02** | Checkpoint Snapshot & Code Rollback | Verifies checkpoint snapshots track code changes and allow instant rollback to clean state. | Workspace Checkpoint Rollback |

### 7. Chat & Agent Mode (12 Scenarios)
| ID | Scenario | Architectural Purpose / Meaning | Verified Side Effect |
|----|----------|---------------------------------|----------------------|
| **CHAT-01** | Basic Chat Streaming & Markdown Render | Proves incremental token delivery streams into UI and renders markdown with syntax highlighting. | DOM Streaming Message & Code Block |
| **CHAT-02** | Agent Tool Execution (`write_to_file`) | Verifies agent automatically calls `write_to_file`, creates real code file on disk, and reports. | Filesystem Mutation: `hello.py` |
| **CHAT-03** | User Interruption / Cancel Generation | Validates clicking Cancel stops LLM streaming instantly and releases controller lock. | Stream Abort & State Unlock |
| **CHAT-04** | Thinking / Reasoning Stream (`<think>`) | Ensures deep-reasoning models render expandable thinking blocks before final response. | Expandable Collapsible `<think>` Card |
| **CHAT-05** | Ask Followup Question Flow | Verifies `ask_followup_question` tool renders interactive choice buttons and waits for user. | Interactive Followup Question Card |
| **CHAT-06** | File Context Attachment (`@file`) | Validates that mentioning a workspace file injects its exact content into prompt context. | Context Token Counter & File Pill |
| **CHAT-07** | Terminal Command Execution (`execute_command`) | Verifies `execute_command` displays execution card, runs command safely, and captures stdout. | Terminal Subprocess & Output Card |
| **CHAT-08** | Plan Mode Approval Requirement | Proves Plan mode strictly requires user click "Approve" before any tool modifies workspace. | Interactive Approval Action Card |
| **CHAT-09** | Multi-Turn Conversation Memory | Validates model maintains conversation context across multiple turns without amnesia. | Conversation Memory & Context Cache |
| **CHAT-10** | Error Recovery on Network Drop | Ensures simulated connection drop triggers auto-retry with exponential backoff and notification. | Fault Injection Retry Toast |
| **CHAT-11** | Code Diff & Review Card | Proves proposed file modifications render a unified diff view with accept/reject buttons. | Interactive Diff Card & File Preview |
| **CHAT-12** | Task Resume from History | Verifies resuming an existing task thread restores previous conversation state and memory. | History Resume & Thread Restoration |

### 8. Files & Terminal Tools (1 Scenario)
| ID | Scenario | Architectural Purpose / Meaning | Verified Side Effect |
|----|----------|---------------------------------|----------------------|
| **FILE-01** | File Creation & Targeted Edit | Verifies full file lifecycle: creating `calculator.js`, editing via `replace_in_file`, verifying disk. | Filesystem Mutation: `calculator.js` |

### 9. Slash Commands (10 Scenarios)
| ID | Scenario | Architectural Purpose / Meaning | Verified Side Effect |
|----|----------|---------------------------------|----------------------|
| **SLASH-01** | `/newtask` Command | Proves `/newtask` dispatches `new_task` tool, clears chat DOM, and initializes new session. | Session Reset & New Task DOM |
| **SLASH-02** | `/compact` Command | Proves `/compact` dispatches `condense` tool, condenses tokens, and frees context memory. | Context Compaction & Token Drop |
| **SLASH-03** | `/init` Workspace Configuration | Proves `/init` scans workspace, invokes `write_to_file`, and generates `.postqoderules` configuration. | Filesystem Mutation: `.postqoderules` |
| **SLASH-04** | `/newrule` Workspace Rule Creation | Proves `/newrule` creates structured, project-scoped instruction in `.postqode/rules/`. | Filesystem Mutation: `.postqode/rules/` |
| **SLASH-05** | `/globalrule` Global Rule Creation | Proves `/globalrule` creates user-wide persistent instruction in global settings. | Global User Rule Storage |
| **SLASH-06** | `/workflow` Workspace Workflow Creation | Proves `/workflow` generates multi-step automated workflow definition in `.postqode/workflows/`. | Filesystem Mutation: `.postqode/workflows/` |
| **SLASH-07** | `/globalworkflow` Global Workflow Creation | Proves `/globalworkflow` creates global reusable workflow accessible across projects. | Global Workflow Catalog |
| **SLASH-08** | `/reportbug` Diagnostic Collector | Proves `/reportbug` gathers environment telemetry, active model, and VS Code logs safely. | Bug Diagnostic Report DOM |
| **SLASH-09** | `/deep-planning` Architecture Breakdown | Proves `/deep-planning` forces structured breakdown, architecture requirements, and milestone steps. | Deep Plan Phase Matrix |
| **SLASH-10** | `/explain-changes` Diff Inspection | Proves `/explain-changes` inspects git diff and explains all workspace modifications. | Git Diff Analysis Card |

### 10. Workflows, Rules & Skills (7 Scenarios)
| ID | Scenario | Architectural Purpose / Meaning | Verified Side Effect |
|----|----------|---------------------------------|----------------------|
| **FLOW-01** | Workspace Workflow Execution | Proves executing workspace workflow runs defined steps sequentially and verifies disk outputs. | Sequential Step Disk Mutation |
| **FLOW-02** | Global Workflow Execution | Verifies running global workflow applies cross-project automation cleanly. | Global Automation Execution |
| **FLOW-03** | Workflow Parameter Prompting | Proves parameterized workflows prompt user for variables before execution starts. | Interactive Variable Form Modal |
| **RULE-01** | Workspace Rule Compliance | Proves active workspace rule strictly constrains model behavior (e.g., Python typing enforcement). | Rule Enforcement Verification |
| **RULE-02** | Global Rule Compliance | Proves global rule preferences apply seamlessly to new projects without re-prompting. | Cross-Workspace Rule Enforcer |
| **SKILL-01** | Skill Catalog Discovery | Verifies PostQode discovers and lists installed custom skills from skill directory. | Skill Directory Indexing |
| **SKILL-02** | Custom Skill Invocation | Proves agent selects and invokes specialized skill (`use_skill`) when task matches skill domain. | Skill Execution Output Card |
| **SKILL-03** | Skill Execution with Output Artifact | Verifies skill execution completes and generates expected output artifact on disk. | Filesystem Mutation: Skill Artifact |

---

## Test Lab UI Integration

### 1. Checklist Panel
- **Sheet Accordion**: All 10 sheets collapsed cleanly by default.
- **Purpose Callout**: Every test card displays a prominent blue callout explaining **Why this test exists**.
- **4-Phase Contract Details**: Expandable `🔍 4-Phase Contract` drawer detailing Request, Tools, Response, and UI/Side Effects.
- **Side Effects Badge**: Cyan badge indicating the exact concrete side effect verified (e.g. `Filesystem Mutation`, `SecretStorage Boundary`, `Modal Interaction`).
- **Sheet Controls**: Dedicated `Run Sheet` and `Select Sheet` toggles per sheet.

### 2. Execution Panel
- **Live State Stream**: Real-time pass/fail/running indicators with micro-second timers.
- **Terminal Log Stream**: Real-time console logs and CDP telemetry.
- **Interactive Controls**: `⏸ Pause`, `▶ Resume`, and `⏹ Stop & Teardown`.

### 3. Report Panel & Release Matrix Table
- **Matrix Table Rows**:
  - **ID & Sheet Area**
  - **Title with Side Effect Badge**
  - **Architectural Purpose Note**
  - **Collapsible 4-Phase Contract Breakdown**
  - **Model Pill (DOM / Live / Mock SSE)**
  - **Individual Verification Assertions**
  - **Duration & Pass/Fail Status Badge**
  - **Visual Screenshot Gallery**
  - **▶ Re-run Button**
- **Allure-Style Standalone Report**:
  - Full-screen dashboard with dedicated **Architectural Purpose & 4-Phase Contract** section card.
  - Interactive test tree, visual lightbox gallery, and artifact inspector.

---

## Troubleshooting & FAQ

| Problem | Root Cause | Solution |
|---------|------------|----------|
| **Many VS Code windows opening and none closing** | Orphan processes not killed on test abort | Runner now issues `pkill -9 -f pq-profile` in `afterAll` and scenario teardown. Manual cleanup: `pkill -9 -f pq-profile` |
| **INS-01 / INS-07 ETIMEDOUT** | CLI `execSync --install-extension` hanging | Verified via direct filesystem extension manifest inspection instead of blocking CLI |
| **Button not found in `/newtask` or `/compact`** | DOM race condition before LLM finishes streaming | Tests now poll with a 3s grace period + 15s CDP wait loop until tool execution finishes |
| **`waitForMessageContaining is not a function`** | CDP controller missing helper | Method implemented in `server/postqode-test/cdp-controller.js` |
| **Extension tool names not triggering** | Incorrect tool casing | Use confirmed source tool names (`write_to_file`, `replace_in_file`, `new_rule`, `new_workflow`, `new_global_rule`, `new_global_workflow`) |

---

## Verification Commands

```bash
# Verify backend server syntax & scenarios metadata
node -e "require('./server/postqode-test/runner'); require('./server/postqode-test/scenarios-metadata'); console.log('Backend OK');"

# Verify frontend bundle build
npm run build
```
