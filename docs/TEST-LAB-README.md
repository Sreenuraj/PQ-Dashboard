# PostQode Test Lab

Automated release-testing studio for the PostQode VS Code extension, built directly into PQ Dashboard.  
Covers the full **PostQode Release Test Checklist** sheet-by-sheet — from provider selection and chat streaming to slash commands, workflows, rules, skills, and MCP — with both **Mocked** (free, deterministic, offline) and **Live** (real model API) execution modes.

---

## Core Philosophy: Truth to Existence & Meaningful Tests

> [!IMPORTANT]
> ### The Non-Negotiable Standard
> *"All tests in the suite must have a purpose to prove that PostQode is working in the right way. No dummy or shallow tests. Understand the functionality, test manually first and observe everything — not just execution, but tool invocation, results, and changes in UI. Use a live model, intercept real network and DOM behaviors, and use those details for mocking."*

Every single test in this suite is truthful to its existence. A test does not simply pass because an async function finished without throwing; it must explicitly verify the full contract across five rigorous phases:

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│     PHASE 1     │     │     PHASE 2     │     │     PHASE 3     │     │     PHASE 4     │     │     PHASE 5     │
│  Request Sent   │ ──▶ │  Tools Called   │ ──▶ │ Response Stream │ ──▶ │ UI & Side Effect│ ──▶ │ Task Parity     │
│  Dispatched     │     │  Payload & Args │     │ Markdown/Cards  │     │ Disk/DOM/Secrets│     │ History Baseline│
└─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘     └─────────────────┘
```

### The 5-Phase Verification Contract

1. **Phase 1 — Request Sent (Dispatched Action)**  
   The scenario dispatches an explicit prompt, slash command, UI button click, or configuration change to the PostQode webview or host IDE. We assert that the input is received and reflected in the active task context.
2. **Phase 2 — Tools Called (Invocation & Arguments)**  
   When the agent decides to take action, we verify that the correct native PostQode tool is invoked (e.g., `write_to_file`, `replace_in_file`, `execute_command`, `new_rule`, `new_workflow`, `use_skill`, `condense`, `new_task`, `ask_followup_question`) with validated argument signatures.
3. **Phase 3 — Response Handled (Streaming & Completion)**  
   We verify that PostQode streams and parses incoming chunks: reasoning blocks (`<think>`), tool call approval cards, response markdown, and completion signals without malformed syntax, truncation, or UI lockup.
4. **Phase 4 — UI Changes & Physical Side Effects**  
   We never stop at UI rendering. We verify real, concrete physical side effects:
   - **Filesystem mutations:** Files created or edited on disk (`hello.py`, `calculator.js`, `.postqode/rules/`, `.postqode/workflows/`) are verified using `fs.existsSync` and `fs.readFileSync`.
   - **Credential boundaries:** Verifying VS Code `SecretStorage` isolation so API keys are never exposed in plaintext configurations or chat DOM.
   - **IDE & Viewport State:** Editor side-by-side splits, fullscreen mode toggles, and input focus shifts.
   - **History & Checkpoints:** Snapshot persistence and rollback recovery.
5. **Phase 5 — Task File Parity (Golden Baseline Comparison)**  
   In Mocked mode, the runner automatically compares the generated native task state (`api_conversation_history.json` and `ui_messages.json`) against the golden baseline recorded from a live model run. We assert that turns, tool sequences, and message schemas match with 100% fidelity.

---

## Contribution Guide: Rules to Add a New Test

When adding a new test to the PostQode Test Lab, follow these strict rules to ensure suite integrity and prevent test rot:

### 1. The Checklist: What You Need for Every New Test

Every new test scenario requires updates across five distinct layers:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Metadata Catalog  │ server/postqode-test/scenarios-metadata.js           │
├──────────────────────┼──────────────────────────────────────────────────────┤
│ 2. Frontend Catalog  │ src/js/views/postqode-test/scenarios/<module>.js     │
├──────────────────────┼──────────────────────────────────────────────────────┤
│ 3. Runner Handler    │ server/postqode-test/runner.js                       │
├──────────────────────┼──────────────────────────────────────────────────────┤
│ 4. SSE Mock Engine   │ server/postqode-test/sse-mock-scenarios.js           │
├──────────────────────┼──────────────────────────────────────────────────────┤
│ 5. Golden Fixture    │ server/postqode-test/fixtures/live-recordings/<id>/  │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Step 1: Register in Backend Metadata (`scenarios-metadata.js`)
Define the test with full contractual context:
```js
{
  id: 'slash-11',
  checklistId: 'SLASH-11',
  sheetName: 'Slash Commands',
  category: 'Slash Commands',
  priority: 'P1',
  title: 'SLASH-11: /custom-command (Action Verification)',
  meaning: 'Proves the architectural contract of /custom-command: dispatches tool call, renders action button, and executes disk side effect.',
  pipeline: {
    request: 'Submit /custom-command in active chat',
    tools: 'custom_tool called with arguments',
    response: 'Action card streamed to webview',
    uiAndSideEffects: 'Action button rendered; clicking it creates expected file on disk',
  },
  sideEffects: 'Filesystem Mutation: .postqode/custom.md verified on disk',
  expectedResult: 'Tool call emitted; action button rendered; clicking action modifies disk state',
}
```

#### Step 2: Register in Frontend Scenarios (`src/js/views/postqode-test/scenarios/`)
Add the scenario to the appropriate module file matching the backend metadata. This ensures the Test Lab dashboard renders the Purpose Callout, 4-Phase Contract drawer, and Side Effect badge.

#### Step 3: Implement Execution Logic in Runner (`runner.js`)
Use `this.runScenario(...)` with explicit phase assertions, screenshots, and clean teardown:
```js
// SLASH-11: /custom-command
if (!this.isStopped && this.isScenarioSelected('slash-11', 'SLASH-11', 'Slash Commands')) {
  await this.runScenario(
    scenarioMetadata,
    async (step) => {
      await this.controller.startNewTask();
      await this.controller.sendPrompt('/custom-command');

      const shot1 = await this.controller.takeScreenshot('slash-11-01-submitted.png');
      if (shot1) step.screenshots.push('slash-11-01-submitted.png');

      const btnFound = await this.controller.waitForActionButton('Execute Action', 8000);
      if (btnFound) {
        await this.controller.clickActionButton('Execute Action');
      }

      const shot2 = await this.controller.takeScreenshot('slash-11-02-completed.png');
      if (shot2) step.screenshots.push('slash-11-02-completed.png');

      // Assert each phase explicitly
      step.assertions.push({ name: 'Phase 1 [Request]: Prompt dispatched', passed: !!this.controller.page });
      step.assertions.push({ name: 'Phase 2 [Tool]: Model emitted custom_tool', passed: btnFound });
      step.assertions.push({ name: 'Phase 4 [Side Effect]: File created on disk', passed: fs.existsSync(targetFile) });
    }
  );
}
```

#### Step 4: Implement Mock SSE Response in Mock Server (`sse-mock-scenarios.js`)
Implement the realistic tool call or completion response:
```js
if (commandType === 'custom_command' || fullLower.startsWith('/custom-command')) {
  return streamToolCallResponse({
    res,
    toolName: 'custom_tool',
    argsObj: { path: '.postqode/custom.md', action: 'create' },
    model,
    onChunk,
  });
}
```

#### Step 5: Capture Golden Live Baseline (`server/postqode-test/fixtures/live-recordings/`)
Run the test once in Live mode against the real model (`moonshotai/kimi-k3` or Claude) and promote the recording so it is preserved in Git fixtures (see [Live Data & Mock Generation](#live-data--mock-generation-engine)).

---

### 2. Contribution Rules & Best Practices

1. **No Shallow "Ping-Pong" Tests**:
   - A test that only checks if PostQode responded with text is forbidden.
   - You must assert what tool was used, what arguments were sent, whether the expected UI card rendered, and what changed on disk or in settings.
2. **Never Touch User Profile or Active Sessions**:
   - Tests must run exclusively in temporary sandbox directories (`/var/folders/.../pq-workspace-XXXXXX`).
   - Use custom CDP profiles (`--user-data-dir=.../pq-profile-XXXXXX`).
   - Never kill or disrupt PID 81813 or the user's primary IDE instance.
3. **Parse Incoming `tool_result` Blocks**:
   - When PostQode finishes executing a tool, it sends a user message containing `{ type: 'tool_result' }`.
   - Never treat `tool_result` as a new user prompt. Check `isToolResult` and transition to completion turn.
4. **Guards Against Infinite Loops**:
   - If assistant history already contains `attempt_completion`, the mock MUST return `finish_reason: 'stop'` immediately.
   - Do not re-stream tool calls or completions once a task has completed.
5. **Always Dismiss Modal Overlays**:
   - When opening modals (Rules, Workflows, Skills), always click the close button (`✕`) before finishing the scenario so subsequent tests do not encounter an obstructed UI.
6. **Target the Chat Webview, Not Configuration**:
   - In VS Code, PostQode registers multiple webviews. Always use `frameLocator('iframe.webview').last()` to interact with PostQode Chat (x=1141) rather than the left workspace configuration view (x=48).
7. **Preserve Test Fixtures in `server/postqode-test/fixtures/`**:
   - Never store permanent golden fixtures in `data/`. The `data/` folder is git-ignored and cleared routinely by developers. All permanent golden fixtures MUST reside in `server/postqode-test/fixtures/live-recordings/`.

---

## The 6 Dimensions of Validation: What to Validate

When designing test assertions, ensure coverage across these six concrete dimensions:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1. Webview DOM & Cards      │ Action buttons, dropdowns, syntax blocks, pills│
├─────────────────────────────┼───────────────────────────────────────────────┤
│ 2. Tool Calls & Signatures  │ Tool names, required JSON arguments, schemas  │
├─────────────────────────────┼───────────────────────────────────────────────┤
│ 3. Physical Filesystem      │ fs.existsSync, content matches, directory tree│
├─────────────────────────────┼───────────────────────────────────────────────┤
│ 4. Security & Credentials   │ SecretStorage isolation, zero plaintext keys  │
├─────────────────────────────┼───────────────────────────────────────────────┤
│ 5. Processes & Terminal     │ Command execution, subprocess exit codes, stdout│
├─────────────────────────────┼───────────────────────────────────────────────┤
│ 6. Task State & Parity      │ api_conversation_history.json & ui_messages   │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1. Webview DOM & Cards
- **Action Buttons**: Confirm buttons like `"Condense Conversation"`, `"Start New Task with Context"`, `"Run Command"`, and `"Approve"` render in the DOM.
- **Interactive Options**: For `ask_followup_question`, assert choice buttons appear and can be clicked.
- **Compaction Banners**: Confirm context truncation notices appear after history pruning.
- **Thinking Blocks**: Expandable `<think>` blocks render with collapsible reasoning details.

### 2. Tool Calls & Signatures
Confirm exact native PostQode tool names and argument objects:
```js
// Native PostQode Tools Reference:
- write_to_file({ path, content })
- replace_in_file({ path, diff })
- execute_command({ command, requires_approval })
- new_task({ context })
- condense({ context })
- ask_followup_question({ question, options })
- new_rule({ path, content })
- new_global_rule({ path, content })
- new_workflow({ path, content })
- new_global_workflow({ path, content })
- use_skill({ skill, parameters })
- attempt_completion({ result })
```

### 3. Physical Filesystem Mutations
Never assume a tool worked just because the UI said so. Verify the disk:
```js
const filePath = path.join(this.workspaceDir, 'hello.py');
const fileExists = fs.existsSync(filePath);
const fileContent = fileExists ? fs.readFileSync(filePath, 'utf8') : '';
step.assertions.push({
  name: 'Phase 4 [Side Effect]: hello.py created with valid print statement',
  passed: fileExists && fileContent.includes('Hello from PostQode'),
});
```

### 4. Security & Credential Boundaries
Assert that third-party provider keys (Anthropic, OpenRouter, etc.) never leak:
- `settings.json` must contain 0 plaintext API keys.
- Chat webview DOM must never expose API keys.
- Keys must be stored exclusively inside VS Code `SecretStorage`.

### 5. Process & Terminal Execution
- Commands executed via `execute_command` must create a subprocess, stream stdout to the webview card, and capture exit code 0.
- Long-running background commands must provide cancellation tokens.

### 6. Task State & Parity
After task execution, native PostQode task folders in `globalStorage` contain:
- `api_conversation_history.json`: List of turns, user messages, assistant tool calls, and tool results.
- `ui_messages.json`: Array of UI message cards, reasoning blocks, and status updates.
- `task_metadata.json`: Model ID, token counts, cost, and timestamps.
Assert that the generated task history matches the expected structure.

---

## Live Data & Mock Generation Engine

The PostQode Test Lab features a **Live-to-Mock Capture & Replay Engine** that allows capturing real LLM behaviors and promoting them into permanent, deterministic mocks:

```
 ┌────────────────────────────────────────────────────────┐
 │                      LIVE RUN                          │
 │  Real Model (moonshotai/kimi-k3 / Claude via Proxy)   │
 └──────────────────────────┬─────────────────────────────┘
                            │ (Captures SSE stream + Task folder)
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │                 INTERACTIVE PROMOTION                  │
 │  Dashboard UI: "⚡ Replace Mock Baseline with Live"    │
 └──────────────────────────┬─────────────────────────────┘
                            │ (Transfers to Git-tracked Fixtures)
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │                   MOCK FIXTURE STORE                   │
 │  server/postqode-test/fixtures/live-recordings/<id>/   │
 │    ├── network_stream.json  (millisecond chunk trace) │
 │    ├── meta.json            (model, token count, cost)│
 │    └── task_artifacts/      (api history & UI messages)│
 └──────────────────────────┬─────────────────────────────┘
                            │ (Byte-for-byte playback + path adaptation)
                            ▼
 ┌────────────────────────────────────────────────────────┐
 │                      MOCK RUN                          │
 │  100% Offline, Zero Token Cost, Exact Millisecond Speed│
 └────────────────────────────────────────────────────────┘
```

### 1. How to Capture Live Data
1. Launch Test Lab: `http://localhost:3456/#/postqode-test`
2. Select **Live** mode in the execution controls.
3. Choose the target scenario (e.g. `CHAT-01`, `SLASH-02`) or select an entire module.
4. Click **▶ Run Selected**.
5. During execution, the MITM proxy (`port 3457`) intercepts:
   - Full SSE chunks with accurate TTFT (Time-To-First-Token) and chunk intervals (`timeMs`).
   - Native task storage files (`api_conversation_history.json`, `ui_messages.json`, `task_metadata.json`).
   - Saved under `data/postqode-test-runs/<runId>/live-captures/<scenarioId>/`.

### 2. How to Promote Live Data to Mock Baseline
- In the Test Lab Dashboard, look for the **"⚡ Replace All Mocks with Live"** button or click **"⚡ Replace Mock"** on individual scenarios.
- Or call the API directly:
  ```bash
  curl -X POST http://localhost:3456/api/postqode-test/promote-recording \
    -H "Content-Type: application/json" \
    -d '{"runId": "pq-run-XXXXX", "all": true}'
  ```
- Promoting transfers the recording into **`server/postqode-test/fixtures/live-recordings/<scenarioId>/`**.

### 3. Dynamic Path Adaptation during Mock Replay
Real model streams record tool calls with the session's workspace path (e.g. `write_to_file({ path: "/var/folders/.../pq-workspace-OLD/hello.py" })`).  
When replaying in Mocked mode, `replayLiveStreamIfExists` dynamically inspects the current run's sandbox workspace path and rewrites file paths on the fly:
```js
// sse-mock-scenarios.js automatically adapts paths:
replayedChunk = rawChunk.replace(new RegExp(recordedWorkspacePath, 'g'), currentSandboxWorkspacePath);
```
This guarantees that mock replays create physical files in the active sandbox without file not found errors!

### 4. Why Fixtures Are Preserved in `server/postqode-test/fixtures/`
- The root `.gitignore` contains `data/`.
- Developers frequently clean up disk space by clearing `data/` (`rm -rf data/*`).
- By keeping all 50 golden recordings in `server/postqode-test/fixtures/live-recordings/`, all baselines are tracked in Git and **never lost when `data/` is wiped**.
- The test runner checks `server/postqode-test/fixtures/live-recordings/` first, and gracefully falls back to `data/live-recordings/`.

---

## Quick Start & Execution

```bash
# 1. Start the PQ Dashboard Server & Proxy
npm start            # Backend server on http://localhost:3456 & Proxy on 3457

# 2. Open Test Lab in your browser
# Navigate to: http://localhost:3456/#/postqode-test

# 3. Trigger Test Runs via CLI:
# Run full suite (48 scenarios in mocked mode):
curl -s -X POST http://localhost:3456/api/postqode-test/run \
  -H "Content-Type: application/json" \
  -d '{"scenarios": ["all"], "mode": "mocked"}'

# Run targeted scenarios (e.g. slash commands):
curl -s -X POST http://localhost:3456/api/postqode-test/run \
  -H "Content-Type: application/json" \
  -d '{"scenarios": ["slash-01", "slash-02", "slash-08"], "mode": "mocked"}'
```

---

## Comprehensive Suite Catalog (48 Scenarios Across 10 Modules)

Every test in the 48-test suite is cataloged below with its architectural purpose, 4-phase contract, and verified side effect:

### 1. Providers & Models (6 Scenarios)
| ID | Scenario | Architectural Purpose / Meaning | Verified Side Effect |
|----|----------|---------------------------------|----------------------|
| **PROV-01** | PostQode Provider & Default Model Selection | Validates that selecting PostQode provider correctly defaults to `kimi-k3` and persists across reloads. | Config State & Model Dropdown |
| **PROV-02** | API Keys Stored as Secrets | Verifies that API keys are stored in VS Code `SecretStorage` and never in plaintext `settings.json`. | SecretStorage Credential Boundary |
| **PROV-03** | Live PostQode Model Verification | Tests genuine outbound API handshake and live token generation via PostQode Cloud *(Live Mode only)*. | Live Network Handshake |
| **PROV-08** | Plan vs Agent Mode Toggle | Proves switching between Plan and Agent mode changes permission level and tool access. | Mode Pill & System Instruction State |
| **PROV-09** | Error Handling for Invalid API Key | Verifies graceful error cards when upstream returns 401 Unauthorized without crashing IDE. | DOM Error Card & Retry Button |
| **PROV-10** | Context Window Limit Warning | Proves extension warns user when approaching model context window threshold. | Context Token Meter & Alert DOM |

### 2. GUI & Editor Integration (4 Scenarios)
| ID | Scenario | Architectural Purpose / Meaning | Verified Side Effect |
|----|----------|---------------------------------|----------------------|
| **GUI-01** | PostQode Activity Bar & Webview Mount | Proves extension registers custom activity container and secondary webview mounts cleanly. | VS Code Container & Webview Mount |
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
| **SLASH-01** | `/newtask` Command | Proves `/newtask` dispatches `new_task` tool, clears chat DOM, and initializes new session with distilled context. | Session Reset & New Task DOM |
| **SLASH-02** | `/compact` Command | Proves `/compact` dispatches `condense` tool, renders "Condense Conversation" action button, and prunes context. | Context Compaction & Banner DOM |
| **SLASH-03** | `/init` Workspace Configuration | Proves `/init` scans workspace, invokes `write_to_file`, and generates `AGENTS.md` configuration. | Filesystem Mutation: `AGENTS.md` |
| **SLASH-04** | `/newrule` Workspace Rule Creation | Proves `/newrule` creates structured, project-scoped instruction in `.postqode/rules/`. | Filesystem Mutation: `.postqode/rules/` |
| **SLASH-05** | `/globalrule` Global Rule Creation | Proves `/globalrule` creates user-wide persistent instruction in global settings. | Global User Rule Storage |
| **SLASH-06** | `/workflow` Workspace Workflow Creation | Proves `/workflow` generates multi-step automated workflow definition in `.postqode/workflows/`. | Filesystem Mutation: `.postqode/workflows/` |
| **SLASH-07** | `/globalworkflow` Global Workflow Creation | Proves `/globalworkflow` creates global reusable workflow accessible across projects. | Global Workflow Catalog |
| **SLASH-08** | `/reportbug` Diagnostic Collector | Proves `/reportbug` emits `ask_followup_question` with interactive options, gathers telemetry, and drafts bug report. | Interactive Options & Issue Draft |
| **SLASH-09** | `/deep-planning` Architecture Blueprint | Proves `/deep-planning` forces structured breakdown, architecture requirements, and milestone steps. | Deep Plan Phase Matrix |
| **SLASH-10** | `/explain-changes` Diff Inspection | Proves `/explain-changes` inspects git diff and explains all workspace modifications. | Git Diff Analysis Card |

### 10. Workflows, Rules & Skills (8 Scenarios)
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

## Troubleshooting & FAQ

| Problem | Root Cause | Permanent Solution |
| :--- | :--- | :--- |
| **Many VS Code windows opening and none closing** | Orphan processes not killed on test abort | Runner issues `pkill -9 -f pq-profile` in `afterAll` and sandbox teardown. Clean manual command: `pkill -9 -f pq-profile`. |
| **`tool_result` infinite card looping** | Extension returns `{ type: 'tool_result' }`, mock mistook it for new prompt | `parsePostQodeUserMessage` extracts tool results and `hasAttemptCompletionInHistory` terminates loop cleanly with `finish_reason: 'stop'`. |
| **Chat input not found or clicking wrong panel** | VS Code has multiple webviews (left config view at x=48 vs chat at x=1141) | `cdp-controller.js` uses `frameLocator('iframe.webview').last()` to reliably target PostQode Chat. |
| **Slash commands stuck unsubmitted** | Auto-complete suggestion popup trapped Enter key | `sendPrompt` focuses input, dispatches keyboard Enter, and verifies submission via container send button click. |
| **Modal overlay traps next test** | Rules/Workflows modal was left open | `startNewTask` and `openChatView` automatically detect and dismiss any open `✕` close button. |
| **Lost recordings when clearing `data/`** | Fixtures were stored in git-ignored `data/` | All permanent fixtures moved to `server/postqode-test/fixtures/live-recordings/`. Safe to run `rm -rf data/*` at any time! |

---

## Verification Commands

```bash
# 1. Verify backend server syntax & scenarios metadata
node -e "require('./server/postqode-test/runner'); require('./server/postqode-test/scenarios-metadata'); console.log('Backend OK');"

# 2. Verify frontend bundle build
npm run build

# 3. Check live baselines in permanent fixtures
curl -s http://localhost:3456/api/postqode-test/live-baselines | jq '{count: (.baselines | length)}'

# 4. Package complete standalone VSIX extension with all 48 test scenarios & fixtures
npm run extension:package
```
