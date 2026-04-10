const express = require('express');
const router = express.Router();

module.exports = (db) => {

  // GET /api/tasks — paginated list with filters
  router.get('/', (req, res) => {
    const {
      page = 1, limit = 20,
      from, to, model, source,
      hasErrors, hasReasoning, status,
      error_category, tool_name, search
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const conditions = [];
    const params = [];

    if (from) { conditions.push('t.start_ts >= ?'); params.push(new Date(from).getTime()); }
    if (to)   { conditions.push('t.start_ts <= ?'); params.push(new Date(to).getTime()); }
    if (source) { conditions.push('t.source = ?'); params.push(source); }
    if (status) { conditions.push('t.status = ?'); params.push(status); }
    if (hasErrors === 'true')  { conditions.push('t.error_count > 0'); }
    if (hasErrors === 'false') { conditions.push('t.error_count = 0'); }
    if (hasReasoning === 'true')  { conditions.push('t.has_reasoning = 1'); }
    if (hasReasoning === 'false') { conditions.push('t.has_reasoning = 0'); }
    if (search) { conditions.push('t.first_message LIKE ?'); params.push(`%${search}%`); }

    if (error_category) {
      conditions.push('t.id IN (SELECT task_id FROM events WHERE error_category = ?)');
      params.push(error_category);
    }
    if (tool_name) {
      conditions.push('t.id IN (SELECT task_id FROM events WHERE tool_name = ?)');
      params.push(tool_name);
    }

    let modelJoin = '';
    if (model) {
      modelJoin = 'INNER JOIN task_models tm ON t.id = tm.task_id';
      conditions.push('tm.model_id = ?');
      params.push(model);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRow = db.prepare(`SELECT COUNT(DISTINCT t.id) as cnt FROM tasks t ${modelJoin} ${where}`).get(...params);
    const total = countRow?.cnt || 0;

    const rows = db.prepare(`
      SELECT DISTINCT t.* FROM tasks t ${modelJoin} ${where}
      ORDER BY t.start_ts DESC
      LIMIT ? OFFSET ?
    `).all(...params, parseInt(limit), offset);

    // Attach models list to each task
    const getModels = db.prepare('SELECT DISTINCT model_id, provider_id, mode FROM task_models WHERE task_id = ?');
    const tasks = rows.map(t => ({
      ...t,
      environment: tryParse(t.environment),
      models: getModels.all(t.id),
    }));

    res.json({ tasks, total, page: parseInt(page), limit: parseInt(limit) });
  });

  // GET /api/tasks/:id — full task detail
  router.get('/:id', (req, res) => {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    const models = db.prepare('SELECT DISTINCT model_id, provider_id, mode, ts FROM task_models WHERE task_id = ? ORDER BY ts').all(req.params.id);
    task.models = models;
    task.environment = tryParse(task.environment);

    res.json(task);
  });

  // GET /api/tasks/:id/events — events for timeline
  router.get('/:id/events', (req, res) => {
    const { types } = req.query;
    let query = 'SELECT * FROM events WHERE task_id = ? ORDER BY ts ASC';
    const params = [req.params.id];

    if (types) {
      const typeList = types.split(',').map(t => `'${t}'`).join(',');
      query = `SELECT * FROM events WHERE task_id = ? AND sub_type IN (${typeList}) ORDER BY ts ASC`;
    }

    const events = db.prepare(query).all(...params);
    res.json(events);
  });

  return router;
};

function tryParse(str) {
  try { return str ? JSON.parse(str) : null; } catch { return null; }
}
