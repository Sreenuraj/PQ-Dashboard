/**
 * Network Inspector API Routes
 * REST endpoints for querying captured network requests.
 */

const express = require('express');

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
