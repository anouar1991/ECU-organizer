// @ts-check
const https = require('https');
const db = require('./database');

const NHTSA_HOST = 'vpic.nhtsa.dot.gov';

function isValidVin(vin) {
  if (!vin || typeof vin !== 'string') return false;
  return /^[A-HJ-NPR-Z0-9]{17}$/.test(vin.toUpperCase());
}

function fetchJson(path, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        host: NHTSA_HOST,
        path,
        headers: { 'User-Agent': 'ECU-File-Skinner-Pro/1.0' },
        timeout: timeoutMs
      },
      (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error('Invalid JSON from NHTSA: ' + err.message));
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('NHTSA timeout'));
    });
  });
}

async function decodeVin(vin) {
  if (!isValidVin(vin)) return { error: 'Invalid VIN format' };
  vin = vin.toUpperCase();

  const cached = db.getVinCache && db.getVinCache(vin);
  if (cached) return { cached: true, ...cached };

  try {
    const res = await fetchJson(`/api/vehicles/decodevinvalues/${vin}?format=json`);
    if (!res || !res.Results || !res.Results[0]) {
      return { error: 'No results from NHTSA' };
    }
    const r = res.Results[0];
    const result = {
      vin,
      source: 'nhtsa_vpic',
      make: r.Make || null,
      manufacturer: r.Manufacturer || null,
      model: r.Model || null,
      model_year: r.ModelYear || null,
      plant_country: r.PlantCountry || null,
      plant_city: r.PlantCity || null,
      vehicle_type: r.VehicleType || null,
      body_class: r.BodyClass || null,
      engine_cyl: r.EngineCylinders || null,
      displacement_l: r.DisplacementL || null,
      engine_hp: r.EngineHP || null,
      error_code: r.ErrorCode || null,
      error_text: r.ErrorText || null,
      looked_up_at: new Date().toISOString()
    };
    if (db.setVinCache) db.setVinCache(vin, result);
    return result;
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = { decodeVin, isValidVin };
