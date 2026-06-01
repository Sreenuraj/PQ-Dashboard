const express = require('express');
const { loadRules, saveRules } = require('../testing/rules');
const { runTestSuite, getToolRegistry } = require('../testing');

module.exports = (db) => {
  const router = express.Router();

  router.get('/test-rules', (req, res) => {
    res.json(loadRules());
  });

  router.put('/test-rules', (req, res) => {
    try {
      res.json(saveRules(req.body || {}));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/tools/registry', (req, res) => {
    res.json({ tools: getToolRegistry(db) });
  });

  router.get('/tasks/:id/test', (req, res) => {
    try {
      res.json(runTestSuite(db, req.params.id, req.query.baseline || null));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  router.get('/tasks/:id/test/:pattern', (req, res) => {
    try {
      res.json(runTestSuite(db, req.params.id, req.query.baseline || null, req.params.pattern, false));
    } catch (e) {
      res.status(e.status || 500).json({ error: e.message });
    }
  });

  return router;
};
