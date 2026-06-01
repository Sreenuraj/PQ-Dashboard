const { toolEvents, normalizeStatus, evidence } = require('./shared');

function runERC(task, events, rules, baseline) {
  const errors = events.filter(e => e.error_category || e.sub_type === 'error');
  if (!errors.length) return result('skip', 0, [evidence('info', 'Errors', 'No errors in trace')], 'No recovery needed.');

  let blindRetries = 0;
  let adaptive = 0;
  const ev = [];
  for (const err of errors) {
    const before = [...toolEvents(events.filter(e => (e.ts || 0) < (err.ts || 0)))].pop();
    const after = toolEvents(events.filter(e => (e.ts || 0) > (err.ts || 0)))[0];
    if (!after) {
      ev.push(evidence('violation', 'Abandoned after error', err.error_category || err.sub_type, task.status === 'completed' ? 'warning' : 'critical'));
      continue;
    }
    const same = before && before.tool_name === after.tool_name && (before.content_preview || '') === (after.content_preview || '');
    if (same) {
      blindRetries++;
      ev.push(evidence('violation', 'Blind retry', after.tool_name, 'warning'));
    } else {
      adaptive++;
      ev.push(evidence('info', 'Adaptive recovery', `${before?.tool_name || 'none'} -> ${after.tool_name}`));
    }
  }

  const baselineErrors = baseline?.reference_metrics?.error_count;
  if (baselineErrors != null && errors.length > baselineErrors) {
    ev.push(evidence('violation', 'Baseline error delta', `${errors.length} vs ${baselineErrors}`, 'warning'));
  }

  const allowedBlind = rules.error_recovery?.max_blind_retries || 2;
  const score = Math.max(0, 100 - blindRetries * 25 - Math.max(0, errors.length - adaptive - blindRetries) * 15 - Math.max(0, blindRetries - allowedBlind) * 20);
  return result(normalizeStatus(score), score, ev, 'Analyzed actions before and after error events.');
}

function result(status, score, ev, details) {
  return { pattern: 'erc', label: 'Error Recovery Coherence', status, score, evidence: ev, details };
}

module.exports = { runERC };
