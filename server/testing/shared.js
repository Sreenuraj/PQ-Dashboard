const READ_TOOLS = new Set(['readFile', 'Read', 'read_file', 'FileReadTool']);
const EDIT_TOOLS = new Set(['editedExistingFile', 'Edit', 'write_to_file', 'apply_diff', 'insert_content', 'FileEditTool']);
const CREATE_TOOLS = new Set(['newFileCreated', 'Write', 'write_to_file', 'FileWriteTool']);
const COMMAND_TOOLS = new Set(['command', 'Bash', 'execute_command', 'run_terminal_command', 'BashTool']);
const SEARCH_TOOLS = new Set(['searchFiles', 'Grep', 'GrepTool', 'search_files', 'listFilesRecursive', 'Glob', 'list_files']);
const BUILT_IN_TOOLS = new Set([
  ...READ_TOOLS, ...EDIT_TOOLS, ...CREATE_TOOLS, ...COMMAND_TOOLS, ...SEARCH_TOOLS,
  'listFilesTopLevel', 'postqode_browser_agent', 'command_output', 'TodoWrite',
  'executeApiRequest', 'fetchApiRequest', 'updateApiRequest', 'listApiCollections',
  'testStepCreated', 'testCaseCreated', 'testSuiteCreated', 'listTestSuites',
  'fetchTestCase', 'editExistingTestCase', 'WebSearch', 'WebFetch', 'ToolSearch',
]);

function toolEvents(events) {
  return events.filter(e => e.tool_name && e.tool_name !== 'unknown');
}

function parseToolTarget(event) {
  const text = event.content_preview || '';
  const afterArrow = text.includes('→') ? text.split('→').slice(1).join('→').trim() : '';
  if (!afterArrow) return null;
  if (/^(npm|pnpm|yarn|node|python|pytest|mvn|git|cargo|go|java)\b/i.test(afterArrow)) return null;
  return afterArrow.split(/\s+/)[0] || null;
}

function normalizeStatus(score, skipped = false) {
  if (skipped) return 'skip';
  if (score >= 80) return 'pass';
  if (score >= 40) return 'warn';
  return 'fail';
}

function evidence(type, label, value, severity = 'info') {
  return { type, label, value: value == null ? '' : String(value), severity };
}

function getFinalOutput(events) {
  const completion = [...events].reverse().find(e => e.sub_type === 'completion_result' && (e.response_text || e.content_preview));
  if (completion) return completion.response_text || completion.content_preview || '';
  const apiResponse = [...events].reverse().find(e => e.response_text);
  if (apiResponse) return apiResponse.response_text || '';
  const text = [...events].reverse().find(e => e.sub_type === 'text' && e.content_preview);
  return text?.content_preview || '';
}

function getPrimaryModel(task) {
  return task.models?.[0]?.model_id || task.model_id || null;
}

function countInterruptions(events, task) {
  let count = 0;
  // resume_task events = user hit stop and resumed
  count += events.filter(e => e.sub_type === 'resume_task').length;
  // Context resets
  if (task.has_context_reset) count++;
  return count;
}

function getCompletionMessage(events) {
  // Find the completion_result event with type 'say' — contains the agent's summary
  const completion = [...events].reverse().find(
    e => e.sub_type === 'completion_result' && e.type === 'say'
  );
  if (!completion) return null;
  // The text content is stored in content_preview or response_text
  return completion.content_preview || completion.response_text || null;
}

// Phase 3: Excluded files pattern matching
function matchesExcludedPattern(filePath, patterns) {
  if (!patterns || !patterns.length) return false;
  const lower = filePath.toLowerCase();
  for (const pattern of patterns) {
    const lowerPattern = pattern.toLowerCase().trim();
    if (!lowerPattern) continue;

    // Exact match
    if (lower === lowerPattern) return true;

    // Glob: **/pattern matches anywhere in path
    if (lowerPattern.startsWith('**/')) {
      const suffix = lowerPattern.slice(3);
      if (lower.endsWith(suffix) || lower.includes('/' + suffix)) return true;
    }

    // Glob: pattern/** matches directory prefix
    if (lowerPattern.endsWith('/**')) {
      const prefix = lowerPattern.slice(0, -2);
      if (lower.startsWith(prefix)) return true;
    }

    // Glob: *.ext matches files with extension
    if (lowerPattern.includes('*')) {
      const regexStr = '^' + lowerPattern.replace(/\*/g, '[^/]*') + '$';
      try {
        if (new RegExp(regexStr).test(lower)) return true;
      } catch (e) { /* invalid regex, skip */ }
    }

    // Substring match (fallback)
    if (lower.includes(lowerPattern)) return true;
  }
  return false;
}

module.exports = {
  READ_TOOLS,
  EDIT_TOOLS,
  CREATE_TOOLS,
  COMMAND_TOOLS,
  SEARCH_TOOLS,
  BUILT_IN_TOOLS,
  toolEvents,
  parseToolTarget,
  normalizeStatus,
  evidence,
  getFinalOutput,
  getPrimaryModel,
  countInterruptions,
  getCompletionMessage,
  matchesExcludedPattern,
};
