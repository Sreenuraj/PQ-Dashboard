const { getFinalOutput, normalizeStatus, evidence } = require('./shared');

function runBCV(task, events, rules, baseline) {
  const output = getFinalOutput(events);
  if (!output) return result('skip', 0, [evidence('info', 'Output', 'No final output captured')], 'No final response was available.');

  const contract = baseline?.behavior_contract || inferContract(task, rules);
  if (!contract || Object.keys(contract).length === 0) {
    return result('skip', 0, [evidence('info', 'Contract', 'No behavior contract defined')], 'No contract rules applied.');
  }

  const checks = [];
  const outputLower = output.toLowerCase();

  // Phase 3: Parse keywords — handle both legacy strings and new objects with is_essential
  const rawKeywords = contract.output_keywords || [];
  const keywords = rawKeywords.map(k => typeof k === 'string' ? { word: k, is_essential: true } : k);
  const essentialKeywords = keywords.filter(k => k.is_essential);
  const optionalKeywords = keywords.filter(k => !k.is_essential);

  // Phase 3: Essential keywords — ALL must be present
  if (essentialKeywords.length > 0) {
    const essentialMissing = essentialKeywords.filter(k => !outputLower.includes(k.word.toLowerCase()));
    const essentialFound = essentialKeywords.filter(k => outputLower.includes(k.word.toLowerCase()));
    checks.push({
      ok: essentialMissing.length === 0,
      label: 'essential_keywords',
      value: essentialMissing.length ? `Missing: ${essentialMissing.map(k => k.word).join(', ')}` : `All ${essentialFound.length} essential keywords found`,
      severity: essentialMissing.length ? 'critical' : 'info',
      weight: 50
    });
  }

  // Phase 3: Optional keywords — informational only
  if (optionalKeywords.length > 0) {
    const optionalFound = optionalKeywords.filter(k => outputLower.includes(k.word.toLowerCase()));
    checks.push({
      ok: true,
      label: 'optional_keywords',
      value: `${optionalFound.length}/${optionalKeywords.length} optional keywords found: ${optionalFound.map(k => k.word).join(', ')}`,
      severity: 'info',
      weight: 0
    });
  }

  // Other checks (unchanged)
  if (contract.has_code_block) {
    checks.push({ ok: /```/.test(output), label: 'has_code_block', value: /```/.test(output) ? 'Code block found' : 'No code block', severity: /```/.test(output) ? 'info' : 'warning', weight: 15 });
  }
  if (contract.output_min_length || contract.min_length) {
    const min = contract.output_min_length || contract.min_length;
    checks.push({ ok: output.length >= min, label: 'min_length', value: `${output.length} chars, minimum ${min}`, severity: output.length >= min ? 'info' : 'warning', weight: 15 });
  }
  if (contract.output_max_length || contract.max_length) {
    const max = contract.output_max_length || contract.max_length;
    checks.push({ ok: output.length <= max, label: 'max_length', value: `${output.length} chars, maximum ${max}`, severity: output.length <= max ? 'info' : 'warning', weight: 15 });
  }
  if (contract.forbidden_phrases?.length || contract.forbidden?.length) {
    const forbidden = contract.forbidden_phrases || contract.forbidden;
    const found = forbidden.filter(k => outputLower.includes(k.toLowerCase()));
    checks.push({ ok: found.length === 0, label: 'forbidden', value: found.length ? `Found: ${found.join(', ')}` : 'None found', severity: found.length ? 'critical' : 'info', weight: 20 });
  }
  if (contract.excluded_keywords?.length) {
    const found = contract.excluded_keywords.filter(k => outputLower.includes(k.toLowerCase()));
    checks.push({ ok: found.length === 0, label: 'excluded_keywords', value: found.length ? `Found excluded: ${found.join(', ')}` : 'None found', severity: found.length ? 'critical' : 'info', weight: 20 });
  }

  if (!checks.length) return result('skip', 0, [evidence('info', 'Contract', 'No applicable checks')], 'Contract had no applicable rules.');

  // Phase 3: Weighted scoring — only checks with weight > 0 contribute to score
  const weightedChecks = checks.filter(c => c.weight > 0);
  const totalWeight = weightedChecks.reduce((s, c) => s + c.weight, 0);
  const weightedScore = weightedChecks.reduce((s, c) => s + (c.ok ? c.weight : 0), 0);
  const score = totalWeight > 0 ? Math.round((weightedScore / totalWeight) * 100) : 0;

  return result(normalizeStatus(score), score, checks.map(c => evidence(c.ok ? 'info' : 'violation', c.label, c.value, c.severity || 'info')), 'Validated final output against structural contract (essential-aware).');
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
