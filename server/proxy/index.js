/**
 * Network Inspector — MITM Proxy Server
 * Captures HTTP/HTTPS traffic flowing through it and stores + streams records.
 */

// Patch net.connect globally to redirect 0.0.0.0 destination to 127.0.0.1.
// http-mitm-proxy uses net.connect({ host: '0.0.0.0', port }) to connect to dynamic
// local servers. On macOS, this fails with ECONNREFUSED when the server binds to localhost (::1).
// Resolving 0.0.0.0 to 127.0.0.1 fixes the connection when bound to 127.0.0.1.
const net = require('net');
const originalConnect = net.connect;
net.connect = function (options, connectionListener) {
  const opts = typeof options === 'object' ? { ...options } : { port: options };
  if (opts.host === '0.0.0.0') {
    opts.host = '127.0.0.1';
  }
  return originalConnect.call(this, opts, connectionListener);
};

const { Proxy } = require('http-mitm-proxy');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const { NetworkStore } = require('./store');
const { broadcast, broadcastMessage } = require('./ws');
const { randomUUID } = require('crypto');
const { Readable } = require('stream');

// Known AI API domain tags
const DOMAIN_TAGS = {
  'api.postqode.ai': 'postqode',
  'api.openai.com': 'openai',
  'api.anthropic.com': 'anthropic',
  'generativelanguage.googleapis.com': 'google',
  'aiplatform.googleapis.com': 'google',
  'api.google.com': 'google',
  'api.cohere.com': 'cohere',
  'api.mistral.ai': 'mistral',
  'api.groq.com': 'groq',
  'api.deepseek.com': 'deepseek',
  'api.together.xyz': 'together',
  'api.fireworks.ai': 'fireworks',
  'api.github.com': 'github',
  'copilot-proxy.githubusercontent.com': 'copilot',
};

function tagForHost(host) {
  if (!host) return 'other';
  const h = host.replace(/:\d+$/, '').toLowerCase();
  if (DOMAIN_TAGS[h]) return DOMAIN_TAGS[h];
  // Check partial matches
  for (const [domain, tag] of Object.entries(DOMAIN_TAGS)) {
    if (h.endsWith(domain)) return tag;
  }
  return 'other';
}

function decodeBody(buffer, headers) {
  if (!buffer || buffer.length === 0) return '';
  
  let contentEncoding = '';
  if (headers) {
    for (const key of Object.keys(headers)) {
      if (key.toLowerCase() === 'content-encoding') {
        contentEncoding = String(headers[key] || '').toLowerCase().trim();
        break;
      }
    }
  }

  let decompressed = buffer;
  try {
    if (contentEncoding === 'gzip') {
      decompressed = zlib.gunzipSync(buffer);
    } else if (contentEncoding === 'deflate') {
      decompressed = zlib.inflateSync(buffer);
    } else if (contentEncoding === 'br') {
      decompressed = zlib.brotliDecompressSync(buffer);
    }
  } catch (err) {
    // Fall back to original buffer
  }

  const maxBodySize = 50 * 1024 * 1024; // 50MB — retain full LLM prompt & completion payloads
  try {
    return decompressed.length > maxBodySize
      ? decompressed.slice(0, maxBodySize).toString('utf-8') + '\n... [payload capped at 50MB]'
      : decompressed.toString('utf-8');
  } catch (e) {
    return '[binary data]';
  }
}

const mocksPath = path.resolve('./data/network-mocks.json');
let mockRules = [];
let defaultMockHandler = null;
let dynamicMockHandler = null;
let activeLiveRecorder = null;

function startLiveRecording(scenarioId, options = {}) {
  const targetDir = options.targetDir || path.resolve('./server/postqode-test/fixtures/live-recordings', scenarioId);
  try { fs.mkdirSync(targetDir, { recursive: true }); } catch (e) {}
  activeLiveRecorder = {
    scenarioId,
    targetDir,
    streams: [],
    startTime: Date.now(),
  };
  return activeLiveRecorder;
}

function stopLiveRecording() {
  const rec = activeLiveRecorder;
  activeLiveRecorder = null;
  return rec;
}

function getActiveLiveRecorder() {
  return activeLiveRecorder;
}

function setDefaultMockHandler(handler) {
  defaultMockHandler = handler;
}

function clearDefaultMockHandler() {
  defaultMockHandler = null;
}

function setDynamicMockHandler(handler) {
  dynamicMockHandler = handler;
}

function clearDynamicMockHandler() {
  dynamicMockHandler = null;
}

function getDynamicMockHandler() {
  return dynamicMockHandler || defaultMockHandler;
}

function loadMockRules() {
  try {
    if (fs.existsSync(mocksPath)) {
      mockRules = JSON.parse(fs.readFileSync(mocksPath, 'utf8'));
    } else {
      mockRules = [];
    }
  } catch (e) {
    mockRules = [];
  }
}

function saveMockRules() {
  try {
    fs.mkdirSync(path.dirname(mocksPath), { recursive: true });
    fs.writeFileSync(mocksPath, JSON.stringify(mockRules, null, 2), 'utf8');
  } catch (e) {
    console.error('[Proxy Mocks] Failed to save rules:', e.message);
  }
}

function getMockRules() {
  return mockRules;
}

function addMockRule(rule) {
  const existingIdx = mockRules.findIndex(r => r.id === rule.id);
  if (existingIdx !== -1) {
    mockRules[existingIdx] = rule;
  } else {
    mockRules.push(rule);
  }
  saveMockRules();
  return rule;
}

function deleteMockRule(id) {
  mockRules = mockRules.filter(r => r.id !== id);
  saveMockRules();
  return true;
}

// ── Intercept / Breakpoint System ──
let interceptEnabled = false;
let interceptFilters = [];   // URL pattern substrings; empty = intercept all
const INTERCEPT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

// Map<interceptId, { resolve, ctx, requestData, timestamp, timer }>
const pendingIntercepts = new Map();

function getInterceptState() {
  const pending = [];
  for (const [id, entry] of pendingIntercepts) {
    pending.push({ id, ...entry.requestData, elapsed: Date.now() - entry.timestamp });
  }
  return {
    enabled: interceptEnabled,
    filters: interceptFilters,
    pendingCount: pendingIntercepts.size,
    pending,
  };
}

function setInterceptState(enabled, filters) {
  interceptEnabled = !!enabled;
  if (Array.isArray(filters)) {
    interceptFilters = filters.filter(f => typeof f === 'string' && f.trim().length > 0);
  }
  if (!interceptEnabled) {
    forwardAllPending();
  }
  broadcastMessage({ type: 'intercept_state_changed', data: { enabled: interceptEnabled, filters: interceptFilters } });
  return { enabled: interceptEnabled, filters: interceptFilters };
}

function matchesInterceptFilters(url) {
  if (interceptFilters.length === 0) return true; // no filters = intercept everything
  const lower = url.toLowerCase();
  return interceptFilters.some(f => lower.includes(f.toLowerCase()));
}

function resolveInterceptedRequest(id, action, modifiedData) {
  const entry = pendingIntercepts.get(id);
  if (!entry) return false;
  clearTimeout(entry.timer);
  pendingIntercepts.delete(id);
  entry.resolve({ action, modifiedData: modifiedData || null });
  broadcastMessage({ type: 'intercept_resolved', data: { id, action } });
  return true;
}

function forwardAllPending() {
  let count = 0;
  for (const [id, entry] of pendingIntercepts) {
    clearTimeout(entry.timer);
    entry.resolve({ action: 'forward', modifiedData: null });
    count++;
  }
  pendingIntercepts.clear();
  if (count > 0) {
    broadcastMessage({ type: 'intercept_resolved', data: { id: '*', action: 'forward_all', count } });
  }
  return count;
}

function getPendingRequests() {
  const result = [];
  for (const [id, entry] of pendingIntercepts) {
    result.push({ id, ...entry.requestData, elapsed: Date.now() - entry.timestamp });
  }
  return result;
}

let store = null;
let proxyServer = null;
let isRunning = false;
let proxyPort = 3457;
let certsDir = '';
let proxyDb = null; // injected from server/index.js if available

const CHAT_API_RE = /\/chat\/completions|\/v1\/messages/i;
const SYSTEM_PROMPT_DRIFT_MS = 2 * 60 * 1000; // 2-minute task correlation window

/**
 * Extracts the system prompt text from a parsed chat/completions request body.
 * Handles Anthropic (top-level `system`) and OpenAI (messages[0].role==='system') formats.
 */
function extractSystemTextFromParsed(parsed) {
  if (!parsed) return null;

  // Anthropic format: { system: string | [{type:'text',text:'...'}] }
  if (typeof parsed.system === 'string' && parsed.system.length > 0) return parsed.system;
  if (Array.isArray(parsed.system)) {
    const t = parsed.system.map(b => b.text || '').join('\n').trim();
    if (t) return t;
  }

  // OpenAI format: messages[0].role === 'system'
  if (Array.isArray(parsed.messages) && parsed.messages[0]?.role === 'system') {
    const c = parsed.messages[0].content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map(b => b.text || '').join('\n').trim();
  }

  return null;
}

/**
 * Extracts the start of the system prompt from full or truncated request bodies.
 */
function extractSystemPromptStart(bodyStr) {
  if (!bodyStr || typeof bodyStr !== 'string') return null;
  try {
    const parsed = JSON.parse(bodyStr);
    const sys = extractSystemTextFromParsed(parsed);
    if (sys) return sys;
  } catch (e) {
    const m = bodyStr.match(/"role"\s*:\s*"system"[\s\S]*?"content"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)"|\[\s*\{\s*"(?:type"\s*:\s*"text"\s*,\s*"text|"text)"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)")/i);
    if (m) {
      const raw = m[1] || m[2];
      try { return JSON.parse('"' + raw + '"'); } catch { return raw; }
    }
    const mSys = bodyStr.match(/"system"\s*:\s*(?:"([^"\\]*(?:\\.[^"\\]*)*)")/i);
    if (mSys) {
      try { return JSON.parse('"' + mSys[1] + '"'); } catch { return mSys[1]; }
    }
    const mYouAre = bodyStr.match(/"(You are [^"\r\n\\]+)/i);
    if (mYouAre) {
      return mYouAre[1];
    }
  }
  return null;
}

/**
 * Extracts agent categorization or label from the system prompt.
 * e.g. "You are PostQode, ..." -> "PostQode"
 *      "You are PostQode Subagent, ..." -> "PostQode Subagent"
 */
function extractAgentLabel(systemText) {
  if (!systemText || typeof systemText !== 'string') return null;

  let cleanText = systemText.trim();
  const identityMatch = cleanText.match(/<identity>([\s\S]*?)<\/identity>/i);
  if (identityMatch) {
    cleanText = identityMatch[1].trim();
  }

  const lines = cleanText.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return null;
  const firstLine = lines[0].replace(/^[#*_\s-]+/, '').replace(/[*_]+$/, '').trim();

  // 1. PostQode Subagent check (MUST be on the first line / identity)
  if (/^you are (?:the )?postqode subagent\b/i.test(firstLine) || /^postqode subagent\b/i.test(firstLine)) {
    return 'PostQode Subagent';
  }

  // 2. Generic Subagent declared on the first line
  if (/^you are (?:an? )?(?:autonomous )?(?:specialized )?([a-z0-9_-]+\s+subagent|subagent)\b/i.test(firstLine)) {
    const m = firstLine.match(/^you are (?:an? )?(?:autonomous )?(?:specialized )?([a-z0-9_-]+\s+subagent|subagent)\b/i);
    return m ? m[1].replace(/\b\w/g, c => c.toUpperCase()) : 'Subagent';
  }

  // 3. PostQode Main Agent check (MUST be at the start of the first line)
  if (/^you are postqode\b/i.test(firstLine) || /^postqode\b/i.test(firstLine)) {
    return 'PostQode';
  }

  // 4. Explicit Role/Agent/Identity keywords on line 1
  const roleMatch = firstLine.match(/^(?:role|agent|identity|system|persona|name):\s*([^,.\n]+)/i);
  if (roleMatch) {
    return roleMatch[1].trim();
  }

  // 5. 'You are [Name], a/an...' on line 1
  const youAreMatch = firstLine.match(/^you are (?:an? )?([^,.]+)/i);
  if (youAreMatch) {
    const raw = youAreMatch[1].trim();
    if (/^helpful (?:ai )?assistant/i.test(raw)) return 'Assistant';
    if (/^autonomous specialized ai worker/i.test(raw)) return 'Subagent';
    if (raw && !/^(?:ai|model|llm|large language model)\b/i.test(raw) && raw.length < 35) {
      return raw.replace(/\b\w/g, c => c.toUpperCase());
    }
  }

  return null;
}

// ── Dynamic Subagent Tracker & Registry ──────────────────────────────────
// Keeps track of parent tool calls (like use_subagents) and assigns stable
// dynamic numbers ("Subagent 1", "Subagent 2", etc.) to worker subagents.
const subagentPromptsRegistry = []; // { index: number, snippet: string, fullPrompt: string }
const dynamicSubagentMap = new Map(); // promptKey -> index
let nextDynamicSubagentIndex = 1;

function registerParentSubagentPrompts(responseBody) {
  if (!responseBody || typeof responseBody !== 'string') return;
  let fullArgs = '';
  if (responseBody.includes('data: ')) {
    const lines = responseBody.split('\n');
    for (const line of lines) {
      if (line.startsWith('data: ') && !line.includes('[DONE]')) {
        try {
          const data = JSON.parse(line.slice(6));
          const delta = data.choices?.[0]?.delta;
          if (delta?.tool_calls) {
            for (const tc of delta.tool_calls) {
              if (tc.function?.arguments) fullArgs += tc.function.arguments;
            }
          }
        } catch {}
      }
    }
  }
  if (!fullArgs) {
    try {
      const resJson = JSON.parse(responseBody);
      const tc = resJson.choices?.[0]?.message?.tool_calls?.find(t => t.function?.name === 'use_subagents' || /subagent/i.test(t.function?.name || ''));
      if (tc?.function?.arguments) fullArgs = tc.function.arguments;
    } catch {}
  }
  if (fullArgs) {
    try {
      const parsed = typeof fullArgs === 'object' ? fullArgs : JSON.parse(fullArgs);
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'string' && v.trim().length > 10) {
          const numMatch = k.match(/\d+/);
          const idx = numMatch ? parseInt(numMatch[0], 10) : subagentPromptsRegistry.length + 1;
          const snippet = v.trim().slice(0, 100);
          if (!subagentPromptsRegistry.some(p => p.index === idx && p.snippet === snippet)) {
            subagentPromptsRegistry.push({ index: idx, snippet, fullPrompt: v.trim() });
          }
        }
      }
    } catch {}
  }
}

function resolveSubagentIndex(userPromptText) {
  if (!userPromptText || typeof userPromptText !== 'string') return null;
  const cleanPrompt = userPromptText.trim();
  
  // 1. Try matching against registered parent tool call prompts
  for (const p of subagentPromptsRegistry) {
    if (cleanPrompt.includes(p.snippet) || p.snippet.includes(cleanPrompt.slice(0, 80))) {
      return p.index;
    }
  }

  // 2. Dynamic sequential assignment by unique initial task prompt
  const taskKey = cleanPrompt.slice(0, 150).replace(/\s+/g, ' ');
  if (!dynamicSubagentMap.has(taskKey)) {
    dynamicSubagentMap.set(taskKey, nextDynamicSubagentIndex++);
  }
  return dynamicSubagentMap.get(taskKey);
}

/**
 * Correlates a captured chat/completions request with the nearest task in the
 * DB by timestamp, then persists the system prompt text and system memory snapshot.
 * @param {string} requestBody - raw request body string
 * @param {number} capturedTs   - epoch ms when the proxy captured this request
 * @param {string|null} modelId - model ID from parsed request (x-model or body.model)
 * @param {string|null} agentLabel - detected agent label (e.g. 'Subagent 1', 'PostQode', custom name)
 * @param {number|null} subagentIndex - worker index (1..N) if this request is from a subagent
 */
function extractAndPersistSystemPrompt(requestBody, capturedTs, modelId, agentLabel = null, subagentIndex = null) {
  if (!proxyDb) return; // DB not wired in — skip silently

  let parsed;
  try { parsed = JSON.parse(requestBody); } catch { return; }

  const systemText = extractSystemTextFromParsed(parsed);

  // Find the nearest api_req_started event within the drift window.
  // events.ts is stored in milliseconds (same as Date.now()).
  try {
    const row = proxyDb.prepare(`
      SELECT task_id FROM events
      WHERE type = 'say' AND sub_type = 'api_req_started'
        AND ts BETWEEN ? AND ?
      ORDER BY ABS(ts - ?) ASC
      LIMIT 1
    `).get(
      capturedTs - SYSTEM_PROMPT_DRIFT_MS,
      capturedTs + SYSTEM_PROMPT_DRIFT_MS,
      capturedTs
    );

    if (!row) return; // No nearby task found — can't correlate

    const taskId = row.task_id;
    const modelIdFromBody = parsed.model || modelId || null;

    // 1. Determine agent role & identity
    const isSub = (agentLabel && /subagent/i.test(agentLabel)) || subagentIndex != null;
    const isCustom = agentLabel && !isSub && !/postqode/i.test(agentLabel) && !/assistant/i.test(agentLabel);
    const role = isSub ? 'subagent' : (isCustom ? 'custom_agent' : 'main');
    const subIdx = subagentIndex || null;
    const agentName = agentLabel || (isSub ? `Subagent ${subIdx || 1}` : 'PostQode');

    // 2. Persist distinct system prompt if present
    if (systemText) {
      const approxTokens = Math.round(systemText.length / 4);
      const existing = proxyDb.prepare(`
        SELECT id FROM task_system_prompts
        WHERE task_id = ? AND agent_role = ? AND (subagent_index IS ? OR subagent_index = ?)
        LIMIT 1
      `).get(taskId, role, subIdx, subIdx);

      if (!existing) {
        proxyDb.prepare(`
          INSERT INTO task_system_prompts (
            task_id, captured_at_ts, model_id, system_text, approx_tokens, source,
            agent_role, subagent_index, agent_name
          ) VALUES (?, ?, ?, ?, ?, 'proxy', ?, ?, ?)
        `).run(taskId, capturedTs, modelIdFromBody, systemText, approxTokens, role, subIdx, agentName);
      }
    }

    // 3. Record Physical System Memory (RAM & Process Heap) Timeline Snapshot
    try {
      const os = require('os');
      const totalMem = os.totalmem();
      const freeMem = os.freemem();
      const usedMem = totalMem - freeMem;
      const memPct = totalMem > 0 ? (usedMem / totalMem) * 100 : 0;
      let procMem = null;
      try { procMem = process.memoryUsage(); } catch {}

      proxyDb.prepare(`
        INSERT INTO task_memory_timeline (
          task_id, turn, ts, agent_role, subagent_index,
          system_ram_used_bytes, system_ram_total_bytes, system_ram_pct,
          process_rss_bytes, process_heap_bytes, active_threads
        ) VALUES (?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        taskId,
        capturedTs,
        role,
        subIdx,
        usedMem,
        totalMem,
        parseFloat(memPct.toFixed(2)),
        procMem?.rss || null,
        procMem?.heapUsed || null,
        isSub ? (subagentPromptsRegistry.length || 1) : 1
      );
    } catch (memErr) {
      // Non-fatal timeline recording error
    }
  } catch (e) {
    // Non-fatal — the dashboard still works without the system prompt row
    console.warn('[proxy] system-prompt/memory persist error:', e.message);
  }
}

/**
 * Start the MITM proxy server.
 * @param {Object} config - { port, buffer_size, db? }
 * @returns {{ store: NetworkStore }}
 */
function startProxy(config = {}) {
  proxyPort = config.port || 3457;
  const bufferSize = config.buffer_size || 2000;
  const rawCertsDir = config.certs_dir || path.join(require('os').homedir(), '.pq-dashboard', 'proxy-certs');
  certsDir = path.resolve(rawCertsDir.replace(/^~/, require('os').homedir()));
  if (config.db) proxyDb = config.db; // wire in DB for system-prompt persistence

  // Ensure certs directory exists
  fs.mkdirSync(certsDir, { recursive: true });

  // If the target certs directory is missing ca.pem, check fallback candidates
  // to avoid generating a new un-trusted CA certificate.
  const targetCaPath = path.join(certsDir, 'certs', 'ca.pem');
  if (!fs.existsSync(targetCaPath)) {
    const homedir = require('os').homedir();
    const fallbackCandidates = [
      path.join(homedir, '.pq-dashboard', 'proxy-certs'),
      path.resolve(__dirname, '../../data/proxy-certs'),
      path.resolve(__dirname, '../data/proxy-certs'),
    ];
    for (const cand of fallbackCandidates) {
      const candCa = path.join(cand, 'certs', 'ca.pem');
      if (fs.existsSync(candCa) && cand !== certsDir) {
        try {
          fs.cpSync(cand, certsDir, { recursive: true });
          console.log(`🔐 Reused trusted proxy CA certificates from ${cand}`);
          break;
        } catch (e) {}
      }
    }
  }

  loadMockRules();

  store = new NetworkStore(bufferSize);
  proxyServer = new Proxy();

  // Monkey-patch _onError to suppress noisy localhost/loopback connection errors on macOS.
  // The library's _onError method unconditionally calls console.error, which floods the terminal.
  const originalOnError = proxyServer._onError.bind(proxyServer);
  proxyServer._onError = function (kind, ctx, err) {
    const isLocalError = err && (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') &&
      (err.message.includes('0.0.0.0') || err.message.includes('127.0.0.1') || err.message.includes('localhost'));
    
    if (isLocalError) {
      // Run handlers but bypass console.error logging to prevent terminal spam
      this.onErrorHandlers.forEach((handler) => {
        try { handler(ctx, err, kind); } catch (e) {}
      });
      if (ctx) {
        ctx.onErrorHandlers.forEach((handler) => {
          try { handler(ctx, err, kind); } catch (e) {}
        });
        if (ctx.proxyToClientResponse && !ctx.proxyToClientResponse.headersSent) {
          ctx.proxyToClientResponse.writeHead(504, "Proxy Error");
        }
        if (ctx.proxyToClientResponse && !ctx.proxyToClientResponse.finished) {
          ctx.proxyToClientResponse.end(`${kind}: ${err}`, "utf8");
        }
      }
      return;
    }
    return originalOnError(kind, ctx, err);
  };

  // Capture request/response pairs
  proxyServer.onRequest(function (ctx, callback) {
    const startTime = Date.now();
    const host = ctx.clientToProxyRequest.headers.host || '';
    const url = `${ctx.isSSL ? 'https' : 'http'}://${host}${ctx.clientToProxyRequest.url}`;
    const method = ctx.clientToProxyRequest.method;

    // ── Intercept / Breakpoint Check ──
    if (interceptEnabled && matchesInterceptFilters(url)) {
      const requestChunks = [];
      ctx.clientToProxyRequest.on('data', (chunk) => {
        requestChunks.push(chunk);
      });
      ctx.clientToProxyRequest.on('end', () => {
        const rawReqBody = Buffer.concat(requestChunks);
        const requestBody = decodeBody(rawReqBody, ctx.clientToProxyRequest.headers);
        const interceptId = randomUUID();

        const requestData = {
          method,
          url,
          host: host.replace(/:\d+$/, ''),
          path: ctx.clientToProxyRequest.url,
          requestHeaders: { ...ctx.clientToProxyRequest.headers },
          requestBody,
          tag: tagForHost(host),
          timestamp: new Date().toISOString(),
        };

        // Create a Promise that pauses the proxy flow
        const interceptPromise = new Promise((resolve) => {
          const timer = setTimeout(() => {
            // Auto-drop after timeout
            if (pendingIntercepts.has(interceptId)) {
              pendingIntercepts.delete(interceptId);
              resolve({ action: 'drop', modifiedData: null });
              broadcastMessage({ type: 'intercept_timeout', data: { id: interceptId } });
            }
          }, INTERCEPT_TIMEOUT_MS);

          pendingIntercepts.set(interceptId, { resolve, ctx, requestData, timestamp: Date.now(), timer });
        });

        // Broadcast the intercepted request to the dashboard
        broadcastMessage({ type: 'intercepted', data: { id: interceptId, ...requestData } });

        // Wait for user action
        interceptPromise.then(({ action, modifiedData }) => {
          if (action === 'drop') {
            // Respond with 499 Client Closed / Dropped
            try {
              ctx.proxyToClientResponse.writeHead(499, { 'x-intercepted': 'dropped' });
              ctx.proxyToClientResponse.end('Request dropped by Network Inspector breakpoint');
            } catch (e) { /* client may have already disconnected */ }

            const record = {
              timestamp: new Date().toISOString(),
              method,
              url,
              host: host.replace(/:\d+$/, ''),
              path: ctx.clientToProxyRequest.url,
              requestHeaders: { ...ctx.clientToProxyRequest.headers },
              requestBody,
              statusCode: 499,
              responseHeaders: {},
              responseBody: 'Dropped by breakpoint',
              duration: Date.now() - startTime,
              size: 0,
              error: 'Dropped by breakpoint',
              tag: tagForHost(host),
              isIntercepted: true,
              interceptAction: 'drop',
            };
            store.add(record);
            broadcast(record);
            return;
          }

          // action === 'forward' — possibly with modifications
          if (modifiedData) {
            // Apply modifications to the proxy context
            if (modifiedData.url && modifiedData.url !== url) {
              try {
                const parsed = new URL(modifiedData.url);
                ctx.proxyToServerRequestOptions.host = parsed.hostname;
                ctx.proxyToServerRequestOptions.port = parsed.port || (parsed.protocol === 'https:' ? 443 : 80);
                ctx.proxyToServerRequestOptions.path = parsed.pathname + parsed.search;
                ctx.proxyToServerRequestOptions.headers.host = parsed.host;
              } catch (e) { /* keep original if URL parse fails */ }
            }
            if (modifiedData.method) {
              ctx.proxyToServerRequestOptions.method = modifiedData.method;
            }
            if (modifiedData.headers && typeof modifiedData.headers === 'object') {
              ctx.proxyToServerRequestOptions.headers = { ...ctx.proxyToServerRequestOptions.headers, ...modifiedData.headers };
            }
          }

          // Now proceed with the normal proxy flow (collect response, store, broadcast)
          const actualMethod = modifiedData?.method || method;
          const actualUrl = modifiedData?.url || url;
          const actualReqBody = modifiedData?.body != null ? modifiedData.body : requestBody;

          const responseChunks = [];
          ctx.onResponseData(function (ctx, chunk, cb) {
            responseChunks.push(chunk);
            return cb(null, chunk);
          });

          ctx.onResponseEnd(function (ctx, cb) {
            const duration = Date.now() - startTime;
            const statusCode = ctx.serverToProxyResponse?.statusCode || 0;
            let responseBody = '';
            try {
              const rawResBody = Buffer.concat(responseChunks);
              responseBody = decodeBody(rawResBody, ctx.serverToProxyResponse?.headers);
            } catch (e) {
              responseBody = '[binary data]';
            }
            const responseSize = responseChunks.reduce((sum, c) => sum + c.length, 0);

            const record = {
              timestamp: new Date().toISOString(),
              method: actualMethod,
              url: actualUrl,
              host: (modifiedData?.url ? new URL(modifiedData.url).hostname : host).replace(/:\d+$/, ''),
              path: ctx.clientToProxyRequest.url,
              requestHeaders: modifiedData?.headers || { ...ctx.clientToProxyRequest.headers },
              requestBody: actualReqBody,
              statusCode,
              responseHeaders: ctx.serverToProxyResponse?.headers ? { ...ctx.serverToProxyResponse.headers } : {},
              responseBody,
              duration,
              size: responseSize,
              error: null,
              tag: tagForHost(host),
              isIntercepted: true,
              interceptAction: modifiedData ? 'edited' : 'forwarded',
            };

            store.add(record);
            broadcast(record);
            return cb();
          });

          ctx.onError(function (ctx, err) {
            const duration = Date.now() - startTime;
            const record = {
              timestamp: new Date().toISOString(),
              method: actualMethod,
              url: actualUrl,
              host: host.replace(/:\d+$/, ''),
              path: ctx.clientToProxyRequest.url,
              requestHeaders: {},
              requestBody: actualReqBody,
              statusCode: 0,
              responseHeaders: {},
              responseBody: '',
              duration,
              size: 0,
              error: err.message || 'Unknown error',
              tag: tagForHost(host),
              isIntercepted: true,
              interceptAction: 'error',
            };
            store.add(record);
            broadcast(record);
          });

          // Override request stream piping to stream the uncompressed request body buffer
          const bodyBuf = Buffer.from(actualReqBody, 'utf-8');

          if (ctx.proxyToServerRequestOptions && ctx.proxyToServerRequestOptions.headers) {
            ctx.proxyToServerRequestOptions.headers['content-length'] = bodyBuf.length;
            delete ctx.proxyToServerRequestOptions.headers['content-encoding'];
            delete ctx.proxyToServerRequestOptions.headers['transfer-encoding'];
          }

          ctx.clientToProxyRequest.pipe = function (dest, options) {
            const bodyStream = new Readable();
            bodyStream._read = function () {
              this.push(bodyBuf);
              this.push(null);
            };
            return bodyStream.pipe(dest, options);
          };

          callback();
        });
      });
      ctx.clientToProxyRequest.resume();
      return; // Don't call callback() here — we call it inside the promise .then()
    }

    // Check if there is an active test dynamic mock handler or default mock handler
    const activeHandler = dynamicMockHandler || defaultMockHandler;
    const isDynamicMatch = activeHandler && (
      (typeof activeHandler.shouldHandle === 'function' && activeHandler.shouldHandle({ url, method, host })) ||
      (typeof activeHandler.match === 'function' && activeHandler.match({ url, method, host, headers: ctx.clientToProxyRequest.headers })) ||
      (!activeHandler.shouldHandle && !activeHandler.match)
    );

    if (isDynamicMatch) {
      const requestChunks = [];
      ctx.clientToProxyRequest.on('data', (chunk) => {
        requestChunks.push(chunk);
      });
      ctx.clientToProxyRequest.on('end', async () => {
        const rawReqBody = Buffer.concat(requestChunks);
        const requestBody = decodeBody(rawReqBody, ctx.clientToProxyRequest.headers);
        let parsedReqBody = {};
        try { parsedReqBody = JSON.parse(requestBody); } catch (e) {}
        try {
          await activeHandler.handle({
            ctx,
            proxyToClientResponse: ctx.proxyToClientResponse,
            clientToProxyRequest: ctx.clientToProxyRequest,
            requestBody,
            reqBody: parsedReqBody,
            method,
            url,
            host: host.replace(/:\d+$/, ''),
            path: ctx.clientToProxyRequest.url,
            requestHeaders: { ...ctx.clientToProxyRequest.headers },
            startTime,
            onComplete: (record) => {
              store.add(record);
              broadcast(record);
            },
          });
        } catch (err) {
          console.error('[Dynamic Mock] Error executing handler:', err);
          if (!ctx.proxyToClientResponse.headersSent) {
            ctx.proxyToClientResponse.writeHead(500, { 'content-type': 'application/json' });
            ctx.proxyToClientResponse.end(JSON.stringify({ error: err.message }));
          }
        }
      });
      ctx.clientToProxyRequest.resume();
      return;
    }

    // Check if there's a matching mock rule
    const rule = mockRules.find(r => {
      if (!r.enabled) return false;
      if (r.method && r.method !== method) return false;
      return url.toLowerCase().includes(r.urlPattern.toLowerCase());
    });

    if (rule) {
      const requestChunks = [];
      ctx.clientToProxyRequest.on('data', (chunk) => {
        requestChunks.push(chunk);
      });
      ctx.clientToProxyRequest.on('end', () => {
        const delay = rule.delay || 0;
        setTimeout(() => {
          const rawReqBody = Buffer.concat(requestChunks);
          const requestBody = decodeBody(rawReqBody, ctx.clientToProxyRequest.headers);
          
          const statusCode = parseInt(rule.statusCode || 200, 10);
          const responseBody = rule.responseBody || '';
          const responseHeaders = {
            'content-type': 'application/json; charset=utf-8',
            'x-mock-rule-id': rule.id,
            'content-length': Buffer.byteLength(responseBody)
          };
          
          ctx.proxyToClientResponse.writeHead(statusCode, responseHeaders);
          ctx.proxyToClientResponse.end(responseBody);
          
          const duration = Date.now() - startTime + delay;
          const record = {
            timestamp: new Date().toISOString(),
            method,
            url,
            host: host.replace(/:\d+$/, ''),
            path: ctx.clientToProxyRequest.url,
            requestHeaders: { ...ctx.clientToProxyRequest.headers },
            requestBody,
            statusCode,
            responseHeaders,
            responseBody,
            duration,
            size: Buffer.byteLength(responseBody),
            error: null,
            tag: tagForHost(host),
            isMocked: true,
            mockRuleId: rule.id
          };
          
          store.add(record);
          broadcast(record);
        }, delay);
      });
      ctx.clientToProxyRequest.resume();
      return;
    }

    // Collect request body chunks
    const requestChunks = [];
    ctx.onRequestData(function (ctx, chunk, callback) {
      requestChunks.push(chunk);
      return callback(null, chunk);
    });

    // Collect response body chunks
    const responseChunks = [];
    const responseChunksWithTimings = [];
    ctx.onResponseData(function (ctx, chunk, callback) {
      responseChunks.push(chunk);
      if (activeLiveRecorder) {
        responseChunksWithTimings.push({
          timeMs: Date.now() - startTime,
          data: chunk.toString('utf-8'),
          length: chunk.length,
        });
      }
      return callback(null, chunk);
    });

    ctx.onResponseEnd(function (ctx, callback) {
      const duration = Date.now() - startTime;
      const statusCode = ctx.serverToProxyResponse?.statusCode || 0;

      // Reconstruct bodies (truncate if too large)
      let requestBody = '';
      let responseBody = '';

      try {
        const rawReqBody = Buffer.concat(requestChunks);
        requestBody = decodeBody(rawReqBody, ctx.clientToProxyRequest.headers);
      } catch (e) {
        requestBody = '[binary data]';
      }

      try {
        const rawResBody = Buffer.concat(responseChunks);
        responseBody = decodeBody(rawResBody, ctx.serverToProxyResponse?.headers);
      } catch (e) {
        responseBody = '[binary data]';
      }

      if (activeLiveRecorder && (url.includes('/chat/completions') || url.includes('/v1/messages') || url.includes('/postqode-provider') || tagForHost(host) !== 'other')) {
        const streamRecord = {
          scenarioId: activeLiveRecorder.scenarioId,
          timestamp: new Date().toISOString(),
          url,
          method,
          host: host.replace(/:\d+$/, ''),
          requestHeaders: { ...ctx.clientToProxyRequest.headers },
          requestBody: typeof requestBody === 'string' ? requestBody : JSON.stringify(requestBody),
          statusCode,
          responseHeaders: ctx.serverToProxyResponse?.headers ? { ...ctx.serverToProxyResponse.headers } : {},
          responseBody,
          duration,
          ttft: responseChunksWithTimings[0]?.timeMs || duration,
          chunkCount: responseChunksWithTimings.length,
          chunks: responseChunksWithTimings,
        };
        activeLiveRecorder.streams.push(streamRecord);
        try {
          fs.writeFileSync(
            path.join(activeLiveRecorder.targetDir, 'network_stream.json'),
            JSON.stringify(activeLiveRecorder.streams, null, 2),
            'utf8'
          );
        } catch (e) {
          console.error('[LiveRecorder] Error writing network_stream.json:', e.message);
        }
      }

      const responseSize = responseChunks.reduce((sum, c) => sum + c.length, 0);

      // Check for parent tool call spawning subagents (e.g. use_subagents)
      if (responseBody && (responseBody.includes('use_subagents') || responseBody.includes('subagent'))) {
        registerParentSubagentPrompts(responseBody);
      }

      // Extract agent label & model from chat/completions request
      let agentLabel = null;
      let subagentIndex = null;
      let modelFromBody = null;
      if (method === 'POST' && CHAT_API_RE.test(url) && requestBody) {
        const sysText = extractSystemPromptStart(requestBody);
        if (sysText) {
          agentLabel = extractAgentLabel(sysText);
        }
        try {
          const parsedReq = typeof requestBody === 'object' ? requestBody : JSON.parse(requestBody);
          if (parsedReq.model) {
            modelFromBody = parsedReq.model;
          }
          if (agentLabel && /subagent/i.test(agentLabel)) {
            const uMsg = parsedReq.messages?.find(m => m.role === 'user');
            let uText = '';
            if (uMsg) {
              uText = typeof uMsg.content === 'string' ? uMsg.content : (Array.isArray(uMsg.content) ? uMsg.content.map(c => c.text || '').join(' ') : '');
            }
            subagentIndex = resolveSubagentIndex(uText);
            if (subagentIndex) {
              agentLabel = `Subagent ${subagentIndex}`;
            }
          }
        } catch (e) {}
      }

      const record = {
        timestamp: new Date().toISOString(),
        method,
        url,
        host: host.replace(/:\d+$/, ''),
        path: ctx.clientToProxyRequest.url,
        requestHeaders: { ...ctx.clientToProxyRequest.headers },
        requestBody,
        statusCode,
        responseHeaders: ctx.serverToProxyResponse?.headers
          ? { ...ctx.serverToProxyResponse.headers }
          : {},
        responseBody,
        duration,
        size: responseSize,
        error: null,
        tag: tagForHost(host),
        agentLabel,
        subagentIndex,
        model: modelFromBody,
      };

      store.add(record);
      broadcast(record);

      // ── System-prompt persistence hook ──
      // Only run for AI chat/completions endpoints (POST), non-error responses.
      // Fire-and-forget: any errors inside are caught and logged, not thrown.
      if (
        method === 'POST' &&
        CHAT_API_RE.test(url) &&
        statusCode >= 200 && statusCode < 300 &&
        requestBody && requestBody.length > 0
      ) {
        const capturedTs = new Date(record.timestamp).getTime();
        // Model ID hint from response body (Anthropic/OpenAI both include it)
        let modelHint = null;
        try {
          const resJson = JSON.parse(responseBody);
          modelHint = resJson.model || null;
        } catch {}
        // Run async so we never block the proxy callback
        setImmediate(() => extractAndPersistSystemPrompt(requestBody, capturedTs, modelHint, agentLabel, subagentIndex));
      }

      return callback();
    });

    ctx.onError(function (ctx, err) {
      const duration = Date.now() - startTime;
      const record = {
        timestamp: new Date().toISOString(),
        method,
        url,
        host: host.replace(/:\d+$/, ''),
        path: ctx.clientToProxyRequest.url,
        requestHeaders: { ...ctx.clientToProxyRequest.headers },
        requestBody: Buffer.concat(requestChunks).toString('utf-8').slice(0, 1024),
        statusCode: 0,
        responseHeaders: {},
        responseBody: '',
        duration,
        size: 0,
        error: err.message || 'Unknown error',
        tag: tagForHost(host),
      };

      store.add(record);
      broadcast(record);
    });

    return callback();
  });

  // Error handler at the proxy level
  proxyServer.onError(function (ctx, err) {
    console.error('[Proxy Error]', err.message);
  });

  // Bind explicitly to 127.0.0.1 (IPv4 loopback) for secure local operation
  // and compatibility with the net.connect patch.
  proxyServer.listen({ port: proxyPort, host: '0.0.0.0', sslCaDir: certsDir }, () => {
    isRunning = true;
    console.log(`📡 Network proxy listening on http://127.0.0.1:${proxyPort}`);
    console.log(`   CA certs stored in: ~/.pq-dashboard/proxy-certs`);
    console.log(`\n🔒 To intercept HTTPS traffic without SSL errors, trust the proxy CA certificate:`);
    console.log(`   🍎 macOS (Terminal):`);
    console.log(`      sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$HOME/.pq-dashboard/proxy-certs/certs/ca.pem"`);
    console.log(`   🔌 Windows (Admin PowerShell):`);
    console.log(`      Import-Certificate -FilePath "$HOME\\.pq-dashboard\\proxy-certs\\certs\\ca.pem" -CertStoreLocation Cert:\\CurrentUser\\Root\n`);
  });

  return { store };
}

/**
 * Get current proxy status.
 */
function getProxyStatus() {
  return {
    running: isRunning,
    port: proxyPort,
    ca_cert_path: '$HOME/.pq-dashboard/proxy-certs/certs/ca.pem',
    ...store ? store.stats() : { count: 0, maxSize: 500 },
  };
}

/**
 * Get the request store instance.
 */
function getStore() {
  return store;
}

module.exports = {
  startProxy, getProxyStatus, getStore,
  getMockRules, addMockRule, deleteMockRule,
  getInterceptState, setInterceptState, resolveInterceptedRequest, forwardAllPending, getPendingRequests,
  setDynamicMockHandler, clearDynamicMockHandler, getDynamicMockHandler,
  setDefaultMockHandler, clearDefaultMockHandler,
  startLiveRecording, stopLiveRecording, getActiveLiveRecorder,
};
