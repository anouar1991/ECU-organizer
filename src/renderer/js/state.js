/* ===== Global state =====
 * Attached to window.App so every module can share via App.state / App.cmpState.
 */
window.App = window.App || {};

window.App.state = {
  files: [],
  activeFileIndex: -1,
  archiveRoot: '',
  settings: {
    default_mask: '[BRAND]_[MODEL]_[HW]_[STAGE].bin',
    auto_organize_enabled: '0',
    auto_organize_threshold: '85'
  },
  editingDbCell: null,
  dbKindFilter: '',
  expandedOriginals: new Set(),
  // Per-tag color + description cache. Populated from db.listTagMeta() on boot
  // and after any tag edit. Read by every tag-chip renderer.
  tagColors: new Map(),
  tagDescriptions: new Map()
};

window.App.cmpState = {
  fileA: null,
  fileB: null,
  result: null,
  busy: false,
  showAscii: true,
  minRegionSize: 1,
  pickerSlot: null,
  pickerQuery: '',
  pickerCandidates: []
};

// Database view internal — was a module-level let in renderer.js
window.App._compareArmedId = null;
