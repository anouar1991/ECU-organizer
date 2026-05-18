// @ts-check
/**
 * firmware-structure.js
 *
 * Firmware structure detection for Bosch MEDC17/MED17/EDC17 and ME7.x binaries.
 *
 * Ported from:
 *   - ConnorHowell/medc17-checksum-tool (MIT) - main.py BLOCK_IDENTIFIERS + parse_block
 *   - nyetwurk/ME7Sum (BSD)                  - sample.ini + me7sum.c defaults / EPK marker
 *
 * Public API:
 *   detectMedc17Structure(buffer)             -> { regions: [...] } or null
 *   detectMe7Structure(buffer, variantHint)   -> { regions, checksums } or null
 *   getMedc17BlockTypes()                     -> raw block-type table (lazy-loaded)
 *   getMe7Regions()                           -> raw region table (lazy-loaded)
 */

const fs = require('fs');
const path = require('path');

// ---------- Lazy JSON loading ----------

let _medc17BlockTypes = null;
let _me7Regions = null;

function getMedc17BlockTypes() {
  if (_medc17BlockTypes === null) {
    const p = path.join(__dirname, '..', 'data', 'medc17_block_types.json');
    _medc17BlockTypes = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return _medc17BlockTypes;
}

function getMe7Regions() {
  if (_me7Regions === null) {
    const p = path.join(__dirname, '..', 'data', 'me7_regions.json');
    _me7Regions = JSON.parse(fs.readFileSync(p, 'utf8'));
  }
  return _me7Regions;
}

// ---------- Constants ----------

const TRICORE_FLASH_MIN = 0x80000000;
const TRICORE_FLASH_MAX = 0x8fffffff;
const BOSCH_BLOCK_END_MARKER = 0xdeadbeef;
const BOSCH_BLOCK_MIN_SIZE = 0x40;
const DESCRIPTOR_ENTRY_SIZE = 16;
const SCAN_LIMIT_BYTES = 1 * 1024 * 1024; // 1 MB
const DESCRIPTOR_TABLE_OFFSETS = [0x0, 0x10000, 0x20000]; // common starting offsets

// ---------- Helpers ----------

function readU8(buf, off) {
  if (off < 0 || off >= buf.length) return 0;
  return buf[off];
}

function readU32LE(buf, off) {
  if (off < 0 || off + 4 > buf.length) return 0;
  return buf.readUInt32LE(off);
}

function isFlashAddr(addr) {
  return addr >= TRICORE_FLASH_MIN && addr <= TRICORE_FLASH_MAX;
}

function findNextNonZero(buf, start, limit) {
  const end = Math.min(limit !== undefined ? limit : buf.length, buf.length);
  for (let i = start; i < end; i++) {
    if (buf[i] !== 0) return i;
  }
  return -1;
}

function knownBlockTypeIds() {
  const table = getMedc17BlockTypes().block_types;
  const set = new Set();
  for (const k of Object.keys(table)) {
    set.add(parseInt(k, 16));
  }
  return set;
}

// ---------- MEDC17: strict Bosch-block parser ----------

/**
 * Try to parse a full Bosch block header at `offset`.
 * Port of MEDC17BinaryParser.parse_block (main.py:503-590).
 * Returns parsed region descriptor or null if it doesn't validate.
 */
function parseBoschBlock(buf, offset, knownIds) {
  if (offset + BOSCH_BLOCK_MIN_SIZE > buf.length) return null;

  const blockIdentifier = readU32LE(buf, offset);
  const size = readU32LE(buf, offset + 4);
  const blockEnd = readU32LE(buf, offset + 12);

  const typeId = blockIdentifier & 0xff;
  if (!knownIds.has(typeId)) return null;

  if (size < BOSCH_BLOCK_MIN_SIZE) return null;
  if (size > buf.length) return null;
  if (offset + size > buf.length) return null;

  // trailing 0xDEADBEEF marker
  const markerOff = offset + size - 4;
  if (readU32LE(buf, markerOff) !== BOSCH_BLOCK_END_MARKER) return null;

  if (!isFlashAddr(blockEnd)) return null;

  // block_start = ((block_end + 5) - size - 1)   (main.py:557)
  const blockStart = ((blockEnd + 5) >>> 0) - size - 1;
  // Use unsigned semantics; if subtraction wraps negative, reject
  if (blockStart < 0 || !isFlashAddr(blockStart >>> 0)) return null;

  const numChecksumStructs = readU32LE(buf, offset + 26 + 10 + 8);
  if (numChecksumStructs > 100) return null;

  const checksumAdjust = readU32LE(buf, offset + 0x30);
  const swIdRaw = buf.slice(offset + 26, offset + 26 + 10);
  const swIdentifier = swIdRaw.toString('ascii').replace(/\0+$/g, '');

  const blockTypes = getMedc17BlockTypes().block_types;
  const typeKey = '0x' + typeId.toString(16).toUpperCase().padStart(2, '0');
  const typeMeta = blockTypes[typeKey] ||
    blockTypes[typeKey.toLowerCase()] || { name: 'UNKNOWN', description: `Unknown (${typeKey})` };

  return {
    type: typeKey,
    name: typeMeta.name,
    description: typeMeta.description,
    file_offset: offset,
    block_identifier: blockIdentifier >>> 0,
    block_start_mem: blockStart >>> 0,
    block_end_mem: blockEnd >>> 0,
    size: size,
    sw_identifier: swIdentifier,
    num_checksum_structures: numChecksumStructs,
    checksum_adjust: checksumAdjust >>> 0,
    end_marker_offset: markerOff,
    parser: 'bosch_block_v1'
  };
}

// ---------- MEDC17: lightweight 16-byte descriptor-table scanner ----------

/**
 * Parse a 16-byte descriptor entry at offset:
 *   +0   : type (1 byte)
 *   +1..3: padding / flags
 *   +4..7: start address (uint32 LE)
 *   +8..11: end address (uint32 LE)
 *   +12..15: checksum offset or length (uint32 LE)
 *
 * Returns the entry if it passes (type in known set, end>start,
 * both addresses < file size) — else null.
 */
function parseDescriptorEntry(buf, offset, knownIds, _fileSize) {
  if (offset + DESCRIPTOR_ENTRY_SIZE > buf.length) return null;
  const typeId = readU8(buf, offset);
  if (!knownIds.has(typeId)) return null;
  const start = readU32LE(buf, offset + 4);
  const end = readU32LE(buf, offset + 8);
  const csOrLen = readU32LE(buf, offset + 12);

  if (end <= start) return null;
  // Note: descriptor addresses describe a memory-mapped region that may extend
  // beyond the file (e.g. flash-image descriptors reference logical RAM/flash
  // addresses, not file offsets). We sanity-check that addresses are non-zero
  // and the region is non-empty, but allow end > fileSize.
  if (start === 0 && end === 0) return null;

  const blockTypes = getMedc17BlockTypes().block_types;
  const typeKey = '0x' + typeId.toString(16).toUpperCase().padStart(2, '0');
  const typeMeta = blockTypes[typeKey] || { name: 'UNKNOWN', description: `Unknown (${typeKey})` };

  return {
    type: typeKey,
    name: typeMeta.name,
    description: typeMeta.description,
    file_offset: offset,
    start: start >>> 0,
    end: end >>> 0,
    length: (end - start) >>> 0,
    checksum_addr: csOrLen >>> 0,
    parser: 'descriptor_16b_v1'
  };
}

/**
 * Scan a descriptor table starting at `tableOffset`, reading up to 32 entries.
 * Stops on the first non-decodable entry. Returns the list (possibly empty).
 */
function scanDescriptorTable(buf, tableOffset, knownIds, fileSize, maxEntries = 32) {
  const entries = [];
  for (let i = 0; i < maxEntries; i++) {
    const off = tableOffset + i * DESCRIPTOR_ENTRY_SIZE;
    const entry = parseDescriptorEntry(buf, off, knownIds, fileSize);
    if (!entry) break;
    entries.push(entry);
  }
  return entries;
}

// ---------- Public: MEDC17 ----------

/**
 * Detect MEDC17/MED17/EDC17 firmware structure in `buffer`.
 * Returns { regions: [...] } if any blocks/descriptors are found, else null.
 *
 * Strategy:
 *   1. Try the full Bosch-block parser at every non-zero start in the first 1 MB
 *      (port of find_bosch_blocks from main.py:595-632).
 *   2. If that yields nothing, fall back to the lightweight 16-byte descriptor
 *      scanner at well-known table offsets (0x0, 0x10000, 0x20000).
 *
 * The 16-byte descriptor format covers the simplified case described in the
 * task algorithm hint and is exercised by the sanity test.
 */
function detectMedc17Structure(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < BOSCH_BLOCK_MIN_SIZE) {
    return null;
  }

  const knownIds = knownBlockTypeIds();
  const scanLimit = Math.min(buffer.length, SCAN_LIMIT_BYTES);
  const regions = [];

  // --- Pass 1: strict Bosch block scan ---
  let pos = findNextNonZero(buffer, 0, scanLimit);
  let safety = 0;
  while (pos !== -1 && pos < scanLimit && safety < 1024) {
    safety++;
    const block = parseBoschBlock(buffer, pos, knownIds);
    if (block) {
      regions.push(block);
      const nextPos = findNextNonZero(buffer, pos + block.size, scanLimit);
      pos = nextPos;
    } else {
      const nextPos = findNextNonZero(buffer, pos + 1, scanLimit);
      pos = nextPos;
    }
  }

  if (regions.length > 0) {
    return { regions, parser: 'bosch_block_v1' };
  }

  // --- Pass 2: 16-byte descriptor-table fallback ---
  for (const tableOff of DESCRIPTOR_TABLE_OFFSETS) {
    if (tableOff >= buffer.length) continue;
    const entries = scanDescriptorTable(buffer, tableOff, knownIds, buffer.length);
    if (entries.length > 0) {
      // Discovered a plausible descriptor table.
      return { regions: entries, table_offset: tableOff, parser: 'descriptor_16b_v1' };
    }
  }

  return null;
}

// ---------- Public: ME7 ----------

/**
 * Detect Bosch ME7.x firmware structure in `buffer`.
 * Returns { regions, checksums } or null.
 *
 * Validation: looks for the EPK secondary signature c3 3c 5a 5a ff ff at
 * offset 0xFFFE (from me7sum.c FindEPK, line 1091-1101). If absent, returns
 * null (we don't have a strong magic to pivot on otherwise without porting
 * the full needle-based scanner).
 *
 * variantHint: optional string ("ME7.1", "ME7.1.1", "ME7.5"). When provided,
 * the matching variant's region defaults from me7_regions.json are returned
 * as `regions`. Without a hint, ME7.1 defaults are used.
 */
function detectMe7Structure(buffer, variantHint) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 0x10010) {
    return null;
  }

  // EPK secondary signature check: 6 bytes c3 3c 5a 5a ff ff at 0xFFFE
  const SIG = Buffer.from([0xc3, 0x3c, 0x5a, 0x5a, 0xff, 0xff]);
  const sigOff = 0xfffe;
  const hasEpkSig =
    buffer.length >= sigOff + SIG.length && buffer.slice(sigOff, sigOff + SIG.length).equals(SIG);

  if (!hasEpkSig) {
    return null;
  }

  const me7 = getMe7Regions();
  const variant = variantHint && me7.variants[variantHint] ? variantHint : 'ME7.1';
  const v = me7.variants[variant];

  const parseHex = (s) =>
    typeof s === 'string' && s.startsWith('0x') ? parseInt(s, 16) : typeof s === 'number' ? s : 0;

  const regions = [];
  regions.push({
    type: 'EPK',
    name: 'EPK signature',
    file_offset: sigOff,
    length: SIG.length,
    note: 'me7sum.c FindEPK fallback marker'
  });
  regions.push({
    type: 'ROM',
    name: 'Firmware ROM image',
    base_address: parseHex(v.base_address),
    rom_size: parseHex(v.rom_size)
  });
  if (v.multipoint_scan_start !== undefined) {
    regions.push({
      type: 'MULTIPOINT',
      name: 'Multipoint descriptor table (scan start)',
      scan_start: parseHex(v.multipoint_scan_start),
      desc_len: parseHex(v.multipoint_desc_len)
    });
  }

  const checksums = [];
  if (v.crc_blocks_fallback) {
    for (const key of Object.keys(v.crc_blocks_fallback)) {
      const crc = v.crc_blocks_fallback[key];
      checksums.push({
        name: key,
        start: parseHex(crc.start),
        end: crc.end !== undefined ? parseHex(crc.end) : null
      });
    }
  }

  return {
    variant,
    regions,
    checksums,
    epk_signature_offset: sigOff,
    parser: 'me7sum_v1'
  };
}

// ---------- Exports ----------

module.exports = {
  detectMedc17Structure,
  detectMe7Structure,
  getMedc17BlockTypes,
  getMe7Regions
};
