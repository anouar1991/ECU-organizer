// @ts-check
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const ecuParser = require('./ecu-parser');
const db = require('./database');
const fileOrganizer = require('./file-organizer');
const C = require('../shared/channels');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#1a1d23',
    title: 'ECU File Skinner Pro',
    icon: path.join(__dirname, '..', '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    autoHideMenuBar: true,
    frame: true
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  if (process.argv.includes('--enable-logging') || process.env.ECU_DEVTOOLS === '1') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('[renderer crashed]', details);
  });
  mainWindow.webContents.on('preload-error', (_e, preloadPath, err) => {
    console.error('[preload error]', preloadPath, err);
  });
}

app.whenReady().then(() => {
  db.init();
  createWindow();
  setImmediate(() => {
    dataUpdater
      .maybeCheckAtStartup()
      .then((r) => {
        if (r && r.updated) console.log(`[updater] applied ${r.updated} updates:`, r.applied);
      })
      .catch((err) => console.warn('[updater]', err.message));
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  db.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  try {
    require('./tlsh-pool').shutdown();
  } catch {}
});

/**
 * Evaluate a single smart-tag rule against a scanned file's metadata.
 * Returns true if the rule's match condition is satisfied.
 *
 * @param {{match_field?: string, match_op?: string, match_value?: string}} rule
 * @param {Record<string, any>} metadata
 * @param {string} fileName
 */
function smartTagRuleMatches(rule, metadata, fileName) {
  if (!rule) return false;
  const field = String(rule.match_field || '').toLowerCase();
  const op = String(rule.match_op || '').toLowerCase();
  const value = rule.match_value == null ? '' : String(rule.match_value);

  // Resolve the field's actual value on this scan.
  let actual;
  if (field === 'filename') actual = fileName || '';
  else if (field === 'brand') actual = metadata.brand || '';
  else if (field === 'model') actual = metadata.model || '';
  else if (field === 'ecu_type' || field === 'ecu') actual = metadata.ecuType || '';
  else if (field === 'hw_id' || field === 'hw') actual = metadata.hwId || '';
  else if (field === 'sw_id' || field === 'sw') actual = metadata.swId || '';
  else if (field === 'kind')
    actual = metadata.kind || ''; // not yet set at scan time
  else if (field === 'confidence') actual = metadata.confidence;
  else return false;

  const actualLc = String(actual == null ? '' : actual).toLowerCase();
  const valueLc = value.toLowerCase();

  switch (op) {
    case 'contains':
      return actualLc.includes(valueLc);
    case 'equals':
      return actualLc === valueLc;
    case 'startswith':
    case 'startsWith':
      return actualLc.startsWith(valueLc);
    case 'endswith':
    case 'endsWith':
      return actualLc.endsWith(valueLc);
    case 'regex': {
      try {
        // Support /pattern/flags or bare pattern.
        const m = value.match(/^\/(.*)\/([a-z]*)$/i);
        const re = m ? new RegExp(m[1], m[2]) : new RegExp(value);
        return re.test(String(actual == null ? '' : actual));
      } catch {
        return false;
      }
    }
    case 'gt': {
      const a = Number(actual);
      const v = Number(value);
      return Number.isFinite(a) && Number.isFinite(v) && a > v;
    }
    case 'lt': {
      const a = Number(actual);
      const v = Number(value);
      return Number.isFinite(a) && Number.isFinite(v) && a < v;
    }
    case 'range': {
      const a = Number(actual);
      const m = value.match(/^\s*(\d+)\s*-\s*(\d+)\s*$/);
      if (!m || !Number.isFinite(a)) return false;
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      return a >= lo && a <= hi;
    }
    default:
      return false;
  }
}

/**
 * Apply every enabled smart-tag rule to a scanned file. Returns an array of
 * suggested tags (deduplicated, case-preserving). The renderer decides whether
 * to surface these as suggestions or apply them silently.
 */
function applySmartTagRules(metadata, fileName) {
  try {
    const rules = db.listTagRules({ enabled: true });
    if (!rules || rules.length === 0) return [];
    const tags = new Set();
    for (const rule of rules) {
      if (smartTagRuleMatches(rule, metadata || {}, fileName || '')) {
        const t = String(rule.tag_to_add || '').trim();
        if (t) tags.add(t);
      }
    }
    return Array.from(tags);
  } catch (err) {
    console.warn('[main] applySmartTagRules failed:', err.message);
    return [];
  }
}

ipcMain.handle(C.ECU_SCAN_FILE, async (_event, filePath) => {
  try {
    const stats = fs.statSync(filePath);
    const metadata = await ecuParser.parseFile(filePath);
    const fileName = path.basename(filePath);
    const autoTags = applySmartTagRules(metadata, fileName);
    return {
      success: true,
      filePath,
      fileName,
      fileSize: stats.size,
      metadata,
      autoTags
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle(C.ECU_SCAN_MULTIPLE, async (_event, filePaths) => {
  const results = [];
  for (const filePath of filePaths) {
    try {
      const stats = fs.statSync(filePath);
      const metadata = await ecuParser.parseFile(filePath);
      const fileName = path.basename(filePath);
      const autoTags = applySmartTagRules(metadata, fileName);
      results.push({
        success: true,
        filePath,
        fileName,
        fileSize: stats.size,
        metadata,
        autoTags
      });
    } catch (err) {
      results.push({ success: false, filePath, error: err.message });
    }
  }
  return results;
});

ipcMain.handle(C.ECU_ORGANIZE, async (_event, payload) => {
  try {
    const result = await fileOrganizer.organize(payload);
    if (result.success) {
      const inserted = db.insertFile({
        kind: payload.kind || 'original',
        parentId: payload.parentId || null,
        solutionLabel: payload.solutionLabel || '',
        md5: payload.metadata.md5 || '',
        tlshDigest: payload.metadata.tlsh || '',
        vin: payload.metadata.vins && payload.metadata.vins[0] ? payload.metadata.vins[0] : '',
        enrichment: payload.metadata.enrichment || null,
        firmwareStructure: payload.metadata.firmwareStructure || null,
        originalName: payload.fileName,
        newName: result.newName,
        archivePath: result.archivePath,
        brand: payload.metadata.brand,
        model: payload.metadata.model,
        ecuType: payload.metadata.ecuType,
        hwId: payload.metadata.hwId,
        swId: payload.metadata.swId,
        protocol: payload.metadata.protocol,
        confidence: payload.metadata.confidence,
        fileSize: payload.fileSize,
        checksum: payload.metadata.checksum,
        tags: payload.tags || '',
        notes: payload.notes || ''
      });
      result.id = inserted.id;
    }
    return result;
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle(C.DB_FIND_BY_MD5, async (_event, md5) => {
  return db.findByMd5(md5);
});

ipcMain.handle(C.DB_LIST_ORIGINALS_MATCHING, async (_event, criteria) => {
  return db.listOriginalsMatching(criteria || {});
});

ipcMain.handle(C.DB_LIST_SOLUTIONS_OF, async (_event, originalId) => {
  return db.listSolutionsOf(originalId);
});

ipcMain.handle(C.DB_RELINK_SOLUTION, async (_event, solutionId, newParentId) => {
  return db.relinkSolution(solutionId, newParentId);
});

ipcMain.handle(C.DB_CONVERT_KIND, async (_event, id, newKind, newParentId) => {
  return db.convertKind(id, newKind, newParentId);
});

const vinLookup = require('./vin-lookup');
const dtcLookup = require('./dtc-lookup');
const dataUpdater = require('./data-updater');

ipcMain.handle(C.DATA_CHECK_UPDATES, async () => {
  return dataUpdater.checkForUpdates();
});

ipcMain.handle(C.DATA_LOCAL_MANIFEST, async () => {
  return dataUpdater.getLocalManifest();
});

ipcMain.handle(C.VIN_DECODE, async (_event, vin) => {
  const enabled = db.getSetting('online_vin_lookup') === '1';
  if (!enabled) {
    return { error: 'Online VIN lookup is disabled in Settings.' };
  }
  return vinLookup.decodeVin(vin);
});

ipcMain.handle(C.DTC_LOOKUP, async (_event, code, manufacturer) => {
  try {
    return dtcLookup.lookupDtc(code, manufacturer);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.DTC_SEARCH, async (_event, query, limit) => {
  try {
    return dtcLookup.searchDtc(query, limit || 20);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.DB_FIND_SIMILAR_TLSH, async (_event, tlshDigest, maxDistance) => {
  if (!tlshDigest) return [];
  const rows = db.listAllWithTlsh();
  const threshold = typeof maxDistance === 'number' ? maxDistance : 100;
  const scored = [];
  for (const r of rows) {
    if (!r.tlsh_digest) continue;
    const dist = ecuParser.tlshDistance(tlshDigest, r.tlsh_digest);
    if (dist === null) continue;
    if (dist <= threshold) scored.push({ ...r, tlsh_distance: dist });
  }
  scored.sort((a, b) => a.tlsh_distance - b.tlsh_distance);
  return scored.slice(0, 25);
});

ipcMain.handle(C.DB_UPDATE_FILE, async (_event, id, updates) => {
  try {
    return db.updateFile(id, updates);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.DB_EXPORT, async () => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Database',
    defaultPath: `ecu-skinner-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON Backup', extensions: ['json'] }]
  });
  if (result.canceled) return { canceled: true };
  const data = db.exportAll();
  fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2));
  return { success: true, path: result.filePath, count: data.files.length };
});

ipcMain.handle(C.DB_IMPORT, async (_event, mergeMode) => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Import Database',
    filters: [{ name: 'JSON Backup', extensions: ['json'] }],
    properties: ['openFile']
  });
  if (result.canceled || result.filePaths.length === 0) return { canceled: true };
  try {
    const raw = fs.readFileSync(result.filePaths[0], 'utf8');
    const payload = JSON.parse(raw);
    return db.importAll(payload, { mergeMode: mergeMode || 'append' });
  } catch (err) {
    return { success: false, error: 'Invalid file: ' + err.message };
  }
});

ipcMain.handle(C.SETTINGS_GET_ALL, async () => {
  return db.getAllSettings();
});

ipcMain.handle(C.SETTINGS_SET, async (_event, key, value) => {
  db.setSetting(key, value);
  return { success: true };
});

ipcMain.handle(C.ECU_HEX_PEEK, async (_event, filePath, byteCount, offset) => {
  try {
    return await ecuParser.hexPeek(filePath, byteCount || 512, offset || 0);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.ECU_PEEK_ARCHIVE_FILE, async (_event, archivePath, byteCount) => {
  try {
    return await ecuParser.hexPeek(archivePath, byteCount || 512, 0);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.DB_LIST_FILES, async (_event, filters) => {
  return db.listFiles(filters || {});
});

ipcMain.handle(C.DB_GET_STATS, async () => {
  return db.getStats();
});

ipcMain.handle(C.DB_DELETE_FILE, async (_event, id) => {
  return db.deleteFile(id);
});

ipcMain.handle(C.SETTINGS_GET_ARCHIVE_ROOT, async () => {
  return fileOrganizer.getArchiveRoot();
});

ipcMain.handle(C.SETTINGS_SET_ARCHIVE_ROOT, async (_event, newPath) => {
  return fileOrganizer.setArchiveRoot(newPath);
});

ipcMain.handle(C.DIALOG_SELECT_DIRECTORY, async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});

ipcMain.handle(C.DIALOG_SELECT_FILES, async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'ECU Binary Files', extensions: ['bin', 'ori', 'mod', 'frf', 'sgo', 'kp'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });
  if (result.canceled) return [];
  return result.filePaths;
});

ipcMain.handle(C.SHELL_OPEN_FOLDER, async (_event, folderPath) => {
  shell.openPath(folderPath);
});

ipcMain.handle(C.CHECKSUM_COMPUTE, async (_event, filePath) => {
  return ecuParser.computeChecksums(filePath);
});

const ecuComparator = require('./ecu-comparator');

ipcMain.handle(C.COMPARE_TWO_FILES, async (_event, pathA, pathB) => {
  try {
    return await ecuComparator.compareFiles(pathA, pathB);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.COMPARE_RECORD, async (_event, rec) => {
  try {
    return db.recordComparison(rec);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.COMPARE_LIST_RECENT, async (_event, limit) => {
  return db.listRecentComparisons(limit || 5);
});

ipcMain.handle(C.COMPARE_DELETE_RECENT, async (_event, id) => {
  return db.deleteComparison(id);
});

ipcMain.handle(C.COMPARE_EXPORT_REPORT, async (_event, payload, format) => {
  const ext = format === 'markdown' ? 'md' : 'json';
  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Comparison Report',
    defaultPath: `ecu-diff-${new Date().toISOString().slice(0, 10)}.${ext}`,
    filters: [{ name: format === 'markdown' ? 'Markdown' : 'JSON', extensions: [ext] }]
  });
  if (result.canceled) return { canceled: true };
  try {
    fs.writeFileSync(result.filePath, payload);
    return { success: true, path: result.filePath };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

// --- App self-update ---
const updaterService = require('./updater-service');

app.whenReady().then(() => {
  // wait for mainWindow to exist
  const interval = setInterval(() => {
    const win = require('electron').BrowserWindow.getAllWindows()[0];
    if (win) {
      updaterService.configure(win);
      clearInterval(interval);
    }
  }, 200);
});

ipcMain.handle(C.APP_UPDATE_CHECK, async () => updaterService.checkForUpdates());
ipcMain.handle(C.APP_UPDATE_DOWNLOAD, async () => updaterService.downloadUpdate());
ipcMain.handle(C.APP_UPDATE_INSTALL, async () => {
  updaterService.quitAndInstall();
  return { ok: true };
});
ipcMain.handle(C.APP_UPDATE_VERSION, async () => updaterService.getCurrentVersion());

// --- Smart folders ---
ipcMain.handle(C.SMART_FOLDER_CREATE, async (_event, payload) => {
  try {
    return db.createSmartFolder(payload || {});
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.SMART_FOLDER_LIST, async () => {
  try {
    return db.listSmartFolders();
  } catch (err) {
    return { error: err.message, folders: [] };
  }
});

ipcMain.handle(C.SMART_FOLDER_UPDATE, async (_event, id, updates) => {
  try {
    return db.updateSmartFolder(id, updates || {});
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.SMART_FOLDER_DELETE, async (_event, id) => {
  try {
    return db.deleteSmartFolder(id);
  } catch (err) {
    return { error: err.message };
  }
});

// --- Duplicates ---
ipcMain.handle(C.DUPES_FIND_EXACT, async () => {
  try {
    return db.findExactDuplicates();
  } catch (err) {
    return { error: err.message, groups: [] };
  }
});

ipcMain.handle(C.DUPES_FIND_SIMILAR, async (_event, maxDistance) => {
  try {
    const d = typeof maxDistance === 'number' ? maxDistance : 30;
    return db.findNearDuplicates(d);
  } catch (err) {
    return { error: err.message, groups: [] };
  }
});

// --- Search history (Pack A.3) ---
ipcMain.handle(C.SEARCH_HISTORY_ADD, async (_event, query, resultCount) => {
  try {
    return db.addSearchHistory(query, resultCount);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.SEARCH_HISTORY_LIST, async (_event, limit) => {
  try {
    return db.listSearchHistory(limit || 10);
  } catch (err) {
    return { error: err.message, items: [] };
  }
});

ipcMain.handle(C.SEARCH_HISTORY_CLEAR, async () => {
  try {
    return db.clearSearchHistory();
  } catch (err) {
    return { error: err.message };
  }
});

// --- Tag metadata ---
ipcMain.handle(C.TAG_LIST_META, async () => {
  try {
    return db.listTagMeta();
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.TAG_UPSERT_META, async (_event, name, fields) => {
  try {
    return db.upsertTagMeta(name, fields || {});
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.TAG_RENAME, async (_event, oldName, newName) => {
  try {
    return db.renameTag(oldName, newName);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.TAG_MERGE, async (_event, sourceName, targetName) => {
  try {
    return db.mergeTag(sourceName, targetName);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.TAG_DELETE, async (_event, name) => {
  try {
    return db.deleteTag(name);
  } catch (err) {
    return { error: err.message };
  }
});

// --- Smart tag rules ---
ipcMain.handle(C.TAG_RULES_LIST, async (_event, opts) => {
  try {
    return db.listTagRules(opts || {});
  } catch (err) {
    return { error: err.message, rules: [] };
  }
});

ipcMain.handle(C.TAG_RULES_CREATE, async (_event, rule) => {
  try {
    return db.createTagRule(rule || {});
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.TAG_RULES_UPDATE, async (_event, id, updates) => {
  try {
    return db.updateTagRule(id, updates || {});
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.TAG_RULES_DELETE, async (_event, id) => {
  try {
    return db.deleteTagRule(id);
  } catch (err) {
    return { error: err.message };
  }
});

// --- Archive integrity ---
ipcMain.handle(C.INTEGRITY_SCAN, async () => {
  try {
    const all = db.listAllFilePaths();
    const missing = [];
    for (const r of all) {
      try {
        if (!r.archive_path || !fs.existsSync(r.archive_path)) missing.push(r);
      } catch {
        // If existsSync throws (race: file removed between checks, EACCES, etc.),
        // count as missing — the user-visible row is "broken" either way.
        missing.push(r);
      }
    }
    return { total: all.length, missing };
  } catch (err) {
    return { error: err.message, total: 0, missing: [] };
  }
});

// --- Pinouts / connection guides ---

// Images for pinouts live under userData/pinouts/<id>.<ext>. We keep the
// store path private to main and expose two helpers:
//   PINOUT_IMPORT_IMAGE — copy a source file into the store, return the
//     RELATIVE path (`<id>.png`) for the DB.
//   PINOUT_GET_IMAGE_URL — turn a relative path into a `file://` URL the
//     renderer can drop into an <img>. The renderer NEVER sees the absolute
//     path so users can't accidentally write outside the store.
function pinoutImagesDir() {
  const dir = path.join(app.getPath('userData'), 'pinouts');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const ALLOWED_PINOUT_IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.svg']);

function safeBasename(p) {
  // Strip any directory components — store is flat.
  return path.basename(String(p || ''));
}

ipcMain.handle(C.PINOUT_LIST, async (_event, filters) => {
  try {
    return db.listPinouts(filters || {});
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.PINOUT_GET, async (_event, id) => {
  try {
    return db.getPinout(id);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.PINOUT_CREATE, async (_event, payload) => {
  try {
    return db.createPinout(payload);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.PINOUT_UPDATE, async (_event, id, updates) => {
  try {
    const updated = db.updatePinout(id, updates || {});
    if (!updated) return { error: 'not found' };
    return updated;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.PINOUT_DELETE, async (_event, id) => {
  try {
    const res = db.deletePinout(id);
    // Best-effort cleanup of the orphaned image file.
    if (res && res.success && res.imagePath) {
      const abs = path.join(pinoutImagesDir(), safeBasename(res.imagePath));
      try {
        if (fs.existsSync(abs)) fs.unlinkSync(abs);
      } catch {
        // ignore — DB row already gone, image cleanup is best-effort
      }
    }
    return res;
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.PINOUT_SUGGEST_FOR_ECU, async (_event, ecu) => {
  try {
    return db.suggestPinoutsForEcu(ecu || {});
  } catch (err) {
    return { error: err.message, results: [] };
  }
});

ipcMain.handle(C.PINOUT_SEARCH, async (_event, query, limit) => {
  try {
    return db.searchPinouts(query, limit || 100);
  } catch (err) {
    return { error: err.message };
  }
});

ipcMain.handle(C.PINOUT_IMPORT_IMAGE, async (_event, sourcePath) => {
  try {
    if (!sourcePath || typeof sourcePath !== 'string') {
      return { success: false, error: 'sourcePath required' };
    }
    const src = path.resolve(sourcePath);
    if (!fs.existsSync(src)) return { success: false, error: 'source not found' };
    const ext = path.extname(src).toLowerCase();
    if (!ALLOWED_PINOUT_IMAGE_EXT.has(ext)) {
      return {
        success: false,
        error: `unsupported image type ${ext}. Allowed: ${[...ALLOWED_PINOUT_IMAGE_EXT].join(', ')}`
      };
    }
    // Use a content-hash filename so identical images dedupe automatically.
    const buf = fs.readFileSync(src);
    const hash = require('crypto').createHash('md5').update(buf).digest('hex').slice(0, 16);
    const filename = `${hash}${ext}`;
    const dest = path.join(pinoutImagesDir(), filename);
    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, buf);
    }
    return { success: true, imagePath: filename };
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle(C.PINOUT_GET_IMAGE_URL, async (_event, relPath) => {
  if (!relPath) return null;
  const safe = safeBasename(relPath);
  const abs = path.join(pinoutImagesDir(), safe);
  if (!fs.existsSync(abs)) return null;
  // file:// URL with proper escaping. URL helps Windows path / spaces.
  return require('url').pathToFileURL(abs).toString();
});

ipcMain.handle(C.PINOUT_LOAD_SAMPLES, async () => {
  // Idempotent seed of the curated sample dataset bundled with the app. Each
  // (brand, ecu_family, ecu_model, method) tuple is inserted only if no row
  // already exists for the same combination. Returns counts so the renderer
  // can toast the result. Sources for the data: see _about block of
  // src/data/sample_pinouts.json.
  try {
    const samplesPath = path.join(__dirname, '..', 'data', 'sample_pinouts.json');
    if (!fs.existsSync(samplesPath)) {
      return { success: false, error: 'sample_pinouts.json not found' };
    }
    const raw = fs.readFileSync(samplesPath, 'utf8');
    const parsed = JSON.parse(raw);
    const entries = Array.isArray(parsed.entries) ? parsed.entries : [];

    let added = 0;
    let skipped = 0;
    const errors = [];
    for (const entry of entries) {
      try {
        // Pre-check by listing the matching (family, method) combo and looking
        // for a matching ecuModel — cheaper than catching the UNIQUE constraint.
        const existing = db.listPinouts({ family: entry.ecuFamily, method: entry.method });
        const dupe = existing.find(
          (e) =>
            (e.brand || '') === (entry.brand || '') &&
            (e.ecuModel || null) === (entry.ecuModel || null)
        );
        if (dupe) {
          skipped++;
          continue;
        }
        db.createPinout(entry);
        added++;
      } catch (err) {
        errors.push({
          entry: `${entry.brand}/${entry.ecuFamily}/${entry.ecuModel}/${entry.method}`,
          err: err.message
        });
      }
    }
    return { success: true, added, skipped, total: entries.length, errors };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
