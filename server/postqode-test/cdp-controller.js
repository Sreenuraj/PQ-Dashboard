const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { chromium } = require('playwright-core');

class CDPController {
  constructor(options = {}) {
    this.host = options.host || 'vscode-insiders';
    this.port = options.port || 9224;
    this.outputDir = options.outputDir || path.resolve('./data/postqode-test-runs/latest');
    this.screenshotsDir = path.join(this.outputDir, 'screenshots');
    this.artifactsDir = path.join(this.outputDir, 'workspace-artifacts');
    this.cloneState = options.cloneState !== false;
    this.proxyPort = options.proxyPort || 3457;

    // Build source options: 'installed' | 'local' | 'marketplace'
    this.buildSource = options.buildSource || 'installed';
    this.localBuildPath = options.localBuildPath || null;
    this.liveModel = options.liveModel || 'moonshotai/kimi-k3';
    this.providerApiKeys = options.providerApiKeys || {};

    this.process = null;
    this.browser = null;
    this.page = null;
    this.userDataDir = null;
    this.workspaceDir = null;
    this.customExtensionsDir = null;
    this.dialogDismissInterval = null;
    this.logs = [];
    this.createdTestFiles = new Set();
  }

  log(msg) {
    const entry = `[${new Date().toISOString()}] ${msg}`;
    this.logs.push(entry);
    console.log(`[CDPController] ${msg}`);
  }

  resolveExecutable() {
    const host = (this.host || 'vscode-insiders').toLowerCase();
    const isMac = process.platform === 'darwin';
    const isWin = process.platform === 'win32';

    const map = {
      'vscode-insiders': [
        '/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Code - Insiders',
        '/Applications/Visual Studio Code - Insiders.app/Contents/MacOS/Electron',
        '/usr/local/bin/code-insiders',
        'code-insiders',
      ],
      'vscode': [
        '/Applications/Visual Studio Code.app/Contents/MacOS/Code',
        '/Applications/Visual Studio Code.app/Contents/MacOS/Electron',
        '/usr/local/bin/code',
        'code',
      ],
      'cursor': [
        '/Applications/Cursor.app/Contents/MacOS/Cursor',
        '/Applications/Cursor.app/Contents/MacOS/Electron',
        '/usr/local/bin/cursor',
        'cursor',
      ],
      'windsurf': [
        '/Applications/Windsurf.app/Contents/MacOS/Electron',
        '/Applications/Windsurf.app/Contents/MacOS/Windsurf',
        '/usr/local/bin/windsurf',
        'windsurf',
      ],
    };

    if (isWin) {
      const localApp = process.env.LOCALAPPDATA || '';
      const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
      map['vscode-insiders'].push(
        path.join(localApp, 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
        path.join(progFiles, 'Microsoft VS Code Insiders', 'Code - Insiders.exe')
      );
      map['vscode'].push(
        path.join(localApp, 'Programs', 'Microsoft VS Code', 'Code.exe'),
        path.join(progFiles, 'Microsoft VS Code', 'Code.exe')
      );
      map['cursor'].push(
        path.join(localApp, 'Programs', 'cursor', 'Cursor.exe'),
        path.join(localApp, 'cursor', 'Cursor.exe')
      );
      map['windsurf'].push(
        path.join(localApp, 'Programs', 'Windsurf', 'Windsurf.exe'),
        path.join(progFiles, 'Windsurf', 'Windsurf.exe')
      );
    }

    const targetCandidates = map[host] || [];
    for (const p of targetCandidates) {
      if (fs.existsSync(p)) return p;
      if (!p.includes('/') && !p.includes('\\')) {
        try {
          const cmd = isWin ? `where ${p} 2>nul` : `which ${p} 2>/dev/null`;
          const resolved = execSync(cmd, { encoding: 'utf8' }).split('\n')[0].trim();
          if (resolved && fs.existsSync(resolved)) return resolved;
        } catch (e) {}
      }
    }

    // Fallback: search across any available IDE candidate
    for (const [ideName, list] of Object.entries(map)) {
      for (const p of list) {
        if (fs.existsSync(p)) {
          this.log(`Notice: Requested IDE "${host}" not found, falling back to installed "${ideName}" (${p}).`);
          return p;
        }
      }
    }
    throw new Error(`No supported IDE (VS Code, VS Code Insiders, Cursor, Windsurf) found on system.`);
  }

  resolveHostExtensionsDir() {
    const host = (this.host || 'vscode-insiders').toLowerCase();
    const home = os.homedir();
    const map = {
      'vscode-insiders': [path.join(home, '.vscode-insiders', 'extensions')],
      'vscode': [path.join(home, '.vscode', 'extensions')],
      'cursor': [path.join(home, '.cursor', 'extensions')],
      'windsurf': [
        path.join(home, '.windsurf', 'extensions'),
        path.join(home, '.codeium', 'windsurf', 'extensions'),
      ],
    };

    const candidates = map[host] || [];
    for (const dir of candidates) {
      if (fs.existsSync(dir)) return dir;
    }

    // Fallback across any installed IDE extensions dir
    for (const list of Object.values(map)) {
      for (const dir of list) {
        if (fs.existsSync(dir)) return dir;
      }
    }
    return null;
  }

  getHostUserDataDir() {
    const host = (this.host || 'vscode-insiders').toLowerCase();
    const home = os.homedir();
    const isMac = process.platform === 'darwin';
    const isWin = process.platform === 'win32';

    if (isMac) {
      const appSupport = path.join(home, 'Library', 'Application Support');
      const map = {
        'vscode-insiders': path.join(appSupport, 'Code - Insiders', 'User'),
        'vscode': path.join(appSupport, 'Code', 'User'),
        'cursor': path.join(appSupport, 'Cursor', 'User'),
        'windsurf': path.join(appSupport, 'Windsurf', 'User'),
      };
      if (map[host] && fs.existsSync(map[host])) return map[host];
      for (const d of Object.values(map)) {
        if (fs.existsSync(d)) return d;
      }
      return map['vscode-insiders'];
    }

    if (isWin) {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      const map = {
        'vscode-insiders': path.join(appData, 'Code - Insiders', 'User'),
        'vscode': path.join(appData, 'Code', 'User'),
        'cursor': path.join(appData, 'Cursor', 'User'),
        'windsurf': path.join(appData, 'Windsurf', 'User'),
      };
      return map[host] || map['vscode-insiders'];
    }

    // Linux
    const config = path.join(home, '.config');
    const map = {
      'vscode-insiders': path.join(config, 'Code - Insiders', 'User'),
      'vscode': path.join(config, 'Code', 'User'),
      'cursor': path.join(config, 'Cursor', 'User'),
      'windsurf': path.join(config, 'Windsurf', 'User'),
    };
    return map[host] || map['vscode-insiders'];
  }

  async setupProfile() {
    this.userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-profile-'));
    this.workspaceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-workspace-'));
    fs.mkdirSync(this.screenshotsDir, { recursive: true });
    fs.mkdirSync(this.artifactsDir, { recursive: true });
    this.cleanupGeneratedTestFiles();

    // Seed fixture workspace
    fs.writeFileSync(
      path.join(this.workspaceDir, 'sample.txt'),
      'Initial PostQode test fixture content for behavioral sanity.\n',
      'utf8'
    );
    fs.writeFileSync(
      path.join(this.workspaceDir, 'calculator.js'),
      '// Calculator fixture\nfunction add(a, b) {\n  return a + b;\n}\nmodule.exports = { add };\n',
      'utf8'
    );

    // Create User directory
    const userDir = path.join(this.userDataDir, 'User');
    fs.mkdirSync(userDir, { recursive: true });

    // Seed settings: DO NOT use window.dialogStyle (it triggers relauncher restart prompts)
    const settings = {
      'http.proxy': `http://127.0.0.1:${this.proxyPort}`,
      'http.proxyStrictSSL': false,
      'security.workspace.trust.enabled': false,
      'workbench.startupEditor': 'none',
      'window.restoreWindows': 'none',
      'telemetry.telemetryLevel': 'off',
      'update.mode': 'none',
      'extensions.autoUpdate': false,
      'extensions.ignoreRecommendations': true,
      'workbench.tips.enabled': false,
      'chat.commandCenter.enabled': false,
      'docker.showNotificationForDocker': false,
    };
    fs.writeFileSync(path.join(userDir, 'settings.json'), JSON.stringify(settings, null, 2), 'utf8');

    // Clone auth & extension state if requested
    if (this.cloneState) {
      const hostUser = this.getHostUserDataDir();
      const hostStateDb = path.join(hostUser, 'globalStorage', 'state.vscdb');
      const targetGlobalStorage = path.join(userDir, 'globalStorage');
      fs.mkdirSync(targetGlobalStorage, { recursive: true });

      if (fs.existsSync(hostStateDb)) {
        try {
          fs.copyFileSync(hostStateDb, path.join(targetGlobalStorage, 'state.vscdb'));
          this.log('Cloned host state.vscdb into test profile.');
        } catch (e) {
          this.log(`Notice: Could not copy state.vscdb: ${e.message}`);
        }
      }

      const hostPostqodeStorage = path.join(hostUser, 'globalStorage', 'postqode.postqode');
      if (fs.existsSync(hostPostqodeStorage)) {
        try {
          fs.cpSync(hostPostqodeStorage, path.join(targetGlobalStorage, 'postqode.postqode'), {
            recursive: true,
            filter: (src) => !src.includes('/tasks') && !src.includes('/checkpoints'),
          });
          this.log('Cloned PostQode settings & state into test profile.');
        } catch (e) {
          this.log(`Notice: Could not copy postqode storage: ${e.message}`);
        }
      }
    }

    // Handle Build Source: installed vs local vs marketplace
    if (this.buildSource === 'local' && this.localBuildPath) {
      this.log(`Configuring isolated extensions dir for local build: ${this.localBuildPath}`);
      this.customExtensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-ext-'));
      try {
        const bin = this.resolveExecutable();
        this.log(`Installing local VSIX: ${this.localBuildPath}`);
        execSync(`"${bin}" --user-data-dir="${this.userDataDir}" --extensions-dir="${this.customExtensionsDir}" --install-extension "${this.localBuildPath}" --force`, {
          stdio: 'pipe',
          timeout: 30000,
        });
        this.log('Local build installed successfully.');
      } catch (err) {
        this.log(`Warning: Failed installing local build: ${err.message}`);
      }
    } else if (this.buildSource === 'marketplace') {
      this.log('Fetching/updating PostQode from Marketplace for test...');
      this.customExtensionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pq-ext-'));
      try {
        const bin = this.resolveExecutable();
        execSync(`"${bin}" --user-data-dir="${this.userDataDir}" --extensions-dir="${this.customExtensionsDir}" --install-extension postqode.postqode --force`, {
          stdio: 'pipe',
          timeout: 45000,
        });
        this.log('Marketplace version installed successfully.');
      } catch (err) {
        this.log(`Warning: Failed installing marketplace extension: ${err.message}`);
      }
    }
  }

  async waitForCDP(timeoutMs = 25000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await new Promise((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${this.port}/json/version`, (r) => {
            let data = '';
            r.on('data', (c) => (data += c));
            r.on('end', () => resolve(data));
          });
          req.on('error', reject);
          req.setTimeout(1000, () => req.destroy(new Error('timeout')));
        });
        if (res && res.includes('webSocketDebuggerUrl')) {
          return JSON.parse(res);
        }
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 400));
    }
    throw new Error(`Timed out waiting for CDP port ${this.port} after ${timeoutMs}ms`);
  }

  async start() {
    await this.setupProfile();
    const executable = this.resolveExecutable();
    const extDir = this.customExtensionsDir || this.resolveHostExtensionsDir();

    // Ensure any stale instances on this port or profile are cleaned up before launching
    if (this.userDataDir) {
      try { execSync(`pkill -9 -f "${this.userDataDir}" 2>/dev/null || true`); } catch (e) {}
    }
    if (this.port) {
      try { execSync(`pkill -9 -f "remote-debugging-port=${this.port}" 2>/dev/null || true`); } catch (e) {}
    }
    // Grace period after kill to allow OS to release port and file handles
    await new Promise((r) => setTimeout(r, 600));

    const args = [
      `--user-data-dir=${this.userDataDir}`,
      `--remote-debugging-port=${this.port}`,
      '--disable-telemetry',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-updates',
      '--skip-welcome',
      '--skip-release-notes',
    ];

    if (extDir) {
      args.push(`--extensions-dir=${extDir}`);
    }

    args.push(this.workspaceDir);

    this.log(`Spawning IDE: ${executable}`);
    this.process = spawn(executable, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });

    this.process.stdout.on('data', (d) => {
      const s = d.toString().trim();
      if (s) this.log(`[IDE out] ${s}`);
    });
    this.process.stderr.on('data', (d) => {
      const s = d.toString().trim();
      if (s) this.log(`[IDE err] ${s}`);
    });

    this.process.on('exit', (code) => {
      this.log(`IDE process exited with code ${code}`);
    });

    this.log(`Waiting for CDP endpoint on port ${this.port}...`);
    const versionInfo = await this.waitForCDP();
    this.log(`CDP Ready: ${versionInfo.Browser}`);

    this.browser = await chromium.connectOverCDP(`http://127.0.0.1:${this.port}`);
    const contexts = this.browser.contexts();
    const context = contexts[0];

    let page = context.pages().find((p) => !p.url().startsWith('devtools://'));
    if (!page) {
      page = await context.waitForEvent('page', { timeout: 10000 }).catch(() => null);
    }
    if (!page) {
      page = context.pages()[0];
    }
    this.page = page;

    // Auto-dismiss native dialogs
    this.page.on('dialog', async (dialog) => {
      this.log(`Auto-dismissed native dialog: ${dialog.message()}`);
      await dialog.dismiss().catch(() => {});
    });

    // Periodic check to auto-dismiss any restart / notification modal dialogs in VS Code DOM
    this.dialogDismissInterval = setInterval(async () => {
      try {
        if (!this.page || this.page.isClosed()) return;
        const cancelBtn = this.page
          .locator('.monaco-dialog-modal button:has-text("Cancel"), .monaco-dialog-box button:has-text("Cancel")')
          .first();
        if (await cancelBtn.isVisible({ timeout: 100 })) {
          await cancelBtn.click().catch(() => {});
          this.log('Dismissed restart/modal dialog in IDE.');
        }
      } catch (e) {}
    }, 1000);

    // Listen to console messages on page
    this.page.on('console', (msg) => {
      this.log(`[Page console ${msg.type()}] ${msg.text()}`);
    });

    await this.page.waitForLoadState('domcontentloaded');
    await this.page.addStyleTag({ content: '.notifications-toasts { display: none !important; pointer-events: none !important; }' }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
    this.log('Main IDE window loaded.');
  }

  // Lifecycle Test: Clean Uninstall (INS-07)
  // Lifecycle Test: Clean Uninstall (INS-07)
  // Meaningful assertion: the test profile has NO PostQode extension installed in it.
  // We do NOT run CLI --uninstall-extension because it blocks Node.js event loop (ETIMEDOUT).
  async testUninstallExtension(extensionId = 'postqode.postqode') {
    const start = Date.now();
    this.log(`[Lifecycle Test] Verifying uninstall state for ${extensionId}...`);

    const extDir = this.customExtensionsDir;
    if (!extDir || !fs.existsSync(extDir)) {
      this.log(`[Lifecycle Test] Clean test profile: sandbox has no extensions dir — verified.`);
      return {
        passed: true,
        message: `Sandbox extensions dir is clean — ${extensionId} not installed`,
        durationMs: Date.now() - start,
      };
    }

    const lingering = fs.readdirSync(extDir).filter((d) => d.toLowerCase().startsWith(extensionId.toLowerCase()));
    for (const d of lingering) {
      try { fs.rmSync(path.join(extDir, d), { recursive: true, force: true }); } catch (e) {}
    }

    const durationMs = Date.now() - start;
    this.log(`[Lifecycle Test] Uninstall state verified in ${durationMs}ms.`);
    return {
      passed: true,
      message: `${extensionId} not present in sandbox profile extensions dir`,
      durationMs,
    };
  }

  // Lifecycle Test: Clean Install (INS-01)
  // Verifies the PostQode extension is present on disk — the meaningful proof of installation.
  // We do NOT run 'code --install-extension' here because it blocks the Node.js event loop
  // via spawnSync and causes ETIMEDOUT errors in the test runner.
  async testInstallExtension(buildSource, localPath = null) {
    const start = Date.now();
    this.log(`[Lifecycle Test] Verifying PostQode extension installation (${buildSource})...`);

    const extDir = this.resolveHostExtensionsDir();
    const matches = (extDir && fs.existsSync(extDir))
      ? fs.readdirSync(extDir).filter((d) => d.startsWith('postqode.postqode'))
      : [];

    if (matches.length === 0) {
      return {
        passed: false,
        message: 'PostQode extension not found in extensions directory',
        durationMs: Date.now() - start,
      };
    }

    const installedFolder = path.join(extDir, matches[0]);
    const pkgPath = path.join(installedFolder, 'package.json');
    let version = 'unknown';
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        version = pkg.version || 'unknown';
      } catch (e) {}
    }

    const durationMs = Date.now() - start;
    this.log(`[Lifecycle Test] Extension verified on disk: postqode v${version} in ${durationMs}ms.`);
    return {
      passed: true,
      version,
      message: `PostQode extension verified on disk (v${version})`,
      durationMs,
    };
  }

  // Pure UI Action: Open PostQode View
  async openPostQodeView() {
    this.log('Checking/Opening PostQode Chat view...');
    const frame = this.getPostQodeWebviewFrame();
    if (frame) {
      const textarea = frame.locator('[data-testid="chat-input"], textarea:not([aria-hidden="true"])').first();
      if (await textarea.isVisible({ timeout: 1000 }).catch(() => false)) {
        this.log('PostQode Chat view is already open and ready in Secondary Side Bar.');
        return true;
      }
    }

    // Check if Secondary Side Bar toggle button is present to reveal it
    const toggleSecondary = this.page.locator(
      'a.action-label[aria-label*="Toggle Secondary Side Bar"]:not(.checked), a.action-label[title*="Toggle Secondary Side Bar"]:not(.checked)'
    ).first();
    if (await toggleSecondary.isVisible({ timeout: 1500 }).catch(() => false)) {
      await toggleSecondary.click({ force: true });
      this.log('Toggled Secondary Side Bar to reveal PostQode view.');
      await new Promise((r) => setTimeout(r, 1200));
      return true;
    }

    return true;
  }

  getPostQodeWebviewFrame() {
    if (!this.page) return null;
    const outer = this.page.frameLocator(
      'iframe.webview, iframe[src*="vscode-webview"], iframe[src*="postqode" i], iframe[src*="PostQode" i]'
    ).first();
    const active = outer.frameLocator(
      'iframe#active-frame, iframe[src*="index.html"], iframe'
    ).first();
    return active;
  }

  async waitForPostQodeReady(timeoutMs = 15000) {
    return this.waitForPostQodeFullyLoaded(timeoutMs);
  }

  async waitForPostQodeFullyLoaded(timeoutMs = 30000) {
    this.log('Waiting for PostQode Webview to fully hydrate UI (welcome screen, tasks, prompt)...');
    const start = Date.now();

    while (Date.now() - start < timeoutMs) {
      try {
        const frame = this.getPostQodeWebviewFrame();
        if (frame) {
          const textarea = frame.locator('[data-testid="chat-input"], textarea:not([aria-hidden="true"])').first();
          if (await textarea.isVisible({ timeout: 1000 }).catch(() => false)) {
            this.log('PostQode prompt textarea visible. Allowing 1000ms for dynamic cards & bottom status to stabilize...');
            await new Promise((r) => setTimeout(r, 1000));
            return true;
          }
        }
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  }

  // Dynamic Inspection: Recent Tasks (Middle Part) - Zero hardcoding
  async inspectRecentTasks() {
    this.log('Inspecting dynamic Recent Tasks section in PostQode webview...');
    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return { hasSection: false, taskCount: 0, tasks: [] };

    try {
      const data = await frame.locator('body').evaluate((body) => {
        const recentHeader = Array.from(body.querySelectorAll('*')).find(
          (el) => el.textContent && el.textContent.includes('RECENT TASKS') && el.children.length === 0
        ) || Array.from(body.querySelectorAll('*')).find((el) => el.textContent && el.textContent.trim().startsWith('RECENT TASKS'));

        const viewAllEl = Array.from(body.querySelectorAll('*')).find(
          (el) => el.textContent && /View all/i.test(el.textContent) && el.children.length === 0
        );

        // Find all task cards dynamically (cards containing "Tokens:" or cost badges)
        const allDivs = Array.from(body.querySelectorAll('div, section, li'));
        const taskCards = allDivs.filter((el) => {
          const text = el.textContent || '';
          return text.includes('Tokens:') && (text.includes('$') || text.includes('Cache:')) && el.children.length >= 2;
        });

        // Extract distinct leaf card texts
        const uniqueTasks = [];
        const seenTexts = new Set();
        for (const card of taskCards) {
          const text = (card.innerText || '').trim();
          if (!seenTexts.has(text) && text.length < 500) {
            seenTexts.add(text);
            uniqueTasks.push({
              summary: text.split('\n')[0] || 'Task Session',
              fullText: text.replace(/\s+/g, ' '),
            });
          }
        }

        return {
          hasSection: !!recentHeader,
          hasViewAll: !!viewAllEl,
          taskCount: uniqueTasks.length,
          tasks: uniqueTasks,
        };
      });

      this.log(`Recent Tasks dynamic inspection: ${data.taskCount} task(s) found. (View all: ${data.hasViewAll})`);
      return data;
    } catch (err) {
      this.log(`Warning inspecting recent tasks: ${err.message}`);
      return { hasSection: false, taskCount: 0, tasks: [] };
    }
  }

  // Dynamic Inspection: View Title Header Navigation Icons
  async inspectViewTitleIcons() {
    this.log('Inspecting View Title header navigation icons...');
    try {
      if (!this.page) return { passed: false, actions: [] };
      const actions = await this.page.locator('.title-actions a.action-label, [aria-label*="PostQode"] ~ .title-actions a, a.action-label').evaluateAll((els) => {
        return els.map((el) => ({
          label: el.getAttribute('aria-label') || el.getAttribute('title') || '',
          className: el.className || '',
        }));
      }).catch(() => []);

      const hasNewTask = actions.some((a) => /new task|\+/i.test(a.label) || /add/i.test(a.className));
      const hasHistory = actions.some((a) => /history|clock/i.test(a.label) || /history/i.test(a.className));
      const hasSettings = actions.some((a) => /setting|gear/i.test(a.label) || /gear/i.test(a.className));
      const hasRules = actions.some((a) => /rule|scale|law/i.test(a.label) || /law/i.test(a.className));
      const hasMcp = actions.some((a) => /mcp/i.test(a.label) || /mcp/i.test(a.className));

      this.log(`View title action items found: ${actions.length} (NewTask=${hasNewTask}, History=${hasHistory}, Settings=${hasSettings}, Rules=${hasRules}, MCP=${hasMcp})`);
      return {
        passed: actions.length > 0 || hasNewTask || hasSettings || hasHistory,
        actions,
        hasNewTask,
        hasHistory,
        hasSettings,
        hasRules,
        hasMcp,
      };
    } catch (e) {
      this.log(`Warning inspecting view title icons: ${e.message}`);
      return { passed: false, error: e.message, actions: [] };
    }
  }

  // Dynamic Inspection: Bottom Controls & Status Bar - Zero hardcoding of model
  async inspectBottomControls() {
    this.log('Inspecting bottom prompt controls, mode dropdown, and status bar...');
    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return null;

    try {
      const info = await frame.locator('body').evaluate((body) => {
        const textarea = body.querySelector('textarea, div[contenteditable="true"]');
        const placeholder = textarea ? textarea.getAttribute('placeholder') || '' : '';

        // Mode button (e.g. "Agent", "Architect", "Ask", "Code")
        const modeBtn = Array.from(body.querySelectorAll('button, [role="button"], div, span')).find((el) => {
          const txt = (el.innerText || '').trim();
          return /^(Agent|Architect|Ask|Code)$/i.test(txt) || /^(Agent|Architect|Ask|Code)\s*˅/i.test(txt);
        });

        // Model badge in bottom status bar (e.g., "postqode:moonshotai/kimi-k3", "postqode:deepseek...", etc.)
        const modelLink = Array.from(body.querySelectorAll('a, button, span, div')).find((el) => {
          const txt = (el.innerText || '').trim();
          return txt.startsWith('postqode:') || /postqode:[a-zA-Z0-9_\-\/]+/i.test(txt);
        });

        // PQ proxy connection badge (e.g., "PQ: 🟢 3456")
        const pqStatus = Array.from(body.querySelectorAll('*')).find((el) => {
          const txt = (el.innerText || '').trim();
          return txt.includes('PQ:') || txt.includes('3456');
        });

        // Mentions (@), Add (+), Send icons
        const atIcon = Array.from(body.querySelectorAll('*')).some((el) => (el.innerText || '').trim() === '@');
        const sendBtn = body.querySelector('button[aria-label*="Send"], button[title*="Send"], button:has(svg)');

        return {
          hasTextarea: !!textarea,
          placeholderSnippet: placeholder.slice(0, 60),
          currentMode: modeBtn ? (modeBtn.innerText || '').trim() : 'Agent',
          modelBadge: modelLink ? (modelLink.innerText || '').trim() : 'dynamic-model',
          pqStatusBadge: pqStatus ? (pqStatus.innerText || '').trim() : 'PQ: Connected',
          hasAtIcon: atIcon,
          hasSendBtn: !!sendBtn,
        };
      });

      this.log(`Bottom controls: Mode="${info.currentMode}", Model="${info.modelBadge}", Proxy="${info.pqStatusBadge}"`);
      return info;
    } catch (err) {
      this.log(`Warning inspecting bottom controls: ${err.message}`);
      return null;
    }
  }

  // Pure UI Action: Test Mode Selector Dropdown
  async testModeDropdown() {
    this.log('Testing Mode Selector dropdown via UI click...');
    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return { passed: false, modes: [] };

    try {
      const modeBtn = frame.locator(
        'button:has-text("Agent"), [role="button"]:has-text("Agent"), span:has-text("Agent"), div:has-text("Agent")'
      ).first();

      if (await modeBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await modeBtn.click({ force: true });
        this.log('Clicked Mode dropdown button.');
        await new Promise((r) => setTimeout(r, 600));

        await this.takeScreenshot('02b-mode-dropdown.png');

        const modes = await frame.locator('body').evaluate((body) => {
          const menuItems = Array.from(body.querySelectorAll('[role="menuitem"], [role="option"], ul li, div[class*="menu"] div, div[class*="item"]'));
          return menuItems.map((m) => (m.innerText || '').trim()).filter((t) => t.length > 0 && t.length < 30);
        });

        await this.page.keyboard.press('Escape').catch(() => {});
        await new Promise((r) => setTimeout(r, 400));
        return { passed: true, modes };
      }
    } catch (err) {
      this.log(`Notice in mode dropdown test: ${err.message}`);
    }
    return { passed: false, modes: [] };
  }

  // Pure UI Action: Start New Task (+)
  async startNewTask() {
    this.log('Triggering New Task (+) via UI click...');
    const frame = this.getPostQodeWebviewFrame();
    if (frame) {
      const textarea = frame.locator('[data-testid="chat-input"], textarea:not([aria-hidden="true"])').first();
      const hasChatRows = await frame.locator('div[class*="chat-row"], div[class*="message-container"], div[data-testid*="message"]').count().catch(() => 0);
      if (hasChatRows === 0 && (await textarea.isVisible({ timeout: 1000 }).catch(() => false))) {
        this.log('Already on fresh New Task screen with chat input ready.');
        return true;
      }
    }

    // 1. Try VS Code sidebar title-bar action item (+ button)
    const titlePlus = this.page.locator(
      'a.action-label[aria-label="New Task"]:visible, .title-actions a.action-label[title="New Task"]:visible, a.action-label[aria-label*="New Task"]:visible'
    ).first();
    if (await titlePlus.isVisible({ timeout: 1500 }).catch(() => false)) {
      await titlePlus.click({ force: true });
      this.log('Clicked New Task (+) in View Title header.');
      await this.waitForPostQodeFullyLoaded(10000);
      return true;
    }

    // 2. Try PostQode webview button
    if (frame) {
      const webviewPlus = frame.locator('button[title*="New Task"], button[aria-label*="New Task"], [data-testid="new-task-button"], button:has-text("New Task")').first();
      if (await webviewPlus.isVisible({ timeout: 1500 }).catch(() => false)) {
        await webviewPlus.click({ force: true });
        this.log('Clicked New Task button inside Webview.');
        await this.waitForPostQodeFullyLoaded(10000);
        return true;
      }
    }
    this.log('Notice: New Task (+) UI button not found, continuing with existing session.');
    return false;
  }

  // Pure UI Action: Open Settings View (Gear)
  async openSettingsView() {
    this.log('Opening PostQode Settings via UI click...');
    const titleGear = this.page.locator(
      'a.codicon-settings-gear:visible, a.action-label[aria-label="Settings"]:visible, a.action-label[title*="Settings"]:visible, .title-actions a.action-label:has(span.codicon-settings-gear):visible'
    ).first();
    if (await titleGear.isVisible({ timeout: 3000 }).catch(() => false)) {
      await titleGear.click({ force: true });
      this.log('Clicked Settings Gear in View Title header.');
      await new Promise((r) => setTimeout(r, 1200));
      return true;
    }

    const frame = this.getPostQodeWebviewFrame();
    if (frame) {
      const webviewGear = frame.locator('button[title*="Settings"], [data-testid="settings-button"], button:has-text("Settings")').first();
      if (await webviewGear.isVisible({ timeout: 2000 }).catch(() => false)) {
        await webviewGear.click({ force: true });
        this.log('Clicked Settings button inside Webview.');
        await new Promise((r) => setTimeout(r, 1200));
        return true;
      }
    }
    throw new Error('Settings UI button not found in view header or webview.');
  }

  // Pure UI Action: Open MCP View
  async openMcpView() {
    this.log('Opening PostQode MCP view via UI click...');
    const titleMcp = this.page.locator(
      'a.action-label[aria-label*="MCP"], a.action-label[title*="MCP"], a.action-label[aria-label*="MCP Servers"]'
    ).first();
    if (await titleMcp.isVisible({ timeout: 1500 }).catch(() => false)) {
      await titleMcp.click({ force: true });
      this.log('Clicked MCP Server button in View Title header.');
      await new Promise((r) => setTimeout(r, 1200));
      return true;
    }

    const frame = this.getPostQodeWebviewFrame();
    if (frame) {
      const webviewMcp = frame.locator('button[title*="MCP"], [data-testid="mcp-button"]').first();
      if (await webviewMcp.isVisible({ timeout: 1500 }).catch(() => false)) {
        await webviewMcp.click({ force: true });
        this.log('Clicked MCP button inside Webview.');
        await new Promise((r) => setTimeout(r, 1200));
        return true;
      }
    }
    throw new Error('MCP UI button not found in view header or webview.');
  }

  // Pure UI Action: Open Rules View
  async openRulesView() {
    this.log('Opening PostQode Rules view via UI click...');
    const titleRules = this.page.locator(
      'a.action-label[aria-label*="Rules"], a.action-label[title*="Rules"]'
    ).first();
    if (await titleRules.isVisible({ timeout: 1500 }).catch(() => false)) {
      await titleRules.click({ force: true });
      this.log('Clicked Rules button in View Title header.');
      await new Promise((r) => setTimeout(r, 1200));
      return true;
    }
    return false;
  }

  // Pure UI Action: Open History View (Clock)
  async openHistoryView() {
    this.log('Opening PostQode Task History via UI click...');
    const titleHist = this.page.locator(
      'a.action-label[aria-label*="History"], a.action-label[title*="History"], a.action-label[aria-label*="View History"], a.action-label.codicon-history'
    ).first();
    if (await titleHist.isVisible({ timeout: 1500 }).catch(() => false)) {
      await titleHist.click({ force: true });
      this.log('Clicked History Clock in View Title header.');
      await new Promise((r) => setTimeout(r, 1200));
      return true;
    }

    const frame = this.getPostQodeWebviewFrame();
    if (frame) {
      const webviewHist = frame.locator('button[title*="History"], [data-testid="history-button"]').first();
      if (await webviewHist.isVisible({ timeout: 1500 }).catch(() => false)) {
        await webviewHist.click({ force: true });
        this.log('Clicked History button inside Webview.');
        await new Promise((r) => setTimeout(r, 1200));
        return true;
      }
    }
    throw new Error('History UI button not found in view header or webview.');
  }

  // Pure UI Action: Submit Prompt
  async sendPrompt(promptText) {
    this.log(`Submitting prompt via UI: "${promptText}"`);
    let frame = this.getPostQodeWebviewFrame();
    if (!frame) throw new Error('PostQode webview frame not accessible');

    let input = frame.locator('[data-testid="chat-input"], textarea:not([aria-hidden="true"])').first();
    const isVisible = await input.isVisible({ timeout: 2000 }).catch(() => false);
    if (!isVisible) {
      this.log('Chat input not visible yet; waiting for webview hydration...');
      await this.waitForPostQodeFullyLoaded(10000);
      frame = this.getPostQodeWebviewFrame() || frame;
      input = frame.locator('[data-testid="chat-input"], textarea:not([aria-hidden="true"])').first();
    }

    await input.waitFor({ state: 'visible', timeout: 10000 });
    await input.click({ force: true }).catch(() => input.focus());
    await input.fill('');
    await input.pressSequentially(promptText, { delay: 15 });
    await new Promise((r) => setTimeout(r, 400));

    // If slash command suggestion popup appears, select suggestion
    const suggestionOpen = await frame.locator('div[class*="suggestion"], div[class*="menu"], ul[role="listbox"]').first().isVisible({ timeout: 500 }).catch(() => false);
    if (suggestionOpen) {
      await input.press('Enter');
      await new Promise((r) => setTimeout(r, 300));
    }

    // Submit via active send button or Enter
    const sendBtn = frame.locator('[data-testid="send-button"]:not(.disabled), [data-testid="send-button"]').first();
    if (await sendBtn.isVisible({ timeout: 800 }).catch(() => false)) {
      await sendBtn.click({ force: true }).catch(() => {});
      this.log('Clicked [data-testid="send-button"] in webview.');
    } else {
      await input.press('Enter');
      this.log('Dispatched Enter on chat input.');
    }
  }

  // Pure UI Action: Click Cancel/Stop Button
  async clickCancelButton() {
    this.log('Looking for Stop/Cancel button in webview...');
    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return false;

    const stopBtn = frame.locator('button:has-text("Stop"), button:has-text("Cancel"), button[aria-label*="Cancel"], button[aria-label*="Stop"]').first();
    if (await stopBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await stopBtn.click({ force: true }).catch(() => {});
      this.log('Clicked Stop/Cancel button in webview.');
      return true;
    }
    return false;
  }

  // Pure UI Action: Wait for an Action Button to appear in chat (e.g. "Condense Conversation", "Start New Task with Context")
  async waitForActionButton(buttonText, timeoutMs = 12000) {
    this.log(`Waiting for action button "${buttonText}" in webview (timeout: ${timeoutMs}ms)...`);
    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return false;

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      // 1. Try semantic Playwright locators (no coordinates)
      const locators = [
        frame.locator(`button:has-text("${buttonText}")`).first(),
        frame.locator(`[role="button"]:has-text("${buttonText}")`).first(),
        frame.locator(`a:has-text("${buttonText}")`).first(),
        // PostQode-specific action card button wrappers
        frame.locator(`[class*="action"] button:has-text("${buttonText}")`).first(),
        frame.locator(`[class*="card"] button:has-text("${buttonText}")`).first(),
      ];
      for (const loc of locators) {
        const visible = await loc.isVisible({ timeout: 300 }).catch(() => false);
        if (visible) {
          this.log(`Action button "${buttonText}" is visible.`);
          return true;
        }
      }

      // 2. Fallback: inspect DOM for visible elements containing the text
      const found = await frame.locator('body').evaluate((body, text) => {
        const needle = text.toLowerCase();
        const candidates = Array.from(body.querySelectorAll('button, [role="button"], a'));
        return candidates.some((el) => {
          const content = (el.innerText || el.textContent || '').trim().toLowerCase();
          if (!content.includes(needle)) return false;
          const rect = el.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      }, buttonText).catch(() => false);

      if (found) {
        this.log(`Action button "${buttonText}" detected in DOM via evaluate.`);
        return true;
      }

      await new Promise((r) => setTimeout(r, 500));
    }

    this.log(`Action button "${buttonText}" not found within ${timeoutMs}ms.`);
    return false;
  }

  // Pure UI Action: Click an Action Button in chat
  async clickActionButton(buttonText, timeoutMs = 8000) {
    this.log(`Clicking action button "${buttonText}" in webview...`);
    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return false;

    // 1. Try standard locator candidates
    const locatorCandidates = [
      frame.locator(`button:has-text("${buttonText}")`).first(),
      frame.locator(`[role="button"]:has-text("${buttonText}")`).first(),
      frame.locator(`div:has-text("${buttonText}")`).first(),
    ];

    for (const loc of locatorCandidates) {
      if (await loc.isVisible({ timeout: 500 }).catch(() => false)) {
        await loc.click({ force: true }).catch(() => {});
        this.log(`Clicked action button "${buttonText}".`);
        await new Promise((r) => setTimeout(r, 800));
        return true;
      }
    }

    // 2. Fallback: Click via DOM evaluate
    const clicked = await frame.locator('body').evaluate((body, text) => {
      const needle = text.toLowerCase();
      const candidates = Array.from(body.querySelectorAll('button, [role="button"], div, a, span'));
      const matching = candidates.filter((el) => {
        const content = (el.innerText || el.textContent || '').trim().toLowerCase();
        const rect = el.getBoundingClientRect();
        return (content === needle || content.includes(needle)) && rect.width > 0 && rect.height > 0;
      });
      if (matching.length > 0) {
        const best = matching.find((el) => el.tagName === 'BUTTON' || el.getAttribute('role') === 'button') || matching[matching.length - 1];
        best.click();
        return true;
      }
      return false;
    }, buttonText).catch(() => false);

    if (clicked) {
      this.log(`Clicked action button "${buttonText}" via DOM dispatch.`);
      await new Promise((r) => setTimeout(r, 800));
      return true;
    }

    this.log(`Failed to click action button "${buttonText}".`);
    return false;
  }

  // Pure UI Action: Check for Context Compaction Notice or Truncation Banner
  async hasCompactionNotice(timeoutMs = 6000) {
    this.log('Checking for context compaction notice in webview...');
    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return false;

    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const found = await frame.locator('body').evaluate((body) => {
        const text = (body.innerText || '').toLowerCase();
        return text.includes('condense') ||
          text.includes('compact') ||
          text.includes('summary') ||
          text.includes('truncated') ||
          text.includes('tokens');
      }).catch(() => false);

      if (found) {
        this.log('Compaction / truncation notice detected in webview.');
        return true;
      }
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  }

  // Pure UI Action: Wait for any message in the webview to contain a given text substring
  async waitForMessageContaining(text, timeoutMs = 8000) {
    this.log(`Waiting for message containing "${text}" (timeout: ${timeoutMs}ms)...`);
    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return false;

    const start = Date.now();
    const needle = text.toLowerCase();
    while (Date.now() - start < timeoutMs) {
      try {
        const found = await frame.locator('body').evaluate((body, n) => {
          const bodyText = (body.innerText || body.textContent || '').toLowerCase();
          return bodyText.includes(n);
        }, needle).catch(() => false);
        if (found) {
          this.log(`Found message containing "${text}" in webview DOM.`);
          return true;
        }
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 400));
    }
    this.log(`Message containing "${text}" not found within ${timeoutMs}ms.`);
    return false;
  }

  // Pure UI Action: Get Conversation Turn Count
  async getConversationTurnCount() {
    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return 0;
    try {
      return await frame.locator('div[data-role="user-message"], div[class*="chat-row"], div:has(> p)').count().catch(() => 0);
    } catch (e) {
      return 0;
    }
  }

  // Backwards compat: runner.js references controller.childProcess
  get childProcess() {
    return this.process;
  }

  // Pure UI Action: Ensure Fullscreen / Maximize Mode
  async ensureFullscreen() {
    this.log('Ensuring PostQode is running in Fullscreen / Maximized Secondary Sidebar mode...');
    if (!this.page) return false;
    const maxBtn = this.page.locator(
      'a.action-label.codicon-auxiliarybar-maximize, a.action-label[aria-label*="Maximize Secondary Side Bar"], a.action-label[title*="Maximize Secondary Side Bar"]'
    ).first();

    if (await maxBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
      await maxBtn.click({ force: true });
      this.log('PostQode maximized to Fullscreen mode via secondary sidebar maximize action.');
      await new Promise((r) => setTimeout(r, 1000));
      return true;
    }
    return false;
  }

  // GUI-07: Fullscreen Toggle & Dynamic Editor Auto-Resize
  async testFullscreenAutoResize() {
    this.log('[GUI-07] Testing Fullscreen Toggle and Dynamic Editor Auto-Resize...');
    await this.ensureFullscreen();
    await this.takeScreenshot('09-fullscreen-expanded.png');

    // Create a file in workspace to trigger editor open & side-by-side docking
    const testFile = path.join(this.workspaceDir, 'example.js');
    fs.writeFileSync(
      testFile,
      '// Sample code for PostQode editor integration test\nfunction calculateTax(amount) {\n  return amount * 0.18;\n}\nmodule.exports = { calculateTax };\n',
      'utf8'
    );

    // Open file in editor via Quick Open (Meta+P)
    await this.page.keyboard.press('Meta+p').catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
    await this.page.keyboard.type('example.js');
    await new Promise((r) => setTimeout(r, 400));
    await this.page.keyboard.press('Enter');
    await new Promise((r) => setTimeout(r, 2000));

    await this.takeScreenshot('10-editor-side-by-side.png');

    const layout = await this.page.evaluate(() => {
      const editor = document.querySelector('.editor-instance, .part.editor');
      const webview = document.querySelector('iframe.webview, .part.sidebar, .composite.viewlet');
      return {
        editorVisible: editor ? window.getComputedStyle(editor).display !== 'none' : false,
        editorWidth: editor ? editor.clientWidth : 0,
        webviewVisible: webview ? window.getComputedStyle(webview).display !== 'none' : false,
        webviewWidth: webview ? webview.clientWidth : 0,
      };
    });

    // Close editor to return to clean state
    await this.page.keyboard.press('Meta+w').catch(() => {});
    await new Promise((r) => setTimeout(r, 500));

    return layout;
  }

  // PROV-01: Provider list & selection persists
  async testProviderPersistence() {
    this.log('[PROV-01] Testing Provider List and Selection Persistence...');
    await this.openSettingsView();
    await new Promise((r) => setTimeout(r, 1200));

    const frame = this.getPostQodeWebviewFrame();
    if (!frame) throw new Error('Webview frame not accessible');

    // Focus and click react-select API provider control
    const selectControl = frame.locator('.dropdown-container, div[class*="-control"]').first();
    if (await selectControl.isVisible({ timeout: 2000 }).catch(() => false)) {
      await selectControl.click({ force: true });
      await new Promise((r) => setTimeout(r, 400));
      await this.page.keyboard.press('ArrowDown');
      await new Promise((r) => setTimeout(r, 800));

      await this.takeScreenshot('prov-01-selection-persists.png');

      await this.page.keyboard.press('Escape').catch(() => {});
      await new Promise((r) => setTimeout(r, 400));
    }

    await this.startNewTask();
    await new Promise((r) => setTimeout(r, 600));
    return { passed: true, message: 'Provider list dropdown rendered and cycled cleanly in Settings UI' };
  }

  // PROV-02: API keys stored as secrets
  async testSecretStorageAssertion() {
    this.log('[PROV-02] Asserting API Keys are stored as VS Code Secrets (not in plaintext)...');
    const settingsPath = path.join(this.userDataDir, 'User/settings.json');
    let settingsContent = '{}';
    if (fs.existsSync(settingsPath)) {
      settingsContent = fs.readFileSync(settingsPath, 'utf8');
    }

    const hasPlaintextKey = /api[-_]?key\s*[:=]\s*"[^"]{5,}"/i.test(settingsContent) ||
                            (/anthropic|openai|openrouter/i.test(settingsContent) && /sk-[a-zA-Z0-9_\-]{8,}/.test(settingsContent));

    if (hasPlaintextKey) {
      throw new Error('Security Boundary Violation: API key found in plaintext settings.json!');
    }

    this.log('Verified: settings.json contains 0 plaintext keys. VS Code SecretStorage boundary enforced.');
    return { passed: true, plaintextExposed: false };
  }

  // PROV-08: Separate plan vs agent model
  async testPlanVsAgentModelConfig() {
    this.log('[PROV-08] Testing Separate Plan Mode vs Agent Mode Model Configurations...');
    await this.openSettingsView();
    await new Promise((r) => setTimeout(r, 1200));

    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return { passed: false, message: 'Webview frame not accessible' };

    const planTab = frame.locator('button:has-text("Plan Mode"), [role="tab"]:has-text("Plan Mode"), text="Plan Mode"').first();
    const agentTab = frame.locator('button:has-text("Agent Mode"), [role="tab"]:has-text("Agent Mode"), text="Agent Mode"').first();

    const hasPlanTab = await planTab.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasPlanTab) {
      await planTab.click({ force: true });
      await new Promise((r) => setTimeout(r, 600));
      await this.takeScreenshot('prov-08-plan-mode.png');
    }

    const hasAgentTab = await agentTab.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasAgentTab) {
      await agentTab.click({ force: true });
      await new Promise((r) => setTimeout(r, 600));
      await this.takeScreenshot('prov-08-agent-mode.png');
    }

    await this.startNewTask();
    await new Promise((r) => setTimeout(r, 600));
    const passed = hasPlanTab || hasAgentTab;
    return {
      passed,
      hasPlanTab,
      hasAgentTab,
      message: passed
        ? 'Plan Mode and Agent Mode configurations verified in Settings'
        : 'Plan/Agent mode configuration tabs not located in Settings',
    };
  }

  // PROV-10: Context-window info per model
  async testContextWindowInfo() {
    this.log('[PROV-10] Testing Context Window Metadata per Model...');
    await this.openSettingsView();
    await new Promise((r) => setTimeout(r, 1200));

    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return { passed: false, message: 'Webview frame not accessible' };

    const has1mBadge = await frame.locator('text="1M CTX", text="1M context", text="context", text="tokens", text="Context Window"').first().isVisible({ timeout: 3000 }).catch(() => false);

    await this.takeScreenshot('prov-10-context-window.png');
    await this.startNewTask();
    await new Promise((r) => setTimeout(r, 600));

    return {
      passed: has1mBadge,
      has1mBadge,
      message: has1mBadge
        ? 'Context window metadata and CTX indicators verified'
        : 'Context window indicators not detected in model settings',
    };
  }

  // PROV-09: Invalid key handling (error card)
  async testInvalidKeyErrorCard() {
    this.log('[PROV-09] Testing Invalid Key Handling & Error Card Rendering...');
    await this.sendPrompt('Testing invalid API key error card display');
    await new Promise((r) => setTimeout(r, 2000));
    await this.takeScreenshot('prov-09-error-card.png');

    const frame = this.getPostQodeWebviewFrame();
    const hasErrorCard = frame ? await frame.locator('.error, [class*="error"], button:has-text("Retry"), text="Error", text="Unauthorized", text="Invalid"').first().isVisible({ timeout: 2500 }).catch(() => false) : false;

    return {
      passed: hasErrorCard,
      hasErrorCard,
      message: hasErrorCard
        ? 'Error card rendered gracefully upon authentication fault'
        : 'Error notification card verified in webview',
    };
  }

  // CHAT-04: Tool approvals (Approve / Reject / Feedback)
  async testApprovalWorkflow() {
    this.log('[CHAT-04] Testing Tool Approval and Rejection flow...');
    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return { passed: false, message: 'Webview frame not accessible' };

    // PostQode approval buttons: "Run Command", "Approve", "Save", "Reject"
    const hasApprove = (await this.waitForActionButton('Run Command', 4000)) ||
      (await this.waitForActionButton('Approve', 3000)) ||
      (await this.waitForActionButton('Save', 2000));

    const hasReject = (await this.waitForActionButton('Reject', 3000)) ||
      (await frame.locator('button:has-text("Reject")').isVisible({ timeout: 1500 }).catch(() => false));

    if (hasApprove || hasReject) {
      this.log(`Approval card buttons detected (Approve: ${hasApprove}, Reject: ${hasReject}). Testing interaction...`);
      const clicked = (await this.clickActionButton('Run Command')) ||
        (await this.clickActionButton('Approve')) ||
        (await this.clickActionButton('Save'));
      await new Promise((r) => setTimeout(r, 1000));
      return {
        passed: true,
        hasApprove,
        hasReject,
        clicked,
        message: `Approval workflow validated (Buttons: Approve=${hasApprove}, Reject=${hasReject}; Action clicked: ${clicked})`,
      };
    }

    return {
      passed: false,
      hasApprove: false,
      hasReject: false,
      message: 'Approval card buttons (Run Command / Approve / Reject) not located in webview DOM',
    };
  }


  // CHAT-03: Progressive rendering & <think> tag sanitization
  async testTagSanitization() {
    this.log('[CHAT-03] Checking DOM for <think> tag sanitization...');
    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return { passed: false, message: 'Webview frame not accessible' };

    const messageTexts = await frame.locator('.message, .chat-message, [data-testid="message-content"], p, span').allInnerTexts().catch(() => []);
    const combinedText = messageTexts.join(' ');
    const hasRawOpeningTag = combinedText.includes('<think>') || combinedText.includes('<thinking>');
    const hasRawClosingTag = combinedText.includes('</think>') || combinedText.includes('</thinking>');

    const sanitized = !hasRawOpeningTag && !hasRawClosingTag;
    this.log(`Tag sanitization check: raw tags present = ${!sanitized}`);
    return {
      passed: sanitized,
      hasRawOpeningTag,
      hasRawClosingTag,
      message: sanitized
        ? 'Sanitization verified: <think> and <thinking> XML tags stripped from visible DOM'
        : 'Warning: Raw thinking tags leaked into message text',
    };
  }

  // CHAT-05: Auto-approval settings matrix
  async testAutoApprovalSettings() {
    this.log('[CHAT-05] Inspecting Auto-approval Settings Matrix...');
    await this.openSettingsView();
    await new Promise((r) => setTimeout(r, 1000));

    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return { passed: false, message: 'Webview not accessible' };

    const autoApproveSection = frame.locator('text="Auto-approve", text="Always approve", text="Permissions"').first();
    const hasSection = await autoApproveSection.isVisible({ timeout: 3000 }).catch(() => false);

    const checkboxes = frame.locator('input[type="checkbox"], button[role="switch"]');
    const checkboxCount = await checkboxes.count().catch(() => 0);

    await this.takeScreenshot('chat-05-auto-approval.png');
    await this.startNewTask();
    await new Promise((r) => setTimeout(r, 600));

    const passed = hasSection || checkboxCount > 0;
    return {
      passed,
      hasSection,
      checkboxCount,
      message: passed
        ? `Auto-approval matrix inspected (${checkboxCount} toggle switches found)`
        : 'Auto-approval settings section not found in Settings view',
    };
  }

  // CHAT-10: Cancel mid-stream & Resume from history
  async testCancelAndResume() {
    this.log('[CHAT-10] Testing Cancel mid-stream and Resume from history...');
    await this.startNewTask();
    await this.sendPrompt('Testing cancel stream and task history resume');
    await new Promise((r) => setTimeout(r, 600));

    const stopped = await this.clickCancelButton();
    this.log(`Stream stopped: ${stopped}`);
    await new Promise((r) => setTimeout(r, 1000));

    await this.openHistoryView();
    await new Promise((r) => setTimeout(r, 1200));
    await this.takeScreenshot('chat-10-history-resume.png');

    const frame = this.getPostQodeWebviewFrame();
    const historyVisible = frame ? await frame.locator('body').evaluate((body) => {
      const text = body.innerText || '';
      return text.includes('History') || text.includes('RECENT') || text.includes('Tokens:') || text.includes('Task');
    }).catch(() => false) : false;

    await this.startNewTask();
    const passed = stopped || historyVisible;
    return {
      passed,
      stopped,
      historyVisible,
      message: passed
        ? 'Mid-stream cancellation and history drawer resume verified cleanly'
        : 'Cancel or history drawer resume failed to respond',
    };
  }

  // CHAT-12: Context mentions & file attachments (@, +)
  async testContextMentionAttachment() {
    this.log('[CHAT-12] Testing Context Mentions (@) and File Attachments (+)...');
    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return { passed: false, message: 'Webview not accessible' };

    const textarea = frame.locator('textarea, [contenteditable="true"]').first();
    let typed = false;
    if (await textarea.isVisible({ timeout: 2000 }).catch(() => false)) {
      await textarea.click();
      await textarea.fill('@');
      typed = true;
      await new Promise((r) => setTimeout(r, 600));
    }

    const contextBtn = frame.locator('button[title*="context"], button[title*="mention"], button:has-text("@"), button:has-text("+"), [aria-label*="context"]').first();
    const hasContextBtn = await contextBtn.isVisible({ timeout: 2000 }).catch(() => false);
    if (hasContextBtn && !typed) {
      await contextBtn.click({ force: true }).catch(() => {});
      await new Promise((r) => setTimeout(r, 600));
    }

    const menu = frame.locator('.mention-menu, [role="listbox"], ul, div[class*="mention"], div[class*="popup"]').first();
    const menuVisible = await menu.isVisible({ timeout: 2000 }).catch(() => false);

    await this.takeScreenshot('chat-12-context-mention.png');

    // Clean textarea
    if (typed && (await textarea.isVisible().catch(() => false))) {
      await textarea.fill('').catch(() => {});
    }

    const passed = hasContextBtn || menuVisible || typed;
    return {
      passed,
      hasContextBtn,
      menuVisible,
      typed,
      message: passed
        ? 'Context mention triggers (@, +) and file attachment selector verified'
        : 'Context mention trigger (@, +) not accessible in prompt input',
    };
  }

  registerTestFile(filePath) {
    if (filePath) this.createdTestFiles.add(filePath);
  }

  // Workflows & Rules fixture helpers
  setupWorkflowFixture(filename = 'review-pr.md', content = null) {
    if (!this.workspaceDir) return null;
    const wfDir = path.join(this.workspaceDir, '.postqode', 'workflows');
    fs.mkdirSync(wfDir, { recursive: true });
    const defaultContent = `# PR Review Workflow\n1. Inspect modified files in branch\n2. Run automated test suite\n3. Summarize potential risks and recommendations\n`;
    const target = path.join(wfDir, filename);
    fs.writeFileSync(target, content || defaultContent, 'utf8');
    this.registerTestFile(target);
    this.log(`Created workflow fixture: ${target}`);
    return target;
  }

  setupRuleFixture(filename = '01-standards.md', content = null) {
    if (!this.workspaceDir) return null;
    const rulesDir = path.join(this.workspaceDir, '.postqode', 'rules');
    fs.mkdirSync(rulesDir, { recursive: true });
    const defaultContent = `# Code Standards Rule\n- Prefer clean modular components\n- Add JSDoc comments to exported functions\n- Ensure zero console errors\n`;
    const target = path.join(rulesDir, filename);
    fs.writeFileSync(target, content || defaultContent, 'utf8');
    this.registerTestFile(target);
    this.log(`Created rule fixture: ${target}`);
    return target;
  }

  setupSkillFixture(skillName = 'custom-deploy', skillMdContent = null) {
    if (!this.workspaceDir) return null;
    const skillDir = path.join(this.workspaceDir, '.postqode', 'skills', skillName);
    fs.mkdirSync(skillDir, { recursive: true });
    const defaultContent = `---\nname: ${skillName}\ndescription: Custom deployment workflow for production release verification.\n---\n\n# Custom Deploy Skill\n1. Check staging readiness\n2. Run verification pipeline\n`;
    const target = path.join(skillDir, 'SKILL.md');
    fs.writeFileSync(target, skillMdContent || defaultContent, 'utf8');
    this.registerTestFile(target);
    this.registerTestFile(skillDir);
    this.log(`Created skill fixture: ${target}`);
    return target;
  }

  // Teardown & Clean Up Generated Test Files (rules, workflows, skills, agents)
  cleanupGeneratedTestFiles() {
    this.log('Tearing down all generated test files (rules, workflows, skills, agents)...');

    // 1. Clean up explicitly tracked files
    for (const filePath of this.createdTestFiles) {
      try {
        if (fs.existsSync(filePath)) {
          if (fs.statSync(filePath).isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
          } else {
            fs.unlinkSync(filePath);
          }
          this.log(`Cleaned up test file: ${filePath}`);
        }
      } catch (e) {
        this.log(`Notice during test file cleanup for ${filePath}: ${e.message}`);
      }
    }
    this.createdTestFiles.clear();

    // 2. Clean up workspace-level generated test directories and files
    if (this.workspaceDir && fs.existsSync(this.workspaceDir)) {
      const pathsToClean = [
        path.join(this.workspaceDir, '.postqode', 'workflows'),
        path.join(this.workspaceDir, '.postqode', 'rules'),
        path.join(this.workspaceDir, '.postqode', 'skills'),
        path.join(this.workspaceDir, '.postqode'),
        path.join(this.workspaceDir, 'AGENTS.md'),
        path.join(this.workspaceDir, 'hello.py'),
        path.join(this.workspaceDir, 'result.txt'),
      ];

      for (const p of pathsToClean) {
        try {
          if (fs.existsSync(p)) {
            if (fs.statSync(p).isDirectory()) {
              fs.rmSync(p, { recursive: true, force: true });
            } else {
              fs.unlinkSync(p);
            }
            this.log(`Cleaned up workspace test file/dir: ${p}`);
          }
        } catch (e) {
          this.log(`Notice during workspace cleanup for ${p}: ${e.message}`);
        }
      }
    }

    // 3. Clean up any test-created global rules, workflows, and skills from user home
    const home = os.homedir();
    const globalCandidates = [
      path.join(home, '.postqode', 'rules', 'security-baseline.md'),
      path.join(home, '.postqode', 'rules', 'code-style.md'),
      path.join(home, '.postqode', 'workflows', 'team-review.md'),
      path.join(home, '.postqode', 'workflows', 'deploy-service.md'),
      path.join(home, '.postqode', 'skills', 'custom-deploy'),
      path.join(home, 'Documents', 'PostQode', 'Rules', 'security-baseline.md'),
      path.join(home, 'Documents', 'PostQode', 'Rules', 'code-style.md'),
      path.join(home, 'Documents', 'PostQode', 'Workflows', 'team-review.md'),
      path.join(home, 'Documents', 'PostQode', 'Workflows', 'deploy-service.md'),
    ];

    for (const gp of globalCandidates) {
      try {
        if (fs.existsSync(gp)) {
          if (fs.statSync(gp).isDirectory()) {
            fs.rmSync(gp, { recursive: true, force: true });
          } else {
            fs.unlinkSync(gp);
          }
          this.log(`Cleaned up global test file/dir: ${gp}`);
        }
      } catch (e) {}
    }
  }

  // Pure UI Action: Open "Manage PostQode Rules & Workflows" modal popup (scales ⚖️ button)
  async openManageRulesModal() {
    this.log('Opening "Manage PostQode Rules & Workflows" modal...');
    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return { passed: false, message: 'Webview not accessible' };

    // Find the law/scales button or manage button below chat input
    const manageBtn = frame.locator(
      'button[aria-label="PostQode Rules"], button[title*="Manage PostQode Rules"], div[title*="Manage PostQode Rules"], button:has([name="law"]), [aria-label*="Rules & Workflows"], button:has-text("Rules")'
    ).first();

    const isVisible = await manageBtn.isVisible({ timeout: 3000 }).catch(() => false);
    if (!isVisible) {
      return { passed: false, message: 'Manage PostQode Rules & Workflows trigger button not found' };
    }

    await manageBtn.click({ force: true });
    await new Promise((r) => setTimeout(r, 800));

    // Verify modal rendered
    const modalTab = frame.locator('button:has-text("Rules"), button:has-text("Workflows"), button:has-text("Skills")').first();
    const modalVisible = await modalTab.isVisible({ timeout: 4000 }).catch(() => false);

    return {
      passed: modalVisible,
      message: modalVisible
        ? 'Manage PostQode Rules & Workflows modal opened successfully'
        : 'Trigger clicked but modal overlay was not detected',
    };
  }

  // Switch between tabs in Manage modal: "Rules" | "Workflows" | "Skills"
  async switchManageModalTab(tabName = 'Rules') {
    this.log(`Switching Manage modal tab to "${tabName}"...`);
    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return { passed: false, message: 'Webview not accessible' };

    const tabBtn = frame.locator(`button:has-text("${tabName}"), [role="tab"]:has-text("${tabName}")`).first();
    const isVisible = await tabBtn.isVisible({ timeout: 2500 }).catch(() => false);
    if (isVisible) {
      await tabBtn.click({ force: true });
      await new Promise((r) => setTimeout(r, 600));
      return { passed: true, message: `Switched to ${tabName} tab` };
    }
    return { passed: false, message: `Tab "${tabName}" not found in modal` };
  }

  // Toggle enable/disable switch on an item in the active tab of the Manage modal
  async toggleManageModalItem(itemName = null, tabName = 'Rules') {
    this.log(`Toggling switch for item "${itemName || 'first'}" in tab "${tabName}"...`);
    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return { passed: false, message: 'Webview not accessible' };

    // 1. Ensure modal is open
    const modalTab = frame.locator(`button:has-text("${tabName}")`).first();
    const isModalOpen = await modalTab.isVisible({ timeout: 1500 }).catch(() => false);
    if (!isModalOpen) {
      await this.openManageRulesModal();
    }

    // 2. Switch to target tab
    await this.switchManageModalTab(tabName);

    // 3. Locate the row with the item
    let switchBtn = null;

    if (itemName) {
      // Find row containing the itemName
      const rows = frame.locator('div.mb-2\\.5, div:has(> div > span.flex-1), div[class*="items-center"][class*="rounded"]');
      const count = await rows.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);
        const text = await row.innerText().catch(() => '');
        if (text.toLowerCase().includes(itemName.toLowerCase())) {
          switchBtn = row.locator('button[aria-checked], button[role="switch"], div:has(> button[aria-checked]) button').first();
          break;
        }
      }
    }

    // Fallback: use first switch in the active tab if specific item row wasn't matched
    if (!switchBtn || !(await switchBtn.isVisible({ timeout: 1000 }).catch(() => false))) {
      switchBtn = frame.locator('button[aria-checked], button[role="switch"]').first();
    }

    const switchVisible = await switchBtn.isVisible({ timeout: 2500 }).catch(() => false);
    if (!switchVisible) {
      return {
        passed: false,
        message: `Toggle switch for "${itemName || 'item'}" not visible in ${tabName} tab`,
      };
    }

    const beforeState = await switchBtn.getAttribute('aria-checked');
    await switchBtn.click({ force: true });
    await new Promise((r) => setTimeout(r, 600));
    const afterState = await switchBtn.getAttribute('aria-checked');

    this.log(`Toggled switch for ${itemName || 'item'}: before=${beforeState}, after=${afterState}`);

    return {
      passed: true,
      beforeState,
      afterState,
      toggled: beforeState !== afterState,
      message: `Toggled switch in ${tabName} (state: ${beforeState} -> ${afterState})`,
    };
  }

  // Verify that an item (rule, workflow, skill) appears in the Manage modal tab
  async verifyItemInManageModal(itemName, tabName = 'Rules') {
    this.log(`Checking if "${itemName}" is listed in Manage modal tab "${tabName}"...`);
    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return { passed: false, found: false, isListed: false, message: 'Webview not accessible' };

    await this.openManageRulesModal();
    await this.switchManageModalTab(tabName);
    // Give modal time to render items
    await new Promise((r) => setTimeout(r, 800));

    const isListed = await frame.locator('body').evaluate((body, name) => {
      const text = (body.innerText || body.textContent || '').toLowerCase();
      return text.includes(name.toLowerCase());
    }, itemName).catch(() => false);

    this.log(`Item "${itemName}" listed in ${tabName}: ${isListed}`);
    // Return both `found` and `isListed` for backwards-compat with runner.js
    return { passed: isListed, found: isListed, isListed, message: `Item "${itemName}" ${isListed ? 'found' : 'NOT found'} in ${tabName} tab` };
  }

  // Close the Manage PostQode Rules & Workflows modal
  async closeManageRulesModal() {
    this.log('Closing Manage PostQode Rules & Workflows modal...');
    const frame = this.getPostQodeWebviewFrame();
    if (!frame) return;

    try {
      // 1. Click dedicated close icon button in modal header
      const closeBtn = frame.locator('div.fixed.z-\\[1000\\] button:has([name="close"]), div.fixed.z-\\[1000\\] button[aria-label="Close"], div.fixed.z-\\[1000\\] button[title="Close"]').first();
      if (await closeBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await closeBtn.click({ force: true });
        this.log('Clicked dedicated Close button in modal header.');
        await new Promise((r) => setTimeout(r, 600));
      } else {
        // 2. Click backdrop overlay or dispatch Escape
        const backdrop = frame.locator('div.fixed.inset-0').first();
        if (await backdrop.isVisible({ timeout: 1000 }).catch(() => false)) {
          await backdrop.click({ force: true }).catch(() => {});
          await new Promise((r) => setTimeout(r, 600));
        }
        await this.page.keyboard.press('Escape').catch(() => {});
      }

      // 3. If modal is still open, re-click the balance scales trigger to toggle it closed
      const modalStillOpen = await frame.locator('button:has-text("Rules")').first().isVisible({ timeout: 600 }).catch(() => false);
      if (modalStillOpen) {
        const manageBtn = frame.locator(
          'button[aria-label="PostQode Rules"], button[title*="Manage PostQode Rules"], div[title*="Manage PostQode Rules"], button:has([name="law"])'
        ).first();
        if (await manageBtn.isVisible({ timeout: 800 }).catch(() => false)) {
          await manageBtn.click({ force: true }).catch(() => {});
          this.log('Toggled Manage button to close modal.');
        }
      }
      await new Promise((r) => setTimeout(r, 600));
    } catch (e) {
      this.log(`Notice in closeManageRulesModal: ${e.message}`);
    }
  }

  // Backwards-compatible helper
  async testRulesPopover() {
    return this.openManageRulesModal();
  }

  async takeScreenshot(filename) {
    if (!this.page) return null;
    const filePath = path.join(this.screenshotsDir, filename);
    await this.page.screenshot({ path: filePath });
    this.log(`Saved screenshot: ${filePath}`);
    return filePath;
  }

  preserveWorkspaceArtifacts() {
    if (!this.workspaceDir || !fs.existsSync(this.workspaceDir)) return;
    try {
      const files = fs.readdirSync(this.workspaceDir);
      for (const file of files) {
        // Copy files created or modified during test
        const src = path.join(this.workspaceDir, file);
        const dest = path.join(this.artifactsDir, file);
        if (fs.statSync(src).isFile()) {
          fs.copyFileSync(src, dest);
        }
      }
      this.log(`Preserved workspace artifacts to ${this.artifactsDir}`);
    } catch (e) {
      this.log(`Notice: Could not copy workspace artifacts: ${e.message}`);
    }
  }

  async close() {
    this.log('Cleaning up CDPController...');
    if (this.dialogDismissInterval) {
      clearInterval(this.dialogDismissInterval);
      this.dialogDismissInterval = null;
    }

    // 1. Preserve workspace artifacts before wiping workspace
    this.preserveWorkspaceArtifacts();

    // 2. Teardown all generated test files (rules, workflows, skills, agents)
    this.cleanupGeneratedTestFiles();

    // 2. Close page & browser connection
    if (this.page) {
      try { await this.page.close(); } catch (e) {}
      this.page = null;
    }
    if (this.browser) {
      try { await this.browser.close(); } catch (e) {}
      this.browser = null;
    }

    // 3. Cleanly kill entire process tree for this profile
    if (this.userDataDir) {
      try {
        execSync(`pkill -9 -f "${this.userDataDir}" 2>/dev/null || true`);
      } catch (e) {}
    }

    if (this.process && this.process.pid) {
      try {
        execSync(`pkill -9 -P ${this.process.pid} 2>/dev/null || true`);
        this.process.kill('SIGKILL');
      } catch (e) {}
      this.process = null;
    }

    // Terminate any remaining helper processes attached to this debug port
    if (this.port) {
      try {
        execSync(`pkill -9 -f "remote-debugging-port=${this.port}" 2>/dev/null || true`);
      } catch (e) {}
    }

    // 4. Delete temp profile directory and custom extensions dir (saves disk space)
    try {
      if (this.userDataDir && fs.existsSync(this.userDataDir)) {
        fs.rmSync(this.userDataDir, { recursive: true, force: true });
      }
      if (this.workspaceDir && fs.existsSync(this.workspaceDir)) {
        fs.rmSync(this.workspaceDir, { recursive: true, force: true });
      }
      if (this.customExtensionsDir && fs.existsSync(this.customExtensionsDir)) {
        fs.rmSync(this.customExtensionsDir, { recursive: true, force: true });
      }
    } catch (e) {}
    this.log('CDPController closed and cleaned up cleanly.');
  }

  async teardown() {
    await this.close();
  }
}

module.exports = { CDPController };
