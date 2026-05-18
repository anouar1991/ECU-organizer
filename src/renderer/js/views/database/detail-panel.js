/* ===== Database view: detail side panel =====
 * Right-side slide-in panel showing full metadata for the clicked row.
 * Opens via App.openDbDetailPanel(id); closes via ✕, ESC, or click outside.
 *
 * All editable fields write through window.api.updateFile, then refresh
 * the database so table/grid cells reflect the new values. Tag chips have
 * an inline × and a "+ add tag" input. The notes textarea saves on blur.
 *
 * Enrichment + firmware-structure are read from the row's enrichment_json /
 * firmware_structure_json columns (already returned by listFiles via
 * SELECT *), so no extra IPC round-trip is required.
 */
window.App = window.App || {};

(function () {
  const App = window.App;

  // ---------- safe JSON parse ----------
  function safeJson(s) {
    if (!s) return null;
    if (typeof s === 'object') return s;
    try {
      return JSON.parse(s);
    } catch {
      return null;
    }
  }

  // ---------- one-shot wiring ----------
  App.ensureDbDetailPanelWired = function ensureDbDetailPanelWired() {
    if (App._dbDetailPanelWired) return;
    App._dbDetailPanelWired = true;

    const closeBtn = App.$('#db-detail-close');
    if (closeBtn) closeBtn.addEventListener('click', App.closeDbDetailPanel);

    // Esc anywhere in the document closes the panel.
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      const panel = App.$('#db-detail-panel');
      if (!panel || panel.hidden) return;
      // Don't steal Esc from an active inline editor — that has its own handler.
      if (App.state.editingDbCell) return;
      App.closeDbDetailPanel();
    });

    // Click-outside: only close when the user is in the database view AND
    // didn't click inside the panel or on a row/card.
    document.addEventListener('mousedown', (e) => {
      const panel = App.$('#db-detail-panel');
      if (!panel || panel.hidden) return;
      if (e.target.closest('#db-detail-panel')) return;
      if (e.target.closest('tr[data-id]') || e.target.closest('.db-card')) return;
      // The bulk action bar lives outside the panel too — keep it usable.
      if (e.target.closest('.db-action-bar')) return;
      App.closeDbDetailPanel();
    });
  };

  App.closeDbDetailPanel = function closeDbDetailPanel() {
    const panel = App.$('#db-detail-panel');
    if (!panel) return;
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    App.state.dbDetailFileId = null;
    // Wait for slide-out to finish before hidden, so the transition plays.
    setTimeout(() => {
      if (!App.state.dbDetailFileId) panel.hidden = true;
    }, 220);
    document.body.classList.remove('db-detail-open');
  };

  // ---------- main open ----------
  App.openDbDetailPanel = function openDbDetailPanel(fileId) {
    const panel = App.$('#db-detail-panel');
    if (!panel) return;
    const all = App._dbAllRowsCache || [];
    const row = all.find((r) => r.id === fileId);
    if (!row) {
      App.logLine('err', App.t('log.file_not_in_cache', { id: fileId }));
      return;
    }
    App.state.dbDetailFileId = fileId;
    panel.hidden = false;
    // Force reflow so the .open class triggers a transition.
    void panel.offsetWidth;
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    document.body.classList.add('db-detail-open');

    const titleId = App.$('#db-detail-id');
    if (titleId) titleId.textContent = '#' + fileId;
    renderBody(row);
    // Re-apply data-i18n bindings on the newly rendered body.
    if (App.i18n && typeof App.i18n.applyDom === 'function') {
      const body = App.$('#db-detail-body');
      if (body) App.i18n.applyDom(body);
    }
  };

  // ---------- body render ----------
  function renderBody(row) {
    const body = App.$('#db-detail-body');
    if (!body) return;
    const escapeHtml = App.escapeHtml;
    const formatBytes = App.formatBytes;
    const splitTags = App.splitTags;

    const enrichment = safeJson(row.enrichment_json);
    const fwStruct = safeJson(row.firmware_structure_json);
    const tags = splitTags(row.tags);
    const all = App._dbAllRowsCache || [];

    // Parent / solutions linkage.
    let parentHtml = '';
    if (row.kind === 'solution' && row.parent_id) {
      const parent = all.find((r) => r.id === row.parent_id);
      if (parent) {
        parentHtml = `
          <section class="db-detail-section">
            <h4>${escapeHtml(App.t('detail_panel.parent_original'))}</h4>
            <button class="db-detail-link" data-jump-id="${parent.id}">
              #${parent.id} · ${escapeHtml(parent.new_name)}
            </button>
            <button class="btn-secondary small db-detail-cmp" data-cmp-id="${row.id}">
              ${escapeHtml(App.t('detail_panel.compare_with_original'))}
            </button>
          </section>`;
      }
    } else if (row.kind === 'original') {
      const children = all.filter((r) => r.kind === 'solution' && r.parent_id === row.id);
      if (children.length > 0) {
        const noLabel = App.t('detail_panel.no_label');
        const items = children
          .map(
            (c) =>
              `<button class="db-detail-link" data-jump-id="${c.id}">
                 #${c.id} · ${escapeHtml(c.solution_label || noLabel)} · ${escapeHtml(c.new_name)}
               </button>`
          )
          .join('');
        const heading =
          children.length === 1
            ? App.t('detail_panel.solutions_count_one')
            : App.t('detail_panel.solutions_count_many', { n: children.length });
        parentHtml = `
          <section class="db-detail-section">
            <h4>${escapeHtml(heading)}</h4>
            ${items}
          </section>`;
      }
    }

    // Enrichment block.
    let enrichmentHtml = '';
    if (enrichment) {
      const parts = [];
      if (enrichment.bosch && enrichment.bosch.summary) {
        parts.push(
          `<div><span class="k">${escapeHtml(App.t('detail_panel.enrichment_bosch'))}</span><span class="v">${escapeHtml(enrichment.bosch.summary)}</span></div>`
        );
      }
      if (enrichment.vag) {
        const v = enrichment.vag;
        const t = [v.model, v.system].filter(Boolean).join(' · ');
        if (t)
          parts.push(
            `<div><span class="k">${escapeHtml(App.t('detail_panel.enrichment_vag'))}</span><span class="v">${escapeHtml(t)}</span></div>`
          );
      }
      if (enrichment.wmi && enrichment.wmi.summary) {
        parts.push(
          `<div><span class="k">${escapeHtml(App.t('detail_panel.enrichment_wmi'))}</span><span class="v">${escapeHtml(enrichment.wmi.summary)}</span></div>`
        );
      }
      // Fallback: stringify anything we didn't render.
      if (parts.length === 0) {
        parts.push(
          `<div class="hint">${escapeHtml(JSON.stringify(enrichment).slice(0, 300))}</div>`
        );
      }
      enrichmentHtml = `
        <section class="db-detail-section">
          <h4>${escapeHtml(App.t('detail_panel.enrichment'))}</h4>
          <div class="db-detail-kv">${parts.join('')}</div>
        </section>`;
    }

    // Firmware structure block.
    let fwHtml = '';
    if (fwStruct && Array.isArray(fwStruct.regions) && fwStruct.regions.length > 0) {
      const profile = fwStruct.profile || fwStruct.profileName || '';
      const unnamed = App.t('detail_panel.unnamed');
      const items = fwStruct.regions
        .slice(0, 32)
        .map((r) => {
          const off = typeof r.offset === 'number' ? '0x' + r.offset.toString(16) : '?';
          const sz = typeof r.size === 'number' ? formatBytes(r.size) : '?';
          return `<li><strong>${escapeHtml(r.name || unnamed)}</strong> @ ${off} (${sz})</li>`;
        })
        .join('');
      fwHtml = `
        <section class="db-detail-section">
          <h4>${escapeHtml(App.t('detail_panel.firmware_structure'))} ${profile ? `<span class="hint">· ${escapeHtml(profile)}</span>` : ''}</h4>
          <ul class="db-detail-regions">${items}</ul>
        </section>`;
    }

    const removeTagAria = App.t('detail_panel.remove_tag_aria');
    const addTagPh = App.t('detail_panel.add_tag_placeholder');
    const notesPh = App.t('detail_panel.notes_placeholder_empty');
    body.innerHTML = `
      <section class="db-detail-section db-detail-hero">
        <span class="kind-badge kind-${row.kind || 'original'}">${(row.kind || '').toUpperCase()}</span>
        ${row.solution_label ? `<span class="db-detail-stage">${escapeHtml(row.solution_label)}</span>` : ''}
        <div class="db-detail-name" title="${escapeHtml(row.new_name)}">${escapeHtml(row.new_name)}</div>
      </section>

      <section class="db-detail-section">
        <h4>${escapeHtml(App.t('detail_panel.metadata'))}</h4>
        <div class="db-detail-kv">
          ${kv(App.t('detail_panel.kv_brand'), 'brand', row.brand)}
          ${kv(App.t('detail_panel.kv_model'), 'model', row.model)}
          ${kv(App.t('detail_panel.kv_ecu_type'), 'ecu_type', row.ecu_type)}
          ${kv(App.t('detail_panel.kv_hw'), 'hw_id', row.hw_id)}
          ${kv(App.t('detail_panel.kv_sw'), 'sw_id', row.sw_id)}
          ${kv(App.t('detail_panel.kv_protocol'), 'protocol', row.protocol)}
          ${kvReadonly(App.t('detail_panel.kv_confidence'), (Number(row.confidence) || 0) + '%')}
          ${kvReadonly(App.t('detail_panel.kv_size'), formatBytes(row.file_size) + ' (' + (row.file_size || 0).toLocaleString() + ')')}
          ${kvReadonly(App.t('detail_panel.kv_md5'), row.md5 || '—')}
          ${kvReadonly(App.t('detail_panel.kv_tlsh'), (row.tlsh_digest || '—').toString().slice(0, 40))}
          ${kvReadonly(App.t('detail_panel.kv_vin'), row.vin || '—')}
          ${kvReadonly(App.t('detail_panel.kv_created'), row.created_at ? new Date(row.created_at * 1000).toLocaleString() : '—')}
        </div>
      </section>

      <section class="db-detail-section">
        <h4>${escapeHtml(App.t('detail_panel.tags'))}</h4>
        <div class="db-detail-tags">
          ${tags
            .map(
              (t) =>
                `<span class="db-detail-tag tag-chip" data-color="${escapeHtml(App.getTagColor(t))}">${escapeHtml(t)}<button class="db-detail-tag-x" data-rm-tag="${escapeHtml(t)}" aria-label="${escapeHtml(removeTagAria)}">×</button></span>`
            )
            .join('')}
          <input type="text" id="db-detail-add-tag" placeholder="${escapeHtml(addTagPh)}" autocomplete="off" />
        </div>
      </section>

      <section class="db-detail-section">
        <h4>${escapeHtml(App.t('detail_panel.notes'))}</h4>
        <textarea id="db-detail-notes" rows="4" placeholder="${escapeHtml(notesPh)}">${escapeHtml(row.notes || '')}</textarea>
      </section>

      ${parentHtml}
      ${enrichmentHtml}
      ${fwHtml}

      <section class="db-detail-section">
        <h4>${escapeHtml(App.t('detail_panel.actions'))}</h4>
        <div class="db-detail-actions">
          <button class="btn-secondary small db-detail-open-file">${escapeHtml(App.t('detail_panel.action_open_file'))}</button>
          <button class="btn-secondary small db-detail-open-folder">${escapeHtml(App.t('detail_panel.action_open_folder'))}</button>
          <button class="btn-secondary small db-detail-hex-peek">${escapeHtml(App.t('detail_panel.action_hex_peek'))}</button>
          <button class="btn-secondary small db-detail-cmp" data-cmp-id="${row.id}">${escapeHtml(App.t('detail_panel.action_compare'))}</button>
          <button class="btn-secondary small destructive db-detail-delete">${escapeHtml(App.t('detail_panel.action_delete'))}</button>
        </div>
        <pre id="db-detail-hex" class="db-detail-hex" hidden></pre>
      </section>

      <section class="db-detail-section">
        <h4>${escapeHtml(App.t('pinouts.suggest_title'))}</h4>
        <div id="db-detail-pinout-suggest" class="pinout-suggest-host"></div>
      </section>
    `;

    wireBody(row);

    // Populate the suggest card asynchronously — it queries IPC for matching
    // pinouts and renders into the dedicated host below the actions block.
    if (typeof App.renderPinoutSuggestCard === 'function') {
      const host = body.querySelector('#db-detail-pinout-suggest');
      const family = ecuFamilyFromLabel(row.ecu_type);
      App.renderPinoutSuggestCard(host, {
        brand: row.brand,
        family,
        model: row.ecu_type
      });
    }
  }

  function ecuFamilyFromLabel(label) {
    if (!label) return '';
    const s = String(label).trim();
    const parts = s.split(/\s+/);
    return parts.length > 1 ? parts.slice(1).join(' ') : s;
  }

  // ---------- helpers for KV blocks ----------
  function kv(label, col, val) {
    const escapeHtml = App.escapeHtml;
    const display = val == null || val === '' ? '—' : val;
    return `<div>
      <span class="k">${escapeHtml(label)}</span>
      <span class="v editable" data-col="${col}">${escapeHtml(display)}</span>
    </div>`;
  }
  function kvReadonly(label, val) {
    const escapeHtml = App.escapeHtml;
    return `<div><span class="k">${escapeHtml(label)}</span><span class="v">${escapeHtml(val)}</span></div>`;
  }

  // ---------- wire body interactions ----------
  function wireBody(row) {
    const body = App.$('#db-detail-body');
    if (!body) return;

    // Editable KV cells: tag the cell with the file id so the shared
    // inline-edit helper (App.startEditingDbCell) can pick it up without
    // needing a parent <tr> wrapper. After commit, refreshDatabase() is
    // called by the helper — we re-open the panel so the user sees the
    // updated value without losing context.
    body.querySelectorAll('.editable[data-col]').forEach((cell) => {
      cell.dataset.fileId = String(row.id);
      cell.addEventListener('click', () => {
        const fileId = row.id;
        App.startEditingDbCell(cell);
        // The editor is now blocking input; when it commits or cancels it
        // calls refreshDatabase(). Re-open the panel right after so the user
        // doesn't have to click the row again.
        const input = cell.querySelector('input');
        if (input) {
          const reopen = () => setTimeout(() => App.openDbDetailPanel(fileId), 40);
          input.addEventListener('blur', reopen, { once: true });
        }
      });
    });

    // Tag remove (×).
    body.querySelectorAll('[data-rm-tag]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const tag = btn.dataset.rmTag;
        const existing = App.splitTags(row.tags);
        const merged = existing.filter((t) => t !== tag).join(',');
        const res = await window.api.updateFile(row.id, { tags: merged });
        if (res && res.error)
          App.logLine('err', App.t('log.tag_remove_failed', { err: res.error }));
        else App.logLine('ok', App.t('log.tag_remove_from_file', { tag, id: row.id }));
        await App.refreshDatabase();
        // Re-open the panel so the user sees the updated tag list.
        App.openDbDetailPanel(row.id);
      });
    });

    // Tag add (Enter).
    const addTag = App.$('#db-detail-add-tag');
    if (addTag) {
      const commitTag = async (raw) => {
        const v = String(raw == null ? addTag.value : raw).trim();
        if (!v) return;
        const existing = App.splitTags(row.tags);
        if (existing.includes(v)) {
          addTag.value = '';
          return;
        }
        const merged = [...existing, v].join(',');
        const res = await window.api.updateFile(row.id, { tags: merged });
        if (res && res.error) App.logLine('err', App.t('log.tag_add_failed', { err: res.error }));
        else App.logLine('ok', App.t('log.tag_add_to_file', { tag: v, id: row.id }));
        addTag.value = '';
        await App.refreshDatabase();
        App.openDbDetailPanel(row.id);
      };
      addTag.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        commitTag();
      });
      if (typeof App.attachTagAutocomplete === 'function') {
        App.attachTagAutocomplete(addTag, {
          position: 'below',
          onPick: (tag) => commitTag(tag),
          excludeExisting: () => App.splitTags(row.tags)
        });
      }
    }

    // Notes textarea: save on blur (and on Ctrl+Enter for explicit commits).
    const notes = App.$('#db-detail-notes');
    if (notes) {
      let dirty = false;
      notes.addEventListener('input', () => {
        dirty = true;
      });
      notes.addEventListener('blur', async () => {
        if (!dirty) return;
        dirty = false;
        const v = notes.value;
        const res = await window.api.updateFile(row.id, { notes: v });
        if (res && res.error)
          App.logLine('err', App.t('log.notes_save_failed', { err: res.error }));
        else App.logLine('ok', App.t('log.notes_saved', { id: row.id }));
        // Don't full-refresh — would close the panel mid-edit. Just patch cache.
        const cached = (App._dbAllRowsCache || []).find((r) => r.id === row.id);
        if (cached) cached.notes = v;
      });
      notes.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          notes.blur();
        }
      });
    }

    // Jump to another file (parent/child links).
    body.querySelectorAll('[data-jump-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = parseInt(btn.dataset.jumpId, 10);
        if (Number.isNaN(id)) return;
        App.openDbDetailPanel(id);
      });
    });

    // Compare buttons.
    body.querySelectorAll('.db-detail-cmp').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.cmpId, 10);
        await App.sendToComparator(id, btn);
      });
    });

    // Open file / open folder / hex peek / delete.
    const openFile = body.querySelector('.db-detail-open-file');
    if (openFile && row.archive_path) {
      openFile.addEventListener('click', () => window.api.openFolder(row.archive_path));
    }
    const openFolder = body.querySelector('.db-detail-open-folder');
    if (openFolder && row.archive_path) {
      openFolder.addEventListener('click', () => {
        const p = String(row.archive_path);
        const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
        const dir = idx > 0 ? p.slice(0, idx) : p;
        window.api.openFolder(dir);
      });
    }

    const hexBtn = body.querySelector('.db-detail-hex-peek');
    const hexBox = body.querySelector('#db-detail-hex');
    if (hexBtn && hexBox) {
      hexBtn.addEventListener('click', async () => {
        if (!row.archive_path) {
          App.logLine('err', App.t('log.row_in_db_no_path'));
          return;
        }
        try {
          const res = await window.api.hexPeek(row.archive_path, 256, 0);
          if (!res || res.error) {
            hexBox.textContent = res?.error || 'Failed to read bytes.';
          } else {
            hexBox.textContent = formatHex(res);
          }
          hexBox.hidden = false;
        } catch (e) {
          hexBox.textContent = 'Error: ' + e.message;
          hexBox.hidden = false;
        }
      });
    }

    const delBtn = body.querySelector('.db-detail-delete');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        const confirmed = await App.appModal({
          title: App.t('modal.detail_delete_title'),
          body: App.t('modal.detail_delete_body_html', { id: row.id }),
          variant: 'destructive',
          buttons: [
            { label: App.t('modal.cancel'), value: false },
            { label: App.t('modal.delete'), value: true, destructive: true }
          ]
        });
        if (!confirmed) return;
        await window.api.deleteFile(row.id);
        App.state.selectedIds.delete(row.id);
        App.closeDbDetailPanel();
        await App.refreshDatabase();
        App.logLine('ok', App.t('log.removed_from_index', { id: row.id }));
      });
    }
  }

  // ---------- hex formatter (lightweight; reuses peek shape) ----------
  function formatHex(peek) {
    // peek may be { bytes: number[] | Uint8Array, ascii, offset } or similar.
    let bytes = null;
    if (peek.bytes && peek.bytes.length != null) bytes = peek.bytes;
    else if (peek.hex && typeof peek.hex === 'string') {
      const hex = peek.hex.replace(/\s+/g, '');
      bytes = [];
      for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(parseInt(hex.slice(i, i + 2), 16));
    } else if (peek.buffer && peek.buffer.length != null) {
      bytes = peek.buffer;
    }
    if (!bytes) return JSON.stringify(peek).slice(0, 200);

    const lines = [];
    const len = Math.min(bytes.length, 256);
    for (let i = 0; i < len; i += 16) {
      const slice = Array.from(bytes.slice(i, i + 16));
      const hex = slice.map((b) => (b || 0).toString(16).padStart(2, '0')).join(' ');
      const ascii = slice
        .map((b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '.'))
        .join('');
      lines.push(i.toString(16).padStart(6, '0') + '  ' + hex.padEnd(48, ' ') + '  ' + ascii);
    }
    return lines.join('\n');
  }
})();
