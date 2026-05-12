/* ===== App bootstrap =====
 * Wires every view together. Loaded last so all App.* methods exist.
 */
(function () {
  const App = window.App;

  /**
   * Register every context-menu attach point in one place so we can reuse the
   * same row builders for both the database table and grid. Each builder
   * returns an array of items (or empty to suppress the menu).
   */
  function registerContextMenus() {
    if (!App.contextMenu) return;

    // ---- file rows (table + grid) ----
    const fileRowBuilder = (event, target) => {
      const idAttr = target.dataset.id || target.dataset.fileId;
      const id = parseInt(idAttr || '', 10);
      if (Number.isNaN(id)) return [];
      const rows = App._dbAllRowsCache || [];
      const row = rows.find((r) => r.id === id);
      if (!row) return [];

      const items = [
        {
          label: App.t('context_menu.open_folder'),
          icon: '📂',
          run: () => {
            if (!row.archive_path) {
              if (App.toast) App.toast.warn(App.t('toasts.no_archive_path'));
              return;
            }
            const idx = Math.max(
              row.archive_path.lastIndexOf('/'),
              row.archive_path.lastIndexOf('\\')
            );
            const dir = idx > 0 ? row.archive_path.slice(0, idx) : row.archive_path;
            window.api.openFolder(dir);
          }
        },
        {
          label: App.t('context_menu.copy_md5'),
          icon: '⧉',
          disabled: !row.md5,
          run: () => {
            try {
              navigator.clipboard.writeText(row.md5 || '');
              if (App.toast) App.toast.success(App.t('toasts.md5_copied'));
            } catch {
              if (App.toast) App.toast.error(App.t('toasts.clipboard_write_failed'));
            }
          }
        },
        {
          label: App.t('context_menu.compare_with'),
          icon: '↔',
          run: async () => {
            await App.sendToComparator(row.id, null);
          }
        },
        {
          label: App.t('context_menu.find_similar'),
          icon: '◇',
          disabled: !row.tlsh,
          run: async () => {
            if (!row.tlsh) return;
            try {
              const matches = (await window.api.findSimilarTlsh(row.tlsh, 30)) || [];
              if (App.toast) {
                const key =
                  matches.length === 1 ? 'toasts.tlsh_similar_one' : 'toasts.tlsh_similar_many';
                App.toast.info(App.t(key, { n: matches.length }));
              }
              App.switchView('duplicates');
              if (typeof App.refreshDuplicates === 'function') App.refreshDuplicates('similar');
            } catch (err) {
              if (App.toast)
                App.toast.error(App.t('toasts.tlsh_search_failed', { msg: err.message || err }));
            }
          }
        },
        { separator: true },
        {
          label: App.t('context_menu.add_tag'),
          icon: '🏷',
          run: () => {
            App.switchView('database');
            // Programmatically select the row so the bulk-action bar appears.
            App.state.selectedIds = new Set([row.id]);
            if (typeof App.refreshDatabase === 'function') App.refreshDatabase();
            setTimeout(() => {
              const btn = document.getElementById('db-bulk-add-tag');
              if (btn) btn.click();
            }, 120);
          }
        },
        {
          label:
            row.kind === 'original'
              ? App.t('context_menu.convert_to_solution')
              : App.t('context_menu.convert_to_original'),
          icon: '↺',
          run: async () => {
            const newKind = row.kind === 'original' ? 'solution' : 'original';
            try {
              const res = await window.api.convertKind(row.id, newKind, null);
              if (res && res.error) {
                if (App.toast) App.toast.error(App.t('toasts.convert_failed', { msg: res.error }));
              } else if (App.toast) {
                App.toast.success(App.t('toasts.converted_to_kind', { kind: newKind }));
              }
              if (typeof App.refreshDatabase === 'function') await App.refreshDatabase();
            } catch (err) {
              if (App.toast)
                App.toast.error(App.t('toasts.convert_failed', { msg: err.message || err }));
            }
          }
        },
        { separator: true },
        {
          label: App.t('context_menu.delete_from_index'),
          icon: '✕',
          destructive: true,
          run: async () => {
            const ok = await App.appModal({
              title: App.t('modal.delete_db_title'),
              body: App.t('modal.delete_db_body_html', {
                name: App.escapeHtml(row.new_name || '#' + row.id)
              }),
              variant: 'destructive',
              buttons: [
                { label: App.t('modal.cancel'), value: false },
                { label: App.t('modal.delete'), value: true, destructive: true }
              ]
            });
            if (!ok) return;
            await window.api.deleteFile(row.id);
            if (App.toast) App.toast.success(App.t('toasts.removed_from_index', { id: row.id }));
            if (typeof App.refreshDatabase === 'function') await App.refreshDatabase();
          }
        }
      ];
      return items;
    };

    App.contextMenu.attach('.data-table tbody tr[data-id]', fileRowBuilder);
    App.contextMenu.attach('.db-grid-card[data-id]', fileRowBuilder);

    // ---- sidebar smart folders ----
    App.contextMenu.attach('.smart-folder-item', (event, target) => {
      const id = parseInt(target.dataset.id || '', 10);
      if (Number.isNaN(id)) return [];
      return [
        {
          label: App.t('context_menu.open'),
          icon: '★',
          run: () => {
            const btn = target.querySelector('.smart-folder-name') || target;
            btn.click();
          }
        },
        {
          label: App.t('context_menu.delete'),
          icon: '✕',
          destructive: true,
          run: () => {
            const del = target.querySelector('.smart-folder-delete');
            if (del) del.click();
          }
        }
      ];
    });

    // ---- skinner drop zone ----
    App.contextMenu.attach('#drop-zone', () => [
      {
        label: App.t('context_menu.paste_path'),
        icon: '⤵',
        run: async () => {
          try {
            const text = await navigator.clipboard.readText();
            if (!text) {
              if (App.toast) App.toast.warn(App.t('toasts.clipboard_empty'));
              return;
            }
            const paths = text.split(/\r?\n/).filter(Boolean);
            if (paths.length === 0) return;
            if (typeof App.ingestFiles === 'function') await App.ingestFiles(paths);
          } catch {
            if (App.toast) App.toast.error(App.t('toasts.clipboard_read_failed'));
          }
        }
      },
      {
        label: App.t('context_menu.choose_from_disk'),
        icon: '📁',
        run: async () => {
          const paths = await window.api.selectFiles();
          if (paths && paths.length > 0 && typeof App.ingestFiles === 'function') {
            await App.ingestFiles(paths);
          }
        }
      }
    ]);
  }

  async function init() {
    // Load the English catalog FIRST so any setup() call that touches
    // App.t() during wiring has a real catalog to read from. We swap to the
    // user's chosen locale right after loadSettings() resolves below.
    if (App.i18n && typeof App.i18n.setLocale === 'function') {
      try {
        await App.i18n.setLocale('en');
      } catch (_e) {
        /* non-fatal — translation falls back to the raw key */
      }
    }

    // Init UI infrastructure first so views can call toast/cmdPalette safely.
    if (typeof App.setupToasts === 'function') App.setupToasts();
    if (typeof App.setupContextMenu === 'function') App.setupContextMenu();
    if (typeof App.setupCommandPalette === 'function') App.setupCommandPalette();
    if (typeof App.setupGlobalDrop === 'function') App.setupGlobalDrop();

    App.setupNavigation();
    App.setupDropZone();
    App.setupMetadataEditing();
    App.setupTagsAndNotes();
    App.setupKindControls();
    App.setupFormatMask();
    App.setupSkinnerButtons();
    App.setupChecksumTool();
    App.setupComparator();
    App.setupSettings();
    App.setupSearch();
    if (typeof App.setupIntegrityCheck === 'function') App.setupIntegrityCheck();
    if (typeof App.setupSmartFolders === 'function') App.setupSmartFolders();
    if (typeof App.setupDuplicatesView === 'function') App.setupDuplicatesView();
    if (typeof App.setupTagManagement === 'function') App.setupTagManagement();

    registerContextMenus();

    await App.loadSettings();
    await App.loadArchiveRoot();
    if (typeof App.loadSmartFolders === 'function') await App.loadSmartFolders();
    if (typeof App.loadTagMeta === 'function') await App.loadTagMeta();

    // Persisted locale (Phase 2 will ship fr.json). Apply after loadSettings so
    // the DB read has had a chance to populate state.settings.ui_locale.
    const persistedLocale = (App.state.settings && App.state.settings.ui_locale) || 'en';
    if (persistedLocale && persistedLocale !== 'en' && App.i18n) {
      try {
        await App.i18n.setLocale(persistedLocale);
      } catch (_e) {
        /* fall back silently to English */
      }
    }
    // Sync the Settings dropdown if it exists in the DOM.
    const localeSelect = document.getElementById('locale-select');
    if (localeSelect) localeSelect.value = App.i18n ? App.i18n.getLocale() : 'en';

    App.renderMetadata();
    // Re-apply DOM translations once everything is wired, in case any setup()
    // call replaced a node that carries a data-i18n attribute.
    if (App.i18n && typeof App.i18n.applyDom === 'function') App.i18n.applyDom();
    App.logLine('info', App.t('app.ready'));

    window.addEventListener('error', (e) => {
      App.logLine(
        'err',
        App.t('log.js_error', { msg: e.message, file: e.filename, line: e.lineno })
      );
      if (App.toast) App.toast.error(`JS error: ${e.message}`);
    });
    window.addEventListener('unhandledrejection', (e) => {
      App.logLine('err', App.t('log.unhandled_promise', { msg: e.reason?.message || e.reason }));
      if (App.toast) App.toast.error(`Unhandled error: ${e.reason?.message || e.reason}`);
    });
  }

  window.addEventListener('DOMContentLoaded', init);
})();
