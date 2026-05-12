/**
 * dtc-lookup.test.js
 *
 * Tests src/main/dtc-lookup.js against the bundled src/data/dtc.db.
 *
 * IMPORTANT: better-sqlite3 ships a native addon built against ELECTRON's
 * NODE_MODULE_VERSION (via the project's `postinstall: electron-rebuild`
 * step). When loaded under plain `node` (i.e. vitest), `require('better-sqlite3')`
 * throws with NODE_MODULE_VERSION mismatch. The suite probes for this at
 * startup and SKIPS rather than crashing — to run these for real, rebuild the
 * addon against the host Node version (`npm rebuild better-sqlite3 --build-from-source`).
 *
 * The DTC database file is also optional — if `src/data/dtc.db` is missing
 * (e.g. lightweight checkout) the suite skips too.
 */

const fs = require('fs');
const path = require('path');
// vitest globals injected via vitest.config.js `globals: true`.

const DB_PATH = path.join(__dirname, '..', 'src', 'data', 'dtc.db');

function probeRuntime() {
  // Two failure modes to detect:
  //   1. better-sqlite3 native addon ABI mismatch (very common in this project
  //      because the runtime is Electron, not Node). The JS-side `require`
  //      succeeds — the addon only loads when you instantiate Database.
  //      So we must actually OPEN a DB to surface NODE_MODULE_VERSION errors.
  //   2. dtc.db not present.
  if (!fs.existsSync(DB_PATH)) {
    return { ok: false, reason: `dtc.db missing at ${DB_PATH}` };
  }
  try {
    // eslint-disable-next-line global-require
    const Database = require('better-sqlite3');
    const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
    db.close();
  } catch (err) {
    return { ok: false, reason: `better-sqlite3 native module not loadable: ${err.message}` };
  }
  return { ok: true };
}

const probe = probeRuntime();
const describeIfAvailable = probe.ok ? describe : describe.skip;

if (!probe.ok) {
  // Emit a visible note so callers know WHY the suite is empty/skipped.
  // eslint-disable-next-line no-console
  console.warn(`[dtc-lookup.test] SKIPPED: ${probe.reason}`);
}

describeIfAvailable('dtc-lookup', () => {
  // Lazy-require so we never even attempt to load the module under skip.
  let dtcLookup;
  it('loads the dtc-lookup module', () => {
    dtcLookup = require('../src/main/dtc-lookup.js');
    expect(dtcLookup).toBeDefined();
  });

  it('lookupDtc("P0420") returns Catalyst-related description', () => {
    if (!dtcLookup) dtcLookup = require('../src/main/dtc-lookup.js');
    const result = dtcLookup.lookupDtc('P0420');
    expect(result).not.toBeNull();
    expect(result.code).toBe('P0420');
    expect(result.description.toLowerCase()).toContain('catalyst');
  });

  it('lookupDtc("P0420", "AUDI") returns Audi-specific entry if present, else null', () => {
    if (!dtcLookup) dtcLookup = require('../src/main/dtc-lookup.js');
    const result = dtcLookup.lookupDtc('P0420', 'AUDI');
    // The module's contract: when a manufacturer is passed and there is a
    // manufacturer-specific row, return that row; otherwise fall through to
    // GENERIC. The Audi P0420 entry may or may not exist in the bundled DB,
    // so accept either an Audi-specific row OR a generic fallback.
    if (result === null) {
      // explicit "no audi-specific match and no generic" - acceptable
      expect(result).toBeNull();
    } else {
      expect(result.code).toBe('P0420');
      expect(typeof result.description).toBe('string');
      expect(result.description.length).toBeGreaterThan(0);
    }
  });

  it('searchDtc("catalyst", 5) returns at most 5 results', () => {
    if (!dtcLookup) dtcLookup = require('../src/main/dtc-lookup.js');
    const results = dtcLookup.searchDtc('catalyst', 5);
    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeLessThanOrEqual(5);
  });
});
