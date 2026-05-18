/* ===== Settings view =====
 * Persisted preferences (mask, auto-organize, online VIN, data auto-update),
 * archive root, DB export/import, plus the global search box that delegates
 * into the database view.
 */
window.App = window.App || {};

(function () {
  const App = window.App;

  App.loadSettings = async function loadSettings() {
    const $ = App.$;
    const state = App.state;
    const s = await window.api.getSettings();
    state.settings = { ...state.settings, ...s };
    if ($('#default-mask'))
      $('#default-mask').value = state.settings.default_mask || '[BRAND]_[MODEL]_[HW]_[STAGE].bin';
    if ($('#format-mask'))
      $('#format-mask').value = state.settings.default_mask || '[BRAND]_[MODEL]_[HW]_[STAGE].bin';
    if ($('#auto-organize-enabled'))
      $('#auto-organize-enabled').checked = state.settings.auto_organize_enabled === '1';
    if ($('#auto-organize-threshold'))
      $('#auto-organize-threshold').value = state.settings.auto_organize_threshold || '85';
    if ($('#online-vin-lookup'))
      $('#online-vin-lookup').checked = state.settings.online_vin_lookup === '1';
    App.updateMaskPreview();
  };

  App.loadArchiveRoot = async function loadArchiveRoot() {
    App.state.archiveRoot = await window.api.getArchiveRoot();
    const el = App.$('#archive-root');
    if (el) el.value = App.state.archiveRoot;
  };

  App.setupSettings = function setupSettings() {
    const $ = App.$;
    const state = App.state;

    $('#default-mask').addEventListener('change', async () => {
      const v = $('#default-mask').value;
      state.settings.default_mask = v;
      await window.api.setSetting('default_mask', v);
      $('#format-mask').value = v;
      App.updateMaskPreview();
      App.logLine('ok', App.t('log.default_mask_saved'));
    });

    $('#auto-organize-enabled').addEventListener('change', async () => {
      const v = $('#auto-organize-enabled').checked ? '1' : '0';
      state.settings.auto_organize_enabled = v;
      await window.api.setSetting('auto_organize_enabled', v);
      App.logLine(
        'info',
        v === '1' ? App.t('log.auto_organize_enabled') : App.t('log.auto_organize_disabled')
      );
    });

    $('#auto-organize-threshold').addEventListener('change', async () => {
      const v = String(parseInt($('#auto-organize-threshold').value, 10) || 85);
      state.settings.auto_organize_threshold = v;
      await window.api.setSetting('auto_organize_threshold', v);
      App.logLine('info', App.t('log.auto_organize_threshold_set', { th: v }));
    });

    $('#online-vin-lookup').addEventListener('change', async () => {
      const v = $('#online-vin-lookup').checked ? '1' : '0';
      state.settings.online_vin_lookup = v;
      await window.api.setSetting('online_vin_lookup', v);
      App.logLine(
        'info',
        v === '1' ? App.t('log.online_vin_enabled') : App.t('log.online_vin_disabled')
      );
    });

    // Language selector (i18n). Persists `ui_locale` and applies immediately.
    const localeSel = $('#locale-select');
    if (localeSel) {
      if (App.i18n) localeSel.value = App.i18n.getLocale();
      localeSel.addEventListener('change', async () => {
        const v = localeSel.value || 'en';
        if (App.i18n) await App.i18n.setLocale(v);
        try {
          await window.api.setSetting('ui_locale', v);
        } catch (_e) {
          /* ignore — locale change still applied in-memory */
        }
        state.settings.ui_locale = v;
        App.logLine('info', App.t('log.locale_set', { code: v }));
      });
    }

    if ($('#data-auto-update')) {
      $('#data-auto-update').checked = state.settings.data_auto_update === '1';
      $('#data-auto-update').addEventListener('change', async () => {
        const v = $('#data-auto-update').checked ? '1' : '0';
        state.settings.data_auto_update = v;
        await window.api.setSetting('data_auto_update', v);
        App.logLine(
          'info',
          v === '1' ? App.t('log.data_auto_enabled') : App.t('log.data_auto_disabled')
        );
      });
    }
    if ($('#data-update-url')) {
      $('#data-update-url').value = state.settings.data_update_manifest_url || '';
      $('#data-update-url').addEventListener('change', async () => {
        const v = $('#data-update-url').value.trim();
        state.settings.data_update_manifest_url = v;
        await window.api.setSetting('data_update_manifest_url', v);
        App.logLine('info', App.t('log.data_url_saved'));
      });
    }
    $('#data-check-now')?.addEventListener('click', async () => {
      $('#data-update-status').textContent = App.t('settings.data_checking');
      const r = await window.api.checkDataUpdates();
      if (r.error)
        $('#data-update-status').textContent = App.t('settings.data_check_error', { msg: r.error });
      else if (r.skipped)
        $('#data-update-status').textContent = App.t('settings.data_check_skipped', {
          reason: r.skipped
        });
      else {
        const applied = r.applied ? ' ' + r.applied.join(', ') : '';
        const tk =
          (r.updated || 0) === 1
            ? 'settings.data_check_result_one'
            : 'settings.data_check_result_many';
        $('#data-update-status').textContent = App.t(tk, { n: r.updated || 0, applied });
      }
    });
    if ($('#data-manifest-info')) {
      window.api.localManifest().then((m) => {
        if (!m) return;
        const fileCount = Object.keys(m.files || {}).length;
        $('#data-manifest-info').textContent = App.t('settings.data_manifest_info', {
          ver: m.manifest_version,
          n: fileCount,
          date: m.generated_at || '?'
        });
      });
    }

    // App self-update wiring
    const verEl = $('#app-version');
    if (verEl) {
      window.api.appUpdateVersion().then((v) => {
        verEl.textContent = 'v' + v;
      });
    }

    const statusEl = $('#app-update-status');
    const actionsRow = $('#app-update-actions');
    const dlBtn = $('#app-update-download');
    const installBtn = $('#app-update-install');

    $('#app-update-check')?.addEventListener('click', async () => {
      if (statusEl) statusEl.textContent = App.t('settings.update_checking');
      const r = await window.api.appUpdateCheck();
      if (!r.ok && statusEl)
        statusEl.textContent = App.t('settings.update_check_failed', { msg: r.error || 'unknown' });
    });

    dlBtn?.addEventListener('click', async () => {
      if (statusEl) statusEl.textContent = App.t('settings.update_progress', { pct: 0 });
      await window.api.appUpdateDownload();
    });

    installBtn?.addEventListener('click', async () => {
      await window.api.appUpdateInstall();
    });

    if (window.api.appUpdateOnEvent) {
      window.api.appUpdateOnEvent((evt) => {
        if (!statusEl) return;
        if (evt.event === 'checking') statusEl.textContent = App.t('settings.update_checking');
        else if (evt.event === 'not-available')
          statusEl.textContent = App.t('settings.update_uptodate');
        else if (evt.event === 'available') {
          statusEl.textContent = App.t('settings.update_available', {
            ver: evt.payload?.version || '?'
          });
          if (actionsRow) actionsRow.hidden = false;
          if (dlBtn) dlBtn.hidden = false;
        } else if (evt.event === 'progress') {
          statusEl.textContent = App.t('settings.update_progress', {
            pct: (evt.payload?.percent || 0).toFixed(0)
          });
        } else if (evt.event === 'downloaded') {
          statusEl.textContent = App.t('settings.update_downloaded');
          if (dlBtn) dlBtn.hidden = true;
          if (installBtn) installBtn.hidden = false;
        } else if (evt.event === 'error') {
          statusEl.textContent = App.t('settings.update_error', {
            msg: evt.payload?.message || 'unknown'
          });
        }
      });
    }

    $('#db-export').addEventListener('click', async () => {
      const res = await window.api.exportDatabase();
      if (res.canceled) return;
      if (res.success) {
        App.logLine('ok', App.t('log.exported_records', { n: res.count, path: res.path }));
        if (App.toast)
          App.toast.success(App.t('toasts.exported_records', { n: res.count, path: res.path }));
      } else if (res.error) {
        App.logLine('err', App.t('log.export_failed', { err: res.error }));
        if (App.toast) App.toast.error(App.t('toasts.export_failed', { msg: res.error }));
      }
    });

    $('#db-import-append').addEventListener('click', async () => {
      const res = await window.api.importDatabase('append');
      if (res.canceled) return;
      if (res.success) {
        App.logLine('ok', App.t('log.imported_append', { n: res.inserted }));
        if (App.toast) App.toast.success(App.t('toasts.imported_records', { n: res.inserted }));
        App.refreshDatabase();
      } else {
        App.logLine('err', App.t('log.import_failed', { err: res.error || 'unknown' }));
        if (App.toast)
          App.toast.error(App.t('toasts.import_failed', { msg: res.error || 'unknown' }));
      }
    });

    $('#db-import-replace').addEventListener('click', async () => {
      const ok = await App.appModal({
        title: App.t('modal.replace_db_title'),
        body: App.t('modal.replace_db_body_html'),
        variant: 'destructive',
        buttons: [
          { label: App.t('modal.cancel'), value: false },
          { label: App.t('modal.replace_all'), value: true, destructive: true }
        ]
      });
      if (!ok) return;
      const res = await window.api.importDatabase('replace');
      if (res.canceled) return;
      if (res.success) {
        App.logLine('ok', App.t('log.imported_replace', { n: res.inserted }));
        if (App.toast) App.toast.success(App.t('toasts.db_replaced', { n: res.inserted }));
        App.refreshDatabase();
      } else {
        App.logLine('err', App.t('log.import_failed', { err: res.error || 'unknown' }));
        if (App.toast)
          App.toast.error(App.t('toasts.import_failed', { msg: res.error || 'unknown' }));
      }
    });
  };

  /* ===== Global search (header) =====
   * Replaced by the Pack A.3 rich search bar in `setupGlobalSearchBar`.
   * Kept here as a no-op so the bootstrap call site stays stable.
   */
  App.setupSearch = function setupSearch() {
    if (typeof App.setupGlobalSearchBar === 'function') {
      App.setupGlobalSearchBar();
    }
  };

  /* ===== Archive Integrity (Settings card) ===== */
  App.setupIntegrityCheck = function setupIntegrityCheck() {
    const $ = App.$;
    const btn = $('#integrity-scan');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const result = $('#integrity-result');
      const list = $('#integrity-missing-list');
      result.textContent = App.t('settings.integrity_scanning');
      list.innerHTML = '';
      try {
        const r = await window.api.scanIntegrity();
        if (r.error) {
          result.textContent = App.t('settings.integrity_error', { msg: r.error });
          return;
        }
        const total = r.total || 0;
        const missing = Array.isArray(r.missing) ? r.missing : [];
        if (missing.length === 0) {
          result.innerHTML = `<span style="color: var(--accent-2)">${App.escapeHtml(App.t('settings.integrity_all_present', { total }))}</span>`;
          return;
        }
        result.innerHTML = `<span style="color: var(--accent-3)">${App.escapeHtml(App.t('settings.integrity_missing_count', { missing: missing.length, total }))}</span>`;
        const escapeHtml = App.escapeHtml;
        const removeLabel = App.t('settings.integrity_remove_button');
        const unnamed = App.t('detail_panel.unnamed');
        const html = missing
          .map(
            (m) => `
              <div class="integrity-row" data-id="${m.id}">
                <div class="integrity-row-info">
                  <div class="integrity-row-name">${escapeHtml(m.new_name || unnamed)}</div>
                  <div class="integrity-row-path">${escapeHtml(m.archive_path || '')}</div>
                </div>
                <button class="btn-secondary small destructive" data-remove="${m.id}" type="button">
                  ${escapeHtml(removeLabel)}
                </button>
              </div>
            `
          )
          .join('');
        list.innerHTML = html;
        list.querySelectorAll('button[data-remove]').forEach((b) => {
          b.addEventListener('click', async () => {
            const id = parseInt(b.dataset.remove, 10);
            const ok = await App.appModal({
              title: App.t('modal.remove_index_title'),
              body: App.t('modal.remove_index_body'),
              variant: 'destructive',
              buttons: [
                { label: App.t('modal.cancel'), value: false },
                { label: App.t('modal.remove_index_button'), value: true, destructive: true }
              ]
            });
            if (!ok) return;
            await window.api.deleteFile(id);
            const row = list.querySelector(`.integrity-row[data-id="${id}"]`);
            if (row) row.remove();
            App.logLine('info', App.t('log.orphan_removed', { id }));
            if (typeof App.refreshDatabase === 'function') App.refreshDatabase();
          });
        });
      } catch (err) {
        result.textContent = App.t('settings.integrity_error', { msg: err.message });
      }
    });
  };

  /* ===== Smart folders sidebar =====
   * Renders the persisted saved-search list in the sidebar and wires the
   * "+ New Smart Folder" button. Clicking a folder switches to the database
   * view and restores the saved {search, brand, ecuType, tag, kind,
   * dbTreeFilter} state.
   */
  App.loadSmartFolders = async function loadSmartFolders() {
    const $ = App.$;
    const escapeHtml = App.escapeHtml;
    const list = $('#smart-folders-list');
    if (!list) return;
    let folders = [];
    try {
      const r = await window.api.listSmartFolders();
      folders = Array.isArray(r) ? r : [];
    } catch (err) {
      App.logLine('err', App.t('log.smart_folder_apply_failed', { err: err.message }));
      return;
    }
    if (folders.length === 0) {
      // Compact CTA for the sidebar — kept short to avoid scroll churn.
      list.innerHTML = `
        <div class="empty-state-cta compact">
          <div class="empty-state-cta-icon">★</div>
          <div class="empty-state-cta-title">${escapeHtml(App.t('sidebar.no_saved_searches_title'))}</div>
          <div class="empty-state-cta-sub">
            ${escapeHtml(App.t('sidebar.no_saved_searches_sub'))}
          </div>
        </div>
      `;
      return;
    }
    const openTitle = App.t('sidebar.open_folder_title');
    const delTitle = App.t('sidebar.delete_folder_title');
    const delAria = App.t('sidebar.delete_folder_aria');
    list.innerHTML = folders
      .map(
        (f) => `
          <div class="smart-folder-item" data-id="${f.id}" role="button" tabindex="0" title="${escapeHtml(openTitle)}">
            <span class="smart-folder-icon" aria-hidden="true">★</span>
            <span class="smart-folder-name">${escapeHtml(f.name)}</span>
            <button class="smart-folder-delete" data-delete="${f.id}" type="button" title="${escapeHtml(delTitle)}" aria-label="${escapeHtml(delAria)}">×</button>
          </div>
        `
      )
      .join('');

    list.querySelectorAll('.smart-folder-item').forEach((item) => {
      const id = parseInt(item.dataset.id, 10);
      const applyFolder = async () => {
        const folder = folders.find((f) => f.id === id);
        if (!folder) return;
        App.applySmartFolder(folder);
      };
      item.addEventListener('click', (e) => {
        if (e.target.closest('.smart-folder-delete')) return;
        applyFolder();
      });
      item.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          applyFolder();
        }
      });
    });

    list.querySelectorAll('.smart-folder-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.delete, 10);
        const folder = folders.find((f) => f.id === id);
        const name = folder ? folder.name : App.t('modal.default_smart_folder_name');
        const ok = await App.appModal({
          title: App.t('modal.delete_smart_folder_title'),
          body: App.t('modal.delete_smart_folder_body_html', { name: escapeHtml(name) }),
          variant: 'destructive',
          buttons: [
            { label: App.t('modal.cancel'), value: false },
            { label: App.t('modal.delete'), value: true, destructive: true }
          ]
        });
        if (!ok) return;
        await window.api.deleteSmartFolder(id);
        App.loadSmartFolders();
        App.logLine('info', App.t('log.smart_folder_deleted', { name }));
      });
    });
  };

  App.applySmartFolder = function applySmartFolder(folder) {
    const $ = App.$;
    const q = (folder && folder.query) || {};
    App.switchView('database');
    // Restore inputs after the view switch
    setTimeout(() => {
      if ($('#db-search')) $('#db-search').value = q.search || '';
      if ($('#db-kind-filter')) $('#db-kind-filter').value = q.kind || '';
      App.state.dbKindFilter = q.kind || '';
      if (q.dbTreeFilter !== undefined) App.state.dbTreeFilter = q.dbTreeFilter;
      // Forward extra filter fields onto App.state for other modules to consume
      App.state.smartFolderQuery = q;
      // If the saved folder carries a full parsed query string, restore chips.
      if (q.parsedQueryString && typeof App.setSearchQuery === 'function') {
        App.setSearchQuery(q.parsedQueryString);
      } else if (q.search && typeof App.setSearchQuery === 'function') {
        App.setSearchQuery(q.search);
      } else {
        App.refreshDatabase();
      }
      App.logLine('info', App.t('log.smart_folder_applied', { name: folder.name }));
    }, 40);
  };

  App.saveCurrentAsSmartFolder = async function saveCurrentAsSmartFolder() {
    const $ = App.$;
    const escapeHtml = App.escapeHtml;
    // Compose the active query from the global search bar (chips + free text)
    // so smart folders capture the full advanced query, not just db-search.
    let parsedQueryString = '';
    if (typeof App.getActiveSearchParsed === 'function' && App.SearchParser) {
      try {
        parsedQueryString = App.SearchParser.format(App.getActiveSearchParsed());
      } catch {
        parsedQueryString = '';
      }
    }
    const current = {
      search: ($('#db-search') && $('#db-search').value.trim()) || '',
      kind: ($('#db-kind-filter') && $('#db-kind-filter').value) || '',
      brand: '',
      ecuType: '',
      tag: '',
      dbTreeFilter: App.state.dbTreeFilter || '',
      parsedQueryString: parsedQueryString || ''
    };

    // Refuse to save an empty-query Smart Folder — it would just be a "show
    // everything" shortcut, which is what the Database view already does. The
    // tester flagged the feature as opaque; this guard makes it clearer that
    // a Smart Folder = "the current query, saved".
    const isEmptyQuery =
      !current.search && !current.kind && !current.dbTreeFilter && !current.parsedQueryString;
    if (isEmptyQuery) {
      if (App.toast) App.toast.info(App.t('toasts.smart_folder_query_empty'));
      // Focus the global search bar so the next keystroke goes somewhere useful.
      const inp = $('#global-search') || $('#db-search');
      if (inp) inp.focus();
      return;
    }

    // Prompt for a name via the app modal
    const overlay = $('#app-modal-overlay');
    if (!overlay) return;
    const previewParts = [];
    if (current.search)
      previewParts.push(
        App.t('modal.save_smart_folder_preview_search', { q: escapeHtml(current.search) })
      );
    if (current.kind)
      previewParts.push(
        App.t('modal.save_smart_folder_preview_kind', { k: escapeHtml(current.kind) })
      );
    if (current.dbTreeFilter)
      previewParts.push(
        App.t('modal.save_smart_folder_preview_tree', { t: escapeHtml(current.dbTreeFilter) })
      );
    const preview = previewParts.length
      ? `<div class="hint" style="margin-top:8px">${previewParts.join(' · ')}</div>`
      : `<div class="hint" style="margin-top:8px">${App.t('modal.save_smart_folder_preview_empty')}</div>`;

    const inputId = 'smart-folder-name-input-' + Date.now();
    const nameLabel = App.t('modal.save_smart_folder_name_label');
    const placeholder = App.t('modal.save_smart_folder_placeholder');
    // One-line "what this does" header above the name input — addresses the
    // tester's "I don't understand what this feature does" feedback.
    const intro =
      `<div class="hint" style="margin-bottom:10px;line-height:1.5">` +
      App.t('smart_folder_help.p1_html') +
      `</div>`;
    const body =
      intro +
      `<label for="${inputId}">${App.escapeHtml(nameLabel)}</label>` +
      `<input id="${inputId}" type="text" placeholder="${App.escapeHtml(placeholder)}" ` +
      'style="width:100%;padding:8px;background:var(--bg-input);border:1px solid var(--border);' +
      'color:var(--text);border-radius:4px;margin-top:6px;font-family:inherit;font-size:13px"/>' +
      preview;

    const saveLabel = App.t('modal.save');
    const valuePromise = App.appModal({
      title: App.t('modal.save_smart_folder_title'),
      body,
      variant: 'choice',
      buttons: [
        { label: App.t('modal.cancel'), value: null },
        { label: saveLabel, value: 'save', primary: true }
      ]
    });
    setTimeout(() => {
      const inp = document.getElementById(inputId);
      if (inp) {
        inp.focus();
        inp.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            const btns = $('#app-modal-buttons').querySelectorAll('button');
            const saveBtn = Array.from(btns).find((b) => b.textContent === saveLabel);
            if (saveBtn) saveBtn.click();
          }
        });
      }
    }, 80);
    const choice = await valuePromise;
    if (choice !== 'save') return;
    const inp = document.getElementById(inputId);
    const name = inp ? inp.value.trim() : '';
    if (!name) {
      App.logLine('err', App.t('log.smart_folder_name_empty'));
      return;
    }
    const r = await window.api.createSmartFolder({
      name,
      icon: 'star',
      query: current
    });
    if (r && r.error) {
      App.logLine('err', App.t('log.smart_folder_save_failed', { err: r.error }));
      return;
    }
    App.logLine('ok', App.t('log.smart_folder_saved', { name }));
    App.loadSmartFolders();
  };

  App.setupSmartFolders = function setupSmartFolders() {
    const $ = App.$;
    const addBtn = $('#smart-folder-add-btn');
    if (addBtn) addBtn.addEventListener('click', App.saveCurrentAsSmartFolder);
    const saveBtn = $('#db-save-smart-folder');
    if (saveBtn) saveBtn.addEventListener('click', App.saveCurrentAsSmartFolder);
    const helpBtn = $('#smart-folder-help-btn');
    if (helpBtn) helpBtn.addEventListener('click', App.showSmartFolderHelp);
  };

  /**
   * Show a small explainer modal describing what Smart Folders are for. Triggered
   * by the (?) icon in the sidebar header. The tester flagged the feature as
   * opaque on first encounter; this is the discoverability surface that closes
   * the loop without forcing them to read documentation.
   */
  App.showSmartFolderHelp = async function showSmartFolderHelp() {
    await App.appModal({
      title: App.t('smart_folder_help.modal_title'),
      body:
        `<div style="display:flex;flex-direction:column;gap:10px;line-height:1.5">` +
        `<div>${App.t('smart_folder_help.p1_html')}</div>` +
        `<div>${App.t('smart_folder_help.p2_html')}</div>` +
        `<div>${App.t('smart_folder_help.p3_html')}</div>` +
        `</div>`,
      variant: 'choice',
      buttons: [{ label: App.t('smart_folder_help.close'), value: true, primary: true }]
    });
  };
})();
