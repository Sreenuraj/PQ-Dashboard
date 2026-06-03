const { toolEvents, normalizeStatus, evidence } = require('./shared');

function runTIA(task, events, rules, baseline) {
  const actual = [...new Set(toolEvents(events).map(e => e.tool_name))];
  const expectedRaw = baseline?.expected_tools?.length
    ? baseline.expected_tools
    : inferExpectedTools(task.first_message || '', rules.tool_invocation?.custom_mappings || []);
  // Phase 3: Handle both legacy strings and new objects with is_essential
  const expected = expectedRaw.map(t => typeof t === 'string' ? { name: t, is_essential: true } : t);
  const excluded = baseline?.excluded_tools || [];

  if (!expected.length && !excluded.length) {
    return result('skip', 0, [evidence('info', 'Expectation', 'No tool expectation inferred')], 'No matching tool rule found.');
  }

  // Phase 3: Separate essential and optional tools
  const essentialExpected = expected.filter(t => t.is_essential);
  const optionalExpected = expected.filter(t => !t.is_essential);

  const essentialMatched = essentialExpected.filter(t => actual.includes(t.name));
  const essentialMissing = essentialExpected.filter(t => !actual.includes(t.name));
  const essentialScore = essentialExpected.length > 0
    ? Math.round((essentialMatched.length / essentialExpected.length) * 100)
    : 100;

  const optionalMatched = optionalExpected.filter(t => actual.includes(t.name));
  const optionalMissing = optionalExpected.filter(t => !actual.includes(t.name));

  const expectedNames = expected.map(t => t.name);
  const unexpected = actual.filter(t => !expectedNames.includes(t) && !excluded.includes(t));

  // Phase 2: Check excluded tools
  const excludedUsed = excluded.filter(t => actual.includes(t));

  // Phase 3: Essential-aware scoring
  let score = essentialScore;
  if (unexpected.length > 0) score = Math.round(score * 0.85);
  score = Math.max(0, score - excludedUsed.length * 20);

  // Phase 3: Evidence with essential/optional breakdown
  const ev = [];
  if (essentialExpected.length) {
    ev.push(evidence('expected', 'Essential tools', essentialExpected.map(t => t.name).join(', ')));
    ev.push(evidence(essentialMissing.length ? 'violation' : 'info', 'Essential matched',
      `${essentialMatched.length}/${essentialExpected.length}`, essentialMissing.length ? 'critical' : 'info'));
    if (essentialMissing.length) {
      ev.push(evidence('violation', 'Essential tools MISSING', essentialMissing.map(t => t.name).join(', '), 'critical'));
    }
  }
  if (optionalExpected.length) {
    ev.push(evidence('info', 'Optional tools', optionalExpected.map(t => t.name).join(', ')));
    ev.push(evidence('info', 'Optional matched', `${optionalMatched.length}/${optionalExpected.length}`));
    if (optionalMissing.length) {
      ev.push(evidence('info', 'Optional tools not used', optionalMissing.map(t => t.name).join(', ')));
    }
  }
  ev.push(evidence('actual', 'Actual tools', actual.join(', ') || '-'));
  if (unexpected.length) {
    ev.push(evidence('violation', 'Unexpected tools', unexpected.join(', '), 'warning'));
  }
  if (excluded.length) {
    ev.push(evidence('info', 'Excluded tools', excluded.join(', ')));
    if (excludedUsed.length) {
      ev.push(evidence('violation', 'Excluded tools USED', excludedUsed.join(', '), 'critical'));
    }
  }

  // Phase 3: Status based on essential coverage
  let status;
  if (essentialMissing.length > 0 || excludedUsed.length > 0) {
    status = 'fail';
  } else if (unexpected.length > 0 || optionalMissing.length > 0) {
    status = 'warn';
  } else {
    status = normalizeStatus(score);
  }

  return result(status, score, ev,
    baseline ? 'Compared against baseline expected/excluded tool sets (essential-aware).' : 'Compared against heuristic keyword mapping.');
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
