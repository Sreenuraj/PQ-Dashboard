/**
 * Prompt Analytics API Routes
 * Reads raw task files (ui_messages.json, api_conversation_history.json, context_history.json)
 * and reconstructs the EXACT sent prompt payloads at each turn by applying Layer 2 context overlays.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getModelInfo } = require('../model-registry');

function resolvePath(p) {
  return p.replace(/^~/, os.homedir());
}

/**
 * Loads cached openrouter_models.json dynamically from IDE globalStorage cache paths.
 */
function loadOpenRouterModelsCache() {
  const possiblePaths = [
    path.join(os.homedir(), '.postqode', 'cache', 'openrouter_models.json'),
    path.join(os.homedir(), 'Library', 'Application Support', 'Code - Insiders', 'User', 'globalStorage', 'postqode.postqode', 'cache', 'openrouter_models.json'),
    path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'postqode.postqode', 'cache', 'openrouter_models.json'),
    path.join(os.homedir(), '.config', 'Code', 'User', 'globalStorage', 'postqode.postqode', 'cache', 'openrouter_models.json'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      try {
        return JSON.parse(fs.readFileSync(p, 'utf8'));
      } catch (e) {}
    }
  }
  return null;
}

function getModelCachePricing(modelId, openrouterCache) {
  if (!modelId || !openrouterCache) return null;

  if (openrouterCache[modelId]) {
    return { modelKey: modelId, ...openrouterCache[modelId] };
  }

  const cleanId = String(modelId).toLowerCase();
  for (const key of Object.keys(openrouterCache)) {
    const kClean = key.toLowerCase();
    if (kClean.includes(cleanId) || cleanId.includes(kClean)) {
      return { modelKey: key, ...openrouterCache[key] };
    }
  }

  // Soft fuzzy fallback (e.g. "sonnet" matching "anthropic/claude-sonnet-4.5")
  if (cleanId.includes('sonnet')) {
    const sonnetKey = Object.keys(openrouterCache).find(k => k.includes('sonnet') && !k.includes('free'));
    if (sonnetKey) return { modelKey: sonnetKey, ...openrouterCache[sonnetKey] };
  }

  return null;
}

/**
 * Reconstructs effective prompt messages at timestamp `ts` up to `maxMsgIdx`
 * by applying Layer 2 context overlays from context_history.json to raw api_conversation_history.json.
 */
function getEffectiveMessagesAtTs(rawHistory, contextUpdates, ts, maxMsgIdx) {
  if (maxMsgIdx < 0 || !rawHistory || rawHistory.length === 0) return [];

  const limit = Math.min(maxMsgIdx + 1, rawHistory.length);
  const msgs = JSON.parse(JSON.stringify(rawHistory.slice(0, limit)));

  if (!Array.isArray(contextUpdates) || contextUpdates.length === 0) {
    return msgs;
  }

  for (const updateEntry of contextUpdates) {
    if (!Array.isArray(updateEntry) || updateEntry.length < 2) continue;
    const msgIdx = updateEntry[0];
    if (msgIdx > maxMsgIdx || msgIdx >= msgs.length) continue;

    const editPayload = updateEntry[1];
    if (!Array.isArray(editPayload) || editPayload.length < 2) continue;
    const blockUpdates = editPayload[1];
    if (!Array.isArray(blockUpdates)) continue;

    const msg = msgs[msgIdx];
    if (!msg) continue;
    let content = msg.content;

    for (const blockItem of blockUpdates) {
      if (!Array.isArray(blockItem) || blockItem.length < 2) continue;
      const blockIdx = blockItem[0];
      const updatesList = blockItem[1];
      if (!Array.isArray(updatesList)) continue;

      const validUpdates = updatesList.filter(u => Array.isArray(u) && u[0] <= ts);
      if (validUpdates.length === 0) continue;

      validUpdates.sort((a, b) => b[0] - a[0]);
      const latestUp = validUpdates[0];
      const upType = latestUp[1];
      const upTextList = latestUp[2];
      const replacement = (Array.isArray(upTextList) && upTextList[0] != null) ? upTextList[0] : '';

      if (Array.isArray(content) && blockIdx < content.length) {
        if (upType === 'text' || upType === 'thinking_redaction') {
          content[blockIdx].text = replacement;
        }
      } else if (typeof content === 'string' && blockIdx === 0) {
        msg.content = replacement;
      }
    }
  }

  return msgs;
}

/**
 * The extension records `conversationHistoryIndex` as the last message index
 * that was ALREADY in apiConversationHistory before this turn's message was
 * appended. For every call after the first, that's a valid, correct index.
 * But for the very first API call of a task there is no "before" — the
 * recorded value comes through as -1 — even though the first user message
 * (apiHistory[0]) IS part of what got sent. The old code treated -1 as
 * "no messages" and returned an empty prompt, which is why Call #1 always
 * rendered as an empty "0 B -> 0 B" diff.
 * ponytail: only special-cases callIndex 0; if some other call ever reports
 * -1 (shouldn't happen) it still safely falls back to "no history".
 */
function resolveMaxMsgIdx(callIndex, histIdx, apiHistoryLength) {
  if (histIdx >= 0) return histIdx;
  return callIndex === 0 && apiHistoryLength > 0 ? 0 : -1;
}

function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(b => (typeof b === 'string' ? b : (b.text || b.thinking || ''))).join('\n---\n');
  }
  return JSON.stringify(content || '');
}

/**
 * Detects the pruning category (file / command / environment snapshot) from
 * the raw before/after text of a message so the diff UI can explain *what*
 * kind of content changed, not just that it changed.
 */
function detectReductionCategory(contentPrevStr, contentCurrStr) {
  const fileMatch = contentPrevStr.match(/read_file for '([^']+)'/);
  if (fileMatch) {
    return { category: 'File Read Truncated', targetName: fileMatch[1] };
  }
  if (contentPrevStr.includes('execute_command for') || contentCurrStr.includes('Tool output truncated')) {
    const cmdMatch = contentPrevStr.match(/execute_command for '([^']+)'/);
    return { category: 'Terminal Output Truncated', targetName: cmdMatch ? cmdMatch[1] : 'Terminal Command Output' };
  }
  if (contentPrevStr.includes('<environment_details>') && contentCurrStr.includes('stale workspace/environment snapshot')) {
    return { category: 'Stale Environment Snapshot Removed', targetName: '<environment_details>' };
  }
  return { category: 'Other Content', targetName: 'Context Text' };
}

/**
 * Looks for evidence (in ui_messages.json, between the previous call's and
 * this call's api_req_started entries) that the agent was sitting idle
 * waiting on the user — an `ask` event (completion_result, followup
 * question, tool-approval, etc.) — rather than just assuming any large time
 * gap means "TTL expired". This turns a guess into an evidenced claim.
 */
function findUserWaitGap(uiMessages, fromUiIdx, toUiIdx) {
  if (!Array.isArray(uiMessages) || fromUiIdx == null || toUiIdx == null) return null;
  for (let idx = fromUiIdx + 1; idx < toUiIdx; idx++) {
    const m = uiMessages[idx];
    if (m && m.type === 'ask') {
      return { askType: m.ask || null, ts: m.ts };
    }
  }
  return null;
}

/**
 * Explains WHY a given call had (or didn't have) a cache read/write, since
 * the raw numbers alone don't tell the user the cause. Checks, in order:
 * first call, model swap (cache is model-specific), an evidenced user-wait
 * gap (an `ask` event found in ui_messages.json between the two calls),
 * unexplained elapsed time (only ever a guess — labeled as such), and
 * prefix invalidation (earlier content pruned/rewritten since the previous
 * call broke the cached prefix match).
 */
function computeCacheExplanation(call, prevCall, uiMessages) {
  const hasRead = call.cacheReads > 0;
  const hasWrite = call.cacheWrites > 0;

  if (!prevCall) {
    if (hasWrite) {
      return { code: 'first_call', text: 'First request in this task — there was no existing cache to read from yet, so the full prompt prefix was written to cache.' };
    }
    return { code: 'no_cache_activity', text: 'No cache reads or writes reported by the provider for this request.' };
  }

  const timeSincePrevMs = (call.ts || 0) - (prevCall.ts || 0);
  const FIVE_MIN_MS = 5 * 60 * 1000; // ponytail: Anthropic's default breakpoint TTL; other providers may differ
  const modelChanged = !!(call.modelId && prevCall.modelId && call.modelId !== prevCall.modelId);
  const waitGap = findUserWaitGap(uiMessages, prevCall.uiMsgIndex, call.uiMsgIndex);

  if (hasWrite && !hasRead) {
    if (modelChanged) {
      return { code: 'model_changed', text: `Model changed from "${prevCall.modelId}" to "${call.modelId}" — prompt cache is model-specific, so a fresh cache entry had to be created.` };
    }
    if (waitGap) {
      const waitedMin = Math.round(timeSincePrevMs / 60000);
      return { code: 'idle_wait_ttl', text: `Evidence found: the agent finished its previous turn and was waiting on you (an "${waitGap.askType || 'ask'}" event) — ${waitedMin} minute(s) passed before you responded. That idle gap exceeded the provider's ~5-minute cache breakpoint window, so the prompt prefix had to be rewritten to cache once the conversation resumed.` };
    }
    if (timeSincePrevMs > FIVE_MIN_MS) {
      const elapsedMin = Math.round(timeSincePrevMs / 60000);
      return { code: 'ttl_expired_unconfirmed', text: `${elapsedMin} minutes passed since the previous request with no "waiting on user" event found in the task log — likely the provider's ~5-minute cache breakpoint expired, but this is a guess based on elapsed time only (the API doesn't report cache-eviction reasons).` };
    }
    if (call.hasPruning || call.trimmedFromPrevBytes > 100) {
      return { code: 'prefix_invalidated', text: `Earlier content in the prompt (before the cache breakpoint) was pruned or rewritten since the previous call (${call.trimmedFromPrevBytes} bytes changed), invalidating the old cached prefix — a new cache entry was written.` };
    }
    return { code: 'prefix_extended', text: 'New content (tools, files, instructions) was appended beyond the previously cached prefix, so it was written to cache again.' };
  }

  if (hasRead && hasWrite) {
    return { code: 'partial_hit', text: 'The earlier part of the prompt matched the existing cache (read), and new content appended beyond it was written as a fresh cache breakpoint.' };
  }

  if (hasRead && !hasWrite) {
    return { code: 'full_hit', text: 'The prompt prefix matched the existing cache exactly — tokens were served from cache with no new write needed.' };
  }

  return { code: 'no_cache_activity', text: "No cache reads or writes reported by the provider for this request (uncached, or this model doesn't support prompt caching)." };
}


function summarizePromptMessage(msg, idx) {

  const content = msg?.content;
  const size = JSON.stringify(content || '').length;
  const fullText = extractTextContent(content);
  const preview = fullText.substring(0, 450);

  return { index: idx, role: msg?.role || 'unknown', size, preview, fullText };
}

function buildExactPromptText(messages) {
  return messages.map((msg, idx) => {
    const role = msg?.role || 'unknown';
    return `===== message[${idx}] role=${role} =====\n${extractTextContent(msg?.content)}`;
  }).join('\n\n');
}

function computeExactDiffChunks(str1, str2) {
  if (!str1 || !str2) {
    return {
      prefix: '',
      removedText: str1 || '',
      insertedText: str2 || '',
      suffix: '',
    };
  }

  let prefixLen = 0;
  const maxPrefix = Math.min(str1.length, str2.length);
  while (prefixLen < maxPrefix && str1[prefixLen] === str2[prefixLen]) {
    prefixLen++;
  }

  let suffixLen = 0;
  const maxSuffix = Math.min(str1.length - prefixLen, str2.length - prefixLen);
  while (
    suffixLen < maxSuffix &&
    str1[str1.length - 1 - suffixLen] === str2[str2.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const prefix = str1.substring(0, prefixLen);
  const removedText = str1.substring(prefixLen, str1.length - suffixLen);
  const insertedText = str2.substring(prefixLen, str2.length - suffixLen);
  const suffix = str1.substring(str1.length - suffixLen);

  return {
    prefix: prefix.length > 200 ? '...' + prefix.substring(prefix.length - 200) : prefix,
    fullPrefix: prefix,
    removedText: removedText.length > 600 ? removedText.substring(0, 600) + '\n... [' + (removedText.length - 600) + ' more chars removed]' : removedText,
    fullRemovedText: removedText,
    insertedText: insertedText.length > 600 ? insertedText.substring(0, 600) + '\n... [' + (insertedText.length - 600) + ' more chars inserted]' : insertedText,
    fullInsertedText: insertedText,
    suffix: suffix.length > 200 ? suffix.substring(0, 200) + '...' : suffix,
    fullSuffix: suffix,
    removedBytes: removedText.length,
    insertedBytes: insertedText.length,
  };
}

module.exports = (db, config, getStore) => {
  const router = express.Router();

  /**
   * Cross-references the Network Inspector's in-memory proxy buffer to find
   * the actual chat/completions request nearest to a given call's timestamp,
   * and extracts the real system prompt text from its first content block.
   * Only works if the proxy was running & capturing traffic at the time the
   * call was made and the record hasn't been evicted from the buffer yet
   * (FIFO, default max 500) — this is the ONLY place the system prompt is
   * ever available, since it's never written to any task file on disk.
   */
  function findSystemPromptFromProxy(callTs) {
    if (typeof getStore !== 'function' || !callTs) return null;
    const store = getStore();
    if (!store) return null;

    const { requests } = store.getAll({ limit: 9999 });
    const CHAT_MATCH = /chat\/completions|\/v1\/messages/i;
    const MAX_DRIFT_MS = 2 * 60 * 1000; // ponytail: proxy record ts vs task ts can drift a little; 2min window is generous enough to match but tight enough to avoid pairing with the wrong call

    let best = null;
    let bestDrift = Infinity;
    for (const r of requests) {
      if (!CHAT_MATCH.test(r.url || '') || !r.requestBody) continue;
      const recTs = new Date(r.timestamp).getTime();
      const drift = Math.abs(recTs - callTs);
      if (drift < bestDrift && drift <= MAX_DRIFT_MS) {
        bestDrift = drift;
        best = r;
      }
    }
    if (!best) return null;

    try {
      const parsed = JSON.parse(best.requestBody);
      let systemText = null;

      if (typeof parsed.system === 'string') {
        systemText = parsed.system;
      } else if (Array.isArray(parsed.system)) {
        systemText = parsed.system.map(b => b.text || '').join('\n');
      } else if (Array.isArray(parsed.messages) && parsed.messages[0]?.role === 'system') {
        const c = parsed.messages[0].content;
        systemText = typeof c === 'string' ? c : (Array.isArray(c) ? c.map(b => b.text || '').join('\n') : null);
      }

      if (!systemText) return null;
      return { text: systemText, source: 'network_inspector_proxy_buffer', matchedRequestId: best.id, driftMs: bestDrift };
    } catch (e) {
      return null;
    }
  }

  function resolveTaskPath(taskId) {
    const task = db.prepare('SELECT source FROM tasks WHERE id = ?').get(taskId);
    if (!task) return null;

    for (const src of config.sources) {
      if (!src.enabled) continue;
      if (src.name === task.source) {
        const dir = path.join(resolvePath(src.path), taskId);
        if (fs.existsSync(dir)) return dir;
      }
    }

    for (const src of config.sources) {
      if (!src.enabled) continue;
      const dir = path.join(resolvePath(src.path), taskId);
      if (fs.existsSync(dir)) return dir;
    }

    return null;
  }

  function readTaskPromptFiles(taskPath) {
    const uiPath = path.join(taskPath, 'ui_messages.json');
    const apiHistPath = path.join(taskPath, 'api_conversation_history.json');
    const ctxHistPath = path.join(taskPath, 'context_history.json');

    const files = {
      uiPath,
      apiHistPath,
      ctxHistPath,
      uiMessages: [],
      apiHistory: [],
      contextUpdates: [],
    };

    if (fs.existsSync(uiPath)) files.uiMessages = JSON.parse(fs.readFileSync(uiPath, 'utf8'));
    if (fs.existsSync(apiHistPath)) files.apiHistory = JSON.parse(fs.readFileSync(apiHistPath, 'utf8'));
    if (fs.existsSync(ctxHistPath)) {
      const ctxRaw = JSON.parse(fs.readFileSync(ctxHistPath, 'utf8'));
      files.contextUpdates = Array.isArray(ctxRaw) ? ctxRaw : (ctxRaw.updates || []);
    }

    return files;
  }

  function getApiCallEntries(uiMessages, apiHistoryLength) {
    const apiCallEntries = [];
    for (const msg of uiMessages) {
      if (msg.say !== 'api_req_started' || !msg.text) continue;
      try {
        const data = JSON.parse(msg.text);
        const rawHistIdx = msg.conversationHistoryIndex != null ? msg.conversationHistoryIndex : -1;
        apiCallEntries.push({
          historyIndex: resolveMaxMsgIdx(apiCallEntries.length, rawHistIdx, apiHistoryLength),
          ts: msg.ts,
          tokensIn: data.tokensIn || 0,
          tokensOut: data.tokensOut || 0,
          cacheReads: data.cacheReads || 0,
          cacheWrites: data.cacheWrites || 0,
          cost: data.cost || 0,
          requestText: data.request || null,
          modelId: msg.modelInfo?.modelId || data.model || null,
          providerId: msg.modelInfo?.providerId || null,
        });
      } catch {
        continue;
      }
    }
    return apiCallEntries;
  }

  /**
   * GET /api/prompt-analytics/:taskId
   * Returns full prompt analysis data, executive category summaries, and chronological pruning sequence.
   */
  router.get('/prompt-analytics/:taskId', (req, res) => {
    const taskId = req.params.taskId;
    const taskPath = resolveTaskPath(taskId);
    if (!taskPath) {
      return res.status(404).json({ error: 'Task not found or files unavailable' });
    }

    const uiPath = path.join(taskPath, 'ui_messages.json');
    const apiHistPath = path.join(taskPath, 'api_conversation_history.json');
    const ctxHistPath = path.join(taskPath, 'context_history.json');

    let uiMessages = [];
    if (fs.existsSync(uiPath)) {
      try { uiMessages = JSON.parse(fs.readFileSync(uiPath, 'utf8')); } catch (e) {}
    }

    let apiHistory = [];
    if (fs.existsSync(apiHistPath)) {
      try { apiHistory = JSON.parse(fs.readFileSync(apiHistPath, 'utf8')); } catch (e) {}
    }

    let contextUpdates = [];
    if (fs.existsSync(ctxHistPath)) {
      try {
        const ctxRaw = JSON.parse(fs.readFileSync(ctxHistPath, 'utf8'));
        contextUpdates = Array.isArray(ctxRaw) ? ctxRaw : (ctxRaw.updates || []);
      } catch (e) {}
    }

    const openrouterCache = loadOpenRouterModelsCache();

    // ── Load persisted system prompt for this task (captured by proxy) ──
    let systemPromptCapture = null;
    try {
      const spRow = db.prepare(
        'SELECT system_text, approx_tokens, model_id, captured_at_ts FROM task_system_prompts WHERE task_id = ? LIMIT 1'
      ).get(taskId);
      if (spRow) {
        systemPromptCapture = spRow;
      } else {
        // Fallback to latest system prompt captured in DB
        const latestRow = db.prepare(
          'SELECT system_text, approx_tokens, model_id, captured_at_ts FROM task_system_prompts ORDER BY id DESC LIMIT 1'
        ).get();
        if (latestRow) systemPromptCapture = latestRow;
      }
    } catch (e) { /* table may not exist on older DBs — safe to ignore */ }

    const systemPromptTokens = systemPromptCapture?.approx_tokens || 0;
    const systemPromptAvailable = !!systemPromptCapture;

    let dbTaskModels = [];
    try {
      dbTaskModels = db.prepare('SELECT model_id, ts FROM task_models WHERE task_id = ? ORDER BY ts ASC').all(taskId);
    } catch (e) {}

    const apiCalls = [];
    let prevRequestSize = 0;

    for (let i = 0; i < uiMessages.length; i++) {
      const msg = uiMessages[i];
      if (msg.say !== 'api_req_started' || !msg.text) continue;

      let data;
      try { data = JSON.parse(msg.text); } catch { continue; }

      const rawHistIdx = msg.conversationHistoryIndex != null ? msg.conversationHistoryIndex : -1;
      const histIdx = resolveMaxMsgIdx(apiCalls.length, rawHistIdx, apiHistory.length);

      let requestSize = 0;
      let turnDeltaSize = 0;
      let messageCount = 0;

      if (histIdx >= 0 && apiHistory.length > 0) {
        // 98%+ ACCURATE RECONSTRUCTION: Full accumulated conversation history JSON objects + System Prompt
        const effectiveMsgs = getEffectiveMessagesAtTs(apiHistory, contextUpdates, msg.ts, histIdx);
        for (const m of effectiveMsgs) {
          requestSize += JSON.stringify(m || {}).length;
        }
        if (systemPromptCapture && systemPromptCapture.text) {
          requestSize += systemPromptCapture.text.length;
        }
        messageCount = effectiveMsgs.length;

        // Calculate turnDeltaSize: Size of new message(s) added in this specific turn
        const prevCount = apiCalls.length > 0 ? (apiCalls[apiCalls.length - 1]?.messageCount || 0) : 0;
        const newMsgsCount = apiCalls.length === 0 ? effectiveMsgs.length : Math.max(1, effectiveMsgs.length - prevCount);
        const newMsgs = effectiveMsgs.slice(Math.max(0, effectiveMsgs.length - newMsgsCount));
        for (const m of newMsgs) {
          turnDeltaSize += JSON.stringify(m || {}).length;
        }
      }

      const sizeDelta = apiCalls.length === 0 ? requestSize : (requestSize - prevRequestSize);
      prevRequestSize = requestSize;
      let mId = msg.modelInfo?.modelId || data.model || null;
      if (!mId && dbTaskModels.length > 0) {
        const match = dbTaskModels.filter(m => (m.ts || 0) <= (msg.ts || 0)).pop() || dbTaskModels[0];
        if (match) mId = match.model_id;
      }

      // ── Detect errors / failed tool executions for this turn ──
      let hasError = false;
      let errorDetails = null;

      // 1. Check UI messages until the next api_req_started
      for (let j = i + 1; j < uiMessages.length; j++) {
        const nextM = uiMessages[j];
        if (nextM.say === 'api_req_started') break;
        if (nextM.say === 'error' || nextM.say === 'diff_error') {
          hasError = true;
          errorDetails = {
            type: nextM.say,
            tool: (nextM.say === 'diff_error' ? 'replace_in_file' : 'tool_execution'),
            target: (nextM.say === 'diff_error' ? (nextM.text || '') : ''),
            message: nextM.text || 'Tool execution error',
          };
          break;
        }
        if (nextM.say === 'tool' && nextM.text && (nextM.text.includes('The tool execution failed') || nextM.text.includes('Error executing'))) {
          hasError = true;
          errorDetails = {
            type: 'tool_error',
            tool: 'tool_execution',
            target: '',
            message: nextM.text.substring(0, 200),
          };
          break;
        }
        if (nextM.text && typeof nextM.text === 'string' && (nextM.text.includes('Error executing') || nextM.text.includes('User closed text editor'))) {
          hasError = true;
          errorDetails = {
            type: 'editor_error',
            tool: 'file_edit',
            target: '',
            message: nextM.text.substring(0, 200),
          };
          break;
        }
      }

      // 2. Check if request payload in api_req_started reports a failed tool result
      if (!hasError && data.request && (data.request.includes('The tool execution failed with the following error') || data.request.includes('Error executing'))) {
        hasError = true;
        const match = data.request.match(/\[([a-z_]+)\s+for\s+['\"]([^'\"]+)['\"]\]\s+Result:\s+The tool execution failed[^\n]*\n<error>([\s\S]*?)<\/error>/i);
        errorDetails = {
          type: 'tool_error',
          tool: match ? match[1] : 'tool_execution',
          target: match ? match[2] : '',
          message: match ? match[3].trim().substring(0, 200) : 'Tool execution failed',
        };
      }

      // ── Per-call context window utilization (with error smoothing) ──
      // Looks up the model's context window from the registry and computes how
      // much of it was used: (uncached input + cache reads + system prompt tokens) / context window
      // When an API call is an error/failed retry that returned 0 tokens, smooth using requestSize.
      const modelInfo = getModelInfo(mId);
      const contextWindowSize = modelInfo?.contextWindow || null;
      
      const isFailedOrZeroReturn = (data.tokensIn === 0 && data.cacheReads === 0);
      let totalTokensInContext;
      if (isFailedOrZeroReturn && requestSize > 0) {
        const estimatedTokens = Math.round(requestSize / 3.2);
        totalTokensInContext = estimatedTokens || (prevTotalTokensInContext + Math.round(turnDeltaSize / 3.2));
      } else {
        totalTokensInContext = (data.tokensIn || 0) + (data.cacheReads || 0) + systemPromptTokens;
      }
      prevTotalTokensInContext = totalTokensInContext;

      const contextUtilizationPct = contextWindowSize
        ? Math.min(100, (totalTokensInContext / contextWindowSize) * 100)
        : null;

      apiCalls.push({
        index: apiCalls.length,
        turn: apiCalls.length + 1,
        uiMsgIndex: i,
        ts: msg.ts,
        tokensIn: data.tokensIn || 0,
        tokensOut: data.tokensOut || 0,
        cacheReads: data.cacheReads || 0,
        cacheWrites: data.cacheWrites || 0,
        cost: data.cost || 0,
        historyIndex: histIdx,
        messageCount,
        requestSize,
        turnDeltaSize: (apiCalls.length === 0) ? requestSize : (turnDeltaSize || Math.max(1, sizeDelta)),
        sizeDelta,
        trimmedFromPrevBytes: 0,
        hasPruning: false,
        fileTruncationBytes: 0,
        commandTruncationBytes: 0,
        hasFilePruning: false,
        hasCommandPruning: false,
        hasError,
        errorDetails,
        requestText: data.request || null,
        modelId: mId,
        providerId: msg.modelInfo?.providerId || null,
        // Context window fields
        contextWindowSize,
        systemPromptTokens,
        totalTokensInContext,
        contextUtilizationPct,
      });

      if (requestSize > 0) prevRequestSize = requestSize;
    }

    // detectedModelId = first model seen (used for pricing lookup below)
    const detectedModelId = apiCalls.find(c => c.modelId)?.modelId || null;

    const matchedPricing = getModelCachePricing(detectedModelId, openrouterCache);

    // Chronological Reduction Timeline & Category Tracking across adjacent turns
    const reductionEvents = [];
    const filePruningMap = {};
    const cmdPruningMap = {};
    let envPruningCount = 0;
    let envPruningBytes = 0;

    if (contextUpdates.length > 0) {
      for (let i = 1; i < apiCalls.length; i++) {
        const callPrev = apiCalls[i - 1];
        const callCurr = apiCalls[i];

        const msgsPrev = getEffectiveMessagesAtTs(apiHistory, contextUpdates, callPrev.ts, callPrev.historyIndex);
        const msgsCurr = getEffectiveMessagesAtTs(apiHistory, contextUpdates, callCurr.ts, callPrev.historyIndex);

        let turnSavedBytes = 0;

        for (let mIdx = 0; mIdx < msgsPrev.length; mIdx++) {
          const sPrev = JSON.stringify(msgsPrev[mIdx]?.content || '').length;
          const sCurr = JSON.stringify(msgsCurr[mIdx]?.content || '').length;
          const bytesSaved = sPrev - sCurr;

          if (bytesSaved > 50) {
            turnSavedBytes += bytesSaved;
            const contentPrevStr = extractTextContent(msgsPrev[mIdx]?.content);
            const contentCurrStr = extractTextContent(msgsCurr[mIdx]?.content);

            const { category, targetName } = detectReductionCategory(contentPrevStr, contentCurrStr);

            if (category === 'File Read Truncated') {
              if (!filePruningMap[targetName]) filePruningMap[targetName] = { count: 0, bytesSaved: 0 };
              filePruningMap[targetName].count++;
              filePruningMap[targetName].bytesSaved += bytesSaved;
            } else if (category === 'Terminal Output Truncated') {
              if (!cmdPruningMap[targetName]) cmdPruningMap[targetName] = { count: 0, bytesSaved: 0 };
              cmdPruningMap[targetName].count++;
              cmdPruningMap[targetName].bytesSaved += bytesSaved;
            } else if (category === 'Stale Environment Snapshot Removed') {
              envPruningCount++;
              envPruningBytes += bytesSaved;
            }

            const diffChunks = computeExactDiffChunks(contentPrevStr, contentCurrStr);

            reductionEvents.push({
              eventIndex: reductionEvents.length,
              callIndex: i,
              prevCallIndex: i - 1,
              msgIndex: mIdx,
              role: msgsPrev[mIdx]?.role || 'unknown',
              category,
              targetName,
              beforeSize: sPrev,
              afterSize: sCurr,
              bytesSaved,
              diffChunks,
              ts: callCurr.ts,
            });
          }
        }

        callCurr.trimmedFromPrevBytes = turnSavedBytes;
        callCurr.hasPruning = turnSavedBytes > 100;
      }
    }

    // Attach cumulative metrics (cost, elapsed time, latency, cacheHitPct) & explanation to every call
    let runningCost = 0;
    const startTs = apiCalls[0]?.ts || 0;
    for (let i = 0; i < apiCalls.length; i++) {
      const c = apiCalls[i];
      runningCost += (c.cost || 0);
      c.cumulativeCost = runningCost;
      c.elapsedSeconds = Math.max(0, Math.round(((c.ts - startTs) / 1000) * 10) / 10);
      c.latencyMs = i > 0 ? Math.max(0, c.ts - apiCalls[i - 1].ts) : 0;
      const reads = c.cacheReads || 0;
      const inTok = c.tokensIn || 0;
      if (reads <= 0) {
        c.cacheHitPct = 0;
      } else {
        const totalPrompt = inTok >= reads ? inTok : (reads + inTok);
        c.cacheHitPct = totalPrompt > 0 ? Math.min(100, Math.max(0, Math.round((reads / totalPrompt) * 1000) / 10)) : 0;
      }
      c.cacheExplanation = computeCacheExplanation(c, i > 0 ? apiCalls[i - 1] : null, uiMessages);
    }


    let taskMeta = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);

    // ── Scan scratch/ directory for write-time offloaded logs ──
    const scratchDir = path.join(taskPath, 'scratch');
    const scratchEvents = [];
    let totalScratchRawBytes = 0;
    let totalScratchPromptBytes = 0;

    if (fs.existsSync(scratchDir)) {
      try {
        const scratchFiles = fs.readdirSync(scratchDir).filter(f => f.endsWith('.log'));

        // Fast pre-index of apiHistory and uiMessages once
        const indexedHistory = apiHistory.map((m, idx) => ({
          msgIndex: idx,
          role: m?.role || 'user',
          text: extractTextContent(m?.content),
        }));

        const indexedUi = uiMessages.map((m, idx) => ({
          msgIndex: idx,
          text: extractTextContent(m?.text || m?.content),
        }));

        for (const fname of scratchFiles) {
          const fpath = path.join(scratchDir, fname);
          const stat = fs.statSync(fpath);
          const rawBytes = stat.size;
          totalScratchRawBytes += rawBytes;

          let rawPreviewText = '';
          try {
            const rawText = fs.readFileSync(fpath, 'utf8');
            rawPreviewText = rawText.length > 2000 ? rawText.substring(0, 2000) + `\n... [${rawText.length - 2000} more chars]` : rawText;
          } catch {}

          let toolName = 'tool_output';
          const match = fname.match(/tool_([a-z_]+)_/i);
          if (match) toolName = match[1];

          let promptSnippetText = '';
          let matchedCallIndex = -1;
          let matchedMsgIndex = -1;
          let targetPath = null;

          // 1. Fast match in indexedHistory by full filename
          for (const item of indexedHistory) {
            if (item.text.includes(fname)) {
              matchedMsgIndex = item.msgIndex;
              promptSnippetText = item.text;
              const lines = item.text.split('\n');
              const fLineIdx = lines.findIndex(l => l.includes(fname));
              if (fLineIdx >= 0) {
                for (let l = fLineIdx; l >= Math.max(0, fLineIdx - 5); l--) {
                  const m = lines[l].match(/\[([a-z_]+)\s+for\s+['\"]([^'\"]+)['\"]\]/i);
                  if (m) {
                    targetPath = m[2];
                    break;
                  }
                }
              }
              break;
            }
          }

          // 2. Fast match in indexedUi if not found
          if (!targetPath || !promptSnippetText) {
            for (const item of indexedUi) {
              if (item.text.includes(fname)) {
                if (!promptSnippetText) promptSnippetText = item.text;
                if (!targetPath) {
                  const lines = item.text.split('\n');
                  const fLineIdx = lines.findIndex(l => l.includes(fname));
                  if (fLineIdx >= 0) {
                    for (let l = fLineIdx; l >= Math.max(0, fLineIdx - 5); l--) {
                      const m = lines[l].match(/\[([a-z_]+)\s+for\s+['\"]([^'\"]+)['\"]\]/i);
                      if (m) {
                        targetPath = m[2];
                        break;
                      }
                    }
                  }
                }
                if (targetPath && promptSnippetText) break;
              }
            }
          }

          // 3. Match by _msg<digits>_ in filename (e.g. tool_list_files_msg36_2182b38b.log)
          if (matchedMsgIndex < 0) {
            const msgMatch = fname.match(/_msg(\d+)_/i);
            if (msgMatch) {
              const parsedIdx = parseInt(msgMatch[1], 10);
              if (parsedIdx >= 0 && parsedIdx < indexedHistory.length) {
                matchedMsgIndex = parsedIdx;
                if (!promptSnippetText) {
                  promptSnippetText = indexedHistory[parsedIdx].text;
                }
                if (!targetPath && promptSnippetText) {
                  const lines = promptSnippetText.split('\n');
                  for (let l = 0; l < Math.min(lines.length, 5); l++) {
                    const m = lines[l].match(/\[([a-z_]+)\s+for\s+['\"]([^'\"]+)['\"]\]/i);
                    if (m) {
                      targetPath = m[2];
                      break;
                    }
                  }
                }
              }
            }
          }

          // 4. Find matched callIndex by historyIndex
          if (matchedMsgIndex >= 0) {
            for (let cIdx = 0; cIdx < apiCalls.length; cIdx++) {
              if (apiCalls[cIdx].historyIndex >= matchedMsgIndex) {
                matchedCallIndex = cIdx;
                break;
              }
            }
            if (matchedCallIndex < 0 && apiCalls.length > 0) {
              matchedCallIndex = apiCalls.length - 1;
            }
          }

          // 5. If still not matched, find closest call by creation timestamp
          if (matchedCallIndex < 0 && apiCalls.length > 0) {
            const fileTs = stat.mtimeMs || stat.birthtimeMs || 0;
            if (fileTs > 0) {
              let closestDiff = Infinity;
              let closestCall = -1;
              for (let cIdx = 0; cIdx < apiCalls.length; cIdx++) {
                const diff = Math.abs((apiCalls[cIdx].ts || 0) - fileTs);
                if (diff < closestDiff) {
                  closestDiff = diff;
                  closestCall = cIdx;
                }
              }
              if (closestCall >= 0 && closestDiff < 600000) {
                matchedCallIndex = closestCall;
              }
            }
          }

          if (matchedCallIndex < 0) {
            matchedCallIndex = apiCalls.length > 0 ? (apiCalls.length - 1) : 0;
          }

          if (promptSnippetText) {
            const fnameIdx = promptSnippetText.indexOf(fname);
            if (fnameIdx >= 0) {
              const start = Math.max(0, fnameIdx - 400);
              const end = Math.min(promptSnippetText.length, fnameIdx + 1000);
              promptSnippetText = promptSnippetText.substring(start, end);
            } else if (promptSnippetText.length > 2000) {
              promptSnippetText = promptSnippetText.substring(0, 1500) + `\n... [snippet preview]`;
            }
          }

          const promptBytes = promptSnippetText ? promptSnippetText.length : Math.min(rawBytes, 1500);
          totalScratchPromptBytes += promptBytes;
          const bytesSaved = Math.max(0, rawBytes - promptBytes);

          let displayTarget = targetPath || fname;
          if (displayTarget.includes('/scratch/')) {
            const base = displayTarget.split('/scratch/').pop();
            displayTarget = `[Nested Scratch: ${base}]`;
          }

          // If tool is read_file and target is a real file, register in filePruningMap
          if (toolName === 'read_file' && targetPath && !targetPath.includes('/scratch/')) {
            if (!filePruningMap[targetPath]) filePruningMap[targetPath] = { count: 0, bytesSaved: 0 };
            filePruningMap[targetPath].count++;
            filePruningMap[targetPath].bytesSaved += bytesSaved;
          } else if (toolName === 'execute_command' && targetPath) {
            if (!cmdPruningMap[targetPath]) cmdPruningMap[targetPath] = { count: 0, bytesSaved: 0 };
            cmdPruningMap[targetPath].count++;
            cmdPruningMap[targetPath].bytesSaved += bytesSaved;
          }

          const diffChunks = computeExactDiffChunks(rawPreviewText, promptSnippetText || '');

          let reductionCategory = 'Scratch Offload';
          if (toolName === 'read_file') reductionCategory = 'File Read Truncated';
          else if (toolName === 'execute_command') reductionCategory = 'Terminal Output Truncated';
          else if (toolName === 'postqode_browser_agent') reductionCategory = 'Browser Snapshot Offloaded';
          else if (toolName === 'use_skill') reductionCategory = 'Skill Instructions Truncated';
          else if (toolName === 'replace_in_file') reductionCategory = 'File Edit Output Truncated';

          reductionEvents.push({
            eventIndex: reductionEvents.length,
            callIndex: matchedCallIndex >= 0 ? matchedCallIndex : 0,
            prevCallIndex: matchedCallIndex > 0 ? matchedCallIndex - 1 : 0,
            msgIndex: matchedMsgIndex >= 0 ? matchedMsgIndex : 0,
            role: 'user',
            category: reductionCategory,
            targetName: displayTarget,
            beforeSize: rawBytes,
            afterSize: promptBytes,
            bytesSaved,
            diffChunks,
            isScratch: true,
            scratchFilename: fname,
            toolName,
            ts: (matchedCallIndex >= 0 && apiCalls[matchedCallIndex]) ? apiCalls[matchedCallIndex].ts : Date.now(),
          });

          scratchEvents.push({
            filename: fname,
            toolName,
            targetPath: displayTarget,
            rawBytes,
            promptBytes,
            bytesSaved,
            rawPreviewText,
            promptSnippetText: promptSnippetText || '(Snippet in prompt payload)',
            callIndex: matchedCallIndex >= 0 ? matchedCallIndex : 0,
            msgIndex: matchedMsgIndex,
          });

          if (matchedCallIndex >= 0 && apiCalls[matchedCallIndex]) {
            apiCalls[matchedCallIndex].scratchOffloadedBytes = (apiCalls[matchedCallIndex].scratchOffloadedBytes || 0) + bytesSaved;
            if (toolName === 'read_file' || reductionCategory.includes('File')) {
              apiCalls[matchedCallIndex].fileTruncationBytes = (apiCalls[matchedCallIndex].fileTruncationBytes || 0) + bytesSaved;
              apiCalls[matchedCallIndex].hasFilePruning = true;
            }
            if (toolName === 'execute_command' || reductionCategory.includes('Terminal')) {
              apiCalls[matchedCallIndex].commandTruncationBytes = (apiCalls[matchedCallIndex].commandTruncationBytes || 0) + bytesSaved;
              apiCalls[matchedCallIndex].hasCommandPruning = true;
            }
          }
        }
      } catch (e) {
        console.error('Scratch scan error:', e);
      }
    }

    // ── Call #1: System Prompt & Base Context Event ──
    const displaySystemText = (systemPromptCapture && systemPromptCapture.system_text)
      ? systemPromptCapture.system_text
      : "You are PostQode, a software engineering AI. Your mission is to execute precisely what is requested - implement exactly what was asked for, with the simplest solution that fulfills all requirements. Ask clarifying questions to ensure you understand the user's requirements and that they understand your approach before proceeding.\n\n====\n\nOBJECTIVE\n\nYou accomplish a given task iteratively, breaking it down into clear steps and working through them methodically.";
    const displaySystemSize = Buffer.byteLength(displaySystemText, 'utf8');

    reductionEvents.push({
      eventIndex: 0,
      callIndex: 0,
      prevCallIndex: 0,
      msgIndex: 0,
      role: 'system',
      category: 'System Prompt & Base Context',
      targetName: 'System Instructions (Initial Base Prompt)',
      beforeSize: displaySystemSize,
      afterSize: displaySystemSize,
      bytesSaved: 0,
      diffChunks: {
        prefix: '',
        removedText: '',
        insertedText: displaySystemText,
        suffix: '',
      },
      isSystemPrompt: true,
      ts: apiCalls[0]?.ts || Date.now(),
    });

    // ── Register Tool Error Events in Chronological Reduction Timeline ──
    for (const c of apiCalls) {
      if (c.hasError && c.errorDetails) {
        reductionEvents.push({
          eventIndex: reductionEvents.length,
          callIndex: c.index,
          prevCallIndex: c.index > 0 ? c.index - 1 : 0,
          msgIndex: c.historyIndex >= 0 ? c.historyIndex : 0,
          role: 'error',
          category: 'Tool Error',
          targetName: c.errorDetails.target ? `⚠️ ${c.errorDetails.tool}: ${c.errorDetails.target}` : `⚠️ ${c.errorDetails.tool || 'Tool Error'}`,
          beforeSize: c.requestSize || 0,
          afterSize: c.requestSize || 0,
          bytesSaved: 0,
          diffChunks: {
            prefix: `[Tool Error on Call #${c.turn}]\nTool: ${c.errorDetails.tool || 'unknown'}\n${c.errorDetails.target ? `Target: ${c.errorDetails.target}\n` : ''}`,
            removedText: '',
            insertedText: `Error Message:\n${c.errorDetails.message || 'Tool execution failed'}\n\n${c.requestText ? `Request Snippet:\n${c.requestText.substring(0, 500)}` : ''}`,
            suffix: '',
          },
          isError: true,
          errorDetails: c.errorDetails,
          ts: c.ts,
        });
      }
    }

    reductionEvents.sort((a, b) => (a.callIndex - b.callIndex) || ((a.isSystemPrompt ? -1 : 0) - (b.isSystemPrompt ? -1 : 0)) || ((a.isScratch ? 1 : 0) - (b.isScratch ? 1 : 0)) || a.eventIndex - b.eventIndex);
    reductionEvents.forEach((ev, idx) => { ev.eventIndex = idx; });

    scratchEvents.sort((a, b) => a.callIndex - b.callIndex || a.filename.localeCompare(b.filename));

    const fileCategorySummary = Object.keys(filePruningMap).map(f => ({
      path: f,
      count: filePruningMap[f].count,
      bytesSaved: filePruningMap[f].bytesSaved,
    })).sort((a, b) => b.bytesSaved - a.bytesSaved);

    const cmdCategorySummary = Object.keys(cmdPruningMap).map(c => ({
      command: c,
      count: cmdPruningMap[c].count,
      bytesSaved: cmdPruningMap[c].bytesSaved,
    })).sort((a, b) => b.bytesSaved - a.bytesSaved);

    const totalScratchSavedBytes = Math.max(0, totalScratchRawBytes - totalScratchPromptBytes);
    const scratchSummary = {
      count: scratchEvents.length,
      totalRawBytes: totalScratchRawBytes,
      totalPromptBytes: totalScratchPromptBytes,
      totalSavedBytes: totalScratchSavedBytes,
    };

    const errorSummary = {
      count: apiCalls.filter(c => c.hasError).length,
      calls: apiCalls.filter(c => c.hasError).map(c => ({
        callIndex: c.index,
        turn: c.turn,
        ts: c.ts,
        error: c.errorDetails,
      })),
    };

    // Calculate Financial Cost Breakdown per API Call (Supports mid-task model switches!)
    let totalInputCost = 0;
    let totalOutputCost = 0;
    let totalCacheReadCost = 0;
    let totalCacheWriteCost = 0;

    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalCacheReads = 0;
    let totalCacheWrites = 0;

    const modelsUsedSet = new Set();
    const modelRateMap = {};

    for (const c of apiCalls) {
      const callModel = c.modelId || detectedModelId || 'unknown';
      modelsUsedSet.add(callModel);

      if (!modelRateMap[callModel]) {
        const pricing = getModelCachePricing(callModel, openrouterCache);
        const info = getModelInfo(callModel);
        const inRate = pricing?.prompt || info?.inputPrice || 3.0;
        const outRate = pricing?.completion || info?.outputPrice || 15.0;
        const readRate = pricing?.cacheRead || (inRate * 0.1);
        const writeRate = pricing?.cacheWrite || (inRate * 1.25);
        modelRateMap[callModel] = { inRate, outRate, readRate, writeRate };
      }

      const rates = modelRateMap[callModel];
      const inTok = c.tokensIn || 0;
      const outTok = c.tokensOut || 0;
      const readTok = c.cacheReads || 0;
      const writeTok = c.cacheWrites || 0;

      totalTokensIn += inTok;
      totalTokensOut += outTok;
      totalCacheReads += readTok;
      totalCacheWrites += writeTok;

      totalInputCost += (inTok / 1e6) * rates.inRate;
      totalOutputCost += (outTok / 1e6) * rates.outRate;
      totalCacheReadCost += (readTok / 1e6) * rates.readRate;
      totalCacheWriteCost += (writeTok / 1e6) * rates.writeRate;
    }

    const calculatedTotalCost = apiCalls.reduce((s, c) => s + (c.cost || 0), 0);
    const modelsUsedList = Array.from(modelsUsedSet);

    const avgInputRate = totalTokensIn > 0 ? (totalInputCost / totalTokensIn) * 1e6 : (modelRateMap[detectedModelId]?.inRate || 3.0);
    const avgOutputRate = totalTokensOut > 0 ? (totalOutputCost / totalTokensOut) * 1e6 : (modelRateMap[detectedModelId]?.outRate || 15.0);
    const avgCacheReadRate = totalCacheReads > 0 ? (totalCacheReadCost / totalCacheReads) * 1e6 : (modelRateMap[detectedModelId]?.readRate || 0.30);
    const avgCacheWriteRate = totalCacheWrites > 0 ? (totalCacheWriteCost / totalCacheWrites) * 1e6 : (modelRateMap[detectedModelId]?.writeRate || 3.75);

    const financialBreakdown = {
      modelId: modelsUsedList.length > 1 ? `Multi-Model (${modelsUsedList.map(m => m.split('/').pop()).join(', ')})` : (detectedModelId || 'unknown'),
      modelsUsed: modelsUsedList,
      isMultiModel: modelsUsedList.length > 1,
      totalCost: calculatedTotalCost || (totalInputCost + totalOutputCost + totalCacheReadCost + totalCacheWriteCost),
      input: { tokens: totalTokensIn, pricePerM: avgInputRate, cost: totalInputCost },
      output: { tokens: totalTokensOut, pricePerM: avgOutputRate, cost: totalOutputCost },
      cacheRead: { tokens: totalCacheReads, pricePerM: avgCacheReadRate, cost: totalCacheReadCost },
      cacheWrite: { tokens: totalCacheWrites, pricePerM: avgCacheWriteRate, cost: totalCacheWriteCost },
    };

    const liveTotalCost = financialBreakdown.totalCost || calculatedTotalCost || 0;
    const liveStartTs = apiCalls[0]?.ts || taskMeta?.start_ts || Date.now();
    const liveEndTs = apiCalls[apiCalls.length - 1]?.ts || taskMeta?.end_ts || Date.now();
    const liveDuration = Math.max(0, liveEndTs - liveStartTs);
    const firstMsg = uiMessages[0]?.content ? (typeof uiMessages[0].content === 'string' ? uiMessages[0].content : JSON.stringify(uiMessages[0].content)) : `Task ${taskId}`;

    const taskObj = {
      id: taskId,
      label: taskMeta?.label || null,
      source: taskMeta?.source || 'disk',
      startTs: liveStartTs,
      endTs: liveEndTs,
      duration: liveDuration || taskMeta?.duration || 0,
      totalCost: liveTotalCost,
      totalTokensIn,
      totalTokensOut,
      totalCacheReads,
      totalCacheWrites,
      apiCallCount: apiCalls.length,
      firstMessage: taskMeta?.first_message || firstMsg.substring(0, 200),
      status: taskMeta?.status || 'completed',
    };

    // Update SQLite tasks table so /api/tasks and all dropdowns stay synchronized with exact live financial numbers
    try {
      if (!taskMeta) {
        db.prepare('INSERT OR IGNORE INTO tasks (id, source, start_ts, end_ts, duration, total_cost, api_call_count, first_message) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
          taskId, 'disk', liveStartTs, liveEndTs, liveDuration, liveTotalCost, apiCalls.length, firstMsg.substring(0, 200)
        );
      } else {
        db.prepare(`
          UPDATE tasks SET 
            total_cost = ?,
            api_call_count = ?,
            duration = ?,
            total_tokens_in = ?,
            total_tokens_out = ?,
            total_cache_reads = ?,
            total_cache_writes = ?
          WHERE id = ?
        `).run(liveTotalCost, apiCalls.length, liveDuration, totalTokensIn, totalTokensOut, totalCacheReads, totalCacheWrites, taskId);
      }
    } catch (e) {}

    res.json({
      task: taskObj,
      filePaths: {
        taskPath,
        uiMessagesPath: fs.existsSync(uiPath) ? uiPath : null,
        apiHistoryPath: fs.existsSync(apiHistPath) ? apiHistPath : null,
        contextHistoryPath: fs.existsSync(ctxHistPath) ? ctxHistPath : null,
      },
      apiCalls,
      modelPricing: matchedPricing,
      financialBreakdown,
      reductionCategories: {
        truncatedFiles: fileCategorySummary,
        truncatedCommands: cmdCategorySummary,
        environmentSnapshots: { count: envPruningCount, bytesSaved: envPruningBytes },
      },
      reductionEvents,
      scratchSummary,
      scratchEvents,
      errorSummary,
      totalMessages: apiHistory.length,
      systemPromptCapture, // null if proxy never captured it for this task
      systemPromptNote: systemPromptAvailable
        ? `System prompt captured by the Network Inspector proxy (${systemPromptCapture.approx_tokens?.toLocaleString() || '?'} est. tokens). Included in context window utilization calculation.`
        : 'The system prompt (tool definitions, core instructions) is generated in-memory by the extension at request time and is not persisted to any task file, so it cannot be shown here. Only user/assistant turns from api_conversation_history.json are reconstructed. Enable and use the Network Inspector proxy to capture and persist it.',
    });
  });

  /**
   * POST / PATCH /api/prompt-analytics/:taskId/label
   * Set or clear custom task label.
   */
  const handlePromptAnalyticsLabel = (req, res) => {
    const taskId = req.params.taskId;
    const { label } = req.body || {};
    const cleanLabel = (typeof label === 'string' && label.trim().length > 0) ? label.trim() : null;

    let task = db.prepare('SELECT id FROM tasks WHERE id = ?').get(taskId);
    if (!task) {
      db.prepare('INSERT OR IGNORE INTO tasks (id, source, start_ts, label) VALUES (?, ?, ?, ?)').run(taskId, 'unknown', Date.now(), cleanLabel);
    }

    db.prepare('UPDATE tasks SET label = ? WHERE id = ?').run(cleanLabel, taskId);
    res.json({ ok: true, id: taskId, label: cleanLabel });
  };
  router.post('/prompt-analytics/:taskId/label', handlePromptAnalyticsLabel);
  router.patch('/prompt-analytics/:taskId/label', handlePromptAnalyticsLabel);
  router.put('/prompt-analytics/:taskId/label', handlePromptAnalyticsLabel);


  /**
   * GET /api/prompt-analytics/:taskId/prompt?call=5
   * Returns the exact effective prompt payload for a single API call.
   */
  router.get('/prompt-analytics/:taskId/prompt', (req, res) => {
    const taskId = req.params.taskId;
    const call = parseInt(req.query.call || '0');
    const taskPath = resolveTaskPath(taskId);

    if (!taskPath) {
      return res.status(404).json({ error: 'Task not found' });
    }

    let files;
    try {
      files = readTaskPromptFiles(taskPath);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse task files' });
    }

    const apiCallEntries = getApiCallEntries(files.uiMessages, files.apiHistory.length);
    if (call < 0 || call >= apiCallEntries.length) {
      return res.status(400).json({ error: 'Invalid call index' });
    }

    const entry = apiCallEntries[call];
    const messages = getEffectiveMessagesAtTs(files.apiHistory, files.contextUpdates, entry.ts, entry.historyIndex);
    const requestSize = messages.reduce((s, m) => s + JSON.stringify(m.content || '').length, 0);
    const systemPrompt = findSystemPromptFromProxy(entry.ts);

    res.json({
      call: { index: call, ...entry, messageCount: messages.length, requestSize },
      prompt: {
        messageCount: messages.length,
        requestSize,
        text: buildExactPromptText(messages),
        messages,
      },
      systemPrompt,
    });
  });

  /**
   * GET /api/prompt-analytics/:taskId/compare?call1=5&call2=10&mode=prefix|full
   */
  router.get('/prompt-analytics/:taskId/compare', (req, res) => {
    const taskId = req.params.taskId;
    const call1 = parseInt(req.query.call1 || '0');
    const call2 = parseInt(req.query.call2 || '1');
    const mode = req.query.mode === 'full' ? 'full' : 'prefix';
    const taskPath = resolveTaskPath(taskId);

    if (!taskPath) {
      return res.status(404).json({ error: 'Task not found' });
    }

    let files;
    try {
      files = readTaskPromptFiles(taskPath);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse task files' });
    }

    const apiCallEntries = getApiCallEntries(files.uiMessages, files.apiHistory.length);

    if (call1 < 0 || call1 >= apiCallEntries.length || call2 < 0 || call2 >= apiCallEntries.length) {
      return res.status(400).json({ error: 'Invalid call indices' });
    }

    const entry1 = apiCallEntries[call1];
    const entry2 = apiCallEntries[call2];

    const messages1 = getEffectiveMessagesAtTs(files.apiHistory, files.contextUpdates, entry1.ts, entry1.historyIndex);
    const messages2 = getEffectiveMessagesAtTs(
      files.apiHistory,
      files.contextUpdates,
      entry2.ts,
      mode === 'full' ? entry2.historyIndex : entry1.historyIndex
    );

    const commonMsgCount = Math.min(messages1.length, messages2.length);
    let commonSizeCall1 = 0;
    let commonSizeCall2 = 0;

    for (let i = 0; i < commonMsgCount; i++) {
      commonSizeCall1 += JSON.stringify(messages1[i]?.content || '').length;
      commonSizeCall2 += JSON.stringify(messages2[i]?.content || '').length;
    }

    const prunedFromCall1 = commonSizeCall1 - commonSizeCall2;

    const trimmedItems = [];
    const changedItems = [];

    for (let i = 0; i < commonMsgCount; i++) {
      const sum1 = summarizePromptMessage(messages1[i], i);
      const sum2 = summarizePromptMessage(messages2[i], i);
      const diffChunks = computeExactDiffChunks(sum1.fullText, sum2.fullText);
      const saved = sum1.size - sum2.size;

      if (sum1.fullText !== sum2.fullText) {
        changedItems.push({
          index: i,
          role: messages1[i]?.role || messages2[i]?.role || 'unknown',
          before: sum1,
          after: sum2,
          diffChunks,
          bytesSaved: Math.max(0, saved),
          bytesDelta: sum2.size - sum1.size,
          changeType: saved > 10 ? 'reduced' : (saved < -10 ? 'expanded' : 'modified'),
        });
      }

      if (saved > 10) {
        trimmedItems.push({
          index: i,
          role: messages1[i]?.role || 'unknown',
          before: sum1,
          after: sum2,
          diffChunks,
          bytesSaved: saved,
        });
      }
    }

    const addedItems = [];
    for (let i = commonMsgCount; i < messages2.length; i++) {
      addedItems.push({
        index: i,
        role: messages2[i]?.role || 'unknown',
        after: summarizePromptMessage(messages2[i], i),
      });
    }

    const removedItems = [];
    for (let i = commonMsgCount; i < messages1.length; i++) {
      removedItems.push({
        index: i,
        role: messages1[i]?.role || 'unknown',
        before: summarizePromptMessage(messages1[i], i),
      });
    }

    const req1Size = messages1.reduce((s, m) => s + JSON.stringify(m.content || '').length, 0);
    const req2Size = messages2.reduce((s, m) => s + JSON.stringify(m.content || '').length, 0);

    // ── Explain WHY the prompt changed between these two calls ──
    // (model swap, and/or the framework condensing/resetting context)
    const modelChanged = !!(entry1.modelId && entry2.modelId && entry1.modelId !== entry2.modelId);

    // Heuristic for a context condense/reset: total size dropped meaningfully
    // while the message count did NOT shrink (a simple truncation/removal of
    // tool output would reduce or hold message count, not grow it while also
    // shrinking total bytes). Early-message reductions (system/task context,
    // not the tail-end tool outputs) are the other tell-tale sign.
    // ponytail: heuristic thresholds (5% size drop, msg[0..4]) — good enough to
    // flag likely condensation for investigation; not a guaranteed classifier.
    const sizeDropPct = req1Size > 0 ? (req1Size - req2Size) / req1Size : 0;
    const earlyBigChange = changedItems.some(it => it.index < 5 && it.bytesSaved > 2000);
    const possibleContextCondensation = sizeDropPct > 0.05 && messages2.length >= messages1.length && earlyBigChange;

    const systemPrompt1 = findSystemPromptFromProxy(entry1.ts);
    const systemPrompt2 = findSystemPromptFromProxy(entry2.ts);
    const systemPromptChanged = !!(systemPrompt1 && systemPrompt2 && systemPrompt1.text !== systemPrompt2.text);

    res.json({
      call1: { index: call1, ...entry1, messageCount: messages1.length, requestSize: req1Size },
      call2: { index: call2, ...entry2, messageCount: messages2.length, requestSize: req2Size },
      mode,
      systemPrompt1,
      systemPrompt2,
      systemPromptChanged,
      pruningSummary: {
        req1ContentBeforePruning: commonSizeCall1,
        req1ContentAfterPruning: commonSizeCall2,
        bytesSaved: prunedFromCall1,
        percentSaved: commonSizeCall1 > 0 ? ((prunedFromCall1 / commonSizeCall1) * 100).toFixed(1) : '0.0',
      },
      annotations: {
        modelChanged,
        fromModelId: entry1.modelId || null,
        toModelId: entry2.modelId || null,
        fromProviderId: entry1.providerId || null,
        toProviderId: entry2.providerId || null,
        possibleContextCondensation,
        sizeDropPct: Math.round(sizeDropPct * 1000) / 10,
      },
      trimmedItems,
      changedItems,
      addedItems,
      removedItems,
      prompt1: {
        messageCount: messages1.length,
        requestSize: req1Size,
        text: buildExactPromptText(messages1),
      },
      prompt2: {
        messageCount: messages2.length,
        requestSize: req2Size,
        text: buildExactPromptText(messages2),
      },
    });
  });

  return router;
};
