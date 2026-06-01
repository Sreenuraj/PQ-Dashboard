const { READ_TOOLS, EDIT_TOOLS, CREATE_TOOLS, COMMAND_TOOLS, SEARCH_TOOLS, toolEvents, parseToolTarget, normalizeStatus, evidence } = require('./shared');

function runMTV(task, events, rules, baseline) {
  const tools = toolEvents(events).map((e, index) => ({ ...e, index, file_path: parseToolTarget(e) }));
  if (tools.length < 2) return result('skip', 0, [evidence('info', 'Tool calls', `${tools.length} tool call(s)`)], 'Trace has fewer than two tool calls.');

  if (baseline?.tool_sequence?.length) {
    return baselineSequence(tools, baseline.tool_sequence);
  }

  const checks = [];
  const hasReasoningBeforeTool = events.findIndex(e => e.sub_type === 'reasoning') !== -1
    && events.findIndex(e => e.sub_type === 'reasoning') < events.findIndex(e => e.tool_name);
  checks.push({ ok: hasReasoningBeforeTool, label: 'think_before_act', value: hasReasoningBeforeTool ? 'Reasoning preceded first tool' : 'No reasoning before first tool', severity: 'warning' });

  for (const edit of tools.filter(t => EDIT_TOOLS.has(t.tool_name))) {
    const samePathRead = tools.some(t => t.index < edit.index && READ_TOOLS.has(t.tool_name) && (!edit.file_path || t.file_path === edit.file_path));
    checks.push({ ok: samePathRead, label: 'read_before_edit', value: edit.file_path || edit.tool_name, severity: 'critical' });
  }

  for (const created of tools.filter(t => CREATE_TOOLS.has(t.tool_name))) {
    const searched = tools.some(t => t.index < created.index && (SEARCH_TOOLS.has(t.tool_name) || READ_TOOLS.has(t.tool_name)));
    if (rules.trace_verification?.rules?.search_before_create) {
      checks.push({ ok: searched, label: 'search_before_create', value: created.file_path || created.tool_name, severity: 'warning' });
    }
  }

  if (rules.trace_verification?.rules?.test_after_edit) {
    const lastEdit = Math.max(...tools.filter(t => EDIT_TOOLS.has(t.tool_name)).map(t => t.index), -1);
    if (lastEdit >= 0) {
      const tested = tools.some(t => t.index > lastEdit && COMMAND_TOOLS.has(t.tool_name) && /test|spec|check|verify/i.test(t.command_text || t.content_preview || ''));
      checks.push({ ok: tested, label: 'test_after_edit', value: tested ? 'Test command found after edit' : 'No test command after edit', severity: 'warning' });
    }
  }

  const applicable = checks.length ? checks : [{ ok: true, label: 'sequence', value: 'No risky sequence rules applied' }];
  const passed = applicable.filter(c => c.ok).length;
  const score = Math.round((passed / applicable.length) * 100);
  return result(normalizeStatus(score), score, applicable.map(c => evidence(c.ok ? 'info' : 'violation', c.label, c.value, c.ok ? 'info' : c.severity)), 'Verified tool ordering against deterministic sequence rules.');
}

function baselineSequence(tools, sequence) {
  const expected = sequence.map(s => s.tool_name);
  const actual = tools.map(t => t.tool_name);
  let matches = 0;
  for (let i = 0; i < Math.min(expected.length, actual.length); i++) {
    if (expected[i] === actual[i]) matches++;
  }
  const lengthPenalty = Math.abs(expected.length - actual.length);
  const score = Math.max(0, Math.round((matches / Math.max(expected.length, 1)) * 100 - lengthPenalty * 3));
  return result(normalizeStatus(score), score, [
    evidence('expected', 'Baseline sequence', expected.join(' -> ')),
    evidence('actual', 'Actual sequence', actual.join(' -> ')),
    evidence(score >= 80 ? 'info' : 'violation', 'Aligned positions', `${matches}/${expected.length}`),
  ], 'Compared ordered tool sequence against the baseline.');
}

function result(status, score, ev, details) {
  return { pattern: 'mtv', label: 'Multi-Step Trace Verification', status, score, evidence: ev, details };
}

module.exports = { runMTV };
