#!/usr/bin/env node
// Auth-gate helper tests (SYNC_REVERSAL_WORKPLAN.md Phase 1). Run:
//   node --test tests/auth.test.js
//
// Real-source-pulled: each function and constant is extracted verbatim from the
// inline <script> in index.html and evaluated in a sandbox — nothing is
// reimplemented here.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const { html, script, extractFunction, extractConst } = require('./helpers');

const sandbox = {};
vm.createContext(sandbox);
vm.runInContext([
  extractConst('TERMS_VERSION'),
  extractConst('AGE_GATE_MSG'),
  ...['isNetworkError', 'authErrorMessage', 'normalizeUsername', 'usernameProblem',
      'ageCutoffISO', 'isOldEnough', 'buildProfileRow', 'profileInsertError'].map(extractFunction),
  'this.api = { TERMS_VERSION, AGE_GATE_MSG, isNetworkError, authErrorMessage, normalizeUsername,',
  '  usernameProblem, ageCutoffISO, isOldEnough, buildProfileRow, profileInsertError };',
].join('\n'), sandbox);
const api = sandbox.api;

// Months are 0-based in the Date constructor.
const day = (y, m, d) => new Date(y, m - 1, d);

test('age gate: cutoff is exactly 21 years back', () => {
  assert.equal(api.ageCutoffISO(day(2026, 9, 23)), '2005-09-23');
  assert.equal(api.isOldEnough('2005-09-23', day(2026, 9, 23)), true);   // 21st birthday today
  assert.equal(api.isOldEnough('2005-09-24', day(2026, 9, 23)), false);  // one day short
  assert.equal(api.isOldEnough('1980-01-01', day(2026, 9, 23)), true);
});

test('age gate: Feb 29 clamps to Feb 28 like Postgres', () => {
  // 2028-02-29 minus 21 years → 2007-02-28 (2007 has no Feb 29).
  assert.equal(api.ageCutoffISO(day(2028, 2, 29)), '2007-02-28');
  assert.equal(api.isOldEnough('2007-02-28', day(2028, 2, 29)), true);
  assert.equal(api.isOldEnough('2007-03-01', day(2028, 2, 29)), false);
});

test('age gate: empty, malformed, and future dates are rejected', () => {
  for (const bad of ['', undefined, '1990-1-1', 'not a date', '2030-01-01']) {
    assert.equal(api.isOldEnough(bad, day(2026, 9, 23)), false, String(bad));
  }
});

test('username rules (O3): 3–20 of a-z 0-9 _', () => {
  assert.equal(api.normalizeUsername('  HopHead_22 '), 'hophead_22');
  for (const ok of ['abc', 'hop_head_99', 'a'.repeat(20)]) assert.equal(api.usernameProblem(ok), '', ok);
  assert.equal(api.usernameProblem(''), 'Choose a username.');
  for (const bad of ['ab', 'a'.repeat(21), 'hop head', 'hop-head', 'hop.head', 'Café']) {
    assert.match(api.usernameProblem(bad), /3–20 characters/, bad);
  }
});

test('profile row: email from session, state only for US, blanks → null, consent stamped', () => {
  const user = { id: 'u-1', email: 'greg@example.com' };
  const now = new Date('2026-09-23T21:00:00Z');
  const base = { username: 'greg', birthdate: '1990-05-01', country: 'US', state: 'CO',
                 firstName: '', lastName: 'D', gender: '', termsAccepted: true, shareData: false };

  const row = api.buildProfileRow(user, base, now);
  assert.equal(row.user_id, 'u-1');
  assert.equal(row.email, 'greg@example.com');
  assert.equal(row.location_country, 'US');
  assert.equal(row.location_state, 'CO');
  assert.equal(row.first_name, null);
  assert.equal(row.last_name, 'D');
  assert.equal(row.gender, null);
  assert.equal(row.data_sharing_consent, false);
  assert.equal(row.consent_timestamp, '2026-09-23T21:00:00.000Z');
  assert.equal(row.terms_version, api.TERMS_VERSION);
  assert.equal(api.TERMS_VERSION, '2026-09-23');

  const ca = api.buildProfileRow(user, { ...base, country: 'CA', state: 'CO', shareData: true }, now);
  assert.equal(ca.location_state, null);           // stale US state dropped
  assert.equal(ca.data_sharing_consent, true);

  // Only explicit true opts in (TS1).
  assert.equal(api.buildProfileRow(user, { ...base, shareData: 'on' }, now).data_sharing_consent, false);
});

test('profile row: only known profiles columns are written', () => {
  const row = api.buildProfileRow({ id: 'u', email: 'e' },
    { username: 'x', birthdate: '1990-01-01', country: 'MX', termsAccepted: true }, new Date());
  assert.deepEqual(Object.keys(row).sort(), [
    'birthdate', 'consent_timestamp', 'data_sharing_consent', 'email', 'first_name', 'gender',
    'last_name', 'location_country', 'location_state', 'terms_version', 'user_id', 'username',
  ]);
});

test('profile insert errors map to the right field and copy', () => {
  const taken = api.profileInsertError({ code: '23505', message: 'duplicate key value violates unique constraint "profiles_username_key"' });
  assert.equal(taken.field, 'suUsernameError');
  assert.match(taken.message, /taken/);

  const age = api.profileInsertError({ code: '23514', message: 'new row for relation "profiles" violates check constraint "profiles_age_gate_21plus"' });
  assert.equal(age.field, 'suBirthdateError');
  assert.equal(age.message, api.AGE_GATE_MSG);
  assert.equal(api.AGE_GATE_MSG, 'Sorry, this application is for users 21+ years old.');   // PC3 copy

  // Double submit: the row already exists — caller proceeds into the app.
  const dup = api.profileInsertError({ code: '23505', message: 'duplicate key value violates unique constraint "profiles_pkey"' });
  assert.equal(dup.field, null);

  const net = api.profileInsertError({ code: '', message: 'TypeError: Failed to fetch' });
  assert.equal(net.field, 'suSubmitError');
});

test('auth errors: network, rate limit, bad/expired code, fallback', () => {
  assert.equal(api.isNetworkError({ name: 'AuthRetryableFetchError', message: 'x' }), true);
  assert.equal(api.isNetworkError({ message: 'TypeError: Load failed' }), true);   // Safari wording
  assert.equal(api.isNetworkError({ code: 'otp_expired', message: 'fetch' }), false);
  assert.equal(api.isNetworkError(null), false);

  assert.match(api.authErrorMessage({ name: 'AuthRetryableFetchError', message: '' }), /connection/);
  assert.match(api.authErrorMessage({ status: 429, message: 'Too many' }), /Too many attempts/);
  assert.match(api.authErrorMessage({ code: 'over_email_send_rate_limit', message: '' }), /Too many attempts/);
  assert.match(api.authErrorMessage({ code: 'otp_expired', status: 403, message: 'Token has expired or is invalid' }), /wrong or has expired/);
  assert.match(api.authErrorMessage({ status: 500, message: 'boom' }), /Something went wrong/);
});

test('signup gender options match the profiles_gender_check constraint', () => {
  const select = html.match(/<select id="suGender">([\s\S]*?)<\/select>/)[1];
  const values = [...select.matchAll(/value="([^"]*)"/g)].map(m => m[1]).filter(Boolean).sort();
  assert.deepEqual(values, ['female', 'male', 'non-binary', 'other', 'prefer_not_to_say']);
});

test('signup offers exactly USA / Canada / Mexico and 50 states (PC1)', () => {
  const select = html.match(/<select id="suCountry"[^>]*>([\s\S]*?)<\/select>/)[1];
  const values = [...select.matchAll(/value="([^"]*)"/g)].map(m => m[1]).filter(Boolean);
  assert.deepEqual(values, ['US', 'CA', 'MX']);
  const states = vm.runInNewContext(`${script.match(/^const US_STATES = \[[\s\S]*?\];/m)[0]}; US_STATES`);
  assert.equal(states.length, 50);
  assert.equal(new Set(states.map(s => s[0])).size, 50);
});

test('SDK is pinned to an exact version (SY12)', () => {
  assert.match(html, /@supabase\/supabase-js@\d+\.\d+\.\d+\/dist\/umd\/supabase\.min\.js/);
  assert.match(script, /detectSessionInUrl: false/);
  assert.match(script, /persistSession: true/);
  assert.match(script, /autoRefreshToken: true/);
});

test('service worker skips Supabase and cache name was bumped (SY9)', () => {
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.match(sw, /url\.hostname\.endsWith\('\.supabase\.co'\)\) return;/);
  assert.match(sw, /CACHE_NAME = 'hopprint-v3'/);
  // The bypass must run before any respondWith.
  assert.ok(sw.indexOf(".supabase.co')) return;") < sw.indexOf('event.respondWith'));
});

test('terms.html version matches TERMS_VERSION (O4)', () => {
  const terms = fs.readFileSync(path.join(__dirname, '..', 'terms.html'), 'utf8');
  assert.ok(terms.includes(`version ${api.TERMS_VERSION}`));
});
