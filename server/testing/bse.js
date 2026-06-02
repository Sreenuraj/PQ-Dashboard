const { BUILT_IN_TOOLS, toolEvents, normalizeStatus, evidence } = require('./shared');

function runBSE(task, events, rules, baseline, registry = []) {
  const tools = toolEvents(events);
  if (!tools.length) return result('skip', 0, [evidence('info', 'Tool calls', 'No tool calls')], 'No tool calls to validate.');

  const allowed = new Set([...(registry || []), ...BUILT_IN_TOOLS]);
  if (baseline?.expected_tools?.length) baseline.expected_tools.forEach(t => allowed.add(t));
  const destructive = rules.scope_enforcement?.destructive_patterns || [];
  const maxToolCalls = rules.scope_enforcement?.max_tool_calls || 100;
  const findings = [];

  for (const e of tools) {
    if (!allowed.has(e.tool_name)) {
      const severity = /^mcp[_-]|^mcp__/.test(e.tool_name) ? 'warning' : 'critical';
      findings.push(evidence('violation', 'Unknown tool', e.tool_name, severity));
    }
    const text = `${e.command_text || ''} ${e.content_preview || ''}`.toLowerCase();
    for (const p of destructive) {
      if (p && text.includes(String(p).toLowerCase())) findings.push(evidence('violation', 'Destructive command', p, 'critical'));
    }
  }

  if (rules.scope_enforcement?.check_failed_tools) {
    const { extractFailedTools } = require('../baselines/failed-tools');
    const failedTools = extractFailedTools(events);
    for (const f of failedTools) {
      findings.push(evidence('violation', `Failed tool (${f.error_category})`, `${f.tool_name} x${f.count}: ${f.error_message}`, 'warning'));
    }
  }

  if (tools.length > maxToolCalls) findings.push(evidence('violation', 'Max tool calls', `${tools.length}/${maxToolCalls}`, 'warning'));
  const critical = findings.filter(f => f.severity === 'critical').length;
  const warnings = findings.filter(f => f.severity === 'warning').length;
  const score = Math.max(0, 100 - critical * 35 - warnings * 15);
  return result(normalizeStatus(score), score, findings.length ? findings : [
    evidence('info', 'Known tools', `All ${tools.length} tool call(s) matched the registry`),
    evidence('info', 'Destructive commands', 'None detected'),
  ], 'Checked tool calls against known tools and scope rules.');
}

function result(status, score, ev, details) {
  return { pattern: 'bse', label: 'Boundary/Scope Enforcement', status, score, evidence: ev, details };
}

module.exports = { runBSE };
