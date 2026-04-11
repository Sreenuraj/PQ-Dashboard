const fs = require('fs');

// Model registry will be injected via setModelRegistry()
let getModelInfoFn = null;

function setModelRegistry(fn) {
  getModelInfoFn = fn;
}

/**
 * Parses ui_messages.json — the richest data source.
 * Also reads api_conversation_history.json to attach pure model responses.
 * Returns structured event list + task summary.
 */
function parseUIMessages(filePath, apiHistoryPath, maxFileSize) {
  if (!filePath || !fs.existsSync(filePath)) return { events: [], summary: {} };

  const stat = fs.statSync(filePath);
  if (stat.size > maxFileSize) {
    console.warn(`[ui-messages] Skipping large file (${(stat.size / 1024 / 1024).toFixed(1)}MB): ${filePath}`);
    return { events: [], summary: { skipped: true, reason: 'file_too_large' } };
  }

  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (e) {
    return { events: [], summary: { skipped: true, reason: 'read_error' } };
  }

  let messages;
  try {
    messages = JSON.parse(raw);
  } catch (e) {
    return { events: [], summary: { skipped: true, reason: 'parse_error' } };
  }

  if (!Array.isArray(messages)) return { events: [], summary: {} };

  // Load api_conversation_history to extract LLM responses
  let assistantResponses = [];
  if (apiHistoryPath && fs.existsSync(apiHistoryPath)) {
    try {
      const apiRaw = fs.readFileSync(apiHistoryPath, 'utf8');
      const apiMessages = JSON.parse(apiRaw);
      if (Array.isArray(apiMessages)) {
        assistantResponses = apiMessages.filter(m => m.role === 'assistant');
      }
    } catch (e) {
      console.warn(`[ui-messages] Failed to parse api history: ${e.message}`);
    }
  }

  const events = [];
  let totalCost = 0;
  let totalTokensIn = 0;
  let totalTokensOut = 0;
  let totalCacheReads = 0;
  let totalCacheWrites = 0;
  let errorCount = 0;
  let toolCallCount = 0;
  let apiCallCount = 0;
  let firstMessage = null;
  let lastTs = 0;
  let firstTs = null;
  let prevModelId = null;
  const modelsUsed = new Set();

  for (const msg of messages) {
    if (!msg.ts) continue;
    if (firstTs === null) firstTs = msg.ts;
    if (msg.ts > lastTs) lastTs = msg.ts;

    const modelId = msg.modelInfo?.modelId || null;
    const providerId = msg.modelInfo?.providerId || null;
    const mode = msg.modelInfo?.mode || null;

    if (modelId) modelsUsed.add(`${providerId}::${modelId}::${mode}`);

    const event = {
      ts: msg.ts,
      type: msg.type,
      sub_type: msg.say || msg.ask,
      model_id: modelId,
      provider_id: providerId,
      mode: mode,
      tool_name: null,
      command_text: null,
      error_message: null,
      error_category: null,
      cost: null,
      tokens_in: null,
      tokens_out: null,
      cache_reads: null,
      cache_writes: null,
      reasoning_text: null,
      content_preview: null,
      model_switched: false,
      request_text: null,
      retry_count: 0,
      context_pct: null,
    };

    // Detect model switch
    if (modelId && prevModelId && modelId !== prevModelId) {
      event.model_switched = true;
    }
    if (modelId) prevModelId = modelId;

    const subType = event.sub_type;

    // ── text / user message ──
    if (subType === 'text' && msg.text) {
      if (!firstMessage && msg.type === 'say') {
        firstMessage = msg.text.substring(0, 300);
      }
      event.content_preview = msg.text.substring(0, 200);
    }

    // ── reasoning ──
    if (subType === 'reasoning' && msg.text) {
      event.reasoning_text = msg.text;
      event.content_preview = msg.text.substring(0, 200);
    }

    // ── api_req_started — parse embedded JSON ──
    if (subType === 'api_req_started' && msg.text) {
      apiCallCount++;
      const parsed = extractApiReqData(msg.text);
      if (parsed) {
        event.cost = parsed.cost;
        event.tokens_in = parsed.tokensIn;
        event.tokens_out = parsed.tokensOut;
        event.cache_reads = parsed.cacheReads;
        event.cache_writes = parsed.cacheWrites;
        event.request_text = parsed.requestText;

        totalCost += parsed.cost || 0;
        totalTokensIn += parsed.tokensIn || 0;
        totalTokensOut += parsed.tokensOut || 0;
        totalCacheReads += parsed.cacheReads || 0;
        totalCacheWrites += parsed.cacheWrites || 0;

        // Compute context window percentage
        if (modelId && parsed.tokensIn > 0 && getModelInfoFn) {
          const modelInfo = getModelInfoFn(modelId);
          if (modelInfo && modelInfo.contextWindow) {
            event.context_pct = Math.round((parsed.tokensIn / modelInfo.contextWindow) * 100);
          }
        }

        // Map to corresponding assistant response (they correspond 1:1 with API requests that didn't fail at provider)
        if (assistantResponses.length > apiCallCount - 1) {
          const assistantReply = assistantResponses[apiCallCount - 1];
          if (assistantReply && assistantReply.content) {
            // content can be string or array of blocks
            const content = assistantReply.content;
            event.response_text = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
          }
        }

        // Zero-cost = API failure (no assistant response would be generated for this)
        if (parsed.cost === 0 && parsed.tokensIn === 0) {
          event.error_category = 'api_failure';
          errorCount++;
          event.response_text = null; // Enforce null if it strictly failed at provider layer
        }
      }
    }

    // ── error ──
    if (subType === 'error' && msg.text) {
      errorCount++;
      event.error_message = msg.text;
      event.error_category = classifyError(msg.text);
      event.content_preview = msg.text.substring(0, 200);
    }

    // ── tool (say.tool or ask.tool) ──
    if (subType === 'tool' && msg.text) {
      toolCallCount++;
      const toolData = extractToolData(msg.text);
      event.tool_name = toolData.tool;
      event.content_preview = toolData.preview;
    }

    // ── ask.tool ──
    if (msg.type === 'ask' && subType === 'tool' && msg.text) {
      toolCallCount++;
      const toolData = extractToolData(msg.text);
      event.tool_name = toolData.tool;
      event.content_preview = toolData.preview;
    }

    // ── command ──
    if (subType === 'command' && msg.text) {
      event.command_text = msg.text.substring(0, 200);
      event.content_preview = msg.text.substring(0, 200);
    }

    // ── compliance error: [ERROR] in text ──
    if (msg.text && msg.text.includes('[ERROR]') && subType === 'text') {
      errorCount++;
      event.error_category = 'compliance_error';
      event.error_message = msg.text.substring(0, 200);
    }

    // ── interruption: task resumption ──
    if (subType === 'resume_task') {
      event.error_category = 'interruption';
    }

    events.push(event);
  }

  // ── Post-processing: Retry detection ──
  // Walk events in order. When we see an error, look back at the preceding api_req_started.
  // Multiple consecutive errors before the next api call = multiple retries.
  computeRetryCounts(events);

  const summary = {
    first_ts: firstTs,
    last_ts: lastTs,
    duration: lastTs && firstTs ? lastTs - firstTs : 0,
    total_cost: totalCost,
    total_tokens_in: totalTokensIn,
    total_tokens_out: totalTokensOut,
    total_cache_reads: totalCacheReads,
    total_cache_writes: totalCacheWrites,
    error_count: errorCount,
    tool_call_count: toolCallCount,
    api_call_count: apiCallCount,
    first_message: firstMessage,
    models_used: [...modelsUsed],
    has_reasoning: events.some(e => e.sub_type === 'reasoning'),
    event_count: events.length,
  };

  return { events, summary };
}

/**
 * Compute retry counts on error events.
 * Walk events in order. When we find consecutive error events
 * (without an intervening api_req_started), mark each subsequent
 * error with incrementing retry_count.
 */
function computeRetryCounts(events) {
  let consecutiveErrors = 0;

  for (let i = 0; i < events.length; i++) {
    const e = events[i];

    if (e.sub_type === 'error' || (e.error_category && e.error_category !== 'interruption')) {
      consecutiveErrors++;
      if (consecutiveErrors > 1) {
        // This is a retry — the previous error was the original
        e.retry_count = consecutiveErrors - 1;
      }
    } else if (e.sub_type === 'api_req_started') {
      // If we had consecutive errors before this api call, this is the retry attempt
      if (consecutiveErrors > 0) {
        e.retry_count = consecutiveErrors;
      }
      consecutiveErrors = 0;
    } else {
      // Non-error, non-api event doesn't reset counter
    }
  }
}

function extractApiReqData(text) {
  // The text field is a JSON string containing {request, tokensIn, tokensOut, cacheWrites, cacheReads, cost}
  // It starts with {"request":"..." so we find the outer JSON
  try {
    const obj = JSON.parse(text);
    return {
      tokensIn: obj.tokensIn || 0,
      tokensOut: obj.tokensOut || 0,
      cacheReads: obj.cacheReads || 0,
      cacheWrites: obj.cacheWrites || 0,
      cost: obj.cost || 0,
      // Extract request text, truncated to 2000 chars
      requestText: obj.request ? String(obj.request).substring(0, 2000) : null,
    };
  } catch {
    return null;
  }
}

function extractToolData(text) {
  try {
    const obj = JSON.parse(text);
    return {
      tool: obj.tool || obj.server_name || 'unknown',
      preview: `${obj.tool || ''} → ${obj.path || obj.command || ''}`.substring(0, 200),
    };
  } catch {
    return { tool: 'unknown', preview: text.substring(0, 200) };
  }
}

function classifyError(msg) {
  if (!msg) return 'unknown_error';
  const m = msg.toLowerCase();
  if (m.includes('rate limit') || m.includes('429')) return 'rate_limit_error';
  if (m.includes('timeout') || m.includes('408')) return 'timeout_error';
  if (m.includes('503') || m.includes('service unavailable') || m.includes('model busy')) return 'availability_error';
  if (m.includes('502') || m.includes('bad gateway')) return 'provider_error';
  if (m.includes('401') || m.includes('unauthorized') || m.includes('api key')) return 'auth_error';
  if (m.includes('402') || m.includes('credit') || m.includes('billing')) return 'billing_error';
  if (m.includes('403') || m.includes('moderation') || m.includes('flagged')) return 'moderation_error';
  if (m.includes('400') || m.includes('context') || m.includes('too long')) return 'prompt_error';
  if (m.includes('did not use a tool') || m.includes('[error]')) return 'compliance_error';
  return 'tool_error';
}

module.exports = { parseUIMessages, setModelRegistry };
