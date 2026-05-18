// @ts-check
// Shared IPC channel names. Import on both sides (main + preload) to avoid drift.
// Format: <DOMAIN>_<VERB> = '<domain>:<verb>'

module.exports = Object.freeze({
  // ECU scanning + organize
  ECU_SCAN_FILE: 'ecu:scan-file',
  ECU_SCAN_MULTIPLE: 'ecu:scan-multiple',
  ECU_ORGANIZE: 'ecu:organize',
  ECU_HEX_PEEK: 'ecu:hex-peek',
  ECU_PEEK_ARCHIVE_FILE: 'ecu:peek-archive-file',

  // Database
  DB_LIST_FILES: 'db:list-files',
  DB_GET_STATS: 'db:get-stats',
  DB_DELETE_FILE: 'db:delete-file',
  DB_UPDATE_FILE: 'db:update-file',
  DB_FIND_BY_MD5: 'db:find-by-md5',
  DB_LIST_ORIGINALS_MATCHING: 'db:list-originals-matching',
  DB_LIST_SOLUTIONS_OF: 'db:list-solutions-of',
  DB_RELINK_SOLUTION: 'db:relink-solution',
  DB_CONVERT_KIND: 'db:convert-kind',
  DB_FIND_SIMILAR_TLSH: 'db:find-similar-tlsh',
  DB_EXPORT: 'db:export',
  DB_IMPORT: 'db:import',

  // Settings
  SETTINGS_GET_ALL: 'settings:get-all',
  SETTINGS_SET: 'settings:set',
  SETTINGS_GET_ARCHIVE_ROOT: 'settings:get-archive-root',
  SETTINGS_SET_ARCHIVE_ROOT: 'settings:set-archive-root',

  // Dialogs / shell
  DIALOG_SELECT_DIRECTORY: 'dialog:select-directory',
  DIALOG_SELECT_FILES: 'dialog:select-files',
  SHELL_OPEN_FOLDER: 'shell:open-folder',

  // Checksum + compare
  CHECKSUM_COMPUTE: 'checksum:compute',
  COMPARE_TWO_FILES: 'compare:two-files',
  COMPARE_RECORD: 'compare:record',
  COMPARE_LIST_RECENT: 'compare:list-recent',
  COMPARE_DELETE_RECENT: 'compare:delete-recent',
  COMPARE_EXPORT_REPORT: 'compare:export-report',

  // VIN + DTC
  VIN_DECODE: 'vin:decode',
  DTC_LOOKUP: 'dtc:lookup',
  DTC_SEARCH: 'dtc:search',

  // Data updates
  DATA_CHECK_UPDATES: 'data:check-updates',
  DATA_LOCAL_MANIFEST: 'data:local-manifest',

  // App self-update (electron-updater)
  APP_UPDATE_CHECK: 'app-update:check',
  APP_UPDATE_DOWNLOAD: 'app-update:download',
  APP_UPDATE_INSTALL: 'app-update:install',
  APP_UPDATE_VERSION: 'app-update:version',
  APP_UPDATE_EVENT: 'app-update:event',

  // Smart folders (saved searches)
  SMART_FOLDER_CREATE: 'smart-folder:create',
  SMART_FOLDER_LIST: 'smart-folder:list',
  SMART_FOLDER_UPDATE: 'smart-folder:update',
  SMART_FOLDER_DELETE: 'smart-folder:delete',

  // Duplicates
  DUPES_FIND_EXACT: 'dupes:find-exact',
  DUPES_FIND_SIMILAR: 'dupes:find-similar',

  // Archive integrity
  INTEGRITY_SCAN: 'integrity:scan',

  // Search history (Pack A.3)
  SEARCH_HISTORY_ADD: 'search-history:add',
  SEARCH_HISTORY_LIST: 'search-history:list',
  SEARCH_HISTORY_CLEAR: 'search-history:clear',

  // Tag metadata (colors, descriptions, rename/merge/delete)
  TAG_LIST_META: 'tag:list-meta',
  TAG_UPSERT_META: 'tag:upsert-meta',
  TAG_RENAME: 'tag:rename',
  TAG_MERGE: 'tag:merge',
  TAG_DELETE: 'tag:delete',

  // Smart tag rules
  TAG_RULES_LIST: 'tag-rules:list',
  TAG_RULES_CREATE: 'tag-rules:create',
  TAG_RULES_UPDATE: 'tag-rules:update',
  TAG_RULES_DELETE: 'tag-rules:delete',

  // Pinouts / connection guides
  PINOUT_LIST: 'pinout:list',
  PINOUT_GET: 'pinout:get',
  PINOUT_CREATE: 'pinout:create',
  PINOUT_UPDATE: 'pinout:update',
  PINOUT_DELETE: 'pinout:delete',
  PINOUT_SUGGEST_FOR_ECU: 'pinout:suggest-for-ecu',
  PINOUT_SEARCH: 'pinout:search',
  PINOUT_IMPORT_IMAGE: 'pinout:import-image',
  PINOUT_GET_IMAGE_URL: 'pinout:get-image-url'
});
