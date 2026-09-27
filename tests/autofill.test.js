#!/usr/bin/env node
// Check-in autofill after a reopen: beers and breweries logged in an earlier
// session fill in their details, not just their names. Run:
//   node --test tests/autofill.test.js
//
// Real-source-pulled: the list/lookup functions and the two select handlers
// are extracted verbatim from index.html and run against a small seed and a
// fake form, the way the app does right after init().

const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');

const { extractFunction } = require('./helpers');

const FIELDS = ['beerName', 'breweryName', 'beerStyle', 'abv', 'breweryCity', 'breweryState'];

// A fresh app open: seed lookups as baked into the build, the user's cached
// check-ins (newest first), and an empty Check In form.
function reopen(entries, { beerDb = {}, breweryDb = {}, seedBeers = [], seedBreweries = [] } = {}) {
  const form = Object.fromEntries(FIELDS.map(id => [id, { value: '' }]));
  const ctx = vm.createContext({
    console,
    document: { getElementById: id => form[id] || null },
    entries,
    BEER_DB: beerDb, BREWERY_DB: breweryDb,
    SEED: { beers: [...seedBeers], breweries: [...seedBreweries], styles: [], venues: [], purchase: [] },
  });
  vm.runInContext(['acNormKey', 'acClean', 'mergeInPlace', 'upsertDetail', 'upsertBeerDB', 'upsertBreweryDB',
    'buildLiveLists', 'onBeerSelect', 'onBrewerySelect'].map(extractFunction).join('\n'), ctx);
  ctx.buildLiveLists();
  const values = () => Object.fromEntries(FIELDS.map(id => [id, String(form[id].value)]));
  const clear = () => FIELDS.forEach(id => { form[id].value = ''; });
  return { ctx, form, values, clear };
}

const entry = (over = {}) => ({
  beer_name: 'Hazy Little Thing', brewery_name: 'Sierra Nevada Brewing Co.', beer_type: 'IPA - New England / Hazy',
  beer_abv: '6.7', brewery_city: 'Chico', brewery_state: 'CA', ...over,
});

test('a beer logged in an earlier session autofills brewery, style, ABV and location', () => {
  const app = reopen([entry()]);
  app.form.beerName.value = 'Hazy Little Thing';
  app.ctx.onBeerSelect('Hazy Little Thing');
  assert.deepEqual(app.values(), {
    beerName: 'Hazy Little Thing', breweryName: 'Sierra Nevada Brewing Co.', beerStyle: 'IPA - New England / Hazy',
    abv: '6.7', breweryCity: 'Chico', breweryState: 'CA',
  });
});

test('a brewery logged in an earlier session autofills its location', () => {
  const app = reopen([entry()]);
  app.form.breweryName.value = 'Sierra Nevada Brewing Co.';
  app.ctx.onBrewerySelect('Sierra Nevada Brewing Co.');
  assert.equal(app.form.breweryCity.value, 'Chico');
  assert.equal(app.form.breweryState.value, 'CA');
});

test('the name the dropdown shows is the key: messy spacing and case still autofill', () => {
  const app = reopen([entry({ beer_name: '  hazy   little thing ', brewery_name: 'Sierra  Nevada Brewing Co. ' })]);
  const shownBeer = app.ctx.SEED.beers[0];
  const shownBrewery = app.ctx.SEED.breweries[0];
  assert.equal(shownBeer, 'hazy little thing');
  app.ctx.onBeerSelect(shownBeer);
  assert.equal(app.form.breweryName.value, 'Sierra Nevada Brewing Co.');
  app.clear();
  app.ctx.onBrewerySelect(shownBrewery);
  assert.equal(app.form.breweryCity.value, 'Chico');
});

test('seed details win over the user\'s check-ins; only blanks are filled', () => {
  const app = reopen([entry({ beer_name: 'Miller Lite', brewery_name: 'Miller Brewing Company', beer_abv: '9.9', beer_type: 'Wrong', brewery_city: 'Milwaukee', brewery_state: 'WI' })], {
    beerDb: { 'Miller Lite': { b: 'Miller Brewing Company', s: 'Lager - American Light', a: 4.2 } },
    breweryDb: { 'Miller Brewing Company': { c: 'Milwaukee' } },
    seedBeers: ['Miller Lite'], seedBreweries: ['Miller Brewing Company'],
  });
  assert.deepEqual({ ...app.ctx.BEER_DB['Miller Lite'] }, { b: 'Miller Brewing Company', s: 'Lager - American Light', a: 4.2, bc: 'Milwaukee', bs: 'WI' });
  assert.deepEqual({ ...app.ctx.BREWERY_DB['Miller Brewing Company'] }, { c: 'Milwaukee', s: 'WI' });
});

test('seed casing wins: a lower-case check-in fills the seed key, not a new one', () => {
  const app = reopen([entry({ beer_name: 'miller lite', brewery_name: 'Miller Brewing Company', brewery_city: 'Milwaukee', brewery_state: 'WI' })], {
    beerDb: { 'Miller Lite': { b: 'Miller Brewing Company' } }, seedBeers: ['Miller Lite'],
  });
  assert.equal('miller lite' in app.ctx.BEER_DB, false);
  assert.equal(app.ctx.BEER_DB['Miller Lite'].bs, 'WI');
});

test('the newest check-in wins among the user\'s own', () => {
  const app = reopen([entry({ beer_abv: '7.1' }), entry({ beer_abv: '6.7' })]);   // newest first, as stored
  app.ctx.onBeerSelect('Hazy Little Thing');
  assert.equal(String(app.form.abv.value), '7.1');
});

test('fields the user already typed are never overwritten', () => {
  const app = reopen([entry()]);
  app.form.breweryName.value = 'My Own Brewery';
  app.form.abv.value = '5';
  app.ctx.onBeerSelect('Hazy Little Thing');
  assert.equal(app.form.breweryName.value, 'My Own Brewery');
  assert.equal(app.form.abv.value, '5');
  assert.equal(app.form.breweryCity.value, 'Chico');
});

test('check-ins without a brewery never create empty lookup records', () => {
  const app = reopen([entry({ brewery_name: '' }), { beer_name: 'Mystery Beer' }, null]);
  assert.equal('Hazy Little Thing' in app.ctx.BEER_DB, false);
  assert.equal('Mystery Beer' in app.ctx.BEER_DB, false);
  assert.deepEqual(Object.keys(app.ctx.BREWERY_DB), []);
});

test('rebuilding again (after a sync pull) is idempotent', () => {
  const app = reopen([entry()]);
  const once = JSON.stringify([app.ctx.BEER_DB, app.ctx.BREWERY_DB]);
  app.ctx.buildLiveLists();
  assert.equal(JSON.stringify([app.ctx.BEER_DB, app.ctx.BREWERY_DB]), once);
});
