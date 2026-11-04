# Plan: TTL-aware cache cost + dynamic "why this cache behavior" explanations

Status: IMPLEMENTED (see "Implementation status" at the end). The sections below are the original investigation and plan;
section 1b supersedes the first hypothesis for call #44. Based on task `1793790091972` (Opus 5.5, 69 calls, $10.824) and a scan of all 343 tasks in
`~/Library/Application Support/Code - Insiders/User/globalStorage/postqode.postqode/tasks`.

---

## 1. Why the spike at Call #44

| Call | Gap since prev call | Prompt total | Cache read | Cache write | Cost |
|------|---------------------|--------------|-----------|-------------|------|
| 43 | 27 s | 291.8K | 276.2K (95%) | 15.5K | $0.288 |
| **44** | **107 s** | 307.3K | **0 (0%)** | **307.3K (all 1h)** | **$2.496** |
| 45 | 24 s | 311.6K | 307.3K (99%) | 4.3K | $0.110 |

Facts from the logs:
- Whole prompt was re-written (cR = 0, cW = 307,316 = 100% of the prompt). A normal call in this task costs about $0.10.
- TTL was **1h**: `cacheWrite1hTokens == cacheWrites` on all 69 calls. A 107 s gap cannot expire a 1h cache, so **TTL expiry is not the cause**.
- Same model (`anthropic/claude-opus-5.5`) the whole task, so not a model switch.
- The only event between 43 and 44 is an `ask: resume_task` at 17:06:04 (task resumed from history), then a user message 53 s later.
- Cache hits resumed normally on call 45 (99%), which means the new prefix was written correctly and is stable.

Deduction: Anthropic caches by exact prefix (tools -> system -> messages). Read = 0 means the prefix diverged at or before the
FIRST cache breakpoint. A change in recent messages would still read the earlier prefix. So the change is at the very start of
the request (system prompt, tool definitions, or the first messages), not in recent turns.

[SUPERSEDED by section 1b] Original hypothesis: the `resume_task` path.
 The installed extension's `resumeTaskFromHistory()` rebuilds the conversation from
the persisted history and regenerates the in-memory system prompt, so the cached prefix no longer matches byte-for-byte.
I could NOT prove this from task files, because the system prompt is never persisted. It needs a Network Inspector capture
of the call-43 and call-44 request bodies (find the first differing byte). Other candidates to rule out the same way: mode
switch, MCP/skills/rules list changes, and the date/time or environment block moving into the system prompt.

Not just this task: across all tasks, calls right after a `resume_task` are usually fine (about 95-99% hit), but some have a
0% hit with short gaps (15 s, 24 s, 54 s, 74 s, 107 s), so resume only *sometimes* breaks the cache. This is a pattern worth a
dedicated report ("resume-induced cache invalidation").

Cost of the spike: $2.40 avoidable (22% of the task's $10.82). Had it hit, the call would have cost about $0.10.

Extra finding, 1h TTL really works: across all tasks, calls with a >5 min gap and a big prompt: 11 hits and 1 miss in the 1h era
(the miss was a 3.3 h gap, legitimately >1h) vs 5 hits and 37 misses in the 5m era. In this task, the 1h write premium cost
$2.00 but avoided about $4.76 of re-writes at >5 min gaps (net about +$2.76).

---

## 1b. Deeper investigation of call #44 (what is proven, excluded, and still unknown)

### Proven from the files on disk
| Fact | Source |
|------|--------|
| Prompt grew normally (+15.5K tokens, 291.8K -> 307.3K); history messages and persisted request text match what was sent (99.9% identical, same env timestamps) | `ui_messages.json` vs `api_conversation_history.json` |
| cR = 0 and cW = 307,316 = the ENTIRE prompt; next call (#45) read 307,316 (99%) | `api_req_started` |
| TTL 1h on every write; gap 107 s; same model, same mode, same provider id | `cacheWrite1hTokens`, `modelInfo` |
| The history had no pruning markers, no truncation, no condensation (`stripped` markers = none) | `api_conversation_history.json` |
| ContextOpt ran for the call and was REVERTED (`updates=true ... reverted=true`), so it did not change the history sent | extension log `2-PostQode.log` |
| **A TaskCancel happened and request #44 was built TWICE**: log shows `[TaskCancel] Resume ask failed ... Current ask promise was ignored`, `[Task 1793790091972] Using StandaloneTerminalManager`, `[Task] Failed to present message: PostQode instance aborted`, and `[AutoCondense] previousApiReqIndex=328` + `[ContextOpt] usage=297229` appear TWICE (second time with a different `saved=` value 0.330 -> 0.314), i.e. the first attempt was aborted and a fresh Task instance rebuilt the request | `~/Library/Application Support/Code - Insiders/logs/<session>/window1/exthost/output_logging_*/2-PostQode.log` |
| The `resume_task` ask in `ui_messages.json` is created BY the TaskCancel hook (extension code: `TaskCancel` -> `this.task.ask("resume_task")`), so it is a symptom of a cancel, not an idle wait or user "pause" | extension `dist/extension.js` |

### Excluded
- TTL expiry (1h TTL, 107 s gap).
- Model change / mode change.
- Context pruning or condensation (ContextOpt reverted, no markers).
- Normal growth of the conversation (appended messages would still read the cached prefix).
- Something in the new user message: it sits at the END of the request, after the first breakpoint.

### Why cR = 0 matters (the key discriminator)
Anthropic cache = exact prefix match in order tools -> system -> messages. The request carries `cache_control` markers on the
system message (breakpoint 1), and on the last two user messages (confirmed in a live capture: system + 2 user breakpoints,
`ttl:"1h"`). Two different failure signatures exist in the data:

| Signature | Meaning | Example |
|-----------|---------|---------|
| **cR = 0** (nothing read) | even the system+tools breakpoint missed, so system prompt/tools differed OR the request was served by a backend/account that has no cache | call #44 (this task) |
| **cR = small fixed number = size of system+tools** (15,123) and a huge write | system+tools matched, but the message prefix diverged (an earlier message was edited/pruned/reordered) | task `1793333476479` calls 27 and 52: both `cR=15123`, cW 136K / 269K, no cancel, same model |

So for #44 the difference was in (a) the system prompt or tool definitions (rebuilt by the new Task instance), or (b) which
backend served it. OpenRouter is asked for `provider.order = ["Claude Platform on AWS"]` with `allow_fallbacks: true`; if a call
falls back to another provider, the prompt cache cannot match (caches are per provider/account) and you get exactly cR = 0
with a full rewrite and full recovery on the next call. The response stream names the serving provider (`provider` field) and
the dashboard's own Network Inspector can read it.

### NOT provable from stored files (needs evidence we do not capture today)
- The system prompt and tool list are never persisted (`task_system_prompts` has only 6 rows, all from Aug-Sep).
- The Network Inspector buffer is in-memory FIFO and only covered 17:38-17:58 IST today; it had nothing at 17:06.
- So I cannot say which of (a) or (b) happened. Nothing on disk proves the user did anything wrong; the log proves a cancel
  event occurred around 17:06:00-17:06:04, right after a `task_progress` update and while the agent was running tools (an
  action that interrupts a running task, such as sending a message while it was still working, will do this). Worth asking:
  what was happening at about 17:06:00?

### Across all 343 tasks (calls with prompt > 50K tokens)
| Era | Calls | Misses (<10% read) | Notes |
|-----|-------|---------------------|-------|
| 1h | 601 | 7 (1.2%) | 1 right after a cancel (this one); 1 beyond TTL; 5 with no recorded cause |
| 5m | 4,028 | 149 (3.7%) | beyond-TTL calls miss 51% (27/53); calls after a cancel/resume miss 9% (7/80) |
Cancel/resume is a real but minor factor; most remaining misses have no cause recorded in task files, which is why the
dashboard must capture its own evidence (below) instead of guessing.

### Design: capture evidence per call so every spike can be explained exactly
Evidence sources, in order of strength:
1. **Proxy capture, persisted** (strongest). For every LLM request store a compact fingerprint in SQLite (not the 1MB body):
   `generation_id`, `served_by_provider`, `response_model`, `routing_pref (order/allow_fallbacks)`, `cache_control markers
   (position, ttl)`, `hash(tools)`, `hash(system)`, a rolling hash per message up to the first/last breakpoint, `n_messages`,
   `prompt/cached/cache_write tokens` from the response `usage`, request timestamp, and the first-diverging message index
   vs the previous request of the same task. This turns "why was it a miss" into a diff: *system changed*, *tool list changed*,
   *message N changed*, *provider changed from X to Y*, or *nothing changed (provider-side eviction)*.
2. **Extension log ingestion** (`2-PostQode.log`): parse `[TaskCancel]`, `instance aborted`, duplicate
   `[AutoCondense] previousApiReqIndex`, `[ContextOpt] ... updates= reverted=` and join them to calls by timestamp / index.
   Gives "task was cancelled and the request rebuilt" with real evidence.
3. **Task files** (always available): cR/cW signature, gap, events between calls, TTL, model/mode, history diff (pruning markers).
Classifier output states the evidence level: *Confirmed (proxy diff)*, *Strong (log events)*, *Inferred (signature only)*,
and never claims a cause that the evidence level cannot support.

Decision tree for a miss (first match wins):
1. model/mode changed -> `model_changed` / `mode_changed` (confirmed from `modelInfo`).
2. gap > TTL of the previous write -> `ttl_expired` (state the real TTL).
3. proxy fingerprint available: provider differs -> `provider_fallback`; system/tools hash differs -> `system_or_tools_changed`
   (+ which tool/section if diffable); message k differs -> `history_edited_at_k` (+ show diff, ContextOpt/condense link).
4. extension log shows TaskCancel/duplicate build between calls -> `task_rebuilt_after_cancel` (cR = 0 => system/tools/provider
   level; cR = prefix size => message level).
5. cR = system+tools size and big write -> `history_prefix_changed` (no evidence which message; show first likely edit
   via history diff).
6. else -> `unexplained_miss` with the facts (gap, TTL, signature) and "enable Network capture to find out".

---

## 2. Why the dashboard shows the wrong message (it is hardcoded and logically wrong)

Source: `server/routes/prompt-analytics.js` `computeCacheExplanation()` (~line 191) and the renderer in
`src/js/views/prompt-analytics/diff-engine.js` `renderCacheExplanationBanner()`.

Problems:
1. **Branch ignores the gap.** The `idle_wait_ttl` branch fires on ANY `ask` event between two calls (`findUserWaitGap` returns the
   first `ask`, including `resume_task`, `followup`, `completion_result`, tool approval). It never checks the gap against a TTL.
   The text then says "2 minute(s) ... exceeded the provider's ~5-minute window", which contradicts itself.
2. **Hardcoded TTL.** `FIVE_MIN_MS` is a constant, and the message text hardcodes "~5-minute". It never reads `cacheWrite1hTokens`, so it
   is wrong for every Anthropic call since the 1h change.
3. **A resume is not an idle wait.** `resume_task` means the extension rebuilt the request from history. That is a different cause
   (possible prefix invalidation), not "the user was slow".
4. **No model-specific logic.** Message text is the same for every model/provider. Only Anthropic uses explicit breakpoints with 5m/1h
   TTLs. OpenAI/Gemini/DeepSeek etc. have different semantics.
5. **Miss detection too coarse.** Only `hasWrite && !hasRead` counts as a miss. A call with 50% read and a huge write is labelled
   "partial_hit" even when it is a big spike.
6. **Gap measured wrongly.** It uses call-start to call-start, so it includes model generation and tool run time. A cache's TTL is
   refreshed by each *use*, so the correct clock is "time since this model's cache was last read or written".
7. **Cost uses one model for the whole task.** `analyticsData.modelPricing` is a single model's price (and falls back to 1.25x input
   for write), so cost/savings panels are wrong for tasks with model switches and for 1h writes (2x for Opus 5.5).
8. The pricing fallbacks in `server/model-registry.js` (e.g. `cacheWritesPrice: 3.75`, `0.30`, ...) are static single-price values.

---

## 3. Where the exact cost data comes from

Source of truth = the extension's own numbers in `ui_messages.json` -> `api_req_started.text` JSON:
`tokensIn, tokensOut, cacheWrites, cacheWrite1hTokens, cacheReads, cost` plus `modelInfo{providerId, modelId, mode}` on each message.

- `cost` is already exact. I verified on this task by least squares:
  `cost = in*$4 + out*$20 + cacheWrite(1h)*$8 + cacheRead*$0.20` per 1M tokens, max error 4e-15 across all 69 calls.
- `cacheWrite1hTokens` is a SUBSET of `cacheWrites` (5m portion = `cacheWrites - cacheWrite1hTokens`). The extension computes it
  from the provider's `cache_creation.ephemeral_1h_input_tokens`; if the provider gives no breakdown and 1h was requested, it
  assumes ALL writes are 1h, otherwise 0 (`Wls()` in the extension).
- Rates per model live in the extension's model table (`cacheWritesPrice` for 5m, `cacheWrites1hPrice`, `cacheReadsPrice`, plus
  optional context `tiers`). Examples extracted from `postqode.postqode-3.0.34-beta.1`:

| Model | input | output | write 5m | write 1h | read |
|-------|-------|--------|---------|---------|------|
| claude-opus-5-5 | 4 | 20 | 5 | 8 | 0.2 |
| claude-sonnet-5-5 | 2 | 10 | 2.5 | 4 | 0.1 |
| claude-haiku-5-5 | 0.1 | 0.5 | 0.125 | 0.2 | 0.01 |
| claude-fable-5-1 | 10 | 50 | 12.5 | 20 | 0.25 |
| claude-fable-5 | 10 | 50 | 12.5 | 20 | 1 |
| claude-sonnet-5 | 2 | 10 | 2.5 | 4 | 0.2 |
| claude-opus-4-5/4-6/4-7/4-8/5 | 5 | 25 | 6.25 | 10 | 0.5 |
| claude-sonnet-4-6 | 3 | 15 | 3.75 | 6 | 0.3 |
| claude-haiku-4-5 | 1 | 5 | 1.25 | 2 | 0.1 |

  Write multipliers (1.25x / 2x) are consistent, but the READ multiplier is NOT (0.05x, 0.025x, 0.1x). So never hardcode
  multipliers; use a per-model table.
- IDs differ: logs use `anthropic/claude-opus-5.5`, extension table uses `claude-opus-5-5`. Needs a normalizer.

How to know the TTL used for a call, in priority order:
1. `cacheWrite1hTokens > 0` on that call -> 1h (the 5m part is the remainder).
2. Call is read-only (cW = 0): inherit the TTL of the most recent write for the same model in the same task.
3. `cacheWrites > 0` and no `cacheWrite1hTokens` -> 5m (old build, or provider without 1h pricing).
4. Optional confirmation: Network Inspector capture shows `cache_control: {type:"ephemeral", ttl:"1h"}` on the request, and the
   extension setting `promptCacheTtl` (still need to find where it is stored; not found under `~/.postqode`).

---

## 4. Plan

### Phase 0: Verify the cost model against ALL data (before any UI work)
- Script: for every task and every `api_req_started`, recompute cost from the per-model rate table and compare to logged `cost`.
- Output a per-model table: calls, max error, % within 1e-6. Models that fail (tiered context pricing, non-Anthropic, OpenRouter
  BYOK, free models) are listed and get their own rules.
- Fit rates by regression per model when the table has no entry, and flag drift between fitted and table rates.

### Phase 1: Data model (server)
- `server/parser/ui-messages.js` `extractApiReqData()` (~line 388): add `cacheWrites1h`.
- `server/cache/db.js`: new columns on events: `cache_writes_1h`, `ttl` ('5m'|'1h'|'mixed'|'n/a'|'unknown'), `expected_cache_state`,
  `miss_cause`, `excess_cost`, plus cost components (`cost_in`, `cost_out`, `cost_w5m`, `cost_w1h`, `cost_read`); task totals
  `total_cache_writes_1h`. Add `ALTER TABLE ... ADD COLUMN` migration and a re-parse of existing tasks.
- New `server/pricing/cache-pricing.js`: per-model profile
  `{cacheType: 'explicit'|'automatic'|'none', write5m, write1h, read, tiers[], ttlOptions[], source}` with:
  - `normalizeModelId()` for postqode/openrouter/bedrock/vertex ids,
  - `priceCall(call)` -> components, selecting the context tier from total prompt tokens (same rule as the extension's
    `selectPriceTier`),
  - rates sourced from a checked-in `data/cache-pricing.json` (generated from the extension's table + Phase 0 fits), not from
    OpenRouter's single `input_cache_write`.
- Non-Anthropic profiles: `automatic` (OpenAI-style: no write fee, discounted read, no TTL control), Gemini (implicit vs explicit
  with storage fee), DeepSeek/Kimi/GLM, etc. Each must be verified from logs in Phase 0 before being trusted. Until verified,
  show "TTL n/a" and use only logged `cost`.

### Phase 2: Cache state machine (explains spikes correctly, handles model switches)
Track per task a set of cache "threads" keyed by `provider+model`: `{lastTouchTs, ttl, prefixTokens}`.
For each call, in order:
1. `expectedHit` = a thread for this exact model exists AND `now - lastTouchTs < ttl` (TTL is refreshed on every read or write).
2. Update the thread after the call. Switching models creates/uses a different thread; switching back within TTL may still hit.
3. Cost uses the rates of THIS call's model (not the task's model) and its own tier.
4. `excess_cost` for a miss = `cW * (writeRate - readRate)` (the extra paid vs a hit); also store the counterfactual cost.
- Gap clock = time since that thread's last touch (previous response end), not previous request start.

### Phase 3: Cause classifier -> dynamic message (per model, evidence-based)
Decision order (first match wins), each returns `{code, severity, facts{}}`, and the UI builds text from the facts:
1. `first_call` / `new_model_thread`: "no cache for <model> yet".
2. `model_changed`: cache is per model; shows from/to model and both rates; flags that cost changed rates mid-session.
3. `ttl_expired`: only if `gap > thread.ttl`; text states real values: "Last cache use for <model> was X min ago; this
   call's cache TTL is 1h (5m portion Y%); the entry expired". With 5m vs 1h counterfactual cost.
4. `resume_prefix_break`: miss (cR < ~10% of previous prompt) while within TTL AND a `resume_task` ask was between calls.
   Text: "Task was resumed from history; <gap> is well inside the <ttl> TTL, so expiry is ruled out. Nothing read from cache,
   so the prefix broke at the start (system prompt/tools) - typical when the extension rebuilds the request on resume."
   Evidence link: open Network Inspector diff for the two calls if captured.
5. `prefix_break_unknown`: miss within TTL with no resume/model/mode change. Text says exactly that, never claims TTL.
6. `partial_break`: cR > 0 but cR < previous prompt size; "cache matched only the first X% (token N), content before that
   point changed" (uses existing pruning/condensation detection).
7. `mode_changed` (plan <-> act/agent changes system prompt) if `modelInfo.mode` differs.
8. `partial_hit`, `full_hit`, `no_cache_support` (model profile says `none`).
Every message includes: model, TTL and its source (log/inherited/assumed), gap, cache state expected vs actual, and dollars:
"Cost $2.496 vs ~$0.099 if cached (excess $2.40)".
Remove the hardcoded 5-minute text entirely; all numbers come from the model profile.

### Phase 4: UI
- Banner uses the new classifier output (and dashboards the "unconfirmed" style only for genuinely unconfirmable causes).
- Cache panel (`prompt-analytics.js` ~1441-1475): show both write rates and the per-call model's rates; fix savings and
  break-even maths to use 5m/1h split and per-call model.
- Per-call TTL badge (5m / 1h / mixed), a 5m vs 1h split in Compare/Overview/Models cache columns, and a task-level "cache
  waste" summary (sum of `excess_cost`, by cause: resume, expiry, model switch, unknown).
- 1h what-if panel: premium paid vs re-writes avoided (this task: +$2.00 premium, $4.76 avoided).
- Before/after filter so pre-1h-change tasks are not compared blindly with 1h tasks.

### Phase 5: Tests
- Fixtures: task `1793790091972` (resume miss, 1h), `1793782172847` (genuine >1h expiry), `1793267480560` (Sonnet 5.5 1h), one
  5m-era task with a real TTL expiry (e.g. `1792064167732`), one model-switch task, one non-Anthropic task.
- Assertions: recomputed cost == logged cost per call; classifier cause per known spike; no message mentions a TTL that does not match
  the call's actual TTL.

### Open questions / things to confirm
1. Capture the actual request bodies for a resume (Network Inspector) to confirm the system-prompt/tools divergence.
2. Where is `promptCacheTtl` stored (settings UI/global state)? Needed to show configured-vs-observed TTL.
3. Do any logged models bill by context tier (>200K tokens)? Phase 0 will reveal this from cost mismatches.
4. Non-Anthropic providers: confirm the write/read/TTL behavior from logs before enabling their profiles.
5. Should the resume cache-break be reported to the extension team? It cost $2.40 in this one task.

---

## Implementation status

| Plan item | Where | Notes |
|-----------|-------|-------|
| Capture 1h writes | `server/parser/ui-messages.js`, `server/cache/db.js` | `events.cache_writes_1h`, `has_cache_1h_field`, `tasks.total_cache_writes_1h` (migrations are additive) |
| Dynamic pricing, no hard-coded model data | `server/model-registry.js`, `server/pricing/cache-pricing.js` | Catalogs = extension cache files + live OpenRouter (`input_cache_write_1h`, tiers). The old family-inference prices and the "sonnet" fuzzy hack are removed. Strict id lookup (no substring matching). |
| Calibration against logged cost | `server/pricing/calibrate.js` | catalog -> fitted (least squares, catalog fills unexercised rates) -> unmodeled (logged cost only) |
| Per-model cache threads, TTL, cause classifier, messages | `server/analytics/cache-analysis.js` | Evidence levels: confirmed / recorded / inferred. Unknown TTL never produces an "expired" claim. |
| Evidence capture | `server/analytics/cache-fingerprint.js`, `fingerprint-match.js`, `extension-log.js`, `cache-service.js`; proxy hook in `server/proxy/index.js`; tables `llm_request_fingerprints`, `llm_prompt_variants`, `extension_log_events` | Join keys: exact prompt tokens (proxy) and `previousApiReqIndex` (extension log) |
| Route + UI | `server/routes/prompt-analytics.js`, `src/js/views/prompt-analytics.js`, `prompt-analytics/diff-engine.js` | `cacheAnalysis` + per-call `cache`; waste-by-cause card; TTL column; spike markers in Step Jump; banner with evidence level |
| Tests | `tests/cache-analysis.test.js` (`npm test`) | Synthetic catalog only |
| Tools | `scripts/verify-cache-cost.js`, `try-cache-analysis.js`, `backfill-fingerprints.js` | |

Bugs found and fixed on the way:
- Context-size line collapsed to the system-prompt size on a full-rewrite call (cache writes were not counted). It now uses the provider-reported prompt size.
- `cacheHitPct` ignored cache writes (call #42 showed 100% instead of 98.9%).
- The top cost panel and cache panel used hard-coded fallback prices (3.0 / 15.0 / 3.75 / 1.25x) and a single task-level model; they now use per-call, per-model priced components.

Results on this machine (206 tasks, 5,558 logged calls): 100% of Opus 5.5 calls (1,529) reproduce exactly from the live catalog including 1h writes;
price changes over time (a cache-read price cut on another model) are absorbed by calibration; about 31% of calls (providers with their own cache billing,
e.g. OpenAI-style / Gemini implicit caching) cannot be reproduced from a token-rate formula, so they keep the logged cost and get no TTL maths.

Confirmed example: task `1793782172847`, call #51 - enabling subagents mid-session added 4 tools (`task_create`, `task_output`, `task_stop`, `use_subagents`)
and +296 chars of system prompt, which invalidated a 239K-token prefix ($0.93 extra). Proven by diffing the two proxy-captured requests.

Still open: for task `1793790091972` call #44 the proxy had not captured the requests, so the cause is recorded as "request rebuilt after a cancel" (the extension log
shows the request built twice) but whether the system prompt, tools or serving provider differed cannot be proven. Keep the Network Inspector running to capture it next time.
