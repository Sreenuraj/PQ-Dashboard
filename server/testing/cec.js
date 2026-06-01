const { READ_TOOLS, toolEvents, parseToolTarget, normalizeStatus, evidence } = require('./shared');

function runCEC(task, events, rules, baseline) {
  const ctx = events.filter(e => e.sub_type === 'api_req_started' && e.context_pct != null).map(e => e.context_pct);
  const ev = [];
  let penalties = 0;

  if (ctx.length) {
    const max = Math.max(...ctx);
    const warn = rules.context_efficiency?.warn_threshold || 70;
    const critical = rules.context_efficiency?.critical_threshold || 90;
    ev.push(evidence('info', 'Max context', `${max}%`));
    if (max >= critical) { penalties += 35; ev.push(evidence('violation', 'Context ceiling', `${max}% >= ${critical}%`, 'critical')); }
    else if (max >= warn) { penalties += 15; ev.push(evidence('violation', 'Context warning', `${max}% >= ${warn}%`, 'warning')); }
    for (let i = 1; i < ctx.length; i++) {
      const jump = ctx[i] - ctx[i - 1];
      if (jump > 20) { penalties += 10; ev.push(evidence('violation', 'Rapid growth', `${ctx[i - 1]}% -> ${ctx[i]}%`, 'warning')); }
    }
  } else {
    ev.push(evidence('info', 'Context telemetry', 'No context_pct values captured'));
  }

  const readKeys = new Map();
  for (const e of toolEvents(events).filter(e => READ_TOOLS.has(e.tool_name))) {
    const key = parseToolTarget(e) || e.content_preview || e.tool_name;
    readKeys.set(key, (readKeys.get(key) || 0) + 1);
  }
  const redundant = [...readKeys.entries()].filter(([, count]) => count > 2);
  if (redundant.length) {
    penalties += redundant.length * 10;
    ev.push(evidence('violation', 'Redundant reads', redundant.map(([k, c]) => `${k} x${c}`).join(', '), 'warning'));
  }

  if (task.has_context_reset) {
    penalties += 25;
    ev.push(evidence('violation', 'Context condensation', 'Task had a context reset', 'warning'));
  }

  if (baseline?.reference_metrics?.tokens_in) {
    const delta = (task.total_tokens_in || 0) - baseline.reference_metrics.tokens_in;
    if (delta > baseline.reference_metrics.tokens_in * 0.25) {
      penalties += 10;
      ev.push(evidence('violation', 'Baseline token delta', `+${delta} input tokens`, 'warning'));
    }
  }

  const score = Math.max(0, 100 - penalties);
  return result(normalizeStatus(score), score, ev, 'Checked context usage, resets, and redundant reads.');
}

function result(status, score, ev, details) {
  return { pattern: 'cec', label: 'Context Efficiency Compliance', status, score, evidence: ev, details };
}

module.exports = { runCEC };
