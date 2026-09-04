const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

class DashboardWebviewProvider {
  constructor(extensionUri, serverManager) {
    this.extensionUri = extensionUri;
    this.serverManager = serverManager;
    this.currentPanel = null;
  }

  async showOrFocus(initialRoute = '') {
    const column = vscode.ViewColumn.One;

    if (!await this.serverManager.isServerRunning()) {
      try {
        await this.serverManager.start();
      } catch (e) {
        console.error('[PQ Webview] Auto-start server error:', e.message);
      }
    }

    const route = initialRoute
      ? (initialRoute.startsWith('#') ? initialRoute : `#/${initialRoute.replace(/^\/?#?\/?/, '')}`)
      : '';

    if (this.currentPanel) {
      this.currentPanel.reveal(column);
      if (route) {
        this.currentPanel.webview.postMessage({ type: 'navigate', route });
      }
      return;
    }

    // Create a new Webview panel in an Editor Tab
    this.currentPanel = vscode.window.createWebviewPanel(
      'pqDashboard',
      'PQ Dashboard — PostQode Observability',
      column,
      {
        enableScripts: true,
        retainContextWhenHidden: true, // Preserve all 18 views and WebSocket state on tab switch
        localResourceRoots: [this.extensionUri],
      }
    );

    // Set icon
    const iconPath = path.join(this.extensionUri.fsPath, 'src', 'img', 'logo.svg');
    if (fs.existsSync(iconPath)) {
      this.currentPanel.iconPath = vscode.Uri.file(iconPath);
    }

    this.currentPanel.webview.html = this.getHtmlForWebview(this.currentPanel.webview, initialRoute);

    // Handle messages from Webview
    this.currentPanel.webview.onDidReceiveMessage(
      async (message) => {
        switch (message.type) {
          case 'openFile':
            await this.handleOpenFile(message.filePath, message.line);
            break;
          case 'openBrowser':
            vscode.env.openExternal(vscode.Uri.parse(this.serverManager.serverUrl));
            break;
          case 'enableProxy':
            await vscode.commands.executeCommand('pq.startProxy');
            break;
          case 'disableProxy':
            await vscode.commands.executeCommand('pq.stopProxy');
            break;
          case 'trustCertificate':
            await vscode.commands.executeCommand('pq.trustCertificate');
            break;
          case 'browseFolder': {
            const folders = await vscode.window.showOpenDialog({
              canSelectFiles: false,
              canSelectFolders: true,
              canSelectMany: false,
              openLabel: 'Select PostQode Tasks Folder',
            });
            if (folders && folders.length > 0) {
              const selectedPath = folders[0].fsPath;
              this.currentPanel?.webview.postMessage({ type: 'folderSelected', path: selectedPath });
            }
            break;
          }
          case 'getProxyState': {
            const currentProxy = vscode.workspace.getConfiguration('http').get('proxy');
            const isRouting = Boolean(currentProxy && currentProxy.includes('3457'));
            this.currentPanel?.webview.postMessage({ type: 'proxyState', isRouting });
            break;
          }
          case 'showInfo':
            vscode.window.showInformationMessage(message.text);
            break;
          case 'showError':
            vscode.window.showErrorMessage(message.text);
            break;
        }
      },
      undefined,
      []
    );

    this.currentPanel.onDidDispose(
      () => {
        this.currentPanel = null;
      },
      null,
      []
    );
  }

  notifyProxyStatusChanged(isRouting) {
    if (this.currentPanel) {
      this.currentPanel.webview.postMessage({ type: 'proxyState', isRouting });
    }
  }

  async handleOpenFile(filePath, line = 1) {
    if (!filePath) return;
    try {
      let resolvedPath = filePath;
      // If relative, check if workspace has it
      if (!path.isAbsolute(resolvedPath) && vscode.workspace.workspaceFolders?.length) {
        resolvedPath = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, resolvedPath);
      }

      if (fs.existsSync(resolvedPath)) {
        const doc = await vscode.workspace.openTextDocument(resolvedPath);
        const editor = await vscode.window.showTextDocument(doc, {
          viewColumn: vscode.ViewColumn.Beside,
          preserveFocus: false,
        });

        if (line > 1) {
          const position = new vscode.Position(Math.max(0, line - 1), 0);
          editor.selection = new vscode.Selection(position, position);
          editor.revealRange(new vscode.Range(position, position), vscode.TextEditorRevealType.InCenter);
        }
      } else {
        vscode.window.showWarningMessage(`File not found: ${filePath}`);
      }
    } catch (e) {
      vscode.window.showErrorMessage(`Failed to open file: ${e.message}`);
    }
  }

  getHtmlForWebview(webview, initialRoute = '') {
    const serverUrl = (this.serverManager.serverUrl || 'http://127.0.0.1:3456').replace(/\/$/, '');
    let targetUrl = serverUrl;
    if (initialRoute) {
      const hash = initialRoute.startsWith('#')
        ? initialRoute
        : `#/${initialRoute.replace(/^\/?#?\/?/, '')}`;
      targetUrl = `${serverUrl}/${hash}`;
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>PQ Dashboard</title>
  <style>
    body, html {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background-color: var(--vscode-editor-background, #09090b);
    }
    #dashboard-frame {
      width: 100%;
      height: 100%;
      border: none;
      display: block;
    }
    #loading-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: #09090b;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #fafafa;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      z-index: 10;
      transition: opacity 0.25s ease;
    }
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid rgba(20, 184, 166, 0.2);
      border-top-color: #14b8a6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 12px;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="loading-overlay">
    <div class="spinner"></div>
    <div style="font-size:13px;font-weight:500">Connecting to PQ Dashboard...</div>
    <div style="font-size:11px;color:#71717a;margin-top:4px">${targetUrl}</div>
  </div>

  <iframe
    id="dashboard-frame"
    src="${targetUrl}"
    allow="clipboard-read; clipboard-write;"
    onload="document.getElementById('loading-overlay').style.display='none';"
  ></iframe>

  <script>
    const vscode = acquireVsCodeApi();
    const frame = document.getElementById('dashboard-frame');

    // Bidirectional message bridge
    window.addEventListener('message', (event) => {
      const data = event.data;
      if (!data) return;
      if (event.source === frame?.contentWindow) {
        // Message from inside dashboard iframe -> send to VS Code extension host
        vscode.postMessage(data);
      } else {
        // Message from VS Code extension host -> forward into dashboard iframe
        try {
          frame?.contentWindow?.postMessage(data, '*');
        } catch (e) {}
      }
    });

    // Fallback: hide loading overlay after 3 seconds
    setTimeout(() => {
      const overlay = document.getElementById('loading-overlay');
      if (overlay) overlay.style.display = 'none';
    }, 3000);
  </script>
</body>
</html>`;
  }
}

module.exports = { DashboardWebviewProvider };
