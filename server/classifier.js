/**
 * Task Activity Classifier — inspired by CodeBurn's classifier.ts
 *
 * Classifies each task into one of 13 categories based on tool usage
 * patterns and user-message keywords. Also detects edit→bash→edit
 * retry cycles to compute one-shot success rates.
 *
 * All classification is deterministic — no LLM calls.
 */

// ── Keyword patterns (from CodeBurn) ──

const TEST_PATTERNS = /\b(test|pytest|vitest|jest|mocha|spec|coverage|npm\s+test|npx\s+vitest|npx\s+jest|playwright|cypress|selenium)\b/i;
const GIT_PATTERNS  = /\bgit\s+(push|pull|commit|merge|rebase|checkout|branch|stash|log|diff|status|add|reset|cherry-pick|tag)\b/i;
const BUILD_PATTERNS = /\b(npm\s+run\s+build|npm\s+publish|pip\s+install|docker|deploy|make\s+build|npm\s+run\s+dev|npm\s+start|pm2|systemctl|brew|cargo\s+build)\b/i;
const INSTALL_PATTERNS = /\b(npm\s+install|pip\s+install|brew\s+install|apt\s+install|cargo\s+add)\b/i;

const DEBUG_KEYWORDS    = /\b(fix|bug|error|broken|failing|crash|issue|debug|traceback|exception|stack\s*trace|not\s+working|wrong|unexpected)\b/i;
const FEATURE_KEYWORDS  = /\b(add|create|implement|new|build|feature|introduce|set\s*up|scaffold|generate)\b/i;
const REFACTOR_KEYWORDS = /\b(refactor|clean\s*up|rename|reorganize|simplify|extract|restructure|move|migrate|split)\b/i;
const BRAINSTORM_KEYWORDS = /\b(brainstorm|idea|what\s+if|explore|think\s+about|approach|strategy|design|consider|how\s+should|what\s+would|opinion|suggest|recommend)\b/i;
const RESEARCH_KEYWORDS = /\b(research|investigate|look\s+into|find\s+out|check|search|analyze|review|understand|explain|how\s+does|what\s+is|show\s+me|list|compare)\b/i;

// ── Tool name mapping: PostQode tool names → CodeBurn categories ──

const EDIT_TOOLS = new Set([
  'editedExistingFile', 'newFileCreated',
  // Claude Code equivalents if they appear
  'Edit', 'Write', 'FileEditTool', 'FileWriteTool', 'NotebookEdit',
  'write_to_file', 'apply_diff', 'insert_content',
]);

const READ_TOOLS = new Set([
  'readFile', 'listFilesRecursive', 'listFilesTopLevel', 'searchFiles',
  // Claude Code equivalents
  'Read', 'Grep', 'Glob', 'FileReadTool', 'GrepTool', 'GlobTool',
  'read_file', 'list_files', 'search_files',
]);

const BASH_TOOLS = new Set([
  'command', 'command_output',
  // Claude Code equivalents
  'Bash', 'BashTool', 'PowerShellTool',
  'execute_command', 'run_terminal_command',
]);

const TEST_TOOLS = new Set([
  'testStepCreated', 'testCaseCreated', 'testSuiteCreated',
  'listTestSuites', 'fetchTestCase', 'editExistingTestCase',
]);

const API_TOOLS = new Set([
  'executeApiRequest', 'fetchApiRequest', 'updateApiRequest',
  'listApiCollections',
]);

const TASK_TOOLS = new Set([
  'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TaskOutput', 'TaskStop', 'TodoWrite',
]);

const SEARCH_TOOLS = new Set([
  'WebSearch', 'WebFetch', 'ToolSearch',
]);

const SKILL_TOOLS = new Set([
  'useSkill',
  'Skill',
]);

const BROWSER_TOOLS = new Set([
  'postqode_browser_agent',
]);

// ── Valid categories ──

const CATEGORIES = [
  'coding', 'debugging', 'feature', 'refactoring', 'testing',
  'exploration', 'planning', 'delegation', 'git', 'build/deploy',
  'conversation', 'brainstorming', 'general',
];

const CATEGORY_LABELS = {
  'coding':        'Coding',
  'debugging':     'Debugging',
  'feature':       'Feature Dev',
  'refactoring':   'Refactoring',
  'testing':       'Testing',
  'exploration':   'Exploration',
  'planning':      'Planning',
  'delegation':    'Delegation',
  'git':           'Git Ops',
  'build/deploy':  'Build/Deploy',
  'conversation':  'Conversation',
  'brainstorming': 'Brainstorming',
  'general':       'General',
};

const CATEGORY_COLORS = {
  'coding':        '#5B9EF5',
  'debugging':     '#F55B5B',
  'feature':       '#5BF58C',
  'refactoring':   '#F5E05B',
  'testing':       '#E05BF5',
  'exploration':   '#5BF5E0',
  'planning':      '#7B9EF5',
  'delegation':    '#F5C85B',
  'git':           '#CCCCCC',
  'build/deploy':  '#5BF5A0',
  'conversation':  '#888888',
  'brainstorming': '#F55BE0',
  'general':       '#666666',
};

// ── Helpers ──

function hasTools(toolNames, toolSet) {
  return toolNames.some(t => toolSet.has(t));
}

function isMcpTool(name) {
  return name && (name.startsWith('mcp__') || name.startsWith('mcp_'));
}

function hasMcpTools(toolNames) {
  return toolNames.some(isMcpTool);
}

// ── Classify by tool pattern ──

function classifyByToolPattern(toolNames, commandTexts) {
  if (toolNames.length === 0) return null;

  const hasEdits   = hasTools(toolNames, EDIT_TOOLS);
  const hasReads   = hasTools(toolNames, READ_TOOLS);
  const hasBash    = hasTools(toolNames, BASH_TOOLS);
  const hasTests   = hasTools(toolNames, TEST_TOOLS);
  const hasApi     = hasTools(toolNames, API_TOOLS);
  const hasTasks   = hasTools(toolNames, TASK_TOOLS);
  const hasSearch  = hasTools(toolNames, SEARCH_TOOLS);
  const hasMcp     = hasMcpTools(toolNames);
  const hasSkill   = hasTools(toolNames, SKILL_TOOLS);
  const hasBrowser = hasTools(toolNames, BROWSER_TOOLS);

  // Test tools are very specific to PostQode
  if (hasTests) return 'testing';

  // API testing is also specific
  if (hasApi && !hasEdits) return 'testing';

  // Browser automation = exploration/testing
  if (hasBrowser && !hasEdits) return 'exploration';

  // Bash-only (no edits) — check commands for git/test/build patterns
  if (hasBash && !hasEdits) {
    const allCmds = commandTexts.join(' ');
    if (TEST_PATTERNS.test(allCmds)) return 'testing';
    if (GIT_PATTERNS.test(allCmds))  return 'git';
    if (BUILD_PATTERNS.test(allCmds)) return 'build/deploy';
    if (INSTALL_PATTERNS.test(allCmds)) return 'build/deploy';
  }

  // File edits present
  if (hasEdits) return 'coding';

  // Bash + reads (no edits) = exploration
  if (hasBash && hasReads) return 'exploration';
  if (hasBash) return 'coding';

  // MCP or web search = exploration
  if (hasSearch || hasMcp) return 'exploration';
  if (hasReads && !hasEdits) return 'exploration';
  if (hasTasks && !hasEdits) return 'planning';
  if (hasSkill) return 'general';

  return null;
}

// ── Refine by keywords in user message ──

function refineByKeywords(category, userMessage) {
  if (!userMessage) return category;

  if (TEST_PATTERNS.test(userMessage)) {
    return 'testing';
  }

  if (category === 'coding') {
    if (DEBUG_KEYWORDS.test(userMessage))    return 'debugging';
    if (REFACTOR_KEYWORDS.test(userMessage)) return 'refactoring';
    if (FEATURE_KEYWORDS.test(userMessage))  return 'feature';
    return 'coding';
  }

  if (category === 'exploration') {
    if (RESEARCH_KEYWORDS.test(userMessage)) return 'exploration';
    if (DEBUG_KEYWORDS.test(userMessage))    return 'debugging';
    return 'exploration';
  }

  return category;
}

// ── Classify from user message alone (no tools used) ──

function classifyConversation(userMessage) {
  if (!userMessage) return 'conversation';
  if (TEST_PATTERNS.test(userMessage))       return 'testing';
  if (BRAINSTORM_KEYWORDS.test(userMessage)) return 'brainstorming';
  if (RESEARCH_KEYWORDS.test(userMessage))   return 'exploration';
  if (DEBUG_KEYWORDS.test(userMessage))      return 'debugging';
  if (FEATURE_KEYWORDS.test(userMessage))    return 'feature';
  return 'conversation';
}

// ── One-shot / retry detection ──
// Walks events in order and detects Edit→Bash→Edit retry patterns.

function computeOneShotMetrics(events) {
  let editTurns = 0;
  let oneShotTurns = 0;
  let retryCycles = 0;

  let sawEditBeforeBash = false;
  let sawBashAfterEdit = false;
  let currentEditPhase = false;

  for (const e of events) {
    if (!e.tool_name) continue;
    const isEdit = EDIT_TOOLS.has(e.tool_name);
    const isBash = BASH_TOOLS.has(e.tool_name);

    if (isEdit) {
      if (!currentEditPhase) {
        // Starting a new edit turn
        editTurns++;
        currentEditPhase = true;

        if (sawBashAfterEdit) {
          // This is a retry — previous edit turn was followed by bash, now editing again
          retryCycles++;
        } else if (editTurns > 1 || sawEditBeforeBash) {
          // Previous edit turn was successful (no bash→re-edit cycle)
          // We count the *previous* turn as one-shot
        }
      }
      sawEditBeforeBash = true;
      sawBashAfterEdit = false;
    }

    if (isBash && sawEditBeforeBash) {
      sawBashAfterEdit = true;
      currentEditPhase = false;
    }

    // Non-edit, non-bash tool resets the phase tracking
    if (!isEdit && !isBash) {
      currentEditPhase = false;
    }
  }

  // Simpler, more accurate approach: count retry cycles directly
  // Walk events and count Edit→Bash→Edit sequences
  retryCycles = 0;
  editTurns = 0;
  oneShotTurns = 0;

  let phase = 'idle'; // idle → editing → bashing → (editing again = retry)
  let editGroupCount = 0;
  let retryInCurrentGroup = false;

  for (const e of events) {
    if (!e.tool_name) continue;
    const isEdit = EDIT_TOOLS.has(e.tool_name);
    const isBash = BASH_TOOLS.has(e.tool_name);

    if (isEdit) {
      if (phase === 'bashing') {
        // Edit after bash = potential retry
        retryInCurrentGroup = true;
        retryCycles++;
        phase = 'editing';
      } else if (phase !== 'editing') {
        // New edit group
        if (editGroupCount > 0) {
          // Close previous group
          if (!retryInCurrentGroup) oneShotTurns++;
        }
        editGroupCount++;
        retryInCurrentGroup = false;
        phase = 'editing';
      }
    } else if (isBash && phase === 'editing') {
      phase = 'bashing';
    } else if (!isEdit && !isBash) {
      // Other tool — close current group if active
      if (phase === 'editing' || phase === 'bashing') {
        if (editGroupCount > 0 && !retryInCurrentGroup) {
          // Only count as one-shot if we didn't already count it
        }
      }
      // Don't reset — edit→read→bash is still a valid sequence
    }
  }

  // Close final group
  if (editGroupCount > 0 && !retryInCurrentGroup) {
    oneShotTurns++;
  }

  editTurns = editGroupCount;

  return { editTurns, oneShotTurns, retryCycles };
}

// ── Extract shell command base names ──
// "npm install express" → "npm", "git push" → "git"

function extractShellCommands(events) {
  const counts = {};

  for (const e of events) {
    if (!e.command_text) continue;
    const cmd = e.command_text.trim();
    if (!cmd) continue;

    // Extract base command (first word)
    const base = cmd.split(/\s+/)[0]
      .replace(/^[./~]+/, '')   // strip leading ./ ~/ etc
      .replace(/["']/g, '')     // strip quotes
      .toLowerCase();

    if (base && base.length > 0 && base.length < 30) {
      counts[base] = (counts[base] || 0) + 1;
    }
  }

  return counts;
}

// ── Main classifier ──

/**
 * Classify a task based on its events and first user message.
 *
 * @param {Array} events - Array of event objects from the events table
 * @param {string} firstMessage - The first user message text
 * @returns {{ category: string, editTurns: number, oneShotTurns: number, retryCycles: number, shellCommands: Object }}
 */
function classifyTask(events, firstMessage) {
  const toolNames = events
    .filter(e => e.tool_name && e.tool_name !== 'unknown')
    .map(e => e.tool_name);

  const commandTexts = events
    .filter(e => e.command_text)
    .map(e => e.command_text);

  let category;

  if (toolNames.length === 0) {
    category = classifyConversation(firstMessage);
  } else {
    const toolCategory = classifyByToolPattern(toolNames, commandTexts);
    if (toolCategory) {
      category = refineByKeywords(toolCategory, firstMessage);
    } else {
      category = classifyConversation(firstMessage);
    }
  }

  const oneshotMetrics = computeOneShotMetrics(events);
  const shellCommands = extractShellCommands(events);

  return {
    category,
    editTurns: oneshotMetrics.editTurns,
    oneShotTurns: oneshotMetrics.oneShotTurns,
    retryCycles: oneshotMetrics.retryCycles,
    shellCommands,
  };
}

module.exports = {
  classifyTask,
  CATEGORIES,
  CATEGORY_LABELS,
  CATEGORY_COLORS,
};
