// @ts-check
const { contextBridge, ipcRenderer, webUtils } = require('electron');
const C = require('../shared/channels');

contextBridge.exposeInMainWorld('api', {
  scanFile: (filePath) => ipcRenderer.invoke(C.ECU_SCAN_FILE, filePath),
  scanMultiple: (filePaths) => ipcRenderer.invoke(C.ECU_SCAN_MULTIPLE, filePaths),
  organize: (payload) => ipcRenderer.invoke(C.ECU_ORGANIZE, payload),

  listFiles: (filters) => ipcRenderer.invoke(C.DB_LIST_FILES, filters),
  getStats: () => ipcRenderer.invoke(C.DB_GET_STATS),
  deleteFile: (id) => ipcRenderer.invoke(C.DB_DELETE_FILE, id),
  updateFile: (id, updates) => ipcRenderer.invoke(C.DB_UPDATE_FILE, id, updates),
  findByMd5: (md5) => ipcRenderer.invoke(C.DB_FIND_BY_MD5, md5),
  listOriginalsMatching: (c) => ipcRenderer.invoke(C.DB_LIST_ORIGINALS_MATCHING, c),
  listSolutionsOf: (id) => ipcRenderer.invoke(C.DB_LIST_SOLUTIONS_OF, id),
  relinkSolution: (id, parentId) => ipcRenderer.invoke(C.DB_RELINK_SOLUTION, id, parentId),
  convertKind: (id, kind, parentId) => ipcRenderer.invoke(C.DB_CONVERT_KIND, id, kind, parentId),
  findSimilarTlsh: (digest, maxDist) => ipcRenderer.invoke(C.DB_FIND_SIMILAR_TLSH, digest, maxDist),
  decodeVin: (vin) => ipcRenderer.invoke(C.VIN_DECODE, vin),
  lookupDtc: (code, manuf) => ipcRenderer.invoke(C.DTC_LOOKUP, code, manuf),
  searchDtc: (q, limit) => ipcRenderer.invoke(C.DTC_SEARCH, q, limit),
  checkDataUpdates: () => ipcRenderer.invoke(C.DATA_CHECK_UPDATES),
  localManifest: () => ipcRenderer.invoke(C.DATA_LOCAL_MANIFEST),
  exportDatabase: () => ipcRenderer.invoke(C.DB_EXPORT),
  importDatabase: (mergeMode) => ipcRenderer.invoke(C.DB_IMPORT, mergeMode),

  getSettings: () => ipcRenderer.invoke(C.SETTINGS_GET_ALL),
  setSetting: (key, value) => ipcRenderer.invoke(C.SETTINGS_SET, key, value),

  getArchiveRoot: () => ipcRenderer.invoke(C.SETTINGS_GET_ARCHIVE_ROOT),
  setArchiveRoot: (newPath) => ipcRenderer.invoke(C.SETTINGS_SET_ARCHIVE_ROOT, newPath),

  selectDirectory: () => ipcRenderer.invoke(C.DIALOG_SELECT_DIRECTORY),
  selectFiles: () => ipcRenderer.invoke(C.DIALOG_SELECT_FILES),
  openFolder: (folderPath) => ipcRenderer.invoke(C.SHELL_OPEN_FOLDER, folderPath),

  computeChecksum: (filePath) => ipcRenderer.invoke(C.CHECKSUM_COMPUTE, filePath),
  hexPeek: (filePath, n, off) => ipcRenderer.invoke(C.ECU_HEX_PEEK, filePath, n, off),
  compareFiles: (a, b) => ipcRenderer.invoke(C.COMPARE_TWO_FILES, a, b),
  recordComparison: (rec) => ipcRenderer.invoke(C.COMPARE_RECORD, rec),
  listRecentComparisons: (n) => ipcRenderer.invoke(C.COMPARE_LIST_RECENT, n),
  deleteComparison: (id) => ipcRenderer.invoke(C.COMPARE_DELETE_RECENT, id),
  exportComparison: (payload, format) =>
    ipcRenderer.invoke(C.COMPARE_EXPORT_REPORT, payload, format),

  appUpdateCheck: () => ipcRenderer.invoke(C.APP_UPDATE_CHECK),
  appUpdateDownload: () => ipcRenderer.invoke(C.APP_UPDATE_DOWNLOAD),
  appUpdateInstall: () => ipcRenderer.invoke(C.APP_UPDATE_INSTALL),
  appUpdateVersion: () => ipcRenderer.invoke(C.APP_UPDATE_VERSION),
  appUpdateOnEvent: (cb) => {
    const handler = (_e, payload) => cb(payload);
    ipcRenderer.on(C.APP_UPDATE_EVENT, handler);
    return () => ipcRenderer.removeListener(C.APP_UPDATE_EVENT, handler);
  },

  // Smart folders
  createSmartFolder: (payload) => ipcRenderer.invoke(C.SMART_FOLDER_CREATE, payload),
  listSmartFolders: () => ipcRenderer.invoke(C.SMART_FOLDER_LIST),
  updateSmartFolder: (id, updates) => ipcRenderer.invoke(C.SMART_FOLDER_UPDATE, id, updates),
  deleteSmartFolder: (id) => ipcRenderer.invoke(C.SMART_FOLDER_DELETE, id),

  // Duplicates
  findExactDuplicates: () => ipcRenderer.invoke(C.DUPES_FIND_EXACT),
  findNearDuplicates: (maxDistance) => ipcRenderer.invoke(C.DUPES_FIND_SIMILAR, maxDistance),

  // Archive integrity
  scanIntegrity: () => ipcRenderer.invoke(C.INTEGRITY_SCAN),

  // Search history (Pack A.3)
  addSearchHistory: (query, resultCount) =>
    ipcRenderer.invoke(C.SEARCH_HISTORY_ADD, query, resultCount),
  listSearchHistory: (limit) => ipcRenderer.invoke(C.SEARCH_HISTORY_LIST, limit),
  clearSearchHistory: () => ipcRenderer.invoke(C.SEARCH_HISTORY_CLEAR),

  // Tag metadata
  listTagMeta: () => ipcRenderer.invoke(C.TAG_LIST_META),
  upsertTagMeta: (name, fields) => ipcRenderer.invoke(C.TAG_UPSERT_META, name, fields),
  renameTag: (oldName, newName) => ipcRenderer.invoke(C.TAG_RENAME, oldName, newName),
  mergeTag: (sourceName, targetName) => ipcRenderer.invoke(C.TAG_MERGE, sourceName, targetName),
  deleteTag: (name) => ipcRenderer.invoke(C.TAG_DELETE, name),

  // Smart tag rules
  listTagRules: (opts) => ipcRenderer.invoke(C.TAG_RULES_LIST, opts),
  createTagRule: (rule) => ipcRenderer.invoke(C.TAG_RULES_CREATE, rule),
  updateTagRule: (id, updates) => ipcRenderer.invoke(C.TAG_RULES_UPDATE, id, updates),
  deleteTagRule: (id) => ipcRenderer.invoke(C.TAG_RULES_DELETE, id),

  // Pinouts / connection guides
  listPinouts: (filters) => ipcRenderer.invoke(C.PINOUT_LIST, filters),
  getPinout: (id) => ipcRenderer.invoke(C.PINOUT_GET, id),
  createPinout: (payload) => ipcRenderer.invoke(C.PINOUT_CREATE, payload),
  updatePinout: (id, updates) => ipcRenderer.invoke(C.PINOUT_UPDATE, id, updates),
  deletePinout: (id) => ipcRenderer.invoke(C.PINOUT_DELETE, id),
  suggestPinoutsForEcu: (ecu) => ipcRenderer.invoke(C.PINOUT_SUGGEST_FOR_ECU, ecu),
  searchPinouts: (q, limit) => ipcRenderer.invoke(C.PINOUT_SEARCH, q, limit),
  importPinoutImage: (sourcePath) => ipcRenderer.invoke(C.PINOUT_IMPORT_IMAGE, sourcePath),
  getPinoutImageUrl: (relPath) => ipcRenderer.invoke(C.PINOUT_GET_IMAGE_URL, relPath),

  getPathForFile: (file) => {
    try {
      return webUtils.getPathForFile(file);
    } catch {
      return file.path || null;
    }
  }
});
