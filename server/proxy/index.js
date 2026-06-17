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

module.exports = { startProxy, getProxyStatus, getStore, getMockRules, addMockRule, deleteMockRule };
