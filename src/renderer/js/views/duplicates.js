/* ===== Duplicates view =====
 * Two modes: exact MD5 duplicates, near-duplicates by TLSH distance.
 * Each mode renders groups; each row in a group exposes Open (containing
 * folder) and Delete (DB entry only, with bulk-confirm modal).
 */
window.App = window.App || {};

(function () {
  const App = window.App;

  // Last-loaded results, keyed by mode. Used to support re-rendering when
  // the user removes a row without re-scanning.
  const cache = { exact: null, similar: null };
  let currentMode = 'exact';

  App.setupDuplicatesView = function setupDuplicatesView() {
    const $ = App.$;
    const $$ = App.$$;
    const tabs = $$('.dupes-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        tabs.forEach((t) => t.classList.toggle('active', t === tab));
        currentMode = tab.dataset.mode || 'exact';
        renderFromCache();
      });
    });
    const refresh = $('#dupes-refresh');
    if (refresh) {
      refresh.addEventListener('click', () => App.refreshDuplicates(currentMode));
    }
    // First-mount CTA button (only present until the first scan runs).
    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'dupes-empty-scan') {
        App.refreshDuplicates(currentMode);
      }
    });
  };

  function renderFromCache() {
    if (cache[currentMode]) {
      render(currentMode, cache[currentMode]);
    } else {
      App.refreshDuplicates(currentMode);
    }
  }

  App.refreshDuplicates = async function refreshDuplicates(mode) {
    const $ = App.$;
    const target = mode || currentMode;
    currentMode = target;
    const out = $('#dupes-results');
    if (!out) return;
    out.innerHTML = `<div class="hint" style="padding:16px">${App.escapeHtml(App.t('duplicates.scanning'))}</div>`;
    try {
      let result;
      if (target === 'exact') {
        result = await window.api.findExactDuplicates();
      } else {
        result = await window.api.findNearDuplicates(30);
      }
      cache[target] = result;
      render(target, result);
    } catch (err) {
      out.innerHTML =
        '<div class="hint" style="padding:16px;color:var(--danger,#f87171)">' +
        'Error: ' +
        App.escapeHtml(err.message) +
        '</div>';
    }
  };

  function render(mode, data) {
    const $ = App.$;
    const escapeHtml = App.escapeHtml;
    const formatBytes = App.formatBytes;
    const out = $('#dupes-results');
    if (!out) return;

    if (!Array.isArray(data) || data.length === 0) {
      const msg = mode === 'exact' ? App.t('duplicates.no_exact') : App.t('duplicates.no_similar');
      out.innerHTML = `
        <div class="empty-state-cta">
          <div class="empty-state-cta-icon">✓</div>
          <div class="empty-state-cta-title">${App.escapeHtml(msg)}</div>
          <div class="empty-state-cta-sub">${App.escapeHtml(App.t('duplicates.clean_sub'))}</div>
          <div class="empty-state-cta-actions">
            <button class="btn-secondary" id="dupes-empty-rescan">${App.escapeHtml(App.t('duplicates.rescan'))}</button>
          </div>
        </div>
      `;
      const rescan = document.getElementById('dupes-empty-rescan');
      if (rescan) rescan.addEventListener('click', () => App.refreshDuplicates(mode));
      return;
    }

    const groupsHtml = data
      .map((group, idx) => {
        const files = group.files || [];
        const filesLabel =
          files.length === 1
            ? App.t('duplicates.files_label_one')
            : App.t('duplicates.files_label_many', { n: files.length });
        const badge =
          mode === 'exact'
            ? `MD5 <code>${escapeHtml((group.md5 || '').slice(0, 12))}…</code> · ${escapeHtml(filesLabel)}`
            : `${escapeHtml(App.t('duplicates.distance_label', { d: group.distance ?? '?' }))} · ${escapeHtml(filesLabel)}`;

        const openLbl = App.t('duplicates.open_button');
        const delLbl = App.t('duplicates.delete_button');
        const unnamed = App.t('detail_panel.unnamed');
        const rows = files
          .map(
            (f) => `
              <div class="dupes-row" data-id="${f.id}">
                <div class="dupes-row-meta">
                  <span class="kind-badge kind-${escapeHtml(f.kind || 'original')}">${escapeHtml(
                    (f.kind || 'original').toUpperCase()
                  )}</span>
                  <span class="dupes-row-brand">${escapeHtml(f.brand || '?')}</span>
                  <span class="dupes-row-sep">·</span>
                  <span>${escapeHtml(f.ecu_type || '?')}</span>
                  <span class="dupes-row-sep">·</span>
                  <span class="dupes-row-hw">${escapeHtml(f.hw_id || '—')}</span>
                </div>
                <div class="dupes-row-name">${escapeHtml(f.new_name || unnamed)}</div>
                <div class="dupes-row-path">${escapeHtml(f.archive_path || '')}</div>
                <div class="dupes-row-actions">
                  <span class="hint">${formatBytes(f.file_size || 0)}</span>
                  <button class="btn-secondary small" data-open="${escapeHtml(
                    f.archive_path || ''
                  )}" type="button">${escapeHtml(openLbl)}</button>
                  <button class="btn-secondary small destructive" data-delete="${f.id}" type="button">
                    ${escapeHtml(delLbl)}
                  </button>
                </div>
              </div>
            `
          )
          .join('');

        return `
          <div class="dupes-group" data-group="${idx}">
            <div class="dupes-group-header">
              <span class="dupes-group-badge">${badge}</span>
            </div>
            <div class="dupes-group-rows">${rows}</div>
          </div>
        `;
      })
      .join('');

    out.innerHTML = groupsHtml;

    out.querySelectorAll('button[data-open]').forEach((b) => {
      b.addEventListener('click', () => {
        const p = b.dataset.open;
        if (!p) return;
        // Open the containing folder. path.dirname is not available in
        // renderer; do it lexicographically.
        const slash = p.lastIndexOf('/') >= 0 ? p.lastIndexOf('/') : p.lastIndexOf('\\');
        const folder = slash > 0 ? p.slice(0, slash) : p;
        window.api.openFolder(folder);
      });
    });

    out.querySelectorAll('button[data-delete]').forEach((b) => {
      b.addEventListener('click', async () => {
        const id = parseInt(b.dataset.delete, 10);
        const row = out.querySelector(`.dupes-row[data-id="${id}"]`);
        const name = row ? row.querySelector('.dupes-row-name')?.textContent || `#${id}` : `#${id}`;
        const ok = await App.appModal({
          title: App.t('modal.delete_dup_title'),
          body: App.t('modal.delete_dup_body_html', { name: App.escapeHtml(name) }),
          variant: 'destructive',
          buttons: [
            { label: App.t('modal.cancel'), value: false },
            { label: App.t('modal.delete'), value: true, destructive: true }
          ]
        });
        if (!ok) return;
        await window.api.deleteFile(id);
        if (row) row.remove();
        if (App.toast) App.toast.success(App.t('toasts.removed_duplicate'));
        // Prune local cache: drop the row and any group that no longer has >= 2 rows.
        const cached = cache[currentMode];
        if (Array.isArray(cached)) {
          for (const g of cached) {
            g.files = (g.files || []).filter((f) => f.id !== id);
          }
          cache[currentMode] = cached.filter((g) => (g.files || []).length >= 2);
        }
        App.logLine('info', App.t('log.removed_duplicate', { id }));
        if (typeof App.refreshDatabase === 'function') App.refreshDatabase();
        // If a group emptied below 2 rows, re-render to drop the now-singleton group.
        if (
          Array.isArray(cache[currentMode]) &&
          cache[currentMode].length !== document.querySelectorAll('.dupes-group').length
        ) {
          render(currentMode, cache[currentMode]);
        }
      });
    });
  }
})();
