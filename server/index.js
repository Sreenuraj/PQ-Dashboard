const express = require('express');
const cors = require('cors');
const path = require('path');
const { loadConfig, saveConfig } = require('./config');
const { runParser } = require('./parser/index');
const { getDB } = require('./cache/db');

const app = express();
app.use(cors());
app.use(express.json());

let config = loadConfig();
let db = getDB(config.cache.db_path);
let parsing = false;

// ── Routes ──
const tasksRouter = require('./routes/tasks')(db);
const analyticsRouter = require('./routes/analytics')(db);

app.use('/api/tasks', tasksRouter);
app.use('/api/analytics', analyticsRouter);

// GET /api/config
app.get('/api/config', (req, res) => res.json(config));

// PUT /api/config
app.put('/api/config', (req, res) => {
  try {
    config = saveConfig(req.body);
    res.json({ ok: true, config });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/refresh — re-parse
app.post('/api/refresh', async (req, res) => {
  if (parsing) return res.json({ status: 'already_running' });
  parsing = true;
  res.json({ status: 'started' });
  try {
    await runParser(config);
  } finally {
    parsing = false;
  }
});

// GET /api/refresh/status
app.get('/api/refresh/status', (req, res) => {
  res.json({ parsing });
});

// Serve frontend static files (after build)
app.use(express.static(path.join(__dirname, '../dist')));
app.get('/{*path}', (req, res) => {
  const f = path.join(__dirname, '../dist/index.html');
  if (require('fs').existsSync(f)) res.sendFile(f);
  else res.json({ status: 'PQ Dashboard API running. Start frontend with: npm run dev' });
});

const { port } = config.server;
app.listen(port, '0.0.0.0', async () => {
  console.log(`\n🚀 PQ Dashboard server running at http://localhost:${port}\n`);
  console.log('Starting initial data parse...');
  parsing = true;
  try {
    const result = await runParser(config);
    console.log(`✅ Parse complete: ${result.processed} new, ${result.skipped} cached\n`);
  } finally {
    parsing = false;
  }
});
