/**
 * pinouts.test.js
 *
 * Unit tests for the pinouts DB layer (src/main/database.js, v6 migration).
 *
 * Strategy: stub `electron`'s `app.getPath()` to point at a fresh temp dir, then
 * `require` the real database module. Tests run under plain Node — no Electron
 * runtime needed. Same shim approach as dtc-lookup.test.js (which is what
 * makes those tests Node-loadable despite the production code needing
 * electron.app).
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const Module = require('module');

let tmpDir;
let db;

function setupElectronShim(tmpDir) {
  // Override `require('electron')` to return a minimal shim. We can't load
  // the real module from a pure-node test runner.
  const shimPath = path.join(tmpDir, 'electron-shim.js');
  fs.writeFileSync(shimPath, `module.exports = { app: { getPath: () => '${tmpDir}' } };`);
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, ...rest) {
    if (request === 'electron') return shimPath;
    return origResolve.call(this, request, parent, ...rest);
  };
}

let bindingOk = true;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pinouts-test-'));
  setupElectronShim(tmpDir);
  try {
    db = require('../src/main/database.js');
    db.init();
  } catch (err) {
    // Mirror dtc-lookup.test.js: when better-sqlite3 ABI doesn't match the
    // host Node (typically after an electron-rebuild for a different ABI),
    // skip the suite rather than failing the entire test run.
    if (
      String(err.message).includes('NODE_MODULE_VERSION') ||
      String(err.message).includes('better_sqlite3.node')
    ) {
      // eslint-disable-next-line no-console
      console.warn('[pinouts.test] SKIPPED: better-sqlite3 native module not loadable:', err.message);
      bindingOk = false;
      return;
    }
    throw err;
  }
});

afterAll(() => {
  if (db && typeof db.close === 'function') db.close();
  try {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

describe.skipIf = (cond) => (cond ? describe.skip : describe);

(bindingOk ? describe : describe.skip)('pinouts DB layer', () => {
  it('creates and reads back a pinout with all fields preserved', () => {
    const created = db.createPinout({
      brand: 'Volkswagen',
      ecuFamily: 'EDC17',
      ecuModel: 'EDC17C46',
      method: 'BENCH',
      voltage: '13.5V regulated',
      pins: [
        { label: 'A1', function: '+12V', side: 'A', notes: 'permanent' },
        { label: 'A2', function: 'GND', side: 'A', notes: '' }
      ],
      tools: ['KESS3', 'KTAG'],
      warnings: 'Verify checksum after each write.',
      notes: 'tested 2026-05',
      annotations: { imageWidth: 800, imageHeight: 480, points: [] }
    });

    expect(created.id).toBeGreaterThan(0);
    const back = db.getPinout(created.id);
    expect(back.brand).toBe('Volkswagen');
    expect(back.ecuFamily).toBe('EDC17');
    expect(back.ecuModel).toBe('EDC17C46');
    expect(back.method).toBe('BENCH');
    expect(back.voltage).toBe('13.5V regulated');
    expect(back.pins).toHaveLength(2);
    expect(back.pins[0].function).toBe('+12V');
    expect(back.tools).toEqual(['KESS3', 'KTAG']);
    expect(back.annotations.imageWidth).toBe(800);
  });

  it('UNIQUE constraint prevents duplicate brand+family+model+method', () => {
    db.createPinout({ brand: 'Audi', ecuFamily: 'MED17', ecuModel: 'MED17.5', method: 'OBD' });
    expect(() =>
      db.createPinout({ brand: 'Audi', ecuFamily: 'MED17', ecuModel: 'MED17.5', method: 'OBD' })
    ).toThrow(/UNIQUE/);
  });

  it('family-wide entries (ecuModel=null) coexist with model-specific ones', () => {
    // Family-wide entry.
    db.createPinout({ brand: 'BMW', ecuFamily: 'MSV80', method: 'BENCH' });
    // Model-specific entry under same family.
    db.createPinout({
      brand: 'BMW',
      ecuFamily: 'MSV80',
      ecuModel: 'MSV80.0',
      method: 'BENCH'
    });
    const list = db.listPinouts({ family: 'MSV80', method: 'BENCH' });
    expect(list.length).toBeGreaterThanOrEqual(2);
    // But two family-wide rows for the same (brand, family, method) must NOT
    // be allowed.
    expect(() =>
      db.createPinout({ brand: 'BMW', ecuFamily: 'MSV80', method: 'BENCH' })
    ).toThrow(/UNIQUE/);
  });

  it('rejects an unknown method string', () => {
    expect(() =>
      db.createPinout({ brand: 'Foo', ecuFamily: 'Bar', method: 'NOTAMETHOD' })
    ).toThrow(/invalid method/i);
  });

  it('rejects missing ecuFamily', () => {
    expect(() => db.createPinout({ brand: 'Foo', method: 'BENCH' })).toThrow(/ecuFamily/);
  });

  it('updatePinout applies partial updates without clobbering other fields', () => {
    const created = db.createPinout({
      brand: 'Peugeot',
      ecuFamily: 'EDC17',
      ecuModel: 'EDC17C60',
      method: 'BOOT',
      voltage: '12V',
      pins: [{ label: 'B1', function: 'BOOT0' }],
      warnings: 'orig'
    });
    const updated = db.updatePinout(created.id, { warnings: 'new warning' });
    expect(updated.warnings).toBe('new warning');
    expect(updated.voltage).toBe('12V'); // untouched
    expect(updated.pins[0].function).toBe('BOOT0'); // untouched
  });

  it('suggestPinoutsForEcu returns exact match with highest score', () => {
    // Pre-seed by family — these are unique because the constraint allows it.
    const a = db.createPinout({ brand: 'Hyundai', ecuFamily: 'SIMK', ecuModel: 'SIMK41', method: 'BENCH' });
    const b = db.createPinout({ brand: 'Hyundai', ecuFamily: 'SIMK', ecuModel: 'SIMK43', method: 'BENCH' });
    const c = db.createPinout({ brand: 'Kia', ecuFamily: 'SIMK', method: 'BENCH' }); // family-wide, different brand

    const suggestions = db.suggestPinoutsForEcu({
      brand: 'Hyundai',
      family: 'SIMK',
      model: 'SIMK41'
    });

    expect(suggestions.length).toBeGreaterThanOrEqual(3);
    // Top match should be the exact (brand, family, model) entry.
    const top = suggestions[0];
    expect(top.id).toBe(a.id);
    expect(top._matchScore).toBeGreaterThan(suggestions[1]._matchScore);
    // The family-wide Kia entry should appear (other brand, family match) but score lower.
    expect(suggestions.some((s) => s.id === c.id)).toBe(true);
    expect(suggestions.some((s) => s.id === b.id)).toBe(true);
  });

  it('searchPinouts finds entries by pin function in the JSON blob', () => {
    db.createPinout({
      brand: 'Toyota',
      ecuFamily: 'DENSO',
      method: 'OBD',
      pins: [{ label: '17', function: 'CAN H' }]
    });
    const hits = db.searchPinouts('CAN H');
    expect(hits.some((h) => h.brand === 'Toyota')).toBe(true);
  });

  it('deletePinout removes the row and reports the image_path for cleanup', () => {
    const created = db.createPinout({
      brand: 'Renault',
      ecuFamily: 'SID',
      ecuModel: 'SID301',
      method: 'BENCH',
      imagePath: 'fake_image.png'
    });
    const res = db.deletePinout(created.id);
    expect(res.success).toBe(true);
    expect(res.imagePath).toBe('fake_image.png');
    expect(db.getPinout(created.id)).toBe(null);
  });
});
