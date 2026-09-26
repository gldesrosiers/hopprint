#!/usr/bin/env node
// Runs every check the project relies on, in order. Run before any commit:
//   node scripts/check.js
//
//   1. Syntax: the inline <script> in index.html, sw.js, and scripts/*.js compile.
//   2. Design tokens: scripts/token-guard.js.
//   3. Tests: every tests/*.test.js (real-source-pulled; includes byte-identical
//      preservation of the original app functions against the pre-sync build).

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
let failed = false;

function step(name, fn) {
  try {
    const detail = fn();
    console.log(`✔ ${name}${detail ? ` — ${detail}` : ''}`);
  } catch (e) {
    failed = true;
    const out = String(e.stdout || e.message);
    const failures = out.indexOf('✖ failing tests:');                 // node --test summary: show only what failed
    console.log(`✖ ${name}\n${(failures >= 0 ? out.slice(failures) : out).trim()}\n`);
  }
}

step('syntax', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const inline = html.match(/<script>\n([\s\S]*?)<\/script>\s*<\/body>/)[1];
  new vm.Script(inline, { filename: 'index.html#inline' });
  const files = ['sw.js', ...fs.readdirSync(path.join(ROOT, 'scripts')).filter(f => f.endsWith('.js')).map(f => `scripts/${f}`)];
  files.forEach(f => execFileSync(process.execPath, ['--check', path.join(ROOT, f)]));
  return `index.html inline script, ${files.join(', ')}`;
});

step('design tokens', () => execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'token-guard.js')], { encoding: 'utf8' }).trim());

step('tests', () => {
  const tests = fs.readdirSync(path.join(ROOT, 'tests')).filter(f => f.endsWith('.test.js')).map(f => path.join(ROOT, 'tests', f));
  const out = execFileSync(process.execPath, ['--test', ...tests], { encoding: 'utf8', cwd: ROOT });
  const count = k => (out.match(new RegExp(`^ℹ ${k} (\\d+)`, 'm')) || [])[1];
  return `${count('pass')}/${count('tests')} passed in ${tests.length} files`;
});

process.exit(failed ? 1 : 0);
