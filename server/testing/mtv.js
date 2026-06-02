const { READ_TOOLS, EDIT_TOOLS, CREATE_TOOLS, COMMAND_TOOLS, SEARCH_TOOLS, toolEvents, parseToolTarget, normalizeStatus, evidence } = require('./shared');

function runMTV(task, events, rules, baseline) {
  const tools = toolEvents(events).map((e, index) => ({ ...e, index, file_path: parseToolTarget(e) }));
  if (tools.length < 2) return result('skip', 0, [evidence('info', 'Tool calls', `${tools.length} tool call(s)`)], 'Trace has fewer than two tool calls.');

  if (baseline?.tool_sequence?.length) {
    return baselineSequence(tools, baseline, events);
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

function baselineSequence(tools, baseline, events) {
  const sequence = baseline.tool_sequence || [];
  const essentialSteps = sequence.filter(s => s.is_essential);
  const actualToolsSet = new Set(tools.map(t => t.tool_name));
  
  // 1. Essential step coverage
  const findings = [];
  let coveredCount = 0;
  
  for (const step of essentialSteps) {
    const match = tools.find(t => t.tool_name === step.tool_name && isTargetMatch(t.file_path, step.file_path));
    if (match) {
      coveredCount++;
      findings.push(evidence('info', `Step covered: "${step.description || step.tool_name}"`, `${match.tool_name} -> ${match.file_path || 'none'}`));
    } else {
      findings.push(evidence('violation', `Missing step: "${step.description || step.tool_name}"`, `${step.tool_name} -> ${step.file_path || 'none'}`, 'critical'));
    }
  }
  
  // 2. Excluded tool check
  const excluded = baseline.excluded_tools || [];
  const excludedUsed = excluded.filter(t => actualToolsSet.has(t));
  for (const t of excludedUsed) {
    findings.push(evidence('violation', 'Excluded tool used', t, 'critical'));
  }
  
  // 3. Efficiency check
  const baselineLength = sequence.length;
  const actualLength = tools.length;
  if (baselineLength > 0 && actualLength > baselineLength * 1.5) {
    findings.push(evidence('violation', 'Efficiency warning', `Used ${actualLength} tool calls compared to baseline ${baselineLength}`, 'warning'));
  } else {
    findings.push(evidence('info', 'Efficiency check', `Used ${actualLength} tool calls (baseline: ${baselineLength})`));
  }
  
  // Compute score
  const coveragePct = essentialSteps.length > 0 ? (coveredCount / essentialSteps.length) : 1;
  let score = Math.round(coveragePct * 100);
  if (excludedUsed.length > 0) {
    score -= excludedUsed.length * 20;
  }
  if (baselineLength > 0 && actualLength > baselineLength * 1.5) {
    const excess = (actualLength - baselineLength) / baselineLength;
    score -= Math.min(20, Math.round(excess * 10));
  }
  score = Math.max(0, Math.min(100, score));
  
  let status = 'pass';
  if (essentialSteps.length > 0 && coveredCount === 0) {
    status = 'fail';
  } else if (excludedUsed.length > 0 || (essentialSteps.length > 0 && (coveredCount / essentialSteps.length) < 0.6)) {
    status = 'fail';
  } else if (coveredCount < essentialSteps.length || actualLength > baselineLength * 1.5) {
    status = 'warn';
  } else {
    status = normalizeStatus(score);
  }
  
  return result(status, score, findings, 'Compared session tool sequence and essential steps against baseline.');
}

function isTargetMatch(pathA, pathB) {
  if (!pathA && !pathB) return true;
  if (!pathA || !pathB) return false;
  const cleanA = pathA.replace(/^[./\\]+/, '').toLowerCase();
  const cleanB = pathB.replace(/^[./\\]+/, '').toLowerCase();
  return cleanA === cleanB || cleanA.endsWith(cleanB) || cleanB.endsWith(cleanA);
}

function result(status, score, ev, details) {
  return { pattern: 'mtv', label: 'Multi-Step Trace Verification', status, score, evidence: ev, details };
}

module.exports = { runMTV };
