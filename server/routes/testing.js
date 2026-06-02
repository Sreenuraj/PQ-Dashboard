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

  router.put('/test-results/:id/rate', (req, res) => {
    const { rating } = req.body || {};
    if (rating === undefined || rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });
    }
    const result = db.prepare('UPDATE test_results SET user_rating = ? WHERE id = ?').run(rating, req.params.id);
    if (result.changes === 0) {
      return res.status(404).json({ error: 'Test result not found' });
    }
    res.json({ ok: true, rating });
  });

  return router;
};
