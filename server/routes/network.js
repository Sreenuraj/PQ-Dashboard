/**
 * Network Inspector API Routes
 * REST endpoints for querying captured network requests.
 */

const express = require('express');
const { broadcast } = require('../proxy/ws');

module.exports = (getStore, getStatus, getClientCount) => {
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
      const maxBodySize = 100 * 1024;
      try {
        responseBody = rawResBody.length > maxBodySize
          ? rawResBody.slice(0, maxBodySize).toString('utf-8') + '\n... [truncated]'
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

  return router;
};
