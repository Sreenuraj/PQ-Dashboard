const fs = require('fs');
const path = require('path');

/**
 * Scans source directories, applies filters, returns list of task paths to process.
 */
function scanTasks(config) {
  const { sources, processing } = config;
  const fromTs = processing.from_date ? new Date(processing.from_date).getTime() : 0;
  const toTs = processing.to_date ? new Date(processing.to_date).getTime() : Infinity;

  const allTasks = [];

  for (const source of sources) {
    if (!source.enabled) continue;

    const dir = source.resolvedPath;
    if (!fs.existsSync(dir)) {
      console.warn(`[scanner] Source not found: ${dir}`);
      continue;
    }

    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (e) {
      console.warn(`[scanner] Cannot read: ${dir} — ${e.message}`);
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Task IDs are epoch timestamps
      const taskId = entry.name;
      const ts = parseInt(taskId, 10);
      if (isNaN(ts)) continue;

      // Date range filter
      if (ts < fromTs || ts > toTs) continue;

      const taskPath = path.join(dir, taskId);

      // Min size filter — check ui_messages.json size
      const uiFile = path.join(taskPath, 'ui_messages.json');
      if (!fs.existsSync(uiFile)) {
        if (processing.skip_empty_tasks) continue;
      } else {
        const stat = fs.statSync(uiFile);
        if (stat.size < processing.min_task_size) continue;
      }

      allTasks.push({
        id: taskId,
        ts,
        source: source.name,
        path: taskPath,
        uiMessagesPath: fs.existsSync(uiFile) ? uiFile : null,
        metadataPath: getIfExists(taskPath, 'task_metadata.json'),
        apiHistoryPath: getIfExists(taskPath, 'api_conversation_history.json'),
        contextHistoryPath: getIfExists(taskPath, 'context_history.json'),
        focusChainPath: findFocusChain(taskPath),
      });
    }
  }

  // Sort by timestamp descending (newest first)
  allTasks.sort((a, b) => b.ts - a.ts);

  // Apply max_tasks limit
  if (processing.max_tasks && allTasks.length > processing.max_tasks) {
    return allTasks.slice(0, processing.max_tasks);
  }

  return allTasks;
}

function getIfExists(dir, filename) {
  const p = path.join(dir, filename);
  return fs.existsSync(p) ? p : null;
}

function findFocusChain(taskPath) {
  try {
    const files = fs.readdirSync(taskPath);
    const f = files.find(f => f.startsWith('focus_chain_taskid_') && f.endsWith('.md'));
    return f ? path.join(taskPath, f) : null;
  } catch {
    return null;
  }
}

module.exports = { scanTasks };
