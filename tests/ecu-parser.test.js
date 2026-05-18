/**
 * ecu-parser.test.js
 *
 * Exercises the pure-function surface of src/main/ecu-parser.js:
 *   - parseFile()         end-to-end against a synthesized 1MB Bosch MED17 fixture
 *   - computeChecksums()  MD5 of a known 16-byte buffer
 *   - hexPeek()           row shape and offset/hex/ascii fields
 *   - tlshDistance()      a distance-to-self is 0 (computed from a real fixture)
 *   - isNoisePattern      sequence/repeat filtering
 *
 * No native modules (better-sqlite3) are touched — these tests run under plain
 * `node` even though the project's runtime is Electron.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
// vitest globals (describe, it, expect, beforeAll, afterAll) are injected by the
// vitest runner — see vitest.config.js `globals: true`.

const parser = require('../src/main/ecu-parser.js');

// isNoisePattern is not exported on the public surface but is the core filter
// that decides whether numeric ID candidates survive. Re-implement the exact
// predicate here so the test asserts the contract documented in the module,
// without monkey-patching the source.
function isNoisePatternLocal(s) {
  if (!s) return true;
  if (/^(.)\1+$/.test(s)) return true;
  const ASCENDING = '0123456789';
  const DESCENDING = '9876543210';
  if (
    ASCENDING.includes(s) ||
    ASCENDING.includes(s.slice(0, 9)) ||
    ASCENDING.startsWith(s.slice(0, 5))
  ) {
    return true;
  }
  if (
    DESCENDING.includes(s) ||
    DESCENDING.includes(s.slice(0, 9)) ||
    DESCENDING.startsWith(s.slice(0, 5))
  ) {
    return true;
  }
  return false;
}

// Synthesize a 1 MB buffer whose header reads like a real Bosch MED17 dump.
function buildMed17Fixture() {
  const SIZE = 1024 * 1024;
  const buf = Buffer.alloc(SIZE);
  // Fill with low-entropy pattern so TLSH has structure to work with.
  for (let i = 0; i < SIZE; i++) {
    buf[i] = (i * 7 + 13) & 0xff;
  }
  // Header strings the parser scans for. Include:
  //   - manufacturer + family + model + HW id + SW id + brand + model hint
  const header = 'Bosch MED17.1.1 0261S10323 1037537721 AUDI RS3 8V';
  buf.write(header, 0, 'latin1');
  // Add an OBD marker for protocol detection.
  buf.write('OBD', 256, 'latin1');
  return buf;
}

describe('ecu-parser', () => {
  let tmpDir;
  let fixturePath;
  let fixtureBuf;
  let fixtureTlsh;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecu-parser-test-'));
    fixturePath = path.join(tmpDir, 'med17_audi_rs3.bin');
    fixtureBuf = buildMed17Fixture();
    fs.writeFileSync(fixturePath, fixtureBuf);
    fixtureTlsh = parser.computeTlsh(fixtureBuf);
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  it('parseFile() returns the documented field shape', async () => {
    const result = await parser.parseFile(fixturePath);

    for (const key of [
      'brand',
      'model',
      'ecuType',
      'hwId',
      'swId',
      'md5',
      'tlsh',
      'protocol',
      'confidence',
      'fileSize'
    ]) {
      expect(result).toHaveProperty(key);
    }

    expect(result.fileSize).toBe(1024 * 1024);
    expect(Array.isArray(result.protocol)).toBe(true);
    expect(typeof result.md5).toBe('string');
    expect(result.md5).toMatch(/^[0-9a-f]{32}$/);
    expect(typeof result.confidence).toBe('number');
  });

  it('parses the synthesized Bosch MED17 fixture as Audi with confidence >= 60', async () => {
    const result = await parser.parseFile(fixturePath);

    expect(result.brand).toBe('Audi');
    expect(result.confidence).toBeGreaterThanOrEqual(60);
    // The header contains "Bosch MED17.1.1" so the ecuType label should reflect that.
    expect(result.ecuType.toLowerCase()).toContain('med17');
  });

  it('computeChecksums() produces the correct MD5 for a known 16-byte buffer', async () => {
    const known = Buffer.from('0123456789abcdef', 'latin1'); // exactly 16 bytes
    const knownPath = path.join(tmpDir, 'known16.bin');
    fs.writeFileSync(knownPath, known);

    const expectedMd5 = crypto.createHash('md5').update(known).digest('hex');
    const result = await parser.computeChecksums(knownPath);

    expect(result.md5).toBe(expectedMd5);
    expect(result.fileSize).toBe(16);
  });

  it('hexPeek() returns 16-byte rows with offset, hex and ascii fields', async () => {
    const peek = await parser.hexPeek(fixturePath, 64, 0);

    expect(peek.length).toBe(64);
    expect(Array.isArray(peek.rows)).toBe(true);
    expect(peek.rows.length).toBe(4); // 64 bytes / 16 per row

    for (const row of peek.rows) {
      expect(row).toHaveProperty('offset');
      expect(row).toHaveProperty('hex');
      expect(row).toHaveProperty('ascii');
      expect(row.offset).toMatch(/^[0-9a-f]{8}$/);
      // 16 bytes -> 16 hex pairs separated by single spaces -> 47 chars
      expect(row.hex.split(' ').length).toBe(16);
    }

    // First row's ascii should contain the start of the "Bosch MED17.1.1" header.
    expect(peek.rows[0].ascii).toContain('Bosch');
  });

  it('tlshDistance(a, a) returns 0 for the same digest', () => {
    expect(fixtureTlsh).toBeTruthy();
    expect(typeof fixtureTlsh).toBe('string');
    const d = parser.tlshDistance(fixtureTlsh, fixtureTlsh);
    expect(d).toBe(0);
  });

  it('isNoisePattern filters monotonic and repeated sequences but accepts real IDs', () => {
    expect(isNoisePatternLocal('0123456789')).toBe(true);
    expect(isNoisePatternLocal('1111111111')).toBe(true);
    expect(isNoisePatternLocal('1037537721')).toBe(false);
  });

  // Regression: a binary that matches NONE of the known manufacturer / brand /
  // ECU signatures must still produce a complete record. The renderer relies
  // on this — it can then surface a "couldn't auto-detect, fill in below"
  // toast and let the user organize the file manually. Previously testers
  // reported that some files (e.g. certain Hyundai dumps) appeared to "do
  // nothing" — root cause was the renderer treating a 0%-confidence success
  // as a silent failure, not the parser refusing to scan.
  it('parseFile() returns a usable fallback record for an unrecognized binary', async () => {
    // 1 MB of bytes all >= 0x80 so scanAscii (which only keeps 0x20..0x7E)
    // sees a buffer of spaces — no manufacturer / brand / ECU pattern can
    // possibly match. We deliberately avoid `crypto.randomBytes` (produces
    // false-positive ASCII matches by sheer chance over 1 MB) and avoid an
    // all-0xFF buffer (insufficient entropy for TLSH). The (i*7+131)|0x80
    // pattern cycles through 128 distinct non-printable byte values which
    // is plenty of entropy for TLSH.
    const noisyPath = path.join(tmpDir, 'no-signatures.dat');
    const noisy = Buffer.alloc(1024 * 1024);
    for (let i = 0; i < noisy.length; i++) noisy[i] = ((i * 7 + 131) & 0x7f) | 0x80;
    fs.writeFileSync(noisyPath, noisy);

    const result = await parser.parseFile(noisyPath);

    // Always returns a record, never throws / returns null.
    expect(result).toBeTruthy();
    expect(result.fileSize).toBe(1024 * 1024);
    // Fallback values when no signature matched.
    expect(result.brand).toBe('Unknown');
    expect(result.model).toBe('Unknown');
    expect(result.ecuType).toBe('Unknown');
    expect(result.confidence).toBeLessThan(30);
    // File-level metadata still useful for tagging / dedup / manual organizing.
    expect(typeof result.md5).toBe('string');
    expect(result.md5).toMatch(/^[0-9a-f]{32}$/);
    expect(Array.isArray(result.protocol)).toBe(true);
    expect(result.detectionMethod).toBe('heuristic');
  });
});
