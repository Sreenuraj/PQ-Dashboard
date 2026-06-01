# Session Behavioral Testing & Model Comparison — Requirements

> **Version:** 1.1  
> **Created:** 2026-06-01  
> **Updated:** 2026-06-01  
> **Branch:** `feature/session-testing-model-comparison`  
> **Status:** Draft  
> **Depends on:** Core PQ Dashboard v1.0 (all phases complete)

---

## 1. Overview

### 1.1 Problem

PQ Dashboard currently evaluates tasks with heuristic metrics (TUE, RD, CE, ERR) that measure *aggregate performance*. But they don't answer deeper behavioral questions:

- Did the model choose the **right tool** for the user's request?
- Did the model's output follow **structural rules** (required keywords, forbidden actions)?
- Did a multi-step task follow a **sensible execution order**?
- Did the model stay **within its allowed scope** and avoid inventing tools?

Additionally, the existing Compare view shows side-by-side metrics but doesn't include these behavioral tests — making it hard to meaningfully compare how different models *behave* on similar tasks.

### 1.2 Solution

Three interconnected features:

1. **Baseline Sessions** — Users can mark any successful task as a "baseline" — the gold-standard execution. The system extracts a benchmark set from it: all user prompts, the tool sequence, behavior contracts, and operational metrics. This becomes the reference point that behavioral tests and comparisons measure against.

2. **Session Behavioral Testing** — A per-task analysis that runs 6 deterministic test patterns against the task's event trace, producing pass/fail/warn results with evidence. When a baseline exists, tests compare the task's behavior against the baseline's known-good execution rather than relying solely on heuristic rules.

3. **Enhanced Model Comparison** — An upgraded comparison view where 2+ selected tasks are compared across both operational metrics (cost, tokens, time) and behavioral test results. When a baseline is selected, it becomes the fixed reference column that all other tasks are measured against.

### 1.3 Design Principle

All tests are **deterministic and heuristic** — no secondary LLM calls. Tests run against the event trace already stored in SQLite. Some patterns use **configurable rules** (keyword lists, allowed tool sets) that the user can customize. When a baseline session is available, the baseline's actual behavior becomes the ground truth, replacing or augmenting heuristic rules.

---

## 2. Baseline Sessions

### 2.1 Concept

A **Baseline Session** is any task that the user explicitly marks as a reference-quality execution. It represents "this is how the task *should* be done" — the right tools were called, in the right order, producing a good result.

From the baseline, the system automatically extracts a **Benchmark Set**:

| Extracted Component | What It Captures | Used By |
|-------------------|-----------------|--------|
| **Prompt Chain** | Every user message, in order, from task start to finish | Baselines page (copy-ready), reproduction |
| **Expected Tools** | The distinct set of tools the baseline session used | Pattern 1 (Tool Invocation Assertion) |
| **Tool Sequence** | The ordered list of tool calls with file paths | Pattern 3 (Multi-Step Trace Verification) |
| **Behavior Contract** | Structural properties of the baseline's output (keywords, length, code blocks) | Pattern 2 (Behavior Contract Validation) |
| **Scope Boundary** | The set of tools and file paths accessed | Pattern 4 (Scope Enforcement) |
| **Operational Metrics** | Cost, tokens, duration, errors, context usage | Enhanced Comparison (reference column) |
| **Activity Category** | The classifier's categorization of the task | Filtering and grouping |

### 2.2 Marking a Baseline

**From the Sessions view:**
1. User selects a single task (checkbox)
2. Action bar shows a new **"⚑ Set as Baseline"** button
3. On click, a modal appears:
   - Shows task summary (model, cost, status, prompt preview)
   - Asks for an optional **Baseline Name** (e.g., "Add login feature — Claude reference")
   - Asks for optional **Tags** (e.g., `coding`, `react`, `auth`)
   - Confirm button: "Create Baseline"
4. Task is marked as baseline in SQLite
5. Benchmark set is extracted and cached

**From the Timeline/Investigate/Eval views:**
- A **"⚑ Set as Baseline"** button in the view header (same flow)

**Constraints:**
- Only tasks with status `completed` can be baselines (you don't want a failed/interrupted task as reference)
- A task can be both a baseline AND a regular task — marking it doesn't remove it from normal views
- Multiple baselines can exist — one per "type" of task
- Baselines can be unmarked/deleted from the Baselines page

### 2.3 Benchmark Set — Data Model

```typescript
interface Baseline {
  id: string;                    // Same as the task_id
  name: string;                  // User-given name
  tags: string[];                // User-defined tags for filtering
  created_at: number;            // When the baseline was created
  task_id: string;               // Source task ID
  model_id: string;              // Model used in baseline
  source: string;                // IDE source
  activity_category: string;     // From classifier
}

interface BenchmarkSet {
  baseline_id: string;
  
  // Prompt Chain — every user message in order
  prompts: Array<{
    index: number;               // 0-based order
    text: string;                // Full prompt text
    ts: number;                  // Timestamp
    response_preview: string;    // First 300 chars of agent response after this prompt
    tools_after: string[];       // Tools called between this prompt and the next
  }>;
  
  // Expected tool set
  expected_tools: string[];      // Distinct tools used
  
  // Ordered tool sequence with context
  tool_sequence: Array<{
    index: number;
    tool_name: string;
    file_path: string | null;    // If the tool operated on a file
    command: string | null;      // If it was a command execution
  }>;
  
  // Auto-derived behavior contract
  behavior_contract: {
    has_code_block: boolean;
    output_keywords: string[];   // Top keywords from baseline's final output
    output_min_length: number;
    output_max_length: number;
    forbidden_phrases: string[]; // Default empty
  };
  
  // Operational reference metrics
  reference_metrics: {
    cost: number;
    tokens_in: number;
    tokens_out: number;
    cache_reads: number;
    duration: number;
    api_calls: number;
    tool_calls: number;
    error_count: number;
    has_context_reset: boolean;
  };
}
```

### 2.4 SQLite Schema — New Tables

```sql
CREATE TABLE IF NOT EXISTS baselines (
  id TEXT PRIMARY KEY,              -- Same as task_id
  task_id TEXT NOT NULL,
  name TEXT,                        -- User-given name
  tags TEXT,                        -- JSON array of tag strings
  model_id TEXT,
  source TEXT,
  activity_category TEXT,
  created_at INTEGER,
  
  -- Cached benchmark set (JSON blobs for fast retrieval)
  prompts_json TEXT,                -- JSON: Array of prompt objects
  expected_tools_json TEXT,         -- JSON: Array of tool names
  tool_sequence_json TEXT,          -- JSON: Array of {tool, path, command}
  behavior_contract_json TEXT,      -- JSON: Contract rules
  reference_metrics_json TEXT,      -- JSON: Operational metrics snapshot
  
  FOREIGN KEY (task_id) REFERENCES tasks(id)
);

CREATE INDEX IF NOT EXISTS idx_baselines_category ON baselines(activity_category);
CREATE INDEX IF NOT EXISTS idx_baselines_model ON baselines(model_id);
```

### 2.5 Prompt Chain Extraction

The most valuable output of a baseline is the **prompt chain** — every user message from start to finish. This lets users reproduce the exact task with a different model.

**Extraction logic:**

1. Walk events in chronological order (`ts ASC`)
2. Collect every event where:
   - `type = 'say'` AND `sub_type = 'text'` AND the event is a user message (first `text` event before an `api_req_started`)
   - OR `sub_type = 'user_feedback'` (mid-task corrections)
3. For each prompt, also capture:
   - The agent's response (next `text` event after the prompt's `api_req_started`)
   - The tools called between this prompt and the next prompt
4. Store as an ordered array in `prompts_json`

**Edge case: Single-prompt tasks**
- Most coding tasks have just one prompt (the `first_message`)
- Multi-turn tasks (debugging, iteration) will have multiple prompts
- The extraction captures both scenarios

### 2.6 Baselines Page (`#/baselines`)

A dedicated dashboard view showing all baseline sessions.

```
┌─────────────────────────────────────────────────────────────────────┐
│  BASELINES                                            [ + New ]    │
│  Reference sessions for behavioral testing & model comparison      │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─ Add login feature — Claude reference ──────── coding ─────┐    │
│  │                                                             │    │
│  │  Model: anthropic/claude-sonnet-4  │  Cost: $0.23           │    │
│  │  Duration: 4m 12s  │  Tools: 14  │  Errors: 0              │    │
│  │  Source: VS Code Insiders  │  Created: Jun 1, 2026          │    │
│  │  Tags: [coding] [react] [auth]                              │    │
│  │                                                             │    │
│  │  PROMPT CHAIN (3 prompts)                                   │    │
│  │  ┌──────────────────────────────────────────────────────┐   │    │
│  │  │ Prompt 1 of 3                              [Copy 📋] │   │    │
│  │  │                                                      │   │    │
│  │  │ Add a login page to the React app using Firebase      │   │    │
│  │  │ authentication. Use the existing theme colors and     │   │    │
│  │  │ add form validation with error messages.              │   │    │
│  │  │                                                      │   │    │
│  │  │ Agent used: readFile × 3, editedExistingFile × 2     │   │    │
│  │  ├──────────────────────────────────────────────────────┤   │    │
│  │  │ Prompt 2 of 3                              [Copy 📋] │   │    │
│  │  │                                                      │   │    │
│  │  │ The error message div is not centered. Also add a     │   │    │
│  │  │ "forgot password" link below the form.                │   │    │
│  │  │                                                      │   │    │
│  │  │ Agent used: readFile × 1, editedExistingFile × 1     │   │    │
│  │  ├──────────────────────────────────────────────────────┤   │    │
│  │  │ Prompt 3 of 3                              [Copy 📋] │   │    │
│  │  │                                                      │   │    │
│  │  │ Add unit tests for the login component using Jest.    │   │    │
│  │  │                                                      │   │    │
│  │  │ Agent used: newFileCreated × 1, command × 1 (npm test)│   │    │
│  │  └──────────────────────────────────────────────────────┘   │    │
│  │                                                             │    │
│  │  [Copy All Prompts]  [View Timeline]  [Test Against This]   │    │
│  │  [Compare Models]  [Delete Baseline]                        │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
│  ┌─ Fix pagination bug — GPT reference ──────── debugging ────┐    │
│  │  ...                                                        │    │
│  └─────────────────────────────────────────────────────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Page features:**

| Feature | Description |
|---------|-------------|
| **Prompt chain display** | Each prompt shown in a card with copy button, agent action summary between prompts |
| **Copy All Prompts** | Copies all prompts as a numbered list to clipboard for re-use in another model |
| **Copy individual prompt** | Copy a single prompt to clipboard |
| **View Timeline** | Deep-link to the baseline task's timeline view |
| **Test Against This** | Navigate to session selector with this baseline pre-selected as reference |
| **Compare Models** | Navigate to enhanced compare with this baseline as the reference column |
| **Delete Baseline** | Remove baseline (doesn't delete the task, just unmarks it) |
| **Search & Filter** | Search by name/tags, filter by model, category, date |
| **Benchmark summary** | Expandable section showing extracted tools, sequence, and auto-derived contract |

### 2.7 How Baselines Feed into Testing

When a user runs behavioral tests on a task, they can optionally select a baseline to test against:

| Pattern | Without Baseline | With Baseline |
|---------|-----------------|---------------|
| **Tool Invocation (TIA)** | Heuristic keyword→tool mapping | Compare against baseline's `expected_tools` — exact tool set match |
| **Behavior Contract (BCV)** | Auto-inferred from activity category | Compare against baseline's `behavior_contract` — same keywords, same structure |
| **Trace Verification (MTV)** | Generic rules (read before edit) | Compare against baseline's `tool_sequence` — same order of operations |
| **Scope Enforcement (BSE)** | Known tool registry | Compare against baseline's scope — same tools, same file paths |
| **Error Recovery (ERC)** | Generic analysis | Compare error count and recovery strategy against baseline (should be ≤ baseline errors) |
| **Context Efficiency (CEC)** | Generic thresholds | Compare context usage against baseline (should be ≤ baseline context %) |

This dramatically improves test accuracy — instead of guessing what tools should be used, you *know* from a proven execution.

### 2.8 How Baselines Feed into Comparison

In the Enhanced Compare view:
- If a baseline is selected, it becomes the **fixed leftmost column** labeled "⚑ BASELINE"
- All other tasks are compared against it with delta indicators:
  - Cost: `$0.31 (+35%)` in red, or `$0.18 (-22%)` in green
  - Duration: `6m 30s (+55%)` or `2m 45s (-35%)`
  - Behavioral scores shown as delta from baseline
- A **"Baseline Match %"** score at the top: how closely this task replicated the baseline's behavior

### 2.9 Workflow: Testing a New Model Against a Baseline

```mermaid
flowchart TD
    A["User has a successful task<br/>(e.g., Claude built login page)"] --> B["Mark as Baseline<br/>⚑ Set as Baseline"]
    B --> C["System extracts Benchmark Set<br/>(prompts, tools, sequence, contract)"]
    C --> D["Baselines page shows prompts<br/>with Copy buttons"]
    D --> E["User copies prompts and runs<br/>same task in different model<br/>(e.g., GPT-5.4)"]
    E --> F["New task appears in Sessions"]
    F --> G{"Choose action"}
    G -->|"Test against baseline"| H["Session Test view<br/>with baseline comparison"] 
    G -->|"Compare"| I["Deep Compare view<br/>baseline as reference column"]
    H --> J["See pass/fail for each pattern<br/>measured against baseline's behavior"]
    I --> K["Side-by-side: baseline vs new task<br/>with delta indicators"]
```

## 2. Session Behavioral Testing

### 2.1 Test Patterns

#### Pattern 1: Tool Invocation Assertion (TIA)

**What it tests:** For a given user request, did the agent call the *correct* tool(s)?

**Why it matters:** An answer can sound plausible while having used the wrong tool entirely. This checks the *decision* (which tool ran), not the final text.

**How it works:**

1. Extract the first user message (`first_message`) from the task.
2. Apply keyword→tool mapping rules to determine **expected tools**:

   | User Message Keywords | Expected Tool(s) |
   |----------------------|-------------------|
   | "read", "show", "view", "look at", "open" + file path | `readFile`, `Read`, `read_file` |
   | "edit", "modify", "change", "update", "fix" + file path | `editedExistingFile`, `Edit`, `write_to_file`, `apply_diff` |
   | "create", "new file", "scaffold", "generate" | `newFileCreated`, `Write`, `write_to_file` |
   | "run", "execute", "npm", "pip", "build", "test" | `command`, `Bash`, `execute_command` |
   | "search", "find", "grep", "look for" | `searchFiles`, `Grep`, `GrepTool`, `search_files` |
   | "list files", "directory", "ls" | `listFilesRecursive`, `Glob`, `list_files` |
   | "browser", "web", "url", "page" | `postqode_browser_agent` |

3. Walk the task's events to find which tools were **actually called** (`tool_name` column).
4. Score:
   - **✅ PASS** — At least one expected tool was called.
   - **⚠ WARN** — Expected tools were called but unexpected tools were also used (possible over-reach).
   - **❌ FAIL** — None of the expected tools were called. The agent chose entirely wrong tools.
   - **⏭ SKIP** — No tool expectation could be inferred from the user message.

5. Evidence: List of expected vs. actual tools, with the matching/missing ones highlighted.

**Configuration:** Users can customize the keyword→tool mapping via a `test-rules.yaml` file or an in-dashboard editor. Default rules are built-in.

---

#### Pattern 2: Behavior Contract Validation (BCV)

**What it tests:** Does the final agent output follow agreed-upon behavioral rules — required fields, must-include keywords, forbidden phrases — without requiring exact string matching?

**Why it matters:** LLM wording changes every run. Contracts check flexible structural rules rather than one frozen expected response.

**How it works:**

1. Extract the agent's final output from:
   - The `completion_result` event's `content_preview` or `response_text`
   - If no completion result, use the last `text` type event from the assistant

2. Apply **contract rules** (configurable):

   | Rule Type | Example | Check |
   |-----------|---------|-------|
   | `must_include` | `["function", "return"]` | Output must contain ALL of these keywords |
   | `must_include_any` | `["error", "warning", "issue"]` | Output must contain AT LEAST ONE |
   | `forbidden` | `["TODO", "placeholder", "lorem"]` | Output must NOT contain any of these |
   | `min_length` | `100` | Output must be at least N characters |
   | `max_length` | `5000` | Output must not exceed N characters |
   | `pattern` | `"^(import|from|const|let|var)"` | Output must match this regex |
   | `has_code_block` | `true` | Output must contain at least one code block (` ``` `) |

3. Score:
   - **✅ PASS** — All contract rules satisfied.
   - **⚠ WARN** — Some optional rules failed (configurable severity per rule).
   - **❌ FAIL** — One or more required rules violated.
   - **⏭ SKIP** — No contract rules defined, or no output captured.

4. Evidence: Table showing each rule, whether it passed/failed, and the matched/missing content.

**Contract Sources:**
- **Auto-inferred:** Based on task `activity_category`. E.g., `coding` tasks auto-get a `has_code_block: true` rule; `debugging` tasks get `must_include_any: ["fix", "resolved", "error"]`.
- **User-defined:** Custom contracts per task type or globally via `test-rules.yaml`.

---

#### Pattern 3: Multi-Step Trace Verification (MTV)

**What it tests:** For workflows requiring more than one tool, did the agent follow a *sensible* order of steps?

**Why it matters:** UI tests see screens. This inspects the **sequence** of tool calls inside the trace — something no classic test covers.

**How it works:**

1. Extract the ordered list of tool calls from the task's events (preserving chronological order).
2. Apply **sequence rules** — each rule defines an expected order:

   | Sequence Rule | Description | Expected Order |
   |--------------|-------------|---------------|
   | `read_before_edit` | Must read a file before editing it | `readFile` → `editedExistingFile` (on same path) |
   | `think_before_act` | Reasoning should precede tool calls | `reasoning` event before first `tool` event |
   | `test_after_edit` | Should test after making code changes | `editedExistingFile` → `command` (with test-like content) |
   | `no_blind_writes` | Shouldn't write to a file never read | No `editedExistingFile` on path X without prior `readFile` on path X |
   | `search_before_create` | Check if file exists before creating | `searchFiles`/`listFiles` before `newFileCreated` |

3. Score:
   - **✅ PASS** — All applicable sequence rules were followed.
   - **⚠ WARN** — Some sequences were out of order but the task still completed.
   - **❌ FAIL** — Critical sequence violations detected (e.g., edited a file that was never read).
   - **⏭ SKIP** — Task had < 2 tool calls, sequence verification not applicable.

4. Evidence: For each rule, show the actual tool sequence and where the violation occurred (if any).

**Data source:** `events` table, ordered by `ts ASC`, filtered to `sub_type = 'tool'` and `sub_type = 'reasoning'`.

---

#### Pattern 4: Boundary/Scope Enforcement (BSE)

**What it tests:** Did the agent only use tools it is *allowed* to use and avoid out-of-scope actions?

**Why it matters:** Models sometimes invent tool names, call tools that don't exist, or attempt actions outside their sandbox. This catches scope creep and fabricated tool calls.

**How it works:**

1. Build a **known tool registry** from the full event history across all tasks:
   - Collect all distinct `tool_name` values from the `events` table
   - This establishes the "real" tool universe
   - Additionally maintain a built-in set of known PostQode tools (from classifier.js)

2. For the current task, check each tool call against:
   - **Allowed tool set**: The union of known tools (from registry + built-in list)
   - **Scope rules** (configurable):

   | Scope Rule | Description |
   |-----------|-------------|
   | `known_tools_only` | Every tool_name must exist in the known registry |
   | `no_mcp_unless_approved` | MCP tools (`mcp__*`) only allowed if MCP was explicitly enabled |
   | `no_destructive_commands` | Commands matching `rm -rf`, `drop table`, `format` etc. should be flagged |
   | `workspace_only` | File operations should be within the workspace (check `operationIsLocatedInWorkspace` if available) |
   | `max_tool_calls` | Flag tasks with excessive tool calls (configurable threshold, default: 100) |

3. Score:
   - **✅ PASS** — All tool calls are within scope.
   - **⚠ WARN** — Unknown tools detected but they look like valid MCP extensions.
   - **❌ FAIL** — Fabricated tool names, destructive commands, or out-of-workspace operations detected.
   - **⏭ SKIP** — Task had no tool calls.

4. Evidence: List of flagged tool calls with the reason (unknown, destructive, out-of-scope).

---

#### Pattern 5: Error Recovery Coherence (ERC) *(Additional)*

**What it tests:** When errors occurred, did the agent's recovery attempt make sense? Did it try a different approach or just repeat the same failing action?

**Why it matters:** A model that blindly retries the same failed tool call wastes tokens and time. Good agents adapt their strategy after failures.

**How it works:**

1. Find all error events in the task trace.
2. For each error, look at what the agent did **before** the error and **after** the error.
3. Check:
   - Did the agent retry the exact same tool with the same arguments? → **Blind retry** (bad)
   - Did the agent try a different tool or different arguments? → **Adaptive recovery** (good)
   - Did the agent give up after the error? → **Abandonment** (neutral/bad depending on context)
   - Did the agent acknowledge the error in reasoning before retrying? → **Reflective recovery** (best)

4. Score:
   - **✅ PASS** — All error recoveries were adaptive or reflective.
   - **⚠ WARN** — Some blind retries detected but task still completed.
   - **❌ FAIL** — Multiple blind retries with no strategy change.
   - **⏭ SKIP** — No errors in this task.

---

#### Pattern 6: Context Efficiency Compliance (CEC) *(Additional)*

**What it tests:** Did the agent manage its context window responsibly, or did it bloat the context with unnecessary reads/redundant tool calls?

**Why it matters:** Context window waste directly impacts cost and can cause context overflow mid-task.

**How it works:**

1. Analyze `context_pct` progression across the task's API calls.
2. Flag:
   - **Rapid context growth**: Context % jumps > 20% between consecutive API calls
   - **Context ceiling**: Context > 80% of model's window → risk of truncation
   - **Redundant reads**: Same file read multiple times without edits in between
   - **Context condensation**: `has_context_reset = 1` → context was truncated mid-task

3. Score as percentage of "context budget" used efficiently.

---

### 2.2 Test Results Data Model

```typescript
interface TestResult {
  pattern: string;           // 'tia' | 'bcv' | 'mtv' | 'bse' | 'erc' | 'cec'
  label: string;             // Human-readable name
  status: 'pass' | 'warn' | 'fail' | 'skip';
  score: number;             // 0-100
  evidence: Evidence[];      // Detailed findings
  details: string;           // Summary explanation
}

interface Evidence {
  type: 'expected' | 'actual' | 'violation' | 'info';
  label: string;
  value: string;
  severity?: 'critical' | 'warning' | 'info';
}

interface TaskTestSuite {
  task_id: string;
  run_ts: number;
  overall_score: number;     // Weighted average of all pattern scores
  results: TestResult[];
}
```

### 2.3 Configuration — `test-rules.yaml`

```yaml
# PQ Dashboard — Behavioral Test Rules

tool_invocation:
  enabled: true
  custom_mappings:
    # keyword patterns → expected tools
    - keywords: ["deploy", "push to prod"]
      expected_tools: ["command"]
      expected_commands: ["git push", "npm run deploy"]

behavior_contracts:
  enabled: true
  auto_infer: true    # Auto-generate contracts from activity_category
  custom_contracts:
    coding:
      must_include: []
      has_code_block: true
    debugging:
      must_include_any: ["fix", "resolved", "found", "issue", "root cause"]
    testing:
      must_include_any: ["test", "pass", "fail", "assert"]

trace_verification:
  enabled: true
  rules:
    read_before_edit: true
    think_before_act: true
    test_after_edit: false      # Optional — not all tasks need tests
    no_blind_writes: true
    search_before_create: false

scope_enforcement:
  enabled: true
  max_tool_calls: 100
  no_destructive_commands: true
  destructive_patterns:
    - "rm -rf /"
    - "drop table"
    - "format c:"
    - "sudo rm"
  workspace_only: true

error_recovery:
  enabled: true
  max_blind_retries: 2         # Flag if more than N identical retries

context_efficiency:
  enabled: true
  warn_threshold: 70           # Warn if context > 70%
  critical_threshold: 90       # Fail if context > 90%
```

---

## 3. Enhanced Model Comparison

### 3.1 Current State

The existing Compare view (`#/compare?tasks=A,B`) shows side-by-side columns with:
- Model name, status, start date
- Auto-eval scores (TUE, RD, CE, ERR, Overall)
- Cost bar, duration bar, error count
- Task prompt text

**Limitations:**
- No behavioral test results
- No token breakdown
- No context condensation info
- No cache efficiency comparison
- No visual diff of tool sequences
- Columns are fixed-width, hard to scan with 3+ tasks

### 3.2 Enhanced Comparison Features

#### 3.2.1 Operational Metrics Comparison (Enhanced)

All existing metrics plus:

| Metric | Source | Display |
|--------|--------|---------|
| **Cost** | `tasks.total_cost` | Bar chart + exact value |
| **Tokens In** | `tasks.total_tokens_in` | Bar chart |
| **Tokens Out** | `tasks.total_tokens_out` | Bar chart |
| **Cache Reads** | `tasks.total_cache_reads` | Bar + cache hit rate % |
| **Duration** | `tasks.duration` | Bar chart + formatted time |
| **Error Count** | `tasks.error_count` | Count with severity coloring |
| **API Calls** | `tasks.api_call_count` | Count |
| **Tool Calls** | `tasks.tool_call_count` | Count |
| **Context Condensation** | `tasks.has_context_reset` | Yes/No badge |
| **Task Status** | `tasks.status` | Completed / Interrupted / Error badge |
| **Reasoning** | `tasks.has_reasoning` | Yes/No with reasoning event count |
| **Activity Category** | `tasks.activity_category` | Category badge |
| **Focus Chain** | `tasks.focus_chain_completion` | Completion % bar |
| **Retry Cycles** | `tasks.retry_cycles` | Count |

#### 3.2.2 Behavioral Test Comparison

For each selected task, run all 6 test patterns and display results in a comparison matrix:

```
                    Task A (Claude 4)    Task B (GPT-5.4)     Task C (Gemini 2.5)
                    ─────────────────    ─────────────────     ──────────────────
Tool Assertion      ✅ PASS (95%)        ⚠ WARN (70%)          ❌ FAIL (20%)
Behavior Contract   ✅ PASS (100%)       ✅ PASS (90%)          ⚠ WARN (65%)
Trace Verification  ⚠ WARN (75%)        ✅ PASS (100%)         ✅ PASS (85%)
Scope Enforcement   ✅ PASS (100%)       ✅ PASS (100%)         ❌ FAIL (30%)
Error Recovery      ✅ PASS (100%)       ⚠ WARN (60%)          ✅ PASS (80%)
Context Efficiency  ⚠ WARN (70%)        ✅ PASS (95%)          ✅ PASS (90%)
                    ─────────────────    ─────────────────     ──────────────────
BEHAVIORAL SCORE    90%                  86%                   62%
```

Each cell is clickable → expands to show the full evidence for that test on that task.

#### 3.2.3 Tool Sequence Visual Diff

Show the ordered tool sequences side-by-side for each task, with color-coded alignment:

```
Task A                          Task B
─────                           ─────
readFile (main.js)              readFile (main.js)         ← Same
readFile (utils.js)             searchFiles (*.js)         ← Different approach
editedExistingFile (main.js)    editedExistingFile (main.js)  ← Same
command (npm test)              —                          ← Missing in B
```

#### 3.2.4 Comparison Summary Panel

At the top, a summary panel with:
- **Winner badge**: Which task scored highest overall (behavioral + operational)
- **Key differences**: Bullet points highlighting the most significant differences
- **Cost efficiency**: Cost per behavioral score point (lower is better)

### 3.3 Selection Flow

From the Sessions view:
1. User checks 1 task checkbox:
   - **⚑ Set as Baseline** — Mark as baseline (only if task is `completed`)
   - **Test Session** — Run behavioral tests on this task
   - **Investigate** / **Timeline** / **Evaluate** — Existing buttons
2. User checks 2+ task checkboxes:
   - **Quick Compare** — Opens existing comparison view (fast, metrics only)
   - **Deep Compare** — Opens enhanced comparison with behavioral tests (runs test suite, slower)
   - **Deep Compare vs Baseline** — Opens baseline picker, then enhanced compare with baseline as reference column
3. From the Baselines page:
   - **Test Against This** — Opens session picker, then runs tests on selected task against this baseline
   - **Compare Models** — Opens session multi-picker, then deep compare with this baseline as reference

### 3.4 Standalone Session Test View

A new view at `#/test?task=ID` or `#/test?task=ID&baseline=BID` for single-task behavioral testing:
- Shows the task summary (model, cost, duration, prompt)
- **Baseline selector**: Dropdown to pick a baseline (or "None — use heuristic rules")
- Runs all 6 test patterns (against baseline if selected, else heuristic)
- Displays results as an expandable accordion per pattern
- Each pattern shows: status badge, score, evidence table, raw event data
- When baseline is selected, evidence shows delta from baseline ("baseline used readFile 3x, this task used 5x")
- A "Re-run with Custom Rules" button to load/edit `test-rules.yaml` overrides inline
- Link to "Compare with another task" → navigates to enhanced compare

---

## 4. API Endpoints (New)

| Method | Endpoint | Description |
|--------|----------|-------------|
| **Baselines** | | |
| `GET` | `/api/baselines` | List all baselines (with optional `?category=` and `?model=` filters) |
| `GET` | `/api/baselines/:id` | Get a single baseline with full benchmark set |
| `POST` | `/api/baselines` | Create a baseline from a task. Body: `{ task_id, name, tags }` |
| `PUT` | `/api/baselines/:id` | Update baseline name/tags |
| `DELETE` | `/api/baselines/:id` | Delete a baseline (doesn't delete the task) |
| `GET` | `/api/baselines/:id/prompts` | Get just the prompt chain (lightweight, for copy) |
| `POST` | `/api/baselines/:id/re-extract` | Re-extract benchmark set from the source task |
| **Testing** | | |
| `GET` | `/api/tasks/:id/test` | Run all behavioral tests. Optional `?baseline=ID` for baseline-aware testing |
| `GET` | `/api/tasks/:id/test/:pattern` | Run a specific test pattern (`tia`, `bcv`, `mtv`, `bse`, `erc`, `cec`). Optional `?baseline=ID` |
| **Comparison** | | |
| `POST` | `/api/tasks/compare` | Body: `{ task_ids, baseline_id?, include_tests }` — Fetch comparison data with optional baseline reference |
| **Config** | | |
| `GET` | `/api/test-rules` | Get current test rules configuration |
| `PUT` | `/api/test-rules` | Update test rules configuration |
| `GET` | `/api/tools/registry` | Get the known tool universe (all distinct tool_names from events) |

---

## 5. Backend Implementation

### 5.1 New Files

| File | Purpose |
|------|---------|
| `server/baselines/extract.js` | Benchmark set extractor — tools, sequence, contract from task events |
| `server/baselines/prompts.js` | Prompt chain extractor — walks events to find all user messages |
| `server/routes/baselines.js` | Express routes for baseline CRUD + prompt retrieval |
| `server/testing/index.js` | Test runner orchestrator — runs all patterns for a task |
| `server/testing/tia.js` | Tool Invocation Assertion implementation |
| `server/testing/bcv.js` | Behavior Contract Validation implementation |
| `server/testing/mtv.js` | Multi-Step Trace Verification implementation |
| `server/testing/bse.js` | Boundary/Scope Enforcement implementation |
| `server/testing/erc.js` | Error Recovery Coherence implementation |
| `server/testing/cec.js` | Context Efficiency Compliance implementation |
| `server/testing/rules.js` | Test rules loader/saver (YAML) |
| `server/routes/testing.js` | Express routes for test endpoints |
| `test-rules.yaml` | Default test rules configuration file |

### 5.2 Modified Files

| File | Changes |
|------|---------|
| `server/index.js` | Register new `/api/baselines`, `/api/tasks/:id/test`, and `/api/test-rules` routes |
| `server/cache/db.js` | Add `baselines` table to schema, add baseline CRUD helpers |
| `server/routes/tasks.js` | Add `/compare` POST endpoint |
| `src/js/app.js` | Register new `baselines`, `test`, and `deepcompare` routes |
| `src/js/api.js` | Add `baselines()`, `createBaseline()`, `testTask()`, `compareDeep()`, `getTestRules()` API methods |
| `src/js/views/sessions.js` | Add "⚑ Set as Baseline", "Test Session", and "Deep Compare" buttons to action bar |
| `src/js/views/compare.js` | Enhance with behavioral test results, token breakdown, context info |
| `src/index.html` | Add nav items for Baselines + Test under new "Testing" sidebar section |

### 5.3 Frontend Files (New)

| File | Purpose |
|------|---------|
| `src/js/views/baselines.js` | Baselines page — list, prompt chains, copy, manage |
| `src/js/views/test.js` | Session Behavioral Test view (single task, optional baseline) |
| `src/js/views/deep-compare.js` | Enhanced comparison view with behavioral tests + baseline reference |

---

## 6. UI Design

### 6.1 Session Test View (`#/test?task=ID`)

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Sessions    TEST SESSION    [task_id]    claude-sonnet-4      │
│ Behavioral testing against task event trace                     │
├─────────────────────────────────────────────────────────────────┤
│ Model: claude-sonnet-4  │ Cost: $0.23  │ Duration: 4m 12s      │
│ Status: ✓ Completed     │ Tools: 14    │ Errors: 2             │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  BEHAVIORAL SCORE                                               │
│  ████████████████████████████░░░░  87%                          │
│                                                                 │
│  ┌─ Tool Invocation Assertion ─── ✅ PASS (95%) ──────────┐    │
│  │  Expected: readFile, editedExistingFile                 │    │
│  │  Actual:   readFile ✓, editedExistingFile ✓, command ✓  │    │
│  │  ▸ Show full evidence                                   │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─ Behavior Contract ─────────── ✅ PASS (100%) ─────────┐    │
│  │  ✓ has_code_block: found 3 code blocks                  │    │
│  │  ✓ min_length: 847 chars (min: 100)                     │    │
│  │  ✓ forbidden: no forbidden phrases found                │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─ Trace Verification ────────── ⚠ WARN (75%) ──────────┐    │
│  │  ✓ read_before_edit: 3/3 files read before edit         │    │
│  │  ⚠ think_before_act: no reasoning before first tool     │    │
│  │  ✓ no_blind_writes: all edits on previously read files  │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                 │
│  ┌─ Scope Enforcement ─────────── ✅ PASS (100%) ─────────┐    │
│  │  ✓ All 14 tool calls use known tools                    │    │
│  │  ✓ No destructive commands detected                     │    │
│  │  ✓ All operations within workspace                      │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                 │
│  [ Compare with another task ]   [ Re-run with custom rules ]   │
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 Enhanced Compare View (`#/deepcompare?tasks=A,B,C`)

```
┌────────────────────────────────────────────────────────────────────────┐
│ ← Sessions    DEEP COMPARE    3 tasks selected                        │
├────────────────────────────────────────────────────────────────────────┤
│ SUMMARY: Task A (Claude) leads with 92% behavioral score at $0.23     │
├──────────────────┬──────────────────┬──────────────────────────────────┤
│                  │    Task A        │    Task B        │    Task C     │
│                  │  claude-sonnet-4 │  gpt-5.4-mini   │  gemini-2.5   │
├──────────────────┼──────────────────┼──────────────────┼───────────────┤
│ BEHAVIORAL TESTS                                                      │
├──────────────────┼──────────────────┼──────────────────┼───────────────┤
│ Tool Assertion   │  ✅ 95%          │  ⚠ 70%          │  ❌ 20%       │
│ Contracts        │  ✅ 100%         │  ✅ 90%          │  ⚠ 65%       │
│ Trace Order      │  ⚠ 75%          │  ✅ 100%         │  ✅ 85%       │
│ Scope            │  ✅ 100%         │  ✅ 100%         │  ❌ 30%       │
│ Error Recovery   │  ✅ 100%         │  ⚠ 60%          │  ✅ 80%       │
│ Context Eff.     │  ⚠ 70%          │  ✅ 95%          │  ✅ 90%       │
│ ─── SCORE ───    │  ██ 92%         │  ██ 86%          │  ██ 62%       │
├──────────────────┼──────────────────┼──────────────────┼───────────────┤
│ OPERATIONAL                                                           │
├──────────────────┼──────────────────┼──────────────────┼───────────────┤
│ Cost             │  $0.23 ████      │  $0.08 ██        │  $0.31 █████  │
│ Tokens In        │  18,420          │  12,300          │  22,100       │
│ Tokens Out       │  1,204           │  890             │  1,802        │
│ Cache Reads      │  4,200 (23%)     │  0 (0%)          │  6,100 (28%)  │
│ Duration         │  4m 12s ███      │  2m 45s ██       │  6m 30s ████  │
│ API Calls        │  8               │  6               │  12           │
│ Tool Calls       │  14              │  10              │  18           │
│ Errors           │  2               │  0               │  5            │
│ Ctx Condensation │  No              │  No              │  Yes ⚠        │
│ Status           │  ✓ Completed     │  ✓ Completed     │  ⏸ Interrupted│
│ Reasoning        │  🧠 Yes (6)      │  — No            │  🧠 Yes (3)   │
│ Retry Cycles     │  1               │  0               │  3            │
├──────────────────┼──────────────────┼──────────────────┼───────────────┤
│ TOOL SEQUENCE                                                         │
├──────────────────┼──────────────────┼──────────────────┼───────────────┤
│ 1. readFile      │  readFile        │  readFile        │  searchFiles  │
│ 2. readFile      │  readFile        │  searchFiles     │  readFile     │
│ 3. editFile      │  editFile        │  editFile        │  readFile     │
│ 4. command       │  npm test        │  —               │  editFile     │
│ ...              │                  │                  │  editFile     │
└──────────────────┴──────────────────┴──────────────────┴───────────────┘
```

---

## 7. Scoring & Weighting

### 7.1 Per-Pattern Scoring

Each pattern produces a score from 0–100:
- **PASS** = 80–100
- **WARN** = 40–79
- **FAIL** = 0–39
- **SKIP** = excluded from average

### 7.2 Overall Behavioral Score

Weighted average of non-skipped patterns:

| Pattern | Default Weight | Rationale |
|---------|---------------|-----------|
| Tool Invocation Assertion | 25% | Core decision quality |
| Behavior Contract | 15% | Output structure |
| Trace Verification | 20% | Process quality |
| Scope Enforcement | 20% | Safety-critical |
| Error Recovery | 10% | Resilience |
| Context Efficiency | 10% | Cost optimization |

Weights are configurable via the test rules settings in SQLite (editable from the dashboard UI).

### 7.3 Combined Score (for comparison)

```
Combined Score = (Behavioral Score × 0.6) + (Operational Score × 0.4)
```

Where Operational Score considers: completion (30%), cost efficiency (25%), speed (20%), error-free (25%).

---

## 8. Test Result Storage & Benchmarks History

### 8.1 Persisted Test Results

Test results are stored in SQLite for historical tracking. Each test run is uniquely identified by the combination of task, baseline (if any), model, and run date.

**Smart re-test behavior:**
- When a user clicks "Test" on a task, the system checks if a stored result exists for the same task + same baseline.
- If yes → navigate directly to the stored result page (no re-computation).
- If the user wants a different baseline (or no baseline) → run fresh tests and store as a new result.
- Users can always force a re-run from the result page ("Re-run Tests" button).

### 8.2 SQLite Schema — Test Results

```sql
CREATE TABLE IF NOT EXISTS test_results (
  id TEXT PRIMARY KEY,                -- UUID or task_id + baseline_id + timestamp hash
  task_id TEXT NOT NULL,
  baseline_id TEXT,                   -- NULL if tested without baseline
  model_id TEXT,                      -- Model used in the tested task
  model_version TEXT,                 -- Provider-specific version if available
  run_ts INTEGER NOT NULL,            -- When the test was executed
  overall_score INTEGER,              -- 0-100 weighted average
  
  -- Per-pattern results (JSON blobs)
  tia_status TEXT,                    -- 'pass' | 'warn' | 'fail' | 'skip'
  tia_score INTEGER,
  tia_evidence_json TEXT,
  bcv_status TEXT,
  bcv_score INTEGER,
  bcv_evidence_json TEXT,
  mtv_status TEXT,
  mtv_score INTEGER,
  mtv_evidence_json TEXT,
  bse_status TEXT,
  bse_score INTEGER,
  bse_evidence_json TEXT,
  erc_status TEXT,
  erc_score INTEGER,
  erc_evidence_json TEXT,
  cec_status TEXT,
  cec_score INTEGER,
  cec_evidence_json TEXT,
  
  -- Snapshot of key operational metrics at test time
  task_cost REAL,
  task_duration INTEGER,
  task_tokens_in INTEGER,
  task_tokens_out INTEGER,
  task_errors INTEGER,
  task_status TEXT,
  
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (baseline_id) REFERENCES baselines(id)
);

CREATE INDEX IF NOT EXISTS idx_test_results_task ON test_results(task_id);
CREATE INDEX IF NOT EXISTS idx_test_results_baseline ON test_results(baseline_id);
CREATE INDEX IF NOT EXISTS idx_test_results_model ON test_results(model_id);
CREATE INDEX IF NOT EXISTS idx_test_results_ts ON test_results(run_ts DESC);
```

### 8.3 Test Benchmarks Page (`#/benchmarks`)

A dedicated page showing all historical test results — the "test history" view.

```
┌───────────────────────────────────────────────────────────────────────────┐
│  TEST BENCHMARKS                                              [Export]   │
│  Historical behavioral test results across sessions and models           │
├───────────────────────────────────────────────────────────────────────────┤
│  Filters: [Model ▾] [Baseline ▾] [Category ▾] [Date Range ▾]            │
├──────┬──────────────┬──────────────┬────────┬──────┬──────┬──────────────┤
│ Date │ Task         │ Model        │ Baseline│Score│ Cost │ Status       │
├──────┼──────────────┼──────────────┼────────┼──────┼──────┼──────────────┤
│ Jun 1│ Add login... │ claude-s-4   │ ⚑ Base │ 92% │$0.23 │ ✅✅⚠✅✅⚠   │
│ Jun 1│ Add login... │ gpt-5.4-mini │ ⚑ Base │ 78% │$0.08 │ ✅⚠❌✅⚠✅   │
│ Jun 1│ Add login... │ gemini-2.5   │ ⚑ Base │ 62% │$0.31 │ ❌⚠✅❌✅✅   │
│ May 30│Fix paging...│ claude-s-4   │ — None │ 88% │$0.12 │ ✅✅✅✅⚠✅   │
│ ...  │              │              │        │      │      │              │
├──────┴──────────────┴──────────────┴────────┴──────┴──────┴──────────────┤
│ Click any row to view full test result details                           │
└───────────────────────────────────────────────────────────────────────────┘
```

**Features:**
- Filterable by model, baseline, activity category, date range
- Each row shows the 6 pattern statuses as compact icons (✅⚠❌)
- Click row → opens the stored test result detail page
- **Export** → generates an HTML report of filtered results
- Trend chart at top: overall scores over time, grouped by model
- Since results are stored with model version, you can track "is Claude 4 getting better at trace ordering across updates?"

### 8.4 HTML Report Export

Both session test results and comparison results can be exported as **self-contained HTML files**:

**Test Result Report** (`pq-test-report-<task_id>-<date>.html`):
- Task summary (model, cost, duration, status)
- Baseline info (if tested against one)
- All 6 pattern results with scores, status badges, and evidence
- Operational metrics snapshot
- Styled with inline CSS matching the dashboard theme

**Comparison Report** (`pq-compare-report-<date>.html`):
- All compared tasks in a matrix layout
- Behavioral test results per task
- Operational metrics comparison with delta bars
- Baseline reference column (if used)
- Tool sequence diff
- Winner summary

**Implementation:**
- Server-side endpoint generates HTML string using template literals
- No external dependencies — all CSS is inlined
- Browser downloads via `Content-Disposition: attachment` header
- Reports are shareable — recipients don't need PQ Dashboard installed

### 8.5 API Endpoints for Results & Export

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/test-results` | List all stored test results (with filters) |
| `GET` | `/api/test-results/:id` | Get a single stored test result |
| `DELETE` | `/api/test-results/:id` | Delete a stored test result |
| `GET` | `/api/test-results/:id/export` | Export a test result as HTML report |
| `POST` | `/api/tasks/compare/export` | Body: `{ task_ids, baseline_id? }` → Export comparison as HTML report |

---

## 9. Non-Functional Requirements

### 9.1 Performance
- Test execution for a single task must complete in < 2 seconds
- Comparison of 5 tasks with behavioral tests must complete in < 10 seconds
- Stored test results are served instantly from SQLite (no re-computation)
- HTML report generation must complete in < 3 seconds

### 9.2 Configuration
- All test rules stored in **SQLite** (editable from dashboard UI)
- Default rules seeded on first use (no config file needed)
- Rules editable from the dashboard UI via a form-based editor
- No external YAML file required (simpler setup)

### 9.3 Design
- Follow existing PQ Dashboard aesthetic (dark theme, glassmorphism, Inter font)
- Test results use consistent color coding: green (pass), amber (warn), red (fail), grey (skip)
- Expandable evidence sections to keep the UI clean
- Comparison matrix scrollable horizontally for 4+ tasks
- HTML reports styled to match dashboard theme (standalone, no external CSS)

---

## 10. Relationship to Existing Features

| Existing Feature | Relationship |
|-----------------|-------------|
| **Eval view** (`#/eval`) | Behavioral tests are a superset — eval's TUE/RD/CE/ERR scores will be shown alongside behavioral test results. No duplication. |
| **Compare view** (`#/compare`) | Enhanced compare replaces or extends the existing compare. Existing quick-compare can remain as a lightweight option. |
| **Investigate view** (`#/investigate`) | Test evidence can deep-link into Investigate for raw event inspection. |
| **Classifier** (`classifier.js`) | Activity categories feed auto-inferred behavior contracts (Pattern 2). |
| **Sessions view** (`#/sessions`) | New action bar buttons: "⚑ Set as Baseline" (1 selected, completed), "Test Session" (1 selected), and "Deep Compare" (2+ selected). |
| **Timeline view** (`#/timeline`) | "⚑ Set as Baseline" button in header for quick baseline creation. |
| **Baselines page** (`#/baselines`) | New dedicated page — shows all baselines with copy-ready prompt chains (editable before copy) and benchmark summaries. |
| **Test Benchmarks** (`#/benchmarks`) | New dedicated page — shows all stored test results with filters, trend charts, and export. |

---

## 11. Implementation Phases

### Phase 1: Baseline System
- Add `baselines` table to SQLite schema (`server/cache/db.js`)
- Build benchmark set extraction logic (`server/baselines/extract.js`)
- Build prompt chain extractor (`server/baselines/prompts.js`)
- Add baseline CRUD API endpoints (`server/routes/baselines.js`)
- Build Baselines page (`src/js/views/baselines.js`) with prompt display + copy buttons + inline editing
- Add "⚑ Set as Baseline" button to Sessions action bar and Timeline/Investigate/Eval headers
- Add "Baselines" nav item in sidebar under new "Testing" section

### Phase 2: Core Test Engine + Result Storage
- Build test runner framework (`server/testing/`)
- Implement Pattern 1 (TIA) and Pattern 4 (BSE) — simplest, pure tool-name checking
- Add baseline-aware test mode (compare against baseline's extracted tools/scope)
- Add `test_results` table to SQLite schema
- Add `/api/tasks/:id/test` endpoint with optional `?baseline=ID` param
- Implement smart redirect: check for existing results before re-running
- Build Session Test view (`#/test`) with result detail page
- Seed default test rules in SQLite on first use

### Phase 3: Advanced Patterns + Benchmarks Page
- Implement Pattern 2 (BCV) — needs output extraction + contract matching + baseline contracts
- Implement Pattern 3 (MTV) — needs sequence analysis with fuzzy path matching + baseline sequence diff
- Implement Pattern 5 (ERC) — needs error-adjacency analysis
- Implement Pattern 6 (CEC) — needs context_pct progression analysis + baseline reference
- Build Test Benchmarks page (`#/benchmarks`) — historical test results with filters and trend charts

### Phase 4: Enhanced Comparison
- Build Deep Compare view (`#/deepcompare`)
- Add baseline as fixed reference column with delta indicators
- Support multi-baseline comparison (multiple baselines as reference columns from stored data)
- Add all operational metrics to comparison
- Add behavioral test matrix to comparison
- Add tool sequence visual diff
- Add summary panel with winner badge and "Baseline Match %"

### Phase 5: Export, Config & Polish
- Build HTML report export for test results and comparison results
- Add `/api/test-results/:id/export` and `/api/tasks/compare/export` endpoints
- Build test rules editor UI (SQLite-backed, form-based)
- Add custom contract builder
- Baseline management (edit name/tags, re-extract benchmark, prompt editing)
- Performance optimization for large comparisons

---

## 12. Resolved Design Decisions

> These questions were raised during requirements drafting and resolved with stakeholder input.

| # | Question | Decision | Impact |
|---|----------|----------|--------|
| 1 | **Rule persistence** — YAML file or SQLite? | **SQLite** — easier to edit from dashboard UI, no external file to manage. Default rules seeded on first use. | No `test-rules.yaml` file needed. Rules table in SQLite. Form-based editor in UI. |
| 2 | **Path matching for MTV** — exact or fuzzy? | **Fuzzy-first with exact preferred** — try exact path match first; if no match, fall back to fuzzy (same filename in different directory, basename match). This catches refactoring scenarios where files move. | Pattern 3 implementation uses a two-pass matching algorithm. |
| 3 | **Historical test results** — store or compute? | **Store in SQLite** — each result uniquely identified by task + baseline + model + run timestamp. New `test_results` table. New **Test Benchmarks page** (`#/benchmarks`) to browse history. | New table, new page, new API endpoints for results. |
| 4 | **Comparison grouping** — aggregate or individual? | **Individual only** — compare specific tasks, not model aggregates. Keeps the UI focused and the data meaningful. | No aggregate comparison mode. |
| 5 | **Auto-run vs on-demand** | **On-demand** — tests run only when user explicitly requests. But if a result already exists for the same task + same baseline, **navigate to the stored result** instead of re-running. User can force re-run from the result page. Different baseline = new run. | Smart redirect logic in test endpoint + frontend. |
| 6 | **Baseline similarity matching** | **Manual** — user always explicitly picks which baseline to test/compare against. No auto-suggestion. | Simpler implementation, no fuzzy matching needed for baseline selection. |
| 7 | **Benchmark set staleness** | **Immutable once created** — benchmark sets are cached at creation time and not re-extracted on data refresh. User can manually re-extract via "Re-extract Benchmark" button on Baselines page if needed. | Same as decision 5 — cached data is treated as stable snapshots. |
| 8 | **Sharing/Export** | **Yes — HTML report export** for both test results and comparison results. Self-contained HTML files with inline CSS, shareable without PQ Dashboard. No JSON baseline export (out of scope for now). | New export endpoints, HTML template generation on server. |
| 9 | **Multi-baseline comparison** | **Yes** — since test results are stored in SQLite with baseline IDs, the Compare view can show multiple baselines as reference columns. Query is straightforward. | Deep Compare supports multiple baseline columns. |
| 10 | **Prompt chain editing** | **Yes** — on the Baselines page, users can edit extracted prompts inline before copying. Edits are saved to the baseline's `prompts_json`. Useful for generalizing project-specific prompts. | Baselines page gets inline text editing on prompt cards. |
