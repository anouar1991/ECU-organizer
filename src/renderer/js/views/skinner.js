/* ===== Skinner view =====
 * Drop zone, file tray, metadata editing, tags, kind (original/solution),
 * format mask preview, organize one/all.
 */
window.App = window.App || {};

(function () {
  const App = window.App;

  /* ===== Drop zone ===== */
  App.setupDropZone = function setupDropZone() {
    const $ = App.$;
    const dz = $('#drop-zone');
    ['dragenter', 'dragover'].forEach((ev) => {
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach((ev) => {
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.remove('dragover');
      });
    });

    dz.addEventListener('drop', async (e) => {
      const items = Array.from(e.dataTransfer.files);
      const paths = items.map((f) => window.api.getPathForFile(f)).filter(Boolean);
      if (paths.length === 0) {
        App.logLine('warn', App.t('log.no_path_drop'));
        return;
      }
      await App.ingestFiles(paths);
    });

    $('#scan-btn').addEventListener('click', async () => {
      const paths = await window.api.selectFiles();
      if (paths.length > 0) await App.ingestFiles(paths);
    });
  };

  App.ingestFiles = async function ingestFiles(paths) {
    const state = App.state;
    App.logLine('info', App.t('log.scanning_n', { n: paths.length }));
    const results = await window.api.scanMultiple(paths);

    const autoEnabled = state.settings.auto_organize_enabled === '1';
    const autoThreshold = parseInt(state.settings.auto_organize_threshold || '85', 10);
    const autoBatch = [];

    for (const r of results) {
      if (!r.success) {
        App.logLine('err', App.t('log.scan_failed', { path: r.filePath, err: r.error }));
        continue;
      }
      r.tags = '';
      r.notes = '';
      r.stage = App.detectStage(r.fileName);
      r.kind = 'original';
      r.parentId = null;
      r.solutionLabel = '';
      // Smart-tag suggestions (Feature 5) — main applies enabled rules at scan
      // time and ships the result here as `autoTags`. We surface them as
      // accept/reject chips rather than silently mutating the file's tags.
      r.suggestedTags = Array.isArray(r.autoTags) ? r.autoTags.slice() : [];

      const meta = r.metadata;

      if (meta.md5) {
        const dupes = await window.api.findByMd5(meta.md5);
        if (dupes && dupes.length > 0) {
          const d = dupes[0];
          App.logLine(
            'warn',
            App.t('log.duplicate_skipped', { name: r.fileName, id: d.id, newName: d.new_name })
          );
          continue;
        }
      }

      if (meta.hwId) {
        const candidates = await window.api.listOriginalsMatching({
          brand: meta.brand,
          model: meta.model,
          ecuType: meta.ecuType,
          hwId: meta.hwId
        });
        if (candidates && candidates.length > 0) {
          r._suggestedParent = candidates[0];
          r._candidateParents = candidates;
        }
      }

      App.logLine(
        'ok',
        App.t('log.scanned_ok', {
          name: r.fileName,
          brand: meta.brand,
          model: meta.model,
          ecu: meta.ecuType,
          conf: meta.confidence
        })
      );

      if (autoEnabled && meta.confidence >= autoThreshold && !r._suggestedParent) {
        autoBatch.push(r);
        continue;
      }
      state.files.push(r);
      if (meta.confidence < 50)
        App.logLine(
          'warn',
          App.t('log.low_confidence', { conf: meta.confidence, name: r.fileName })
        );
      if (r._suggestedParent) {
        App.logLine(
          'info',
          App.t('log.hw_match', {
            name: r.fileName,
            id: r._suggestedParent.id,
            newName: r._suggestedParent.new_name
          })
        );
      }
    }

    if (autoBatch.length > 0) {
      App.logLine(
        'info',
        App.t('log.auto_organize_run', { n: autoBatch.length, th: autoThreshold })
      );
      if (App.toast) {
        const tk =
          autoBatch.length === 1
            ? 'toasts.auto_organize_intro_one'
            : 'toasts.auto_organize_intro_many';
        App.toast.info(App.t(tk, { n: autoBatch.length, th: autoThreshold }));
      }
      for (const r of autoBatch) await App.organizeOne(r);
    }

    if (state.files.length > 0 && state.activeFileIndex === -1) {
      state.activeFileIndex = 0;
    }
    if (state.activeFileIndex >= state.files.length) {
      state.activeFileIndex = state.files.length - 1;
    }

    App.renderFileTray();
    App.renderMetadata();
    App.$('#organize-btn').disabled = state.files.length === 0;
  };

  App.renderFileTray = function renderFileTray() {
    const state = App.state;
    const tray = App.$('#file-tray');
    tray.innerHTML = '';
    state.files.forEach((f, idx) => {
      const chip = document.createElement('div');
      chip.className = 'file-chip' + (idx === state.activeFileIndex ? ' active' : '');
      chip.innerHTML = `<span>${App.escapeHtml(f.fileName)}</span><span class="x" title="${App.escapeHtml(App.t('skinner.file_remove_title'))}">×</span>`;
      chip.addEventListener('click', (e) => {
        if (e.target.classList.contains('x')) {
          state.files.splice(idx, 1);
          if (state.activeFileIndex >= state.files.length)
            state.activeFileIndex = state.files.length - 1;
          App.renderFileTray();
          App.renderMetadata();
          App.$('#organize-btn').disabled = state.files.length === 0;
          return;
        }
        state.activeFileIndex = idx;
        App.renderFileTray();
        App.renderMetadata();
      });
      tray.appendChild(chip);
    });
  };

  /* ===== Metadata edit ===== */
  App.setupMetadataEditing = function setupMetadataEditing() {
    App.$$('.meta-input').forEach((inp) => {
      inp.addEventListener('input', () => {
        const f = App.state.files[App.state.activeFileIndex];
        if (!f) return;
        const field = inp.dataset.field;
        const value = inp.value.trim();

        if (field === 'stage') {
          f.stage = value || 'STOCK';
        } else {
          f.metadata[field] = value;
          if (!f._originalMetadata) f._originalMetadata = { ...f.metadata };
          const original = f._originalMetadata[field];
          inp.classList.toggle(
            'edited',
            value !== (original === null || original === undefined ? '' : original)
          );
        }

        App.updateMaskPreview();
      });
      inp.addEventListener('focus', () => inp.select());
    });
  };

  App.renderMetadata = function renderMetadata() {
    const $ = App.$;
    const $$ = App.$$;
    const file = App.state.files[App.state.activeFileIndex];
    const hasFile = !!file;

    $$('.meta-input').forEach((inp) => {
      inp.disabled = !hasFile;
      inp.classList.remove('edited');
      inp.value = '';
    });
    $('#tag-input').disabled = !hasFile;
    $('#tag-add-btn').disabled = !hasFile;
    $('#notes-input').disabled = !hasFile;
    $('#notes-input').value = '';

    if (!hasFile) {
      $$('.meta-confidence').forEach((el) => (el.textContent = '—'));
      App.setProtocolPills('brand-protocols', []);
      App.setProtocolPills('ecu-protocols', []);
      App.setProtocolPills('hwsw-protocols', []);
      App.renderTagList([]);
      App.renderKindCard();
      App.updateMaskPreview();
      return;
    }

    const m = file.metadata;
    App.setMetaInput('brand', m.brand);
    App.setMetaInput('model', m.model);
    App.setMetaInput('ecuType', m.ecuType);
    App.setMetaInput('hwId', m.hwId || '');
    App.setMetaInput('swId', m.swId || '');
    App.setMetaInput('stage', file.stage || 'STOCK');

    const confEl = $('[data-field="confidence"]');
    confEl.textContent = `(${m.confidence}%)`;
    confEl.classList.remove('low', 'mid', 'high');
    if (m.confidence >= 75) confEl.classList.add('high');
    else if (m.confidence >= 45) confEl.classList.add('mid');
    else confEl.classList.add('low');

    App.setProtocolPills('brand-protocols', m.protocol);
    App.setProtocolPills('ecu-protocols', m.protocol);
    App.setProtocolPills('hwsw-protocols', m.protocol);

    $('#notes-input').value = file.notes || '';
    App.renderTagList(App.splitTags(file.tags));

    App.renderKindCard();
    App.updateMaskPreview();
  };

  App.setMetaInput = function setMetaInput(field, value) {
    const el = App.$(`.meta-input[data-field="${field}"]`);
    if (el) el.value = value || '';
  };

  App.setProtocolPills = function setProtocolPills(slot, protocols) {
    const el = App.$(`[data-field="${slot}"]`);
    if (!el) return;
    el.innerHTML = '';
    const list = protocols && protocols.length ? protocols : ['OBD', 'BENCH', 'BOOT'];
    for (const p of list) {
      if (p === 'UNKNOWN') continue;
      const pill = document.createElement('span');
      pill.className = `protocol-pill ${p.toLowerCase()}`;
      pill.textContent = `[${p}]`;
      el.appendChild(pill);
    }
  };

  /* ===== Tags ===== */
  App.setupTagsAndNotes = function setupTagsAndNotes() {
    const $ = App.$;
    const addTag = (value) => {
      const f = App.state.files[App.state.activeFileIndex];
      if (!f) return;
      const v = String(value == null ? $('#tag-input').value : value).trim();
      if (!v) return;
      const tags = App.splitTags(f.tags);
      if (!tags.includes(v)) tags.push(v);
      f.tags = tags.join(',');
      // Remove from suggested if it was accepted via typing.
      if (f.suggestedTags) {
        f.suggestedTags = f.suggestedTags.filter((s) => s !== v);
      }
      $('#tag-input').value = '';
      App.renderTagList(tags);
      App.renderSuggestedTags();
    };

    $('#tag-add-btn').addEventListener('click', () => addTag());
    $('#tag-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        addTag();
      }
    });

    // Autocomplete from the SearchParser tag cache. Exclude tags already on
    // the active file so the dropdown only surfaces fresh suggestions.
    App.attachTagAutocomplete($('#tag-input'), {
      position: 'above',
      onPick: (tag) => addTag(tag),
      excludeExisting: () => {
        const f = App.state.files[App.state.activeFileIndex];
        return f ? App.splitTags(f.tags) : [];
      }
    });

    $('#notes-input').addEventListener('input', () => {
      const f = App.state.files[App.state.activeFileIndex];
      if (f) f.notes = $('#notes-input').value;
    });
  };

  App.renderTagList = function renderTagList(tags) {
    const list = App.$('#tag-list');
    list.innerHTML = '';
    for (const t of tags) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip';
      chip.setAttribute('data-color', App.getTagColor(t));
      const desc = App.state.tagDescriptions && App.state.tagDescriptions.get(t);
      if (desc) chip.title = desc;
      chip.innerHTML = `${App.escapeHtml(t)}<span class="tag-x" title="${App.escapeHtml(App.t('skinner.tag_remove_title'))}">×</span>`;
      chip.querySelector('.tag-x').addEventListener('click', () => {
        const f = App.state.files[App.state.activeFileIndex];
        if (!f) return;
        const remaining = App.splitTags(f.tags).filter((x) => x !== t);
        f.tags = remaining.join(',');
        App.renderTagList(remaining);
      });
      list.appendChild(chip);
    }
    // Re-render the suggested row each time the accepted list changes so
    // any newly-applied tags disappear from suggestions.
    App.renderSuggestedTags();
  };

  /**
   * Render the "Suggested:" chip row below the tag list. Suggestions come
   * from smart-tag rules evaluated in main on scan; the user can accept (chip
   * click) or reject (×) each one. Rejecting clears the suggestion for this
   * scan session only — the rule still fires for future scans.
   */
  App.renderSuggestedTags = function renderSuggestedTags() {
    const list = App.$('#tag-list');
    if (!list) return;
    let row = App.$('#tag-suggestion-row');
    const f = App.state.files[App.state.activeFileIndex];
    const suggested = f && Array.isArray(f.suggestedTags) ? f.suggestedTags : [];
    // Only surface suggestions that aren't already accepted.
    const accepted = new Set(f ? App.splitTags(f.tags) : []);
    const pending = suggested.filter((t) => !accepted.has(t));

    if (pending.length === 0) {
      if (row) row.remove();
      return;
    }
    if (!row) {
      row = document.createElement('div');
      row.id = 'tag-suggestion-row';
      row.className = 'tag-suggestion-row';
      list.parentElement.insertBefore(row, list.nextSibling);
    }
    row.innerHTML = '';
    const label = document.createElement('span');
    label.className = 'tag-suggestion-label';
    label.textContent = App.t('skinner.suggested_label');
    row.appendChild(label);
    for (const t of pending) {
      const chip = document.createElement('span');
      chip.className = 'tag-chip tag-suggestion-chip';
      chip.setAttribute('data-color', App.getTagColor(t));
      chip.title = App.t('skinner.suggestion_tip');
      chip.innerHTML = `${App.escapeHtml(t)} <span class="tag-suggestion-x" title="${App.escapeHtml(App.t('skinner.suggestion_dismiss_title'))}">×</span>`;
      chip.addEventListener('click', (e) => {
        if (e.target.classList.contains('tag-suggestion-x')) {
          // Dismiss without accepting.
          f.suggestedTags = (f.suggestedTags || []).filter((s) => s !== t);
          App.renderSuggestedTags();
          return;
        }
        // Accept: add to file tags.
        const tags = App.splitTags(f.tags);
        if (!tags.includes(t)) tags.push(t);
        f.tags = tags.join(',');
        f.suggestedTags = (f.suggestedTags || []).filter((s) => s !== t);
        App.renderTagList(tags);
      });
      row.appendChild(chip);
    }
  };

  /* ===== Kind (Original / Solution) ===== */
  App.setupKindControls = function setupKindControls() {
    const $ = App.$;
    const $$ = App.$$;
    $$('input[name="kind-radio"]').forEach((r) => {
      r.addEventListener('change', async (e) => {
        const f = App.state.files[App.state.activeFileIndex];
        if (!f) return;
        f.kind = e.target.value;
        if (f.kind === 'original') {
          f.parentId = null;
          f.solutionLabel = '';
        } else {
          await App.populateParentSelect(f);
          if (!f.solutionLabel) f.solutionLabel = f.stage && f.stage !== 'STOCK' ? f.stage : '';
        }
        App.renderKindCard();
        App.updateMaskPreview();
      });
    });

    $('#kind-parent-select').addEventListener('change', (e) => {
      const f = App.state.files[App.state.activeFileIndex];
      if (!f) return;
      const v = e.target.value;
      f.parentId = v ? parseInt(v, 10) : null;
    });

    $('#kind-solution-label').addEventListener('input', (e) => {
      const f = App.state.files[App.state.activeFileIndex];
      if (!f) return;
      f.solutionLabel = e.target.value.trim();
      f.stage = f.solutionLabel || f.stage;
      App.updateMaskPreview();
    });

    $('#kind-suggestion-accept').addEventListener('click', async () => {
      const f = App.state.files[App.state.activeFileIndex];
      if (!f || !f._suggestedParent) return;
      f.kind = 'solution';
      f.parentId = f._suggestedParent.id;
      if (!f.solutionLabel) f.solutionLabel = f.stage && f.stage !== 'STOCK' ? f.stage : 'MOD';
      await App.populateParentSelect(f);
      App.renderKindCard();
      App.updateMaskPreview();
      App.logLine(
        'ok',
        App.t('log.linked_as_solution', { name: f.fileName, id: f._suggestedParent.id })
      );
    });

    $('#kind-suggestion-dismiss').addEventListener('click', () => {
      const f = App.state.files[App.state.activeFileIndex];
      if (!f) return;
      f._suggestionDismissed = true;
      App.renderKindCard();
    });
  };

  App.populateParentSelect = async function populateParentSelect(file) {
    const $ = App.$;
    const select = $('#kind-parent-select');
    const candidates =
      file._candidateParents ||
      (await window.api.listOriginalsMatching({
        brand: file.metadata.brand,
        model: file.metadata.model,
        ecuType: file.metadata.ecuType,
        hwId: file.metadata.hwId
      }));
    file._candidateParents = candidates;

    select.innerHTML = '';
    if (!candidates || candidates.length === 0) {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = App.t('skinner.no_matching_original_broaden');
      select.appendChild(opt);
      $('#kind-parent-hint').textContent = App.t('skinner.parent_hint_tip');
      select.disabled = true;
      return;
    }
    select.disabled = false;
    for (const c of candidates) {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = `#${c.id} · ${c.new_name} · ${c.brand}/${c.model} · HW ${c.hw_id || '—'}`;
      if (file.parentId === c.id) opt.selected = true;
      select.appendChild(opt);
    }
    if (!file.parentId) file.parentId = candidates[0].id;
    // Hint reflects "{n} matching original(s) found" — kept simple here without
    // exposing a translated wording with awkward plurals; format-only text.
    $('#kind-parent-hint').textContent =
      `${candidates.length} matching original${candidates.length === 1 ? '' : 's'} found.`;
  };

  App.renderKindCard = function renderKindCard() {
    const $ = App.$;
    const $$ = App.$$;
    const f = App.state.files[App.state.activeFileIndex];
    const hasFile = !!f;

    $$('input[name="kind-radio"]').forEach((r) => {
      r.disabled = !hasFile;
      if (hasFile) r.checked = r.value === f.kind;
      else if (r.value === 'original') r.checked = true;
    });

    const showSolutionFields = hasFile && f.kind === 'solution';
    $('#kind-solution-fields').hidden = !showSolutionFields;
    $('#kind-solution-label').disabled = !showSolutionFields;
    if (hasFile) $('#kind-solution-label').value = f.solutionLabel || '';

    const showSuggestion =
      hasFile && f._suggestedParent && f.kind === 'original' && !f._suggestionDismissed;
    $('#kind-suggestion').hidden = !showSuggestion;
    if (showSuggestion) {
      const p = f._suggestedParent;
      $('#kind-suggestion-text').innerHTML = App.t('modal.kind_suggestion_html', {
        hw: App.escapeHtml(f.metadata.hwId || '—'),
        id: p.id,
        name: App.escapeHtml(p.new_name)
      });
    }
  };

  /* ===== Format mask + live preview ===== */
  App.setupFormatMask = function setupFormatMask() {
    App.$('#format-mask').addEventListener('input', App.updateMaskPreview);
  };

  App.updateMaskPreview = function updateMaskPreview() {
    const el = App.$('#mask-preview');
    if (!el) return;
    const f = App.state.files[App.state.activeFileIndex];
    const mask = App.$('#format-mask').value || '[BRAND]_[MODEL]_[HW]_[STAGE].bin';
    if (!f) {
      el.textContent = mask;
      return;
    }
    el.textContent = App.applyMask(mask, f.metadata, f.fileName, f.stage);
  };

  /* ===== Skinner-related buttons (organize, archive root pickers) ===== */
  App.setupSkinnerButtons = function setupSkinnerButtons() {
    const $ = App.$;
    $('#organize-btn').addEventListener('click', App.organizeAll);

    $('#db-refresh').addEventListener('click', App.refreshDatabase);
    $('#db-search').addEventListener('input', () => {
      clearTimeout(window._dbSearchT);
      window._dbSearchT = setTimeout(() => {
        // If the global search bar is active, mirror this input into it so the
        // chip parser sees the typed string and stays the single source of truth.
        const v = $('#db-search').value;
        if (typeof App.setSearchQuery === 'function') {
          App.setSearchQuery(v);
        } else {
          App.refreshDatabase();
        }
      }, 250);
    });
    $('#db-kind-filter').addEventListener('change', (e) => {
      App.state.dbKindFilter = e.target.value;
      App.state.expandedOriginals.clear();
      App.refreshDatabase();
    });

    $('#pick-archive').addEventListener('click', async () => {
      const dir = await window.api.selectDirectory();
      if (!dir) return;
      const res = await window.api.setArchiveRoot(dir);
      if (res.success) {
        App.state.archiveRoot = res.archiveRoot;
        $('#archive-root').value = App.state.archiveRoot;
        App.logLine('ok', App.t('log.archive_root_set', { path: App.state.archiveRoot }));
        if (App.toast) App.toast.success(App.t('toasts.archive_root_updated'));
      } else {
        App.logLine('err', App.t('log.archive_root_failed', { err: res.error }));
        if (App.toast) App.toast.error(App.t('toasts.archive_root_set_failed', { msg: res.error }));
      }
    });

    $('#open-archive').addEventListener('click', () => {
      if (App.state.archiveRoot) window.api.openFolder(App.state.archiveRoot);
    });
  };

  App.organizeOne = async function organizeOne(file) {
    const mask = App.$('#format-mask').value || '[BRAND]_[MODEL]_[HW]_[STAGE].bin';
    const enrichedMeta = { ...file.metadata };
    if (file.stage) enrichedMeta.stage = file.stage;

    const payload = {
      filePath: file.filePath,
      fileName: file.fileName,
      fileSize: file.fileSize,
      metadata: enrichedMeta,
      formatMask: mask,
      kind: file.kind || 'original',
      parentId: file.parentId || null,
      solutionLabel: file.solutionLabel || '',
      tags: file.tags || '',
      notes: file.notes || ''
    };

    const res = await window.api.organize(payload);

    if (res.success) {
      const folderRel = res.folder.split(/[\\/]/).slice(-4).join('/');
      App.logLine('ok', App.t('log.organize_folder_created', { folder: folderRel }));
      const kindBadge =
        file.kind === 'solution' ? App.t('kind.solution_badge') : App.t('kind.original_badge');
      App.logLine(
        'info',
        App.t('log.organize_done', { kindBadge, name: file.fileName, newName: res.newName })
      );
      if (file.tags) App.logLine('info', App.t('log.organize_tags', { tags: file.tags }));
      if (file.metadata.confidence < 75) App.logLine('warn', App.t('log.checksum_not_verified'));
      if (App.toast) App.toast.success(App.t('toasts.organized', { name: res.newName }));
    } else {
      App.logLine('err', App.t('log.organize_failed', { name: file.fileName, err: res.error }));
      if (App.toast)
        App.toast.error(App.t('log.organize_failed', { name: file.fileName, err: res.error }));
    }
    return res.success;
  };

  App.organizeAll = async function organizeAll() {
    const state = App.state;
    if (state.files.length === 0) return;
    let okCount = 0;
    const filesToProcess = [...state.files];

    for (const f of filesToProcess) {
      const success = await App.organizeOne(f);
      if (success) okCount++;
    }

    if (okCount > 0) {
      state.files = [];
      state.activeFileIndex = -1;
      App.renderFileTray();
      App.renderMetadata();
      App.$('#organize-btn').disabled = true;
    }
  };
})();
