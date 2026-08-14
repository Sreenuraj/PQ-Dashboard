/**
 * Platform Config Initializer for PQ Dashboard
 * Auto-detects the operating system and scans for active PostQode / IDE task directories.
 * Updates pq-config.yaml with valid local paths if existing paths are for another OS.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const yaml = require('js-yaml');

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

function getWindowsCandidates() {
  const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return [
    {
      name: 'VS Code Insiders',
      path: '~/AppData/Roaming/Code - Insiders/User/globalStorage/postqode.postqode/tasks',
      fullPath: path.join(appData, 'Code - Insiders', 'User', 'globalStorage', 'postqode.postqode', 'tasks'),
    },
    {
      name: 'VS Code',
      path: '~/AppData/Roaming/Code/User/globalStorage/postqode.postqode/tasks',
      fullPath: path.join(appData, 'Code', 'User', 'globalStorage', 'postqode.postqode', 'tasks'),
    },
    {
      name: 'Cursor',
      path: '~/AppData/Roaming/Cursor/User/globalStorage/postqode.postqode/tasks',
      fullPath: path.join(appData, 'Cursor', 'User', 'globalStorage', 'postqode.postqode', 'tasks'),
    },
    {
      name: 'Windsurf',
      path: '~/AppData/Roaming/Windsurf/User/globalStorage/postqode.postqode/tasks',
      fullPath: path.join(appData, 'Windsurf', 'User', 'globalStorage', 'postqode.postqode', 'tasks'),
    },
    {
      name: 'PostQode Standalone',
      path: '~/.postqode/tasks',
      fullPath: path.join(os.homedir(), '.postqode', 'tasks'),
    },
  ];
}

function getMacCandidates() {
  return [
    {
      name: 'VS Code Insiders',
      path: '~/Library/Application Support/Code - Insiders/User/globalStorage/postqode.postqode/tasks',
      fullPath: path.join(os.homedir(), 'Library', 'Application Support', 'Code - Insiders', 'User', 'globalStorage', 'postqode.postqode', 'tasks'),
    },
    {
      name: 'VS Code',
      path: '~/Library/Application Support/Code/User/globalStorage/postqode.postqode/tasks',
      fullPath: path.join(os.homedir(), 'Library', 'Application Support', 'Code', 'User', 'globalStorage', 'postqode.postqode', 'tasks'),
    },
    {
      name: 'Cursor',
      path: '~/Library/Application Support/Cursor/User/globalStorage/postqode.postqode/tasks',
      fullPath: path.join(os.homedir(), 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'postqode.postqode', 'tasks'),
    },
    {
      name: 'Windsurf',
      path: '~/Library/Application Support/Windsurf/User/globalStorage/postqode.postqode/tasks',
      fullPath: path.join(os.homedir(), 'Library', 'Application Support', 'Windsurf', 'User', 'globalStorage', 'postqode.postqode', 'tasks'),
    },
  ];
}

function initPlatformConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.log('  ⚠️ pq-config.yaml not found.');
    return;
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const config = yaml.load(raw) || {};
    const isWindows = process.platform === 'win32';

    const currentSources = config.sources || [];
    const hasAnyExistingPath = currentSources.some(s => {
      const resolved = resolvePath(s.path);
      return fs.existsSync(resolved);
    });

    // Check if paths are Mac-style while running on Windows
    const hasMacStylePaths = currentSources.some(s => s.path && s.path.includes('Library/Application Support'));
    const hasWinStylePaths = currentSources.some(s => s.path && (s.path.includes('AppData') || s.path.includes('\\')));

    let needsUpdate = false;
    let newSources = [];

    if (isWindows) {
      const candidates = getWindowsCandidates();
      const detected = candidates.filter(c => fs.existsSync(c.fullPath));

      if (hasMacStylePaths || !hasAnyExistingPath || detected.length > 0) {
        // Construct optimized Windows sources
        newSources = candidates.map(c => {
          const exists = fs.existsSync(c.fullPath);
          return {
            name: c.name,
            path: c.path,
            enabled: exists || c.name === 'VS Code Insiders' || c.name === 'VS Code',
          };
        });
        needsUpdate = true;
        console.log(`  🔍 Windows detected: Found ${detected.length} active PostQode source(s)`);
        detected.forEach(d => console.log(`     ✓ ${d.name}: ${d.path}`));
      }
    } else {
      // macOS / Linux
      if (hasWinStylePaths && !hasAnyExistingPath) {
        const candidates = getMacCandidates();
        newSources = candidates.map(c => ({
          name: c.name,
          path: c.path,
          enabled: fs.existsSync(c.fullPath) || c.name === 'VS Code Insiders' || c.name === 'VS Code',
        }));
        needsUpdate = true;
      }
    }

    if (needsUpdate && newSources.length > 0) {
      config.sources = newSources;
      fs.writeFileSync(CONFIG_PATH, yaml.dump(config), 'utf8');
      console.log('  ✅ Updated pq-config.yaml with platform-specific IDE source paths');
    }
  } catch (err) {
    console.warn('  ⚠️ Could not auto-update pq-config.yaml:', err.message);
  }
}

if (require.main === module) {
  initPlatformConfig();
}

module.exports = { initPlatformConfig };
