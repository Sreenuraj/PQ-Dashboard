/**
 * Network Inspector API Routes
 * REST endpoints for querying captured network requests.
 */

const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { broadcast } = require('../proxy/ws');

module.exports = (getStore, getStatus, getClientCount, getMockRules, addMockRule, deleteMockRule, getInterceptState, setInterceptState, resolveInterceptedRequest, forwardAllPending) => {
  const router = express.Router();

  // GET /api/network/status — proxy status
  router.get('/network/status', (req, res) => {
    const status = getStatus();
    status.clients = getClientCount();
    res.json(status);
  });

  // GET /api/network/requests — paginated, filtered list
  router.get('/network/requests', (req, res) => {
    const store = getStore();
    if (!store) return res.json({ requests: [], total: 0 });

    const filters = {
      host: req.query.host,
      method: req.query.method,
      status: req.query.status,
      search: req.query.search,
      agent: req.query.agent,
      limit: req.query.limit,
      offset: req.query.offset,
    };
    res.json(store.getAll(filters));
  });

  // GET /api/network/requests/:id — single request detail
  router.get('/network/requests/:id', (req, res) => {
    const store = getStore();
    if (!store) return res.status(404).json({ error: 'Store not initialized' });

    const record = store.getById(req.params.id);
    if (!record) return res.status(404).json({ error: 'Request not found' });
    res.json(record);
  });

  // POST /api/network/replay/:id — replay a request
  router.post('/network/replay/:id', async (req, res) => {
    const store = getStore();
    if (!store) return res.status(404).json({ error: 'Store not initialized' });

    const originalRecord = store.getById(req.params.id);
    if (!originalRecord) return res.status(404).json({ error: 'Request not found' });

    try {
      const startTime = Date.now();
      const headers = { ...originalRecord.requestHeaders };
      
      // Remove connection-specific headers
      delete headers['host'];
      delete headers['connection'];
      delete headers['content-length'];
      delete headers['accept-encoding'];

      const fetchOptions = {
        method: originalRecord.method,
        headers,
      };

      if (originalRecord.method !== 'GET' && originalRecord.method !== 'HEAD' && originalRecord.requestBody) {
        fetchOptions.body = originalRecord.requestBody;
      }

      const response = await fetch(originalRecord.url, fetchOptions);
      const duration = Date.now() - startTime;
      
      const arrayBuffer = await response.arrayBuffer();
      const rawResBody = Buffer.from(arrayBuffer);
      const resHeaders = {};
      response.headers.forEach((val, key) => {
        resHeaders[key] = val;
      });

      let responseBody = '';
      const maxBodySize = 50 * 1024 * 1024; // 50MB
      try {
        responseBody = rawResBody.length > maxBodySize
          ? rawResBody.slice(0, maxBodySize).toString('utf-8') + '\n... [payload capped at 50MB]'
          : rawResBody.toString('utf-8');
      } catch (e) {
        responseBody = '[binary data]';
      }

      const responseSize = rawResBody.length;

      const record = {
        timestamp: new Date().toISOString(),
        method: originalRecord.method,
        url: originalRecord.url,
        host: originalRecord.host,
        path: originalRecord.path,
        requestHeaders: { ...headers },
        requestBody: originalRecord.requestBody,
        statusCode: response.status,
        responseHeaders: resHeaders,
        responseBody,
        duration,
        size: responseSize,
        error: null,
        tag: originalRecord.tag,
        isReplay: true,
        replayedFromId: originalRecord.id,
      };

      store.add(record);
      broadcast(record);

      res.json({ success: true, record });
    } catch (err) {
      console.error('[Proxy Replay Error]', err.message);
      
      const duration = Date.now() - startTime;
      const record = {
        timestamp: new Date().toISOString(),
        method: originalRecord.method,
        url: originalRecord.url,
        host: originalRecord.host,
        path: originalRecord.path,
        requestHeaders: {},
        requestBody: originalRecord.requestBody,
        statusCode: 0,
        responseHeaders: {},
        responseBody: '',
        duration,
        size: 0,
        error: err.message || 'Unknown replay error',
        tag: originalRecord.tag,
        isReplay: true,
        replayedFromId: originalRecord.id,
      };

      store.add(record);
      broadcast(record);

      res.status(500).json({ error: err.message, record });
    }
  });

  // POST /api/network/clear — flush buffer
  router.post('/network/clear', (req, res) => {
    const store = getStore();
    if (store) store.clear();
    res.json({ ok: true });
  });

  // GET /api/network/export — export as HAR format
  router.get('/network/export', (req, res) => {
    const store = getStore();
    if (!store) return res.json({ log: { entries: [] } });

    const { requests } = store.getAll({ limit: 9999 });
    const entries = requests.map(r => ({
      startedDateTime: r.timestamp,
      time: r.duration,
      request: {
        method: r.method,
        url: r.url,
        headers: Object.entries(r.requestHeaders || {}).map(([name, value]) => ({ name, value: String(value) })),
        postData: r.requestBody ? { mimeType: 'application/json', text: r.requestBody } : undefined,
      },
      response: {
        status: r.statusCode,
        headers: Object.entries(r.responseHeaders || {}).map(([name, value]) => ({ name, value: String(value) })),
        content: {
          size: r.size,
          mimeType: (r.responseHeaders || {})['content-type'] || 'application/octet-stream',
          text: r.responseBody,
        },
      },
      timings: {
        send: 0,
        wait: r.duration,
        receive: 0,
      },
    }));

    const har = {
      log: {
        version: '1.2',
        creator: { name: 'PQ Dashboard Network Inspector', version: '1.0' },
        entries,
      },
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="pq-network-${Date.now()}.har"`);
    res.json(har);
  });

  // GET /api/network/mocks — get all mock rules
  router.get('/network/mocks', (req, res) => {
    if (typeof getMockRules !== 'function') return res.status(501).json({ error: 'Mocks not supported' });
    res.json(getMockRules());
  });

  // POST /api/network/mocks — create/update a mock rule
  router.post('/network/mocks', (req, res) => {
    if (typeof addMockRule !== 'function') return res.status(501).json({ error: 'Mocks not supported' });
    const rule = req.body;
    if (!rule.id || !rule.urlPattern) {
      return res.status(400).json({ error: 'id and urlPattern are required' });
    }
    const saved = addMockRule(rule);
    res.json({ success: true, rule: saved });
  });

  // DELETE /api/network/mocks/:id — delete a mock rule
  router.delete('/network/mocks/:id', (req, res) => {
    if (typeof deleteMockRule !== 'function') return res.status(501).json({ error: 'Mocks not supported' });
    const deleted = deleteMockRule(req.params.id);
    res.json({ success: deleted });
  });

  // ── Intercept / Breakpoint Endpoints ──

  // GET /api/network/intercept — get intercept state + pending requests
  router.get('/network/intercept', (req, res) => {
    if (typeof getInterceptState !== 'function') return res.status(501).json({ error: 'Intercept not supported' });
    res.json(getInterceptState());
  });

  // PUT /api/network/intercept — set intercept enabled/filters
  router.put('/network/intercept', (req, res) => {
    if (typeof setInterceptState !== 'function') return res.status(501).json({ error: 'Intercept not supported' });
    const { enabled, filters } = req.body;
    const state = setInterceptState(enabled, filters);
    res.json({ success: true, ...state });
  });

  // POST /api/network/intercept/:id/forward — forward a pending request (optionally with modifications)
  router.post('/network/intercept/:id/forward', (req, res) => {
    if (typeof resolveInterceptedRequest !== 'function') return res.status(501).json({ error: 'Intercept not supported' });
    const modifiedData = req.body || null;
    const hasModifications = modifiedData && Object.keys(modifiedData).length > 0;
    const ok = resolveInterceptedRequest(req.params.id, 'forward', hasModifications ? modifiedData : null);
    if (!ok) return res.status(404).json({ error: 'Intercepted request not found or already resolved' });
    res.json({ success: true });
  });

  // POST /api/network/intercept/:id/drop — drop a pending request
  router.post('/network/intercept/:id/drop', (req, res) => {
    if (typeof resolveInterceptedRequest !== 'function') return res.status(501).json({ error: 'Intercept not supported' });
    const ok = resolveInterceptedRequest(req.params.id, 'drop', null);
    if (!ok) return res.status(404).json({ error: 'Intercepted request not found or already resolved' });
    res.json({ success: true });
  });

  // POST /api/network/intercept/forward-all — release all pending requests
  router.post('/network/intercept/forward-all', (req, res) => {
    if (typeof forwardAllPending !== 'function') return res.status(501).json({ error: 'Intercept not supported' });
    const count = forwardAllPending();
    res.json({ success: true, count });
  });

  // ── IDE Settings Auto-Configuration Endpoints ──
  function getIdeSettingsList() {
    const home = os.homedir();
    const platform = process.platform;
    const ides = [
      { name: 'VS Code Insiders', dirName: 'Code - Insiders' },
      { name: 'VS Code', dirName: 'Code' },
      { name: 'Cursor', dirName: 'Cursor' },
      { name: 'Windsurf', dirName: 'Windsurf' },
    ];

    const results = [];
    for (const ide of ides) {
      let settingsPath = '';
      if (platform === 'darwin') {
        settingsPath = path.join(home, 'Library', 'Application Support', ide.dirName, 'User', 'settings.json');
      } else if (platform === 'win32') {
        const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
        settingsPath = path.join(appData, ide.dirName, 'User', 'settings.json');
      } else {
        settingsPath = path.join(home, '.config', ide.dirName, 'User', 'settings.json');
      }

      let isConfigured = false;
      let exists = false;
      if (fs.existsSync(settingsPath)) {
        exists = true;
        try {
          const raw = fs.readFileSync(settingsPath, 'utf8');
          isConfigured = /"http\.proxy"\s*:\s*"http:\/\/(127\.0\.0\.1|localhost):3457"/i.test(raw);
        } catch {}
      }
      results.push({ name: ide.name, path: settingsPath, exists, isConfigured });
    }
    return results;
  }

  function setIdeProxy(enable = true) {
    const ides = getIdeSettingsList().filter(i => i.exists);
    const modified = [];
    const alreadyConfigured = [];

    for (const ide of ides) {
      try {
        const content = fs.readFileSync(ide.path, 'utf8');
        let json = {};
        try {
          json = JSON.parse(content);
        } catch {
          // If JSON parse fails due to comments, strip single-line comments
          const cleaned = content.replace(/\/\/.*$/mg, '').replace(/\/\*[\s\S]*?\*\//g, '');
          json = JSON.parse(cleaned);
        }

        if (enable) {
          // If already configured with exact proxy settings, skip modifying!
          const hasProxy = json['http.proxy'] === 'http://127.0.0.1:3457' || json['http.proxy'] === 'http://localhost:3457';
          const hasStrictFalse = json['http.proxyStrictSSL'] === false;
          if (hasProxy && hasStrictFalse) {
            alreadyConfigured.push(ide.name);
            continue;
          }

          json['http.proxy'] = 'http://127.0.0.1:3457';
          json['http.proxyStrictSSL'] = false;
          json['http.proxySupport'] = 'override';
          json['http.noProxy'] = [
            'localhost',
            '127.0.0.1',
            'us.i.posthog.com',
            'mobile.events.data.microsoft.com',
            'main.vscode-cdn.net',
          ];
        } else {
          if (!json['http.proxy'] && json['http.proxyStrictSSL'] === undefined) {
            alreadyConfigured.push(ide.name);
            continue;
          }
          delete json['http.proxy'];
          delete json['http.proxyStrictSSL'];
        }

        fs.writeFileSync(ide.path, JSON.stringify(json, null, 4), 'utf8');
        modified.push(ide.name);
      } catch (e) {
        console.error(`Failed to update ${ide.name} settings:`, e.message);
      }
    }
    return { modified, alreadyConfigured };
  }

  // GET /api/network/proxy/ide-status — detected IDEs and whether proxy is active
  router.get('/network/proxy/ide-status', (req, res) => {
    const ides = getIdeSettingsList();
    const anyConfigured = ides.some(i => i.isConfigured);
    const allConfigured = ides.length > 0 && ides.every(i => !i.exists || i.isConfigured);
    res.json({ ides, anyConfigured, allConfigured });
  });

  // POST /api/network/proxy/auto-configure — inject proxy settings into detected IDE settings.json (only if missing)
  router.post('/network/proxy/auto-configure', (req, res) => {
    const result = setIdeProxy(true);
    res.json({ ok: true, ...result });
  });

  // POST /api/network/proxy/disable — remove proxy settings from detected IDE settings.json (only if present)
  router.post('/network/proxy/disable', (req, res) => {
    const result = setIdeProxy(false);
    res.json({ ok: true, ...result });
  });

  // GET /api/network/proxy/trust-cert — CA certificate path, platform command, and trusted status
  router.get('/network/proxy/trust-cert', (req, res) => {
    const caPath = path.join(os.homedir(), '.pq-dashboard', 'proxy-certs', 'certs', 'ca.pem');
    const platform = process.platform;
    let isTrusted = false;
    if (fs.existsSync(caPath)) {
      if (platform === 'darwin') {
        try {
          const { execSync } = require('child_process');
          execSync(`security verify-cert -c "${caPath}" -p basic`, { stdio: 'ignore', timeout: 1500 });
          isTrusted = true;
        } catch {}
      }
    }

    let command = '';
    const displayPath = '~/.pq-dashboard/proxy-certs/certs/ca.pem';
    if (platform === 'darwin') {
      command = `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "$HOME/.pq-dashboard/proxy-certs/certs/ca.pem"`;
    } else if (platform === 'win32') {
      command = `Import-Certificate -FilePath "$HOME\\.pq-dashboard\\proxy-certs\\certs\\ca.pem" -CertStoreLocation Cert:\\CurrentUser\\Root`;
    } else {
      command = `sudo cp "$HOME/.pq-dashboard/proxy-certs/certs/ca.pem" /usr/local/share/ca-certificates/pq-ca.crt && sudo update-ca-certificates`;
    }
    res.json({ caPath: displayPath, fullPath: caPath, exists: fs.existsSync(caPath), isTrusted, platform, command });
  });

  return router;
};
