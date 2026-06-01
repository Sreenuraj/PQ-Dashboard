const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const RULES_PATH = path.join(__dirname, '../../test-rules.yaml');

function defaultRules() {
  return {
    tool_invocation: { enabled: true, custom_mappings: [] },
    behavior_contracts: { enabled: true, auto_infer: true, custom_contracts: {} },
    trace_verification: { enabled: true, rules: { read_before_edit: true, think_before_act: true, no_blind_writes: true } },
    scope_enforcement: { enabled: true, max_tool_calls: 100, no_destructive_commands: true, destructive_patterns: [] },
    error_recovery: { enabled: true, max_blind_retries: 2 },
    context_efficiency: { enabled: true, warn_threshold: 70, critical_threshold: 90 },
    weights: { tia: 25, bcv: 15, mtv: 20, bse: 20, erc: 10, cec: 10 },
  };
}

function loadRules() {
  if (!fs.existsSync(RULES_PATH)) return defaultRules();
  const loaded = yaml.load(fs.readFileSync(RULES_PATH, 'utf8')) || {};
  return { ...defaultRules(), ...loaded };
}

function saveRules(rules) {
  fs.writeFileSync(RULES_PATH, yaml.dump(rules, { lineWidth: 100 }), 'utf8');
  return rules;
}

module.exports = { RULES_PATH, loadRules, saveRules };
