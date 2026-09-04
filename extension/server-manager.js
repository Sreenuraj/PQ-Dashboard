const { spawn, execSync } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { syncConfigWithDetectedSources } = require('./ide-sources');

function findNodeBinary() {
  const isWin = process.platform === 'win32';
  const nodeExe = isWin ? 'node.exe' : 'node';

  // 1. Try 'which node' or 'where node'
  try {
    const cmd = isWin ? 'where node' : 'which node';
    const output = execSync(cmd, { encoding: 'utf8', timeout: 1000 }).trim();
    const firstLine = output.split('\n')[0].trim();
    if (firstLine && fs.existsSync(firstLine)) {
      return firstLine;
    }
  } catch {}

  // 2. Candidate paths
  const candidates = [];

  if (isWin) {
    candidates.push(
      'C:\\Program Files\\nodejs\\node.exe',
      'C:\\Program Files (x86)\\nodejs\\node.exe',
      path.join(os.homedir(), 'AppData', 'Roaming', 'nvm', 'current', 'node.exe'),
      path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'node', 'node.exe')
    );
  } else {
    // macOS / Linux - check NVM first (very common on developer machines)
    const nvmDir = path.join(os.homedir(), '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmDir)) {
      try {
        const versions = fs.readdirSync(nvmDir).sort().reverse();
        for (const v of versions) {
          candidates.push(path.join(nvmDir, v, 'bin', 'node'));
        }
      } catch {}
    }

    // Common package manager locations
    candidates.push(
      '/opt/homebrew/bin/node',
      '/usr/local/bin/node',
      '/usr/bin/node',
      path.join(os.homedir(), '.volta', 'bin', 'node'),
      path.join(os.homedir(), '.asdf', 'shims', 'node'),
      path.join(os.homedir(), '.fnm', 'current', 'bin', 'node')
    );
  }

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return c;
    }
  }

  return 'node';
}

class ServerManager {
  constructor(extensionPath, outputChannel = null) {
    this.extensionPath = extensionPath;
    this.outputChannel = outputChannel;
    this.serverProcess = null;
    this.port = 3456;
    this.proxyPort = 3457;
    this.isManaged = false;
    this.serverUrl = `http://127.0.0.1:${this.port}`;
    this.isReady = false;
  }

  log(msg) {
    const text = `[PQ ServerManager] ${msg}`;
    console.log(text);
    if (this.outputChannel) {
      this.outputChannel.appendLine(text);
    }
  }

  async isServerRunning() {
    return new Promise((resolve) => {
      const req = http.get(`${this.serverUrl}/api/config`, { timeout: 1500 }, (res) => {
        resolve(res.statusCode === 200);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => {
        req.destroy();
        resolve(false);
      });
    });
  }

  async waitForServer(maxWaitMs = 15000) {
    const start = Date.now();
    while (Date.now() - start < maxWaitMs) {
      if (await this.isServerRunning()) {
        this.isReady = true;
        return true;
      }
      await new Promise(r => setTimeout(r, 500));
    }
    return false;
  }

  async start() {
    this.isStopping = false;
    // 1. Sync config with detected PostQode IDE directories
    const configPath = path.join(this.extensionPath, 'pq-config.yaml');
    try {
      syncConfigWithDetectedSources(configPath);
    } catch (e) {
      this.log(`Config sync notice: ${e.message}`);
    }

    // 2. Check if server is already running
    if (await this.isServerRunning()) {
      this.log(`Connecting to existing PQ Dashboard server at ${this.serverUrl}`);
      this.isManaged = false;
      this.isReady = true;
      return { url: this.serverUrl, port: this.port, proxyPort: this.proxyPort, isManaged: false };
    }

    // 3. Locate system Node binary
    const nodeBin = findNodeBinary();
    const serverScript = path.join(this.extensionPath, 'server', 'index.js');
    this.log(`Using Node binary: ${nodeBin}`);
    this.log(`Starting server script: ${serverScript}`);

    // Ensure PATH contains the node directory
    const nodeDir = path.dirname(nodeBin);
    const customPath = process.env.PATH ? `${nodeDir}${path.delimiter}${process.env.PATH}` : nodeDir;

    const env = {
      ...process.env,
      PATH: customPath,
      PORT: String(this.port),
      ELECTRON_RUN_AS_NODE: undefined, // Ensure it runs as pure Node
    };
    delete env.ELECTRON_RUN_AS_NODE;

    this.serverProcess = spawn(nodeBin, [serverScript], {
      cwd: this.extensionPath,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    this.isManaged = true;

    this.serverProcess.stdout?.on('data', (chunk) => {
      const text = chunk.toString();
      this.log(`[stdout] ${text.trim()}`);
    });

    this.serverProcess.stderr?.on('data', (chunk) => {
      const text = chunk.toString();
      this.log(`[stderr] ${text.trim()}`);
    });

    this.serverProcess.on('exit', (code, signal) => {
      this.log(`Process exited with code ${code}, signal ${signal}`);
      this.isReady = false;
      this.serverProcess = null;

      if (!this.isStopping) {
        this.restartCount = (this.restartCount || 0) + 1;
        if (this.restartCount <= 5) {
          this.log(`Server exited unexpectedly. Attempting auto-restart (${this.restartCount}/5) in 2s...`);
          setTimeout(() => {
            if (!this.isStopping && !this.serverProcess) {
              this.start().catch((e) => this.log(`Auto-restart failed: ${e.message}`));
            }
          }, 2000);
        } else {
          this.log('Maximum auto-restart attempts reached. Use "Scan & Refresh Tasks" or reload window to retry.');
        }
      }
    });

    this.serverProcess.on('error', (err) => {
      this.log(`Process spawn error: ${err.message}`);
    });

    // 4. Wait for server readiness
    const ready = await this.waitForServer();
    if (!ready) {
      throw new Error(`Server failed to start within timeout at ${this.serverUrl}. Check output panel.`);
    }

    this.restartCount = 0; // Reset counter on successful startup
    return { url: this.serverUrl, port: this.port, proxyPort: this.proxyPort, isManaged: true };
  }

  async stop() {
    this.isStopping = true;
    if (this.serverProcess && this.isManaged) {
      this.log('Stopping managed PQ Dashboard server process...');
      this.serverProcess.kill('SIGTERM');
      this.serverProcess = null;
      this.isReady = false;
    }
  }

  async refreshData() {
    if (!this.isReady) return;
    return new Promise((resolve, reject) => {
      const req = http.request(`${this.serverUrl}/api/refresh`, { method: 'POST' }, (res) => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch { resolve({ ok: true }); }
        });
      });
      req.on('error', reject);
      req.end();
    });
  }
}

module.exports = { ServerManager, findNodeBinary };
