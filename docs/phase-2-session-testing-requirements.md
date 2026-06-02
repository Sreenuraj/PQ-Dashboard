# Session Behavioral Testing — Phase 2 Requirements

> **Version:** 2.0  
> **Created:** 2026-06-02  
> **Updated:** 2026-06-02  
> **Branch:** `feature/session-testing-phase-2`  
> **Status:** Draft  
> **Depends on:** Phase 1 (Session Behavioral Testing v1.1 — complete)

---

## 1. Overview

### 1.1 What Phase 1 Delivered

Phase 1 established the baseline system, six behavioral test patterns, and an enhanced deep comparison view. Key components:
- **Baselines** — Marking completed sessions as baselines with auto-extracted benchmark sets
- **Behavioral Tests** — Six patterns (TIA, BCV, MTV, BSE, ERC, CEC) run against event traces
- **Deep Compare** — Side-by-side behavioral + operational comparison of sessions
- **Test Results Storage** — Persisted results in SQLite with benchmarks page

### 1.2 Phase 2 Goals

Phase 2 addresses six areas of improvement identified from real-world usage:

| # | Area | Summary |
|---|------|---------|
| 1 | **Standalone Baselines** | Baselines become independent, editable entities derived from (but decoupled from) sessions |
| 2 | **Contextual Tool Sequences** | Tool calls in baselines carry descriptions of what they did, making sequence comparisons meaningful |
| 3 | **Failed Tool Detection** | Capture tools the agent tried to use but couldn't (MCP not connected, tool errors, missing parameters) |
| 4 | **Baselines Page Fixes** | Fix broken Compare Models flow, add date/tags, remove unnecessary UI elements |
| 5 | **Session Test Improvements** | Add user interruption tracking, remove low-value ordered sequence check, use contextual tool data |
| 6 | **Task Completion & Rating** | Show the agent's "Task Completed" message in comparisons and allow optional 1–5 star user rating |

### 1.3 Design Principle (Unchanged)

All tests remain **deterministic and heuristic** — no secondary LLM calls. Phase 2 extends the data model to support richer baselines and scoring while keeping everything computed from the existing event trace.

---

## 2. Standalone Editable Baselines

### 2.1 Concept Change

**Phase 1:** A baseline *is* a task — same ID, tightly coupled. Users can view it but not edit the extracted data.

**Phase 2:** A baseline is *derived from* a session but becomes a **standalone, editable entity**. Think of it as "seeded from a session, then curated by the user."

Key differences:

| Aspect | Phase 1 | Phase 2 |
|--------|---------|---------|
| **Source** | Only completed sessions | Any session (completed, interrupted, or error) |
| **Identity** | Baseline ID = Task ID | Baseline gets its own UUID; stores `source_task_id` as reference |
| **Editing** | Read-only benchmark set | User can edit expected tools, keywords, excluded tools, excluded keywords |
| **Enrichment** | N/A | User can add another session to enrich the baseline with missing tools/keywords |
| **Independence** | Deleting baseline just unmarks the task | Baseline is fully independent — source task relationship is informational only |

### 2.2 Creating a Baseline ("Derive from Session")

**Trigger:** User selects a session and clicks **"⚑ Derive Baseline"** (renamed from "Set as Baseline").

**Modal flow:**
1. Show session summary (model, cost, status, prompt preview)
2. User provides:
   - **Baseline Name** (required — defaults to first prompt text truncated to 60 chars)
   - **Task Description** — A short description of what this task accomplishes (free text, optional)
   - **Tags** (optional, comma-separated)
3. On confirm, system:
   - Generates a new UUID for the baseline
   - Extracts benchmark set from the source session's events
   - Stores the baseline independently in the `baselines` table
   - The source session is unaffected

**Available from:**
- Sessions view — action bar when 1 session is selected
- Timeline/Investigate/Eval views — header button
- Baselines page — "+ New Baseline" button → session picker

### 2.3 Baseline Editor

After creation, the baseline opens in an **editor view** where the user can curate the benchmark data.

#### 2.3.1 Expected Tools (Allowlist)

Auto-populated from the session's actual tool usage. User can:
- **Remove** a tool from the expected list (it was used but shouldn't have been)
- **Add** a tool manually (type tool name, with autocomplete from the tool registry)
- **Move to excluded** — drag or click-to-move a tool from expected to the excluded list

#### 2.3.2 Excluded Tools (Denylist) — NEW

Tools that should **not** be used for this task. Starts empty; user can:
- **Add** manually (type tool name)
- **Move from expected** — drag/click a tool from the expected list
- Items here will cause test failures if the session being tested uses them

#### 2.3.3 Contract Keywords (Allowlist)

Auto-populated from `behavior_contract.output_keywords`. User can:
- **Remove** a keyword
- **Add** a keyword manually
- **Move to excluded** — drag or click-to-move to excluded keywords

#### 2.3.4 Excluded Keywords (Denylist) — NEW

Keywords that should **not** appear in the agent's output. Maps to `behavior_contract.forbidden_phrases`. User can:
- **Add** manually
- **Move from contract keywords**

#### 2.3.5 UI Layout — Baseline Editor

```
┌─────────────────────────────────────────────────────────────────────────┐
│  EDIT BASELINE: "Review project structure"                              │
│  Derived from session 1780309194164 (anthropic/claude-sonnet-4.5)       │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─ Baseline Details ──────────────────────────────────────────────┐   │
│  │  Name: [Review project structure                          ]     │   │
│  │  Description: [Explore and summarize project files/structure ]   │   │
│  │  Tags: [exploration] [review] [+]                               │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─ Tools ─────────────────────────────────────────────────────────┐   │
│  │                                                                 │   │
│  │  EXPECTED (Should use)          EXCLUDED (Should NOT use)       │   │
│  │  ┌─────────────────────┐       ┌─────────────────────┐         │   │
│  │  │ ☐ readFile          │  ◀▶   │ ☐ editedExistingFile│         │   │
│  │  │ ☐ listCodeDefNames  │       │ ☐ newFileCreated    │         │   │
│  │  │ ☐ searchFiles       │       │                     │         │   │
│  │  │                     │       │                     │         │   │
│  │  │ [+ Add tool...]     │       │ [+ Add tool...]     │         │   │
│  │  └─────────────────────┘       └─────────────────────┘         │   │
│  │                                                                 │   │
│  │  ◀ Move to Excluded    Move to Expected ▶                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌─ Keywords ──────────────────────────────────────────────────────┐   │
│  │                                                                 │   │
│  │  CONTRACT (Should appear)       EXCLUDED (Should NOT appear)    │   │
│  │  ┌─────────────────────┐       ┌─────────────────────┐         │   │
│  │  │ ☐ project           │  ◀▶   │ ☐ TODO              │         │   │
│  │  │ ☐ review            │       │ ☐ placeholder       │         │   │
│  │  │ ☐ structure         │       │ ☐ lorem             │         │   │
│  │  │ ☐ files             │       │                     │         │   │
│  │  │ [+ Add keyword...]  │       │ [+ Add keyword...]  │         │   │
│  │  └─────────────────────┘       └─────────────────────┘         │   │
│  │                                                                 │   │
│  │  ◀ Move to Excluded    Move to Contract ▶                       │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  [Save Changes]  [Discard]  [Delete Baseline]                           │
└─────────────────────────────────────────────────────────────────────────┘
```

**Interaction model:**
- Checkboxes for selecting items, then click the move button
- Or drag-and-drop items between the two columns
- Add button opens an inline text input with autocomplete (tools from registry, keywords freeform)
- All changes require explicit "Save" — no auto-save

### 2.4 Enriching a Baseline from Another Session

A key Phase 2 feature: users can add a second (or third, fourth...) session to an existing baseline to enrich its tool/keyword data.

**Workflow:**
1. From the Baseline Editor or Baselines page, click **"+ Enrich from Session"**
2. Session picker opens (similar to test picker)
3. User selects a completed/interrupted/error session
4. System analyzes the session and produces a **diff view**:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  ENRICH BASELINE from session 1780311588032                             │
│  Model: google/gemini-2.5-pro  │  Duration: 6m 30s                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  NEW TOOLS found in this session (not in baseline):                     │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ ☑ listFilesTopLevel     — used 3 times     [→ Expected] [Skip]  │   │
│  │ ☑ command               — used 1 time      [→ Expected] [Skip]  │   │
│  │ ☐ editedExistingFile    — used 2 times     [→ Expected] [Skip]  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  NEW KEYWORDS found in session output (not in baseline):                │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ ☑ dependencies          — appears 4 times  [→ Contract] [Skip]  │   │
│  │ ☑ configuration         — appears 3 times  [→ Contract] [Skip]  │   │
│  │ ☐ webpack               — appears 1 time   [→ Contract] [Skip]  │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  FAILED/ERRORED TOOLS in this session:                                  │
│  ┌──────────────────────────────────────────────────────────────────┐   │
│  │ ⚠ access_mcp_resource  — "No connection found for server"       │   │
│  │   [→ Excluded] [→ Expected] [Skip]                               │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  [Merge Selected]  [Merge All]  [Cancel]                                │
│                                                                         │
│  Contributing sessions: 1780309194164 (source), 1780311588032 (this)    │
└─────────────────────────────────────────────────────────────────────────┘
```

**Key details:**
- Items are pre-checked by default (user unchecks what they don't want)
- Each item has a destination selector: `→ Expected` or `→ Excluded` for tools; `→ Contract` or `→ Excluded` for keywords
- The baseline stores a list of `contributing_sessions` — all session IDs that have contributed data
- "Merge All" is a convenience shortcut that adds everything checked to the expected/contract lists

### 2.5 Updated Data Model

```typescript
interface Baseline {
  id: string;                    // NEW: independent UUID (not task_id)
  source_task_id: string;        // Reference to the session it was derived from
  name: string;                  // User-given name (required)
  description: string;           // NEW: task description
  tags: string[];                // User-defined tags
  created_at: number;
  updated_at: number;            // NEW: tracks edits
  model_id: string;              // Model from source session
  source: string;                // IDE source
  activity_category: string;     // From classifier
  contributing_sessions: string[]; // NEW: all session IDs that enriched this baseline
}

interface BenchmarkSet {
  baseline_id: string;

  // Prompt Chain (unchanged)
  prompts: Array<{
    index: number;
    text: string;
    ts: number;
    response_preview: string;
    tools_after: string[];
  }>;

  // Expected tool set (editable)
  expected_tools: string[];

  // NEW: Excluded tool set
  excluded_tools: string[];

  // Ordered tool sequence with context (enhanced — see Section 3)
  tool_sequence: Array<{
    index: number;
    tool_name: string;
    file_path: string | null;
    command: string | null;
    description: string;         // NEW: auto-derived + user-editable label
    is_essential: boolean;       // NEW: user marks if this step is essential
  }>;

  // Behavior contract (enhanced)
  behavior_contract: {
    has_code_block: boolean;
    output_keywords: string[];   // Editable
    excluded_keywords: string[]; // NEW: forbidden phrases (editable)
    output_min_length: number;
    output_max_length: number;
  };

  // Failed tools (NEW — see Section 4)
  failed_tools: Array<{
    tool_name: string;
    error_message: string;
    error_category: string;      // 'mcp_not_connected' | 'missing_params' | 'tool_error' | 'tool_not_found'
    count: number;
  }>;

  // Task completion (NEW — see Section 7)
  completion_message: string | null;

  // Operational reference metrics (unchanged)
  reference_metrics: { ... };
}
```

### 2.6 Updated SQLite Schema

```sql
-- Phase 2: Modify baselines table
-- Note: id is now an independent UUID, not task_id

ALTER TABLE baselines ADD COLUMN description TEXT;
ALTER TABLE baselines ADD COLUMN updated_at INTEGER;
ALTER TABLE baselines ADD COLUMN contributing_sessions_json TEXT;  -- JSON array of task IDs
ALTER TABLE baselines ADD COLUMN excluded_tools_json TEXT;          -- JSON array of tool names
ALTER TABLE baselines ADD COLUMN failed_tools_json TEXT;            -- JSON array of {tool_name, error, category, count}
ALTER TABLE baselines ADD COLUMN completion_message TEXT;

-- Migration: For existing Phase 1 baselines, set id = task_id (backward compatible)
-- New baselines will use UUID v4
```

### 2.7 Baseline API Changes

| Method | Endpoint | Changes |
|--------|----------|---------|
| `POST` | `/api/baselines` | Body now accepts `description`. Returns new UUID-based `id`. Source `task_id` is a reference, not the ID. |
| `PUT` | `/api/baselines/:id` | **Enhanced:** Can now update `expected_tools`, `excluded_tools`, `behavior_contract` (keywords + excluded keywords), `tool_sequence` descriptions, `name`, `description`, `tags` |
| `POST` | `/api/baselines/:id/enrich` | **NEW:** Body: `{ session_id }` — Extracts tools/keywords from the session, returns diff for user review |
| `PUT` | `/api/baselines/:id/merge` | **NEW:** Body: `{ tools_to_add, tools_to_exclude, keywords_to_add, keywords_to_exclude, session_id }` — Applies the merge |

---

## 3. Contextual Tool Sequences

### 3.1 Problem

Phase 1's tool sequence comparison lists raw tool calls side by side:

```
1. readFile      →  README.md
2. readFile      →  package.json
3. readFile      →  server/index.js
...
```

This doesn't convey **why** each tool was called. Seeing `readFile → package.json` alone doesn't tell you if the agent was checking dependencies, looking for scripts, or inspecting the project name.

### 3.2 Solution: Auto-Derived Descriptions

Each tool call in the baseline's `tool_sequence` gets an auto-derived description based on:

1. **Tool name + file path context:**

   | Pattern | Auto-Description |
   |---------|-----------------|
   | `readFile → README.md` | "Read project documentation" |
   | `readFile → package.json` | "Read project configuration/dependencies" |
   | `readFile → *.config.*` or `*.yaml` or `*.json` (in root) | "Read configuration file" |
   | `readFile → src/**` or `lib/**` | "Read source code" |
   | `readFile → test/**` or `*.test.*` or `*.spec.*` | "Read test file" |
   | `editedExistingFile → *` | "Modified {filename}" |
   | `newFileCreated → *` | "Created new file {filename}" |
   | `command → npm *` | "Ran npm command: {cmd}" |
   | `command → git *` | "Ran git command: {cmd}" |
   | `searchFiles → *` | "Searched codebase for: {query}" |
   | `listFilesRecursive` / `listFilesTopLevel` | "Listed directory contents" |
   | `listCodeDefinitionNames` | "Analyzed code structure/definitions" |

2. **Surrounding context:** If the tool call follows a reasoning event, extract key intent from the reasoning text.

3. **User override:** In the Baseline Editor, each tool step shows the auto-derived description in an editable text field. User can refine or rewrite it.

### 3.3 Essential vs. Optional Steps

In the Baseline Editor, each tool step has a toggle: **Essential** (required for the task) vs. **Optional** (nice-to-have but not strictly needed).

- **Essential steps** (default for the first occurrence of each unique tool+file pair): Missing these in a tested session causes test score reduction
- **Optional steps** (duplicate reads, exploratory searches): Missing these is fine

This replaces the previous ordered-sequence comparison (which was not meaningful — see Section 6.2).

### 3.4 How Contextual Sequences Feed into Testing

Instead of comparing exact tool order (Phase 1's MTV pattern), Phase 2 compares:

1. **Essential step coverage** — Did the session perform all essential steps from the baseline?
2. **Purpose alignment** — For each essential step, did the session use a tool that could serve the same purpose? (e.g., `readFile → package.json` is equivalent whether it's step 2 or step 5)
3. **Excluded tool usage** — Did the session use any tools from the excluded list?

---

## 4. Failed Tool Detection

### 4.1 Problem

When an agent tries to call a tool that doesn't exist or isn't available (e.g., an MCP server not connected), the error is buried in the event trace. Phase 1 captures these as generic `tool_error` events but doesn't surface them meaningfully.

### 4.2 Solution: Parse and Categorize Tool Failures

During parsing (`ui-messages.js`) and baseline extraction, identify tool failures from error messages:

| Error Pattern | Category | Example |
|--------------|----------|---------|
| `"No connection found for server: {X}"` | `mcp_not_connected` | Agent tried to use an MCP tool but the server wasn't running |
| `"PostQode tried to use {tool} without value for required parameter '{param}'"` | `missing_params` | Agent called a tool incorrectly |
| `"Error executing {tool}: {message}"` | `tool_execution_error` | Tool exists but failed during execution |
| Tool name not in BUILT_IN_TOOLS and not in tool registry | `unknown_tool` | Agent hallucinated a tool name |

### 4.3 Extraction Logic

```javascript
function extractFailedTools(events) {
  const failures = [];
  for (const e of events) {
    if (!e.error_message) continue;
    const msg = e.error_message;

    // MCP not connected
    const mcpMatch = msg.match(/No connection found for server:\s*(\S+)/);
    if (mcpMatch) {
      failures.push({
        tool_name: `mcp:${mcpMatch[1]}`,
        error_message: msg,
        error_category: 'mcp_not_connected',
      });
      continue;
    }

    // Missing params
    const paramMatch = msg.match(/tried to use (\S+) without value for required parameter '(\S+)'/);
    if (paramMatch) {
      failures.push({
        tool_name: paramMatch[1],
        error_message: msg,
        error_category: 'missing_params',
      });
      continue;
    }

    // Tool execution error
    const execMatch = msg.match(/Error executing (\S+):\s*(.*)/);
    if (execMatch) {
      failures.push({
        tool_name: execMatch[1],
        error_message: execMatch[2],
        error_category: 'tool_execution_error',
      });
    }
  }

  // Deduplicate and count
  const map = new Map();
  for (const f of failures) {
    const key = `${f.tool_name}::${f.error_category}`;
    if (map.has(key)) {
      map.get(key).count++;
    } else {
      map.set(key, { ...f, count: 1 });
    }
  }
  return [...map.values()];
}
```

### 4.4 How Failed Tools Appear in the UI

**In Session Test view:** A new section "Tool Failures" shows:
```
⚠ TOOL FAILURES (3 detected)
  • access_mcp_resource — "No connection found for server: memory" (2 attempts)
  • read_file — "File not found: /path/to/file" (1 attempt)
```

**In Baseline Editor:** When enriching from a session, failed tools are shown in the diff view (see Section 2.4). User can add them to the excluded list.

**In scoring:** Each failed tool attempt penalizes the Error Recovery pattern (ERC) score and is also captured as evidence in the Scope Enforcement pattern (BSE).

---

## 5. Baselines Page Fixes

### 5.1 Issues and Solutions

| # | Issue | Fix |
|---|-------|-----|
| 5.1 | **Compare Models button doesn't work** | Fix navigation — currently it navigates to `#/deepcompare?baseline=ID` without pre-selecting sessions. Should open the session picker (which already exists in `renderBaselineComparePicker`). Debug and fix the routing. |
| 5.2 | **"View Timeline" not needed** | Remove the "View Timeline" button. Baselines are now standalone; the source session is informational. Replace with **"Edit Baseline"** button that opens the Baseline Editor (Section 2.3). |
| 5.3 | **Heading is first prompt — needs more context** | Change the collapsed baseline card summary to show: `Name` + `Date Created (formatted)` + `Model badge` + `Category badge`. Currently it only shows name + category. Add the date and model. |
| 5.4 | **Tags: search supports them but no UI to add** | Add tag management to the Baseline Editor (Section 2.3). Also add an "Add Tag" inline button on the baseline card for quick tagging without opening the editor. |
| 5.5 | **Master date filter at top right not needed** | Remove the "All Time" date filter dropdown from the Baselines page top bar. Baselines are long-lived reference artifacts, not time-series data. Keep only the search bar. |

### 5.2 Updated Baselines Page Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  BASELINES                                        [ + New Baseline ]    │
│  Curated reference configurations for behavioral testing                │
├─────────────────────────────────────────────────────────────────────────┤
│  [Search baselines or tags...                                      ]    │
│                                                                         │
│  ┌─ Review project structure ─── Jun 1, 2:30 PM ─── claude-sonnet-4.5 ─┐
│  │                                                   exploration        │
│  │  ┌──────────────────────────────────────────────────────────────┐    │
│  │  │ Description: Explore and summarize project file structure    │    │
│  │  │ Tags: [exploration] [review] [+ Add Tag]                     │    │
│  │  │ Source session: 1780309194164                                 │    │
│  │  │ Contributing sessions: 3                                     │    │
│  │  └──────────────────────────────────────────────────────────────┘    │
│  │                                                                      │
│  │  ▸ Benchmark summary (Expected: 3 tools, Excluded: 2 tools,         │
│  │                        Keywords: 8, Excluded keywords: 3)            │
│  │  ▸ Prompt chain (1 prompt)                                           │
│  │                                                                      │
│  │  [Copy All Prompts] [Edit Baseline] [Test Against This]              │
│  │  [Compare Models] [Enrich from Session] [Delete]                     │
│  └──────────────────────────────────────────────────────────────────────┘
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Button changes:**
- ~~View Timeline~~ → **Edit Baseline** (opens editor view)
- ~~Re-extract~~ → **Enrich from Session** (opens session picker + diff)
- **Compare Models** — fixed to work correctly
- Removed: Date filter dropdown at top right

---

## 6. Session Test Improvements

### 6.1 User Interruption Tracking

**What to track:** Count the number of times the user interrupted the agent during a session. An interruption is any event indicating the user stopped the agent's flow:

| Event Indicator | Type | Meaning |
|----------------|------|---------|
| `sub_type = 'resume_task'` | `ask` | User hit stop and then resumed — counts as an interruption |
| `has_context_reset = true` | task-level | Context window overflowed, requiring reset — system interruption |
| `error_category = 'interruption'` | event | Explicitly classified as interruption by parser |

**Display in Session Test:**
```
┌─ Session Health ────────────────────────────────────────────────┐
│  User Interruptions: 3                                          │
│    • Stopped at tool call #4 (readFile → src/utils.js)          │
│    • Stopped at tool call #8 (editedExistingFile → index.js)    │
│    • Stopped at tool call #12 (command → npm test)              │
│  Context Resets: 1                                              │
│  Tool Failures: 2 (see Tool Failures section)                   │
└─────────────────────────────────────────────────────────────────┘
```

**Impact on scoring:** Each user interruption contributes a small penalty to the overall behavioral score:
- 0 interruptions: no penalty
- 1-2 interruptions: -5% penalty (minor corrections are normal)
- 3-5 interruptions: -15% penalty (agent struggled)
- 6+: -25% penalty (agent was significantly off track)

The interruption count is also stored in test results for historical comparison.

### 6.2 Replace Ordered Tool Sequence Comparison

**Problem:** Phase 1's "Compared ordered tool sequence against the baseline" (MTV pattern) doesn't add value. As shown in the screenshot, it just lists `readFile` repeatedly with file paths — the order is often irrelevant and the comparison is meaningless.

**Solution:** Replace the MTV (Multi-Step Trace Verification) pattern with an enhanced version that uses **contextual tool sequence data** from Section 3:

**New MTV Logic:**
1. Load the baseline's `tool_sequence` with descriptions and `is_essential` flags
2. For the tested session, extract its tool sequence and auto-derive descriptions
3. Compare:
   - **Essential step coverage**: Check if each essential step from the baseline was performed in the session (tool + approximate target match, regardless of order)
   - **Excluded tool check**: Verify no excluded tools were used
   - **Efficiency**: Flag sessions that used significantly more tool calls than the baseline for the same essential steps

**Scoring:**
- All essential steps covered, no excluded tools: **PASS (90-100)**
- Most essential steps covered, minor deviations: **WARN (50-80)**
- Multiple essential steps missing or excluded tools used: **FAIL (0-40)**

### 6.3 Updated Test Result Display

The Session Test view gets several enhancements:

```
┌─────────────────────────────────────────────────────────────────┐
│ ← Sessions    TEST SESSION    [task_id]    claude-sonnet-4      │
│ Behavioral testing against the task event trace                  │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  BEHAVIORAL SCORE                                                │
│  ████████████████████████████░░░░  82%                           │
│  (includes -5% interruption penalty)                             │
│                                                                  │
│  ┌─ Session Health ────────────────────────────────────────┐     │
│  │  Interruptions: 2  │  Context Resets: 0  │  Failures: 1 │     │
│  └─────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ┌─ Tool Invocation ──────────── ✅ PASS (95%) ──────────┐      │
│  │  Expected: readFile, listCodeDefinitionNames, searchFiles│     │
│  │  Excluded: editedExistingFile, newFileCreated            │     │
│  │  Actual: readFile ✓, listCodeDefinitionNames ✓           │     │
│  │  No excluded tools used ✓                                │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ┌─ Essential Steps ──────────── ⚠ WARN (70%) ──────────┐      │
│  │  ✓ "Read project documentation" — readFile README.md     │     │
│  │  ✓ "Read configuration" — readFile package.json          │     │
│  │  ✗ "Analyze code structure" — listCodeDefinitionNames    │     │
│  │    (not performed in this session)                        │     │
│  │  ✓ "Read source code" — readFile server/index.js         │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ┌─ Tool Failures ──────────── ⚠ INFO ──────────────────┐      │
│  │  ⚠ access_mcp_resource — "No connection: memory" (2x)   │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                  │
│  ┌─ Task Completion ──────────────────────────────────────┐      │
│  │  "I have reviewed the project structure. The project     │     │
│  │   is a Node.js dashboard application with..."            │     │
│  │                                                          │     │
│  │  Rate this completion: ★★★★☆  [Save Rating]              │     │
│  └──────────────────────────────────────────────────────────┘     │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 7. Task Completion & Rating

### 7.1 Displaying the Completion Message

PostQode emits a `completion_result` event (with `type: 'say'`) containing the agent's summary of what it accomplished. This should be:

1. **Extracted during parsing** — already captured in `ui-messages.js` as a `completion_result` sub_type with text content
2. **Stored in the baseline** — as `completion_message` field
3. **Shown in comparisons** — as the last row in the Deep Compare table, so users can see how each model summarized its work

### 7.2 Completion Message in Comparisons

```
                    Task A (Claude)          Task B (GPT)
                    ─────────────────        ─────────────────
... (existing rows) ...

Task Completed      "I have reviewed the     "I reviewed the project
                    project structure.        and found it to be a
                    The project is a          Node.js application
                    Node.js dashboard..."     with Express..."

Rating              ★★★★☆ (4/5)              ★★★☆☆ (3/5)
```

### 7.3 User Rating System

After a session test runs, the user can optionally rate the agent's completion:

**Rating scale:** 1–5 stars
- ★☆☆☆☆ (1) — Wrong or useless output
- ★★☆☆☆ (2) — Partially correct but missing key points
- ★★★☆☆ (3) — Acceptable but not impressive
- ★★★★☆ (4) — Good, met expectations
- ★★★★★ (5) — Excellent, exceeded expectations

**Storage:**
```sql
ALTER TABLE test_results ADD COLUMN user_rating INTEGER;  -- 1-5, NULL if not rated
ALTER TABLE test_results ADD COLUMN completion_message TEXT;
```

**Impact on scoring:** The user rating is optional and does **not** affect the behavioral test score directly. However, when viewing test benchmarks or comparisons, the rating is shown alongside the score as a "human judgment" indicator. This lets users see if high-scoring sessions actually produced good output (or if low-scoring sessions were actually fine despite test warnings).

**Future possibility:** If enough ratings accumulate, the system could compute a "human-machine alignment" metric — how well the automated behavioral score correlates with user satisfaction.

---

## 8. Updated Test Rules Configuration

### 8.1 Changes to `test-rules.yaml`

```yaml
# PQ Dashboard - Behavioral Test Rules (Phase 2)

tool_invocation:
  enabled: true
  # Phase 2: Now supports excluded tools from baseline
  check_excluded_tools: true    # NEW: fail if excluded tools are used
  custom_mappings:
    - keywords: ["read", "show", "view", "look at", "open"]
      expected_tools: ["readFile", "Read", "read_file"]
    - keywords: ["edit", "modify", "change", "update", "fix"]
      expected_tools: ["editedExistingFile", "Edit", "write_to_file", "apply_diff"]
    - keywords: ["create", "new file", "scaffold", "generate"]
      expected_tools: ["newFileCreated", "Write", "write_to_file"]
    - keywords: ["run", "execute", "npm", "pip", "build", "test"]
      expected_tools: ["command", "Bash", "execute_command"]
    - keywords: ["search", "find", "grep", "look for"]
      expected_tools: ["searchFiles", "Grep", "GrepTool", "search_files"]
    - keywords: ["list files", "directory", "ls"]
      expected_tools: ["listFilesRecursive", "Glob", "list_files"]
    - keywords: ["browser", "web", "url", "page"]
      expected_tools: ["postqode_browser_agent"]

behavior_contracts:
  enabled: true
  auto_infer: true
  check_excluded_keywords: true  # NEW: fail if excluded keywords appear
  custom_contracts:
    coding:
      must_include: []
      has_code_block: true
      min_length: 80
    debugging:
      must_include_any: ["fix", "resolved", "found", "issue", "root cause"]
      min_length: 80
    testing:
      must_include_any: ["test", "pass", "fail", "assert"]
      min_length: 80

trace_verification:
  enabled: true
  # Phase 2: essential steps mode replaces strict ordering
  mode: essential_steps          # NEW: 'essential_steps' (Phase 2) or 'strict_order' (Phase 1)
  rules:
    read_before_edit: true
    think_before_act: true
    test_after_edit: false
    no_blind_writes: true
    search_before_create: false

scope_enforcement:
  enabled: true
  max_tool_calls: 100
  no_destructive_commands: true
  check_failed_tools: true       # NEW: include failed tool attempts in scope check
  destructive_patterns:
    - "rm -rf /"
    - "drop table"
    - "format c:"
    - "sudo rm"
  workspace_only: true

error_recovery:
  enabled: true
  max_blind_retries: 2

context_efficiency:
  enabled: true
  warn_threshold: 70
  critical_threshold: 90

# Phase 2: New section
interruptions:
  enabled: true
  penalty_thresholds:
    minor: 2           # 1-2 interruptions = -5%
    moderate: 5         # 3-5 interruptions = -15%
    severe: 6           # 6+ interruptions = -25%
  penalty_amounts:
    minor: 5
    moderate: 15
    severe: 25

# Phase 2: New section
failed_tools:
  enabled: true
  categories:
    - mcp_not_connected
    - missing_params
    - tool_execution_error
    - unknown_tool

# Phase 2: New section
completion_rating:
  enabled: true
  show_in_comparison: true

weights:
  tia: 25
  bcv: 15
  mtv: 20              # Now uses essential_steps mode
  bse: 20
  erc: 10
  cec: 10
```

---

## 9. Implementation Plan

### 9.1 New Files

| File | Purpose |
|------|---------|
| `src/js/views/baseline-editor.js` | Baseline Editor view with dual-list tool/keyword management |
| `src/js/views/baseline-enrich.js` | Enrich from Session — diff view and merge flow |
| `server/baselines/failed-tools.js` | Failed tool extraction from event traces |
| `server/baselines/tool-descriptions.js` | Auto-derive descriptions for tool calls |

### 9.2 Modified Files

| File | Changes |
|------|---------|
| `server/cache/db.js` | Schema migrations: new columns on `baselines` and `test_results` tables |
| `server/baselines/extract.js` | Extract failed tools, completion message, auto-derive tool descriptions |
| `server/routes/baselines.js` | New endpoints: `PUT` for editing, `POST /enrich`, `PUT /merge` |
| `server/testing/index.js` | Add interruption tracking, completion message extraction |
| `server/testing/tia.js` | Support excluded tools from baseline |
| `server/testing/bcv.js` | Support excluded keywords from baseline |
| `server/testing/mtv.js` | Rewrite: essential steps mode replaces strict order |
| `server/testing/bse.js` | Include failed tool attempts in scope check |
| `server/testing/shared.js` | Add interruption counting, completion message extraction |
| `server/parser/ui-messages.js` | Enhanced error classification for failed tools, capture completion_result text |
| `src/js/views/baselines.js` | Updated layout, remove timeline/date filter, add edit/enrich buttons |
| `src/js/views/test.js` | Add interruption display, tool failures section, completion message + rating |
| `src/js/views/deep-compare.js` | Fix compare models, add completion row, add rating column |
| `src/js/api.js` | New API methods: `updateBaseline`, `enrichBaseline`, `mergeEnrichment`, `rateTestResult` |
| `src/js/app.js` | Register new routes for baseline editor and enrich views |
| `src/index.html` | No structural changes (routes are hash-based) |
| `test-rules.yaml` | Updated with Phase 2 sections (interruptions, failed_tools, completion_rating) |
| `src/css/index.css` | Styles for dual-list editor, diff view, star rating, health indicators |

---

## 10. Verification Plan

### 10.1 Automated Tests

```bash
# Build verification
npm run build

# API endpoint smoke tests
curl http://localhost:3456/api/baselines         # List baselines
curl -X POST http://localhost:3456/api/baselines  # Create baseline (with body)
curl -X PUT http://localhost:3456/api/baselines/:id  # Edit baseline
curl http://localhost:3456/api/test-rules          # Get updated rules
```

### 10.2 Manual Verification

1. **Create Baseline:** Select a session → Derive Baseline → verify editor opens with auto-populated data
2. **Edit Baseline:** Add/remove tools and keywords → Save → verify persistence
3. **Enrich Baseline:** Open enrichment flow → select another session → verify diff view → merge → verify baseline updated
4. **Session Test:** Test a session against edited baseline → verify excluded tools/keywords cause failures
5. **Interruption Count:** Test a session with known interruptions → verify count displays correctly
6. **Completion Message:** Verify "Task Completed" shows in test view and deep compare
7. **Rating:** Rate a test result → verify persistence and display in comparisons
8. **Compare Models Fix:** Verify baseline → Compare Models → session picker → deep compare works end-to-end
9. **Baselines Page:** Verify updated layout, no date filter, edit button works

---

## 11. Relationship to Phase 1

| Phase 1 Component | Phase 2 Status |
|-------------------|----------------|
| `baselines` table | Extended with new columns; backward compatible |
| `test_results` table | Extended with `user_rating` and `completion_message` |
| TIA pattern | Enhanced with excluded tools support |
| BCV pattern | Enhanced with excluded keywords support |
| MTV pattern | **Rewritten** — essential steps replaces strict ordering |
| BSE pattern | Enhanced with failed tool tracking |
| ERC pattern | Unchanged |
| CEC pattern | Unchanged |
| Baselines page | Updated layout and buttons |
| Session Test view | Enhanced with interruptions, failures, completion, rating |
| Deep Compare view | Enhanced with completion row and Compare Models fix |

---

## 12. Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | Baselines get independent UUIDs | Decouples baseline identity from source session. Multiple baselines can reference the same session. |
| 2 | Dual-list UI (expected + excluded) with click-to-move | Flexible approach that works on all screen sizes. Drag-and-drop can be added as enhancement. |
| 3 | Enrichment shows diff before merge | User maintains control over what enters the baseline. Prevents low-quality data from contaminating curated baselines. |
| 4 | Tool descriptions auto-derived from file paths | No LLM needed. Pattern-based approach is fast, deterministic, and covers 80% of cases. User can edit the rest. |
| 5 | Interruptions penalize overall score, not individual patterns | Interruptions reflect session quality holistically, not specific test failures. |
| 6 | Rating is optional and doesn't affect behavioral score | Keeps automated scoring deterministic. Human rating is a separate dimension for correlation analysis. |
| 7 | `completion_result` text extracted from raw session data | Parser already processes these events; just needs to store the text content. |
| 8 | MTV rewrite to essential-steps mode | Ordered sequence comparison was noise. Purpose-based matching is meaningful. |
