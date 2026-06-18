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
const { broadcast } = require('./ws');
const { randomUUID } = require('crypto');

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

  const maxBodySize = 100 * 1024; // 100KB
  try {
    return decompressed.length > maxBodySize
      ? decompressed.slice(0, maxBodySize).toString('utf-8') + '\n... [truncated]'
      : decompressed.toString('utf-8');
  } catch (e) {
    return '[binary data]';
  }
}

const mocksPath = path.resolve('./data/network-mocks.json');
let mockRules = [];

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
  broadcast({ type: 'intercept_state_changed', data: { enabled: interceptEnabled, filters: interceptFilters } });
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
  broadcast({ type: 'intercept_resolved', data: { id, action } });
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
    broadcast({ type: 'intercept_resolved', data: { id: '*', action: 'forward_all', count } });
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

/**
 * Start the MITM proxy server.
 * @param {Object} config - { port, buffer_size }
 * @returns {{ store: NetworkStore }}
 */
function startProxy(config = {}) {
  proxyPort = config.port || 3457;
  const bufferSize = config.buffer_size || 500;
  certsDir = path.resolve(config.certs_dir || './data/proxy-certs');

  // Ensure certs directory exists
  fs.mkdirSync(certsDir, { recursive: true });

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
              broadcast({ type: 'intercept_timeout', data: { id: interceptId } });
            }
          }, INTERCEPT_TIMEOUT_MS);

          pendingIntercepts.set(interceptId, { resolve, ctx, requestData, timestamp: Date.now(), timer });
        });

        // Broadcast the intercepted request to the dashboard
        broadcast({ type: 'intercepted', data: { id: interceptId, ...requestData } });

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

          // If modified body was provided, we need to write it to the server request
          if (modifiedData?.body != null) {
            const bodyBuf = Buffer.from(modifiedData.body, 'utf-8');
            ctx.proxyToServerRequestOptions.headers['content-length'] = bodyBuf.length;
            ctx.addRequestFilter(require('http-mitm-proxy').gunzip);
          }

          callback();
        });
      });
      ctx.clientToProxyRequest.resume();
      return; // Don't call callback() here — we call it inside the promise .then()
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
    ctx.onResponseData(function (ctx, chunk, callback) {
      responseChunks.push(chunk);
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

      const responseSize = responseChunks.reduce((sum, c) => sum + c.length, 0);

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
      };

      store.add(record);
      broadcast(record);

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
  proxyServer.listen({ port: proxyPort, host: '127.0.0.1', sslCaDir: certsDir }, () => {
    isRunning = true;
    const caPath = path.join(certsDir, 'certs/ca.pem');
    console.log(`📡 Network proxy listening on http://127.0.0.1:${proxyPort}`);
    console.log(`   CA certs stored in: ${certsDir}`);
    console.log(`\n🔒 To intercept HTTPS traffic without SSL errors, trust the proxy CA certificate:`);
    console.log(`   🍎 macOS (Terminal):`);
    console.log(`      sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${caPath}"`);
    console.log(`   🔌 Windows (Admin PowerShell):`);
    console.log(`      Import-Certificate -FilePath "${caPath}" -CertStoreLocation Cert:\\LocalMachine\\Root\n`);
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
    ca_cert_path: certsDir ? path.join(certsDir, 'certs/ca.pem') : '',
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
};
