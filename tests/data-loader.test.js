/**
 * data-loader.test.js
 *
 * Tests src/main/data-loader.js against the bundled JSON/CSV reference data.
 * All lookups are pure-function, no native modules touched.
 *
 * The `lookupBoschEcuMake` function iterates the parsed ECU list, building a
 * Map keyed by uppercase model — when multiple entries share a model (e.g.
 * EDC17CP44 appearing once per make), the Map ends up holding the makes from
 * the LAST entry. To get a deterministic "contains 'BMW'" assertion we use a
 * model that appears only once in the bundled JSON with BMW as its make.
 */

// vitest globals injected via vitest.config.js `globals: true`.

const dataLoader = require('../src/main/data-loader.js');

describe('data-loader', () => {
  it('lookupBoschPrefix("0281010284") returns the EDC diesel family', () => {
    const result = dataLoader.lookupBoschPrefix('0281010284');
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      code: '0281',
      family: expect.stringMatching(/EDC/i)
    });
  });

  it('lookupVagPlatform("8V0907115F") returns the Audi 8V platform', () => {
    const result = dataLoader.lookupVagPlatform('8V0907115F');
    expect(result).not.toBeNull();
    expect(result.platform).toBeDefined();
    expect(result.platform).toMatchObject({
      code: '8V',
      make: 'Audi'
    });
  });

  it('lookupWmi("WAU") returns Audi / Germany', () => {
    const result = dataLoader.lookupWmi('WAU');
    expect(result).not.toBeNull();
    expect(result).toMatchObject({
      country: 'Germany',
      manufacturer: expect.stringContaining('Audi'),
      brand: 'Audi'
    });
  });

  it('lookupBoschEcuMake("EDC17C06") returns an array containing BMW', () => {
    // EDC17C06 appears once in the bundled JSON, makes=['BMW'].
    // (EDC17CP44 has multiple entries — the Map gets overwritten and the
    //  final value depends on JSON file order, which is brittle for a test.)
    const result = dataLoader.lookupBoschEcuMake('EDC17C06');
    expect(Array.isArray(result)).toBe(true);
    expect(result).toContain('BMW');
  });
});
