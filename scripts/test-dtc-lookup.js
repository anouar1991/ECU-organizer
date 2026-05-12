/**
 * Inline test for src/main/dtc-lookup.js — runs in Electron's Node so the
 * native better-sqlite3 binding matches the bundled ABI.
 *
 * Run:  node_modules/.bin/electron --no-sandbox scripts/test-dtc-lookup.js
 */
const path = require('path');
const { lookupDtc, searchDtc, close } = require(path.join(__dirname, '..', 'src', 'main', 'dtc-lookup'));

let pass = true;
function assert(cond, msg) {
  console.log((cond ? 'PASS' : 'FAIL') + ' — ' + msg);
  if (!cond) pass = false;
}

try {
  // Test 1: P0420 generic
  const r = lookupDtc('P0420');
  console.log('lookupDtc(P0420):', JSON.stringify(r));
  assert(r !== null, 'P0420 found');
  assert(r && r.code === 'P0420', 'code is P0420');
  assert(r && /catalyst/i.test(r.description), 'description mentions catalyst');
  assert(r && r.system === 'P', 'system is P');
  assert(r && r.manufacturer === 'GENERIC', 'manufacturer is GENERIC (preferred)');

  // Test 2: P0420 with explicit manufacturer
  const r2 = lookupDtc('P0420', 'AUDI');
  console.log('lookupDtc(P0420, AUDI):', JSON.stringify(r2));
  assert(r2 && r2.manufacturer === 'AUDI', 'manufacturer-specific lookup returns AUDI');

  // Test 3: lowercase input normalises
  const r3 = lookupDtc('p0420');
  assert(r3 && r3.code === 'P0420', 'lowercase input normalised to uppercase');

  // Test 4: unknown code returns null
  const r4 = lookupDtc('PZZZZ9');
  assert(r4 === null, 'unknown code returns null');

  // Test 5: search
  const s = searchDtc('catalyst', 5);
  console.log('searchDtc(catalyst, 5):', s.length, 'results, first:', JSON.stringify(s[0]));
  assert(s.length > 0 && s.length <= 5, 'search returns 1..5 results');
  assert(s.every(x => x.code && x.description && x.system && x.manufacturer), 'all search results well-formed');

  // Test 6: search by code prefix
  const s2 = searchDtc('P0420', 10);
  assert(s2.some(x => x.code === 'P0420'), 'search by code substring finds P0420');

  // Test 7: bad input
  assert(lookupDtc('') === null && lookupDtc(null) === null, 'empty/null input -> null');
  assert(searchDtc('').length === 0, 'empty query -> empty array');

  close();
  console.log(pass ? '\nALL TESTS PASSED' : '\nSOME TESTS FAILED');
  process.exit(pass ? 0 : 1);
} catch (e) {
  console.error('TEST CRASH:', e);
  process.exit(2);
}
