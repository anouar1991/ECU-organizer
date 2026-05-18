// @ts-check
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const Database = require('better-sqlite3');

let db = null;

const MIGRATIONS = [
  {
    version: 1,
    description: 'Initial schema (consolidated from legacy cascading ALTERs)',
    up: (db) => {
      // Idempotent: uses CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS
      // so legacy DBs (user_version=0 with all columns already added via the old
      // cascading-ALTER init) survive this migration cleanly. Fresh DBs get the
      // complete current schema in one shot.
      db.exec(`
        CREATE TABLE IF NOT EXISTS files (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          kind TEXT NOT NULL DEFAULT 'original',
          parent_id INTEGER REFERENCES files(id) ON DELETE SET NULL,
          solution_label TEXT DEFAULT '',
          md5 TEXT DEFAULT '',
          tlsh_digest TEXT DEFAULT '',
          vin TEXT DEFAULT '',
          enrichment_json TEXT DEFAULT '',
          firmware_structure_json TEXT DEFAULT '',
          original_name TEXT NOT NULL,
          new_name TEXT NOT NULL,
          archive_path TEXT NOT NULL,
          brand TEXT,
          model TEXT,
          ecu_type TEXT,
          hw_id TEXT,
          sw_id TEXT,
          protocol TEXT,
          confidence INTEGER,
          file_size INTEGER,
          checksum TEXT,
          tags TEXT DEFAULT '',
          notes TEXT DEFAULT '',
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS settings (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS vin_cache (
          vin TEXT PRIMARY KEY,
          payload TEXT NOT NULL,
          cached_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE TABLE IF NOT EXISTS comparisons (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          file_a_path TEXT,
          file_b_path TEXT,
          file_a_name TEXT,
          file_b_name TEXT,
          file_a_md5  TEXT,
          file_b_md5  TEXT,
          file_a_id   INTEGER,
          file_b_id   INTEGER,
          similarity  REAL,
          bytes_differ INTEGER,
          total_regions INTEGER,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );

        CREATE INDEX IF NOT EXISTS idx_cmp_created ON comparisons(created_at);
        CREATE INDEX IF NOT EXISTS idx_brand    ON files(brand);
        CREATE INDEX IF NOT EXISTS idx_hw       ON files(hw_id);
        CREATE INDEX IF NOT EXISTS idx_sw       ON files(sw_id);
        CREATE INDEX IF NOT EXISTS idx_ecu_type ON files(ecu_type);
        CREATE INDEX IF NOT EXISTS idx_kind     ON files(kind);
        CREATE INDEX IF NOT EXISTS idx_parent   ON files(parent_id);
        CREATE INDEX IF NOT EXISTS idx_md5      ON files(md5);
      `);

      // Legacy-DB backfill: if the `files` table pre-existed (user_version=0)
      // some columns may already be present via the old cascading-ALTER path,
      // but on truly fresh DBs the CREATE TABLE above already includes them.
      // For legacy DBs missing any column (defensive — should be a no-op on
      // any DB that ran the previous init()), ADD COLUMN guarded by table_info.
      const cols = db
        .prepare('PRAGMA table_info(files)')
        .all()
        .map((c) => c.name);
      if (!cols.includes('tags')) db.exec("ALTER TABLE files ADD COLUMN tags TEXT DEFAULT ''");
      if (!cols.includes('notes')) db.exec("ALTER TABLE files ADD COLUMN notes TEXT DEFAULT ''");
      if (!cols.includes('kind'))
        db.exec("ALTER TABLE files ADD COLUMN kind TEXT NOT NULL DEFAULT 'original'");
      if (!cols.includes('parent_id'))
        db.exec(
          'ALTER TABLE files ADD COLUMN parent_id INTEGER REFERENCES files(id) ON DELETE SET NULL'
        );
      if (!cols.includes('solution_label'))
        db.exec("ALTER TABLE files ADD COLUMN solution_label TEXT DEFAULT ''");
      if (!cols.includes('md5')) db.exec("ALTER TABLE files ADD COLUMN md5 TEXT DEFAULT ''");
      if (!cols.includes('tlsh_digest'))
        db.exec("ALTER TABLE files ADD COLUMN tlsh_digest TEXT DEFAULT ''");
      if (!cols.includes('vin')) db.exec("ALTER TABLE files ADD COLUMN vin TEXT DEFAULT ''");
      if (!cols.includes('enrichment_json'))
        db.exec("ALTER TABLE files ADD COLUMN enrichment_json TEXT DEFAULT ''");
      if (!cols.includes('firmware_structure_json'))
        db.exec("ALTER TABLE files ADD COLUMN firmware_structure_json TEXT DEFAULT ''");
    }
  },
  {
    version: 2,
    description: 'smart folders',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS smart_folders (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          icon TEXT DEFAULT 'star',
          query_json TEXT NOT NULL,
          sort_order INTEGER DEFAULT 0,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_smart_folders_sort ON smart_folders(sort_order, id);
      `);
    }
  },
  {
    version: 3,
    description: 'search history',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS search_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          query TEXT NOT NULL,
          result_count INTEGER,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_search_history_created ON search_history(created_at);
      `);
    }
  },
  {
    version: 4,
    description: 'tag metadata (color + description per tag)',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tag_meta (
          name TEXT PRIMARY KEY,
          color TEXT DEFAULT 'gray',
          description TEXT DEFAULT '',
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );
      `);

      // Auto-populate tag_meta from existing files.tags so colors/descriptions
      // can be assigned to tags created before this feature shipped. Idempotent
      // via INSERT OR IGNORE — re-running this migration is a no-op.
      try {
        const rows = db
          .prepare("SELECT tags FROM files WHERE tags IS NOT NULL AND tags != ''")
          .all();
        const seen = new Set();
        for (const r of rows) {
          for (const raw of String(r.tags || '').split(',')) {
            const t = raw.trim();
            if (t) seen.add(t);
          }
        }
        const ins = db.prepare(
          "INSERT OR IGNORE INTO tag_meta (name, color, description) VALUES (?, 'gray', '')"
        );
        for (const name of seen) ins.run(name);
      } catch (err) {
        console.warn('[db] tag_meta backfill skipped:', err.message);
      }
    }
  },
  {
    version: 5,
    description: 'smart tag rules',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tag_rules (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT NOT NULL,
          enabled INTEGER DEFAULT 1,
          match_field TEXT,
          match_op TEXT,
          match_value TEXT,
          tag_to_add TEXT NOT NULL,
          sort_order INTEGER DEFAULT 0,
          created_at INTEGER DEFAULT (strftime('%s', 'now'))
        );
        CREATE INDEX IF NOT EXISTS idx_tag_rules_sort ON tag_rules(sort_order, id);
      `);
    }
  }
];

const TAG_COLOR_WHITELIST = new Set([
  'gray',
  'red',
  'orange',
  'yellow',
  'lime',
  'green',
  'cyan',
  'blue',
  'indigo',
  'purple',
  'pink',
  'slate'
]);

const MAX_HISTORY_ROWS = 50;

function runMigrations(db) {
  const currentVersion = db.pragma('user_version', { simple: true });
  for (const m of MIGRATIONS) {
    if (m.version <= currentVersion) continue;
    const tx = db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    });
    tx();
    console.log(`[db] applied migration v${m.version}: ${m.description}`);
  }
}

function init() {
  const userData = app.getPath('userData');
  if (!fs.existsSync(userData)) fs.mkdirSync(userData, { recursive: true });
  const dbPath = path.join(userData, 'ecu-skinner.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  runMigrations(db);

  return db;
}

function close() {
  if (db) {
    db.close();
    db = null;
  }
}

function insertFile(record) {
  const stmt = db.prepare(`
    INSERT INTO files
      (kind, parent_id, solution_label, md5, tlsh_digest, vin,
       enrichment_json, firmware_structure_json,
       original_name, new_name, archive_path, brand, model, ecu_type,
       hw_id, sw_id, protocol, confidence, file_size, checksum, tags, notes)
    VALUES (@kind, @parentId, @solutionLabel, @md5, @tlshDigest, @vin,
            @enrichmentJson, @firmwareStructureJson,
            @originalName, @newName, @archivePath, @brand, @model, @ecuType,
            @hwId, @swId, @protocol, @confidence, @fileSize, @checksum, @tags, @notes)
  `);
  const info = stmt.run({
    kind: record.kind || 'original',
    parentId: record.parentId || null,
    solutionLabel: record.solutionLabel || '',
    md5: record.md5 || '',
    tlshDigest: record.tlshDigest || '',
    vin: record.vin || '',
    enrichmentJson: record.enrichment ? JSON.stringify(record.enrichment) : '',
    firmwareStructureJson: record.firmwareStructure ? JSON.stringify(record.firmwareStructure) : '',
    originalName: record.originalName,
    newName: record.newName,
    archivePath: record.archivePath,
    brand: record.brand,
    model: record.model,
    ecuType: record.ecuType,
    hwId: record.hwId,
    swId: record.swId,
    protocol: Array.isArray(record.protocol) ? record.protocol.join(',') : record.protocol,
    confidence: record.confidence,
    fileSize: record.fileSize,
    checksum: record.checksum,
    tags: record.tags || '',
    notes: record.notes || ''
  });
  return { id: info.lastInsertRowid };
}

function listAllWithTlsh() {
  return db
    .prepare(
      "SELECT id, new_name, archive_path, kind, parent_id, brand, model, ecu_type, hw_id, tlsh_digest FROM files WHERE tlsh_digest IS NOT NULL AND tlsh_digest != ''"
    )
    .all();
}

const UPDATABLE_FIELDS = new Set([
  'original_name',
  'new_name',
  'brand',
  'model',
  'ecu_type',
  'hw_id',
  'sw_id',
  'protocol',
  'confidence',
  'tags',
  'notes',
  'kind',
  'parent_id',
  'solution_label'
]);

function updateFile(id, updates) {
  const keys = Object.keys(updates).filter((k) => UPDATABLE_FIELDS.has(k));
  if (keys.length === 0) return { changes: 0 };
  const set = keys.map((k) => `${k} = @${k}`).join(', ');
  /** @type {Record<string, any>} */
  const params = { id };
  for (const k of keys) params[k] = updates[k];
  const info = db.prepare(`UPDATE files SET ${set} WHERE id = @id`).run(params);
  return { changes: info.changes };
}

/**
 * @param {{
 *   search?: string,
 *   brand?: string,
 *   ecuType?: string,
 *   tag?: string,
 *   kind?: string,
 *   parentId?: number|null,
 *   includeSolutions?: boolean,
 *   limit?: number
 * }} [opts]
 */
function listFiles({
  search,
  brand,
  ecuType,
  tag,
  kind,
  parentId,
  // kept for API stability: callers may pass `includeSolutions` but the
  // current query joins both kinds unconditionally — strip in next major.
  includeSolutions: _includeSolutions = true,
  limit = 1000
} = {}) {
  const where = [];
  /** @type {Record<string, any>} */
  const params = {};
  if (search) {
    where.push(`(original_name LIKE @search OR new_name LIKE @search
                  OR hw_id LIKE @search OR sw_id LIKE @search
                  OR brand LIKE @search OR model LIKE @search OR ecu_type LIKE @search
                  OR tags LIKE @search OR notes LIKE @search OR solution_label LIKE @search)`);
    params.search = `%${search}%`;
  }
  if (brand) {
    where.push('brand = @brand');
    params.brand = brand;
  }
  if (ecuType) {
    where.push('ecu_type = @ecuType');
    params.ecuType = ecuType;
  }
  if (tag) {
    where.push('tags LIKE @tag');
    params.tag = `%${tag}%`;
  }
  if (kind) {
    where.push('kind = @kind');
    params.kind = kind;
  }
  if (parentId !== undefined && parentId !== null) {
    where.push('parent_id = @parentId');
    params.parentId = parentId;
  }

  const sql = `SELECT * FROM files ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY created_at DESC LIMIT ${limit}`;
  return db.prepare(sql).all(params);
}

function getFile(id) {
  return db.prepare('SELECT * FROM files WHERE id = ?').get(id);
}

function findByMd5(md5) {
  if (!md5) return [];
  return db.prepare('SELECT * FROM files WHERE md5 = ?').all(md5);
}

/**
 * @param {{ brand?: string, model?: string, ecuType?: string, hwId?: string }} [opts]
 */
function listOriginalsMatching({ brand, model, ecuType, hwId } = {}) {
  const where = ["kind = 'original'"];
  /** @type {Record<string, any>} */
  const params = {};
  if (hwId) {
    where.push('hw_id = @hwId');
    params.hwId = hwId;
  }
  if (brand) {
    where.push('brand = @brand');
    params.brand = brand;
  }
  if (model) {
    where.push('model = @model');
    params.model = model;
  }
  if (ecuType) {
    where.push('ecu_type = @ecuType');
    params.ecuType = ecuType;
  }
  const sql = `SELECT * FROM files WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 50`;
  return db.prepare(sql).all(params);
}

function listSolutionsOf(originalId) {
  return db
    .prepare(
      `SELECT * FROM files WHERE kind = 'solution' AND parent_id = ?
                     ORDER BY created_at DESC`
    )
    .all(originalId);
}

function relinkSolution(solutionId, newParentId) {
  if (newParentId !== null) {
    const parent = getFile(newParentId);
    if (!parent || parent.kind !== 'original')
      return { success: false, error: 'New parent must be an existing original' };
  }
  const info = db
    .prepare("UPDATE files SET kind = 'solution', parent_id = ? WHERE id = ?")
    .run(newParentId, solutionId);
  return { success: info.changes > 0 };
}

function convertKind(id, newKind, newParentId) {
  if (newKind !== 'original' && newKind !== 'solution') {
    return { success: false, error: 'Invalid kind' };
  }
  if (newKind === 'original') {
    const orphaned = db.prepare('UPDATE files SET parent_id = NULL WHERE parent_id = ?').run(id);
    const info = db
      .prepare("UPDATE files SET kind = 'original', parent_id = NULL WHERE id = ?")
      .run(id);
    return { success: info.changes > 0, orphanedSolutions: orphaned.changes };
  } else {
    if (!newParentId) return { success: false, error: 'Solution must have a parent' };
    const parent = getFile(newParentId);
    if (!parent || parent.kind !== 'original')
      return { success: false, error: 'Parent must be an existing original' };
    const info = db
      .prepare("UPDATE files SET kind = 'solution', parent_id = ? WHERE id = ?")
      .run(newParentId, id);
    return { success: info.changes > 0 };
  }
}

function deleteFile(id) {
  const info = db.prepare('DELETE FROM files WHERE id = ?').run(id);
  return { changes: info.changes };
}

function getStats() {
  const total = db.prepare('SELECT COUNT(*) AS c FROM files').get().c;
  const originals = db.prepare("SELECT COUNT(*) AS c FROM files WHERE kind = 'original'").get().c;
  const solutions = db.prepare("SELECT COUNT(*) AS c FROM files WHERE kind = 'solution'").get().c;
  const byBrand = db
    .prepare('SELECT brand AS k, COUNT(*) AS c FROM files GROUP BY brand ORDER BY c DESC LIMIT 10')
    .all();
  const byEcu = db
    .prepare(
      'SELECT ecu_type AS k, COUNT(*) AS c FROM files GROUP BY ecu_type ORDER BY c DESC LIMIT 10'
    )
    .all();
  const totalSize = db.prepare('SELECT COALESCE(SUM(file_size),0) AS s FROM files').get().s;
  const avgConf = db.prepare('SELECT COALESCE(AVG(confidence),0) AS a FROM files').get().a;
  const recent = db.prepare('SELECT * FROM files ORDER BY created_at DESC LIMIT 5').all();

  const topOriginals = db
    .prepare(
      `
    SELECT o.id, o.new_name AS k, COUNT(s.id) AS c
    FROM files o LEFT JOIN files s ON s.parent_id = o.id AND s.kind = 'solution'
    WHERE o.kind = 'original'
    GROUP BY o.id
    HAVING c > 0
    ORDER BY c DESC LIMIT 10
  `
    )
    .all();

  const allTags = db.prepare("SELECT tags FROM files WHERE tags != ''").all();
  const tagCounts = {};
  for (const row of allTags) {
    for (const t of row.tags
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)) {
      tagCounts[t] = (tagCounts[t] || 0) + 1;
    }
  }
  const byTag = Object.entries(tagCounts)
    .map(([k, c]) => ({ k, c }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 10);

  return {
    total,
    originals,
    solutions,
    byBrand,
    byEcu,
    byTag,
    totalSize,
    avgConfidence: Math.round(avgConf),
    recent,
    topOriginals
  };
}

function getSetting(key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(key, value) {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(key, String(value));
}

function getAllSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}

function exportAll() {
  const files = db.prepare('SELECT * FROM files').all();
  const settings = getAllSettings();
  return { version: 2, exportedAt: new Date().toISOString(), files, settings };
}

function importAll(payload, { mergeMode = 'append' } = {}) {
  if (!payload || !Array.isArray(payload.files)) {
    return { success: false, error: 'Invalid backup payload' };
  }

  let inserted = 0;
  const tx = db.transaction(() => {
    if (mergeMode === 'replace') db.exec('DELETE FROM files');
    const stmt = db.prepare(`
      INSERT INTO files
        (kind, parent_id, solution_label, md5,
         original_name, new_name, archive_path, brand, model, ecu_type,
         hw_id, sw_id, protocol, confidence, file_size, checksum, tags, notes, created_at)
      VALUES (@kind, @parent_id, @solution_label, @md5,
              @original_name, @new_name, @archive_path, @brand, @model, @ecu_type,
              @hw_id, @sw_id, @protocol, @confidence, @file_size, @checksum,
              @tags, @notes, @created_at)
    `);
    for (const f of payload.files) {
      stmt.run({
        kind: f.kind || 'original',
        parent_id: f.parent_id || null,
        solution_label: f.solution_label || '',
        md5: f.md5 || '',
        original_name: f.original_name,
        new_name: f.new_name,
        archive_path: f.archive_path,
        brand: f.brand,
        model: f.model,
        ecu_type: f.ecu_type,
        hw_id: f.hw_id,
        sw_id: f.sw_id,
        protocol: f.protocol,
        confidence: f.confidence,
        file_size: f.file_size,
        checksum: f.checksum,
        tags: f.tags || '',
        notes: f.notes || '',
        created_at: f.created_at || Math.floor(Date.now() / 1000)
      });
      inserted++;
    }
    if (payload.settings && typeof payload.settings === 'object') {
      for (const [k, v] of Object.entries(payload.settings)) setSetting(k, v);
    }
  });

  try {
    tx();
    return { success: true, inserted };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function recordComparison(rec) {
  const stmt = db.prepare(`
    INSERT INTO comparisons
      (file_a_path, file_b_path, file_a_name, file_b_name,
       file_a_md5, file_b_md5, file_a_id, file_b_id,
       similarity, bytes_differ, total_regions)
    VALUES (@aPath, @bPath, @aName, @bName,
            @aMd5, @bMd5, @aId, @bId,
            @similarity, @bytesDiffer, @totalRegions)
  `);
  const info = stmt.run({
    aPath: rec.aPath,
    bPath: rec.bPath,
    aName: rec.aName,
    bName: rec.bName,
    aMd5: rec.aMd5 || '',
    bMd5: rec.bMd5 || '',
    aId: rec.aId || null,
    bId: rec.bId || null,
    similarity: rec.similarity,
    bytesDiffer: rec.bytesDiffer,
    totalRegions: rec.totalRegions
  });
  db.prepare(
    `
    DELETE FROM comparisons WHERE id IN (
      SELECT id FROM comparisons ORDER BY created_at DESC LIMIT -1 OFFSET 50
    )
  `
  ).run();
  return { id: info.lastInsertRowid };
}

function listRecentComparisons(limit = 5) {
  return db.prepare('SELECT * FROM comparisons ORDER BY created_at DESC LIMIT ?').all(limit);
}

function deleteComparison(id) {
  const info = db.prepare('DELETE FROM comparisons WHERE id = ?').run(id);
  return { changes: info.changes };
}

function getVinCache(vin) {
  const row = db.prepare('SELECT payload FROM vin_cache WHERE vin = ?').get(vin);
  if (!row) return null;
  try {
    return JSON.parse(row.payload);
  } catch {
    return null;
  }
}

function setVinCache(vin, data) {
  db.prepare(
    `INSERT INTO vin_cache (vin, payload) VALUES (?, ?)
              ON CONFLICT(vin) DO UPDATE SET payload = excluded.payload, cached_at = strftime('%s','now')`
  ).run(vin, JSON.stringify(data));
}

/* ===== Smart folders ===== */

/**
 * @param {{name: string, icon?: string, query?: any, sort_order?: number}} payload
 */
function createSmartFolder(payload) {
  const name = String(payload && payload.name ? payload.name : '').trim();
  if (!name) return { error: 'Name is required' };
  const icon = (payload && payload.icon) || 'star';
  const query = payload && payload.query ? payload.query : {};
  const sortOrder =
    payload && typeof payload.sort_order === 'number' ? payload.sort_order : Date.now();
  const info = db
    .prepare('INSERT INTO smart_folders (name, icon, query_json, sort_order) VALUES (?, ?, ?, ?)')
    .run(name, icon, JSON.stringify(query), sortOrder);
  return { id: info.lastInsertRowid };
}

function listSmartFolders() {
  const rows = db
    .prepare(
      'SELECT id, name, icon, query_json, sort_order, created_at FROM smart_folders ORDER BY sort_order ASC, id ASC'
    )
    .all();
  return rows.map((r) => {
    let query = {};
    try {
      query = r.query_json ? JSON.parse(r.query_json) : {};
    } catch {
      query = {};
    }
    return {
      id: r.id,
      name: r.name,
      icon: r.icon || 'star',
      query,
      sort_order: r.sort_order,
      created_at: r.created_at
    };
  });
}

function getSmartFolder(id) {
  const row = db
    .prepare(
      'SELECT id, name, icon, query_json, sort_order, created_at FROM smart_folders WHERE id = ?'
    )
    .get(id);
  if (!row) return null;
  let query = {};
  try {
    query = row.query_json ? JSON.parse(row.query_json) : {};
  } catch {
    query = {};
  }
  return {
    id: row.id,
    name: row.name,
    icon: row.icon || 'star',
    query,
    sort_order: row.sort_order,
    created_at: row.created_at
  };
}

const SMART_FOLDER_UPDATABLE = new Set(['name', 'icon', 'query', 'sort_order']);

/**
 * @param {number} id
 * @param {{name?: string, icon?: string, query?: any, sort_order?: number}} updates
 */
function updateSmartFolder(id, updates) {
  if (!updates || typeof updates !== 'object') return { changes: 0 };
  const sets = [];
  /** @type {Record<string, any>} */
  const params = { id };
  for (const k of Object.keys(updates)) {
    if (!SMART_FOLDER_UPDATABLE.has(k)) continue;
    if (k === 'query') {
      sets.push('query_json = @query_json');
      params.query_json = JSON.stringify(updates.query || {});
    } else {
      sets.push(`${k} = @${k}`);
      params[k] = updates[k];
    }
  }
  if (sets.length === 0) return { changes: 0 };
  const info = db.prepare(`UPDATE smart_folders SET ${sets.join(', ')} WHERE id = @id`).run(params);
  return { changes: info.changes };
}

function deleteSmartFolder(id) {
  const info = db.prepare('DELETE FROM smart_folders WHERE id = ?').run(id);
  return { changes: info.changes };
}

/* ===== Duplicates ===== */

/**
 * Find files sharing the same non-empty MD5. Returns groups with count >= 2.
 */
function findExactDuplicates() {
  const groups = db
    .prepare(
      `SELECT md5, COUNT(*) AS c FROM files
       WHERE md5 IS NOT NULL AND md5 != ''
       GROUP BY md5 HAVING c >= 2
       ORDER BY c DESC`
    )
    .all();
  const result = [];
  const stmt = db.prepare('SELECT * FROM files WHERE md5 = ? ORDER BY created_at ASC');
  for (const g of groups) {
    const files = stmt.all(g.md5);
    result.push({ md5: g.md5, count: g.c, files });
  }
  return result;
}

/**
 * Find near-duplicates using TLSH distance. O(n^2) — capped at 5000 rows.
 * @param {number} [maxDistance]
 */
function findNearDuplicates(maxDistance = 30) {
  const MAX_ROWS = 5000;
  // Pull rows with a non-empty TLSH digest, capped for perf.
  const rows = db
    .prepare(
      `SELECT id, new_name, archive_path, md5, tlsh_digest, kind, brand, model, ecu_type,
              hw_id, sw_id, file_size, created_at
       FROM files
       WHERE tlsh_digest IS NOT NULL AND tlsh_digest != ''
       ORDER BY created_at DESC
       LIMIT ?`
    )
    .all(MAX_ROWS);

  const ecuParser = require('./ecu-parser');
  const n = rows.length;
  // Union-find
  const parent = new Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (x) => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const union = (a, b) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };

  // Group min distance per (groupRoot)
  const minDist = new Map();
  for (let i = 0; i < n; i++) {
    const a = rows[i].tlsh_digest;
    if (!a) continue;
    for (let j = i + 1; j < n; j++) {
      const b = rows[j].tlsh_digest;
      if (!b) continue;
      const d = ecuParser.tlshDistance(a, b);
      if (d === null) continue;
      if (d <= maxDistance) {
        union(i, j);
        // Track best per-component distance later
        const ra = find(i);
        const prev = minDist.get(ra);
        if (prev === undefined || d < prev) minDist.set(ra, d);
      }
    }
  }

  // Collect components with size >= 2
  const groups = new Map(); // root -> {files:[], distance: number}
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, { files: [], distance: minDist.get(r) });
    groups.get(r).files.push(rows[i]);
  }

  // Update each group's minDist (we may have lost some during path compression)
  // Recompute mins via Map iteration on union-find roots.
  const result = [];
  let gid = 0;
  for (const [root, g] of groups) {
    if (g.files.length < 2) continue;
    // recompute min distance within the group (cheap, since groups are small)
    let best = typeof g.distance === 'number' ? g.distance : maxDistance;
    const files = g.files;
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const d = ecuParser.tlshDistance(files[i].tlsh_digest, files[j].tlsh_digest);
        if (d !== null && d < best) best = d;
      }
    }
    result.push({ group_id: gid++, files: g.files, distance: best, root });
  }
  // Sort: tightest groups (lowest distance) first
  result.sort((a, b) => a.distance - b.distance);
  return result;
}

/* ===== Search history ===== */

/**
 * Append a query string to the search history. Coalesces consecutive
 * duplicates (same query as most-recent row) by updating its timestamp
 * instead of inserting a new row, then prunes to MAX_HISTORY_ROWS.
 * @param {string} query
 * @param {number} [resultCount]
 */
function addSearchHistory(query, resultCount) {
  const q = String(query || '').trim();
  if (!q) return { id: null, skipped: true };
  const count = typeof resultCount === 'number' ? resultCount : null;

  const tx = db.transaction(() => {
    const latest = db
      .prepare('SELECT id, query FROM search_history ORDER BY id DESC LIMIT 1')
      .get();
    if (latest && latest.query === q) {
      db.prepare(
        "UPDATE search_history SET result_count = ?, created_at = strftime('%s','now') WHERE id = ?"
      ).run(count, latest.id);
      return { id: latest.id, deduped: true };
    }
    const info = db
      .prepare('INSERT INTO search_history (query, result_count) VALUES (?, ?)')
      .run(q, count);
    // Trim to MAX_HISTORY_ROWS by deleting the oldest beyond that bound.
    db.prepare(
      `DELETE FROM search_history WHERE id IN (
         SELECT id FROM search_history ORDER BY id DESC LIMIT -1 OFFSET ?
       )`
    ).run(MAX_HISTORY_ROWS);
    return { id: info.lastInsertRowid, deduped: false };
  });
  return tx();
}

/**
 * Return the N most-recent unique queries (newest first).
 * @param {number} [limit]
 */
function listSearchHistory(limit = 10) {
  const n = Math.max(1, Math.min(50, Number(limit) || 10));
  return db
    .prepare(
      'SELECT id, query, result_count, created_at FROM search_history ORDER BY created_at DESC, id DESC LIMIT ?'
    )
    .all(n);
}

function clearSearchHistory() {
  const info = db.prepare('DELETE FROM search_history').run();
  return { changes: info.changes };
}

/* ===== Tag metadata (colors + descriptions) ===== */

function listTagMeta() {
  // Combine tag_meta rows with current usage counts from files.tags. Tags that
  // exist on at least one file but have no tag_meta row are returned with the
  // default color/empty description (defensive — should be rare since we
  // backfill on migration v4 and on upsert).
  const metaRows = db.prepare('SELECT name, color, description, created_at FROM tag_meta').all();
  const byName = new Map(metaRows.map((r) => [r.name, r]));

  // Count file usage per tag.
  const counts = new Map();
  const fileRows = db.prepare("SELECT tags FROM files WHERE tags IS NOT NULL AND tags != ''").all();
  for (const row of fileRows) {
    for (const raw of String(row.tags || '').split(',')) {
      const t = raw.trim();
      if (!t) continue;
      counts.set(t, (counts.get(t) || 0) + 1);
    }
  }

  const out = [];
  const allNames = new Set([...byName.keys(), ...counts.keys()]);
  for (const name of allNames) {
    const meta = byName.get(name) || {
      name,
      color: 'gray',
      description: '',
      created_at: null
    };
    out.push({
      name,
      color: meta.color || 'gray',
      description: meta.description || '',
      created_at: meta.created_at,
      file_count: counts.get(name) || 0
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

function upsertTagMeta(name, fields) {
  const n = String(name || '').trim();
  if (!n) return { error: 'Tag name is required' };
  const updates = fields || {};
  const color =
    updates.color && TAG_COLOR_WHITELIST.has(String(updates.color)) ? String(updates.color) : null;
  const description = typeof updates.description === 'string' ? updates.description : null;

  // INSERT OR ... use COALESCE for partial updates so we don't overwrite
  // unrelated columns when only color or description is provided.
  const existing = db.prepare('SELECT name FROM tag_meta WHERE name = ?').get(n);
  if (existing) {
    const sets = [];
    /** @type {Record<string, any>} */
    const params = { name: n };
    if (color !== null) {
      sets.push('color = @color');
      params.color = color;
    }
    if (description !== null) {
      sets.push('description = @description');
      params.description = description;
    }
    if (sets.length === 0) return { changes: 0 };
    const info = db
      .prepare(`UPDATE tag_meta SET ${sets.join(', ')} WHERE name = @name`)
      .run(params);
    return { changes: info.changes };
  } else {
    const info = db
      .prepare('INSERT INTO tag_meta (name, color, description) VALUES (?, ?, ?)')
      .run(n, color || 'gray', description || '');
    return { changes: info.changes };
  }
}

/**
 * Replace every occurrence of `oldName` in the tags CSV with `newName`,
 * preserving tag order and removing duplicates introduced by the rename.
 */
function applyTagRenameToFiles(oldName, newName) {
  const oldT = String(oldName || '').trim();
  const newT = String(newName || '').trim();
  if (!oldT || !newT) return 0;

  // Pull only rows that mention the old tag substring (LIKE) so we don't
  // serialize the whole archive. False positives (e.g. tag "stage" inside
  // tag "stage1") are filtered exactly by the per-row split below.
  const rows = db
    .prepare("SELECT id, tags FROM files WHERE tags LIKE ? AND tags != ''")
    .all(`%${oldT}%`);
  let touched = 0;
  const stmt = db.prepare('UPDATE files SET tags = ? WHERE id = ?');
  for (const row of rows) {
    const tags = String(row.tags || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    let changed = false;
    const seen = new Set();
    const next = [];
    for (const t of tags) {
      const replaced = t === oldT ? newT : t;
      if (replaced !== t) changed = true;
      if (!seen.has(replaced)) {
        seen.add(replaced);
        next.push(replaced);
      } else {
        // de-dupe after rename produced a collision
        changed = true;
      }
    }
    if (changed) {
      stmt.run(next.join(','), row.id);
      touched++;
    }
  }
  return touched;
}

function renameTag(oldName, newName) {
  const oldT = String(oldName || '').trim();
  const newT = String(newName || '').trim();
  if (!oldT || !newT) return { error: 'Both old and new names are required' };
  if (oldT === newT) return { changes: 0, filesTouched: 0 };

  const tx = db.transaction(() => {
    // Move/merge tag_meta row.
    const existingNew = db.prepare('SELECT name FROM tag_meta WHERE name = ?').get(newT);
    if (existingNew) {
      // Target already has metadata — keep it and drop the old row.
      db.prepare('DELETE FROM tag_meta WHERE name = ?').run(oldT);
    } else {
      // No-op if old doesn't have metadata either; ensure new row exists.
      const oldRow = db.prepare('SELECT color, description FROM tag_meta WHERE name = ?').get(oldT);
      if (oldRow) {
        db.prepare('UPDATE tag_meta SET name = ? WHERE name = ?').run(newT, oldT);
      } else {
        db.prepare(
          "INSERT OR IGNORE INTO tag_meta (name, color, description) VALUES (?, 'gray', '')"
        ).run(newT);
      }
    }
    const filesTouched = applyTagRenameToFiles(oldT, newT);
    return { changes: 1, filesTouched };
  });
  return tx();
}

function mergeTag(sourceName, targetName) {
  const src = String(sourceName || '').trim();
  const dst = String(targetName || '').trim();
  if (!src || !dst) return { error: 'Source and target names are required' };
  if (src === dst) return { changes: 0, filesTouched: 0 };

  const tx = db.transaction(() => {
    // Ensure target metadata row exists.
    db.prepare(
      "INSERT OR IGNORE INTO tag_meta (name, color, description) VALUES (?, 'gray', '')"
    ).run(dst);
    // Rewrite files.tags: src -> dst.
    const filesTouched = applyTagRenameToFiles(src, dst);
    // Drop the source's tag_meta row.
    db.prepare('DELETE FROM tag_meta WHERE name = ?').run(src);
    return { changes: 1, filesTouched };
  });
  return tx();
}

function deleteTag(name) {
  const t = String(name || '').trim();
  if (!t) return { error: 'Tag name is required' };

  const tx = db.transaction(() => {
    // Remove tag from every file that has it.
    const rows = db
      .prepare("SELECT id, tags FROM files WHERE tags LIKE ? AND tags != ''")
      .all(`%${t}%`);
    let filesTouched = 0;
    const upd = db.prepare('UPDATE files SET tags = ? WHERE id = ?');
    for (const row of rows) {
      const tags = String(row.tags || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const next = tags.filter((x) => x !== t);
      if (next.length !== tags.length) {
        upd.run(next.join(','), row.id);
        filesTouched++;
      }
    }
    db.prepare('DELETE FROM tag_meta WHERE name = ?').run(t);
    return { changes: 1, filesTouched };
  });
  return tx();
}

/* ===== Smart tag rules ===== */

const TAG_RULE_FIELDS_UPDATABLE = new Set([
  'name',
  'enabled',
  'match_field',
  'match_op',
  'match_value',
  'tag_to_add',
  'sort_order'
]);

/**
 * @param {{enabled?: boolean}} [opts]
 */
function listTagRules(opts = {}) {
  const where = [];
  if (opts.enabled === true) where.push('enabled = 1');
  if (opts.enabled === false) where.push('enabled = 0');
  const sql = `SELECT id, name, enabled, match_field, match_op, match_value, tag_to_add, sort_order, created_at
               FROM tag_rules ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
               ORDER BY sort_order ASC, id ASC`;
  return db.prepare(sql).all();
}

function createTagRule(rule) {
  const r = rule || {};
  const name = String(r.name || '').trim() || 'Untitled rule';
  const tag = String(r.tag_to_add || '').trim();
  if (!tag) return { error: 'tag_to_add is required' };
  const enabled = r.enabled === false || r.enabled === 0 ? 0 : 1;
  const matchField = r.match_field ? String(r.match_field) : '';
  const matchOp = r.match_op ? String(r.match_op) : '';
  const matchValue = r.match_value != null ? String(r.match_value) : '';
  const sortOrder = typeof r.sort_order === 'number' ? r.sort_order : Date.now();
  const info = db
    .prepare(
      `INSERT INTO tag_rules (name, enabled, match_field, match_op, match_value, tag_to_add, sort_order)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(name, enabled, matchField, matchOp, matchValue, tag, sortOrder);

  // Auto-create tag_meta for the rule's target tag (idempotent).
  db.prepare(
    "INSERT OR IGNORE INTO tag_meta (name, color, description) VALUES (?, 'gray', '')"
  ).run(tag);

  return { id: info.lastInsertRowid };
}

function updateTagRule(id, updates) {
  if (!updates || typeof updates !== 'object') return { changes: 0 };
  const sets = [];
  /** @type {Record<string, any>} */
  const params = { id };
  for (const k of Object.keys(updates)) {
    if (!TAG_RULE_FIELDS_UPDATABLE.has(k)) continue;
    let v = updates[k];
    if (k === 'enabled') v = v ? 1 : 0;
    sets.push(`${k} = @${k}`);
    params[k] = v;
  }
  if (sets.length === 0) return { changes: 0 };
  const info = db.prepare(`UPDATE tag_rules SET ${sets.join(', ')} WHERE id = @id`).run(params);

  // If tag_to_add changed, ensure tag_meta has a row for it.
  if (updates.tag_to_add) {
    db.prepare(
      "INSERT OR IGNORE INTO tag_meta (name, color, description) VALUES (?, 'gray', '')"
    ).run(String(updates.tag_to_add));
  }

  return { changes: info.changes };
}

function deleteTagRule(id) {
  const info = db.prepare('DELETE FROM tag_rules WHERE id = ?').run(id);
  return { changes: info.changes };
}

/* ===== Integrity scan ===== */

function listAllFilePaths() {
  return db.prepare('SELECT id, archive_path, new_name FROM files').all();
}

module.exports = {
  init,
  close,
  insertFile,
  updateFile,
  listFiles,
  getFile,
  deleteFile,
  findByMd5,
  listOriginalsMatching,
  listSolutionsOf,
  relinkSolution,
  convertKind,
  listAllWithTlsh,
  getStats,
  getSetting,
  setSetting,
  getAllSettings,
  exportAll,
  importAll,
  recordComparison,
  listRecentComparisons,
  deleteComparison,
  getVinCache,
  setVinCache,
  createSmartFolder,
  listSmartFolders,
  getSmartFolder,
  updateSmartFolder,
  deleteSmartFolder,
  findExactDuplicates,
  findNearDuplicates,
  listAllFilePaths,
  addSearchHistory,
  listSearchHistory,
  clearSearchHistory,
  listTagMeta,
  upsertTagMeta,
  renameTag,
  mergeTag,
  deleteTag,
  listTagRules,
  createTagRule,
  updateTagRule,
  deleteTagRule
};

// MIGRATIONS APPLIED:
//   v1 — initial schema (consolidated from legacy cascading ALTERs)
//   v2 — smart_folders table (saved searches)
//   v3 — search_history table (recent queries)
//   v4 — tag_meta table (color + description per tag; backfills from files.tags)
//   v5 — tag_rules table (smart tag application rules)
