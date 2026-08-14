const yaml = require('js-yaml');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CONFIG_PATH = path.join(__dirname, '../pq-config.yaml');

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
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = yaml.load(raw);

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

  return config;
}

function saveConfig(updates) {
  const current = yaml.load(fs.readFileSync(CONFIG_PATH, 'utf8'));
  const merged = { ...current, ...updates };
  fs.writeFileSync(CONFIG_PATH, yaml.dump(merged), 'utf8');
  return loadConfig();
}

module.exports = { loadConfig, saveConfig };
