// @ts-check
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');

let _boschEcuMap = null;
let _vagPrefix = null;
let _boschPrefix = null;
let _wmiTable = null;

function resolveFile(name) {
  try {
    const updater = require('./data-updater');
    if (updater.resolveDataFile) return updater.resolveDataFile(name);
  } catch {}
  return path.join(DATA_DIR, name);
}

function loadJson(file) {
  try {
    return JSON.parse(fs.readFileSync(resolveFile(file), 'utf8'));
  } catch (err) {
    return null;
  }
}

function getBoschEcuMap() {
  if (!_boschEcuMap) {
    const raw = loadJson('bosch_ecu_to_make.json');
    if (raw && raw.ecus) {
      _boschEcuMap = new Map();
      for (const e of raw.ecus) {
        const makes = (e.makes || []).map((m) => (m === 'Vokswagen' ? 'Volkswagen' : m));
        _boschEcuMap.set(e.model.toUpperCase(), makes);
      }
    } else {
      _boschEcuMap = new Map();
    }
  }
  return _boschEcuMap;
}

function getVagPrefix() {
  if (!_vagPrefix)
    _vagPrefix = loadJson('vag_prefix.json') || { platforms: {}, functional_groups: {} };
  return _vagPrefix;
}

function getBoschPrefix() {
  if (!_boschPrefix) _boschPrefix = loadJson('bosch_prefix.json') || { prefixes: {} };
  return _boschPrefix;
}

function getWmiTable() {
  if (!_wmiTable) {
    try {
      const text = fs.readFileSync(resolveFile('wmi.csv'), 'utf8');
      _wmiTable = new Map();
      for (const line of text.split('\n')) {
        const t = line.trim();
        if (!t || t.startsWith('#') || t.startsWith('wmi,')) continue;
        const parts = t.split(',');
        if (parts.length < 4) continue;
        _wmiTable.set(parts[0].trim().toUpperCase(), {
          country: parts[1].trim(),
          manufacturer: parts[2].trim(),
          brand: parts[3].trim()
        });
      }
    } catch {
      _wmiTable = new Map();
    }
  }
  return _wmiTable;
}

function lookupBoschEcuMake(ecuModel) {
  if (!ecuModel) return null;
  const map = getBoschEcuMap();
  const key = String(ecuModel)
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/^BOSCH/, '');
  for (const [k, makes] of map.entries()) {
    if (k === key) return makes;
    if (k.includes(key) || key.includes(k)) return makes;
  }
  return null;
}

function lookupVagPlatform(partNumber) {
  if (!partNumber || partNumber.length < 5) return null;
  const p = partNumber.toUpperCase().replace(/\s+/g, '');
  const platforms = getVagPrefix().platforms || {};
  const groups = getVagPrefix().functional_groups || {};
  const platformKey = p.slice(0, 2);
  const functionKey = p.slice(2, 5);
  const out = {};
  if (platforms[platformKey]) out.platform = { code: platformKey, ...platforms[platformKey] };
  if (groups[functionKey]) out.functional_group = { code: functionKey, name: groups[functionKey] };
  return Object.keys(out).length > 0 ? out : null;
}

function lookupBoschPrefix(partNumber) {
  if (!partNumber || partNumber.length < 4) return null;
  const prefixes = getBoschPrefix().prefixes || {};
  const key = partNumber.toUpperCase().slice(0, 4);
  return prefixes[key] ? { code: key, ...prefixes[key] } : null;
}

function lookupWmi(vin) {
  if (!vin || vin.length < 3) return null;
  return getWmiTable().get(vin.toUpperCase().slice(0, 3)) || null;
}

module.exports = {
  lookupBoschEcuMake,
  lookupVagPlatform,
  lookupBoschPrefix,
  lookupWmi,
  getBoschEcuMap,
  getVagPrefix,
  getBoschPrefix,
  getWmiTable
};
