/**
 * Auto-derive human-readable descriptions for tool calls based on
 * tool name, file path, and command context.
 */

const path = require('path');

const FILE_DESCRIPTIONS = [
  { pattern: /readme\.md$/i, desc: 'Read project documentation' },
  { pattern: /package\.json$/i, desc: 'Read project configuration/dependencies' },
  { pattern: /tsconfig\.json$/i, desc: 'Read TypeScript configuration' },
  { pattern: /\.config\.(js|ts|mjs|json|yaml|yml)$/i, desc: 'Read configuration file' },
  { pattern: /pq-config\.yaml$/i, desc: 'Read PQ Dashboard configuration' },
  { pattern: /\.(yaml|yml)$/i, desc: 'Read YAML configuration' },
  { pattern: /\.(env|env\..*)$/i, desc: 'Read environment variables' },
  { pattern: /dockerfile|docker-compose/i, desc: 'Read Docker configuration' },
  { pattern: /\.(test|spec)\.(js|ts|jsx|tsx)$/i, desc: 'Read test file' },
  { pattern: /^(test|tests|__tests__|spec)\//i, desc: 'Read test file' },
  { pattern: /^(src|lib|app)\//i, desc: 'Read source code' },
  { pattern: /^(server|api|backend)\//i, desc: 'Read server code' },
  { pattern: /\.(css|scss|less|sass)$/i, desc: 'Read stylesheet' },
  { pattern: /\.(html|htm|ejs|pug|hbs)$/i, desc: 'Read template/markup' },
  { pattern: /\.(md|txt|rst)$/i, desc: 'Read documentation' },
];

function describeToolCall(toolName, filePath, command) {
  const target = filePath || command || '';

  switch (toolName) {
    // Read tools
    case 'readFile':
    case 'Read':
    case 'read_file':
    case 'FileReadTool':
      return describeFileRead(target);

    // Edit tools
    case 'editedExistingFile':
    case 'Edit':
    case 'write_to_file':
    case 'apply_diff':
    case 'insert_content':
    case 'FileEditTool':
    case 'replace_in_file':
      return describeFileEdit(target);

    // Create tools
    case 'newFileCreated':
    case 'Write':
    case 'FileWriteTool':
      return `Created new file ${basename(target)}`;

    // Command tools
    case 'command':
    case 'Bash':
    case 'execute_command':
    case 'run_terminal_command':
    case 'BashTool':
      return describeCommand(target);

    // Search tools
    case 'searchFiles':
    case 'Grep':
    case 'GrepTool':
    case 'search_files':
      return `Searched codebase${target ? ` for: ${truncate(target, 40)}` : ''}`;

    // List tools
    case 'listFilesRecursive':
    case 'Glob':
    case 'list_files':
      return `Listed directory contents${target ? ` in ${basename(target)}` : ''}`;
    case 'listFilesTopLevel':
      return `Listed top-level files${target ? ` in ${basename(target)}` : ''}`;

    // Code analysis
    case 'listCodeDefinitionNames':
      return `Analyzed code structure${target ? ` of ${basename(target)}` : ''}`;

    // Browser
    case 'postqode_browser_agent':
    case 'browser_action':
      return `Browser automation${target ? `: ${truncate(target, 40)}` : ''}`;

    // MCP tools
    default:
      if (toolName.startsWith('mcp__') || toolName.startsWith('mcp_')) {
        return `MCP tool: ${toolName}${target ? ` → ${truncate(target, 30)}` : ''}`;
      }
      return `${toolName}${target ? ` → ${truncate(target, 40)}` : ''}`;
  }
}

function describeFileRead(filePath) {
  if (!filePath) return 'Read file';
  for (const { pattern, desc } of FILE_DESCRIPTIONS) {
    if (pattern.test(filePath)) return desc;
  }
  return `Read ${basename(filePath)}`;
}

function describeFileEdit(filePath) {
  if (!filePath) return 'Modified file';
  return `Modified ${basename(filePath)}`;
}

function describeCommand(cmd) {
  if (!cmd) return 'Ran command';
  const lower = cmd.toLowerCase().trim();
  if (/^(npm|pnpm|yarn)\s+(run\s+)?test/.test(lower)) return 'Ran tests';
  if (/^(npm|pnpm|yarn)\s+(run\s+)?build/.test(lower)) return 'Built project';
  if (/^(npm|pnpm|yarn)\s+(run\s+)?dev/.test(lower)) return 'Started dev server';
  if (/^(npm|pnpm|yarn)\s+install/.test(lower)) return 'Installed dependencies';
  if (/^git\s+/.test(lower)) return `Ran git command: ${truncate(cmd, 40)}`;
  if (/^(pytest|jest|mocha|vitest)/.test(lower)) return 'Ran tests';
  return `Ran command: ${truncate(cmd, 50)}`;
}

function basename(p) {
  if (!p) return '';
  return path.basename(String(p));
}

function truncate(s, len) {
  if (!s) return '';
  return s.length > len ? `${s.slice(0, len)}…` : s;
}

module.exports = { describeToolCall };
