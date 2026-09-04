const vscode = require('vscode');
const path = require('path');
const os = require('os');
const fs = require('fs');
const http = require('http');
const { ServerManager } = require('./server-manager');
const { DashboardWebviewProvider } = require('./webview-provider');
const { DashboardSidebarProvider } = require('./sidebar-provider');
const { TestHarness } = require('./test-harness');

let serverManager = null;
let webviewProvider = null;
let sidebarProvider = null;
let testHarness = null;
let statusBarItem = null;

async function activate(context) {
  console.log('[PQ Dashboard] Activating extension...');

  const extensionPath = context.extensionPath;
  const outputChannel = vscode.window.createOutputChannel('PQ Dashboard Server');
  context.subscriptions.push(outputChannel);

  serverManager = new ServerManager(extensionPath, outputChannel);
  webviewProvider = new DashboardWebviewProvider(context.extensionUri, serverManager);
  sidebarProvider = new DashboardSidebarProvider(serverManager);
  testHarness = new TestHarness(serverManager);

  // Register Tree View in Activity Bar
  vscode.window.registerTreeDataProvider('pqDashboardSidebar', sidebarProvider);

  // Create Status Bar Item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'pq.openDashboard';
  statusBarItem.text = '$(pulse) PQ: Starting...';
  statusBarItem.tooltip = 'PostQode Observability Dashboard — Click to open';
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);

  // 1. Start or connect to backend server
  try {
    const info = await serverManager.start();
    statusBarItem.text = `$(radio-tower) PQ: 🟢 ${info.port}`;
    statusBarItem.tooltip = `PQ Dashboard active on ${info.url} (Proxy: ${info.proxyPort}) — Click to open`;
    sidebarProvider.refresh();
  } catch (err) {
    console.error('[PQ Dashboard] Server startup error:', err);
    statusBarItem.text = '$(alert) PQ: Server Error';
    statusBarItem.tooltip = `Failed to start PQ server: ${err.message}`;
    vscode.window.showErrorMessage(`PQ Dashboard server error: ${err.message}`);
  }

  // 2. Register Commands
  const openDashboardCmd = vscode.commands.registerCommand('pq.openDashboard', () => {
    webviewProvider.showOrFocus();
  });

  const openInBrowserCmd = vscode.commands.registerCommand('pq.openInBrowser', () => {
    vscode.env.openExternal(vscode.Uri.parse(serverManager.serverUrl));
  });

  const refreshDataCmd = vscode.commands.registerCommand('pq.refreshData', async () => {
    vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: 'PQ Dashboard: Scanning new tasks across all IDEs...',
        cancellable: false,
      },
      async () => {
        try {
          await serverManager.refreshData();
          sidebarProvider.refresh();
          vscode.window.showInformationMessage('PQ Dashboard: Task scan complete!');
        } catch (e) {
          vscode.window.showErrorMessage(`Refresh failed: ${e.message}`);
        }
      }
    );
  });

  const runTestCmd = vscode.commands.registerCommand('pq.runTest', async () => {
    try {
      const overview = await sidebarProvider.fetchJson('/api/tasks?limit=10');
      const tasks = overview.tasks || [];
      if (!tasks.length) {
        vscode.window.showInformationMessage('No tasks found to test. Complete a PostQode task first!');
        return;
      }

      const items = tasks.map(t => ({
        label: `Task ${t.id}`,
        description: `${t.source || 'PostQode'} • ${t.model || 'unknown'} • ${t.status || ''}`,
        taskId: t.id,
      }));

      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: 'Select a PostQode task to evaluate with the Behavioral Test Suite',
      });

      if (!selected) return;

      vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: `Running behavioral test on Task ${selected.taskId}...`,
          cancellable: false,
        },
        async () => {
          const result = await testHarness.runBehavioralTest(selected.taskId);
          const score = result.overall_score != null ? `${result.overall_score}/100` : 'Complete';
          vscode.window.showInformationMessage(`Task ${selected.taskId} Score: ${score}`, 'Open in Dashboard')
            .then(action => {
              if (action === 'Open in Dashboard') {
                webviewProvider.showOrFocus();
              }
            });
        }
      );
    } catch (e) {
      vscode.window.showErrorMessage(`Test run failed: ${e.message}`);
    }
  });

  const startProxyCmd = vscode.commands.registerCommand('pq.startProxy', async () => {
    try {
      const config = vscode.workspace.getConfiguration('http');
      const currentProxy = config.get('proxy');
      const currentStrictSSL = config.get('proxyStrictSSL');
      const isAlreadyConfigured = Boolean(
        currentProxy &&
        (currentProxy.includes('127.0.0.1:3457') || currentProxy.includes('localhost:3457')) &&
        currentStrictSSL === false
      );

      if (isAlreadyConfigured) {
        vscode.window.showInformationMessage('ℹ️ VS Code Proxy is already configured (127.0.0.1:3457). No changes needed.');
        sidebarProvider.refresh();
        webviewProvider.notifyProxyStatusChanged(true);
        return;
      }

      await config.update('proxy', 'http://127.0.0.1:3457', vscode.ConfigurationTarget.Global);
      await config.update('proxyStrictSSL', false, vscode.ConfigurationTarget.Global);
      await config.update('proxySupport', 'override', vscode.ConfigurationTarget.Global);
      await config.update('noProxy', [
        'localhost',
        '127.0.0.1',
        'us.i.posthog.com',
        'mobile.events.data.microsoft.com',
        'main.vscode-cdn.net',
      ], vscode.ConfigurationTarget.Global);

      vscode.window.showInformationMessage(
        '✅ VS Code Proxy Configured: 127.0.0.1:3457 (StrictSSL: false). PostQode traffic is now routed through Network Inspector.',
        'Trust Certificate', 'Open Network Inspector'
      ).then((action) => {
        if (action === 'Trust Certificate') {
          vscode.commands.executeCommand('pq.trustCertificate');
        } else if (action === 'Open Network Inspector') {
          webviewProvider.showOrFocus();
        }
      });
      sidebarProvider.refresh();
      webviewProvider.notifyProxyStatusChanged(true);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to configure proxy settings: ${err.message}`);
    }
  });

  const stopProxyCmd = vscode.commands.registerCommand('pq.stopProxy', async () => {
    try {
      const config = vscode.workspace.getConfiguration('http');
      const currentProxy = config.get('proxy');
      if (!currentProxy) {
        vscode.window.showInformationMessage('ℹ️ Proxy is not active. PostQode is already connecting directly.');
        sidebarProvider.refresh();
        webviewProvider.notifyProxyStatusChanged(false);
        return;
      }

      await config.update('proxy', undefined, vscode.ConfigurationTarget.Global);
      await config.update('proxyStrictSSL', undefined, vscode.ConfigurationTarget.Global);
      vscode.window.showInformationMessage('🛑 Network Proxy Disabled — PostQode now connects directly to the internet.');
      sidebarProvider.refresh();
      webviewProvider.notifyProxyStatusChanged(false);
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to disable proxy settings: ${err.message}`);
    }
  });

  const trustCertCmd = vscode.commands.registerCommand('pq.trustCertificate', async () => {
    const caPath = path.join(os.homedir(), '.pq-dashboard', 'proxy-certs', 'certs', 'ca.pem');
    if (!fs.existsSync(caPath)) {
      vscode.window.showErrorMessage(`Proxy CA certificate not found at ${caPath}. Please open the dashboard first to initialize certificates.`);
      return;
    }

    const platform = process.platform;

    // Check if certificate is already trusted in the OS Keychain/store
    let isAlreadyTrusted = false;
    if (platform === 'darwin') {
      try {
        const { execSync } = require('child_process');
        execSync(`security verify-cert -c "${caPath}" -p basic`, { stdio: 'ignore', timeout: 2000 });
        isAlreadyTrusted = true;
      } catch {}
    }

    if (isAlreadyTrusted) {
      vscode.window.showInformationMessage('✅ Proxy CA Certificate is already trusted in your system Keychain! HTTPS decryption is active.');
      return;
    }

    const terminal = vscode.window.createTerminal('PostQode CA Trust');
    terminal.show();

    if (platform === 'darwin') {
      terminal.sendText(`sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain "${caPath}"`);
      vscode.window.showInformationMessage('macOS: Please enter your administrator password in the opened terminal to trust the certificate.');
    } else if (platform === 'win32') {
      terminal.sendText(`powershell -Command "Import-Certificate -FilePath '${caPath}' -CertStoreLocation Cert:\\CurrentUser\\Root"`);
      vscode.window.showInformationMessage('Windows: Proxy CA Certificate imported into CurrentUser root store!');
    } else {
      terminal.sendText(`sudo cp "${caPath}" /usr/local/share/ca-certificates/pq-ca.crt && sudo update-ca-certificates`);
      vscode.window.showInformationMessage('Linux: Please enter your sudo password in the opened terminal to update CA certificates.');
    }
  });

  const addSourceCmd = vscode.commands.registerCommand('pq.addSource', async () => {
    try {
      const folders = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: 'Select PostQode Task Folder',
      });
      if (!folders || !folders.length) return;
      const selectedPath = folders[0].fsPath;

      const defaultName = path.basename(selectedPath) || 'Custom Tasks';
      const name = await vscode.window.showInputBox({
        prompt: 'Enter a friendly display name for this task source',
        value: defaultName,
      });
      if (!name) return;

      const url = `${serverManager.serverUrl}/api/sources`;
      const postData = JSON.stringify({ name, path: selectedPath, enabled: true });

      await new Promise((resolve, reject) => {
        const req = http.request(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
          },
          timeout: 5000,
        }, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve(JSON.parse(data));
            } catch {
              resolve({});
            }
          });
        });
        req.on('error', reject);
        req.write(postData);
        req.end();
      });

      sidebarProvider.refresh();
      vscode.window.showInformationMessage(`✅ Added PostQode source "${name}"! Scanning tasks...`, 'Open Dashboard')
        .then(action => {
          if (action === 'Open Dashboard') {
            webviewProvider.showOrFocus();
          }
        });
    } catch (err) {
      vscode.window.showErrorMessage(`Failed to add source: ${err.message}`);
    }
  });

  const openSourcesCmd = vscode.commands.registerCommand('pq.openSources', () => {
    webviewProvider.showOrFocus('#/sources');
  });

  const openSessionsCmd = vscode.commands.registerCommand('pq.openSessions', () => {
    webviewProvider.showOrFocus('#/sessions');
  });

  const openCostsCmd = vscode.commands.registerCommand('pq.openCosts', () => {
    webviewProvider.showOrFocus('#/costs');
  });

  const openErrorsCmd = vscode.commands.registerCommand('pq.openErrors', () => {
    webviewProvider.showOrFocus('#/errors');
  });

  const openModelsCmd = vscode.commands.registerCommand('pq.openModels', () => {
    webviewProvider.showOrFocus('#/models');
  });

  const openNetworkCmd = vscode.commands.registerCommand('pq.openNetwork', () => {
    webviewProvider.showOrFocus('#/network');
  });

  const openRouteCmd = vscode.commands.registerCommand('pq.openRoute', (route) => {
    webviewProvider.showOrFocus(route || '#/overview');
  });

  context.subscriptions.push(
    openDashboardCmd,
    openInBrowserCmd,
    refreshDataCmd,
    runTestCmd,
    startProxyCmd,
    stopProxyCmd,
    trustCertCmd,
    addSourceCmd,
    openSourcesCmd,
    openSessionsCmd,
    openCostsCmd,
    openErrorsCmd,
    openModelsCmd,
    openNetworkCmd,
    openRouteCmd
  );

  console.log('[PQ Dashboard] Extension activated successfully!');
}

async function deactivate() {
  console.log('[PQ Dashboard] Deactivating extension...');
  if (serverManager) {
    await serverManager.stop();
  }
}

module.exports = {
  activate,
  deactivate,
};
