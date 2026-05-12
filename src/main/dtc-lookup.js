// @ts-check
/**
 * DTC (Diagnostic Trouble Code) lookup against the bundled SQLite database.
 *
 * Source DB: https://github.com/Wal33D/dtc-database (MIT) — file `data/dtc_codes.db`
 * Bundled at: src/data/dtc.db (read-only)
 *
 * Schema (read-only, do not write):
 *   dtc_definitions(code, manufacturer, description, type, locale, is_generic, source_file)
 *   Primary key: (code, manufacturer, locale)
 *
 * Public API:
 *   lookupDtc(code, manufacturer?)  -> { code, description, system, manufacturer } | null
 *   searchDtc(query, limit=20)      -> Array<{ code, description, system, manufacturer }>
 *
 * Notes:
 *   - `type` column ('P'|'B'|'C'|'U') is exposed as `system` to match the
 *     conventional OBD-II "system letter" terminology (P=Powertrain, B=Body,
 *     C=Chassis, U=Network).
 *   - When no manufacturer is passed, GENERIC (is_generic=1) is preferred,
 *     falling back to any manufacturer-specific match.
 *   - Read-only open: bundled file may live in a packaged asar/resources dir.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let _db = null;
let _stmts = null;

function _resolveDbPath() {
  // Prefer an explicit override (useful for tests / packaged builds).
  if (process.env.DTC_DB_PATH && fs.existsSync(process.env.DTC_DB_PATH)) {
    return process.env.DTC_DB_PATH;
  }

  // Source-tree location (works in `electron .` dev mode AND when run with
  // plain node, since this file lives in src/main/ and the DB in src/data/).
  const srcTreePath = path.join(__dirname, '..', 'data', 'dtc.db');
  if (fs.existsSync(srcTreePath)) return srcTreePath;

  // Packaged Electron (asar). Try resourcesPath if available.
  if (process.resourcesPath) {
    const packagedPath = path.join(
      process.resourcesPath,
      'app.asar.unpacked',
      'src',
      'data',
      'dtc.db'
    );
    if (fs.existsSync(packagedPath)) return packagedPath;
    const packagedPath2 = path.join(process.resourcesPath, 'src', 'data', 'dtc.db');
    if (fs.existsSync(packagedPath2)) return packagedPath2;
  }

  // Last resort — return the source-tree path even if missing, so the caller
  // gets a meaningful "ENOENT: src/data/dtc.db" instead of a silent null.
  return srcTreePath;
}

function _ensureOpen() {
  if (_db) return;
  const dbPath = _resolveDbPath();
  _db = new Database(dbPath, { readonly: true, fileMustExist: true });
  // Safe read-only pragmas. No WAL (read-only mounts).
  _db.pragma('query_only = ON');

  _stmts = {
    lookupGeneric: _db.prepare(
      `SELECT code, manufacturer, description, type
         FROM dtc_definitions
        WHERE code = ? AND is_generic = 1 AND locale = 'en'
        LIMIT 1`
    ),
    lookupAny: _db.prepare(
      `SELECT code, manufacturer, description, type
         FROM dtc_definitions
        WHERE code = ? AND locale = 'en'
        ORDER BY is_generic DESC
        LIMIT 1`
    ),
    lookupByMfr: _db.prepare(
      `SELECT code, manufacturer, description, type
         FROM dtc_definitions
        WHERE code = ? AND manufacturer = ? AND locale = 'en'
        LIMIT 1`
    ),
    searchByCode: _db.prepare(
      `SELECT code, manufacturer, description, type
         FROM dtc_definitions
        WHERE (code LIKE ? OR description LIKE ?) AND locale = 'en'
        ORDER BY is_generic DESC, code ASC
        LIMIT ?`
    )
  };
}

function _row(row) {
  if (!row) return null;
  return {
    code: row.code,
    description: row.description,
    system: row.type, // 'P' | 'B' | 'C' | 'U'
    manufacturer: row.manufacturer
  };
}

/**
 * Look up a single DTC by code (and optional manufacturer).
 * Manufacturer match is case-insensitive against the DB's UPPERCASE values.
 * Falls back to GENERIC, then to any locale='en' match.
 *
 * @param {string} code         e.g. 'P0420'
 * @param {string} [manufacturer] optional, e.g. 'AUDI'
 * @returns {{code:string, description:string, system:string, manufacturer:string} | null}
 */
function lookupDtc(code, manufacturer) {
  if (!code || typeof code !== 'string') return null;
  _ensureOpen();
  const normalized = code.trim().toUpperCase();

  if (manufacturer && typeof manufacturer === 'string') {
    const m = manufacturer.trim().toUpperCase();
    const row = _stmts.lookupByMfr.get(normalized, m);
    if (row) return _row(row);
    // Fall through to generic if no manufacturer-specific match.
  }

  const generic = _stmts.lookupGeneric.get(normalized);
  if (generic) return _row(generic);

  return _row(_stmts.lookupAny.get(normalized));
}

/**
 * Substring search on code OR description.
 *
 * @param {string} query
 * @param {number} [limit=20]
 * @returns {Array<{code:string, description:string, system:string, manufacturer:string}>}
 */
function searchDtc(query, limit = 20) {
  if (!query || typeof query !== 'string') return [];
  _ensureOpen();
  const q = `%${query.trim()}%`;
  const lim = Math.max(1, Math.min(500, Number(limit) || 20));
  const rows = _stmts.searchByCode.all(q, q, lim);
  return rows.map(_row);
}

/** Close the DB handle. Optional — useful for tests and clean shutdown. */
function close() {
  if (_db) {
    try {
      _db.close();
    } catch (_) {
      /* ignore */
    }
    _db = null;
    _stmts = null;
  }
}

module.exports = { lookupDtc, searchDtc, close };
