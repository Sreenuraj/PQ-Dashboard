/**
 * Extract failed tool attempts from event traces.
 * Identifies tools the agent tried to use but couldn't execute.
 */

function extractFailedTools(events) {
  const failures = [];

  for (const e of events) {
    if (!e.error_message) continue;
    const msg = e.error_message;

    // MCP server not connected
    const mcpMatch = msg.match(/No connection found for server:\s*(\S+)/);
    if (mcpMatch) {
      failures.push({
        tool_name: `mcp:${mcpMatch[1]}`,
        error_message: msg.substring(0, 200),
        error_category: 'mcp_not_connected',
      });
      continue;
    }

    // Missing required parameters
    const paramMatch = msg.match(/tried to use (\S+) without value for required parameter '([^']+)'/);
    if (paramMatch) {
      failures.push({
        tool_name: paramMatch[1],
        error_message: msg.substring(0, 200),
        error_category: 'missing_params',
      });
      continue;
    }

    // Tool execution error
    const execMatch = msg.match(/Error executing (\S+):\s*(.*)/);
    if (execMatch) {
      failures.push({
        tool_name: execMatch[1],
        error_message: execMatch[2].substring(0, 200),
        error_category: 'tool_execution_error',
      });
    }
  }

  // Deduplicate and count
  const map = new Map();
  for (const f of failures) {
    const key = `${f.tool_name}::${f.error_category}`;
    if (map.has(key)) {
      map.get(key).count++;
    } else {
      map.set(key, { ...f, count: 1 });
    }
  }
  return [...map.values()];
}

module.exports = { extractFailedTools };
