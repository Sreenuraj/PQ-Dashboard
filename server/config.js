const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const os = require('os');

const USER_CONFIG_DIR = path.join(os.homedir(), '.pq-dashboard');
const USER_CONFIG_PATH = path.join(USER_CONFIG_DIR, 'pq-config.yaml');
const DEFAULT_CONFIG_PATH = path.join(__dirname, '../pq-config.yaml');

function getConfigPath() {
  if (process.env.PQ_CONFIG_PATH) return process.env.PQ_CONFIG_PATH;
  if (fs.existsSync(USER_CONFIG_PATH)) return USER_CONFIG_PATH;
  if (fs.existsSync(DEFAULT_CONFIG_PATH)) return DEFAULT_CONFIG_PATH;
  return USER_CONFIG_PATH;
}

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

function loadConfig() {
  const cfgPath = getConfigPath();
  let raw = '';
  let config = {};

  if (fs.existsSync(cfgPath)) {
    try {
      raw = fs.readFileSync(cfgPath, 'utf8');
      config = yaml.load(raw) || {};
    } catch (e) {
      console.warn('[config] Error reading config file:', e.message);
      config = {};
    }
  }

  // If no sources exist, or no configured source exists on this machine, auto-populate from detected sources
  const detected = detectAllSources();
  const existingSources = config.sources || [];
  const anyExists = existingSources.some(s => fs.existsSync(resolvePath(s.path)));

  if (!existingSources.length || !anyExists) {
    // Populate with detected sources
    const activeDetected = detected.filter(d => d.exists);
    config.sources = (activeDetected.length ? activeDetected : detected).map(d => ({
      name: d.name,
      path: d.path,
      enabled: d.exists,
    }));
    
    // Auto-save to user config path so it is persisted across extension upgrades
    try {
      if (!fs.existsSync(USER_CONFIG_DIR)) {
        fs.mkdirSync(USER_CONFIG_DIR, { recursive: true });
      }
      fs.writeFileSync(USER_CONFIG_PATH, yaml.dump(config, { indent: 2, lineWidth: -1 }), 'utf8');
    } catch (e) {
      console.warn('[config] Could not write user config:', e.message);
    }
  }

  // Resolve ~ and environment variables in source paths
  config.sources = (config.sources || []).map(s => ({
    ...s,
    resolvedPath: resolvePath(s.path)
  }));

  // Defaults
  config.processing = {
    from_date: null,
    to_date: null,
    max_tasks: null,
    min_task_size: 500,
    skip_empty_tasks: true,
    max_file_size: 10 * 1024 * 1024,
    ...config.processing
  };

  config.cache = {
    db_path: './data/dashboard.db',
    incremental: true,
    ...config.cache
  };

  config.server = {
    port: 3456,
    host: 'localhost',
    ...config.server
  };

  config.proxy = {
    enabled: true,
    port: 3457,
    buffer_size: 2000,
    certs_dir: path.join(USER_CONFIG_DIR, 'proxy-certs'),
    ...config.proxy
  };

  return config;
}

function saveConfig(updates) {
  const cfgPath = getConfigPath();
  let current = {};
  if (fs.existsSync(cfgPath)) {
    try {
      current = yaml.load(fs.readFileSync(cfgPath, 'utf8')) || {};
    } catch {}
  }
  const merged = { ...current, ...updates };

  // 1. Save to ~/.pq-dashboard/pq-config.yaml for persistence
  try {
    if (!fs.existsSync(USER_CONFIG_DIR)) {
      fs.mkdirSync(USER_CONFIG_DIR, { recursive: true });
    }
    fs.writeFileSync(USER_CONFIG_PATH, yaml.dump(merged, { indent: 2, lineWidth: -1 }), 'utf8');
  } catch (e) {
    console.warn('[config] Could not save to ~/.pq-dashboard/pq-config.yaml:', e.message);
  }

  // 2. Also save to bundled config if different and writable
  if (cfgPath !== USER_CONFIG_PATH && fs.existsSync(cfgPath)) {
    try {
      fs.writeFileSync(cfgPath, yaml.dump(merged, { indent: 2, lineWidth: -1 }), 'utf8');
    } catch {}
  }

  return loadConfig();
}

function countTasksInDir(dir) {
  if (!fs.existsSync(dir)) return 0;
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory()).length;
  } catch {
    return 0;
  }
}

function getCandidateSources() {
  const isWindows = process.platform === 'win32';
  const isMac = process.platform === 'darwin';

  if (isWindows) {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return [
      { id: 'vscode-insiders', name: 'VS Code Insiders', path: '~/AppData/Roaming/Code - Insiders/User/globalStorage/postqode.postqode/tasks', fullPath: path.join(appData, 'Code - Insiders', 'User', 'globalStorage', 'postqode.postqode', 'tasks') },
      { id: 'vscode', name: 'VS Code', path: '~/AppData/Roaming/Code/User/globalStorage/postqode.postqode/tasks', fullPath: path.join(appData, 'Code', 'User', 'globalStorage', 'postqode.postqode', 'tasks') },
      { id: 'cursor', name: 'Cursor', path: '~/AppData/Roaming/Cursor/User/globalStorage/postqode.postqode/tasks', fullPath: path.join(appData, 'Cursor', 'User', 'globalStorage', 'postqode.postqode', 'tasks') },
      { id: 'windsurf', name: 'Windsurf', path: '~/AppData/Roaming/Windsurf/User/globalStorage/postqode.postqode/tasks', fullPath: path.join(appData, 'Windsurf', 'User', 'globalStorage', 'postqode.postqode', 'tasks') },
      { id: 'standalone', name: 'PostQode Standalone', path: '~/.postqode/tasks', fullPath: path.join(os.homedir(), '.postqode', 'tasks') },
    ];
  }

  const configBase = isMac ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.config');
  const macPrefix = isMac ? '~/Library/Application Support' : '~/.config';

  return [
    { id: 'vscode-insiders', name: 'VS Code Insiders', path: `${macPrefix}/Code - Insiders/User/globalStorage/postqode.postqode/tasks`, fullPath: path.join(configBase, 'Code - Insiders', 'User', 'globalStorage', 'postqode.postqode', 'tasks') },
    { id: 'vscode', name: 'VS Code', path: `${macPrefix}/Code/User/globalStorage/postqode.postqode/tasks`, fullPath: path.join(configBase, 'Code', 'User', 'globalStorage', 'postqode.postqode', 'tasks') },
    { id: 'cursor', name: 'Cursor', path: `${macPrefix}/Cursor/User/globalStorage/postqode.postqode/tasks`, fullPath: path.join(configBase, 'Cursor', 'User', 'globalStorage', 'postqode.postqode', 'tasks') },
    { id: 'windsurf', name: 'Windsurf', path: `${macPrefix}/Windsurf/User/globalStorage/postqode.postqode/tasks`, fullPath: path.join(configBase, 'Windsurf', 'User', 'globalStorage', 'postqode.postqode', 'tasks') },
    { id: 'standalone', name: 'PostQode Standalone', path: '~/.postqode/tasks', fullPath: path.join(os.homedir(), '.postqode', 'tasks') },
  ];
}

function detectAllSources() {
  const candidates = getCandidateSources();
  return candidates.map(c => {
    const exists = fs.existsSync(c.fullPath);
    const taskCount = exists ? countTasksInDir(c.fullPath) : 0;
    return { ...c, exists, taskCount, active: exists && taskCount > 0 };
  });
}

function getSourcesStatus() {
  const cfg = loadConfig();
  const detected = detectAllSources();
  const configured = (cfg.sources || []).map((s, idx) => {
    const fullPath = resolvePath(s.path);
    const exists = fs.existsSync(fullPath);
    const taskCount = exists ? countTasksInDir(fullPath) : 0;
    return {
      index: idx,
      name: s.name,
      path: s.path,
      fullPath,
      enabled: s.enabled !== false,
      exists,
      taskCount,
    };
  });
  return { configured, detected };
}

function addSource({ name, path: srcPath, enabled = true }) {
  const cfgPath = getConfigPath();
  const current = (fs.existsSync(cfgPath) ? yaml.load(fs.readFileSync(cfgPath, 'utf8')) : {}) || {};
  if (!current.sources) current.sources = [];
  const fullPath = resolvePath(srcPath);
  const exists = fs.existsSync(fullPath);
  const taskCount = exists ? countTasksInDir(fullPath) : 0;

  const existingIdx = current.sources.findIndex(s => resolvePath(s.path) === fullPath);
  if (existingIdx >= 0) {
    current.sources[existingIdx].name = name || current.sources[existingIdx].name;
    current.sources[existingIdx].enabled = enabled;
  } else {
    current.sources.push({
      name: name || path.basename(fullPath) || 'Custom Source',
      path: srcPath,
      enabled,
    });
  }

  saveConfig(current);
  return { ok: true, exists, taskCount, sources: current.sources };
}

function toggleSource(index, enabled) {
  const cfgPath = getConfigPath();
  const current = (fs.existsSync(cfgPath) ? yaml.load(fs.readFileSync(cfgPath, 'utf8')) : {}) || {};
  if (current.sources && current.sources[index]) {
    current.sources[index].enabled = Boolean(enabled);
    saveConfig(current);
    return { ok: true, source: current.sources[index] };
  }
  return { ok: false, error: 'Source index not found' };
}

function removeSource(index) {
  const cfgPath = getConfigPath();
  const current = (fs.existsSync(cfgPath) ? yaml.load(fs.readFileSync(cfgPath, 'utf8')) : {}) || {};
  if (current.sources && current.sources[index]) {
    const removed = current.sources.splice(index, 1);
    saveConfig(current);
    return { ok: true, removed: removed[0] };
  }
  return { ok: false, error: 'Source index not found' };
}

function validateSourcePath(testPath) {
  const fullPath = resolvePath(testPath);
  const exists = fs.existsSync(fullPath);
  const taskCount = exists ? countTasksInDir(fullPath) : 0;
  return { path: testPath, fullPath, exists, taskCount };
}

module.exports = {
  loadConfig,
  saveConfig,
  resolvePath,
  detectAllSources,
  getSourcesStatus,
  addSource,
  toggleSource,
  removeSource,
  validateSourcePath,
  getConfigPath,
  USER_CONFIG_PATH,
  DEFAULT_CONFIG_PATH,
};

