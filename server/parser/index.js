const crypto = require('crypto');
const fs = require('fs');
const { scanTasks } = require('./task-scanner');
const { parseUIMessages, setModelRegistry } = require('./ui-messages');
const { parseMetadata, parseFocusChain } = require('./metadata');
const { getDB, isTaskCached, saveTask, markParsed } = require('../cache/db');
const { getModelInfo } = require('../model-registry');
const { classifyTask } = require('../classifier');

function fileHash(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return 'none';
  const stat = fs.statSync(filePath);
  return `${stat.size}-${stat.mtimeMs}`;
}

async function runParser(config, onProgress) {
  // Wire model registry into the parser for context_pct computation
  setModelRegistry(getModelInfo);
  const db = getDB(config.cache.db_path);
  const tasks = scanTasks(config);

  console.log(`[parser] Found ${tasks.length} tasks to process`);

  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const task of tasks) {
    try {
      const hash = fileHash(task.uiMessagesPath);

      if (config.cache.incremental && isTaskCached(db, task.id, hash)) {
        skipped++;
        if (onProgress) onProgress({ processed, skipped, errors, total: tasks.length, taskId: task.id, status: 'cached' });
        continue;
      }

      const { events, summary } = parseUIMessages(
        task.uiMessagesPath,
        task.apiConversationHistoryPath,
        config.processing.max_file_size
      );

      if (summary.skipped) {
        skipped++;
        continue;
      }

      const metadata = parseMetadata(task.metadataPath);
      const focusCompletion = parseFocusChain(task.focusChainPath);
      const hasContextReset = !!task.contextHistoryPath;

      // CodeBurn-inspired activity classification
      const classification = classifyTask(events, summary.first_message);

      saveTask(db, task.id, task.source, summary, metadata, focusCompletion, events, hasContextReset, classification);
      markParsed(db, task.id, task.source, hash);

      processed++;
      if (onProgress) onProgress({ processed, skipped, errors, total: tasks.length, taskId: task.id, status: 'parsed' });

    } catch (e) {
      console.error(`[parser] Error on task ${task.id}: ${e.message}`);
      errors++;
    }
  }

  console.log(`[parser] Done — parsed: ${processed}, cached: ${skipped}, errors: ${errors}`);
  return { processed, skipped, errors, total: tasks.length };
}

module.exports = { runParser };
