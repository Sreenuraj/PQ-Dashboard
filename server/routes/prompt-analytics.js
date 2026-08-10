/**
 * Prompt Analytics API Routes
 * Reads raw task files (ui_messages.json, api_conversation_history.json, context_history.json)
 * and reconstructs the EXACT sent prompt payloads at each turn by applying Layer 2 context overlays.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function resolvePath(p) {
  return p.replace(/^~/, os.homedir());
}

/**
 * Reconstructs effective prompt messages at timestamp `ts` up to `maxMsgIdx`
 * by applying Layer 2 context overlays from context_history.json to raw api_conversation_history.json.
 */
function getEffectiveMessagesAtTs(rawHistory, contextUpdates, ts, maxMsgIdx) {
  if (maxMsgIdx < 0 || !rawHistory || rawHistory.length === 0) return [];
  
  const limit = Math.min(maxMsgIdx + 1, rawHistory.length);
  // Deep clone slice of history
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

      // Filter updates up to timestamp ts
      const validUpdates = updatesList.filter(u => Array.isArray(u) && u[0] <= ts);
      if (validUpdates.length === 0) continue;

      // Pick latest update <= ts
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

function extractTextContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(b => (typeof b === 'string' ? b : (b.text || b.thinking || ''))).join('\n---\n');
  }
  return JSON.stringify(content || '');
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

module.exports = (db, config) => {
  const router = express.Router();

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

    const apiCalls = [];
    let prevRequestSize = 0;

    for (let i = 0; i < uiMessages.length; i++) {
      const msg = uiMessages[i];
      if (msg.say !== 'api_req_started' || !msg.text) continue;

      let data;
      try { data = JSON.parse(msg.text); } catch { continue; }

      const histIdx = msg.conversationHistoryIndex != null ? msg.conversationHistoryIndex : -1;

      let requestSize = 0;
      let messageCount = 0;

      if (histIdx >= 0 && apiHistory.length > 0) {
        const effectiveMsgs = getEffectiveMessagesAtTs(apiHistory, contextUpdates, msg.ts, histIdx);
        for (const m of effectiveMsgs) {
          requestSize += JSON.stringify(m?.content || '').length;
        }
        messageCount = effectiveMsgs.length;
      }

      const sizeDelta = apiCalls.length === 0 ? 0 : (requestSize - prevRequestSize);

      apiCalls.push({
        index: apiCalls.length,
        ts: msg.ts,
        tokensIn: data.tokensIn || 0,
        tokensOut: data.tokensOut || 0,
        cacheReads: data.cacheReads || 0,
        cacheWrites: data.cacheWrites || 0,
        cost: data.cost || 0,
        historyIndex: histIdx,
        messageCount,
        requestSize,
        sizeDelta,
        trimmedFromPrevBytes: 0,
        hasPruning: false,
        requestText: data.request || null,
        modelId: msg.modelInfo?.modelId || null,
        providerId: msg.modelInfo?.providerId || null,
      });

      if (requestSize > 0) prevRequestSize = requestSize;
    }

    // Chronological Reduction Timeline & Category Tracking across adjacent turns
    const reductionEvents = [];
    const filePruningMap = {};
    const cmdPruningMap = {};
    let envPruningCount = 0;
    let envPruningBytes = 0;

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

          let category = 'Other Content';
          let targetName = 'Context Text';

          const fileMatch = contentPrevStr.match(/read_file for '([^']+)'/);
          if (fileMatch) {
            category = 'File Read Truncated';
            targetName = fileMatch[1];
            if (!filePruningMap[targetName]) filePruningMap[targetName] = { count: 0, bytesSaved: 0 };
            filePruningMap[targetName].count++;
            filePruningMap[targetName].bytesSaved += bytesSaved;
          } else if (contentPrevStr.includes('execute_command for') || contentCurrStr.includes('Tool output truncated')) {
            category = 'Terminal Output Truncated';
            const cmdMatch = contentPrevStr.match(/execute_command for '([^']+)'/);
            targetName = cmdMatch ? cmdMatch[1] : 'Terminal Command Output';
            if (!cmdPruningMap[targetName]) cmdPruningMap[targetName] = { count: 0, bytesSaved: 0 };
            cmdPruningMap[targetName].count++;
            cmdPruningMap[targetName].bytesSaved += bytesSaved;
          } else if (contentPrevStr.includes('<environment_details>') && contentCurrStr.includes('stale workspace/environment snapshot')) {
            category = 'Stale Environment Snapshot Removed';
            targetName = '<environment_details>';
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

    const taskMeta = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);

    // Format Executive Category Summaries
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

    res.json({
      task: taskMeta ? {
        id: taskMeta.id,
        source: taskMeta.source,
        startTs: taskMeta.start_ts,
        endTs: taskMeta.end_ts,
        duration: taskMeta.duration,
        totalCost: taskMeta.total_cost,
        totalTokensIn: taskMeta.total_tokens_in,
        totalTokensOut: taskMeta.total_tokens_out,
        totalCacheReads: taskMeta.total_cache_reads,
        totalCacheWrites: taskMeta.total_cache_writes,
        apiCallCount: taskMeta.api_call_count,
        firstMessage: taskMeta.first_message,
        status: taskMeta.status,
      } : null,
      filePaths: {
        taskPath,
        uiMessagesPath: fs.existsSync(uiPath) ? uiPath : null,
        apiHistoryPath: fs.existsSync(apiHistPath) ? apiHistPath : null,
        contextHistoryPath: fs.existsSync(ctxHistPath) ? ctxHistPath : null,
      },
      apiCalls,
      reductionCategories: {
        truncatedFiles: fileCategorySummary,
        truncatedCommands: cmdCategorySummary,
        environmentSnapshots: { count: envPruningCount, bytesSaved: envPruningBytes },
      },
      reductionEvents,
      totalMessages: apiHistory.length,
    });
  });

  /**
   * GET /api/prompt-analytics/:taskId/compare?call1=5&call2=10
   */
  router.get('/prompt-analytics/:taskId/compare', (req, res) => {
    const taskId = req.params.taskId;
    const call1 = parseInt(req.query.call1 || '0');
    const call2 = parseInt(req.query.call2 || '1');
    const taskPath = resolveTaskPath(taskId);

    if (!taskPath) {
      return res.status(404).json({ error: 'Task not found' });
    }

    const uiPath = path.join(taskPath, 'ui_messages.json');
    const apiHistPath = path.join(taskPath, 'api_conversation_history.json');
    const ctxHistPath = path.join(taskPath, 'context_history.json');

    let uiMessages = [];
    let apiHistory = [];
    let contextUpdates = [];

    try {
      if (fs.existsSync(uiPath)) uiMessages = JSON.parse(fs.readFileSync(uiPath, 'utf8'));
      if (fs.existsSync(apiHistPath)) apiHistory = JSON.parse(fs.readFileSync(apiHistPath, 'utf8'));
      if (fs.existsSync(ctxHistPath)) {
        const ctxRaw = JSON.parse(fs.readFileSync(ctxHistPath, 'utf8'));
        contextUpdates = Array.isArray(ctxRaw) ? ctxRaw : (ctxRaw.updates || []);
      }
    } catch (e) {
      return res.status(500).json({ error: 'Failed to parse task files' });
    }

    const apiCallEntries = [];
    for (const msg of uiMessages) {
      if (msg.say !== 'api_req_started' || !msg.text) continue;
      try {
        const data = JSON.parse(msg.text);
        apiCallEntries.push({
          historyIndex: msg.conversationHistoryIndex != null ? msg.conversationHistoryIndex : -1,
          ts: msg.ts,
          tokensIn: data.tokensIn || 0,
          tokensOut: data.tokensOut || 0,
          cacheReads: data.cacheReads || 0,
          cacheWrites: data.cacheWrites || 0,
          cost: data.cost || 0,
        });
      } catch {
        continue;
      }
    }

    if (call1 < 0 || call1 >= apiCallEntries.length || call2 < 0 || call2 >= apiCallEntries.length) {
      return res.status(400).json({ error: 'Invalid call indices' });
    }

    const entry1 = apiCallEntries[call1];
    const entry2 = apiCallEntries[call2];

    const messages1 = getEffectiveMessagesAtTs(apiHistory, contextUpdates, entry1.ts, entry1.historyIndex);
    const messages2 = getEffectiveMessagesAtTs(apiHistory, contextUpdates, entry2.ts, entry1.historyIndex);

    function summarizeMessage(msg, idx) {
      const content = msg.content;
      const size = JSON.stringify(content || '').length;
      const fullText = extractTextContent(content);
      const preview = fullText.substring(0, 450);

      return { index: idx, role: msg.role, size, preview, fullText };
    }

    const commonMsgCount = Math.min(messages1.length, messages2.length);
    let commonSizeCall1 = 0;
    let commonSizeCall2 = 0;

    for (let i = 0; i < commonMsgCount; i++) {
      commonSizeCall1 += JSON.stringify(messages1[i]?.content || '').length;
      commonSizeCall2 += JSON.stringify(messages2[i]?.content || '').length;
    }

    const prunedFromCall1 = commonSizeCall1 - commonSizeCall2;

    const trimmedItems = [];
    const addedItems = [];

    for (let i = 0; i < commonMsgCount; i++) {
      const sum1 = summarizeMessage(messages1[i], i);
      const sum2 = summarizeMessage(messages2[i], i);
      const diffChunks = computeExactDiffChunks(sum1.fullText, sum2.fullText);
      const saved = sum1.size - sum2.size;

      if (saved > 10) {
        trimmedItems.push({
          index: i,
          role: messages1[i].role,
          before: sum1,
          after: sum2,
          diffChunks,
          bytesSaved: saved,
        });
      }
    }

    const req1Size = messages1.reduce((s, m) => s + JSON.stringify(m.content || '').length, 0);
    const req2Size = messages2.reduce((s, m) => s + JSON.stringify(m.content || '').length, 0);

    res.json({
      call1: { index: call1, ...entry1, messageCount: messages1.length, requestSize: req1Size },
      call2: { index: call2, ...entry2, messageCount: messages2.length, requestSize: req2Size },
      pruningSummary: {
        req1ContentBeforePruning: commonSizeCall1,
        req1ContentAfterPruning: commonSizeCall2,
        bytesSaved: prunedFromCall1,
        percentSaved: commonSizeCall1 > 0 ? ((prunedFromCall1 / commonSizeCall1) * 100).toFixed(1) : '0.0',
      },
      trimmedItems,
      addedItems: [],
    });
  });

  return router;
};
