// @ts-check
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { app } = require('electron');
const db = require('./database');

const SHIPPED_DATA_DIR = path.join(__dirname, '..', 'data');
const USER_DATA_OVERLAY = () => path.join(app.getPath('userData'), 'data-overlay');

function resolveDataFile(relName) {
  const overlay = path.join(USER_DATA_OVERLAY(), relName);
  if (fs.existsSync(overlay)) return overlay;
  return path.join(SHIPPED_DATA_DIR, relName);
}

function getLocalManifest() {
  try {
    const p = resolveDataFile('manifest.json');
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function fetchUrl(urlStr, opts = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const lib = u.protocol === 'http:' ? http : https;
    const req = lib.get(
      urlStr,
      {
        headers: { 'User-Agent': 'ECU-File-Skinner-Pro/1.0' },
        timeout: opts.timeoutMs || 15000
      },
      (res) => {
        if (res.statusCode === 302 || res.statusCode === 301) {
          fetchUrl(res.headers.location, opts).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode} from ${urlStr}`));
          return;
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('timeout'));
    });
  });
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function checkForUpdates() {
  const updateUrl = db.getSetting('data_update_manifest_url');
  if (!updateUrl) return { skipped: 'no manifest URL configured' };

  let remoteManifest;
  try {
    const buf = await fetchUrl(updateUrl);
    remoteManifest = JSON.parse(buf.toString('utf8'));
  } catch (err) {
    return { error: `Failed to fetch manifest: ${err.message}` };
  }

  const local = getLocalManifest() || { files: {} };
  const updates = [];
  for (const [name, info] of Object.entries(remoteManifest.files || {})) {
    const localInfo = local.files?.[name] || {};
    if (info.version && info.version !== localInfo.version && info.url) {
      updates.push({ name, ...info });
    }
  }

  if (updates.length === 0) {
    db.setSetting('data_update_last_check', String(Math.floor(Date.now() / 1000)));
    return { updated: 0, checked: Object.keys(remoteManifest.files || {}).length };
  }

  const overlay = USER_DATA_OVERLAY();
  if (!fs.existsSync(overlay)) fs.mkdirSync(overlay, { recursive: true });
  const applied = [];
  const errors = [];

  for (const u of updates) {
    try {
      const buf = await fetchUrl(u.url);
      if (u.sha256 && sha256(buf) !== u.sha256) {
        errors.push({ name: u.name, error: 'sha256 mismatch' });
        continue;
      }
      fs.writeFileSync(path.join(overlay, u.name), buf);
      applied.push(u.name);
    } catch (err) {
      errors.push({ name: u.name, error: err.message });
    }
  }

  fs.writeFileSync(path.join(overlay, 'manifest.json'), JSON.stringify(remoteManifest, null, 2));
  db.setSetting('data_update_last_check', String(Math.floor(Date.now() / 1000)));
  return { updated: applied.length, applied, errors };
}

async function maybeCheckAtStartup() {
  const enabled = db.getSetting('data_auto_update') === '1';
  if (!enabled) return { skipped: 'auto-update disabled' };

  const lastCheckUnix = parseInt(db.getSetting('data_update_last_check') || '0', 10);
  const daysSince = (Date.now() / 1000 - lastCheckUnix) / 86400;
  if (daysSince < 30) return { skipped: `last check ${daysSince.toFixed(0)}d ago` };

  return checkForUpdates();
}

module.exports = { checkForUpdates, maybeCheckAtStartup, resolveDataFile, getLocalManifest };
