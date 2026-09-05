#!/usr/bin/env node

/**
 * Creates the distributable VSIX only when it is absent or stale.
 *
 * Packaging is intentionally separate from the normal UI build: it is safe to
 * invoke after every change and avoids producing a new archive unnecessarily.
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const output = path.join(root, `${pkg.name}-${pkg.version}.vsix`);
const vsce = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'vsce.cmd' : 'vsce');
const force = process.argv.includes('--force');
const inputs = [
  'extension',
  'server',
  'src',
  'package.json',
  'package-lock.json',
  'vite.config.js',
  '.vscodeignore',
  'README.md',
  'LICENSE',
  'pq-config.yaml',
  'test-rules.yaml',
];

function newestMtime(target) {
  if (!fs.existsSync(target)) return 0;
  const stat = fs.statSync(target);
  if (!stat.isDirectory()) return stat.mtimeMs;

  let newest = stat.mtimeMs;
  for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    newest = Math.max(newest, newestMtime(path.join(target, entry.name)));
  }
  return newest;
}

const newestInput = Math.max(...inputs.map(input => newestMtime(path.join(root, input))));
const archiveMtime = fs.existsSync(output) ? fs.statSync(output).mtimeMs : 0;

if (!force && archiveMtime >= newestInput) {
  console.log(`VSIX is current: ${path.basename(output)}`);
  process.exit(0);
}

console.log(`${archiveMtime ? 'Refreshing' : 'Creating'} ${path.basename(output)}...`);
if (!fs.existsSync(vsce)) {
  console.error('VS Code packaging dependency is missing. Run `npm install` to install devDependencies, then retry.');
  process.exit(1);
}
const temporaryOutput = `${output}.${process.pid}.tmp`;
execFileSync(vsce, ['package', '--out', temporaryOutput], {
  cwd: root,
  stdio: 'inherit',
});
fs.renameSync(temporaryOutput, output);
console.log(`VSIX ready: ${output}`);
