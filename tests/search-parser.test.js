// @ts-check
/**
 * Tests for the renderer search-parser. The parser is plain JS with no Electron
 * dependencies, so it can be required directly under Node.
 *
 * vitest globals (describe/it/expect/beforeAll) are injected via vitest.config.js
 * `globals: true`.
 */
const path = require('path');

let SP;

beforeAll(() => {
  // Set up a fake `window.App` namespace before requiring the parser, since
  // search-parser.js is browser-style and attaches itself there.
  global.window = global.window || {};
  global.window.App = global.window.App || {};
  SP = require(path.join(__dirname, '..', 'src', 'renderer', 'js', 'search-parser.js'));
});

describe('SearchParser.parse', () => {
  it('returns the field shape with sensible defaults', () => {
    const r = SP.parse('');
    expect(r.search).toBe('');
    expect(r.filters.brand).toBe('');
    expect(r.filters.tags).toEqual([]);
    expect(r.filters.has).toEqual([]);
    expect(r.tokens).toEqual([]);
  });

  it('extracts a single brand: token', () => {
    const r = SP.parse('brand:audi');
    expect(r.filters.brand).toBe('audi');
    expect(r.search).toBe('');
  });

  it('extracts multiple field tokens AND leaves leftover free text', () => {
    const r = SP.parse('brand:audi tag:stage1 missing_dpf rs3');
    expect(r.filters.brand).toBe('audi');
    expect(r.filters.tags).toEqual(['stage1']);
    expect(r.search).toBe('missing_dpf rs3');
  });

  it('supports multi-tag AND', () => {
    const r = SP.parse('tag:stage1 tag:dpf-off');
    expect(r.filters.tags).toEqual(['stage1', 'dpf-off']);
  });

  it('honours hw prefix wildcard suffix *', () => {
    const r = SP.parse('hw:0261*');
    expect(r.filters.hw).toBe('0261');
    expect(r.filters.hwPrefix).toBe(true);
  });

  it('parses conf range expressions', () => {
    expect(SP.parse('conf:>80').filters.conf).toEqual({ min: 81, max: 100 });
    expect(SP.parse('conf:<50').filters.conf).toEqual({ min: 0, max: 49 });
    expect(SP.parse('conf:80-100').filters.conf).toEqual({ min: 80, max: 100 });
    expect(SP.parse('conf:=100').filters.conf).toEqual({ min: 100, max: 100 });
  });

  it('parses has: presence tokens', () => {
    const r = SP.parse('has:notes has:vin');
    expect(r.filters.has).toEqual(['notes', 'vin']);
  });

  it('keeps unknown field as free text', () => {
    const r = SP.parse('foo:bar audi');
    expect(r.search).toBe('foo:bar audi');
    expect(r.filters.brand).toBe('');
  });

  it('handles quoted values', () => {
    const r = SP.parse('brand:"alfa romeo"');
    expect(r.filters.brand).toBe('alfa romeo');
  });
});

describe('SearchParser.applyClientSideFilters', () => {
  const rows = [
    {
      id: 1,
      brand: 'Audi',
      model: 'RS3',
      ecu_type: 'MED17.0',
      hw_id: '0261S12345',
      sw_id: '1037A',
      tags: 'stage1,dpf-off',
      kind: 'original',
      confidence: 90,
      notes: 'customer john',
      protocol: 'OBD',
      vin: 'WAUZZZ123'
    },
    {
      id: 2,
      brand: 'BMW',
      model: '335i',
      ecu_type: 'MSD80',
      hw_id: '0261B22222',
      sw_id: '2099',
      tags: 'stock',
      kind: 'original',
      confidence: 40,
      notes: '',
      protocol: 'bench',
      vin: ''
    },
    {
      id: 3,
      brand: 'Audi',
      model: 'A4',
      ecu_type: 'EDC17C46',
      hw_id: '0281C99999',
      sw_id: '1037B',
      tags: 'stage1',
      kind: 'solution',
      parent_id: null,
      confidence: 70,
      notes: 'notes here',
      protocol: 'boot',
      vin: ''
    }
  ];

  it('filters brand substring', () => {
    const out = SP.applyClientSideFilters(rows, SP.parse('brand:audi'));
    expect(out.map((r) => r.id).sort()).toEqual([1, 3]);
  });

  it('filters tag AND', () => {
    const out = SP.applyClientSideFilters(rows, SP.parse('tag:stage1 tag:dpf-off'));
    expect(out.map((r) => r.id)).toEqual([1]);
  });

  it('filters conf range', () => {
    const out = SP.applyClientSideFilters(rows, SP.parse('conf:>=70'));
    expect(out.map((r) => r.id).sort()).toEqual([1, 3]);
  });

  it('filters has:vin', () => {
    const out = SP.applyClientSideFilters(rows, SP.parse('has:vin'));
    expect(out.map((r) => r.id)).toEqual([1]);
  });

  it('filters hw prefix wildcard', () => {
    const out = SP.applyClientSideFilters(rows, SP.parse('hw:0261*'));
    expect(out.map((r) => r.id).sort()).toEqual([1, 2]);
  });

  it('filters orphan kind (solution without parent)', () => {
    const out = SP.applyClientSideFilters(rows, SP.parse('kind:orphan'));
    expect(out.map((r) => r.id)).toEqual([3]);
  });
});

describe('SearchParser.format', () => {
  it('round-trips a typical query', () => {
    const text = 'brand:audi tag:stage1 conf:>80 has:notes free text';
    const parsed = SP.parse(text);
    const back = SP.format(parsed);
    // The format() canonicalises conf (>80 becomes >=81); reparsing must match.
    const reparsed = SP.parse(back);
    expect(reparsed.filters.brand).toBe('audi');
    expect(reparsed.filters.tags).toEqual(['stage1']);
    expect(reparsed.filters.has).toEqual(['notes']);
    expect(reparsed.search).toBe('free text');
  });
});

describe('SearchParser.tokenAtCaret + suggest', () => {
  it('identifies the token under the caret', () => {
    const input = 'brand:au tag:stage1';
    const tk = SP.tokenAtCaret(input, 8); // end of "brand:au"
    expect(tk.isField).toBe(true);
    expect(tk.field).toBe('brand');
    expect(tk.prefix).toBe('au');
  });

  it('returns field prefixes for a bare token', () => {
    // No cache filled — should still suggest known field prefixes
    const items = SP.suggest('b', 1, 5);
    const labels = items.map((it) => it.label);
    expect(labels).toContain('brand:');
  });
});
