/* ===== Command palette =====
 * Ctrl+K / Cmd+K. Fuzzy-searchable list of actions, views, recent files, smart
 * folders, tags, and settings shortcuts. Recently used commands persist in
 * localStorage as `App.cmdRecent`.
 *
 * Public API:
 *   App.cmdPalette.register({ id, section, title, subtitle?, icon?, shortcut?, run() })
 *   App.cmdPalette.open()       — show the palette
 *   App.cmdPalette.close()
 *   App.cmdPalette.toggle()
 *
 * Sections are surfaced in this order: Actions, Views, Recent Files, Smart
 * Folders, Tags, Settings. Each section is capped at 5 visible rows when the
 * input is empty (so the panel stays compact). Typing filters across every
 * section; arrow keys / Enter operate on the visible (filtered) list.
 */
window.App = window.App || {};

(function () {
  const App = window.App;
  const STORAGE_KEY = 'App.cmdRecent';
  const SECTION_CAP_EMPTY = 5;
  const RESULT_HARD_CAP = 80; // never render more than this regardless of filter

  /** Static commands registered up-front. Dynamic ones (recent files, smart
   * folders, tags) are computed every time the palette opens. */
  const staticCommands = [];

  /** Section order is fixed by code-stable IDs; labels resolve via App.t. */
  const SECTION_IDS = ['Actions', 'Views', 'Recent Files', 'Smart Folders', 'Tags', 'Settings'];
  /** Map section-ID → i18n key. Unknown sections fall back to their raw ID. */
  const SECTION_LABEL_KEYS = {
    Actions: 'command_palette.section_actions',
    Views: 'command_palette.section_views',
    'Recent Files': 'command_palette.section_recent',
    'Smart Folders': 'command_palette.section_smart',
    Tags: 'command_palette.section_tags',
    Settings: 'command_palette.section_settings',
    Recent: 'command_palette.section_recent_short'
  };
  function sectionLabel(secId) {
    const App = window.App;
    const key = SECTION_LABEL_KEYS[secId];
    return key && App && App.t ? App.t(key) : secId;
  }
  /** Internally we still group by stable section IDs; the label-translation
   * happens only at render time. */
  const SECTION_ORDER = SECTION_IDS;

  let overlay = null;
  let inputEl = null;
  let resultsEl = null;
  let lastResults = []; // currently-rendered command list, in display order
  let activeIdx = 0;
  let isOpen = false;

  /* ---------- registration ---------- */

  App.cmdPalette = App.cmdPalette || {};

  App.cmdPalette.register = function registerCommand(cmd) {
    if (!cmd || !cmd.id || typeof cmd.run !== 'function') return;
    // Replace existing registration with the same id so re-init is idempotent.
    const idx = staticCommands.findIndex((c) => c.id === cmd.id);
    if (idx >= 0) staticCommands[idx] = cmd;
    else staticCommands.push(cmd);
  };

  /* ---------- recents (localStorage) ---------- */

  function loadRecents() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr.slice(0, 10) : [];
    } catch {
      return [];
    }
  }

  function pushRecent(id) {
    try {
      const list = loadRecents().filter((x) => x !== id);
      list.unshift(id);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(list.slice(0, 10)));
    } catch {
      /* ignore */
    }
  }

  /* ---------- dynamic command builders ---------- */

  async function buildRecentFiles() {
    if (!window.api || typeof window.api.listFiles !== 'function') return [];
    let rows = [];
    try {
      rows = (await window.api.listFiles({})) || [];
    } catch {
      return [];
    }
    // Sort by created_at desc and slice to 10.
    rows.sort((a, b) => (b.created_at || 0) - (a.created_at || 0));
    return rows.slice(0, 10).map((r) => ({
      id: `recent.file.${r.id}`,
      section: 'Recent Files',
      title: r.new_name || App.t('command_palette.recent_file_fallback', { id: r.id }),
      subtitle:
        [r.brand, r.model, r.ecu_type].filter(Boolean).join(' · ') ||
        (r.archive_path ? r.archive_path : ''),
      icon: '📄',
      run: () => {
        App.switchView('database');
        if (typeof App.openDbDetailPanel === 'function') {
          setTimeout(() => App.openDbDetailPanel(r.id), 100);
        }
      }
    }));
  }

  async function buildSmartFolderCommands() {
    if (!window.api || typeof window.api.listSmartFolders !== 'function') return [];
    let folders = [];
    try {
      folders = (await window.api.listSmartFolders()) || [];
    } catch {
      return [];
    }
    return folders.slice(0, 10).map((f) => ({
      id: `smart.folder.${f.id}`,
      section: 'Smart Folders',
      title: f.name || App.t('command_palette.smart_folder_fallback', { id: f.id }),
      subtitle: App.t('command_palette.smart_folder_sub'),
      icon: '★',
      run: () => {
        if (typeof App.applySmartFolder === 'function') App.applySmartFolder(f);
        else App.switchView('database');
      }
    }));
  }

  function buildTagCommands() {
    // Use the cached tag list from SearchParser (kept in sync with the DB).
    const cache = App.SearchParser && App.SearchParser._cache;
    const tags = cache && Array.isArray(cache.tags) ? cache.tags : [];
    return tags.slice(0, 20).map((t) => ({
      id: `tag.filter.${t}`,
      section: 'Tags',
      title: App.t('command_palette.tag_filter_title', { tag: t }),
      subtitle: App.t('command_palette.tag_filter_sub'),
      icon: '#',
      run: () => {
        App.switchView('database');
        if (typeof App.setSearchQuery === 'function') {
          App.setSearchQuery(`tag:${/\s/.test(t) ? `"${t}"` : t}`);
        }
      }
    }));
  }

  /* ---------- fuzzy filter ---------- */

  function rank(item, q) {
    if (!q) return 0;
    const haystack = `${item.title} ${item.subtitle || ''} ${item.section}`.toLowerCase();
    const needle = q.toLowerCase();
    const titleLc = String(item.title).toLowerCase();

    // Strict substring filter first.
    if (!haystack.includes(needle)) return -1;

    let score = 0;
    if (titleLc.startsWith(needle)) score += 100;
    else if (titleLc.includes(needle)) score += 50;
    // Token start-of-word bonus.
    const tokens = titleLc.split(/[\s.\-_/:]+/);
    for (const tok of tokens) {
      if (tok.startsWith(needle)) {
        score += 30;
        break;
      }
    }
    return score;
  }

  /* ---------- render ---------- */

  function groupBySection(items) {
    const groups = new Map();
    for (const it of items) {
      const sec = it.section || 'Other';
      if (!groups.has(sec)) groups.set(sec, []);
      groups.get(sec).push(it);
    }
    const ordered = [];
    for (const sec of SECTION_ORDER) {
      if (groups.has(sec)) ordered.push([sec, groups.get(sec)]);
    }
    // Any unknown section comes last.
    for (const [sec, arr] of groups) {
      if (!SECTION_ORDER.includes(sec)) ordered.push([sec, arr]);
    }
    return ordered;
  }

  function renderResults(query) {
    const recentIds = loadRecents();
    // Build the merged candidate list.
    let candidates = staticCommands.slice();
    candidates = candidates.concat(App._cmdPaletteDynamic || []);

    let display;
    if (!query) {
      // Empty input: show recent first (resolved by id), then capped sections.
      const byId = new Map(candidates.map((c) => [c.id, c]));
      const recents = recentIds.map((id) => byId.get(id)).filter(Boolean);
      const rest = candidates.filter((c) => !recentIds.includes(c.id));
      const grouped = groupBySection(rest);
      display = [];
      if (recents.length > 0) {
        // 'Recent' is an internal section ID; rendered label is translated.
        for (const r of recents) display.push({ ...r, _section: 'Recent' });
      }
      for (const [, list] of grouped) {
        for (const it of list.slice(0, SECTION_CAP_EMPTY)) display.push(it);
      }
    } else {
      const ranked = candidates
        .map((c) => ({ c, s: rank(c, query) }))
        .filter((x) => x.s >= 0)
        .sort((a, b) => b.s - a.s);
      display = ranked.slice(0, RESULT_HARD_CAP).map((x) => x.c);
    }

    lastResults = display;
    activeIdx = display.length > 0 ? 0 : -1;

    resultsEl.innerHTML = '';
    if (display.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cmd-palette-empty';
      empty.textContent = App.t('command_palette.empty');
      resultsEl.appendChild(empty);
      return;
    }

    // Render with section dividers. When the user is typing we still group
    // by section so the visual context is preserved.
    let prevSec = null;
    display.forEach((it, i) => {
      const sec = it._section || it.section || 'Other';
      if (sec !== prevSec) {
        const h = document.createElement('div');
        h.className = 'cmd-palette-section';
        h.textContent = sectionLabel(sec);
        resultsEl.appendChild(h);
        prevSec = sec;
      }
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'cmd-palette-item' + (i === activeIdx ? ' is-active' : '');
      row.dataset.cmdIndex = String(i);

      const iconWrap = document.createElement('span');
      iconWrap.className = 'cmd-palette-icon';
      iconWrap.innerHTML = it.icon ? it.icon : '<span class="cmd-palette-dot">›</span>';
      row.appendChild(iconWrap);

      const text = document.createElement('span');
      text.className = 'cmd-palette-text';
      const title = document.createElement('span');
      title.className = 'cmd-palette-title';
      title.textContent = it.title;
      text.appendChild(title);
      if (it.subtitle) {
        const sub = document.createElement('span');
        sub.className = 'cmd-palette-subtitle';
        sub.textContent = it.subtitle;
        text.appendChild(sub);
      }
      row.appendChild(text);

      if (it.shortcut) {
        const sc = document.createElement('kbd');
        sc.className = 'cmd-palette-shortcut';
        sc.textContent = it.shortcut;
        row.appendChild(sc);
      }

      row.addEventListener('mouseenter', () => {
        activeIdx = i;
        refreshActiveClass();
      });
      row.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        runAt(i);
      });
      resultsEl.appendChild(row);
    });
  }

  function refreshActiveClass() {
    if (!resultsEl) return;
    resultsEl.querySelectorAll('.cmd-palette-item').forEach((el, i) => {
      el.classList.toggle('is-active', i === activeIdx);
    });
    const active = resultsEl.querySelector('.cmd-palette-item.is-active');
    if (active && typeof active.scrollIntoView === 'function') {
      active.scrollIntoView({ block: 'nearest' });
    }
  }

  function runAt(idx) {
    const it = lastResults[idx];
    if (!it) return;
    pushRecent(it.id);
    close();
    try {
      it.run();
    } catch (err) {
      if (App.toast) App.toast.error(App.t('toasts.command_failed', { msg: err.message || err }));
    }
  }

  /* ---------- open / close ---------- */

  // Document-level capture handler so Escape always closes the palette while
  // it's open, even if focus has drifted off the input (a previous spec
  // intermittently failed because Ctrl+K opened the palette but focus didn't
  // make it back to the input before Escape was pressed).
  function onDocEscape(e) {
    if (e.key === 'Escape' && isOpen) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  async function open() {
    if (!overlay) overlay = document.getElementById('cmd-palette-overlay');
    if (!overlay) return;
    inputEl = document.getElementById('cmd-palette-input');
    resultsEl = document.getElementById('cmd-palette-results');
    if (!inputEl || !resultsEl) return;

    // Rebuild dynamic commands on every open so recent files/smart folders are
    // fresh. Static commands are stable across opens.
    const [recentFiles, smartFolders] = await Promise.all([
      buildRecentFiles(),
      buildSmartFolderCommands()
    ]);
    App._cmdPaletteDynamic = [...recentFiles, ...smartFolders, ...buildTagCommands()];

    overlay.hidden = false;
    // Force reflow so the fade-in transition runs.
    void overlay.offsetWidth;
    overlay.classList.add('is-visible');
    isOpen = true;
    inputEl.value = '';
    renderResults('');
    document.addEventListener('keydown', onDocEscape, true);
    setTimeout(() => inputEl.focus(), 20);
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('is-visible');
    isOpen = false;
    document.removeEventListener('keydown', onDocEscape, true);
    setTimeout(() => {
      overlay.hidden = true;
    }, 160);
  }

  App.cmdPalette.open = open;
  App.cmdPalette.close = close;
  App.cmdPalette.toggle = function toggle() {
    if (isOpen) close();
    else open();
  };

  /* ---------- input handling ---------- */

  function onInput() {
    renderResults(inputEl.value.trim());
  }

  function onKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (lastResults.length === 0) return;
      activeIdx = (activeIdx + 1) % lastResults.length;
      refreshActiveClass();
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (lastResults.length === 0) return;
      activeIdx = (activeIdx - 1 + lastResults.length) % lastResults.length;
      refreshActiveClass();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      runAt(activeIdx);
    }
  }

  /* ---------- baked-in command registry ---------- */

  function registerBuiltins() {
    const register = App.cmdPalette.register;
    const T = (k, p) => App.t(k, p);

    // Navigation
    const views = [
      ['dashboard', 'sidebar.dashboard'],
      ['skinner', 'sidebar.file_skinner'],
      ['database', 'sidebar.database'],
      ['tag-management', 'sidebar.tags'],
      ['duplicates', 'sidebar.duplicates'],
      ['checksum', 'sidebar.checksum'],
      ['compare', 'sidebar.compare'],
      ['settings', 'sidebar.settings']
    ];
    for (const [key, lblKey] of views) {
      register({
        id: `view.${key}`,
        section: 'Views',
        title: T('command_palette.go_to_prefix', { label: T(lblKey) }),
        icon: '→',
        run: () => App.switchView(key)
      });
    }

    // Core actions
    register({
      id: 'action.compare-two-files',
      section: 'Actions',
      title: T('command_palette.action_compare_title'),
      subtitle: T('command_palette.action_compare_sub'),
      icon: '↔',
      run: () => App.switchView('compare')
    });
    register({
      id: 'action.organize-all',
      section: 'Actions',
      title: T('command_palette.action_organize_title'),
      subtitle: T('command_palette.action_organize_sub'),
      icon: '✓',
      run: () => {
        App.switchView('skinner');
        if (typeof App.organizeAll === 'function') App.organizeAll();
      }
    });
    register({
      id: 'action.scan-files',
      section: 'Actions',
      title: T('command_palette.action_scan_title'),
      subtitle: T('command_palette.action_scan_sub'),
      icon: '🔍',
      run: async () => {
        App.switchView('skinner');
        const paths = await window.api.selectFiles();
        if (paths && paths.length > 0 && typeof App.ingestFiles === 'function') {
          await App.ingestFiles(paths);
        }
      }
    });
    register({
      id: 'action.refresh-database',
      section: 'Actions',
      title: T('command_palette.action_refresh_db'),
      icon: '↻',
      run: () => {
        if (typeof App.refreshDatabase === 'function') App.refreshDatabase();
        App.switchView('database');
      }
    });
    register({
      id: 'action.export-db',
      section: 'Actions',
      title: T('command_palette.action_export_db_title'),
      subtitle: T('command_palette.action_export_db_sub'),
      icon: '⤓',
      run: async () => {
        try {
          const res = await window.api.exportDatabase();
          if (res && res.success) {
            if (App.toast) App.toast.success(T('command_palette.db_exported', { path: res.path }));
          } else if (App.toast) {
            App.toast.error(
              T('command_palette.db_export_failed', { msg: (res && res.error) || 'unknown' })
            );
          }
        } catch (err) {
          if (App.toast)
            App.toast.error(T('command_palette.db_export_failed', { msg: err.message || err }));
        }
      }
    });
    register({
      id: 'action.import-db-append',
      section: 'Actions',
      title: T('command_palette.action_import_db_title'),
      subtitle: T('command_palette.action_import_db_sub'),
      icon: '⤒',
      run: async () => {
        try {
          const res = await window.api.importDatabase('append');
          if (res && res.success && App.toast) {
            App.toast.success(T('command_palette.imported_ok', { n: res.inserted || 0 }));
            if (typeof App.refreshDatabase === 'function') App.refreshDatabase();
          } else if (res && res.error && App.toast) {
            App.toast.error(T('command_palette.db_import_failed', { msg: res.error }));
          }
        } catch (err) {
          if (App.toast)
            App.toast.error(T('command_palette.db_import_failed', { msg: err.message || err }));
        }
      }
    });
    register({
      id: 'action.open-archive',
      section: 'Actions',
      title: T('command_palette.action_open_archive_title'),
      subtitle: T('command_palette.action_open_archive_sub'),
      icon: '📂',
      run: () => {
        if (App.state.archiveRoot) window.api.openFolder(App.state.archiveRoot);
        else if (App.toast) App.toast.warn(T('toasts.no_archive_root_set'));
      }
    });
    register({
      id: 'action.find-duplicates',
      section: 'Actions',
      title: T('command_palette.action_find_duplicates_title'),
      subtitle: T('command_palette.action_find_duplicates_sub'),
      icon: '⎘',
      run: () => {
        App.switchView('duplicates');
        if (typeof App.refreshDuplicates === 'function') App.refreshDuplicates('exact');
      }
    });
    register({
      id: 'action.new-smart-folder',
      section: 'Actions',
      title: T('command_palette.action_save_smart_folder'),
      icon: '★',
      run: () => {
        App.switchView('database');
        const btn = document.getElementById('db-save-smart-folder');
        if (btn) setTimeout(() => btn.click(), 50);
      }
    });

    // Settings shortcuts
    register({
      id: 'settings.archive-root',
      section: 'Settings',
      title: T('command_palette.settings_archive_root'),
      icon: '⚙',
      run: () => {
        App.switchView('settings');
        setTimeout(() => {
          const el = document.getElementById('archive-root');
          if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
        }, 80);
      }
    });
    register({
      id: 'settings.format-mask',
      section: 'Settings',
      title: T('command_palette.settings_format_mask'),
      icon: '⚙',
      run: () => {
        App.switchView('settings');
        setTimeout(() => {
          const el = document.getElementById('default-mask');
          if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
          if (el) el.focus();
        }, 80);
      }
    });
    register({
      id: 'settings.auto-organize',
      section: 'Settings',
      title: T('command_palette.settings_auto_organize'),
      icon: '⚙',
      run: () => {
        App.switchView('settings');
        setTimeout(() => {
          const el = document.getElementById('auto-organize-threshold');
          if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' });
          if (el) el.focus();
        }, 80);
      }
    });
    register({
      id: 'settings.app-updates',
      section: 'Settings',
      title: T('command_palette.settings_app_updates'),
      icon: '⚙',
      run: async () => {
        App.switchView('settings');
        setTimeout(() => {
          const btn = document.getElementById('app-update-check');
          if (btn) btn.click();
        }, 80);
      }
    });
    register({
      id: 'settings.data-updates',
      section: 'Settings',
      title: T('command_palette.settings_data_updates'),
      icon: '⚙',
      run: () => {
        App.switchView('settings');
        setTimeout(() => {
          const btn = document.getElementById('data-check-now');
          if (btn) btn.click();
        }, 80);
      }
    });
  }

  /* ---------- bootstrap ---------- */

  App.setupCommandPalette = function setupCommandPalette() {
    overlay = document.getElementById('cmd-palette-overlay');
    if (!overlay) return;
    inputEl = document.getElementById('cmd-palette-input');
    resultsEl = document.getElementById('cmd-palette-results');

    registerBuiltins();

    if (inputEl) {
      inputEl.addEventListener('input', onInput);
      inputEl.addEventListener('keydown', onKeydown);
    }
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close();
    });
  };
})();
