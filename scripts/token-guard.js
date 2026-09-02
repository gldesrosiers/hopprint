#!/usr/bin/env node
// Keeps the design tokens in index.html stable. Run after any CSS change:
//   node scripts/token-guard.js
//
// Checks (see BRAND_REFRESH_WORKPLAN.md §9):
//   1. No #rrggbb literal appears in the <style> block outside the :root allowlist.
//   2. --avocado and --grass appear nowhere in the file (retired tokens).
//   3. Every var(--token) reference in the <style> block resolves to a token declared in :root.
//   4. --font-headline, --font-display, and --font-body each have at least one consumer.

const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'index.html');
const html = fs.readFileSync(file, 'utf8');

const styleMatch = html.match(/<style>([\s\S]*?)<\/style>/);
if (!styleMatch) {
  console.error('FAIL: could not find a <style> block in index.html');
  process.exit(1);
}
const style = styleMatch[1];

const errors = [];

// --- Retired tokens must not appear anywhere in the file ---
for (const retired of ['--avocado', '--grass']) {
  if (html.includes(retired)) {
    errors.push(`retired token "${retired}" still appears in index.html`);
  }
}

// --- Build the :root token allowlist ---
const rootMatch = style.match(/:root\s*{([\s\S]*?)}/);
if (!rootMatch) {
  console.error('FAIL: could not find a :root block in the <style> section');
  process.exit(1);
}
const rootBlock = rootMatch[1];
const declaredTokens = new Set();
for (const m of rootBlock.matchAll(/(--[a-zA-Z0-9-]+)\s*:/g)) {
  declaredTokens.add(m[1]);
}

// --- No raw #rrggb(a) literal outside :root (theme-color meta tag is outside <style> entirely) ---
const styleOutsideRoot = style.slice(0, rootMatch.index) + style.slice(rootMatch.index + rootMatch[0].length);
for (const m of styleOutsideRoot.matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
  errors.push(`raw color literal "${m[0]}" found outside the :root token block`);
}

// --- Every var(--token) reference must resolve to a declared token ---
// --accent is a per-instance component variable (set inline per element, e.g.
// style="--accent:var(--lime)"), not a :root design token — exempt it.
const COMPONENT_SCOPED = new Set(['--accent']);
const referenced = new Set();
for (const m of style.matchAll(/var\((--[a-zA-Z0-9-]+)/g)) {
  referenced.add(m[1]);
}
for (const ref of referenced) {
  if (!declaredTokens.has(ref) && !COMPONENT_SCOPED.has(ref)) {
    errors.push(`var(${ref}) referenced but not declared in :root`);
  }
}

// --- Font tokens must each have at least one consumer ---
for (const fontToken of ['--font-headline', '--font-display', '--font-body']) {
  const consumerCount = (style.match(new RegExp(`var\\(${fontToken}\\)`, 'g')) || []).length;
  // --font-body is also consumed via `body { font-family: var(--font-body); }`
  if (consumerCount === 0) {
    errors.push(`${fontToken} has no var() consumer in the <style> block`);
  }
}

if (errors.length) {
  console.error(`FAIL: token guard found ${errors.length} issue(s):\n`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log(`OK: token guard passed (${declaredTokens.size} tokens declared, ${referenced.size} referenced).`);
