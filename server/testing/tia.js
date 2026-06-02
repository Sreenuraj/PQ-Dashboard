const { toolEvents, normalizeStatus, evidence } = require('./shared');

function runTIA(task, events, rules, baseline) {
  const actual = [...new Set(toolEvents(events).map(e => e.tool_name))];
  const expected = baseline?.expected_tools?.length
    ? baseline.expected_tools
    : inferExpectedTools(task.first_message || '', rules.tool_invocation?.custom_mappings || []);
  const excluded = baseline?.excluded_tools || [];

  if (!expected.length && !excluded.length) {
    return result('skip', 0, [evidence('info', 'Expectation', 'No tool expectation inferred')], 'No matching tool rule found.');
  }

  const matched = expected.filter(t => actual.includes(t));
  const missing = expected.filter(t => !actual.includes(t));
  const unexpected = actual.filter(t => !expected.includes(t) && !excluded.includes(t));

  // Phase 2: Check excluded tools
  const excludedUsed = excluded.filter(t => actual.includes(t));
  const excludedPenalty = excludedUsed.length * 20;

  const baseScore = expected.length
    ? Math.round((matched.length / Math.max(expected.length, 1)) * (unexpected.length ? 85 : 100))
    : 100;
  const score = Math.max(0, baseScore - excludedPenalty);

  const ev = [
    evidence('expected', 'Expected tools', expected.join(', ') || '-'),
    evidence('actual', 'Actual tools', actual.join(', ') || '-'),
    evidence(missing.length ? 'violation' : 'info', 'Missing', missing.join(', ') || 'None', missing.length ? 'critical' : 'info'),
    evidence(unexpected.length ? 'violation' : 'info', 'Unexpected', unexpected.join(', ') || 'None', unexpected.length ? 'warning' : 'info'),
  ];

  if (excluded.length) {
    ev.push(evidence('info', 'Excluded tools', excluded.join(', ')));
    if (excludedUsed.length) {
      ev.push(evidence('violation', 'Excluded tools USED', excludedUsed.join(', '), 'critical'));
    }
  }

  const status = (matched.length === 0 && expected.length > 0) || excludedUsed.length > 0
    ? (excludedUsed.length ? 'fail' : 'fail')
    : unexpected.length ? 'warn' : normalizeStatus(score);

  return result(status, score, ev,
    baseline ? 'Compared against baseline expected/excluded tool sets.' : 'Compared against heuristic keyword mapping.');
}

function inferExpectedTools(message, mappings) {
  const lower = message.toLowerCase();
  const expected = new Set();
  for (const m of mappings) {
    if ((m.keywords || []).some(k => lower.includes(String(k).toLowerCase()))) {
      (m.expected_tools || []).forEach(t => expected.add(t));
    }
  }
  return [...expected];
}

function result(status, score, ev, details) {
  return { pattern: 'tia', label: 'Tool Invocation Assertion', status, score, evidence: ev, details };
}

module.exports = { runTIA };
