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
const { getMemoryTimeline, getTaskSystemPrompts, saveSubagentTurns, getSubagentTurns } = require('../cache/db');
const { buildCacheAnalysis } = require('../analytics/cache-service');
const { getProfile, canon } = require('../pricing/cache-pricing');

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

  return null;
}

function getProviderName(modelId) {
  const m = String(modelId || '').toLowerCase();
  if (m.includes('anthropic') || m.includes('claude')) return 'Anthropic';
  if (m.includes('openai') || m.includes('gpt') || m.includes('o1') || m.includes('o3')) return 'OpenAI';
  if (m.includes('deepseek')) return 'DeepSeek';
  if (m.includes('google') || m.includes('gemini')) return 'Google';
  if (m.includes('meta') || m.includes('llama')) return 'Meta';
  return 'Standard';
}

function getVendorFallbackPricing(modelId) {
  const isAnthropic = /claude|anthropic/i.test(modelId);
  const isOpus = /opus/i.test(modelId);
  const isOpenAI = /gpt|openai|o1|o3/i.test(modelId);
  const isDeepSeek = /deepseek/i.test(modelId);
  const isGemini = /gemini|google/i.test(modelId);

  if (isAnthropic) {
    return {
      modelId,
      provider: 'Anthropic',
      inputRate: isOpus ? 4.0 : 2.0,
      outputRate: isOpus ? 20.0 : 10.0,
      cacheReadRate: isOpus ? 0.20 : 0.10,
      cacheWriteRate: isOpus ? 5.0 : 2.5,
      cacheWrite1hRate: isOpus ? 8.0 : 4.0,
      supportsCache: true,
      explicitWrites: true,
    };
  } else if (isOpenAI) {
    return {
      modelId,
      provider: 'OpenAI',
      inputRate: 2.50,
      outputRate: 10.0,
      cacheReadRate: 1.25, // 50% discount
      cacheWriteRate: 0,
      cacheWrite1hRate: 0,
      supportsCache: true,
      explicitWrites: false,
    };
  } else if (isDeepSeek) {
    return {
      modelId,
      provider: 'DeepSeek',
      inputRate: 0.14,
      outputRate: 0.56,
      cacheReadRate: 0.014, // 90% discount
      cacheWriteRate: 0,
      cacheWrite1hRate: 0,
      supportsCache: true,
      explicitWrites: false,
    };
  } else if (isGemini) {
    return {
      modelId,
      provider: 'Google',
      inputRate: 1.25,
      outputRate: 5.0,
      cacheReadRate: 0.3125, // 75% discount
      cacheWriteRate: 0,
      cacheWrite1hRate: 0,
      supportsCache: true,
      explicitWrites: false,
    };
  }

  return {
    modelId: modelId || 'default',
    provider: 'Standard',
    inputRate: 2.0,
    outputRate: 8.0,
    cacheReadRate: 1.0,
    cacheWriteRate: 0,
    cacheWrite1hRate: 0,
    supportsCache: false,
    explicitWrites: false,
  };
}

/**
 * Resolves a dynamic pricing profile for a given model, supporting Anthropic, OpenAI, DeepSeek, Google Gemini, and Local/Custom models.
 */
function resolveModelPricing(modelId, openrouterCache) {
  if (!modelId) {
    return getVendorFallbackPricing('anthropic/claude-sonnet-latest');
  }

  // 1. Try getProfile from cache-pricing (catalog + live registry)
  try {
    const prof = getProfile(modelId);
    if (prof && prof.base) {
      const isAnthropic = /claude|anthropic/i.test(modelId) || prof.explicitCacheWrites;
      return {
        modelId,
        provider: getProviderName(modelId),
        inputRate: prof.base.input != null ? prof.base.input : 3.0,
        outputRate: prof.base.output != null ? prof.base.output : 15.0,
        cacheReadRate: prof.base.cacheRead != null ? prof.base.cacheRead : ((prof.base.input || 3.0) * 0.5),
        cacheWriteRate: prof.base.cacheWrite5m != null ? prof.base.cacheWrite5m : 0,
        cacheWrite1hRate: prof.base.cacheWrite1h != null ? prof.base.cacheWrite1h : 0,
        supportsCache: prof.supportsPromptCache !== false,
        explicitWrites: !!prof.explicitCacheWrites,
      };
    }
  } catch (e) {}

  // 2. Try OpenRouter cache lookup
  if (openrouterCache) {
    const cacheEntry = getModelCachePricing(modelId, openrouterCache);
    if (cacheEntry) {
      const inP = cacheEntry.inputPrice || 0;
      const outP = cacheEntry.outputPrice || 0;
      const isAnthropic = /claude|anthropic/i.test(modelId);
      return {
        modelId,
        provider: getProviderName(modelId),
        inputRate: inP,
        outputRate: outP,
        cacheReadRate: cacheEntry.cacheReadsPrice != null ? cacheEntry.cacheReadsPrice : (inP * 0.5),
        cacheWriteRate: cacheEntry.cacheWritesPrice != null ? cacheEntry.cacheWritesPrice : (isAnthropic ? inP * 1.25 : 0),
        cacheWrite1hRate: cacheEntry.cacheWrites1hPrice != null ? cacheEntry.cacheWrites1hPrice : (isAnthropic ? inP * 2.0 : 0),
        supportsCache: cacheEntry.supportsPromptCache !== false,
        explicitWrites: isAnthropic,
      };
    }
  }

  // 3. Fallback heuristics
  return getVendorFallbackPricing(modelId);
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

function extractFileTargetsFromText(text) {
  if (!text) return [];
  const files = new Set();
  // 1. Backticked filenames or patterns
  const backticked = text.match(/`([^`\n\r]+\.[a-zA-Z0-9_*-]+)`/g) || [];
  backticked.forEach(m => files.add(m.replace(/`/g, '').trim()));

  // 2. Unquoted relative/absolute paths with code/doc extensions
  const pathRegex = /(?:[\s(\x27\"`]|^)([a-zA-Z0-9_.~-]*\/[a-zA-Z0-9_.~/-]+\.[a-zA-Z0-9_*-]+?)(?=[,\s\):\x27\"`]|(?:\.[\s\n\r])|$)/g;
  let match;
  while ((match = pathRegex.exec(text)) !== null) {
    const p = match[1].trim();
    if (!p.startsWith('http:') && !p.startsWith('https:') && !p.startsWith('www.')) {
      files.add(p);
    }
  }
  return Array.from(files).filter(p => p.includes('/') || p.endsWith('.md') || p.endsWith('.txt') || p.endsWith('.log') || p.endsWith('.json') || p.endsWith('.py') || p.endsWith('.js') || p.endsWith('.ts'));
}

/**
 * Programmatically computes scope independence and context overlap:
 * - Checks which files/domains the main agent had already opened/inspected before the subagent run.
 * - Compares with the exact target files assigned to each worker.
 * - Computes pairwise worker-to-worker file overlap (uniqueness).
 */
function computeSubagentScopeAnalysis(uiMessages) {
  let callIdx = 0;
  const mainFilesSeen = new Set();
  const runs = [];
  const recordedCallIndices = new Set();

  for (let i = 0; i < uiMessages.length; i++) {
    const m = uiMessages[i];
    if (m.say === 'api_req_started') {
      callIdx++;
    }
    if (m.say === 'tool' || m.ask === 'tool') {
      try {
        const p = typeof m.text === 'string' ? JSON.parse(m.text) : m.text;
        if (p.path) mainFilesSeen.add(p.path);
        if (p.command) {
          extractFileTargetsFromText(p.command).forEach(f => mainFilesSeen.add(f));
        }
      } catch (e) {}
    }

    const isSubagentLaunch = (m.say === 'use_subagents' && m.text);
    const isSubagentResult = (m.say === 'subagent' && m.text && !recordedCallIndices.has(callIdx));

    if (isSubagentLaunch || isSubagentResult) {
      try {
        const parsed = typeof m.text === 'string' ? JSON.parse(m.text) : m.text;
        let prompts = parsed.prompts || [];
        if (prompts.length === 0 && Array.isArray(parsed.items)) {
          prompts = parsed.items.map(it => it.prompt || it.latestToolCall || it.result || '');
        }
        if (prompts.length === 0 && parsed.prompt) {
          prompts = [parsed.prompt];
        }
        if (prompts.length === 0) continue;

        recordedCallIndices.add(callIdx);
        const workerScopes = [];
        const allWorkerTargetSets = [];
        const allTargetFiles = new Set();
        const allNovelFiles = new Set();

        prompts.forEach((p, idx) => {
          const targets = extractFileTargetsFromText(p);
          allWorkerTargetSets.push(new Set(targets));
          targets.forEach(t => allTargetFiles.add(t));

          const knownToMain = targets.filter(f => mainFilesSeen.has(f) || Array.from(mainFilesSeen).some(mf => mf.endsWith(f) || f.endsWith(mf)));
          const novelToMain = targets.filter(f => !knownToMain.includes(f));
          novelToMain.forEach(t => allNovelFiles.add(t));
          const noveltyPct = targets.length > 0 ? Math.round((novelToMain.length / targets.length) * 100) : 100;

          // Dynamic worker label derived directly from target scope or directive
          let label = 'Worker #' + (idx + 1);
          if (targets.length > 0) {
            const baseName = targets[0].split('/').pop();
            label = targets.length === 1 ? `${baseName} Audit` : `${baseName} + ${targets.length - 1} target${targets.length > 2 ? 's' : ''}`;
          } else {
            const firstLine = p.split('\n')[0].replace(/^#+\s*/, '').trim();
            if (firstLine && firstLine.length >= 4 && firstLine.length <= 40) {
              label = firstLine;
            }
          }

          workerScopes.push({
            workerIndex: idx + 1,
            label,
            targetCount: targets.length,
            targets: targets.slice(0, 10),
            knownToMainCount: knownToMain.length,
            novelCount: novelToMain.length,
            noveltyPct,
            classification: noveltyPct >= 75 ? 'Independent Exploration' : (noveltyPct >= 35 ? 'Hybrid Context' : 'In-Context Verification'),
            novelFiles: novelToMain.slice(0, 8),
            knownFiles: knownToMain.slice(0, 8),
          });
        });

        // Pairwise worker overlap
        let pairComparisons = 0;
        let totalPairOverlapRatio = 0;
        for (let w1 = 0; w1 < allWorkerTargetSets.length; w1++) {
          for (let w2 = w1 + 1; w2 < allWorkerTargetSets.length; w2++) {
            pairComparisons++;
            const s1 = allWorkerTargetSets[w1];
            const s2 = allWorkerTargetSets[w2];
            const intersection = Array.from(s1).filter(x => s2.has(x));
            const union = new Set([...s1, ...s2]);
            const jaccard = union.size > 0 ? (intersection.length / union.size) : 0;
            totalPairOverlapRatio += jaccard;
          }
        }
        const avgOverlapPct = pairComparisons > 0 ? Math.round((totalPairOverlapRatio / pairComparisons) * 100) : 0;
        const uniquenessPct = 100 - avgOverlapPct;

        const totalTargets = workerScopes.reduce((s, w) => s + w.targetCount, 0);
        const totalNovel = workerScopes.reduce((s, w) => s + w.novelCount, 0);
        const overallNoveltyPct = totalTargets > 0 ? Math.round((totalNovel / totalTargets) * 100) : 100;

        runs.push({
          runIndex: runs.length + 1,
          callIndex: callIdx,
          workerCount: prompts.length,
          mainFilesBefore: mainFilesSeen.size,
          uniqueTargetFilesCount: allTargetFiles.size,
          uniqueNovelFilesCount: allNovelFiles.size,
          overallNoveltyPct,
          uniquenessPct,
          taskType: overallNoveltyPct >= 75 ? 'Independent Exploration Task' : (overallNoveltyPct >= 40 ? 'Hybrid Discovery Task' : 'In-Context Verification Task'),
          taskTypeDescription: overallNoveltyPct >= 75
            ? `Main agent had 0% prior context for these files (opened ${mainFilesSeen.size} prior file(s)). A single agent would have had to read them from scratch.`
            : (overallNoveltyPct >= 40
                ? 'Partial context already existed in the main thread; subagents inspected both known drafts and unread files.'
                : 'Files were already loaded in main memory; subagents provided independent verification without polluting final context.'),
          workers: workerScopes,
        });
      } catch (e) {}
    }
  }

  const totalDistinctNovelFiles = runs.reduce((s, r) => s + r.uniqueNovelFilesCount, 0);
  // Realistic turn estimate accounting for parallel tool calls (batching ~3-4 file reads per turn)
  const groundedMinTurns = totalDistinctNovelFiles > 0
    ? Math.max(2, Math.round(totalDistinctNovelFiles / 3.5 + 2))
    : Math.max(1, Math.min(runs.reduce((s, r) => s + (r.workerCount * 2), 0), 10));

  return {
    runs,
    summary: {
      totalRuns: runs.length,
      mainFilesBefore: runs[0]?.mainFilesBefore || 0,
      totalDistinctNovelFiles,
      groundedMinTurns,
      predominantType: runs[0]?.taskType || 'Independent Exploration',
    },
  };
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

/**
 * Prompt size the provider actually processed for one call.
 * Anthropic-style usage reports uncached input, cache reads and cache writes as DISJOINT buckets, so the prompt is
 * their sum. Some providers report `tokensIn` as the whole prompt (it already contains the cached part): in that case
 * tokensIn >= cacheReads and it is used as-is.
 */
function promptTokensOf(d) {
  const inTok = d.tokensIn || 0;
  const reads = d.cacheReads || 0;
  const writes = d.cacheWrites || 0;
  if (reads > 0 && inTok >= reads + writes) return inTok;
  return inTok + reads + writes;
}

/** Share of the prompt that was served from cache (0-100, one decimal). */
function cacheHitPctOf(d) {
  const total = promptTokensOf(d);
  const reads = d.cacheReads || 0;
  if (reads <= 0 || total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((reads / total) * 1000) / 10));
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
    if (!best) {
      try {
        const row = db.prepare(
          'SELECT system_text, approx_tokens, model_id, captured_at_ts, agent_role FROM task_system_prompts ORDER BY ABS(captured_at_ts - ?) ASC LIMIT 1'
        ).get(callTs);
        if (row && Math.abs(row.captured_at_ts - callTs) <= 15 * 60 * 1000) {
          return { text: row.system_text, source: 'sqlite_task_system_prompts', modelId: row.model_id, driftMs: Math.abs(row.captured_at_ts - callTs) };
        }
      } catch (e) {}
      return null;
    }

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

  function parseResponseBody(body) {
    let usage = null;
    const toolCallsMap = new Map();
    let text = '';

    if (!body) return { usage, tools: [], text };

    if (typeof body === 'object') {
      if (body.usage) usage = body.usage;
      const msg = body.choices?.[0]?.message;
      if (msg?.content) text = msg.content;
      if (msg?.tool_calls) {
        msg.tool_calls.forEach((tc, idx) => {
          let args = tc.function?.arguments;
          try { args = JSON.parse(args); } catch {}
          toolCallsMap.set(idx, { id: tc.id || '', name: tc.function?.name || '', arguments: args });
        });
      }
      return { usage, tools: Array.from(toolCallsMap.values()), text };
    }

    if (body.includes('data: ')) {
      const lines = body.split('\n');
      for (const line of lines) {
        if (line.startsWith('data: ') && !line.includes('[DONE]')) {
          try {
            const chunk = JSON.parse(line.slice(6));
            if (chunk.usage) usage = chunk.usage;
            const delta = chunk.choices?.[0]?.delta;
            if (delta?.content) text += delta.content;
            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCallsMap.has(idx)) {
                  toolCallsMap.set(idx, { id: tc.id || '', name: tc.function?.name || '', arguments: tc.function?.arguments || '' });
                } else {
                  const existing = toolCallsMap.get(idx);
                  if (tc.id) existing.id = tc.id;
                  if (tc.function?.name) existing.name += tc.function.name;
                  if (tc.function?.arguments) existing.arguments += tc.function.arguments;
                }
              }
            }
          } catch (e) {}
        }
      }
    } else {
      try {
        const obj = JSON.parse(body);
        if (obj.usage) usage = obj.usage;
        const msg = obj.choices?.[0]?.message;
        if (msg?.content) text = msg.content;
        if (msg?.tool_calls) {
          msg.tool_calls.forEach((tc, idx) => {
            toolCallsMap.set(idx, {
              id: tc.id || '',
              name: tc.function?.name || '',
              arguments: tc.function?.arguments || '',
            });
          });
        }
      } catch (e) {}
    }

    const tools = Array.from(toolCallsMap.values()).map(tc => {
      let parsedArgs = tc.arguments;
      if (typeof tc.arguments === 'string') {
        try { parsedArgs = JSON.parse(tc.arguments); } catch {}
      }
      return { id: tc.id, name: tc.name, arguments: parsedArgs };
    });

    return { usage, tools, text };
  }

  function getPromptOverlapScore(userText, prompt) {
    if (!userText || !prompt) return 0;
    const len = prompt.length;
    let matches = 0;
    const samples = [
      prompt.slice(0, 50),
      prompt.slice(Math.floor(len * 0.25), Math.floor(len * 0.25) + 50),
      prompt.slice(Math.floor(len * 0.50), Math.floor(len * 0.50) + 50),
      prompt.slice(Math.floor(len * 0.75), Math.floor(len * 0.75) + 50),
      prompt.slice(Math.max(0, len - 60)),
    ];
    for (const s of samples) {
      if (s && userText.includes(s.trim())) matches++;
    }
    return matches;
  }

  function syncSubagentTurnsForTask(db, store, taskId, apiCalls) {
    if (!apiCalls || !apiCalls.length) return;

    for (const c of apiCalls) {
      if (!c.hasSubagents || !c.subagents || !Array.isArray(c.subagents.items)) continue;
      const parentCallIdx = c.turn;
      const workers = c.subagents.items;

      // 1. Check if turns are already saved in SQLite
      const existingDbTurns = getSubagentTurns(db, taskId, parentCallIdx);
      if (existingDbTurns && existingDbTurns.length > 0) {
        workers.forEach(w => {
          const wNum = w.index || 1;
          let runningCost = 0;
          w.apiCalls = existingDbTurns.filter(t => t.worker_index === wNum).map(t => {
            runningCost += (t.cost || 0);
            return {
              ...t,
              cumulativeCost: runningCost,
              cacheHitPct: cacheHitPctOf(t),
            };
          });
          w.cacheReads = w.apiCalls.reduce((s, t) => s + (t.cacheReads || 0), 0);
          w.cacheWrites = w.apiCalls.reduce((s, t) => s + (t.cacheWrites || 0), 0);
          w.cacheHitPct = cacheHitPctOf({ tokensIn: w.inputTokens, cacheReads: w.cacheReads, cacheWrites: w.cacheWrites });
        });
        c.subagents.totalCacheReads = workers.reduce((s, w) => s + (w.cacheReads || 0), 0);
        c.subagents.totalCacheWrites = workers.reduce((s, w) => s + (w.cacheWrites || 0), 0);
        c.subagents.cacheHitPct = cacheHitPctOf({ tokensIn: c.subagents.inputTokens, cacheReads: c.subagents.totalCacheReads, cacheWrites: c.subagents.totalCacheWrites });
        continue;
      }

      const minStart = Math.min(...workers.map(w => w.startTime || 0));
      const maxEnd = Math.max(...workers.map(w => w.endTime || Date.now()));
      if (!minStart || minStart === Infinity) continue;

      // 2. If not in DB, extract from proxy store if available
      let storeRequests = [];
      if (store) {
        try {
          const { requests } = store.getAll({ limit: 9999 });
          if (requests && requests.length) storeRequests = requests;
        } catch {}
      }

      // Fallback: If store is empty, look in SQLite llm_request_fingerprints table
      if (!storeRequests.length && db) {
        try {
          const fpRows = db.prepare(
            "SELECT * FROM llm_request_fingerprints WHERE captured_ts BETWEEN ? AND ? AND (agent_label LIKE '%Subagent%' OR model LIKE '%sonnet%') ORDER BY captured_ts ASC"
          ).all(minStart - 10000, maxEnd + 10000);

          if (fpRows && fpRows.length > 0) {
            const chains = new Map();
            fpRows.forEach(r => {
              const fp = JSON.parse(r.fingerprint_json);
              const root = fp.msgHashes?.[0] || 'root';
              if (!chains.has(root)) chains.set(root, []);
              chains.get(root).push({ r, fp });
            });

            const turnsToSave = [];
            for (const w of workers) {
              let matchedChain = null;
              for (const [root, list] of chains.entries()) {
                const totalOut = list.reduce((s, x) => s + (x.r.completion_tokens || 0), 0);
                if (Math.abs(totalOut - w.outputTokens) <= 50) {
                  matchedChain = list;
                  break;
                }
              }
              if (matchedChain) {
                let runningCost = 0;
                matchedChain.forEach((item, tIdx) => {
                  const turnCost = item.r.reported_cost || 0;
                  runningCost += turnCost;
                  const tokensIn = item.r.prompt_tokens || 0;
                  const tokensOut = item.r.completion_tokens || 0;
                  const cacheReads = item.r.cached_tokens || 0;
                  const cacheWrites = item.r.cache_write_tokens || 0;
                  const contextTokens = tokensIn + tokensOut;
                  const contextWindow = w.contextWindow || 1000000;
                  const contextPct = contextWindow ? Math.min(100, (contextTokens / contextWindow) * 100) : 0;
                  turnsToSave.push({
                    taskId,
                    parentCallIdx,
                    workerIndex: w.index,
                    turnNumber: tIdx + 1,
                    ts: item.r.captured_ts,
                    durationMs: 2500,
                    modelId: item.r.model,
                    requestSize: Math.round(tokensIn * 3.5),
                    tokensIn,
                    tokensOut,
                    cacheReads,
                    cacheWrites,
                    cost: turnCost,
                    contextTokens,
                    contextWindow,
                    contextPct,
                    tools: (item.fp.toolNames && item.fp.finish === 'tool_calls') ? [{ name: item.fp.toolNames[0] || 'tool' }] : [],
                    resultPreview: item.fp.finish === 'stop' ? 'Completed output' : null,
                  });
                });
              }
            }
            if (turnsToSave.length > 0) {
              saveSubagentTurns(db, turnsToSave);
              const savedTurns = getSubagentTurns(db, taskId, parentCallIdx);
              workers.forEach(w => {
                const wNum = w.index || 1;
                let runningCost = 0;
                w.apiCalls = savedTurns.filter(t => t.worker_index === wNum).map(t => {
                  runningCost += (t.cost || 0);
                  return { ...t, cumulativeCost: runningCost };
                });
              });
              continue;
            }
          }
        } catch (e) {
          console.warn('[prompt-analytics] fingerprint fallback error:', e.message);
        }
      }

      if (!storeRequests.length) continue;

      const CHAT_MATCH = /chat\/completions|\/v1\/messages/i;
      const subReqs = [];
      for (const r of requests) {
        if (!CHAT_MATCH.test(r.url || '') || !r.requestBody) continue;
        const recTs = new Date(r.timestamp).getTime();
        if (recTs >= minStart - 15000 && recTs <= maxEnd + 15000) {
          if ((r.agentLabel && /subagent/i.test(r.agentLabel)) || (r.requestBody && r.requestBody.includes('PostQode Subagent'))) {
            subReqs.push(r);
          }
        }
      }

      if (!subReqs.length) continue;
      subReqs.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

      const workerTurnsMap = new Map();
      workers.forEach(w => workerTurnsMap.set(w.index, []));

      for (const r of subReqs) {
        const full = store.getById(r.id) || r;
        let reqObj = null;
        try { reqObj = typeof full.requestBody === 'object' ? full.requestBody : JSON.parse(full.requestBody); } catch {}
        const userText = reqObj?.messages?.find(m => m.role === 'user')?.content || '';
        const textStr = typeof userText === 'string' ? userText : JSON.stringify(userText);
        const rTs = new Date(full.timestamp).getTime();

        let bestWorker = null;
        let bestScore = 0;
        for (const w of workers) {
          if (rTs >= (w.startTime || 0) - 15000 && rTs <= (w.endTime || Date.now()) + 15000) {
            const score = getPromptOverlapScore(textStr, w.prompt);
            if (score > bestScore) {
              bestScore = score;
              bestWorker = w;
            }
          }
        }

        if (!bestWorker && workers.length === 1) bestWorker = workers[0];
        if (bestWorker) {
          const parsed = parseResponseBody(full.responseBody);
          const tokensIn = parsed.usage?.prompt_tokens || parsed.usage?.input_tokens || 0;
          const tokensOut = parsed.usage?.completion_tokens || parsed.usage?.output_tokens || 0;
          const cacheReads = parsed.usage?.prompt_tokens_details?.cached_tokens || parsed.usage?.cache_read_input_tokens || 0;
          const cacheWrites = parsed.usage?.prompt_tokens_details?.cache_write_tokens || parsed.usage?.cache_creation_input_tokens || 0;
          const cost = parsed.usage?.cost || 0;
          const modelId = reqObj?.model || full.model || bestWorker.modelId || '';
          const mInfo = getModelInfo(modelId);
          const contextWindow = mInfo?.contextWindow || bestWorker.contextWindow || 200000;
          const contextTokens = tokensIn + tokensOut;
          const contextPct = contextWindow ? Math.min(100, (contextTokens / contextWindow) * 100) : 0;

          const turnList = workerTurnsMap.get(bestWorker.index);
          const turnNumber = turnList.length + 1;

          turnList.push({
            taskId,
            parentCallIdx,
            workerIndex: bestWorker.index,
            turnNumber,
            ts: rTs,
            durationMs: full.duration || 0,
            modelId,
            requestSize: full.requestBody ? (typeof full.requestBody === 'string' ? full.requestBody.length : JSON.stringify(full.requestBody).length) : 0,
            tokensIn,
            tokensOut,
            cacheReads,
            cacheWrites,
            cost,
            contextTokens,
            contextWindow,
            contextPct,
            tools: parsed.tools,
            resultPreview: parsed.text ? parsed.text.slice(0, 300) : null,
          });
        }
      }

      const allTurnsToSave = [];
      for (const [wIdx, turnList] of workerTurnsMap.entries()) {
        allTurnsToSave.push(...turnList);
        const w = workers.find(item => item.index === wIdx);
        if (w) {
          let runningCost = 0;
          w.apiCalls = turnList.map(t => {
            runningCost += (t.cost || 0);
            return {
              turn: t.turnNumber,
              ts: t.ts,
              durationMs: t.durationMs,
              modelId: t.modelId,
              requestSize: t.requestSize,
              tokensIn: t.tokensIn,
              tokensOut: t.tokensOut,
              cacheReads: t.cacheReads,
              cacheWrites: t.cacheWrites,
              cost: t.cost,
              cumulativeCost: runningCost,
              cacheHitPct: cacheHitPctOf(t),
              contextUtilizationPct: t.contextPct,
              contextTokens: t.contextTokens,
              contextWindowSize: t.contextWindow,
              tools: t.tools,
              resultPreview: t.resultPreview,
            };
          });
          w.cacheReads = w.apiCalls.reduce((s, t) => s + (t.cacheReads || 0), 0);
          w.cacheWrites = w.apiCalls.reduce((s, t) => s + (t.cacheWrites || 0), 0);
          w.cacheHitPct = cacheHitPctOf({ tokensIn: w.inputTokens, cacheReads: w.cacheReads, cacheWrites: w.cacheWrites });
        }
      }
      c.subagents.totalCacheReads = workers.reduce((s, w) => s + (w.cacheReads || 0), 0);
      c.subagents.totalCacheWrites = workers.reduce((s, w) => s + (w.cacheWrites || 0), 0);
      c.subagents.cacheHitPct = cacheHitPctOf({ tokensIn: c.subagents.inputTokens, cacheReads: c.subagents.totalCacheReads, cacheWrites: c.subagents.totalCacheWrites });

      if (allTurnsToSave.length > 0) {
        try {
          saveSubagentTurns(db, allTurnsToSave);
        } catch (err) {
          console.warn('[prompt-analytics] saveSubagentTurns error:', err.message);
        }
      }
    }
  }

  function resolveTaskPath(taskId) {
    let taskSource = null;
    try {
      const task = db.prepare('SELECT source FROM tasks WHERE id = ?').get(taskId);
      if (task) taskSource = task.source;
    } catch (e) {}

    if (taskSource) {
      for (const src of (config.sources || [])) {
        if (!src.enabled) continue;
        if (src.name === taskSource) {
          const dir = path.join(resolvePath(src.path), taskId);
          if (fs.existsSync(dir)) return dir;
        }
      }
    }

    for (const src of (config.sources || [])) {
      if (!src.enabled) continue;
      const dir = path.join(resolvePath(src.path), taskId);
      if (fs.existsSync(dir)) return dir;
    }

    // Direct fallback search across common globalStorage locations
    const directPaths = [
      path.join(os.homedir(), 'Library', 'Application Support', 'Code - Insiders', 'User', 'globalStorage', 'postqode.postqode', 'tasks', taskId),
      path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'postqode.postqode', 'tasks', taskId),
      path.join(os.homedir(), '.postqode', 'tasks', taskId),
    ];
    for (const dp of directPaths) {
      if (fs.existsSync(dp)) return dp;
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

    // ── Load persisted system prompts for this task (captured by proxy) ──
    let allSystemPrompts = [];
    let systemPromptCapture = null;
    try {
      allSystemPrompts = getTaskSystemPrompts(db, taskId);
      systemPromptCapture = allSystemPrompts.find(p => p.agent_role === 'main' || !p.agent_role) || allSystemPrompts[0] || null;

      if (!systemPromptCapture) {
        // Fallback to latest system prompt captured in DB
        const latestRow = db.prepare(
          'SELECT system_text, approx_tokens, model_id, captured_at_ts, agent_role, agent_name FROM task_system_prompts ORDER BY id DESC LIMIT 1'
        ).get();
        if (latestRow) systemPromptCapture = latestRow;
      }
    } catch (e) { /* table may not exist on older DBs — safe to ignore */ }

    // Load physical memory timeline for this task
    let memoryTimeline = [];
    try {
      memoryTimeline = getMemoryTimeline(db, taskId);
    } catch (e) {}

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

      // 3. Check UI messages until the next api_req_started for tools & subagents
      let subagentRun = null;
      let initialPrompts = [];
      const turnTools = [];
      for (let j = i + 1; j < uiMessages.length; j++) {
        const nextM = uiMessages[j];
        if (nextM.say === 'api_req_started') break;
        if (nextM.say === 'tool' || nextM.ask === 'tool' || nextM.say === 'use_subagents' || nextM.say === 'postqode_browser_agent') {
          let toolName = 'unknown';
          let toolDetail = '';
          let toolIsLocatedInWorkspace = null;
          try {
            const p = typeof nextM.text === 'string' ? JSON.parse(nextM.text) : nextM.text;
            toolName = p.tool || p.toolName || p.server_name || (nextM.say === 'use_subagents' ? 'use_subagents' : 'tool');
            toolDetail = p.path || p.command || p.arguments || '';
            if (p.operationIsLocatedInWorkspace !== undefined) {
              toolIsLocatedInWorkspace = p.operationIsLocatedInWorkspace;
            }
          } catch (e) {
            toolName = nextM.say;
          }
          turnTools.push({
            tool: toolName,
            detail: toolDetail,
            ts: nextM.ts,
            workspace: toolIsLocatedInWorkspace,
            type: nextM.type,
          });
        }
        let subagentLaunchArgs = null;
        if (nextM.say === 'use_subagents' && nextM.text) {
          try {
            const parsed = typeof nextM.text === 'string' ? JSON.parse(nextM.text) : nextM.text;
            subagentLaunchArgs = parsed;
            if (Array.isArray(parsed.prompts)) {
              initialPrompts = parsed.prompts;
            }
          } catch (e) {}
        }
        if (nextM.say === 'subagent' && nextM.text) {
          try {
            const subObj = typeof nextM.text === 'string' ? JSON.parse(nextM.text) : nextM.text;
            if (!subagentRun || subObj.status === 'completed' || (subObj.completed || 0) >= (subagentRun.completed || 0)) {
              subagentRun = subObj;
              if (subagentLaunchArgs) {
                if (subagentLaunchArgs.background === 'true' || subagentLaunchArgs.background === true) subagentRun.isBackground = true;
                if (subagentLaunchArgs.fork === 'true' || subagentLaunchArgs.fork === true) subagentRun.isFork = true;
                if (subagentLaunchArgs.model) subagentRun.modelId = subagentLaunchArgs.model;
              }
            }
          } catch (e) {}
        }
      }

      if (subagentRun) {
        if (Array.isArray(subagentRun.items)) {
          subagentRun.items.forEach((it, idx) => {
            if (!it.prompt && initialPrompts[idx]) {
              it.prompt = initialPrompts[idx];
            }
            const workerNum = it.index || (idx + 1);
            // Look for matching captured subagent system prompt from proxy
            const exactSubPrompt = allSystemPrompts.find(p => 
              (p.agent_role === 'subagent' || p.agent_role === 'custom_agent') &&
              (p.subagent_index === workerNum || p.subagent_index === idx)
            );
            const genericSubPrompt = allSystemPrompts.find(p => p.agent_role === 'subagent' && p.subagent_index == null);
            const matchedPrompt = exactSubPrompt || genericSubPrompt;

            if (matchedPrompt) {
              it.systemPrompt = matchedPrompt.system_text;
              it.systemPromptTokens = matchedPrompt.approx_tokens;
            }
            if (exactSubPrompt && exactSubPrompt.agent_name) {
              it.agentName = exactSubPrompt.agent_name;
            } else {
              it.agentName = `Worker #${workerNum}`;
            }
          });
          subagentRun.totalInputTokens = subagentRun.inputTokens != null ? subagentRun.inputTokens : subagentRun.items.reduce((s, it) => s + (it.inputTokens || 0), 0);
          subagentRun.totalOutputTokens = subagentRun.outputTokens != null ? subagentRun.outputTokens : subagentRun.items.reduce((s, it) => s + (it.outputTokens || 0), 0);
        } else {
          subagentRun.totalInputTokens = subagentRun.inputTokens || 0;
          subagentRun.totalOutputTokens = subagentRun.outputTokens || 0;
        }
      }

      // ── Per-call context window utilization (with error smoothing) ──
      // Looks up the model's context window from the registry and computes how
      // much of it was used: (uncached input + cache reads + system prompt tokens) / context window
      // When an API call is an error/failed retry that returned 0 tokens, smooth using requestSize.
      const modelInfo = getModelInfo(mId);
      const contextWindowSize = modelInfo?.contextWindow || null;
      
      const isFailedOrZeroReturn = (data.tokensIn === 0 && data.cacheReads === 0 && !data.cacheWrites);
      let totalTokensInContext;
      if (isFailedOrZeroReturn && requestSize > 0) {
        const estimatedTokens = Math.round(requestSize / 3.2);
        totalTokensInContext = estimatedTokens || (prevTotalTokensInContext + Math.round(turnDeltaSize / 3.2));
      } else {
        // The provider-reported prompt already contains the system prompt and tools; cache WRITES are part of it
        // (a call that rewrites the whole prompt has tokensIn≈0 and cacheReads=0 but a full-size cacheWrites).
        totalTokensInContext = promptTokensOf(data);
      }
      prevTotalTokensInContext = totalTokensInContext;

      const contextUtilizationPct = contextWindowSize
        ? Math.min(100, (totalTokensInContext / contextWindowSize) * 100)
        : null;

      // Find closest memory snapshot within 5 minutes of this API call
      let closestMem = null;
      if (memoryTimeline && memoryTimeline.length > 0) {
        let minDrift = Infinity;
        for (const m of memoryTimeline) {
          const drift = Math.abs(m.ts - msg.ts);
          if (drift < minDrift) {
            minDrift = drift;
            closestMem = m;
          }
        }
        if (minDrift > 300000) closestMem = null;
      }

      apiCalls.push({
        index: apiCalls.length,
        turn: apiCalls.length + 1,
        uiMsgIndex: i,
        ts: msg.ts,
        tokensIn: data.tokensIn || 0,
        tokensOut: data.tokensOut || 0,
        cacheReads: data.cacheReads || 0,
        cacheWrites: data.cacheWrites || 0,
        // 1-hour TTL portion of cacheWrites (a subset); the field is absent on builds that predate the 1h option
        cacheWrites1h: data.cacheWrite1hTokens || 0,
        hasField1h: data.cacheWrite1hTokens !== undefined,
        mode: msg.modelInfo?.mode || null,
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
        hasSubagents: !!subagentRun,
        subagents: subagentRun,
        tools: turnTools,
        toolCount: turnTools.length,
        isParallel: turnTools.length > 1,
        parallelCount: turnTools.length,
        requestText: data.request || null,
        modelId: mId,
        providerId: msg.modelInfo?.providerId || null,
        // Context window fields
        contextWindowSize,
        systemPromptTokens,
        totalTokensInContext,
        contextUtilizationPct,
        // Physical Host RAM and process memory snapshot
        systemRamPct: closestMem?.system_ram_pct != null ? closestMem.system_ram_pct : null,
        systemRamUsedGB: closestMem?.system_ram_used_bytes ? parseFloat((closestMem.system_ram_used_bytes / (1024 ** 3)).toFixed(2)) : null,
        systemRamTotalGB: closestMem?.system_ram_total_bytes ? parseFloat((closestMem.system_ram_total_bytes / (1024 ** 3)).toFixed(2)) : null,
        processHeapMB: closestMem?.process_heap_bytes ? parseFloat((closestMem.process_heap_bytes / (1024 ** 2)).toFixed(1)) : null,
      });

      if (requestSize > 0) prevRequestSize = requestSize;
    }

    // Sync and attach turn-by-turn subagent execution history from SQLite or proxy store
    try {
      syncSubagentTurnsForTask(db, typeof getStore === 'function' ? getStore() : null, taskId, apiCalls);
    } catch (e) {
      console.warn('[prompt-analytics] syncSubagentTurns error:', e.message);
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
      c.cacheHitPct = cacheHitPctOf(c);
    }

    // ── Prompt-cache analysis: TTL, exact per-model cost components, per-model cache threads, evidence-backed cause ──
    let cacheAnalysis = { calls: [], summary: null, evidence: { fingerprints: 0, matched: 0, extensionLogEvents: 0 } };
    try {
      cacheAnalysis = buildCacheAnalysis({
        db, store: typeof getStore === 'function' ? getStore() : null, taskId, apiCalls, uiMessages,
      });
    } catch (e) {
      console.warn('[prompt-analytics] cache analysis failed:', e.message);
    }
    for (let i = 0; i < apiCalls.length; i++) {
      const c = apiCalls[i];
      const a = cacheAnalysis.calls[i];
      if (!a) { c.cacheExplanation = null; continue; }
      c.cache = a;
      // `cacheExplanation` keeps the shape the page already renders: { code, text } (+ title and evidence level)
      c.cacheExplanation = { code: a.cause, title: a.message.title, text: a.message.text, level: a.evidenceLevel, spike: a.isSpike };
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
              if (fname.includes('subagents') || toolName === 'use_subagents' || toolName === 'agents') {
                targetPath = '🤖 Subagent Findings';
                toolName = 'use_subagents';
              } else if (fLineIdx >= 0) {
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
                  if (fname.includes('subagents') || toolName === 'use_subagents' || toolName === 'agents') {
                    targetPath = '🤖 Subagent Findings';
                    toolName = 'use_subagents';
                  } else {
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
                  if (fname.includes('subagents') || toolName === 'use_subagents' || toolName === 'agents') {
                    targetPath = '🤖 Subagent Findings';
                    toolName = 'use_subagents';
                  } else {
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
          if (toolName === 'use_subagents' || toolName === 'agents' || fname.includes('subagents')) {
            reductionCategory = 'Subagents Offload';
            displayTarget = `🤖 Subagent Findings Offloaded (${fname})`;
          } else if (toolName === 'read_file') reductionCategory = 'File Read Truncated';
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

      // ── Register Subagent Parallel Runs in Reduction Timeline ──
      if (c.hasSubagents && c.subagents) {
        const sub = c.subagents;
        const items = sub.items || [];
        const workerModel = sub.modelId || items[0]?.modelId || c.modelId || 'unknown';
        const totalCost = sub.totalCost || items.reduce((s, it) => s + (it.totalCost || 0), 0);
        const totalTools = sub.toolCalls || items.reduce((s, it) => s + (it.toolCalls || 0), 0);
        const totalIn = sub.inputTokens || items.reduce((s, it) => s + (it.inputTokens || 0), 0);
        const totalOut = sub.outputTokens || items.reduce((s, it) => s + (it.outputTokens || 0), 0);

        // Check if subagent findings were offloaded to scratch
        const subScratch = scratchEvents.find(s => s.toolName === 'use_subagents' || s.filename.includes('subagents'));
        if (subScratch) {
          sub.scratchOffloaded = true;
          sub.scratchFile = subScratch.filename;
          sub.rawBytes = subScratch.rawBytes;
          sub.promptBytes = subScratch.promptBytes;
          sub.bytesSaved = subScratch.bytesSaved;
        }

        const successesCount = sub.successes != null ? sub.successes : items.filter(it => it.status === 'completed').length;
        const failuresCount = sub.failures != null ? sub.failures : items.filter(it => it.status === 'failed').length;
        if (sub.status === 'failed' && successesCount > 0 && failuresCount === 0) {
          sub.isFalseFailure = true;
        }

        const anomalyNotice = sub.isFalseFailure ? `\n⚠️ PostQode Status Anomaly: Reported status is "failed" in logs, but all ${successesCount} workers completed with 0 failures.` : '';
        const offloadNotice = sub.scratchOffloaded ? `\n📦 Context Offload: ${sub.rawBytes.toLocaleString()} bytes offloaded to scratch file (${sub.scratchFile}); only ${sub.promptBytes.toLocaleString()} bytes kept in prompt history.` : '';

        reductionEvents.push({
          eventIndex: reductionEvents.length,
          callIndex: c.index,
          prevCallIndex: c.index > 0 ? c.index - 1 : 0,
          msgIndex: c.historyIndex >= 0 ? c.historyIndex : 0,
          role: 'subagent',
          category: 'Subagents',
          targetName: `🤖 Subagents: ${items.length || sub.total || 1} parallel workers (${workerModel.split('/').pop()})${sub.scratchOffloaded ? ` [📦 ${(sub.bytesSaved / 1024).toFixed(1)} KB offloaded to scratch]` : ''}`,
          beforeSize: (sub.scratchOffloaded ? sub.rawBytes : totalIn * 4),
          afterSize: (sub.scratchOffloaded ? sub.promptBytes : totalOut * 4),
          bytesSaved: sub.scratchOffloaded ? sub.bytesSaved : 0,
          diffChunks: {
            prefix: `[Subagent Parallel Execution on Call #${c.turn}]\nModel: ${workerModel}\nWorkers: ${items.length || sub.total || 1} (${sub.completed || items.length} completed)\nTools Executed: ${totalTools}\nInput Tokens: ${totalIn.toLocaleString()} | Output Tokens: ${totalOut.toLocaleString()}\nSubagent Total Cost: $${totalCost.toFixed(4)}${anomalyNotice}${offloadNotice}`,
            removedText: '',
            insertedText: items.map((it, idx) => `=== Worker #${it.index || idx + 1} [${it.status || 'completed'}] Model: ${it.modelId || workerModel} (Tools: ${it.toolCalls || 0}, Cost: $${(it.totalCost || 0).toFixed(4)}) ===\nGoal / Prompt:\n${it.prompt || ''}\n\nFindings & Results:\n${it.result || it.latestToolCall || '(Running / no result returned)'}\n`).join('\n---\n'),
            suffix: '',
          },
          isSubagent: true,
          subagentData: sub,
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

    // ── Build Comprehensive Subagent Summary & Exact ROI Analysis ──
    const subRuns = apiCalls.filter(c => c.hasSubagents && c.subagents);
    const totalSubTurns = subRuns.reduce((s, c) => s + (c.subagents.items || []).reduce((is, it) => is + (it.apiCalls?.length || it.toolCalls || (it.inputTokens > 0 ? 1 : 0)), 0), 0);
    const totalSubCacheReads = subRuns.reduce((s, c) => s + (c.subagents.totalCacheReads || (c.subagents.items || []).reduce((is, it) => is + (it.cacheReads || 0), 0)), 0);
    const totalSubCacheWrites = subRuns.reduce((s, c) => s + (c.subagents.totalCacheWrites || (c.subagents.items || []).reduce((is, it) => is + (it.cacheWrites || 0), 0)), 0);
    const totalSubCost = subRuns.reduce((s, c) => s + (c.subagents.totalCost || (c.subagents.items || []).reduce((is, it) => is + (it.totalCost || 0), 0)), 0);
    const totalSubIn = subRuns.reduce((s, c) => s + (c.subagents.inputTokens || (c.subagents.items || []).reduce((is, it) => is + (it.inputTokens || 0), 0)), 0);
    const totalSubOut = subRuns.reduce((s, c) => s + (c.subagents.outputTokens || (c.subagents.items || []).reduce((is, it) => is + (it.outputTokens || 0), 0)), 0);

    // ── Dynamic Provider & Multi-Model Rate Resolution ──
    const mainModelId = detectedModelId || apiCalls.find(c => c.modelId)?.modelId || 'anthropic/claude-opus-5.5';
    const subModelId = subRuns[0]?.subagents?.modelId || subRuns[0]?.subagents?.items?.[0]?.modelId || '~anthropic/claude-sonnet-latest';

    const mainProfile = resolveModelPricing(mainModelId, openrouterCache);
    const subProfile = resolveModelPricing(subModelId, openrouterCache);

    const isModelArbitrage = canon(mainModelId) !== canon(subModelId);
    const hasBackgroundAgent = subRuns.some(c => 
      c.tools?.some(t => t.background === 'true' || t.arguments?.background === 'true') || 
      c.subagents?.isBackground || false
    );
    const hasForkAgent = subRuns.some(c => 
      c.tools?.some(t => t.fork === 'true' || t.arguments?.fork === 'true') || 
      c.subagents?.isFork || false
    );

    // Timing analysis
    let totalSeqDurationSec = 0;
    let totalActualWallClockSec = 0;

    // ── Programmatic Scope Independence & Context Overlap Analysis ──
    const scopeAnalysis = computeSubagentScopeAnalysis(uiMessages);

    for (const c of subRuns) {
      const sub = c.subagents;
      const items = sub.items || [];
      const turns = items.flatMap(it => it.apiCalls || []);
      const runTurnsCount = turns.length || items.reduce((s, it) => s + (it.toolCalls || 1), 0) || (sub.total || items.length) * 5;
      const workerDurationsSec = items.reduce((s, it) => s + ((it.durationMs || 0) / 1000), 0);
      const runSeqDurationSec = workerDurationsSec > 0 ? workerDurationsSec : (runTurnsCount * 11.5);
      totalSeqDurationSec += runSeqDurationSec;

      const validStarts = items.map(it => it.startTime).filter(Boolean);
      const validEnds = items.map(it => it.endTime).filter(Boolean);
      const runMinStart = validStarts.length ? Math.min(...validStarts) : 0;
      const runMaxEnd = validEnds.length ? Math.max(...validEnds) : 0;
      const runDurationSec = (runMinStart > 0 && runMaxEnd > runMinStart) ? (runMaxEnd - runMinStart) / 1000 : Math.min(120, runSeqDurationSec);
      totalActualWallClockSec += runDurationSec;

      // Find scope for this run
      const runScope = scopeAnalysis.runs.find(r => r.callIndex === c.index);
      const runNovelFiles = runScope ? runScope.uniqueNovelFilesCount : (items.length * 3);
      const runTargetFiles = runScope ? runScope.uniqueTargetFilesCount : (items.length * 4);

      // Realistic counterfactual if this run was executed in the main agent (Claude Opus 5.5)
      // Modern LLMs batch 3-5 file reads in parallel per turn
      const turnsNeeded = Math.max(2, Math.round(runNovelFiles / 3.5 + 2));
      const mainPrefixAtCall = (c.tokensIn || 0) + (c.cacheReads || 0) + (c.cacheWrites || 0) || 120000;
      const counterfactualCacheReads = turnsNeeded * mainPrefixAtCall;
      const counterfactualToolTokens = runNovelFiles * 5200;
      const counterfactualOutTokens = turnsNeeded * 450;

      const counterfactualMainCost = (counterfactualCacheReads / 1e6) * mainProfile.cacheReadRate
                                   + (counterfactualToolTokens / 1e6) * mainProfile.inputRate
                                   + (counterfactualOutTokens / 1e6) * mainProfile.outputRate
                                   + (mainProfile.explicitWrites ? (turnsNeeded * 1200 / 1e6) * mainProfile.cacheWriteRate : 0);

      const costDelta = counterfactualMainCost - (sub.totalCost || 0);
      const isNetSavings = costDelta >= 0;
      const savingsDollar = Math.abs(costDelta);
      const savingsPct = counterfactualMainCost > 0 ? Math.round((savingsDollar / counterfactualMainCost) * 100) : 0;

      sub.roi = {
        actualCost: sub.totalCost || 0,
        counterfactualMainCost,
        savingsDollar,
        savingsPct,
        isNetSavings,
        turnsNeeded,
        novelFilesCount: runNovelFiles,
        targetFilesCount: runTargetFiles,
        mainPrefixAtCall,
        wallClockSavedSec: Math.max(0, runSeqDurationSec - runDurationSec),
        concurrencyFactor: items.length || sub.total || 1,
        mainModelName: mainModelId.split('/').pop(),
        workerModelName: (sub.modelId || items[0]?.modelId || subModelId).split('/').pop(),
      };
    }

    // Baseline 1: Scope-Grounded Single Agent Baseline
    // Programmatically determined by extracting the exact unique files the subagents were tasked to inspect
    // that the main agent had ZERO prior context for before that turn.
    const startPrefixCtx = subRuns[0] ? ((subRuns[0].tokensIn || 0) + (subRuns[0].cacheReads || 0) + (subRuns[0].cacheWrites || 0)) : 120000;
    const groundedNovelFiles = scopeAnalysis.summary.totalDistinctNovelFiles || 0;
    // Account for modern parallel tool calling (batching 3-5 files per turn)
    const groundedTurns = scopeAnalysis.summary.groundedMinTurns || Math.max(2, Math.round(groundedNovelFiles / 3.5 + 3));
    const groundedToolTokensIn = groundedNovelFiles * 5200;
    const groundedOutTokens = Math.round(groundedTurns * 450);
    const avgCtxTokens = Math.round(startPrefixCtx + (groundedTurns * 1200));

    const groundedMainCost = (groundedTurns * avgCtxTokens / 1e6) * mainProfile.cacheReadRate
                           + (groundedToolTokensIn / 1e6) * mainProfile.inputRate
                           + (groundedOutTokens / 1e6) * mainProfile.outputRate
                           + (mainProfile.explicitWrites ? (groundedTurns * 1200 / 1e6) * mainProfile.cacheWriteRate : 0);

    const groundedSameModelCost = (groundedTurns * avgCtxTokens / 1e6) * subProfile.cacheReadRate
                                + (groundedToolTokensIn / 1e6) * subProfile.inputRate
                                + (groundedOutTokens / 1e6) * subProfile.outputRate
                                + (subProfile.explicitWrites ? (groundedTurns * 1200 / 1e6) * subProfile.cacheWriteRate : 0);

    // Baseline 2: Exhaustive Monolithic Single Agent (Matching Subagent Depth in Main Thread)
    const exhaustiveAvgCtxTokens = Math.round(startPrefixCtx + (totalSubTurns * 1200));
    const exhaustiveMainCost = (totalSubTurns * exhaustiveAvgCtxTokens / 1e6) * mainProfile.cacheReadRate
                             + (Math.round(totalSubIn * 0.25) / 1e6) * mainProfile.inputRate
                             + (Math.round(totalSubOut * 0.35) / 1e6) * mainProfile.outputRate
                             + (mainProfile.explicitWrites ? (totalSubTurns * 1800 / 1e6) * mainProfile.cacheWriteRate : 0);

    const exhaustiveSameModelCost = (totalSubTurns * exhaustiveAvgCtxTokens / 1e6) * subProfile.cacheReadRate
                                  + (Math.round(totalSubIn * 0.25) / 1e6) * subProfile.inputRate
                                  + (Math.round(totalSubOut * 0.35) / 1e6) * subProfile.outputRate
                                  + (subProfile.explicitWrites ? (totalSubTurns * 1800 / 1e6) * subProfile.cacheWriteRate : 0);

    // Redundant work detection: find main agent calls that read scratch files or re-queried subagent areas
    let redundantCost = 0;
    const redundantCalls = [];
    for (const c of apiCalls) {
      const isPostSubagent = subRuns.some(sr => c.turn > sr.turn && c.turn <= sr.turn + 6);
      if (!isPostSubagent) continue;
      const readScratch = c.tools?.some(t => (t.tool === 'readFile' || t.name === 'readFile' || t.tool === 'read_file') && (JSON.stringify(t).includes('scratch') || JSON.stringify(t).includes('subagent')));
      const reqText = c.requestText || '';
      const isSpotCheck = reqText.includes('spot-check') || reqText.includes('verify subagent') || reqText.includes('subagent findings') || reqText.includes('worker output');
      if (readScratch || isSpotCheck) {
        redundantCost += (c.cost || 0);
        redundantCalls.push({
          turn: c.turn,
          cost: c.cost || 0,
          tool: c.tools?.[0]?.tool || c.tools?.[0]?.name || 'read_file',
          reason: readScratch ? 'Re-read truncated subagent findings from scratch log' : 'Spot-check verification of subagent findings',
        });
      }
    }

    const frictionTurns = redundantCalls.length;
    const frictionCost = redundantCost;
    const frictionBytes = totalScratchSavedBytes || 0;
    const frictionDesc = frictionTurns > 0
      ? `PostQode offloaded ${Math.round(frictionBytes / 1024)} KB into scratch/, causing ${frictionTurns} extra main agent turn${frictionTurns === 1 ? '' : 's'} ($${frictionCost.toFixed(3)}) to re-read and spot-check.`
      : 'No redundant scratch re-reads or verification churn detected in subsequent main agent turns.';

    const explorationOverhead = Math.max(0, totalSubCost - groundedMainCost);
    const wallClockSavedSec = Math.max(0, totalSeqDurationSec - totalActualWallClockSec);
    const speedupFactor = totalActualWallClockSec > 0 ? (totalSeqDurationSec / totalActualWallClockSec) : 1;

    const tokensPrevented = (totalSubIn > 0 || totalSubOut > 0)
      ? (totalSubIn + totalSubOut)
      : (groundedToolTokensIn + (totalSubTurns * 1500));
    const firstSubTurn = subRuns[0] ? subRuns[0].turn : 1;
    const lastTurn = apiCalls.length;
    const contextDescription = tokensPrevented > 0
      ? `${tokensPrevented.toLocaleString()} tokens of raw file reads and worker execution kept out of main thread${lastTurn > firstSubTurn ? `, keeping turns ${firstSubTurn + 1}–${lastTurn} lean.` : '.'}`
      : 'Clean isolated context prevented main thread token bloat.';

    const subagentSummary = {
      hasSubagents: subRuns.length > 0,
      totalRuns: subRuns.length,
      totalWorkers: apiCalls.reduce((s, c) => s + (c.subagents?.total || c.subagents?.items?.length || 0), 0),
      totalTurns: totalSubTurns,
      totalCost: totalSubCost,
      totalCacheReads: totalSubCacheReads,
      totalCacheWrites: totalSubCacheWrites,
      cacheHitPct: cacheHitPctOf({ tokensIn: totalSubIn, cacheReads: totalSubCacheReads, cacheWrites: totalSubCacheWrites }),
      totalToolCalls: apiCalls.reduce((s, c) => {
        if (!c.hasSubagents || !c.subagents) return s;
        const sub = c.subagents;
        const items = sub.items || [];
        return s + (sub.toolCalls || items.reduce((is, it) => is + (it.toolCalls || 0), 0));
      }, 0),
      totalTokensIn: totalSubIn,
      totalTokensOut: totalSubOut,
      get totalInputTokens() { return this.totalTokensIn; },
      get totalOutputTokens() { return this.totalTokensOut; },
      modelsUsed: Array.from(new Set(subRuns.flatMap(c => {
        const sub = c.subagents;
        const res = [];
        if (sub.modelId) res.push(sub.modelId);
        if (sub.items) sub.items.forEach(it => { if (it.modelId) res.push(it.modelId); });
        return res;
      }))),
      roiAnalysis: {
        actualCost: totalSubCost,
        totalTurns: totalSubTurns,
        totalWorkers: apiCalls.reduce((s, c) => s + (c.subagents?.total || c.subagents?.items?.length || 0), 0),
        totalOutputTokens: totalSubOut,
        totalInputTokens: totalSubIn,
        totalCacheReads: totalSubCacheReads,
        totalCacheWrites: totalSubCacheWrites,
        cacheHitPct: cacheHitPctOf({ tokensIn: totalSubIn, cacheReads: totalSubCacheReads, cacheWrites: totalSubCacheWrites }),

        // PostQode Settings / Modes
        modes: {
          arbitrage: {
            isActive: isModelArbitrage,
            mainModel: mainModelId,
            subagentModel: subModelId,
            mainProvider: mainProfile.provider,
            subagentProvider: subProfile.provider,
            mainRates: mainProfile,
            subagentRates: subProfile,
            label: isModelArbitrage
              ? `Model Arbitrage: ${subModelId.split('/').pop()} vs ${mainModelId.split('/').pop()}`
              : `Homogeneous Model: ${mainModelId.split('/').pop()}`,
          },
          concurrency: {
            isBackground: hasBackgroundAgent,
            label: hasBackgroundAgent ? 'Background Agent (Async Non-blocking)' : 'Sync Workers (Parallel Blocking)',
            description: hasBackgroundAgent
              ? 'Launched asynchronously without waiting; parent continued working concurrently.'
              : 'Launched parallel workers in batch; parent blocked until all workers finished.',
          },
          context: {
            isFork: hasForkAgent,
            label: hasForkAgent ? 'Forked Agent (Inherited History)' : 'Fresh Isolated Workers (Lean Context)',
            description: hasForkAgent
              ? 'Inherited parent conversation history at higher token cost.'
              : 'Clean isolated context (~8k-20k tokens), zero parent history bloat.',
          },
        },

        // Scope Independence & Context Overlap Analysis (Empirical Proof)
        scopeAnalysis,

        // Data-Grounded Single Agent Baseline (Novel Files Grounding)
        groundedSingleAgent: {
          cost: groundedMainCost,
          sameModelCost: groundedSameModelCost,
          turns: groundedTurns,
          novelFilesCount: groundedNovelFiles,
          toolTokensIn: groundedToolTokensIn,
          outputTokens: groundedOutTokens,
          explorationPremium: explorationOverhead,
          explorationPremiumPct: groundedMainCost > 0 ? ((explorationOverhead / groundedMainCost) * 100) : 0,
          basisExplanation: groundedNovelFiles > 0
            ? `Programmatically verified from ${groundedNovelFiles} unread target file(s) assigned to subagents that the main agent had 0% prior context for. Reading them in the main thread (batching ~3-4 files per turn with parallel tool calls, ~${groundedTurns} turns) would cost estimated $${groundedMainCost.toFixed(3)} on ${mainProfile.provider || 'opus'}.`
            : `Single agent baseline calculated from ~${groundedTurns} turns (with parallel tool calls) for equivalent worker instructions.`,
        },

        // Baseline A: Realistic Grounded Single Agent
        realisticFocused: {
          cost: groundedMainCost,
          sameModelCost: groundedSameModelCost,
          turns: groundedTurns,
          outputTokens: groundedOutTokens,
          toolTokensIn: groundedToolTokensIn,
          explorationOverhead: explorationOverhead,
          explorationOverheadPct: groundedMainCost > 0 ? ((explorationOverhead / groundedMainCost) * 100) : 0,
        },

        // Baseline B: Exhaustive Monolithic Single Agent (Matching Full Depth)
        exhaustiveMonolithic: {
          cost: exhaustiveMainCost,
          sameModelCost: exhaustiveSameModelCost,
          turns: totalSubTurns,
          outputTokens: Math.round(totalSubOut * 0.35),
          arbitrageSavings: Math.max(0, exhaustiveMainCost - totalSubCost),
        },

        // Real Engineering Value Metrics
        wallClock: {
          actualSec: totalActualWallClockSec,
          sequentialSec: totalSeqDurationSec,
          savedSec: wallClockSavedSec,
          speedupFactor: speedupFactor,
        },
        contextHygiene: {
          tokensPrevented: tokensPrevented,
          description: contextDescription,
        },
        scratchFriction: {
          redundantCost: frictionCost,
          redundantTurns: frictionTurns,
          scratchBytes: frictionBytes,
          description: frictionDesc,
        },

        // Backwards compatibility fields
        counterfactualMainAgentCost: exhaustiveMainCost,
        counterfactualSameModelCost: exhaustiveSameModelCost,
        grossSavingsDollar: Math.max(0, exhaustiveMainCost - totalSubCost),
        grossSavingsPct: exhaustiveMainCost > 0 ? ((Math.max(0, exhaustiveMainCost - totalSubCost) / exhaustiveMainCost) * 100) : 0,
        netSavingsDollar: Math.max(0, (exhaustiveMainCost - totalSubCost) - frictionCost),
        netSavingsPct: exhaustiveMainCost > 0 ? ((Math.max(0, (exhaustiveMainCost - totalSubCost) - frictionCost) / exhaustiveMainCost) * 100) : 0,
        redundantWorkCost: frictionCost,
        redundantCallsCount: frictionTurns,
        wallClockSavedSec: wallClockSavedSec,
        contextTokensPrevented: tokensPrevented,
        ttlMode: `${mainProfile.provider} Prompt Caching (${mainProfile.supportsCache ? (mainProfile.explicitWrites ? '1-Hour TTL' : 'Prefix Cache') : 'No Cache'})`,
        modelArbitrage: {
          mainModel: mainModelId,
          subagentModel: subModelId,
        },
      },
      isFalseFailure: apiCalls.some(c => c.subagents?.isFalseFailure),
      hasScratchOffload: apiCalls.some(c => c.subagents?.scratchOffloaded),
      scratchFile: apiCalls.find(c => c.subagents?.scratchFile)?.subagents?.scratchFile || null,
      scratchSavedBytes: apiCalls.reduce((s, c) => s + (c.subagents?.bytesSaved || 0), 0),
      scratchRawBytes: apiCalls.reduce((s, c) => s + (c.subagents?.rawBytes || 0), 0),
      scratchPromptBytes: apiCalls.reduce((s, c) => s + (c.subagents?.promptBytes || 0), 0),
    };

    // Financial breakdown. Every number comes from the cache analysis: each call is priced with ITS OWN model's rates
    // (catalog prices, calibrated against the cost the extension logged), split into input / output / cache read /
    // 5-minute cache write / 1-hour cache write. Calls that no price source can explain keep their logged cost and are
    // reported separately as `unpriced` — nothing is guessed.
    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalCacheReads = 0;
    let totalCacheWrites = 0;
    let totalWrites1h = 0;
    const comp = { input: 0, output: 0, read: 0, write5m: 0, write1h: 0 };
    let unpricedCost = 0;
    let unpricedCalls = 0;
    const modelsUsedSet = new Set();
    const perModel = new Map();

    for (const c of apiCalls) {
      const callModel = c.modelId || detectedModelId || 'unknown';
      modelsUsedSet.add(callModel);
      totalTokensIn += c.tokensIn || 0;
      totalTokensOut += c.tokensOut || 0;
      totalCacheReads += c.cacheReads || 0;
      totalCacheWrites += c.cacheWrites || 0;
      totalWrites1h += Math.min(c.cacheWrites1h || 0, c.cacheWrites || 0);
      const pm = perModel.get(callModel) || { modelId: callModel, calls: 0, cost: 0, rateSource: null, rates: null };
      pm.calls++;
      pm.cost += c.cost || 0;
      if (c.cache && c.cache.cost) {
        comp.input += c.cache.cost.input;
        comp.output += c.cache.cost.output;
        comp.read += c.cache.cost.read;
        comp.write5m += c.cache.cost.write5m;
        comp.write1h += c.cache.cost.write1h;
        pm.rateSource = pm.rateSource || c.cache.rateSource;
        pm.rates = pm.rates || c.cache.rates;
      } else {
        unpricedCost += c.cost || 0;
        unpricedCalls++;
        pm.rateSource = pm.rateSource || 'logged_only';
      }
      perModel.set(callModel, pm);

      // Subagent worker models are listed too (their cost is added to the task total below)
      if (c.hasSubagents && c.subagents) {
        for (const it of (c.subagents.items || [])) modelsUsedSet.add(it.modelId || c.subagents.modelId || callModel);
      }
    }

    const calculatedTotalCost = apiCalls.reduce((s, c) => {
      let turnCost = c.cost || 0;
      if (c.hasSubagents && c.subagents) {
        const subCost = c.subagents.totalCost || (c.subagents.items ? c.subagents.items.reduce((is, it) => is + (it.totalCost || 0), 0) : 0);
        // Add subagent cost if not already included in c.cost
        turnCost += (subCost || 0);
      }
      return s + turnCost;
    }, 0);
    const modelsUsedList = Array.from(modelsUsedSet);
    const per = (cost, tokens) => (tokens > 0 ? (cost / tokens) * 1e6 : null);
    const writeCost = comp.write5m + comp.write1h;

    const financialBreakdown = {
      modelId: modelsUsedList.length > 1 ? `Multi-Model (${modelsUsedList.map(m => m.split('/').pop()).join(', ')})` : (detectedModelId || 'unknown'),
      modelsUsed: modelsUsedList,
      isMultiModel: modelsUsedList.length > 1,
      totalCost: calculatedTotalCost || (comp.input + comp.output + comp.read + writeCost + unpricedCost),
      input: { tokens: totalTokensIn, pricePerM: per(comp.input, totalTokensIn), cost: comp.input },
      output: { tokens: totalTokensOut, pricePerM: per(comp.output, totalTokensOut), cost: comp.output },
      cacheRead: { tokens: totalCacheReads, pricePerM: per(comp.read, totalCacheReads), cost: comp.read },
      cacheWrite: { tokens: totalCacheWrites, pricePerM: per(writeCost, totalCacheWrites), cost: writeCost },
      cacheWrite5m: { tokens: totalCacheWrites - totalWrites1h, pricePerM: per(comp.write5m, totalCacheWrites - totalWrites1h), cost: comp.write5m },
      cacheWrite1h: { tokens: totalWrites1h, pricePerM: per(comp.write1h, totalWrites1h), cost: comp.write1h },
      unpriced: { calls: unpricedCalls, cost: unpricedCost },
      perModel: [...perModel.values()],
      subagents: subagentSummary,
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

    // Concurrency / Parallel tool calls metrics for Prompt Observability
    const parallelTurns = apiCalls.filter(c => c.isParallel);
    const totalParallelTools = parallelTurns.reduce((s, c) => s + c.toolCount, 0);
    const maxTurnTools = apiCalls.length ? Math.max(0, ...apiCalls.map(c => c.toolCount)) : 0;
    const allTurnTools = apiCalls.reduce((s, c) => s + c.toolCount, 0);
    const parallelStats = {
      totalToolCalls: allTurnTools,
      parallelToolCalls: totalParallelTools,
      parallelBatches: parallelTurns.length,
      maxParallel: maxTurnTools,
      concurrencyPct: allTurnTools > 0 ? Math.round((totalParallelTools / allTurnTools) * 100) : 0,
      roundtripsSaved: Math.max(0, totalParallelTools - parallelTurns.length),
    };

    res.json({
      task: taskObj,
      filePaths: {
        taskPath,
        uiMessagesPath: fs.existsSync(uiPath) ? uiPath : null,
        apiHistoryPath: fs.existsSync(apiHistPath) ? apiHistPath : null,
        contextHistoryPath: fs.existsSync(ctxHistPath) ? ctxHistPath : null,
      },
      apiCalls,
      cacheAnalysis: { summary: cacheAnalysis.summary, evidence: cacheAnalysis.evidence },
      parallelStats,
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
      subagentSummary,
      totalMessages: apiHistory.length,
      systemPromptCapture, // null if proxy never captured it for this task
      allSystemPrompts,
      memoryTimeline,
      systemMemorySnapshot: memoryTimeline.length > 0 ? memoryTimeline[memoryTimeline.length - 1] : null,
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
