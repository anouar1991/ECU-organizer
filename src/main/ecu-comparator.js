// @ts-check
/**
 * ECU File Comparator
 *
 * Streams two ECU binary dumps in parallel, computes MD5 of each file,
 * counts differing bytes, builds contiguous "changed regions" with hex/ASCII
 * previews, and produces a 256-bucket heatmap of where the differences land.
 *
 * Designed to be safe for files up to MAX_FILE_BYTES (256 MB) and to cap
 * memory by emitting at most MAX_REGIONS regions to the renderer while
 * still reporting the true total via `totalChangedRegions`.
 *
 * Public API:
 *   compareFiles(pathA, pathB) -> Promise<ComparisonResult>
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CHUNK_SIZE = 1024 * 1024; // 1 MB read window
const MAX_FILE_BYTES = 256 * 1024 * 1024; // 256 MB cap
const MAX_REGIONS = 500; // payload safety
const MAX_PREVIEW_LEN = 64; // bytes of hex/ASCII preview per region
const HEATMAP_BUCKETS = 256;

function md5Stream(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function bufToHex(buf) {
  const parts = new Array(buf.length);
  for (let i = 0; i < buf.length; i++) parts[i] = buf[i].toString(16).padStart(2, '0');
  return parts.join(' ');
}

function bufToAscii(buf) {
  const out = new Array(buf.length);
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    out[i] = b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.';
  }
  return out.join('');
}

async function readChunk(fd, buf, offset, len) {
  return new Promise((resolve, reject) => {
    fs.read(fd, buf, 0, len, offset, (err, bytesRead) => {
      if (err) reject(err);
      else resolve(bytesRead);
    });
  });
}

function openSafe(filePath) {
  return new Promise((resolve, reject) => {
    fs.open(filePath, 'r', (err, fd) => {
      if (err) reject(err);
      else resolve(fd);
    });
  });
}

function closeSafe(fd) {
  return new Promise((resolve) => {
    fs.close(fd, () => resolve());
  });
}

/**
 * Compare two files byte-by-byte; return a structured diff summary.
 * @param {string} pathA - absolute path to file A (original/stock)
 * @param {string} pathB - absolute path to file B (modified/tuned)
 * @returns {Promise<object>}
 */
async function compareFiles(pathA, pathB) {
  const t0 = Date.now();

  if (!pathA || !pathB) throw new Error('Both file paths are required.');
  if (!fs.existsSync(pathA)) throw new Error(`File A not found: ${pathA}`);
  if (!fs.existsSync(pathB)) throw new Error(`File B not found: ${pathB}`);

  const statA = fs.statSync(pathA);
  const statB = fs.statSync(pathB);

  if (statA.size > MAX_FILE_BYTES || statB.size > MAX_FILE_BYTES) {
    throw new Error(
      `File too large to compare (limit ${(MAX_FILE_BYTES / (1024 * 1024)).toFixed(0)} MB). ` +
        `A=${statA.size} bytes, B=${statB.size} bytes`
    );
  }

  // Hash in parallel with byte scan (independent streams, faster wall-clock).
  const md5Promise = Promise.all([md5Stream(pathA), md5Stream(pathB)]);

  const sizeA = statA.size;
  const sizeB = statB.size;
  const comparableLength = Math.min(sizeA, sizeB);

  const fileA = {
    path: pathA,
    name: path.basename(pathA),
    size: sizeA,
    md5: ''
  };
  const fileB = {
    path: pathB,
    name: path.basename(pathB),
    size: sizeB,
    md5: ''
  };

  // Empty file early-out: nothing to compare.
  if (comparableLength === 0) {
    const [md5A, md5B] = await md5Promise;
    fileA.md5 = md5A;
    fileB.md5 = md5B;
    return {
      fileA,
      fileB,
      identical: sizeA === sizeB && md5A === md5B,
      comparableLength: 0,
      bytesEqual: 0,
      bytesDiffer: 0,
      similarity: sizeA === sizeB ? 100 : 0,
      changedRegions: [],
      totalChangedRegions: 0,
      heatmap: new Array(HEATMAP_BUCKETS).fill(0),
      meta: { elapsedMs: Date.now() - t0 }
    };
  }

  // Allocate two 1 MB chunk buffers; reuse on every iteration.
  const bufA = Buffer.allocUnsafe(CHUNK_SIZE);
  const bufB = Buffer.allocUnsafe(CHUNK_SIZE);

  const fdA = await openSafe(pathA);
  let fdB;
  try {
    fdB = await openSafe(pathB);
  } catch (err) {
    await closeSafe(fdA);
    throw err;
  }

  // Heatmap: count of differing bytes per bucket, normalized at the end.
  // Use a Float64 buffer for accumulator since we'll divide later.
  const heatBuckets = HEATMAP_BUCKETS;
  const diffPerBucket = new Float64Array(heatBuckets);
  const bytesPerBucketFloat = comparableLength / heatBuckets;

  let bytesEqual = 0;
  let bytesDiffer = 0;

  // Region state — a "run" of consecutive differing bytes that may span chunks.
  // We keep the byte values for both files so we can build a 64-byte preview
  // without re-reading from disk.
  const regions = [];
  let totalRegions = 0;
  let runStart = -1;
  let runA = null; // Buffer accumulating up to MAX_PREVIEW_LEN bytes from A
  let runB = null;
  let runLen = 0;
  let runTruncated = false;

  const flushRun = () => {
    if (runStart < 0) return;
    totalRegions++;
    if (regions.length < MAX_REGIONS) {
      // Slice the preview buffers to the actual run length (or cap).
      const previewLen = Math.min(runLen, MAX_PREVIEW_LEN);
      const sliceA = runA.subarray(0, previewLen);
      const sliceB = runB.subarray(0, previewLen);
      const hexA = bufToHex(sliceA) + (runTruncated ? ' ...' : '');
      const hexB = bufToHex(sliceB) + (runTruncated ? ' ...' : '');
      const asciiA = bufToAscii(sliceA) + (runTruncated ? '...' : '');
      const asciiB = bufToAscii(sliceB) + (runTruncated ? '...' : '');
      regions.push({
        offset: runStart,
        length: runLen,
        hexA,
        hexB,
        asciiA,
        asciiB
      });
    }
    runStart = -1;
    runA = null;
    runB = null;
    runLen = 0;
    runTruncated = false;
  };

  const startRun = (absOffset) => {
    runStart = absOffset;
    runA = Buffer.allocUnsafe(MAX_PREVIEW_LEN);
    runB = Buffer.allocUnsafe(MAX_PREVIEW_LEN);
    runLen = 0;
    runTruncated = false;
  };

  const appendRun = (byteA, byteB) => {
    if (runLen < MAX_PREVIEW_LEN) {
      runA[runLen] = byteA;
      runB[runLen] = byteB;
    } else {
      runTruncated = true;
    }
    runLen++;
  };

  try {
    let offset = 0;
    while (offset < comparableLength) {
      const want = Math.min(CHUNK_SIZE, comparableLength - offset);

      // Read both chunks in parallel — Linux/Mac handle this fine; on Windows
      // it serializes per-fd but the two fds are independent so it still wins.
      const [gotA, gotB] = await Promise.all([
        readChunk(fdA, bufA, offset, want),
        readChunk(fdB, bufB, offset, want)
      ]);
      const got = Math.min(gotA, gotB);
      if (got === 0) break;

      const sliceA = bufA.subarray(0, got);
      const sliceB = bufB.subarray(0, got);

      // Fast-path: if the chunks are identical AND there is no open run, we
      // can skip per-byte scanning entirely.
      if (runStart < 0 && Buffer.compare(sliceA, sliceB) === 0) {
        bytesEqual += got;
        // Heatmap contribution: all-equal so no diffs to add.
        offset += got;
        continue;
      }

      // Otherwise, scan byte-by-byte to build runs and bucket counts.
      for (let i = 0; i < got; i++) {
        const a = sliceA[i];
        const b = sliceB[i];
        const absOff = offset + i;
        if (a === b) {
          bytesEqual++;
          if (runStart >= 0) flushRun();
        } else {
          bytesDiffer++;
          // Heatmap: which bucket does this byte fall into?
          let bucket = Math.floor(absOff / bytesPerBucketFloat);
          if (bucket >= heatBuckets) bucket = heatBuckets - 1;
          diffPerBucket[bucket]++;
          if (runStart < 0) startRun(absOff);
          appendRun(a, b);
        }
      }
      offset += got;
    }
    // Tail flush in case the file ends mid-run.
    if (runStart >= 0) flushRun();
  } finally {
    await closeSafe(fdA);
    await closeSafe(fdB);
  }

  const [md5A, md5B] = await md5Promise;
  fileA.md5 = md5A;
  fileB.md5 = md5B;

  // Normalize heatmap to 0..100 percent per bucket.
  const heatmap = new Array(heatBuckets);
  // bytes per bucket: comparableLength / buckets, but the last bucket can
  // be slightly larger due to flooring. We approximate uniformly here — for
  // visualization purposes the rounding is invisible.
  const approxBytesPerBucket = Math.max(1, comparableLength / heatBuckets);
  for (let i = 0; i < heatBuckets; i++) {
    const pct = (diffPerBucket[i] / approxBytesPerBucket) * 100;
    heatmap[i] = Math.max(0, Math.min(100, +pct.toFixed(2)));
  }

  const similarity =
    comparableLength === 0
      ? sizeA === sizeB
        ? 100
        : 0
      : +((bytesEqual / comparableLength) * 100).toFixed(2);

  const identical = sizeA === sizeB && md5A === md5B;

  return {
    fileA,
    fileB,
    identical,
    comparableLength,
    bytesEqual,
    bytesDiffer,
    similarity,
    changedRegions: regions,
    totalChangedRegions: totalRegions,
    heatmap,
    meta: {
      elapsedMs: Date.now() - t0
    }
  };
}

module.exports = { compareFiles };
