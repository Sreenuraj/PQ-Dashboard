const vscode = require('vscode');
const http = require('http');

/**
 * Active Testing & Benchmarking Coordinator
 * Watches workspace edits, tracks linter/diagnostic errors, and queries PQ's test engine.
 */
class TestHarness {
  constructor(serverManager) {
    this.serverManager = serverManager;
    this.fileWatcher = null;
    this.recordedEdits = [];
    this.isRecording = false;
  }

  startWorkspaceWatch() {
    if (this.fileWatcher) return;
    this.recordedEdits = [];
    this.isRecording = true;

    this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');

    this.fileWatcher.onDidCreate(uri => this.recordFileEvent('create', uri));
    this.fileWatcher.onDidChange(uri => this.recordFileEvent('modify', uri));
    this.fileWatcher.onDidDelete(uri => this.recordFileEvent('delete', uri));
  }

  recordFileEvent(type, uri) {
    if (!this.isRecording) return;
    const fsPath = uri.fsPath;
    // Skip git, node_modules, temp
    if (fsPath.includes('/.git/') || fsPath.includes('/node_modules/') || fsPath.includes('/.postqode/')) return;
    this.recordedEdits.push({
      type,
      fsPath,
      timestamp: Date.now(),
    });
  }

  stopWorkspaceWatch() {
    this.isRecording = false;
    if (this.fileWatcher) {
      this.fileWatcher.dispose();
      this.fileWatcher = null;
    }
    return [...this.recordedEdits];
  }

  getWorkspaceDiagnostics() {
    const allDiagnostics = vscode.languages.getDiagnostics();
    let errorCount = 0;
    let warningCount = 0;
    const issues = [];

    for (const [uri, diags] of allDiagnostics) {
      for (const d of diags) {
        if (d.severity === vscode.DiagnosticSeverity.Error) {
          errorCount++;
          issues.push({ uri: uri.fsPath, severity: 'error', message: d.message, line: d.range.start.line + 1 });
        } else if (d.severity === vscode.DiagnosticSeverity.Warning) {
          warningCount++;
          issues.push({ uri: uri.fsPath, severity: 'warning', message: d.message, line: d.range.start.line + 1 });
        }
      }
    }

    return { errorCount, warningCount, issues };
  }

  async runBehavioralTest(taskId, baselineId = null) {
    return new Promise((resolve, reject) => {
      const url = `${this.serverManager.serverUrl}/api/tasks/${taskId}/test${baselineId ? '?baseline=' + baselineId : ''}`;
      const req = http.get(url, { timeout: 10000 }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { resolve({}); }
        });
      });
      req.on('error', reject);
    });
  }
}

module.exports = { TestHarness };
