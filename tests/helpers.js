// Shared helpers for the real-source-pulled tests: every function and const
// under test is extracted verbatim from index.html's inline <script> — never
// reimplemented in a test file.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function inlineScript(source) {
  const m = source.match(/<script>\n([\s\S]*?)<\/script>\s*<\/body>/);
  if (!m) throw new Error('inline <script> block not found');
  return m[1];
}

const script = inlineScript(html);
const style = html.match(/<style>([\s\S]*?)<\/style>/)[1];

function extractFunctionFrom(src, name) {
  const start = src.search(new RegExp(`^(?:async\\s+)?function\\s+${name}\\s*\\(`, 'm'));
  if (start === -1) throw new Error(`function ${name} not found`);
  // The body starts at the first ") {" — not a default-parameter brace like (opts = {}).
  const bodyStart = start + src.slice(start).search(/\)\s*\{/);
  let depth = 0;
  for (let i = src.indexOf('{', bodyStart); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  throw new Error(`unbalanced braces in ${name}`);
}

const extractFunction = name => extractFunctionFrom(script, name);

function extractConst(name) {
  const m = script.match(new RegExp(`^const ${name} = [^\\n]*;`, 'm'));
  if (!m) throw new Error(`const ${name} not found in index.html`);
  return m[0];
}

// Every top-level function declaration in a script, name → exact source.
function allFunctions(src) {
  const out = {};
  for (const m of src.matchAll(/^(?:async\s+)?function\s+(\w+)\s*\(/gm)) {
    out[m[1]] = extractFunctionFrom(src, m[1]);
  }
  return out;
}

module.exports = { ROOT, html, script, style, inlineScript, extractFunction, extractFunctionFrom, extractConst, allFunctions };
