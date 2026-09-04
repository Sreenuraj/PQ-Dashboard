const vscode = require('vscode');
const http = require('http');
const { detectAllSources } = require('./ide-sources');

class DashboardSidebarProvider {
  constructor(serverManager) {
    this.serverManager = serverManager;
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element) {
    return element;
  }

  async getChildren(element) {
    if (!element) {
      // Root categories
      return [
        new CategoryItem('Actions', 'actions', vscode.TreeItemCollapsibleState.Expanded),
        new CategoryItem('PostQode IDE Sources', 'sources', vscode.TreeItemCollapsibleState.Expanded),
        new CategoryItem('Network Proxy', 'proxy', vscode.TreeItemCollapsibleState.Expanded),
        new CategoryItem('Quick Stats', 'stats', vscode.TreeItemCollapsibleState.Expanded),
      ];
    }

    if (element.contextValue === 'actions') {
      return [
        new ActionItem('Open Full Dashboard', 'pq.openDashboard', 'window', 'Open all 18 pages in an editor tab'),
        new ActionItem('Open in Browser', 'pq.openInBrowser', 'browser', `Open ${this.serverManager.serverUrl} externally`),
        new ActionItem('Scan & Refresh Tasks', 'pq.refreshData', 'refresh', 'Scan new/changed tasks across all IDEs'),
        new ActionItem('Configure Sources & Setup', 'pq.openSources', 'gear', 'Manage task directories, auto-detected IDEs, and network proxy'),
        new ActionItem('Run Behavioral Test', 'pq.runTest', 'beaker', 'Execute deterministic test against PostQode task'),
      ];
    }

    if (element.contextValue === 'sources') {
      const sources = detectAllSources();
      const items = sources.map(s => {
        const icon = s.active ? 'pass' : (s.exists ? 'circle-outline' : 'error');
        const desc = s.exists ? `${s.taskCount} tasks` : 'Not installed';
        const tooltip = `${s.name}\nPath: ${s.fullPath}\nTasks: ${s.taskCount}`;
        return new StatItem(s.name, desc, icon, tooltip);
      });
      items.push(new ActionItem('+ Add Custom Task Folder...', 'pq.addSource', 'folder-library', 'Select and index a custom PostQode tasks folder'));
      items.push(new ActionItem('Manage Sources in Dashboard', 'pq.openSources', 'gear', 'Open Sources & Configuration page'));
      return items;
    }

    if (element.contextValue === 'proxy') {
      const currentProxy = vscode.workspace.getConfiguration('http').get('proxy');
      const isRouting = Boolean(currentProxy && currentProxy.includes('3457'));
      let isRunning = false;
      let connectedClients = 0;
      try {
        const status = await this.fetchJson('/api/network/status');
        isRunning = status.running !== false;
        connectedClients = status.clients || 0;
      } catch {}

      return [
        new StatItem('Proxy Server', isRunning ? 'Running (127.0.0.1:3457)' : 'Stopped', isRunning ? 'radio-tower' : 'debug-pause'),
        new StatItem('Traffic Routing', isRouting ? '🟢 Enabled (settings.json)' : '⚪ Direct (No proxy)', isRouting ? 'pass' : 'circle-slash', isRouting ? 'PostQode traffic is routing through proxy' : 'PostQode connects directly to internet'),
        new StatItem('Connected Clients', String(connectedClients), 'plug'),
        new ActionItem(isRouting ? 'Stop Proxy Routing' : 'Enable Proxy Routing (Auto-Configure)', isRouting ? 'pq.stopProxy' : 'pq.startProxy', isRouting ? 'debug-stop' : 'debug-start'),
        new ActionItem('Trust CA Certificate', 'pq.trustCertificate', 'shield', 'Install proxy root certificate into OS trust store for HTTPS decryption'),
      ];
    }

    if (element.contextValue === 'stats') {
      try {
        const data = await this.fetchJson('/api/analytics/overview');
        return [
          new StatItem('Total Sessions', String(data.total_sessions || 0), 'history'),
          new StatItem('Total Cost', `$${Number(data.total_cost || 0).toFixed(2)}`, 'credit-card'),
          new StatItem('Total Errors', String(data.total_errors || 0), 'warning'),
          new StatItem('Top Model', String(data.top_model || '—'), 'symbol-method'),
        ];
      } catch {
        return [new StatItem('Dashboard Server', 'Offline or loading...', 'warning')];
      }
    }

    return [];
  }

  async fetchJson(endpoint) {
    return new Promise((resolve, reject) => {
      const req = http.get(`${this.serverManager.serverUrl}${endpoint}`, { timeout: 2000 }, (res) => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try { resolve(JSON.parse(body)); } catch { resolve({}); }
        });
      });
      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('timeout'));
      });
    });
  }
}

class CategoryItem extends vscode.TreeItem {
  constructor(label, contextValue, collapsibleState) {
    super(label, collapsibleState);
    this.contextValue = contextValue;
  }
}

class ActionItem extends vscode.TreeItem {
  constructor(label, commandId, iconName, tooltip = '') {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.command = { command: commandId, title: label };
    this.iconPath = new vscode.ThemeIcon(iconName);
    this.tooltip = tooltip;
  }
}

class StatItem extends vscode.TreeItem {
  constructor(label, description, iconName, tooltip = '') {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = new vscode.ThemeIcon(iconName);
    this.tooltip = tooltip || `${label}: ${description}`;
  }
}

module.exports = { DashboardSidebarProvider };
