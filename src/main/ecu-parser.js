// @ts-check
const fs = require('fs');
const crypto = require('crypto');
const tlshHash = require('tlsh');
/** @type {any} */
const DigestHashBuilder = require('tlsh/lib/digests/digest-hash-builder');
const dataLoader = require('./data-loader');
const firmwareStructure = require('./firmware-structure');
const { computeTlshAsync } = require('./tlsh-pool');

const ECU_SIGNATURES = [
  {
    manufacturer: 'Bosch',
    family: 'MED17',
    patterns: ['MED17', 'BOSCH', 'ME17'],
    models: ['MED17.1', 'MED17.1.1', 'MED17.1.6', 'MED17.5', 'MED17.5.20', 'MED17.5.25']
  },
  {
    manufacturer: 'Bosch',
    family: 'MEDC17',
    patterns: ['MEDC17', 'MEDC'],
    models: ['MEDC17.5', 'MEDC17.5.1', 'MEDC17.5.5', 'MEDC17.9']
  },
  {
    manufacturer: 'Bosch',
    family: 'EDC17',
    patterns: ['EDC17', 'EDC_17'],
    models: [
      'EDC17C46',
      'EDC17C54',
      'EDC17C64',
      'EDC17CP04',
      'EDC17CP14',
      'EDC17CP20',
      'EDC17CP44',
      'EDC17CP46'
    ]
  },
  {
    manufacturer: 'Bosch',
    family: 'EDC16',
    patterns: ['EDC16'],
    models: ['EDC16C39', 'EDC16C34', 'EDC16CP35', 'EDC16U31', 'EDC16U34']
  },
  {
    manufacturer: 'Bosch',
    family: 'EDC15',
    patterns: ['EDC15'],
    models: ['EDC15C2', 'EDC15P+', 'EDC15VM+']
  },
  {
    manufacturer: 'Bosch',
    family: 'ME7',
    patterns: ['ME7', 'ME 7'],
    models: ['ME7.1', 'ME7.1.1', 'ME7.5', 'ME7.8']
  },
  {
    manufacturer: 'Bosch',
    family: 'MG1',
    patterns: ['MG1', 'MG1CS'],
    models: ['MG1CS001', 'MG1CS002', 'MG1CS003', 'MG1CS024', 'MG1CS201']
  },
  {
    manufacturer: 'Bosch',
    family: 'MD1',
    patterns: ['MD1', 'MD1CS'],
    models: ['MD1CS001', 'MD1CP006']
  },
  {
    manufacturer: 'Continental',
    family: 'SID',
    patterns: [
      'SID2',
      'SID20',
      'SID201',
      'SID202',
      'SID203',
      'SID204',
      'SID208',
      'SID807',
      'SID807EVO'
    ],
    models: ['SID201', 'SID202', 'SID203', 'SID204', 'SID208', 'SID807']
  },
  {
    manufacturer: 'Continental',
    family: 'SIMOS',
    patterns: ['SIMOS', 'Simos'],
    models: ['SIMOS8.5', 'SIMOS10', 'SIMOS12', 'SIMOS16', 'SIMOS18', 'SIMOS18.1', 'SIMOS18.10']
  },
  {
    manufacturer: 'Continental',
    family: 'EMS',
    patterns: ['EMS2', 'EMS3'],
    models: ['EMS2103', 'EMS2204', 'EMS3120', 'EMS3134']
  },
  {
    manufacturer: 'Continental',
    family: 'DCM',
    patterns: ['DCM3', 'DCM6'],
    models: ['DCM3.7', 'DCM3.5', 'DCM6.1', 'DCM6.2']
  },
  {
    manufacturer: 'Delphi',
    family: 'DCM',
    patterns: ['DCM3.7AP', 'DCM3.4'],
    models: ['DCM3.4', 'DCM3.7AP']
  },
  { manufacturer: 'Delphi', family: 'DDCR', patterns: ['DDCR'], models: ['DDCR'] },
  { manufacturer: 'Denso', family: 'DENSO', patterns: ['DENSO', 'Denso'], models: ['DENSO'] },
  {
    manufacturer: 'Marelli',
    family: 'MJD',
    patterns: ['MJD', 'MJ_D'],
    models: ['MJD6JF', 'MJD6JO', 'MJD6F3', 'MJD8F3', 'MJD8DF', 'MJD8GS']
  },
  {
    manufacturer: 'Marelli',
    family: 'IAW',
    patterns: ['IAW'],
    models: ['IAW5NF', 'IAW7GF', 'IAW8GMF', 'IAW9GF']
  },
  {
    manufacturer: 'Siemens',
    family: 'MS',
    patterns: ['MS43', 'MS45', 'MSV80', 'MSV90', 'MSD80', 'MSD81', 'MSD85', 'MSD87'],
    models: ['MS43', 'MS45', 'MSV80', 'MSV90', 'MSD80', 'MSD85', 'MSD87']
  },
  {
    manufacturer: 'Visteon',
    family: 'DCU',
    patterns: ['DCU102', 'DCU103'],
    models: ['DCU102', 'DCU103']
  }
];

const BRAND_HINTS = [
  { brand: 'Audi', patterns: ['AUDI', 'Audi', '4G0', '8K0', '8V0', '8W0', '4M0'] },
  {
    brand: 'Volkswagen',
    patterns: ['VW', 'Volkswagen', 'VAG', '03L', '04L', '06H', '06J', '06K', '06L', '5Q0', '5C0']
  },
  { brand: 'Seat', patterns: ['SEAT', 'Seat'] },
  { brand: 'Skoda', patterns: ['SKODA', 'Skoda'] },
  { brand: 'BMW', patterns: ['BMW', 'Bmw', 'F-Serie', 'G-Serie', 'E9X'] },
  { brand: 'Mercedes-Benz', patterns: ['MERCEDES', 'Mercedes', 'MB', 'DAIMLER', 'Daimler'] },
  { brand: 'Porsche', patterns: ['PORSCHE', 'Porsche'] },
  { brand: 'Ford', patterns: ['FORD', 'Ford'] },
  { brand: 'Opel', patterns: ['OPEL', 'Opel', 'VAUXHALL', 'Vauxhall'] },
  { brand: 'Renault', patterns: ['RENAULT', 'Renault', 'DACIA', 'Dacia'] },
  { brand: 'Peugeot', patterns: ['PEUGEOT', 'Peugeot', 'PSA'] },
  { brand: 'Citroen', patterns: ['CITROEN', 'Citroen', 'CITROËN'] },
  { brand: 'Fiat', patterns: ['FIAT', 'Fiat', 'STELLANTIS'] },
  { brand: 'Alfa Romeo', patterns: ['ALFA', 'Alfa'] },
  { brand: 'Hyundai', patterns: ['HYUNDAI', 'Hyundai'] },
  { brand: 'Kia', patterns: ['KIA', 'Kia'] },
  { brand: 'Toyota', patterns: ['TOYOTA', 'Toyota'] },
  { brand: 'Nissan', patterns: ['NISSAN', 'Nissan'] },
  { brand: 'Mazda', patterns: ['MAZDA', 'Mazda'] },
  { brand: 'Volvo', patterns: ['VOLVO', 'Volvo'] },
  { brand: 'Jaguar', patterns: ['JAGUAR', 'Jaguar'] },
  { brand: 'Land Rover', patterns: ['LANDROVER', 'LAND_ROVER', 'Land Rover'] }
];

const MODEL_HINTS = [
  { model: 'RS3 (8V)', brand: 'Audi', patterns: ['RS3', 'RS_3', '8V'] },
  { model: 'RS4 (B8)', brand: 'Audi', patterns: ['RS4', 'B8'] },
  { model: 'RS6 (C7)', brand: 'Audi', patterns: ['RS6', 'C7'] },
  { model: 'S3 (8V)', brand: 'Audi', patterns: ['S3'] },
  { model: 'A3 (8V)', brand: 'Audi', patterns: ['A3', '8V'] },
  { model: 'Golf GTI', brand: 'Volkswagen', patterns: ['GOLF', 'GTI'] },
  { model: 'Golf R', brand: 'Volkswagen', patterns: ['GolfR', 'GOLF_R'] },
  { model: 'M3 (F80)', brand: 'BMW', patterns: ['M3', 'F80'] },
  { model: 'M5 (F90)', brand: 'BMW', patterns: ['M5', 'F90'] },
  { model: '335i', brand: 'BMW', patterns: ['335'] },
  { model: 'C63 AMG', brand: 'Mercedes-Benz', patterns: ['C63', 'AMG_C'] },
  { model: 'E63 AMG', brand: 'Mercedes-Benz', patterns: ['E63'] }
];

const HW_REGEX = /(?<![A-Z0-9])(\d{4}[A-Z]\d{5,6})(?![A-Z0-9])/g;
const BOSCH_HW_REGEX = /(?<![0-9])(02\d{8})(?![0-9])/g;
const BOSCH_SW_REGEX = /(?<![0-9])(10\d{8})(?![0-9])/g;
const TEN_DIGIT_REGEX = /(?<![0-9])(\d{10})(?![0-9])/g;
const VAG_BOX_REGEX = /\b([0-9][A-Z0-9]{2}\s?[0-9]{3}\s?[0-9]{3}[A-Z]{0,2})\b/g;
const VIN_REGEX = /\b([A-HJ-NPR-Z0-9]{17})\b/g;

function isNoisePattern(s) {
  if (!s) return true;
  if (/^(.)\1+$/.test(s)) return true;
  const ASCENDING = '0123456789';
  const DESCENDING = '9876543210';
  if (
    ASCENDING.includes(s) ||
    ASCENDING.includes(s.slice(0, 9)) ||
    ASCENDING.startsWith(s.slice(0, 5))
  )
    return true;
  if (
    DESCENDING.includes(s) ||
    DESCENDING.includes(s.slice(0, 9)) ||
    DESCENDING.startsWith(s.slice(0, 5))
  )
    return true;
  return false;
}

function scanAscii(buffer) {
  let out = '';
  for (let i = 0; i < buffer.length; i++) {
    const b = buffer[i];
    out += b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ' ';
  }
  return out;
}

function detectECU(text) {
  let best = null;
  let bestScore = 0;

  for (const sig of ECU_SIGNATURES) {
    for (const pattern of sig.patterns) {
      const idx = text.indexOf(pattern);
      if (idx !== -1) {
        const score = pattern.length * 5;
        let detectedModel = sig.family;
        for (const model of sig.models) {
          if (text.includes(model)) {
            detectedModel = model;
            break;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          best = {
            manufacturer: sig.manufacturer,
            family: sig.family,
            model: detectedModel,
            label: `${sig.manufacturer} ${detectedModel}`,
            score
          };
        }
      }
    }
  }

  return best;
}

function detectBrand(text) {
  let best = null;
  let bestScore = 0;

  for (const b of BRAND_HINTS) {
    for (const pattern of b.patterns) {
      if (text.includes(pattern)) {
        const score = pattern.length * 3;
        if (score > bestScore) {
          bestScore = score;
          best = { brand: b.brand, score };
        }
      }
    }
  }

  return best;
}

function detectModel(text, brand) {
  if (!brand) return null;
  for (const m of MODEL_HINTS) {
    if (m.brand !== brand) continue;
    for (const pattern of m.patterns) {
      const re = new RegExp(
        `(?:^|[^A-Z0-9])${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:[^A-Z0-9]|$)`
      );
      if (re.test(text)) {
        return { model: m.model, score: pattern.length * 2 };
      }
    }
  }
  return null;
}

function extractIDs(text) {
  const dotPattern = [...text.matchAll(HW_REGEX)]
    .map((m) => m[1])
    .filter((s) => !isNoisePattern(s));
  const boschHw = [...text.matchAll(BOSCH_HW_REGEX)]
    .map((m) => m[1])
    .filter((s) => !isNoisePattern(s));
  const boschSw = [...text.matchAll(BOSCH_SW_REGEX)]
    .map((m) => m[1])
    .filter((s) => !isNoisePattern(s));
  const tenDigitAny = [...text.matchAll(TEN_DIGIT_REGEX)]
    .map((m) => m[1])
    .filter((s) => !isNoisePattern(s));
  const vagBoxes = [...text.matchAll(VAG_BOX_REGEX)]
    .map((m) => m[1].replace(/\s/g, ''))
    .filter((s) => !isNoisePattern(s));
  const vins = [...text.matchAll(VIN_REGEX)].map((m) => m[1]);

  const hwCandidates = [...boschHw, ...dotPattern, ...vagBoxes];
  const swCandidates = [
    ...boschSw,
    ...tenDigitAny.filter((s) => !boschHw.includes(s) && !boschSw.includes(s))
  ];

  return {
    hwId: hwCandidates[0] || null,
    swId: swCandidates[0] || null,
    allHw: hwCandidates,
    allSw: swCandidates,
    vagBoxes,
    vins
  };
}

function detectBrandFromName(fileName) {
  const sanitized = fileName.replace(/[_\-.()]/g, ' ');
  let best = null,
    bestScore = 0;
  for (const b of BRAND_HINTS) {
    for (const pattern of b.patterns) {
      const re = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(sanitized)) {
        const score = pattern.length * 4;
        if (score > bestScore) {
          bestScore = score;
          best = { brand: b.brand, score };
        }
      }
    }
  }
  return best;
}

function detectModelFromName(fileName, brand) {
  const sanitized = fileName.replace(/[_\-.()]/g, ' ');
  for (const m of MODEL_HINTS) {
    if (brand && m.brand !== brand) continue;
    for (const pattern of m.patterns) {
      const re = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(sanitized)) {
        return { model: m.model, score: pattern.length * 3 };
      }
    }
  }
  return null;
}

function detectECUFromName(fileName) {
  const sanitized = fileName.replace(/[_\-.()]/g, ' ');
  let best = null,
    bestScore = 0;
  for (const sig of ECU_SIGNATURES) {
    for (const pattern of sig.patterns) {
      const re = new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
      if (re.test(sanitized)) {
        const score = pattern.length * 5;
        let detectedModel = sig.family;
        for (const model of sig.models) {
          if (
            new RegExp(`\\b${model.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(sanitized)
          ) {
            detectedModel = model;
            break;
          }
        }
        if (score > bestScore) {
          bestScore = score;
          best = {
            manufacturer: sig.manufacturer,
            family: sig.family,
            model: detectedModel,
            label: `${sig.manufacturer} ${detectedModel}`,
            score
          };
        }
      }
    }
  }
  return best;
}

function extractIDsFromName(fileName) {
  const sanitized = fileName.replace(/[_\-.()]/g, ' ');
  const boschHw = [...sanitized.matchAll(BOSCH_HW_REGEX)]
    .map((m) => m[1])
    .filter((s) => !isNoisePattern(s));
  const boschSw = [...sanitized.matchAll(BOSCH_SW_REGEX)]
    .map((m) => m[1])
    .filter((s) => !isNoisePattern(s));
  const tenAny = [...sanitized.matchAll(TEN_DIGIT_REGEX)]
    .map((m) => m[1])
    .filter((s) => !isNoisePattern(s));
  return {
    hwId: boschHw[0] || null,
    swId: boschSw[0] || tenAny.find((s) => !boschHw.includes(s)) || null
  };
}

function detectProtocol(fileSize, text) {
  const protocols = [];

  if (text.includes('OBD') || text.includes('UDS') || text.includes('KWP')) protocols.push('OBD');
  if (text.includes('BENCH') || text.includes('Bench') || text.includes('BDM'))
    protocols.push('BENCH');
  if (text.includes('BOOT') || text.includes('Boot') || text.includes('JTAG'))
    protocols.push('BOOT');

  if (protocols.length === 0) {
    const commonSizes = [
      { size: 512 * 1024, protocol: 'OBD' },
      { size: 1024 * 1024, protocol: 'OBD' },
      { size: 2 * 1024 * 1024, protocol: 'BENCH' },
      { size: 4 * 1024 * 1024, protocol: 'BENCH' },
      { size: 8 * 1024 * 1024, protocol: 'BOOT' },
      { size: 16 * 1024 * 1024, protocol: 'BOOT' }
    ];
    const match = commonSizes.find((s) => Math.abs(s.size - fileSize) < 4096);
    if (match) protocols.push(match.protocol);
  }

  return protocols.length > 0 ? protocols : ['UNKNOWN'];
}

function computeConfidence(detections) {
  let score = 0;
  let max = 0;

  max += 25;
  if (detections.ecu) score += 25;

  max += 20;
  if (detections.brand) score += 20;

  max += 15;
  if (detections.model) score += 15;

  max += 20;
  if (detections.hwId) score += 20;

  max += 15;
  if (detections.swId) score += 15;

  max += 5;
  if (detections.protocol && detections.protocol[0] !== 'UNKNOWN') score += 5;

  return Math.round((score / max) * 100);
}

function md5Stream(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function computeTlsh(buffer) {
  if (!buffer || buffer.length < 512) return null;
  try {
    return tlshHash(buffer.toString('latin1'));
  } catch (err) {
    return null;
  }
}

function tlshDistance(digestStrA, digestStrB) {
  if (!digestStrA || !digestStrB) return null;
  try {
    const a = new DigestHashBuilder().withHash(digestStrA).build();
    const b = new DigestHashBuilder().withHash(digestStrB).build();
    return a.calculateDifference(b, true);
  } catch (err) {
    return null;
  }
}

function sumBytes(buffer) {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) sum = (sum + buffer[i]) >>> 0;
  return sum;
}

async function readChunkAt(fileHandle, length, position) {
  if (length <= 0) return Buffer.alloc(0);
  const buf = Buffer.alloc(length);
  await fileHandle.read(buf, 0, length, position);
  return buf;
}

async function parseFile(filePath) {
  const stats = await fs.promises.stat(filePath);
  const fileSize = stats.size;

  const sampleSize = Math.min(fileSize, 256 * 1024);
  const fileHandle = await fs.promises.open(filePath, 'r');
  let headBuf,
    midBuf = Buffer.alloc(0),
    tailBuf = Buffer.alloc(0);
  try {
    headBuf = await readChunkAt(fileHandle, Math.min(64 * 1024, fileSize), 0);

    if (fileSize > 128 * 1024) {
      const midSize = Math.min(32 * 1024, fileSize - 64 * 1024);
      midBuf = await readChunkAt(fileHandle, midSize, Math.floor(fileSize / 2));
    }

    if (fileSize > 64 * 1024) {
      const tailSize = Math.min(32 * 1024, fileSize);
      tailBuf = await readChunkAt(fileHandle, tailSize, fileSize - tailSize);
    }
  } finally {
    await fileHandle.close();
  }

  const sample = Buffer.concat([headBuf, midBuf, tailBuf]);
  const text = scanAscii(sample);
  const fileName = require('path').basename(filePath);

  const ecuContent = detectECU(text);
  const brandContent = detectBrand(text);
  const idsContent = extractIDs(text);

  const ecuFromName = detectECUFromName(fileName);
  const brandFromName = detectBrandFromName(fileName);
  const idsFromName = extractIDsFromName(fileName);

  const ecu =
    ecuContent && ecuContent.score >= (ecuFromName?.score || 0)
      ? ecuContent
      : ecuFromName || ecuContent;
  /** @type {{ brand: string, score: number, source?: string } | null} */
  let brand =
    brandFromName && brandFromName.score >= (brandContent?.score || 0)
      ? brandFromName
      : brandContent || brandFromName;

  if (!brand && ecu) {
    const lookupKey = `${ecu.family || ''}${ecu.model || ''}`;
    const candidateMakes =
      dataLoader.lookupBoschEcuMake(lookupKey) || dataLoader.lookupBoschEcuMake(ecu.model);
    if (candidateMakes && candidateMakes.length === 1) {
      brand = { brand: candidateMakes[0], score: 8, source: 'bosch-ecu-pinout' };
    } else if (candidateMakes && candidateMakes.length > 1) {
      brand = { brand: candidateMakes.join('/'), score: 6, source: 'bosch-ecu-pinout-multi' };
    }
  }

  const modelFromName = detectModelFromName(fileName, brand?.brand);
  const modelContent = detectModel(text, brand?.brand);
  const model = modelFromName || modelContent;

  const ids = {
    hwId: idsContent.hwId || idsFromName.hwId || null,
    swId: idsContent.swId || idsFromName.swId || null,
    vagBoxes: idsContent.vagBoxes,
    vins: idsContent.vins
  };

  const protocol = detectProtocol(fileSize, text);

  const detections = { ecu, brand, model, hwId: ids.hwId, swId: ids.swId, protocol };
  const confidence = computeConfidence(detections);

  const checksumOffset = sumBytes(sample);
  const md5 = await md5Stream(filePath);

  let fullBuf = null;
  if (fileSize <= 64 * 1024 * 1024) {
    fullBuf = await fs.promises.readFile(filePath);
  } else {
    fullBuf = sample;
  }
  const tlshDigest = await computeTlshAsync(fullBuf);

  let firmwareStruct = null;
  if (ecu && ecu.family) {
    const fam = ecu.family.toUpperCase();
    if (fam.includes('MED17') || fam.includes('EDC17') || fam.includes('MEDC17')) {
      try {
        firmwareStruct = firmwareStructure.detectMedc17Structure(fullBuf);
      } catch {}
    } else if (fam === 'ME7') {
      try {
        firmwareStruct = firmwareStructure.detectMe7Structure(fullBuf, ecu.model);
      } catch {}
    }
  }

  const enrichment = {};
  if (ids.vins[0]) {
    const wmi = dataLoader.lookupWmi(ids.vins[0]);
    if (wmi) enrichment.wmi = wmi;
  }
  if (ids.hwId) {
    const vag = dataLoader.lookupVagPlatform(ids.hwId);
    if (vag) enrichment.vag = vag;
    const bosch = dataLoader.lookupBoschPrefix(ids.hwId);
    if (bosch) enrichment.bosch = bosch;
  }
  for (const vag of ids.vagBoxes.slice(0, 3)) {
    const p = dataLoader.lookupVagPlatform(vag);
    if (p) {
      enrichment.vag = enrichment.vag || p;
      break;
    }
  }

  return {
    brand: brand?.brand || 'Unknown',
    model: model?.model || 'Unknown',
    ecuType: ecu?.label || 'Unknown',
    ecuFamily: ecu?.family || null,
    manufacturer: ecu?.manufacturer || null,
    hwId: ids.hwId || null,
    swId: ids.swId || null,
    vagBoxNumbers: ids.vagBoxes.slice(0, 3),
    vins: ids.vins.slice(0, 2),
    protocol,
    confidence,
    fileSize,
    checksum: checksumOffset.toString(16).padStart(8, '0'),
    md5,
    tlsh: tlshDigest,
    enrichment: Object.keys(enrichment).length > 0 ? enrichment : null,
    firmwareStructure: firmwareStruct,
    detectionMethod: ecu ? 'signature-match' : 'heuristic'
  };
}

async function computeChecksums(filePath) {
  const md5 = await md5Stream(filePath);
  const stats = await fs.promises.stat(filePath);

  const fileHandle = await fs.promises.open(filePath, 'r');
  let buf;
  try {
    buf = await readChunkAt(fileHandle, Math.min(1024 * 1024, stats.size), 0);
  } finally {
    await fileHandle.close();
  }

  return {
    md5,
    fileSize: stats.size,
    byteSum: sumBytes(buf).toString(16).padStart(8, '0'),
    bytes: buf.length
  };
}

async function hexPeek(filePath, byteCount = 512, offset = 0) {
  const stats = await fs.promises.stat(filePath);
  const start = Math.max(0, Math.min(offset, stats.size));
  const wanted = Math.min(byteCount, stats.size - start);

  const fileHandle = await fs.promises.open(filePath, 'r');
  let buf;
  try {
    buf = await readChunkAt(fileHandle, wanted, start);
  } finally {
    await fileHandle.close();
  }

  const rows = [];
  for (let i = 0; i < buf.length; i += 16) {
    const slice = buf.subarray(i, i + 16);
    const hex = Array.from(slice)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join(' ');
    const ascii = Array.from(slice)
      .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'))
      .join('');
    rows.push({
      offset: (start + i).toString(16).padStart(8, '0'),
      hex,
      ascii
    });
  }

  return { fileSize: stats.size, start, length: buf.length, rows };
}

module.exports = {
  parseFile,
  computeChecksums,
  hexPeek,
  computeTlsh,
  computeTlshAsync,
  tlshDistance
};
