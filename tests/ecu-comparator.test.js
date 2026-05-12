/**
 * ecu-comparator.test.js
 *
 * Tests src/main/ecu-comparator.js using synthesized 4 KB buffers written to
 * a temp dir. No real ECU dumps are needed.
 *
 * Covers:
 *   - identical inputs -> identical:true, similarity:100
 *   - 4-byte diff at offset 0x100 -> bytesDiffer:4, totalChangedRegions:1, region offset 0x100
 *   - heatmap has exactly one nonzero bucket for that diff
 *   - different-size files still produce overlap stats + size diff
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
// vitest globals injected via vitest.config.js `globals: true`.

const { compareFiles } = require('../src/main/ecu-comparator.js');

const SIZE = 4 * 1024;
const DIFF_OFFSET = 0x100;

describe('ecu-comparator', () => {
  let tmpDir;
  let pathSameA, pathSameB;
  let pathDiffA, pathDiffB;
  let pathShort, pathLong;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecu-cmp-test-'));

    // Identical pair: same 4 KB buffer written twice.
    const base = Buffer.alloc(SIZE);
    for (let i = 0; i < SIZE; i++) base[i] = (i * 11 + 3) & 0xff;
    pathSameA = path.join(tmpDir, 'same_a.bin');
    pathSameB = path.join(tmpDir, 'same_b.bin');
    fs.writeFileSync(pathSameA, base);
    fs.writeFileSync(pathSameB, base);

    // Diff pair: 4 contiguous bytes at offset 0x100 differ.
    const a = Buffer.from(base);
    const b = Buffer.from(base);
    for (let i = 0; i < 4; i++) b[DIFF_OFFSET + i] = (a[DIFF_OFFSET + i] ^ 0xff) & 0xff;
    pathDiffA = path.join(tmpDir, 'diff_a.bin');
    pathDiffB = path.join(tmpDir, 'diff_b.bin');
    fs.writeFileSync(pathDiffA, a);
    fs.writeFileSync(pathDiffB, b);

    // Different-size pair: short = 2 KB of base, long = full 4 KB of base.
    pathShort = path.join(tmpDir, 'short.bin');
    pathLong = path.join(tmpDir, 'long.bin');
    fs.writeFileSync(pathShort, base.subarray(0, 2 * 1024));
    fs.writeFileSync(pathLong, base);
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {
      /* ignore */
    }
  });

  it('compareFiles(same, same) returns identical:true, similarity:100', async () => {
    const result = await compareFiles(pathSameA, pathSameB);

    expect(result.identical).toBe(true);
    expect(result.similarity).toBe(100);
    expect(result.bytesDiffer).toBe(0);
    expect(result.bytesEqual).toBe(SIZE);
    expect(result.totalChangedRegions).toBe(0);
    expect(result.changedRegions).toEqual([]);
  });

  it('detects exactly 4 differing bytes in a single region at offset 0x100', async () => {
    const result = await compareFiles(pathDiffA, pathDiffB);

    expect(result.identical).toBe(false);
    expect(result.bytesDiffer).toBe(4);
    expect(result.totalChangedRegions).toBe(1);
    expect(result.changedRegions).toHaveLength(1);

    const region = result.changedRegions[0];
    expect(region.offset).toBe(DIFF_OFFSET);
    expect(region.length).toBe(4);
    // hex preview should be 4 space-separated pairs
    expect(region.hexA.trim().split(/\s+/)).toHaveLength(4);
    expect(region.hexB.trim().split(/\s+/)).toHaveLength(4);
  });

  it('heatmap has exactly one nonzero bucket for a single 4-byte diff', async () => {
    const result = await compareFiles(pathDiffA, pathDiffB);

    expect(Array.isArray(result.heatmap)).toBe(true);
    expect(result.heatmap.length).toBe(256);

    const nonzero = result.heatmap.filter((v) => v > 0);
    expect(nonzero).toHaveLength(1);
  });

  it('handles files of different size: compares overlap and reports size diff', async () => {
    const result = await compareFiles(pathShort, pathLong);

    expect(result.fileA.size).not.toBe(result.fileB.size);
    expect(result.comparableLength).toBe(2 * 1024); // min(2KB, 4KB)
    // Overlap region is identical content, so bytesEqual covers the full overlap.
    expect(result.bytesEqual).toBe(2 * 1024);
    expect(result.bytesDiffer).toBe(0);
    // Even with identical overlap, identical:false because sizes differ.
    expect(result.identical).toBe(false);
  });
});
