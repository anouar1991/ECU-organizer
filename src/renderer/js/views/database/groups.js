/* ===== Database view: group-by =====
 * Wraps a flat row list into a list of {key, label, rows} groups using the
 * field selected in App.state.dbGroupBy. Returns an empty array of groups
 * if grouping is disabled — callers should fall back to plain rendering.
 *
 * Collapsed-group state is preserved in App.state.dbCollapsedGroups (a Set
 * of group keys), kept across re-renders so the user's pickup isn't lost.
 */
window.App = window.App || {};

(function () {
  const App = window.App;

  function confBucket(c) {
    const n = Number(c) || 0;
    if (n >= 80) return { key: 'conf:high', label: App.t('database.group_conf_high'), order: 0 };
    if (n >= 50) return { key: 'conf:mid', label: App.t('database.group_conf_mid'), order: 1 };
    return { key: 'conf:low', label: App.t('database.group_conf_low'), order: 2 };
  }

  function dayKey(ts) {
    if (!ts) return { key: 'day:unknown', label: App.t('database.group_unknown_date'), order: 1e9 };
    const d = new Date(ts * 1000);
    const iso = d.toISOString().slice(0, 10);
    // Newest day first when groups sorted ascending → invert by negation.
    return { key: 'day:' + iso, label: iso, order: -d.getTime() };
  }

  /**
   * @param {Array<Record<string, any>>} rows
   * @returns {Array<{key: string, label: string, rows: Array<any>}>}
   */
  App.groupDbRows = function groupDbRows(rows) {
    const groupBy = App.state.dbGroupBy || '';
    if (!groupBy) return [];

    /** @type {Map<string, {key: string, label: string, order: number, rows: any[]}>} */
    const map = new Map();

    function pushTo(key, label, order, row) {
      let g = map.get(key);
      if (!g) {
        g = { key, label, order, rows: [] };
        map.set(key, g);
      }
      g.rows.push(row);
    }

    for (const r of rows) {
      if (groupBy === 'tag') {
        // A row with multiple tags appears under each tag bucket.
        const tags = App.splitTags(r.tags);
        if (tags.length === 0) {
          pushTo('tag:__none__', App.t('database.group_no_tags'), 1e9, r);
        } else {
          for (const t of tags) pushTo('tag:' + t.toLowerCase(), t, 0, r);
        }
      } else if (groupBy === 'conf') {
        const b = confBucket(r.confidence);
        pushTo(b.key, b.label, b.order, r);
      } else if (groupBy === 'day') {
        const b = dayKey(r.created_at);
        pushTo(b.key, b.label, b.order, r);
      } else {
        const field =
          groupBy === 'brand'
            ? r.brand
            : groupBy === 'model'
              ? r.model
              : groupBy === 'ecu_type'
                ? r.ecu_type
                : groupBy === 'kind'
                  ? r.kind
                  : '';
        const label =
          field == null || String(field).trim() === ''
            ? App.t('dashboard.unknown_bucket')
            : String(field);
        pushTo(groupBy + ':' + label.toLowerCase(), label, 0, r);
      }
    }

    const groups = Array.from(map.values());
    // Stable sort: by `order` first, then label A→Z. "Unknown" / __none__ buckets
    // get a high order so they sink to the bottom (less noisy first impression).
    groups.sort((a, b) => {
      if (a.order !== b.order) return a.order - b.order;
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    });
    return groups;
  };

  App.isDbGroupCollapsed = function isDbGroupCollapsed(key) {
    return App.state.dbCollapsedGroups.has(key);
  };

  App.toggleDbGroupCollapsed = function toggleDbGroupCollapsed(key) {
    const set = App.state.dbCollapsedGroups;
    if (set.has(key)) set.delete(key);
    else set.add(key);
  };

  App.ensureDbGroupBySelectWired = function ensureDbGroupBySelectWired() {
    if (App._dbGroupBySelectWired) return;
    App._dbGroupBySelectWired = true;
    const sel = App.$('#db-group-by');
    if (!sel) return;
    sel.addEventListener('change', () => {
      App.state.dbGroupBy = sel.value || '';
      App.saveDbGroupBy(App.state.dbGroupBy);
      // Reset collapsed state — group keys change when the dimension changes,
      // so old collapsed keys would be orphaned anyway.
      App.state.dbCollapsedGroups.clear();
      App.refreshDatabase();
    });
  };

  App.syncDbGroupBySelect = function syncDbGroupBySelect() {
    const sel = App.$('#db-group-by');
    if (sel) sel.value = App.state.dbGroupBy || '';
  };

  /**
   * Build a section header DOM that spans the table or grid host. Used by
   * both the table renderer (rendered as a special <tr>) and the grid
   * renderer (rendered as a full-width section break).
   */
  App.buildDbGroupHeader = function buildDbGroupHeader(group, opts) {
    opts = opts || {};
    const collapsed = App.isDbGroupCollapsed(group.key);
    const wrap = document.createElement('div');
    wrap.className = 'db-group-header' + (collapsed ? ' collapsed' : '');
    wrap.dataset.groupKey = group.key;
    wrap.innerHTML = `
      <span class="db-group-toggle" aria-hidden="true">${collapsed ? '▶' : '▼'}</span>
      <span class="db-group-label">${App.escapeHtml(group.label)}</span>
      <span class="db-group-count">${group.rows.length}</span>
    `;
    wrap.addEventListener('click', () => {
      App.toggleDbGroupCollapsed(group.key);
      if (typeof opts.onToggle === 'function') opts.onToggle();
      else App.refreshDatabase();
    });
    return wrap;
  };
})();
