const { getFinalOutput, normalizeStatus, evidence } = require('./shared');

function runBCV(task, events, rules, baseline) {
  const output = getFinalOutput(events);
  if (!output) return result('skip', 0, [evidence('info', 'Output', 'No final output captured')], 'No final response was available.');

  const contract = baseline?.behavior_contract || inferContract(task, rules);
  if (!contract || Object.keys(contract).length === 0) {
    return result('skip', 0, [evidence('info', 'Contract', 'No behavior contract defined')], 'No contract rules applied.');
  }

  const checks = [];
  if (contract.has_code_block) checks.push(check(/```/.test(output), 'has_code_block', 'Expected at least one fenced code block'));
  if (contract.output_min_length || contract.min_length) {
    const min = contract.output_min_length || contract.min_length;
    checks.push(check(output.length >= min, 'min_length', `${output.length} chars, minimum ${min}`));
  }
  if (contract.output_max_length || contract.max_length) {
    const max = contract.output_max_length || contract.max_length;
    checks.push(check(output.length <= max, 'max_length', `${output.length} chars, maximum ${max}`));
  }
  if (contract.output_keywords?.length) {
    const missing = contract.output_keywords.filter(k => !output.toLowerCase().includes(String(k).toLowerCase()));
    checks.push(check(missing.length <= Math.ceil(contract.output_keywords.length / 2), 'baseline_keywords', missing.length ? `Missing: ${missing.join(', ')}` : 'Matched baseline keywords'));
  }
  if (contract.must_include?.length) {
    const missing = contract.must_include.filter(k => !output.toLowerCase().includes(String(k).toLowerCase()));
    checks.push(check(missing.length === 0, 'must_include', missing.length ? `Missing: ${missing.join(', ')}` : 'All present'));
  }
  if (contract.must_include_any?.length) {
    const ok = contract.must_include_any.some(k => output.toLowerCase().includes(String(k).toLowerCase()));
    checks.push(check(ok, 'must_include_any', contract.must_include_any.join(', ')));
  }
  if (contract.forbidden_phrases?.length || contract.forbidden?.length) {
    const forbidden = contract.forbidden_phrases || contract.forbidden;
    const found = forbidden.filter(k => output.toLowerCase().includes(String(k).toLowerCase()));
    checks.push(check(found.length === 0, 'forbidden', found.length ? `Found: ${found.join(', ')}` : 'None found'));
  }
  if (contract.excluded_keywords?.length) {
    const found = contract.excluded_keywords.filter(k => output.toLowerCase().includes(String(k).toLowerCase()));
    checks.push(check(found.length === 0, 'excluded_keywords', found.length ? `Found excluded: ${found.join(', ')}` : 'None found'));
  }

  if (!checks.length) return result('skip', 0, [evidence('info', 'Contract', 'No applicable checks')], 'Contract had no applicable rules.');
  const passed = checks.filter(c => c.ok).length;
  const score = Math.round((passed / checks.length) * 100);
  return result(normalizeStatus(score), score, checks.map(c => evidence(c.ok ? 'info' : 'violation', c.label, c.value, c.ok ? 'info' : 'critical')), 'Validated final output against structural contract.');
}

function inferContract(task, rules) {
  const contracts = rules.behavior_contracts?.custom_contracts || {};
  return contracts[task.activity_category] || { min_length: 40, forbidden: ['lorem ipsum', 'placeholder'] };
}

function check(ok, label, value) {
  return { ok, label, value };
}

function result(status, score, ev, details) {
  return { pattern: 'bcv', label: 'Behavior Contract Validation', status, score, evidence: ev, details };
}

module.exports = { runBCV };
