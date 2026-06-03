# Session Behavioral Testing — Phase 3 Requirements

> **Version:** 3.0  
> **Created:** 2026-06-03  
> **Updated:** 2026-06-03  
> **Branch:** `feature/session-testing-phase-3`  
> **Status:** Draft  
> **Depends on:** Phase 2 (Session Behavioral Testing v2.0 — complete)

---

## 1. Overview

### 1.1 What Phase 2 Delivered

Phase 2 established standalone editable baselines, contextual tool sequences, failed tool detection, session test improvements (interruption tracking, completion messages, ratings), and an enhanced deep compare view.

### 1.2 Phase 3 Goals

Phase 3 introduces three targeted enhancements to the baseline curation and test scoring system:

| # | Area | Summary |
|---|------|---------|
| 1 | **Essential Tools** | Expected tools gain an `is_essential` flag. Essential tools that aren't used in a tested session cause a score penalty. Non-essential tools that aren't used are simply noted — no penalty. |
| 2 | **Essential Contract Keywords** | Contract keywords gain an `is_essential` flag. Essential keywords missing from output cause a penalty. Non-essential keywords missing are just noted. |
| 3 | **Excluded Files** | A new baseline category for file path patterns the agent should NOT have accessed. If any tool call in a tested session touches a matching path, it's a scope violation with score penalty. |

### 1.3 Design Principle (Unchanged)

All tests remain **deterministic and heuristic** — no secondary LLM calls. Phase 3 extends the data model and scoring logic while keeping everything computed from the existing event trace.

---

## 2. Essential Tools

### 2.1 Problem

Currently, all tools in the `expected_tools` list are treated equally. If a tool is listed as expected but the tested session doesn't use it, the TIA (Tool Invocation Assertion) score drops proportionally. This is too strict — some tools are nice-to-have (e.g., `searchFiles` to explore before editing) while others are critical (e.g., `editedExistingFile` to actually make the change).

### 2.2 Solution

Each expected tool gets an `is_essential` boolean flag:

- **Essential** (`is_essential: true`): The tool MUST be used in the session. Missing it causes a score penalty.
- **Optional** (`is_essential: false`): The tool is nice-to-have. Missing it is noted in evidence but doesn't penalize the score.

### 2.3 Data Model

**`expected_tools` changes from `string[]` to `Array<{name: string, is_essential: boolean}>`**

```typescript
// Before (Phase 2)
expected_tools: string[];  // ["readFile", "editedExistingFile", "searchFiles"]

// After (Phase 3)
expected_tools: Array<{
  name: string;
  is_essential: boolean;  // true = must be used, false = nice-to-have
}>;
// Example:
// [
//   { name: "readFile", is_essential: true },
//   { name: "editedExistingFile", is_essential: true },
//   { name: "searchFiles", is_essential: false }
// ]
```

### 2.4 Baseline Editor UI

In the Expected Tools dual-list, each tool item gets a checkbox:

```
EXPECTED TOOLS (Should use)
┌─────────────────────────────────────┐
│ ☑ readFile                    [×]   │  ← Essential (checked)
│ ☑ editedExistingFile          [×]   │  ← Essential (checked)
│ ☐ searchFiles                 [×]   │  ← Optional (unchecked)
│ [+ Add tool...]                     │
└─────────────────────────────────────┘
```

**Interaction:**
- Checkbox toggles `is_essential` between `true` and `false`
- Visual distinction: essential items have a subtle left border or badge; optional items are slightly muted
- When adding a new tool, it defaults to `is_essential: true`
- Move buttons (➔ ➐) work the same as before

### 2.5 TIA Scoring Update

**Current scoring (Phase 2):**
```
baseScore = (matched / expected.length) * 100
score = baseScore - (excludedUsed * 20)
```

**New scoring (Phase 3):**
```
// Separate essential and optional tools
const essentialExpected = expected.filter(t => t.is_essential);
const optionalExpected = expected.filter(t => !t.is_essential);

// Essential coverage: must match ALL essential tools
const essentialMatched = essentialExpected.filter(t => actual.includes(t.name));
const essentialMissing = essentialExpected.filter(t => !actual.includes(t.name));
const essentialScore = essentialExpected.length > 0
  ? (essentialMatched.length / essentialExpected.length) * 100
  : 100;

// Optional coverage: nice-to-have, no penalty for missing
const optionalMatched = optionalExpected.filter(t => actual.includes(t.name));

// Combined score
let score = essentialScore;  // Start with essential coverage
// Optional tools don't reduce score, but unexpected tools still do
if (unexpected.length > 0) score *= 0.85;
score = Math.max(0, score - (excludedUsed.length * 20));
```

**Evidence updates:**
- Essential tools section: shows which essential tools were matched/missing
- Optional tools section: shows which optional tools were matched/missing (informational only)
- Missing essential tools are marked as `severity: 'critical'`
- Missing optional tools are marked as `severity: 'info'`

### 2.6 API Changes

**`PUT /api/baselines/:id`** — `expected_tools` now accepts objects:
```json
{
  "expected_tools": [
    { "name": "readFile", "is_essential": true },
    { "name": "editedExistingFile", "is_essential": true },
    { "name": "searchFiles", "is_essential": false }
  ]
}
```

**Backward compatibility:** If `expected_tools` is sent as plain strings (legacy), treat all as `is_essential: true`.

---

## 3. Essential Contract Keywords

### 3.1 Problem

Currently, all keywords in `behavior_contract.output_keywords` are treated as required. If any keyword is missing from the agent's output, the BCV (Behavior Contract Validation) score drops. This is too strict — some keywords are critical (e.g., "error" in a debugging task) while others are contextual (e.g., "project" in a review task).

### 3.2 Solution

Each contract keyword gets an `is_essential` boolean flag:

- **Essential** (`is_essential: true`): The keyword MUST appear in the output. Missing it causes a score penalty.
- **Optional** (`is_essential: false`): The keyword is nice-to-have. Missing it is noted but doesn't penalize.

### 3.3 Data Model

**`behavior_contract.output_keywords` changes from `string[]` to `Array<{word: string, is_essential: boolean}>`**

```typescript
// Before (Phase 2)
output_keywords: string[];  // ["project", "review", "structure", "files"]

// After (Phase 3)
output_keywords: Array<{
  word: string;
  is_essential: boolean;  // true = must appear, false = nice-to-have
}>;
// Example:
// [
//   { word: "project", is_essential: true },
//   { word: "review", is_essential: true },
//   { word: "structure", is_essential: false },
//   { word: "files", is_essential: false }
// ]
```

### 3.4 Baseline Editor UI

In the Contract Keywords dual-list, each keyword item gets a checkbox:

```
CONTRACT KEYWORDS (Should appear)
┌─────────────────────────────────────┐
│ ☑ project                    [×]   │  ← Essential (checked)
│ ☑ review                     [×]   │  ← Essential (checked)
│ ☐ structure                  [×]   │  ← Optional (unchecked)
│ ☐ files                      [×]   │  ← Optional (unchecked)
│ [+ Add keyword...]                  │
└─────────────────────────────────────┘
```

**Interaction:**
- Checkbox toggles `is_essential` between `true` and `false`
- Visual distinction: essential items have a subtle indicator; optional items are slightly muted
- When adding a new keyword, it defaults to `is_essential: true`

### 3.5 BCV Scoring Update

**Current scoring (Phase 2):**
```
// All keywords treated equally
missing = output_keywords.filter(k => !output.includes(k))
checks.push(check(missing.length <= ceil(keywords.length / 2), ...))
score = (passed / checks.length) * 100
```

**New scoring (Phase 3):**
```
// Separate essential and optional keywords
const essentialKeywords = contract.output_keywords.filter(k => k.is_essential);
const optionalKeywords = contract.output_keywords.filter(k => !k.is_essential);

// Essential keywords: ALL must be present
const essentialMissing = essentialKeywords.filter(k => !output.includes(k.word));
const essentialScore = essentialKeywords.length > 0
  ? ((essentialKeywords.length - essentialMissing.length) / essentialKeywords.length) * 100
  : 100;

// Optional keywords: noted but don't penalize
const optionalFound = optionalKeywords.filter(k => output.includes(k.word));

// Combined: essential score drives the keyword portion
let keywordScore = essentialScore;
// Other checks (code block, length, forbidden) still apply normally
```

**Evidence updates:**
- Essential keywords section: shows matched/missing with severity
- Optional keywords section: shows matched/missing (informational, severity: 'info')
- Missing essential keywords are marked as `severity: 'critical'`
- Missing optional keywords are marked as `severity: 'info'`

### 3.6 API Changes

**`PUT /api/baselines/:id`** — `behavior_contract.output_keywords` now accepts objects:
```json
{
  "behavior_contract": {
    "output_keywords": [
      { "word": "project", "is_essential": true },
      { "word": "review", "is_essential": true },
      { "word": "structure", "is_essential": false }
    ],
    "excluded_keywords": ["TODO", "placeholder"]
  }
}
```

**Backward compatibility:** If `output_keywords` is sent as plain strings (legacy), treat all as `is_essential: true`.

---

## 4. Excluded Files

### 4.1 Problem

Currently, scope enforcement (BSE pattern) only checks for unknown tools and destructive commands. There's no way to say "the agent should not have accessed this specific file or directory." This is critical for:
- Preventing agents from reading sensitive files (`.env`, `secrets.yaml`, `credentials.json`)
- Enforcing read-only boundaries (agent should not write to certain directories)
- Blocking access to specific paths in multi-tenant or sandboxed environments

### 4.2 Solution

A new "Excluded Files" section in the baseline editor. Users define file path patterns (exact paths, glob patterns, or directory prefixes). During testing, the BSE pattern scans all tool calls for file path matches against these patterns.

### 4.3 Data Model

**New field on `baselines` table:**

```typescript
excluded_files: string[];  // File path patterns the agent should NOT access
// Examples:
// ["**/.env", "**/secrets.yaml", "**/credentials.json"]
// ["src/internal/**", "server/admin/**"]
// [".env", "secrets/"]
```

**SQLite column:** `excluded_files_json TEXT` (JSON array of strings)

### 4.4 Baseline Editor UI

A new section in the baseline editor, styled like the existing dual-lists but simpler (single list with add/remove):

```
EXCLUDED FILES (Agent should NOT access)
┌─────────────────────────────────────┐
│ **/.env                      [×]   │
│ **/secrets.yaml              [×]   │
│ src/internal/**              [×]   │
│ [+ Add file pattern...]             │
└─────────────────────────────────────┘

💡 Supports glob patterns: **/.env, *.key, src/internal/**
```

**Interaction:**
- Single list (not dual-list — files are only excluded, not "expected")
- Each item has a delete button (×)
- Add button opens inline input with placeholder showing pattern examples
- Patterns are stored as-is (no validation — user is responsible for valid glob/regex)

### 4.5 BSE Scoring Update

**Current BSE checks:**
1. Unknown tools → critical violation
2. Destructive commands → critical violation
3. Failed tools → warning
4. Max tool calls → warning

**New BSE check (added):**
5. **Excluded files accessed** → critical violation

**Implementation:**
```javascript
// In runBSE, after existing checks:
if (rules.scope_enforcement?.check_excluded_files && baseline?.excluded_files?.length) {
  const excludedPatterns = baseline.excluded_files;
  for (const e of tools) {
    const filePath = parseToolTarget(e);
    if (filePath && matchesExcludedPattern(filePath, excludedPatterns)) {
      findings.push(evidence('violation', 'Excluded file accessed', 
        `${e.tool_name} → ${filePath}`, 'critical'));
    }
  }
}
```

**Pattern matching logic:**
```javascript
function matchesExcludedPattern(filePath, patterns) {
  const lower = filePath.toLowerCase();
  for (const pattern of patterns) {
    const lowerPattern = pattern.toLowerCase();
    // Exact match
    if (lower === lowerPattern) return true;
    // Glob: **/pattern matches anywhere in path
    if (lowerPattern.startsWith('**/')) {
      const suffix = lowerPattern.slice(3);
      if (lower.endsWith(suffix) || lower.includes('/' + suffix)) return true;
    }
    // Glob: pattern/** matches directory prefix
    if (lowerPattern.endsWith('/**')) {
      const prefix = lowerPattern.slice(0, -2);
      if (lower.startsWith(prefix)) return true;
    }
    // Glob: *.ext matches files with extension
    if (lowerPattern.includes('*')) {
      const regex = new RegExp('^' + lowerPattern.replace(/\*/g, '.*') + '$');
      if (regex.test(lower)) return true;
    }
    // Substring match (fallback)
    if (lower.includes(lowerPattern)) return true;
  }
  return false;
}
```

**Scoring impact:**
- Each excluded file access: -25 points (same as unknown tool)
- Multiple accesses to the same file: counted once (deduplicated by file path)

### 4.6 Test Results Display

In the Session Test view, excluded files violations appear in the BSE evidence section:

```
┌─ Scope Enforcement ─────────── ❌ FAIL (45%) ─────────┐
│  ✓ All tool calls use known tools                      │
│  ✓ No destructive commands detected                    │
│  ✗ EXCLUDED FILE ACCESSED: readFile → .env             │
│  ✗ EXCLUDED FILE ACCESSED: readFile → secrets.yaml     │
│  ✓ All operations within workspace                     │
└────────────────────────────────────────────────────────┘
```

In Deep Compare, the BSE row shows excluded files violations per session.

### 4.7 API Changes

**`PUT /api/baselines/:id`** — New field:
```json
{
  "excluded_files": ["**/.env", "**/secrets.yaml", "src/internal/**"]
}
```

**`POST /api/baselines`** — Accepts `excluded_files` in creation body (defaults to `[]`).

---

## 5. Updated Data Model Summary

### 5.1 Baseline Table Changes

```sql
-- New column for excluded files
ALTER TABLE baselines ADD COLUMN excluded_files_json TEXT;  -- JSON array of file path patterns
```

### 5.2 Full Baseline Interface (Phase 3)

```typescript
interface Baseline {
  id: string;                    // Independent UUID
  source_task_id: string;        // Reference to source session
  name: string;                  // User-given name
  description: string;           // Task description
  tags: string[];                // User-defined tags
  created_at: number;
  updated_at: number;
  model_id: string;
  source: string;
  activity_category: string;
  contributing_sessions: string[];

  // Benchmark Set
  prompts: Array<{
    index: number;
    text: string;
    ts: number;
    response_preview: string;
    tools_after: string[];
  }>;

  // Phase 3: Expected tools with essential flags
  expected_tools: Array<{
    name: string;
    is_essential: boolean;
  }>;

  excluded_tools: string[];

  // Phase 3: Excluded files (NEW)
  excluded_files: string[];

  tool_sequence: Array<{
    index: number;
    tool_name: string;
    file_path: string | null;
    command: string | null;
    description: string;
    is_essential: boolean;
  }>;

  behavior_contract: {
    has_code_block: boolean;
    // Phase 3: Keywords with essential flags
    output_keywords: Array<{
      word: string;
      is_essential: boolean;
    }>;
    excluded_keywords: string[];
    output_min_length: number;
    output_max_length: number;
  };

  failed_tools: Array<{
    tool_name: string;
    error_message: string;
    error_category: string;
    count: number;
  }>;

  completion_message: string | null;
  reference_metrics: { ... };
}
```

### 5.3 Backward Compatibility

Since the user will delete existing data, we don't need migration logic. However, the code should handle both formats gracefully:

- **Legacy format:** `expected_tools: string[]` → treat all as `is_essential: true`
- **Legacy format:** `output_keywords: string[]` → treat all as `is_essential: true`
- **New format:** `expected_tools: Array<{name, is_essential}>` → use flags
- **New format:** `output_keywords: Array<{word, is_essential}>` → use flags

---

## 6. Updated Test Scoring

### 6.1 TIA (Tool Invocation Assertion) — Phase 3

| Component | Weight | Logic |
|-----------|--------|-------|
| Essential tool coverage | 70% | `(essential_matched / essential_expected) * 100` |
| Unexpected tools penalty | -15% | Applied if unexpected tools found |
| Excluded tools penalty | -20% each | Applied per excluded tool used |
| Optional tools | 0% | Noted in evidence, no score impact |

**Status thresholds:**
- PASS: ≥ 80 (all essential tools matched, no excluded tools)
- WARN: 40–79 (some essential missing or unexpected tools)
- FAIL: < 40 (most essential missing or excluded tools used)

### 6.2 BCV (Behavior Contract Validation) — Phase 3

| Component | Weight | Logic |
|-----------|--------|-------|
| Essential keyword coverage | 50% | `(essential_matched / essential_expected) * 100` |
| Code block check | 15% | Pass/fail |
| Length check | 15% | Pass/fail |
| Forbidden/excluded keywords | 20% | Pass/fail |
| Optional keywords | 0% | Noted in evidence, no score impact |

**Status thresholds:**
- PASS: ≥ 80 (all essential keywords + other checks pass)
- WARN: 40–79 (some essential missing or minor check failures)
- FAIL: < 40 (most essential missing or forbidden keywords found)

### 6.3 BSE (Boundary/Scope Enforcement) — Phase 3

| Check | Penalty | Severity |
|-------|---------|----------|
| Unknown tool | -35 | critical |
| Destructive command | -35 | critical |
| Excluded file accessed | -25 | critical (NEW) |
| Failed tool attempt | -15 | warning |
| Max tool calls exceeded | -15 | warning |

**Status thresholds:**
- PASS: ≥ 80 (no critical violations)
- WARN: 40–79 (warnings only)
- FAIL: < 40 (critical violations)

### 6.4 Overall Score Weights (Unchanged)

| Pattern | Weight |
|---------|--------|
| TIA | 25% |
| BCV | 15% |
| MTV | 20% |
| BSE | 20% |
| ERC | 10% |
| CEC | 10% |

Interruption penalty applies on top (unchanged from Phase 2).

---

## 7. Implementation Plan

### 7.1 Backend Files Modified

| File | Changes |
|------|---------|
| `server/cache/db.js` | Add `excluded_files_json` column to `baselines` table |
| `server/baselines/extract.js` | Default `is_essential: true` for all extracted tools/keywords |
| `server/testing/tia.js` | Essential-aware scoring: separate essential/optional tool matching |
| `server/testing/bcv.js` | Essential-aware scoring: separate essential/optional keyword matching |
| `server/testing/bse.js` | Add excluded files check with pattern matching |
| `server/testing/shared.js` | Add `matchesExcludedPattern()` helper function |
| `server/routes/baselines.js` | Handle new payload structures with backward compatibility |

### 7.2 Frontend Files Modified

| File | Changes |
|------|---------|
| `src/js/views/baseline-editor.js` | Add `is_essential` checkboxes to expected tools and contract keywords; add Excluded Files section |
| `src/js/views/test.js` | Display essential coverage details in TIA/BCV results; display excluded files violations in BSE |
| `src/js/views/deep-compare.js` | Show essential coverage % and excluded files violations in comparison table |

### 7.3 No New Files Required

All changes are modifications to existing files. No new server or frontend files are needed.

---

## 8. Detailed Implementation Specs

### 8.1 `server/cache/db.js`

Add migration for new column:
```javascript
'ALTER TABLE baselines ADD COLUMN excluded_files_json TEXT',
```

### 8.2 `server/baselines/extract.js`

Update `extractBenchmarkSet` to include `is_essential` flags:

```javascript
// Expected tools: all marked essential by default
expected_tools: expectedTools.map(name => ({ name, is_essential: true })),

// Output keywords: all marked essential by default
output_keywords: topKeywords(finalOutput, 8).map(word => ({ word, is_essential: true })),

// Excluded files: starts empty
excluded_files: [],
```

### 8.3 `server/testing/tia.js`

```javascript
function runTIA(task, events, rules, baseline) {
  const actual = [...new Set(toolEvents(events).map(e => e.tool_name))];
  
  // Parse expected tools (handle both legacy strings and new objects)
  const expectedRaw = baseline?.expected_tools?.length
    ? baseline.expected_tools
    : inferExpectedTools(task.first_message || '', rules.tool_invocation?.custom_mappings || []);
  
  const expected = expectedRaw.map(t => typeof t === 'string' ? { name: t, is_essential: true } : t);
  const essentialExpected = expected.filter(t => t.is_essential);
  const optionalExpected = expected.filter(t => !t.is_essential);
  const excluded = baseline?.excluded_tools || [];

  // Essential tool coverage
  const essentialMatched = essentialExpected.filter(t => actual.includes(t.name));
  const essentialMissing = essentialExpected.filter(t => !actual.includes(t.name));
  const essentialScore = essentialExpected.length > 0
    ? Math.round((essentialMatched.length / essentialExpected.length) * 100)
    : 100;

  // Optional tool coverage (informational)
  const optionalMatched = optionalExpected.filter(t => actual.includes(t.name));
  const optionalMissing = optionalExpected.filter(t => !actual.includes(t.name));

  // Unexpected tools
  const expectedNames = expected.map(t => t.name);
  const unexpected = actual.filter(t => !expectedNames.includes(t) && !excluded.includes(t));

  // Excluded tools
  const excludedUsed = excluded.filter(t => actual.includes(t));

  // Final score
  let score = essentialScore;
  if (unexpected.length > 0) score = Math.round(score * 0.85);
  score = Math.max(0, score - excludedUsed.length * 20);

  // Evidence
  const ev = [];
  if (essentialExpected.length) {
    ev.push(evidence('expected', 'Essential tools', essentialExpected.map(t => t.name + (t.is_essential ? ' *' : '')).join(', ')));
    ev.push(evidence(essentialMissing.length ? 'violation' : 'info', 'Essential matched', 
      `${essentialMatched.length}/${essentialExpected.length}`, essentialMissing.length ? 'critical' : 'info'));
    if (essentialMissing.length) {
      ev.push(evidence('violation', 'Essential tools MISSING', essentialMissing.map(t => t.name).join(', '), 'critical'));
    }
  }
  if (optionalExpected.length) {
    ev.push(evidence('info', 'Optional tools', optionalExpected.map(t => t.name).join(', ')));
    ev.push(evidence('info', 'Optional matched', `${optionalMatched.length}/${optionalExpected.length}`));
    if (optionalMissing.length) {
      ev.push(evidence('info', 'Optional tools not used', optionalMissing.map(t => t.name).join(', ')));
    }
  }
  ev.push(evidence('actual', 'Actual tools', actual.join(', ') || '-'));
  if (unexpected.length) {
    ev.push(evidence('violation', 'Unexpected tools', unexpected.join(', '), 'warning'));
  }
  if (excluded.length) {
    ev.push(evidence('info', 'Excluded tools', excluded.join(', ')));
    if (excludedUsed.length) {
      ev.push(evidence('violation', 'Excluded tools USED', excludedUsed.join(', '), 'critical'));
    }
  }

  // Status
  let status;
  if (essentialMissing.length > 0 || excludedUsed.length > 0) {
    status = 'fail';
  } else if (unexpected.length > 0 || optionalMissing.length > 0) {
    status = 'warn';
  } else {
    status = normalizeStatus(score);
  }

  return result(status, score, ev,
    baseline ? 'Compared against baseline expected/excluded tool sets (essential-aware).' : 'Compared against heuristic keyword mapping.');
}
```

### 8.4 `server/testing/bcv.js`

```javascript
function runBCV(task, events, rules, baseline) {
  const output = getFinalOutput(events);
  if (!output) return result('skip', 0, [evidence('info', 'Output', 'No final output captured')], 'No final response was available.');

  const contract = baseline?.behavior_contract || inferContract(task, rules);
  if (!contract || Object.keys(contract).length === 0) {
    return result('skip', 0, [evidence('info', 'Contract', 'No behavior contract defined')], 'No contract rules applied.');
  }

  const checks = [];
  const outputLower = output.toLowerCase();

  // Parse keywords (handle both legacy strings and new objects)
  const rawKeywords = contract.output_keywords || [];
  const keywords = rawKeywords.map(k => typeof k === 'string' ? { word: k, is_essential: true } : k);
  const essentialKeywords = keywords.filter(k => k.is_essential);
  const optionalKeywords = keywords.filter(k => !k.is_essential);

  // Essential keywords: ALL must be present
  if (essentialKeywords.length > 0) {
    const essentialMissing = essentialKeywords.filter(k => !outputLower.includes(k.word.toLowerCase()));
    const essentialFound = essentialKeywords.filter(k => outputLower.includes(k.word.toLowerCase()));
    checks.push({
      ok: essentialMissing.length === 0,
      label: 'essential_keywords',
      value: essentialMissing.length 
        ? `Missing: ${essentialMissing.map(k => k.word).join(', ')}` 
        : `All ${essentialFound.length} essential keywords found`,
      severity: essentialMissing.length ? 'critical' : 'info',
      weight: 50
    });
  }

  // Optional keywords: informational only
  if (optionalKeywords.length > 0) {
    const optionalFound = optionalKeywords.filter(k => outputLower.includes(k.word.toLowerCase()));
    checks.push({
      ok: true,  // Never fails
      label: 'optional_keywords',
      value: `${optionalFound.length}/${optionalKeywords.length} optional keywords found: ${optionalFound.map(k => k.word).join(', ')}`,
      severity: 'info',
      weight: 0  // No score impact
    });
  }

  // Other checks (unchanged)
  if (contract.has_code_block) {
    checks.push({ ok: /```/.test(output), label: 'has_code_block', value: /```/.test(output) ? 'Code block found' : 'No code block', severity: /```/.test(output) ? 'info' : 'warning', weight: 15 });
  }
  if (contract.output_min_length || contract.min_length) {
    const min = contract.output_min_length || contract.min_length;
    checks.push({ ok: output.length >= min, label: 'min_length', value: `${output.length} chars, minimum ${min}`, severity: output.length >= min ? 'info' : 'warning', weight: 15 });
  }
  if (contract.output_max_length || contract.max_length) {
    const max = contract.output_max_length || contract.max_length;
    checks.push({ ok: output.length <= max, label: 'max_length', value: `${output.length} chars, maximum ${max}`, severity: output.length <= max ? 'info' : 'warning', weight: 15 });
  }
  if (contract.forbidden_phrases?.length || contract.forbidden?.length) {
    const forbidden = contract.forbidden_phrases || contract.forbidden;
    const found = forbidden.filter(k => outputLower.includes(k.toLowerCase()));
    checks.push({ ok: found.length === 0, label: 'forbidden', value: found.length ? `Found: ${found.join(', ')}` : 'None found', severity: found.length ? 'critical' : 'info', weight: 20 });
  }
  if (contract.excluded_keywords?.length) {
    const found = contract.excluded_keywords.filter(k => outputLower.includes(k.toLowerCase()));
    checks.push({ ok: found.length === 0, label: 'excluded_keywords', value: found.length ? `Found excluded: ${found.join(', ')}` : 'None found', severity: found.length ? 'critical' : 'info', weight: 20 });
  }

  if (!checks.length) return result('skip', 0, [evidence('info', 'Contract', 'No applicable checks')], 'Contract had no applicable rules.');

  // Weighted scoring
  const weightedChecks = checks.filter(c => c.weight > 0);
  const totalWeight = weightedChecks.reduce((s, c) => s + c.weight, 0);
  const weightedScore = weightedChecks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
  const score = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0;

  return result(normalizeStatus(score), score, checks.map(c => evidence(c.ok ? 'info' : 'violation', c.label, c.value, c.severity || 'info')), 'Validated final output against structural contract (essential-aware).');
}
```

### 8.5 `server/testing/bse.js`

Add excluded files check:

```javascript
const { matchesExcludedPattern } = require('./shared');

function runBSE(task, events, rules, baseline, registry = []) {
  // ... existing code ...

  // Phase 3: Excluded files check
  if (rules.scope_enforcement?.check_excluded_files && baseline?.excluded_files?.length) {
    const excludedFiles = baseline.excluded_files;
    const accessedFiles = new Set();
    
    for (const e of tools) {
      const filePath = parseToolTarget(e);
      if (filePath && matchesExcludedPattern(filePath, excludedFiles)) {
        accessedFiles.add(filePath);
      }
    }
    
    for (const filePath of accessedFiles) {
      findings.push(evidence('violation', 'Excluded file accessed', 
        `File: ${filePath}`, 'critical'));
    }
  }

  // ... rest of existing code ...
}
```

### 8.6 `server/testing/shared.js`

Add pattern matching helper:

```javascript
function matchesExcludedPattern(filePath, patterns) {
  if (!patterns || !patterns.length) return false;
  const lower = filePath.toLowerCase();
  for (const pattern of patterns) {
    const lowerPattern = pattern.toLowerCase().trim();
    if (!lowerPattern) continue;
    
    // Exact match
    if (lower === lowerPattern) return true;
    
    // Glob: **/pattern matches anywhere in path
    if (lowerPattern.startsWith('**/')) {
      const suffix = lowerPattern.slice(3);
      if (lower.endsWith(suffix) || lower.includes('/' + suffix)) return true;
    }
    
    // Glob: pattern/** matches directory prefix
    if (lowerPattern.endsWith('/**')) {
      const prefix = lowerPattern.slice(0, -2);
      if (lower.startsWith(prefix)) return true;
    }
    
    // Glob: *.ext matches files with extension
    if (lowerPattern.includes('*')) {
      const regexStr = '^' + lowerPattern.replace(/\*/g, '[^/]*') + '$';
      try {
        if (new RegExp(regexStr).test(lower)) return true;
      } catch (e) { /* invalid regex, skip */ }
    }
    
    // Substring match (fallback)
    if (lower.includes(lowerPattern)) return true;
  }
  return false;
}

// Export the new function
module.exports = {
  // ... existing exports ...
  matchesExcludedPattern,
};
```

### 8.7 `server/routes/baselines.js`

Update `saveBaseline` to handle new `excluded_files`:

```javascript
// In saveBaseline, add to INSERT:
excluded_files_json: JSON.stringify(benchmark.excluded_files),

// In PUT handler, add:
if (req.body.excluded_files !== undefined) updates.excluded_files_json = JSON.stringify(req.body.excluded_files);
```

Update `parseBaseline` to parse `excluded_files`:

```javascript
function parseBaseline(row) {
  return {
    ...row,
    // ... existing parsing ...
    excluded_files: parse(row.excluded_files_json, []),
  };
}
```

### 8.8 `src/js/views/baseline-editor.js`

**Expected Tools section** — Add checkbox per item:

```html
<div class="dual-list-item" data-tool-idx="${idx}" data-list="expected">
  <label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex:1">
    <input type="checkbox" data-tool-essential="${idx}" ${t.is_essential ? 'checked' : ''} />
    <span>${escHtml(t.name)}</span>
  </label>
  <span class="delete-btn" ...>×</span>
</div>
```

**Contract Keywords section** — Add checkbox per item:

```html
<div class="dual-list-item" data-kw-idx="${idx}" data-list="required">
  <label style="display:flex;align-items:center;gap:6px;cursor:pointer;flex:1">
    <input type="checkbox" data-kw-essential="${idx}" ${k.is_essential ? 'checked' : ''} />
    <span>${escHtml(k.word)}</span>
  </label>
  <span class="delete-btn" ...>×</span>
</div>
```

**New Excluded Files section:**

```html
<div class="panel" style="margin-top:20px">
  <div class="panel-title">Excluded Files (Agent should NOT access)</div>
  <div class="panel-body">
    <p class="view-subtitle" style="margin-bottom:12px">
      Define file path patterns the agent should not access. Supports glob patterns: 
      <code>**/.env</code>, <code>*.key</code>, <code>src/internal/**</code>
    </p>
    <div id="excluded-files-list">
      ${state.excluded_files.map((f, idx) => `
        <div class="dual-list-item" data-file-idx="${idx}" style="display:flex;justify-content:space-between;align-items:center;width:100%;max-width:500px">
          <span class="mono" style="font-size:12px">${escHtml(f)}</span>
          <span class="delete-btn" data-delete-file="${idx}" style="color:var(--red);cursor:pointer;font-weight:bold;padding:0 4px;font-size:14px">×</span>
        </div>
      `).join('')}
    </div>
    <div class="dual-list-input-group" style="max-width:500px;margin-top:8px">
      <input type="text" id="new-file-input" class="filter-input" placeholder="e.g. **/.env, secrets.yaml, src/internal/**" style="flex:1" />
      <button id="add-file-btn" class="action-btn">Add Pattern</button>
    </div>
  </div>
</div>
```

**State initialization:**

```javascript
const state = {
  // ... existing state ...
  excluded_files: [...(baseline.excluded_files || [])],
  // Transform expected_tools and output_keywords to new format
  expected_tools: (baseline.expected_tools || []).map(t => 
    typeof t === 'string' ? { name: t, is_essential: true } : t
  ),
  behavior_contract: {
    ...baseline.behavior_contract,
    output_keywords: (baseline.behavior_contract?.output_keywords || []).map(k =>
      typeof k === 'string' ? { word: k, is_essential: true } : k
    ),
  },
};
```

**Save payload:**

```javascript
const payload = {
  name: state.name,
  description: state.description,
  tags: state.tags,
  expected_tools: state.expected_tools,  // Now objects with is_essential
  excluded_tools: state.excluded_tools,
  excluded_files: state.excluded_files,  // NEW
  tool_sequence: state.tool_sequence,
  behavior_contract: state.behavior_contract,  // output_keywords now objects
};
```

**Event bindings for new elements:**

```javascript
// Tool essential checkboxes
document.querySelectorAll('[data-tool-essential]').forEach(el => {
  el.addEventListener('change', () => {
    const idx = parseInt(el.dataset.toolEssential);
    state.expected_tools[idx].is_essential = el.checked;
  });
});

// Keyword essential checkboxes
document.querySelectorAll('[data-kw-essential]').forEach(el => {
  el.addEventListener('change', () => {
    const idx = parseInt(el.dataset.kwEssential);
    state.behavior_contract.output_keywords[idx].is_essential = el.checked;
  });
});

// File deletion
document.querySelectorAll('[data-delete-file]').forEach(el => {
  el.addEventListener('click', () => {
    const idx = parseInt(el.dataset.deleteFile);
    state.excluded_files.splice(idx, 1);
    render();
  });
});

// File addition
document.getElementById('add-file-btn')?.addEventListener('click', () => {
  const input = document.getElementById('new-file-input');
  const val = input.value.trim();
  if (val && !state.excluded_files.includes(val)) {
    state.excluded_files.push(val);
    render();
  }
});
```

### 8.9 `src/js/views/test.js`

**TIA result rendering** — Show essential/optional breakdown:

```javascript
// In renderResult, enhance TIA evidence display:
// - Essential tools: critical severity for missing
// - Optional tools: info severity for missing
// The backend already returns properly tagged evidence, so the existing 
// renderResult function will display them correctly with color coding.
```

**BSE result rendering** — Show excluded files violations:

```javascript
// The BSE evidence already includes excluded files violations from the backend.
// No UI changes needed in test.js — the existing evidence list will show them.
```

### 8.10 `src/js/views/deep-compare.js`

**BSE row detail modal** — Show excluded files info:

```javascript
// In showRowDetailsModal, for metric === 'bse':
// Add excluded files section to the baseline info box:
${metric === 'bse' && baseline?.excluded_files?.length ? `
  <div style="background:var(--bg-3); padding:10px; border-radius:4px; margin-bottom:14px; font-size:11px">
    <strong>Excluded Files:</strong> 
    ${(baseline.excluded_files || []).map(f => `<code class="mono">${escHtml(f)}</code>`).join(', ') || 'None'}
  </div>
` : ''}
```

---

## 9. Test Rules Configuration Update

### 9.1 Updated `test-rules.yaml`

```yaml
# PQ Dashboard - Behavioral Test Rules (Phase 3)

tool_invocation:
  enabled: true
  check_excluded_tools: true
  essential_threshold: 80        # NEW: minimum essential tool coverage for PASS
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
  check_excluded_keywords: true
  essential_keyword_threshold: 80  # NEW: minimum essential keyword coverage for PASS
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
  mode: essential_steps
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
  check_failed_tools: true
  check_excluded_files: true      # NEW: enable excluded files check
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

interruptions:
  enabled: true
  penalty_thresholds:
    minor: 2
    moderate: 5
    severe: 6
  penalty_amounts:
    minor: 5
    moderate: 15
    severe: 25

failed_tools:
  enabled: true
  categories:
    - mcp_not_connected
    - missing_params
    - tool_execution_error
    - unknown_tool

completion_rating:
  enabled: true
  show_in_comparison: true

weights:
  tia: 25
  bcv: 15
  mtv: 20
  bse: 20
  erc: 10
  cec: 10
```

---

## 10. Verification Plan

### 10.1 Automated Tests

```bash
# Build verification
npm run build

# API endpoint smoke tests
curl http://localhost:3456/api/baselines         # List baselines
curl -X POST http://localhost:3456/api/baselines  # Create baseline
curl -X PUT http://localhost:3456/api/baselines/:id  # Edit with essential flags + excluded files
curl http://localhost:3456/api/test-rules          # Get updated rules
```

### 10.2 Manual Verification

1. **Create Baseline:** Select a session → Derive Baseline → verify all tools/keywords have `is_essential: true` by default
2. **Edit Essential Flags:** Toggle some tools/keywords to non-essential → Save → verify persistence
3. **Add Excluded Files:** Add patterns like `**/.env` → Save → verify stored correctly
4. **Test with Essential Tools:** Test a session where an essential tool is missing → verify score penalty
5. **Test with Optional Tools:** Test a session where an optional tool is missing → verify no penalty, just note
6. **Test Excluded Files:** Test a session that accessed `.env` → verify BSE failure with excluded file violation
7. **Test Non-Matching Files:** Test a session that accessed `src/app.js` when only `.env` is excluded → verify no violation
8. **Deep Compare:** Verify essential coverage and excluded files appear in comparison table
9. **Backward Compatibility:** Test with legacy baseline data (plain string arrays) → verify no errors

---

## 11. Migration Notes

### 11.1 Fresh Start

The user will delete existing data from the `data/` folder. This means:
- No existing baselines to migrate
- No existing test results to migrate
- The `excluded_files_json` column will be created fresh via `ALTER TABLE`
- All new baselines will use the Phase 3 data model from the start

### 11.2 Code Backward Compatibility

Even though data is fresh, the code should still handle both formats gracefully for robustness:

- **`expected_tools`**: If element is a string, treat as `{name: string, is_essential: true}`
- **`output_keywords`**: If element is a string, treat as `{word: string, is_essential: true}`
- **`excluded_files`**: If missing/null, treat as `[]`

This ensures the code works correctly even if:
- A baseline was created before Phase 3 deployment
- API calls from older frontend versions send legacy formats
- Test results reference baselines with old data structures

---

## 12. Relationship to Phase 2

| Phase 2 Component | Phase 3 Status |
|-------------------|----------------|
| `baselines` table | Extended with `excluded_files_json` column |
| `expected_tools` | Enhanced: each entry now has `is_essential` flag |
| `output_keywords` | Enhanced: each entry now has `is_essential` flag |
| `excluded_tools` | Unchanged |
| `excluded_keywords` | Unchanged |
| TIA pattern | Enhanced: essential-aware scoring |
| BCV pattern | Enhanced: essential-aware scoring |
| BSE pattern | Enhanced: excluded files check added |
| MTV pattern | Unchanged |
| ERC pattern | Unchanged |
| CEC pattern | Unchanged |
| Baseline Editor | Enhanced: essential checkboxes + excluded files section |
| Session Test view | Enhanced: essential coverage display |
| Deep Compare view | Enhanced: excluded files in BSE details |

---

## 13. User Rating Integration (Score Impact)

### 13.1 Problem

The user rating (1–5 stars) is captured and displayed in the Session Test view and Deep Compare, but it has **no effect on the overall score**. The `overall_score` is computed purely from weighted pattern scores minus interruption penalties. This means a session rated 1 star (poor output) and a session rated 5 stars (excellent output) can have identical overall scores if their automated test results are the same.

### 13.2 Solution

Blend the user rating into the overall score as a "human judgment" modifier. The rating acts as a sanity check on the automated scoring — if the automated score and user rating disagree significantly, the blended score reflects both perspectives.

### 13.3 Scoring Formula

**Test Suite (`server/testing/index.js`):**
```
baseScore = weighted average of pattern scores (TIA, BCV, MTV, BSE, ERC, CEC)
interruptionPenalty = 0–25 (based on interruption count)
automatedScore = baseScore - interruptionPenalty

// User rating blend (only if rating exists)
if (userRating !== null) {
  ratingNormalized = (userRating / 5) * 100  // Convert 1–5 to 0–100
  overallScore = round((automatedScore * 0.7) + (ratingNormalized * 0.3))
} else {
  overallScore = automatedScore
}
```

**Weights:**
- Automated score: 70% — deterministic, repeatable, pattern-based
- User rating: 30% — subjective human judgment of output quality

**Deep Compare (`calculateOverallIndex`):**
```
behavioralScore = tests.overall_score (already includes rating blend from test suite)
operationalScore = weighted average of cost, duration, tools, errors
overallIndex = round((behavioralScore * 0.6) + (operationalScore * 0.4))
```

Since `tests.overall_score` already includes the rating blend, deep compare inherits it automatically.

### 13.4 Rating Impact Examples

| Automated Score | User Rating | Rating Normalized | Blended Overall |
|----------------|-------------|-------------------|-----------------|
| 90% | ★★★★★ (5) | 100% | **93%** (90×0.7 + 100×0.3) |
| 90% | ★★★☆☆ (3) | 60% | **81%** (90×0.7 + 60×0.3) |
| 90% | ★☆☆☆☆ (1) | 20% | **69%** (90×0.7 + 20×0.3) |
| 60% | ★★★★★ (5) | 100% | **72%** (60×0.7 + 100×0.3) |
| 60% | ★☆☆☆☆ (1) | 20% | **48%** (60×0.7 + 20×0.3) |
| (no rating) | — | — | **automatedScore** (unchanged) |

### 13.5 Implementation

**`server/testing/index.js`** — Update `runTestSuite`:
```javascript
// After computing baseScore and penalty:
const automatedScore = Math.max(0, baseScore - penalty);

// Blend with user rating if available
let overallScore = automatedScore;
if (suite.user_rating !== null && suite.user_rating !== undefined) {
  const ratingNormalized = (suite.user_rating / 5) * 100;
  overallScore = Math.round((automatedScore * 0.7) + (ratingNormalized * 0.3));
}
```

**`src/js/views/test.js`** — Display rating impact:
```javascript
// In the score hero section, show the blend:
${suite.user_rating ? `
  <div style="font-size:11px;color:var(--text-3);margin-top:4px">
    (includes -${suite.interruption_penalty}% interruption penalty, 
     rating: ${'★'.repeat(suite.user_rating)}${'☆'.repeat(5-suite.user_rating)} 
     → blended at 70/30)
  </div>
` : suite.interruption_penalty > 0 ? `
  <div style="font-size:11px;color:var(--text-3);margin-top:4px">(includes -${suite.interruption_penalty}% interruption penalty)</div>
` : ''}
```

**`src/js/views/deep-compare.js`** — No changes needed — the blended score flows through `tests.overall_score`.

### 13.6 Re-rating Behavior

When a user changes their rating:
1. `PUT /api/test-results/:id/rate` updates `user_rating` in the database
2. The next time the test result is viewed, `runTestSuite` re-fetches the latest rating and recomputes the blended score
3. In deep compare, the next refresh picks up the updated `overall_score`

No re-run of behavioral tests is needed — only the score calculation changes.

---

## 14. Design Decisions
## 14. Design Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| 1 | `expected_tools` as objects `{name, is_essential}` instead of separate arrays | Single source of truth. No risk of arrays getting out of sync. Simpler API payload. |
| 2 | `output_keywords` as objects `{word, is_essential}` instead of separate arrays | Same rationale as #1. Consistent data model across tools and keywords. |
| 3 | Excluded files as simple string array (not objects) | No need for flags on excluded items — they're all violations if matched. Keeps UI simple. |
| 4 | Glob pattern matching (not full regex) | Users think in terms of file paths and globs, not regex. `**/.env` is intuitive; `.*\.env` is not. |
| 5 | Essential tools drive TIA score; optional tools are informational | Reflects real-world usage: missing a critical tool is a real failure; missing a nice-to-have tool is not. |
| 6 | Essential keywords drive BCV score; optional keywords are informational | Same rationale as #5. Critical keywords must appear; contextual keywords are bonus. |
| 7 | Excluded files penalty = -25 (between unknown tool -35 and failed tool -15) | File access violations are serious but not as severe as using a completely fabricated tool. |
| 8 | Backward compatibility in code (not just data) | Defensive programming. Handles edge cases from API version mismatches or partial deployments. |
| 9 | Fresh data approach (no migration) | Simplifies implementation. User explicitly asked for this. |
| 10 | Default all extracted tools/keywords as essential | Conservative default — users can mark items as optional if they want. Safer to require everything initially. |
| 11 | Rating blended at 70% automated / 30% human | Automated scores are deterministic and repeatable, but human judgment catches what patterns miss. 70/30 gives human input meaningful influence without overriding automated results. |
