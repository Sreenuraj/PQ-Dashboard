const fs = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');

/**
 * Multi-IDE Source Detector for PostQode
 * Resolves task directories across VS Code, Insiders, Cursor, Windsurf, and standalone storage.
 */
function resolvePath(p) {
  if (!p) return '';
  let resolved = p.replace(/^~/, os.homedir());
  if (process.platform === 'win32') {
    resolved = resolved.replace(/%APPDATA%/gi, process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'));
    resolved = resolved.replace(/%USERPROFILE%/gi, process.env.USERPROFILE || os.homedir());
    resolved = resolved.replace(/%LOCALAPPDATA%/gi, process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'));
  }
  return path.normalize(resolved);
}

function getCandidateSources() {
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  if (isWindows) {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return [
      {
        id: 'vscode-insiders',
        name: 'VS Code Insiders',
        path: '~/AppData/Roaming/Code - Insiders/User/globalStorage/postqode.postqode/tasks',
        fullPath: path.join(appData, 'Code - Insiders', 'User', 'globalStorage', 'postqode.postqode', 'tasks'),
      },
      {
        id: 'vscode',
        name: 'VS Code',
        path: '~/AppData/Roaming/Code/User/globalStorage/postqode.postqode/tasks',
        fullPath: path.join(appData, 'Code', 'User', 'globalStorage', 'postqode.postqode', 'tasks'),
      },
      {
        id: 'cursor',
        name: 'Cursor',
        path: '~/AppData/Roaming/Cursor/User/globalStorage/postqode.postqode/tasks',
        fullPath: path.join(appData, 'Cursor', 'User', 'globalStorage', 'postqode.postqode', 'tasks'),
      },
      {
        id: 'windsurf',
        name: 'Windsurf',
        path: '~/AppData/Roaming/Windsurf/User/globalStorage/postqode.postqode/tasks',
        fullPath: path.join(appData, 'Windsurf', 'User', 'globalStorage', 'postqode.postqode', 'tasks'),
      },
      {
        id: 'standalone',
        name: 'PostQode Standalone',
        path: '~/.postqode/tasks',
        fullPath: path.join(os.homedir(), '.postqode', 'tasks'),
      },
    ];
  }

  // macOS and Linux
  const configBase = isMac
    ? path.join(os.homedir(), 'Library', 'Application Support')
    : path.join(os.homedir(), '.config');

  const macPrefix = isMac ? '~/Library/Application Support' : '~/.config';

  return [
    {
      id: 'vscode-insiders',
      name: 'VS Code Insiders',
      path: `${macPrefix}/Code - Insiders/User/globalStorage/postqode.postqode/tasks`,
      fullPath: path.join(configBase, 'Code - Insiders', 'User', 'globalStorage', 'postqode.postqode', 'tasks'),
    },
    {
      id: 'vscode',
      name: 'VS Code',
      path: `${macPrefix}/Code/User/globalStorage/postqode.postqode/tasks`,
      fullPath: path.join(configBase, 'Code', 'User', 'globalStorage', 'postqode.postqode', 'tasks'),
    },
    {
      id: 'cursor',
      name: 'Cursor',
      path: `${macPrefix}/Cursor/User/globalStorage/postqode.postqode/tasks`,
      fullPath: path.join(configBase, 'Cursor', 'User', 'globalStorage', 'postqode.postqode', 'tasks'),
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      path: `${macPrefix}/Windsurf/User/globalStorage/postqode.postqode/tasks`,
      fullPath: path.join(configBase, 'Windsurf', 'User', 'globalStorage', 'postqode.postqode', 'tasks'),
    },
    {
      id: 'standalone',
      name: 'PostQode Standalone',
      path: '~/.postqode/tasks',
      fullPath: path.join(os.homedir(), '.postqode', 'tasks'),
    },
  ];
}

function countTasksInDir(dir) {
  if (!fs.existsSync(dir)) return 0;
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).length;
  } catch {
    return 0;
  }
}

function detectAllSources() {
  const candidates = getCandidateSources();
  return candidates.map(c => {
    const exists = fs.existsSync(c.fullPath);
    const taskCount = exists ? countTasksInDir(c.fullPath) : 0;
    return {
      ...c,
      exists,
      taskCount,
      active: exists && taskCount > 0,
    };
  });
}

/**
 * Ensures pq-config.yaml contains all active IDE sources
 */
function syncConfigWithDetectedSources(configPath) {
  const userConfigDir = path.join(os.homedir(), '.pq-dashboard');
  const userConfigPath = path.join(userConfigDir, 'pq-config.yaml');
  const pathsToSync = [configPath];
  if (fs.existsSync(userConfigPath) && !pathsToSync.includes(userConfigPath)) {
    pathsToSync.push(userConfigPath);
  }

  for (const p of pathsToSync) {
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const config = yaml.load(raw) || {};
      const detected = detectAllSources().filter(s => s.exists);

      if (!config.sources) config.sources = [];
      const existingPaths = new Set(config.sources.map(s => resolvePath(s.path)));

      let modified = false;
      for (const d of detected) {
        if (!existingPaths.has(d.fullPath)) {
          config.sources.push({
            name: d.name,
            path: d.path,
            enabled: true,
          });
          modified = true;
        }
      }

      if (modified) {
        fs.writeFileSync(p, yaml.dump(config, { indent: 2, lineWidth: -1 }), 'utf8');
      }
    } catch (e) {
      console.error('[ide-sources] Failed to sync config:', e);
    }
  }
}

module.exports = {
  resolvePath,
  getCandidateSources,
  detectAllSources,
  syncConfigWithDetectedSources,
};
