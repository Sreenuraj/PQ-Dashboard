const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { PostQodeTestRunner } = require('../postqode-test/runner');
const { generateAllureHtml } = require('../postqode-test/allure-reporter');
const Database = require('better-sqlite3');

const runsBaseDir = path.resolve('./data/postqode-test-runs');

module.exports = () => {
  const router = express.Router();
  let activeRunner = null;
  let activeReport = null;
  let activeLogs = [];
  const sseClients = new Set();

  function broadcastSSE(type, data) {
    const payload = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      try {
        client.write(payload);
      } catch (e) {}
    }
  }

  // GET /api/postqode-test/targets — detect hosts and installed extensions
  router.get('/postqode-test/targets', (req, res) => {
    const targets = [];

    // Check VS Code Insiders
    const insiderBin = '/usr/local/bin/code-insiders';
    const insiderApp = '/Applications/Visual Studio Code - Insiders.app';
    const insiderExtDir = path.join(os.homedir(), '.vscode-insiders', 'extensions');
    let insiderExtVersion = null;
    if (fs.existsSync(insiderExtDir)) {
      const match = fs.readdirSync(insiderExtDir).find((d) => d.startsWith('postqode.postqode-'));
      if (match) insiderExtVersion = match.replace('postqode.postqode-', '');
    }
    targets.push({
      id: 'vscode-insiders',
      name: 'VS Code Insiders',
      isAvailable: fs.existsSync(insiderBin) || fs.existsSync(insiderApp),
      extensionInstalled: !!insiderExtVersion,
      extensionVersion: insiderExtVersion || 'Not installed',
      isDefault: true,
    });

    // Check VS Code Stable
    const stableBin = '/usr/local/bin/code';
    const stableApp = '/Applications/Visual Studio Code.app';
    const stableExtDir = path.join(os.homedir(), '.vscode', 'extensions');
    let stableExtVersion = null;
    if (fs.existsSync(stableExtDir)) {
      const match = fs.readdirSync(stableExtDir).find((d) => d.startsWith('postqode.postqode-'));
      if (match) stableExtVersion = match.replace('postqode.postqode-', '');
    }
    targets.push({
      id: 'vscode',
      name: 'VS Code Stable',
      isAvailable: fs.existsSync(stableBin) || fs.existsSync(stableApp),
      extensionInstalled: !!stableExtVersion,
      extensionVersion: stableExtVersion || 'Not installed',
      isDefault: false,
    });

    // Check Cursor
    const cursorApp = '/Applications/Cursor.app';
    const cursorBin = '/usr/local/bin/cursor';
    const cursorExtDir = path.join(os.homedir(), '.cursor', 'extensions');
    let cursorExtVersion = null;
    if (fs.existsSync(cursorExtDir)) {
      const match = fs.readdirSync(cursorExtDir).find((d) => d.startsWith('postqode.postqode-'));
      if (match) cursorExtVersion = match.replace('postqode.postqode-', '');
    }
    targets.push({
      id: 'cursor',
      name: 'Cursor',
      isAvailable: fs.existsSync(cursorApp) || fs.existsSync(cursorBin),
      extensionInstalled: !!cursorExtVersion,
      extensionVersion: cursorExtVersion || 'Not installed',
      isDefault: false,
    });

    // Check Windsurf
    const windsurfApp = '/Applications/Windsurf.app';
    const windsurfBin = '/usr/local/bin/windsurf';
    const windsurfExtDir = path.join(os.homedir(), '.windsurf', 'extensions');
    let windsurfExtVersion = null;
    if (fs.existsSync(windsurfExtDir)) {
      const match = fs.readdirSync(windsurfExtDir).find((d) => d.startsWith('postqode.postqode-'));
      if (match) windsurfExtVersion = match.replace('postqode.postqode-', '');
    }
    targets.push({
      id: 'windsurf',
      name: 'Windsurf',
      isAvailable: fs.existsSync(windsurfApp) || fs.existsSync(windsurfBin),
      extensionInstalled: !!windsurfExtVersion,
      extensionVersion: windsurfExtVersion || 'Not installed',
      isDefault: false,
    });

    res.json({ targets });
  });

  // GET /api/postqode-test/local-vsix-files — scan workspace and downloads for .vsix builds
  router.get('/postqode-test/local-vsix-files', (req, res) => {
    const vsixFiles = [];
    const searchDirs = [
      path.resolve('.'),
      path.join(os.homedir(), 'Downloads'),
      os.homedir(),
    ];

    for (const dir of searchDirs) {
      if (!fs.existsSync(dir)) continue;
      try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          if (f.endsWith('.vsix')) {
            const fullPath = path.join(dir, f);
            try {
              const stat = fs.statSync(fullPath);
              if (stat.isFile()) {
                vsixFiles.push({
                  filename: f,
                  path: fullPath,
                  size: stat.size,
                  mtime: stat.mtime,
                  dirName: path.basename(dir),
                });
              }
            } catch (e) {}
          }
        }
      } catch (e) {}
    }
    res.json({ files: vsixFiles });
  });

  // POST /api/postqode-test/pick-file-dialog — macOS native file picker dialog
  router.post('/postqode-test/pick-file-dialog', (req, res) => {
    if (process.platform !== 'darwin') {
      return res.status(400).json({ error: 'Native file dialog only supported on macOS host' });
    }
    const { exec } = require('child_process');
    const cmd = `osascript -e 'try
      set filePath to POSIX path of (choose file with prompt "Select PostQode VSIX Package:")
      return filePath
    on error
      return "CANCELED"
    end try'`;

    exec(cmd, { timeout: 30000 }, (err, stdout) => {
      if (err) return res.json({ canceled: true });
      const result = (stdout || '').trim();
      if (!result || result === 'CANCELED') return res.json({ canceled: true });
      res.json({ success: true, path: result, filename: path.basename(result) });
    });
  });

  // POST /api/postqode-test/upload-vsix — stream file upload directly to disk
  router.post('/postqode-test/upload-vsix', (req, res) => {
    const filename = req.query.filename || `postqode-upload-${Date.now()}.vsix`;
    const sanitized = path.basename(filename);
    const uploadDir = path.resolve('./data/uploads');
    fs.mkdirSync(uploadDir, { recursive: true });
    const targetPath = path.join(uploadDir, sanitized);

    const writeStream = fs.createWriteStream(targetPath);
    req.pipe(writeStream);

    writeStream.on('finish', () => {
      try {
        const stat = fs.statSync(targetPath);
        res.json({
          success: true,
          filename: sanitized,
          path: targetPath,
          size: stat.size,
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    writeStream.on('error', (err) => {
      res.status(500).json({ error: err.message });
    });
  });

  // GET /api/postqode-test/active-llm-config — detect active provider & model from PostQode state
  router.get('/postqode-test/active-llm-config', (req, res) => {
    try {
      const host = req.query.host || 'vscode-insiders';
      const isMac = process.platform === 'darwin';
      const isWin = process.platform === 'win32';
      let appDataDir = isMac
        ? path.join(os.homedir(), 'Library', 'Application Support')
        : (isWin ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming')) : path.join(os.homedir(), '.config'));

      const hostFolderMap = {
        'vscode-insiders': 'Code - Insiders',
        'vscode':          'Code',
        'cursor':          'Cursor',
        'windsurf':        'Windsurf',
      };
      const folder = hostFolderMap[host] || 'Code - Insiders';
      const dbPath = path.join(appDataDir, folder, 'User', 'globalStorage', 'state.vscdb');

      if (!fs.existsSync(dbPath)) {
        return res.json({ detected: false, provider: 'postqode', model: 'moonshotai/kimi-k3' });
      }

      const db = new Database(dbPath, { readonly: true, timeout: 2000 });
      try {
        const row = db.prepare('SELECT value FROM ItemTable WHERE key = ?').get('PostQode.postqode');
        if (row && row.value) {
          const parsed = JSON.parse(row.value);
          const provider = parsed.agentModeApiProvider || parsed.actModeApiProvider || parsed.planModeApiProvider || 'postqode';
          let model = 'moonshotai/kimi-k3';
          if (provider === 'postqode' || provider === 'openrouter' || provider === 'vercel-ai-gateway') {
            model = parsed.agentModeOpenRouterModelId || parsed.actModeOpenRouterModelId || parsed.planModeOpenRouterModelId || parsed.agentModeApiModelId || 'moonshotai/kimi-k3';
          } else if (provider === 'openai-native') {
            model = parsed.agentModeOpenAiModelId || parsed.planModeOpenAiModelId || parsed.agentModeApiModelId || 'gpt-4o';
          } else {
            model = parsed.agentModeApiModelId || parsed.agentModeOpenRouterModelId || 'moonshotai/kimi-k3';
          }
          return res.json({ detected: true, host, provider, model });
        }
      } finally {
        try { db.close(); } catch (_) {}
      }
      res.json({ detected: false, provider: 'postqode', model: 'moonshotai/kimi-k3' });
    } catch (e) {
      res.json({ detected: false, provider: 'postqode', model: 'moonshotai/kimi-k3', error: e.message });
    }
  });

  // GET /api/postqode-test/checklist — full release checklist items
  router.get('/postqode-test/checklist', (req, res) => {
    const checklistPath = path.resolve('./data/checklist-items.json');
    if (fs.existsSync(checklistPath)) {
      try {
        const data = JSON.parse(fs.readFileSync(checklistPath, 'utf8'));
        return res.json({ categories: data });
      } catch (e) {
        return res.status(500).json({ error: e.message });
      }
    }
    res.json({ categories: {} });
  });

  // GET /api/postqode-test/scenarios — available test checklist and packs grouped by Excel Sheet Name
  router.get('/postqode-test/scenarios', (req, res) => {
    const sheets = [
      {
        name: 'Install & Activation',
        description: 'Clean installation, VSIX unpacking, startup latency, and uninstallation lifecycle.',
        scenarios: [
          { id: 'INS-01', name: 'INS-01: Clean install from VSIX / Marketplace', priority: 'P0', defaultChecked: true, automatable: 'Yes' },
          { id: 'INS-02', name: 'INS-02: Startup performance & launch check', priority: 'P1', defaultChecked: true, automatable: 'Yes' },
          { id: 'INS-07', name: 'INS-07: Clean uninstall verification', priority: 'P2', defaultChecked: true, automatable: 'Yes' },
        ],
      },
      {
        name: 'GUI & Editor Integration',
        description: 'Activity bar, view title action icons, fullscreen mode & Monaco editor auto-resize, prompt controls.',
        scenarios: [
          { id: 'GUI-01', name: 'GUI-01: Activity bar click & full hydration', priority: 'P0', defaultChecked: true, automatable: 'Yes' },
          { id: 'GUI-02', name: 'GUI-02: View title navigation action icons', priority: 'P1', defaultChecked: true, automatable: 'Yes' },
          { id: 'GUI-07', name: 'GUI-07: Fullscreen mode & dynamic editor auto-resize', priority: 'P1', defaultChecked: true, automatable: 'Yes' },
          { id: 'UI-03', name: 'UI-03: Bottom prompt controls, mode dropdown & model badge', priority: 'P0', defaultChecked: true, automatable: 'Yes' },
        ],
      },
      {
        name: 'Providers & Models',
        description: 'Provider list persistence, SecretStorage security, live cloud tasks, separate modes, 401 error cards & context info.',
        scenarios: [
          { id: 'PROV-01', name: 'PROV-01: Provider list & selection persists', priority: 'P0', defaultChecked: true, automatable: 'Yes' },
          { id: 'PROV-02', name: 'PROV-02: API keys stored as secrets (not in settings.json)', priority: 'P0', defaultChecked: true, automatable: 'Yes' },
          { id: 'PROV-03', name: 'PROV-03: PostQode cloud provider task', priority: 'P0', defaultChecked: true, automatable: 'Yes', liveOnly: true, note: 'Skipped in Mocked mode' },
          { id: 'PROV-04', name: 'PROV-04: Anthropic direct key task', priority: 'P0', defaultChecked: false, automatable: 'Yes', requiresApiKey: 'anthropic', note: 'Requires API key' },
          { id: 'PROV-05', name: 'PROV-05: OpenRouter / OpenAI-compatible task', priority: 'P1', defaultChecked: false, automatable: 'Yes', requiresApiKey: 'openrouter', note: 'Requires API key' },
          { id: 'PROV-08', name: 'PROV-08: Separate Plan vs Agent model configuration', priority: 'P1', defaultChecked: true, automatable: 'Yes' },
          { id: 'PROV-09', name: 'PROV-09: Invalid key handling & error card (401)', priority: 'P0', defaultChecked: true, automatable: 'Yes' },
          { id: 'PROV-10', name: 'PROV-10: Context-window info per model (1M CTX)', priority: 'P2', defaultChecked: true, automatable: 'Yes' },
        ],
      },
      {
        name: 'Settings & Feature Flags',
        description: 'Settings panel rendering, capabilities and feature flag configuration.',
        scenarios: [
          { id: 'SET-01', name: 'SET-01: Settings panel UI inspection via UI click', priority: 'P0', defaultChecked: true, automatable: 'Yes' },
        ],
      },
      {
        name: 'MCP',
        description: 'Model Context Protocol server management view and inspection.',
        scenarios: [
          { id: 'MCP-01', name: 'MCP-01: MCP server management view inspection', priority: 'P1', defaultChecked: true, automatable: 'Yes' },
        ],
      },
      {
        name: 'Checkpoints, History & State',
        description: 'Task history drawer, session cards, dynamic token counts and cost metrics.',
        scenarios: [
          { id: 'HIST-01', name: 'HIST-01: Task history drawer UI inspection', priority: 'P1', defaultChecked: true, automatable: 'Yes' },
          { id: 'HIST-02', name: 'HIST-02: Dynamic Recent Tasks cards inspection (middle part)', priority: 'P1', defaultChecked: true, automatable: 'Yes' },
        ],
      },
      {
        name: 'Chat & Agent Mode',
        description: 'New session initialization, streaming completion, tool invocation and stream cancellation.',
        scenarios: [
          { id: 'CHAT-01', name: 'CHAT-01: New task session initialization via + button', priority: 'P0', defaultChecked: true, automatable: 'Yes' },
          { id: 'CHAT-02', name: 'CHAT-02: Streamed chat completion & incremental rendering', priority: 'P0', defaultChecked: true, automatable: 'Yes' },
          { id: 'CHAT-04', name: 'CHAT-04: Stream cancellation via UI Stop button & resilience', priority: 'P1', defaultChecked: true, automatable: 'Yes' },
        ],
      },
      {
        name: 'Files & Terminal Tools',
        description: 'Agent mode workspace file modifications, write_to_file tool execution and artifact preservation.',
        scenarios: [
          { id: 'FILE-01', name: 'FILE-01: Agent tool execution (write_to_file) & workspace mutation', priority: 'P0', defaultChecked: true, automatable: 'Yes' },
        ],
      },
      {
        name: 'Slash Commands',
        description: 'All 10 PostQode slash commands: /newtask, /compact, /init, /newrule, /globalrule, /workflow, /globalworkflow, /reportbug, /deep-planning, /explain-changes.',
        scenarios: [
          { id: 'SLASH-01', name: 'SLASH-01: /newtask (Distilled context & fresh task creation)', priority: 'P0', defaultChecked: true, automatable: 'Yes' },
          { id: 'SLASH-02', name: 'SLASH-02: /compact (Context summarization & history truncation)', priority: 'P0', defaultChecked: true, automatable: 'Yes' },
          { id: 'SLASH-03', name: 'SLASH-03: /init (Codebase analysis & AGENTS.md generation)', priority: 'P0', defaultChecked: true, automatable: 'Yes' },
          { id: 'SLASH-04', name: 'SLASH-04: /newrule (Project-specific rule creation)', priority: 'P1', defaultChecked: true, automatable: 'Yes' },
          { id: 'SLASH-05', name: 'SLASH-05: /globalrule (Global rule creation across workspaces)', priority: 'P1', defaultChecked: true, automatable: 'Yes' },
          { id: 'SLASH-06', name: 'SLASH-06: /workflow (Project workflow definition)', priority: 'P1', defaultChecked: true, automatable: 'Yes' },
          { id: 'SLASH-07', name: 'SLASH-07: /globalworkflow (Global workflow definition)', priority: 'P1', defaultChecked: true, automatable: 'Yes' },
          { id: 'SLASH-08', name: 'SLASH-08: /reportbug (Guided GitHub issue compilation)', priority: 'P1', defaultChecked: true, automatable: 'Yes' },
          { id: 'SLASH-09', name: 'SLASH-09: /deep-planning (Deep silent investigation & plan mode)', priority: 'P0', defaultChecked: true, automatable: 'Yes' },
          { id: 'SLASH-10', name: 'SLASH-10: /explain-changes (Inline git diff & change explanation)', priority: 'P1', defaultChecked: true, automatable: 'Yes' },
        ],
      },
      {
        name: 'Workflows, Rules & Skills',
        description: 'PostQode automation workflows, rules auto-injection into prompt context, custom skills engine and modal toggles.',
        scenarios: [
          { id: 'FLOW-01', name: 'FLOW-01: Workflow invocation via slash (/[workflow.md])', priority: 'P0', defaultChecked: true, automatable: 'Yes' },
          { id: 'FLOW-02', name: 'FLOW-02: Workflow enable/disable toggle in modal', priority: 'P1', defaultChecked: true, automatable: 'Yes' },
          { id: 'FLOW-03', name: 'FLOW-03: Workflow tool sequencing & ask_followup_question', priority: 'P0', defaultChecked: true, automatable: 'Yes' },
          { id: 'RULE-01', name: 'RULE-01: Project rules auto-injection into context', priority: 'P0', defaultChecked: true, automatable: 'Yes' },
          { id: 'RULE-02', name: 'RULE-02: Rule enable/disable toggle in modal', priority: 'P1', defaultChecked: true, automatable: 'Yes' },
          { id: 'SKILL-01', name: 'SKILL-01: Custom skill discovery & YAML frontmatter parsing', priority: 'P1', defaultChecked: true, automatable: 'Yes' },
          { id: 'SKILL-02', name: 'SKILL-02: Skill enable/disable toggle in modal', priority: 'P1', defaultChecked: true, automatable: 'Yes' },
          { id: 'SKILL-03', name: 'SKILL-03: Dynamic skill activation & use_skill tool validation', priority: 'P0', defaultChecked: true, automatable: 'Yes' },
        ],
      },
    ];

    const packs = [
      {
        id: 'sanity',
        name: 'Comprehensive PostQode Sanity Pack',
        description: 'End-to-end verification covering UI activation, settings, MCP, streamed chat, agent workflows, and resilience.',
        defaultSelected: true,
      },
      {
        id: 'providers',
        name: 'Providers & Models Suite',
        description: 'Automated coverage of Provider selection persistence, SecretStorage security, Plan vs Agent model configuration, 401 error cards, and context window metrics.',
        defaultSelected: false,
      },
      {
        id: 'slash',
        name: 'Slash Commands Suite',
        description: 'Automated coverage of all 10 PostQode slash commands (/newtask, /compact, /init, /newrule, /workflow, etc.) with real action buttons and disk verification.',
        defaultSelected: false,
      },
      {
        id: 'workflows',
        name: 'Workflows, Rules & Skills Suite',
        description: 'Automated coverage of PostQode automation workflows, rules auto-injection into prompt context, custom skills engine and modal toggles.',
        defaultSelected: false,
      },
    ];

    res.json({ sheets, packs });
  });

  // POST /api/postqode-test/run — launch a test run
  router.post('/postqode-test/run', (req, res) => {
    if (activeRunner && activeRunner.state === 'running') {
      return res.status(409).json({
        error: 'A test run is already currently active.',
        runId: activeRunner.runId,
      });
    }

    const {
      host = 'vscode-insiders',
      mode = 'mocked',
      buildSource = 'installed',
      localBuildPath = null,
      liveProvider = 'postqode',
      liveModel = 'moonshotai/kimi-k3',
      providerApiKeys = {},
      scenarios = (req.body && (req.body.scenarios || req.body.selectedScenarios)),
    } = req.body || {};

    const runId = `pq-run-${Date.now()}`;
    activeLogs = [];

    activeRunner = new PostQodeTestRunner({
      runId,
      host,
      mode,
      buildSource,
      localBuildPath,
      liveProvider,
      liveModel,
      providerApiKeys,
      scenarios,
    });

    activeReport = activeRunner.report;

    activeRunner.on('log', (msg) => {
      activeLogs.push(msg);
      broadcastSSE('log', { runId, message: msg });
    });

    activeRunner.on('step', (step) => {
      broadcastSSE('step', { runId, step });
    });

    activeRunner.on('stateChange', (stateData) => {
      broadcastSSE('stateChange', stateData);
    });

    activeRunner.on('done', (finalReport) => {
      activeReport = finalReport;
      broadcastSSE('done', { runId, report: finalReport });
      activeRunner = null;
    });

    activeRunner.run().catch((err) => {
      broadcastSSE('error', { runId, error: err.message });
      activeRunner = null;
    });

    res.json({
      status: 'started',
      runId,
      host,
      mode,
      buildSource,
      liveModel,
      scenarios: activeRunner.selectedScenarios,
    });
  });

  // POST /api/postqode-test/pause — pause active test run
  router.post('/postqode-test/pause', (req, res) => {
    if (!activeRunner) {
      return res.status(404).json({ error: 'No active test run to pause.' });
    }
    const success = activeRunner.pause();
    res.json({ success, status: activeRunner.state, runId: activeRunner.runId });
  });

  // POST /api/postqode-test/resume — resume active test run
  router.post('/postqode-test/resume', (req, res) => {
    if (!activeRunner) {
      return res.status(404).json({ error: 'No active test run to resume.' });
    }
    const success = activeRunner.resume();
    res.json({ success, status: activeRunner.state, runId: activeRunner.runId });
  });

  // POST /api/postqode-test/stop — stop active test run and trigger immediate teardown
  router.post('/postqode-test/stop', async (req, res) => {
    if (!activeRunner) {
      return res.status(404).json({ error: 'No active test run to stop.' });
    }
    const runId = activeRunner.runId;
    await activeRunner.stop();
    res.json({ success: true, status: 'stopped', runId, message: 'Test execution stopped and sandbox torn down.' });
  });

  // GET /api/postqode-test/active — check currently running test status
  router.get('/postqode-test/active', (req, res) => {
    if (!activeRunner) {
      return res.json({
        active: false,
        state: activeReport?.summary?.status || 'idle',
        report: activeReport,
      });
    }
    res.json({
      active: true,
      state: activeRunner.state,
      isPaused: activeRunner.isPaused,
      isStopped: activeRunner.isStopped,
      runId: activeRunner.runId,
      report: activeRunner.report,
      logs: activeLogs.slice(-50),
    });
  });

  // GET /api/postqode-test/stream — SSE live stream for test progress
  router.get('/postqode-test/stream', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(': connected to postqode test stream\n\n');

    sseClients.add(res);
    req.on('close', () => {
      sseClients.delete(res);
    });
  });

  // GET /api/postqode-test/runs — list past test runs
  router.get('/postqode-test/runs', (req, res) => {
    if (!fs.existsSync(runsBaseDir)) {
      return res.json({ runs: [] });
    }

    const runs = [];
    const entries = fs.readdirSync(runsBaseDir, { withFileTypes: true });

    for (const ent of entries) {
      if (!ent.isDirectory() || ent.name === 'latest') continue;
      const reportFile = path.join(runsBaseDir, ent.name, 'report.json');
      if (fs.existsSync(reportFile)) {
        try {
          const content = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
          runs.push({
            runId: content.runId,
            timestamp: content.timestamp,
            host: content.host,
            mode: content.mode,
            buildSource: content.buildSource || 'installed',
            postqodeVersion: content.postqodeVersion || content.environment?.postqodeVersion || '—',
            environment: content.environment,
            os: content.os || content.environment?.os,
            summary: content.summary,
            artifactsCount: (content.artifacts || []).length,
            hasLiveRecordings: !!content.hasLiveRecordings,
            capturedScenariosCount: (content.capturedScenarios || []).length,
          });
        } catch (e) {}
      }
    }

    runs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    res.json({ runs });
  });

  // GET /api/postqode-test/runs/:id — get report for specific run
  router.get('/postqode-test/runs/:id', (req, res) => {
    const reportFile = path.join(runsBaseDir, req.params.id, 'report.json');
    if (!fs.existsSync(reportFile)) {
      return res.status(404).json({ error: 'Run report not found.' });
    }

    try {
      const data = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // GET /api/postqode-test/runs/:id/screenshots/:filename — serve screenshot image
  router.get('/postqode-test/runs/:id/screenshots/:filename', (req, res) => {
    const filePath = path.join(runsBaseDir, req.params.id, 'screenshots', req.params.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Screenshot not found.' });
    }
    res.sendFile(filePath);
  });

  // GET /api/postqode-test/runs/:id/artifacts/:filename — serve preserved workspace artifact
  router.get('/postqode-test/runs/:id/artifacts/:filename', (req, res) => {
    const filePath = path.join(runsBaseDir, req.params.id, 'workspace-artifacts', req.params.filename);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'Artifact not found.' });
    }
    res.sendFile(filePath);
  });

  // GET /api/postqode-test/runs/:id/export-html — download styled HTML test execution report
  router.get('/postqode-test/runs/:id/export-html', (req, res) => {
    const reportFile = path.join(runsBaseDir, req.params.id, 'report.json');
    if (!fs.existsSync(reportFile)) {
      return res.status(404).send('Report not found');
    }
    try {
      const data = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      const passRate = data.summary.total ? Math.round((data.summary.passed / data.summary.total) * 100) : 0;
      const isPass = data.summary.failed === 0;

      let stepsHtml = '';
      for (const step of data.steps || []) {
        const isStepPass = step.status === 'passed';
        const statusBadge = isStepPass
          ? '<span style="background: rgba(35,134,54,0.2); color: #3fb950; padding: 2px 8px; border-radius: 12px; font-weight: 600; font-size: 11px;">PASSED</span>'
          : '<span style="background: rgba(248,81,73,0.2); color: #f85149; padding: 2px 8px; border-radius: 12px; font-weight: 600; font-size: 11px;">FAILED</span>';

        let shotsHtml = '';
        for (const shot of step.screenshots || []) {
          shotsHtml += `<a href="/api/postqode-test/runs/${data.runId}/screenshots/${shot}" target="_blank" style="display: inline-block; margin-right: 6px; color: #58a6ff; text-decoration: none; font-size: 11px;">📸 ${shot}</a>`;
        }

        let assertHtml = '';
        for (const a of step.assertions || []) {
          assertHtml += `<li style="color: ${a.passed ? '#8b949e' : '#f85149'}; margin-bottom: 2px;">${a.passed ? '✔' : '✖'} ${a.name}</li>`;
        }

        stepsHtml += `
          <tr style="border-bottom: 1px solid #30363d;">
            <td style="padding: 10px; font-family: monospace; color: #58a6ff; font-weight: bold;">${step.checklistId || step.id}</td>
            <td style="padding: 10px; color: #8b949e; font-size: 11px;">${step.category || 'Core'}</td>
            <td style="padding: 10px; font-weight: 600; color: #c9d1d9;">
              ${step.title || step.scenario}
              <div style="font-weight: normal; color: #8b949e; font-size: 11px; margin-top: 4px;">${step.steps || ''}</div>
            </td>
            <td style="padding: 10px; color: #8b949e; font-size: 11px;">${step.expectedResult || 'Verified without error'}</td>
            <td style="padding: 10px; font-size: 11px;">
              <ul style="margin: 0; padding-left: 14px;">${assertHtml || '<li>Execution verified</li>'}</ul>
              ${step.error ? `<div style="color: #f85149; margin-top: 4px; font-family: monospace;">${step.error}</div>` : ''}
            </td>
            <td style="padding: 10px; font-family: monospace; color: #8b949e; font-size: 11px;">${((step.durationMs || 0) / 1000).toFixed(1)}s</td>
            <td style="padding: 10px;">${statusBadge}</td>
            <td style="padding: 10px;">${shotsHtml || '<span style="color: #484f58; font-size: 11px;">None</span>'}</td>
          </tr>
        `;
      }

      const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>PostQode Release Test Report — ${data.runId}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #0d1117; color: #c9d1d9; margin: 0; padding: 24px; }
    .container { max-width: 1200px; margin: 0 auto; }
    .header { border-bottom: 1px solid #30363d; padding-bottom: 16px; margin-bottom: 24px; display: flex; justify-content: space-between; align-items: center; }
    .title h1 { margin: 0 0 6px 0; font-size: 22px; color: #f0f6fc; }
    .title p { margin: 0; color: #8b949e; font-size: 13px; }
    .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 24px; }
    .card { background: #161b22; border: 1px solid #30363d; border-radius: 6px; padding: 14px; }
    .card-label { font-size: 11px; text-transform: uppercase; color: #8b949e; margin-bottom: 4px; }
    .card-value { font-size: 20px; font-weight: bold; color: #f0f6fc; }
    table { width: 100%; border-collapse: collapse; background: #161b22; border: 1px solid #30363d; border-radius: 6px; overflow: hidden; font-size: 12px; }
    th { background: #21262d; padding: 10px; text-align: left; color: #8b949e; font-weight: 600; border-bottom: 1px solid #30363d; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="title">
        <h1>PostQode Release Checklist Test Report</h1>
        <p>Run ID: <code>${data.runId}</code> &bull; Timestamp: ${data.timestamp} &bull; Target: ${data.host}</p>
      </div>
      <div>
        <span style="font-size: 14px; padding: 6px 14px; border-radius: 20px; font-weight: bold; background: ${isPass ? 'rgba(35,134,54,0.2)' : 'rgba(248,81,73,0.2)'}; color: ${isPass ? '#3fb950' : '#f85149'};">
          ${isPass ? 'ALL TESTS PASSED' : 'TESTS FAILED'}
        </span>
      </div>
    </div>
    <div class="cards">
      <div class="card"><div class="card-label">Overall Pass Rate</div><div class="card-value" style="color: ${isPass ? '#3fb950' : '#f85149'};">${passRate}%</div></div>
      <div class="card"><div class="card-label">Passed / Total</div><div class="card-value">${data.summary.passed} / ${data.summary.total}</div></div>
      <div class="card"><div class="card-label">Build Source</div><div class="card-value" style="font-size: 16px;">${data.buildSource}</div></div>
      <div class="card"><div class="card-label">Duration</div><div class="card-value">${((data.summary.durationMs || 0) / 1000).toFixed(1)}s</div></div>
    </div>
    <table>
      <thead>
        <tr>
          <th>Test ID</th>
          <th>Category</th>
          <th>Scenario & Steps</th>
          <th>Expected Result</th>
          <th>Actual Assertions</th>
          <th>Duration</th>
          <th>Status</th>
          <th>Screenshots</th>
        </tr>
      </thead>
      <tbody>
        ${stepsHtml}
      </tbody>
    </table>
  </div>
</body>
</html>`;

      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Content-Disposition', `attachment; filename="postqode-test-report-${data.runId}.html"`);
      res.send(html);
    } catch (e) {
      res.status(500).send('Error generating report: ' + e.message);
    }
  });

  // GET /api/postqode-test/runs/:id/allure-report — interactive or standalone Allure-style test report
  router.get('/postqode-test/runs/:id/allure-report', (req, res) => {
    const runId = req.params.id;
    const runDir = path.join(runsBaseDir, runId);
    const reportFile = path.join(runDir, 'report.json');

    if (!fs.existsSync(reportFile)) {
      return res.status(404).send('Run report not found');
    }

    try {
      const reportData = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      const html = generateAllureHtml(runDir, reportData, { embedBase64: true });

      if (req.query.download === '1') {
        res.setHeader('Content-Disposition', `attachment; filename="allure-report-${runId}.html"`);
      }
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (err) {
      res.status(500).send('Error generating Allure report: ' + err.message);
    }
  });

  // GET /api/postqode-test/runs/:id/download-bundle — download zip of report, screenshots, artifacts
  router.get('/postqode-test/runs/:id/download-bundle', (req, res) => {
    const runId = req.params.id;
    const runDir = path.join(runsBaseDir, runId);
    const reportFile = path.join(runDir, 'report.json');

    if (!fs.existsSync(reportFile)) {
      return res.status(404).send('Run not found');
    }

    try {
      // Ensure index.html Allure report exists inside runDir
      const reportData = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      const html = generateAllureHtml(runDir, reportData, { embedBase64: true });
      fs.writeFileSync(path.join(runDir, 'index.html'), html, 'utf8');

      const zipName = `postqode-allure-bundle-${runId}.zip`;
      const tmpZip = path.join(os.tmpdir(), zipName);
      execSync(`cd "${runDir}" && zip -r "${tmpZip}" . -x "*.DS_Store"`, { timeout: 30000 });

      res.download(tmpZip, zipName, (err) => {
        try { fs.unlinkSync(tmpZip); } catch (e) {}
      });
    } catch (err) {
      res.status(500).send('Error creating bundle zip: ' + err.message);
    }
  });

  // GET /api/postqode-test/runs/:id/download-screenshots — download zip of all screenshots
  router.get('/postqode-test/runs/:id/download-screenshots', (req, res) => {
    const runId = req.params.id;
    const shotsDir = path.join(runsBaseDir, runId, 'screenshots');

    if (!fs.existsSync(shotsDir)) {
      return res.status(404).send('Screenshots directory not found');
    }

    try {
      const zipName = `postqode-screenshots-${runId}.zip`;
      const tmpZip = path.join(os.tmpdir(), zipName);
      execSync(`cd "${shotsDir}" && zip -r "${tmpZip}" . -x "*.DS_Store"`, { timeout: 30000 });

      res.download(tmpZip, zipName, (err) => {
        try { fs.unlinkSync(tmpZip); } catch (e) {}
      });
    } catch (err) {
      res.status(500).send('Error creating screenshots zip: ' + err.message);
    }
  });

  // POST /api/postqode-test/promote-recording — replace current mock with captured live result
  router.post('/postqode-test/promote-recording', (req, res) => {
    const { runId, scenarioId, all = false } = req.body || {};
    if (!runId) {
      return res.status(400).json({ error: 'Missing required parameter: runId' });
    }

    const runDir = path.join(runsBaseDir, runId);
    const reportFile = path.join(runDir, 'report.json');
    if (!fs.existsSync(reportFile)) {
      return res.status(404).json({ error: `Run report not found for runId: ${runId}` });
    }

    try {
      const reportData = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
      const scenariosToPromote = [];

      if (all) {
        // Collect all scenarios that have live recordings or live captures
        for (const step of reportData.steps || []) {
          if (step.hasLiveRecording || (step.liveCapture && step.liveCapture.hasRecording)) {
            scenariosToPromote.push(step.id);
          }
        }
        const liveCapturesDir = path.join(runDir, 'live-captures');
        if (fs.existsSync(liveCapturesDir)) {
          for (const ent of fs.readdirSync(liveCapturesDir)) {
            if (!scenariosToPromote.includes(ent)) scenariosToPromote.push(ent);
          }
        }
        const taskArtifactsDir = path.join(runDir, 'task-artifacts');
        if (fs.existsSync(taskArtifactsDir)) {
          for (const ent of fs.readdirSync(taskArtifactsDir)) {
            if (!scenariosToPromote.includes(ent)) scenariosToPromote.push(ent);
          }
        }
      } else if (scenarioId) {
        scenariosToPromote.push(scenarioId);
      } else {
        return res.status(400).json({ error: 'Specify scenarioId or all: true' });
      }

      if (scenariosToPromote.length === 0) {
        return res.status(400).json({ error: 'No live recordings found to promote in this test run.' });
      }

      const promoted = [];
      const baseLiveDir = path.resolve('./server/postqode-test/fixtures/live-recordings');
      fs.mkdirSync(baseLiveDir, { recursive: true });

      for (const scId of scenariosToPromote) {
        const targetDir = path.join(baseLiveDir, scId);
        fs.mkdirSync(targetDir, { recursive: true });

        // 1. Copy network_stream.json
        const srcStream = path.join(runDir, 'live-captures', scId, 'network_stream.json');
        let chunksCount = 0;
        let durationMs = 0;
        let hasStream = false;

        if (fs.existsSync(srcStream)) {
          fs.copyFileSync(srcStream, path.join(targetDir, 'network_stream.json'));
          hasStream = true;
          try {
            const rawStream = JSON.parse(fs.readFileSync(srcStream, 'utf8'));
            chunksCount = rawStream.reduce((sum, s) => sum + (Array.isArray(s.chunks) ? s.chunks.length : 0), 0);
            durationMs = rawStream.reduce((max, s) => Math.max(max, s.durationMs || 0), 0);
          } catch (e) {}
        }

        // 2. Copy task artifacts
        const srcTaskBase = path.join(runDir, 'task-artifacts', scId);
        let srcTaskId = null;
        let hasTask = false;

        if (fs.existsSync(srcTaskBase)) {
          const targetTaskDir = path.join(targetDir, 'task_artifacts');
          fs.mkdirSync(targetTaskDir, { recursive: true });

          const taskDirs = fs.readdirSync(srcTaskBase).filter((d) => {
            try { return fs.statSync(path.join(srcTaskBase, d)).isDirectory(); } catch (e) { return false; }
          });

          if (taskDirs.length > 0) {
            const latestTask = taskDirs[taskDirs.length - 1];
            srcTaskId = latestTask;
            const latestTaskDir = path.join(srcTaskBase, latestTask);
            for (const item of fs.readdirSync(latestTaskDir)) {
              const srcF = path.join(latestTaskDir, item);
              const dstF = path.join(targetTaskDir, item);
              if (fs.statSync(srcF).isFile()) {
                fs.copyFileSync(srcF, dstF);
                hasTask = true;
              }
            }
          }
        }

        // 3. Write metadata file
        const meta = {
          scenarioId: scId,
          promotedAt: new Date().toISOString(),
          sourceRunId: runId,
          sourceTaskId: srcTaskId,
          provider: reportData.liveProvider || reportData.environment?.liveProvider || 'postqode',
          model: reportData.liveModel || reportData.environment?.defaultModel || 'moonshotai/kimi-k3',
          chunksCount,
          durationMs,
          hasStream,
          hasTask,
          activeAsMock: true,
        };
        fs.writeFileSync(path.join(targetDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');
        promoted.push({ scenarioId: scId, meta });

        // Mirror alias between agent-tools and file-01
        if (scId === 'agent-tools' || scId === 'file-01') {
          const altId = scId === 'agent-tools' ? 'file-01' : 'agent-tools';
          const altDir = path.join(baseLiveDir, altId);
          try {
            fs.mkdirSync(altDir, { recursive: true });
            fs.cpSync(targetDir, altDir, { recursive: true });
          } catch (e) {}
        }

        // Update step state in report.json
        for (const step of reportData.steps || []) {
          if (step.id === scId || (scId === 'agent-tools' && step.checklistId === 'FILE-01')) {
            step.isPromoted = true;
            step.baselineMeta = meta;
          }
        }
      }

      fs.writeFileSync(reportFile, JSON.stringify(reportData, null, 2), 'utf8');

      res.json({
        success: true,
        count: promoted.length,
        promoted,
        message: `Successfully replaced mock baseline for ${promoted.length} scenario(s) with live model recording.`,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/postqode-test/live-baselines — list all active and archived live baselines
  router.get('/postqode-test/live-baselines', (req, res) => {
    const fixtureLiveDir = path.resolve('./server/postqode-test/fixtures/live-recordings');
    const legacyLiveDir = path.resolve('./data/live-recordings');

    try {
      const baselinesMap = new Map();
      const dirsToScan = [fixtureLiveDir, legacyLiveDir];

      for (const baseLiveDir of dirsToScan) {
        if (!fs.existsSync(baseLiveDir)) continue;

        for (const sc of fs.readdirSync(baseLiveDir)) {
          if (baselinesMap.has(sc)) continue; // fixtures take precedence
          const scDir = path.join(baseLiveDir, sc);
          if (!fs.statSync(scDir).isDirectory()) continue;

          const metaFile = path.join(scDir, 'meta.json');
          const streamFile = path.join(scDir, 'network_stream.json');
          const taskDir = path.join(scDir, 'task_artifacts');

          let meta = {};
          if (fs.existsSync(metaFile)) {
            try { meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); } catch (e) {}
          }

          baselinesMap.set(sc, {
            scenarioId: sc,
            hasStream: fs.existsSync(streamFile),
            hasTask: fs.existsSync(taskDir) && fs.readdirSync(taskDir).length > 0,
            promotedAt: meta.promotedAt || null,
            sourceRunId: meta.sourceRunId || null,
            sourceTaskId: meta.sourceTaskId || null,
            provider: meta.provider || 'postqode',
            model: meta.model || 'moonshotai/kimi-k3',
            chunksCount: meta.chunksCount || 0,
            durationMs: meta.durationMs || 0,
            activeAsMock: meta.activeAsMock !== false,
          });
        }
      }

      res.json({ baselines: Array.from(baselinesMap.values()) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/postqode-test/toggle-baseline — toggle activeAsMock state or revert to synthetic generator
  router.post('/postqode-test/toggle-baseline', (req, res) => {
    const { scenarioId, active } = req.body || {};
    if (!scenarioId) {
      return res.status(400).json({ error: 'Missing required parameter: scenarioId' });
    }

    let metaFile = path.resolve('./server/postqode-test/fixtures/live-recordings', scenarioId, 'meta.json');
    if (!fs.existsSync(metaFile)) {
      metaFile = path.resolve('./data/live-recordings', scenarioId, 'meta.json');
    }
    if (!fs.existsSync(metaFile)) {
      return res.status(404).json({ error: `No baseline metadata found for scenario: ${scenarioId}` });
    }

    try {
      const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
      meta.activeAsMock = typeof active === 'boolean' ? active : !meta.activeAsMock;
      meta.updatedAt = new Date().toISOString();
      fs.writeFileSync(metaFile, JSON.stringify(meta, null, 2), 'utf8');

      res.json({
        success: true,
        scenarioId,
        activeAsMock: meta.activeAsMock,
        message: meta.activeAsMock
          ? `Live recording for ${scenarioId} is now ACTIVE as mock baseline.`
          : `Live recording for ${scenarioId} is DEACTIVATED (using synthetic mock generator).`,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
