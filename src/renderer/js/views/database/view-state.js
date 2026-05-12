/* ===== Database view: persisted view state =====
 * Centralizes per-user database-view preferences: which view mode is active
 * (table vs grid), column order/widths/sort, density, group-by selector, and
 * collapsed group keys. Persists via window.api.setSetting (existing IPC).
 *
 * Load is one-shot at view mount; saves are debounced per-key so a column
 * resize drag doesn't fire a write per mousemove.
 */
window.App = window.App || {};
window.App.state = window.App.state || {};

(function () {
  const App = window.App;

  // ---------- defaults ----------
  const DEFAULT_COLUMNS = [
    { id: 'select', label: '', resizable: false, sortable: false, width: 30 },
    { id: 'expand', label: '', resizable: false, sortable: false, width: 28 },
    { id: 'kind', label: 'Kind', resizable: true, sortable: true, width: 80 },
    { id: 'brand', label: 'Brand', resizable: true, sortable: true, width: 110 },
    { id: 'model', label: 'Model', resizable: true, sortable: true, width: 110 },
    { id: 'ecu_type', label: 'ECU Type', resizable: true, sortable: true, width: 140 },
    { id: 'hw_id', label: 'HW ID', resizable: true, sortable: true, width: 120 },
    { id: 'sw_id', label: 'SW ID', resizable: true, sortable: true, width: 120 },
    { id: 'solution', label: 'Solution', resizable: true, sortable: true, width: 140 },
    { id: 'new_name', label: 'New Name', resizable: true, sortable: true, width: 220 },
    { id: 'tags', label: 'Tags', resizable: true, sortable: false, width: 160 },
    { id: 'confidence', label: 'Conf', resizable: true, sortable: true, width: 60 },
    { id: 'file_size', label: 'Size', resizable: true, sortable: true, width: 90 },
    { id: 'created_at', label: 'Date', resizable: true, sortable: true, width: 160 },
    { id: 'actions', label: '', resizable: false, sortable: false, width: 80 }
  ];

  // Frozen catalog used by columns.js to resolve id -> meta.
  App.DB_COLUMN_CATALOG = DEFAULT_COLUMNS.reduce((acc, c) => {
    acc[c.id] = c;
    return acc;
  }, {});

  function defaultColumnsConfig() {
    /** @type {Record<string, number>} */
    const widths = {};
    for (const c of DEFAULT_COLUMNS) widths[c.id] = c.width;
    return {
      order: DEFAULT_COLUMNS.map((c) => c.id),
      widths,
      sort: { col: 'created_at', dir: 'desc' }
    };
  }

  // ---------- state slots (shared across modules) ----------
  const state = App.state;
  state.dbViewMode = state.dbViewMode || 'table'; // 'table' | 'grid'
  state.dbDensity = state.dbDensity || 'comfortable'; // 'compact' | 'comfortable' | 'spacious'
  state.dbGroupBy = state.dbGroupBy || ''; // '' | 'brand' | 'model' | 'ecu_type' | 'kind' | 'tag' | 'day' | 'conf'
  state.dbCollapsedGroups = state.dbCollapsedGroups || new Set();
  state.dbColumnsConfig = state.dbColumnsConfig || defaultColumnsConfig();
  state.dbDetailFileId = state.dbDetailFileId || null;

  // ---------- save (debounced per-key) ----------
  /** @type {Record<string, ReturnType<typeof setTimeout> | null>} */
  const _saveTimers = {};
  function persist(key, value, delayMs) {
    if (!window.api || typeof window.api.setSetting !== 'function') return;
    if (_saveTimers[key]) clearTimeout(_saveTimers[key]);
    _saveTimers[key] = setTimeout(
      () => {
        _saveTimers[key] = null;
        try {
          window.api.setSetting(key, value);
        } catch (e) {
          /* persist failure must never break the UI */
          if (App.logLine) App.logLine('err', `Failed to persist ${key}: ${e.message}`);
        }
      },
      typeof delayMs === 'number' ? delayMs : 150
    );
  }

  // ---------- load (called at view mount) ----------
  App.loadDatabaseViewState = async function loadDatabaseViewState() {
    if (!window.api || typeof window.api.getSettings !== 'function') return;
    let s = {};
    try {
      s = (await window.api.getSettings()) || {};
    } catch (e) {
      return;
    }

    if (s.db_view_mode === 'grid' || s.db_view_mode === 'table') {
      state.dbViewMode = s.db_view_mode;
    }
    if (
      s.db_density === 'compact' ||
      s.db_density === 'comfortable' ||
      s.db_density === 'spacious'
    ) {
      state.dbDensity = s.db_density;
    }
    if (typeof s.db_group_by === 'string') {
      state.dbGroupBy = s.db_group_by;
    }
    if (s.db_columns_config) {
      try {
        const parsed = JSON.parse(s.db_columns_config);
        const merged = defaultColumnsConfig();
        // Preserve only known column ids; appending unknown ids would render
        // empty cells. Pruning unknown ids guards against future renames.
        const validIds = new Set(Object.keys(App.DB_COLUMN_CATALOG));
        if (Array.isArray(parsed.order)) {
          const seen = new Set();
          const filtered = parsed.order.filter((id) => {
            if (!validIds.has(id) || seen.has(id)) return false;
            seen.add(id);
            return true;
          });
          // Append any defaults that were missing (e.g., new column added).
          for (const def of merged.order) if (!seen.has(def)) filtered.push(def);
          merged.order = filtered;
        }
        if (parsed.widths && typeof parsed.widths === 'object') {
          for (const id of Object.keys(parsed.widths)) {
            if (validIds.has(id)) {
              const w = parseInt(parsed.widths[id], 10);
              if (Number.isFinite(w) && w > 24 && w < 800) merged.widths[id] = w;
            }
          }
        }
        if (parsed.sort && typeof parsed.sort === 'object') {
          const c = String(parsed.sort.col || '');
          if (validIds.has(c)) merged.sort.col = c;
          merged.sort.dir = parsed.sort.dir === 'asc' ? 'asc' : 'desc';
        }
        state.dbColumnsConfig = merged;
      } catch {
        /* malformed JSON in DB — keep defaults */
      }
    }
  };

  // ---------- save helpers (called from feature modules) ----------
  App.saveDbViewMode = (mode) => persist('db_view_mode', mode, 0);
  App.saveDbDensity = (d) => persist('db_density', d, 0);
  App.saveDbGroupBy = (g) => persist('db_group_by', g, 0);
  App.saveDbColumnsConfig = (cfg) => persist('db_columns_config', JSON.stringify(cfg), 250);
})();
