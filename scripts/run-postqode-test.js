#!/usr/bin/env node

/**
 * CLI Runner for PostQode End-to-End Test Suite
 * Usage:
 *   node scripts/run-postqode-test.js [--mode=mocked|live] [--host=vscode-insiders] [--scenarios=activation,chat,agent-tools,resilience]
 */

const path = require('path');
const { PostQodeTestRunner } = require('../server/postqode-test/runner');

const args = process.argv.slice(2);
const options = {
  mode: 'mocked',
  host: 'vscode-insiders',
  buildSource: 'installed',
  localBuildPath: null,
  scenarios: ['startup', 'activation', 'view-title', 'settings', 'mcp', 'history', 'new-session', 'chat', 'agent-tools', 'resilience'],
};

for (const arg of args) {
  if (arg.startsWith('--mode=')) options.mode = arg.split('=')[1];
  else if (arg.startsWith('--host=')) options.host = arg.split('=')[1];
  else if (arg.startsWith('--build-source=')) options.buildSource = arg.split('=')[1];
  else if (arg.startsWith('--local-path=')) options.localBuildPath = arg.split('=')[1];
  else if (arg.startsWith('--scenarios=')) options.scenarios = arg.split('=')[1].split(',');
  else if (arg === '--help' || arg === '-h') {
    console.log(`
PostQode Test Runner CLI

Options:
  --mode=mocked|live       Mocked AI responses via MITM proxy (default: mocked) or live provider
  --host=vscode-insiders   Target IDE executable (default: vscode-insiders)
  --build-source=src       'installed' | 'local' | 'marketplace' (default: installed)
  --local-path=path        Path to local .vsix file or unpacked directory
  --scenarios=s1,s2,...    Comma-separated list of scenarios or checklist IDs
  --help, -h               Show this help message
`);
    process.exit(0);
  }
}

console.log('====================================================');
console.log('       POSTQODE TEST LAB — RUNNER CLI               ');
console.log('====================================================');
console.log(`Target Host: ${options.host}`);
console.log(`Response Mode: ${options.mode}`);
console.log(`Scenarios: ${options.scenarios.join(', ')}`);
console.log('----------------------------------------------------');

const runner = new PostQodeTestRunner(options);

runner.on('log', (msg) => {
  // Already logged by runner console.log
});

runner.on('step', (step) => {
  if (step.status === 'running') {
    console.log(`\n▶ [RUNNING] ${step.title}`);
  } else if (step.status === 'passed') {
    console.log(`✔ [PASS] ${step.title} (${step.durationMs}ms)`);
  } else if (step.status === 'failed') {
    console.log(`✖ [FAIL] ${step.title} (${step.durationMs}ms) — ${step.error}`);
  }
});

runner.run().then((report) => {
  console.log('\n====================================================');
  console.log('                   TEST REPORT                      ');
  console.log('====================================================');
  console.log(`Run ID:      ${report.runId}`);
  console.log(`Total Steps: ${report.summary.total}`);
  console.log(`Passed:      ${report.summary.passed}`);
  console.log(`Failed:      ${report.summary.failed}`);
  console.log(`Duration:    ${(report.summary.durationMs / 1000).toFixed(2)}s`);
  console.log(`Report JSON: ${path.join(runner.outputDir, 'report.json')}`);
  console.log('====================================================\n');

  if (report.summary.failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}).catch((err) => {
  console.error('\nFatal test execution error:', err);
  process.exit(1);
});
