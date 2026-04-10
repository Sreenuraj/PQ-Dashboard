# PQ Dashboard — Requirements Document

> **Version:** 1.0  
> **Created:** 2026-04-10  
> **Status:** Approved  

---

## 1. Overview

PQ Dashboard is an observability and analytics dashboard for the **PostQode AI coding agent**. It processes task history files persisted by the PostQode VS Code extension and surfaces insights into model behavior, tool usage, errors, costs, and reasoning quality.

### 1.1 Purpose

The PostQode extension saves detailed task histories to disk — every API call, tool invocation, model response, error, and user interaction. These files contain a goldmine of behavioral data, but there's no way to visualize or analyze it today.

PQ Dashboard fills this gap by:
- Parsing task files from **any number of IDEs** (VS Code, VS Code Insiders, Cursor, Windsurf, etc.)
- Processing and caching the data efficiently
- Presenting interactive dashboards for behavioral analysis

### 1.2 Target User

- PostQode extension users who want to understand how AI models behave
- Developers evaluating different LLM models for coding tasks
- Teams tracking AI agent costs and error patterns

---

## 2. Data Sources

### 2.1 Task Directory Structure

PostQode stores task history at:
```
<IDE_DATA_DIR>/User/globalStorage/postqode.postqode/tasks/<TASK_ID>/
```

Where `<IDE_DATA_DIR>` varies by platform and IDE:

| IDE | macOS Path | Windows Path |
|-----|-----------|-------------|
| VS Code | `~/Library/Application Support/Code/` | `%APPDATA%/Code/` |
| VS Code Insiders | `~/Library/Application Support/Code - Insiders/` | `%APPDATA%/Code - Insiders/` |
| Cursor | `~/Library/Application Support/Cursor/` | `%APPDATA%/Cursor/` |
| Windsurf | `~/Library/Application Support/Windsurf/` | `%APPDATA%/Windsurf/` |

Each `<TASK_ID>` is an epoch timestamp (e.g., `1775191507362`), which doubles as the task creation time.

### 2.2 Files Per Task

| File | Presence | Description |
|------|----------|-------------|
| `ui_messages.json` | All tasks | **Richest source** — every UI event with timestamps, costs, tokens, tool calls, errors, reasoning |
| `api_conversation_history.json` | Most tasks | Raw API request/response pairs with per-call metrics |
| `task_metadata.json` | Most tasks | Model usage log, files in context (read/edit tracking), environment info |
| `focus_chain_taskid_<ID>.md` | Many tasks | Markdown TODO checklist with `[x]` / `[ ]` completion tracking |
| `context_history.json` | Rare | Created when context window is cleared/summarized mid-conversation |

### 2.3 Provider Architecture

```
User → PostQode Extension → Provider → Model
                              ├── "postqode" (OpenRouter wrapper) → 500+ models, 60+ providers
                              ├── "anthropic" (direct)
                              ├── "openai" (direct)
                              ├── "google" (direct)
                              └── any user-configured provider
```

- PostQode's default provider wraps **OpenRouter**, which routes to upstream providers (Anthropic, OpenAI, Google, Meta, Mistral, etc.)
- Users can configure **any provider** — the dashboard must be fully provider-agnostic
- Models are identified as `provider/model-name` (e.g., `anthropic/claude-sonnet-4.5`, `openai/gpt-5.4-mini`)
- Models with `:free` suffix have stricter rate limits

---

## 3. Data Schema

### 3.1 `ui_messages.json` — Event Types

#### `say` Events (System → UI)

| `say` Type | Content | Key Data Points |
|------------|---------|-----------------|
| `text` | User messages + agent responses | Conversation flow, user intent, first message = task description |
| `reasoning` | Model's internal chain-of-thought | Reasoning quality, planning depth (only some models emit this) |
| `api_req_started` | API call initiated | **JSON in `text` field** containing: `tokensIn`, `tokensOut`, `cacheReads`, `cacheWrites`, `cost`, `request` |
| `tool` | Tool call details | Tool name, file path, content, `operationIsLocatedInWorkspace` |
| `command` | CLI command executed | Command text, `commandCompleted` boolean |
| `error` | Error occurred | Error message string |
| `checkpoint_created` | Git checkpoint snapshot | `lastCheckpointHash`, `isCheckpointCheckedOut` |
| `completion_result` | Task completion summary | Final result text |
| `task_progress` | TODO list update | Markdown checklist string |
| `mcp_server_request_started` | MCP tool invocation | MCP server details |
| `user_feedback` | User correction mid-task | Feedback text |

#### `ask` Events (Agent → User)

| `ask` Type | Content | Meaning |
|------------|---------|---------|
| `tool` | Tool execution approval | JSON with `tool` name, `path`, `content` |
| `command_output` | Command result display | Output text |
| `resume_task` | Task interruption | Model didn't respond or user paused |
| `completion_result` | Completion for approval | Task end state |
| `use_mcp_server` | MCP permission request | MCP dependency |

#### Common Fields on All Events

```typescript
interface UIMessage {
  ts: number;                    // Epoch timestamp (milliseconds)
  type: "say" | "ask";
  say?: string;                  // Event subtype (see tables above)
  ask?: string;                  // Event subtype (see tables above)
  text?: string;                 // Content/payload
  images?: string[];             // Attached images
  files?: string[];              // Attached files
  modelInfo?: {
    providerId: string;          // e.g., "postqode", "anthropic"
    modelId: string;             // e.g., "anthropic/claude-sonnet-4.5"
    mode: string;                // e.g., "api_agent", "web_agent", "act", "web-automation-pro"
  };
  conversationHistoryIndex: number;
  lastCheckpointHash?: string;
  isCheckpointCheckedOut?: boolean;
  partial?: boolean;             // Streaming partial response
  commandCompleted?: boolean;    // For command events
}
```

### 3.2 `api_req_started` Embedded JSON

The `text` field of `api_req_started` events contains a JSON string:

```json
{
  "request": "...<full prompt text>...",
  "tokensIn": 17711,
  "tokensOut": 709,
  "cacheWrites": 0,
  "cacheReads": 0,
  "cost": 0.077049
}
```

**Key signals:**
- `cost: 0` + `tokensIn: 0` = **API failure** (provider error, rate limit, timeout)
- `cacheReads > 0` = Prompt caching is working (cost savings)
- `cost` = Per-call cost in USD

### 3.3 `task_metadata.json`

```typescript
interface TaskMetadata {
  files_in_context: Array<{
    path: string;
    record_state: "active" | "stale";
    record_source: "read_tool" | "file_mentioned" | "postqode_edited" | "user_edited";
    postqode_read_date: number | null;
    postQode_edit_date: number | null;    // Note: camelCase inconsistency in real data
    user_edit_date: number | null;
  }>;
  model_usage: Array<{
    ts: number;
    model_id: string;
    model_provider_id: string;
    mode: string;
  }>;
  environment_history: Array<{
    ts: number;
    os_name: string;
    os_version: string;
    os_arch: string;
    host_name: string;           // "VSCode"
    host_version: string;        // "1.115.0-insider"
    postqode_version: string;    // "2.0.24"
  }>;
}
```

### 3.4 `api_conversation_history.json`

```typescript
interface ConversationMessage {
  role: "user" | "assistant";
  content: Array<{ type: "text"; text: string }>;
  modelInfo?: {
    modelId: string;
    providerId: string;
    mode: string;
  };
  metrics?: {
    tokens: {
      prompt: number;
      completion: number;
      cached: number;
    };
    cost: number;
  };
}
```

### 3.5 `context_history.json`

Nested array tracking context window management events. Indicates context was trimmed/summarized mid-conversation.

### 3.6 `focus_chain_taskid_<ID>.md`

```markdown
- [x] Completed item
- [ ] Incomplete item
- [x] Another completed item
```

---

## 4. Error Taxonomy

### 4.1 OpenRouter Errors (when provider = postqode)

| HTTP Code | Error Type | Dashboard Category |
|-----------|-----------|-------------------|
| 400 | Bad Request / Context length exceeded | `prompt_error` |
| 401 | Unauthorized / Invalid API key | `auth_error` |
| 402 | Insufficient credits | `billing_error` |
| 403 | Moderation flagged | `moderation_error` |
| 408 | Request timeout | `timeout_error` |
| 429 | Rate limited | `rate_limit_error` |
| 502 | Bad gateway / Provider down | `provider_error` |
| 503 | Service unavailable / Model busy | `availability_error` |

### 4.2 Detection Methods in Task Data

| Detection Pattern | Error Category |
|-------------------|---------------|
| `"say":"error"` event | `tool_error` — Tool execution failed |
| `cost: 0` + `tokensIn: 0` in `api_req_started` | `api_failure` — Provider-level failure |
| `[ERROR] You did not use a tool` in text | `compliance_error` — Agent didn't follow instructions |
| `[TASK RESUMPTION]` in request text | `interruption` — Task was interrupted/resumed |
| Consecutive `ask.resume_task` events | `unresponsive` — Model didn't respond |
| `modelInfo` changes between consecutive events | `model_switch` — Fallback or manual switch |
| `context_history.json` exists | `context_overflow` — Context window was trimmed |
| Long time gap (>60s) between api_req_started & next event | `possible_timeout` |

---

## 5. Dashboard Requirements

### 5.1 View: Session Explorer
- Paginated, filterable list of all tasks
- Columns: Date, Duration, Model(s), Mode, Cost, Errors, Status, Source IDE
- Filters: date range, model, mode, has-errors, has-reasoning, source
- Search by first user message (task description)
- Click to open Task Timeline

### 5.2 View: Task Timeline Explorer ⭐
- Interactive horizontal timeline per task
- Every event as a color-coded node
- Click node → expand full content in side panel
- Time gaps between events shown
- Error→retry loops highlighted visually
- Model change badges when model switches mid-task
- Running cost accumulator
- Filter by event type

### 5.3 View: Error & Failure Analytics
- Error classification breakdown (pie/donut)
- Error frequency over time (stacked area)
- Error rate by model (bar chart)
- Error-to-recovery time distribution
- Error cascade visualization
- Free vs paid model error comparison

### 5.4 View: Tool Usage Analytics
- Tool call frequency (horizontal bar)
- Tool sequences (what follows what)
- Tool success vs error rate
- Average tools per task by model
- Command types executed

### 5.5 View: Reasoning Quality Analyzer
- Only for models that emit `reasoning` events
- Reasoning length distribution
- Quality scoring (planning, evidence-first, context awareness)
- Reasoning vs outcome correlation

### 5.6 View: Model Comparison Matrix
- Dynamic — auto-discovers all models from data
- Multi-dimensional comparison table
- Radar chart visualization
- Model usage trend over time

### 5.7 View: Cost & Token Economics
- Total spend by model (donut)
- Cost per task distribution
- Token breakdown (prompt/completion/cached)
- Cache hit rate trend
- Wasted spend (cost of error calls)
- Daily/weekly burn rate

### 5.8 View: Activity → Consequence Flow
- Sankey diagram: User Request → Reasoning → Tools → Outcome
- Flow categories: happy path, error recovery, model switch, loop, abandoned

---

## 6. Non-Functional Requirements

### 6.1 Performance
- Handle 1000+ tasks without performance degradation
- SQLite caching for fast repeated queries
- Incremental processing (only new tasks on refresh)
- Stream parsing for large JSON files (>1MB)
- Max file size limit to prevent OOM

### 6.2 Configuration
- YAML config file for paths and processing controls
- Support multiple IDE source directories
- Date range and volume controls
- Config editable from dashboard UI

### 6.3 Design
- Dark mode with glassmorphism aesthetic
- Responsive layout
- Smooth micro-animations
- Inter font (Google Fonts)
- Sidebar navigation

### 6.4 Platform Support
- macOS (primary)
- Windows and Linux path support in config resolver

---

## 7. Tech Stack

| Component | Technology |
|-----------|-----------|
| Backend | Node.js + Express |
| Database/Cache | SQLite (better-sqlite3) |
| Frontend | Vite + Vanilla JS |
| Charts | Chart.js |
| Timeline/Sankey | D3.js |
| Styling | Vanilla CSS (dark mode) |
| Config | YAML (js-yaml) |
| Typography | Inter (Google Fonts) |
