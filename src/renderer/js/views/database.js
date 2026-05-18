/* ===== Database view =====
 * Table refresh + inline editing + send-to-comparator hand-off.
 * Adds: folder-tree sidebar (filter by brand/model/ecu) and bulk multi-select.
 */
window.App = window.App || {};

// Extend state with the new sets/maps used by tree + bulk selection.
window.App.state.expandedTreeKeys = window.App.state.expandedTreeKeys || new Set(['__root__']);
window.App.state.dbTreeFilter = window.App.state.dbTreeFilter || {};
window.App.state.selectedIds = window.App.state.selectedIds || new Set();
window.App.state.lastClickedRowId = window.App.state.lastClickedRowId || null;

(function () {
  const App = window.App;

  // ---------- helpers (internal) ----------

  function treeNodeName(value, fallback) {
    const v = value == null ? '' : String(value).trim();
    return v === '' ? fallback : v;
  }

  /**
   * Build a 3-level tree (brand -> model -> ecu_type) from a list of rows.
   * Each leaf node carries the set of file ids in its subtree (deduped).
   */
  function buildTree(rows) {
    const root = {
      key: '__root__',
      label: App.t('database.tree_root_label'),
      ids: new Set(),
      children: new Map()
    };
    const UNK = App.t('database.tree_unknown');

    for (const r of rows) {
      root.ids.add(r.id);

      const brandName = treeNodeName(r.brand, UNK);
      const brandKey = `b:${brandName.toLowerCase()}`;
      let brand = root.children.get(brandKey);
      if (!brand) {
        brand = {
          key: brandKey,
          label: brandName,
          ids: new Set(),
          children: new Map(),
          filter: { brand: brandName }
        };
        root.children.set(brandKey, brand);
      }
      brand.ids.add(r.id);

      // Skip deeper grouping for files that don't have a model.
      // We still count them under the brand, but they appear only at brand level.
      const hasModel = r.model != null && String(r.model).trim() !== '';
      if (!hasModel) continue;

      const modelName = treeNodeName(r.model, UNK);
      const modelKey = `${brandKey}/m:${modelName.toLowerCase()}`;
      let model = brand.children.get(modelKey);
      if (!model) {
        model = {
          key: modelKey,
          label: modelName,
          ids: new Set(),
          children: new Map(),
          filter: { brand: brandName, model: modelName }
        };
        brand.children.set(modelKey, model);
      }
      model.ids.add(r.id);

      const hasEcu = r.ecu_type != null && String(r.ecu_type).trim() !== '';
      if (!hasEcu) continue;

      const ecuName = treeNodeName(r.ecu_type, UNK);
      const ecuKey = `${modelKey}/e:${ecuName.toLowerCase()}`;
      let ecu = model.children.get(ecuKey);
      if (!ecu) {
        ecu = {
          key: ecuKey,
          label: ecuName,
          ids: new Set(),
          children: new Map(),
          filter: { brand: brandName, model: modelName, ecuType: ecuName }
        };
        model.children.set(ecuKey, ecu);
      }
      ecu.ids.add(r.id);
    }

    return root;
  }

  function filtersEqual(a, b) {
    return (
      (a.brand || '') === (b.brand || '') &&
      (a.model || '') === (b.model || '') &&
      (a.ecuType || '') === (b.ecuType || '')
    );
  }

  function nodeIsActive(node, filter) {
    if (node.key === '__root__') {
      return !filter.brand && !filter.model && !filter.ecuType;
    }
    return filtersEqual(node.filter || {}, filter || {});
  }

  function renderTreeNode(node, depth, state, fragment) {
    const wrap = document.createElement('div');
    wrap.className = 'tree-node';

    const row = document.createElement('div');
    row.className = 'tree-node-row';
    if (nodeIsActive(node, state.dbTreeFilter)) row.classList.add('active');
    row.dataset.key = node.key;

    const childCount = node.children ? node.children.size : 0;
    const isExpanded = state.expandedTreeKeys.has(node.key);

    const toggle = document.createElement('span');
    toggle.className = 'tree-toggle' + (childCount === 0 ? ' empty' : '');
    toggle.textContent = childCount === 0 ? '' : isExpanded ? '▼' : '▶';
    if (childCount > 0) {
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        if (state.expandedTreeKeys.has(node.key)) state.expandedTreeKeys.delete(node.key);
        else state.expandedTreeKeys.add(node.key);
        App.renderDbTree();
      });
    }
    row.appendChild(toggle);

    const label = document.createElement('span');
    label.className = 'tree-label';
    label.textContent = node.label;
    label.title = node.label;
    row.appendChild(label);

    const count = document.createElement('span');
    count.className = 'tree-count';
    count.textContent = `(${node.ids.size})`;
    row.appendChild(count);

    row.addEventListener('click', () => {
      state.dbTreeFilter = node.key === '__root__' ? {} : { ...node.filter };
      // Auto-expand on click so the user sees their context.
      if (childCount > 0) state.expandedTreeKeys.add(node.key);
      App.refreshDatabase();
    });

    wrap.appendChild(row);

    if (childCount > 0 && isExpanded) {
      const kids = document.createElement('div');
      kids.className = 'tree-children';
      // Sort children alphabetically; "Unknown" sinks to bottom.
      const UNK = App.t('database.tree_unknown');
      const sorted = Array.from(node.children.values()).sort((a, b) => {
        const au = a.label === UNK ? 1 : 0;
        const bu = b.label === UNK ? 1 : 0;
        if (au !== bu) return au - bu;
        return a.label.localeCompare(b.label);
      });
      for (const child of sorted) renderTreeNode(child, depth + 1, state, kids);
      wrap.appendChild(kids);
    }

    fragment.appendChild(wrap);
  }

  App.renderDbTree = function renderDbTree() {
    const $ = App.$;
    const state = App.state;
    const container = $('#db-tree');
    if (!container) return;

    const rows = App._dbAllRowsCache || [];
    container.innerHTML = '';

    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state-cta compact';
      empty.innerHTML = `
        <div class="empty-state-cta-icon">📂</div>
        <div class="empty-state-cta-title">${App.escapeHtml(App.t('database.empty_archive_tree_title'))}</div>
        <div class="empty-state-cta-sub">${App.escapeHtml(App.t('database.empty_archive_tree_sub'))}</div>
      `;
      container.appendChild(empty);
      return;
    }

    const tree = buildTree(rows);
    state.expandedTreeKeys.add('__root__'); // root is always considered expanded
    const frag = document.createDocumentFragment();
    renderTreeNode(tree, 0, state, frag);
    container.appendChild(frag);
  };

  function rowMatchesTreeFilter(r, filter) {
    if (!filter) return true;
    const UNK = App.t('database.tree_unknown');
    if (filter.brand && treeNodeName(r.brand, UNK) !== filter.brand) return false;
    if (filter.model && treeNodeName(r.model, UNK) !== filter.model) return false;
    if (filter.ecuType && treeNodeName(r.ecu_type, UNK) !== filter.ecuType) return false;
    return true;
  }

  // ---------- bulk action bar ----------

  function pruneSelection() {
    const known = new Set((App._dbAllRowsCache || []).map((r) => r.id));
    for (const id of Array.from(App.state.selectedIds)) {
      if (!known.has(id)) App.state.selectedIds.delete(id);
    }
  }

  function updateActionBar() {
    const $ = App.$;
    const bar = $('#db-action-bar');
    if (!bar) return;
    const n = App.state.selectedIds.size;
    if (n === 0) {
      bar.classList.remove('visible');
      // Keep hidden attribute for assistive tech once anim completes.
      setTimeout(() => {
        if (App.state.selectedIds.size === 0) bar.hidden = true;
      }, 220);
      closeAllPopovers();
      return;
    }
    bar.hidden = false;
    // Force reflow so transition triggers when un-hiding.
    void bar.offsetWidth;
    bar.classList.add('visible');
    $('#db-action-count').textContent = App.t('database.action_count_selected', { n });
    $('#db-bulk-delete-count').textContent = n;
  }

  // Exposed so sub-modules (grid, detail panel) can refresh the bar after
  // selection changes without going through a full refreshDatabase().
  App.updateDbActionBar = function updateDbActionBar() {
    updateActionBar();
    updateHeaderCheckbox();
  };

  function updateHeaderCheckbox() {
    const $ = App.$;
    const all = $('#db-select-all');
    if (!all) return;
    const visibleIds = App._dbVisibleSelectableIds || [];
    if (visibleIds.length === 0) {
      all.checked = false;
      all.indeterminate = false;
      return;
    }
    let selected = 0;
    for (const id of visibleIds) if (App.state.selectedIds.has(id)) selected++;
    all.checked = selected === visibleIds.length;
    all.indeterminate = selected > 0 && selected < visibleIds.length;
  }

  function closeAllPopovers() {
    const $ = App.$;
    const add = $('#db-add-tag-popover');
    const remove = $('#db-remove-tag-popover');
    if (add) add.hidden = true;
    if (remove) remove.hidden = true;
  }

  function togglePopover(id) {
    const $ = App.$;
    const el = $(id);
    if (!el) return;
    const willOpen = el.hidden;
    closeAllPopovers();
    if (willOpen) {
      el.hidden = false;
      const inp = el.querySelector('input, select');
      if (inp) setTimeout(() => inp.focus(), 30);
    }
  }

  async function bulkAddTag(tagRaw) {
    const tag = String(tagRaw || '').trim();
    if (!tag) return;
    const ids = Array.from(App.state.selectedIds);
    const all = App._dbAllRowsCache || [];
    const byId = new Map(all.map((r) => [r.id, r]));
    let ok = 0;
    let err = 0;
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) continue;
      const existing = App.splitTags(row.tags);
      if (existing.includes(tag)) continue;
      const merged = [...existing, tag].join(',');
      const res = await window.api.updateFile(id, { tags: merged });
      if (res && res.error) err++;
      else ok++;
    }
    // Ensure tag_meta has a row for the new tag (idempotent).
    try {
      if (window.api.upsertTagMeta) await window.api.upsertTagMeta(tag, {});
      if (App.loadTagMeta) await App.loadTagMeta();
    } catch {
      /* non-fatal */
    }
    App.logLine(
      'ok',
      err
        ? App.t('log.bulk_tag_applied_partial', { tag, ok, err })
        : App.t('log.bulk_tag_applied', { tag, ok })
    );
    if (App.toast) {
      if (err > 0) App.toast.warn(App.t('toasts.bulk_tag_partial', { tag, ok, err }));
      else {
        const tk = ok === 1 ? 'toasts.bulk_tag_applied_one' : 'toasts.bulk_tag_applied_many';
        App.toast.success(App.t(tk, { tag, ok }));
      }
    }
    await App.refreshDatabase();
    if (typeof App.refreshTagManagement === 'function') App.refreshTagManagement();
  }

  async function bulkRemoveTag(tag) {
    const t = String(tag || '').trim();
    if (!t) return;
    const ids = Array.from(App.state.selectedIds);
    const all = App._dbAllRowsCache || [];
    const byId = new Map(all.map((r) => [r.id, r]));
    let ok = 0;
    let err = 0;
    for (const id of ids) {
      const row = byId.get(id);
      if (!row) continue;
      const existing = App.splitTags(row.tags);
      if (!existing.includes(t)) continue;
      const merged = existing.filter((x) => x !== t).join(',');
      const res = await window.api.updateFile(id, { tags: merged });
      if (res && res.error) err++;
      else ok++;
    }
    App.logLine(
      'ok',
      err
        ? App.t('log.bulk_tag_removed_partial', { tag: t, ok, err })
        : App.t('log.bulk_tag_removed', { tag: t, ok })
    );
    if (App.toast) {
      if (err > 0) App.toast.warn(App.t('toasts.bulk_tag_removed_partial', { tag: t, ok, err }));
      else {
        const tk = ok === 1 ? 'toasts.bulk_tag_removed_one' : 'toasts.bulk_tag_removed_many';
        App.toast.success(App.t(tk, { tag: t, ok }));
      }
    }
    await App.refreshDatabase();
    if (typeof App.refreshTagManagement === 'function') App.refreshTagManagement();
  }

  function archiveParentDir(p) {
    if (!p) return '';
    const s = String(p);
    // Cross-platform-ish parent: last slash (either / or \).
    const idx = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
    return idx > 0 ? s.slice(0, idx) : s;
  }

  // Opens the archive folder of EACH selected row. Previously this only
  // opened the folder of the first id in `selectedIds` — when a user had rows
  // from two brands checked (e.g. Fiat + Hyundai), the action would silently
  // pick whichever id was inserted first, opening the wrong folder. Tester
  // feedback flagged this as confusing (video 1). The new behavior is:
  //
  //   - 1 row selected → opens that folder
  //   - 2-5 distinct folders → opens each (deduplicated)
  //   - 6+ distinct folders → confirmation modal before opening
  //
  // We dedupe by parent directory so checking many siblings under the same
  // ECU folder doesn't spawn N duplicate shell windows.
  const BULK_OPEN_AUTO_LIMIT = 5;

  async function bulkOpenFolder() {
    const ids = Array.from(App.state.selectedIds);
    if (ids.length === 0) return;
    const all = App._dbAllRowsCache || [];
    const rowsById = new Map(all.map((r) => [r.id, r]));

    const dirs = [];
    const seen = new Set();
    const missingPath = [];
    for (const id of ids) {
      const row = rowsById.get(id);
      if (!row || !row.archive_path) {
        missingPath.push(id);
        continue;
      }
      const dir = archiveParentDir(row.archive_path);
      if (!dir) {
        missingPath.push(id);
        continue;
      }
      if (!seen.has(dir)) {
        seen.add(dir);
        dirs.push(dir);
      }
    }

    if (dirs.length === 0) {
      App.logLine('err', App.t('log.selected_no_archive'));
      if (App.toast) App.toast.warn(App.t('toasts.open_folder_no_path'));
      return;
    }

    if (dirs.length > BULK_OPEN_AUTO_LIMIT) {
      const proceed = await App.appModal({
        title: App.t('database.open_folder_too_many_title'),
        body: App.t('database.open_folder_too_many_body_html', { n: dirs.length }),
        variant: 'choice',
        buttons: [
          { label: App.t('modal.cancel'), value: false },
          {
            label: App.t('database.open_folder_too_many_confirm', { n: dirs.length }),
            value: true,
            primary: true
          }
        ]
      });
      if (!proceed) return;
    }

    for (const dir of dirs) window.api.openFolder(dir);

    if (App.toast) {
      const tk = dirs.length === 1 ? 'toasts.open_folder_done_one' : 'toasts.open_folder_done_many';
      App.toast.success(App.t(tk, { n: dirs.length }));
    }

    if (missingPath.length > 0) {
      App.logLine('warn', App.t('log.no_folder_from_path') + ' (' + missingPath.length + ')');
    }
  }

  async function bulkDelete() {
    const ids = Array.from(App.state.selectedIds);
    if (ids.length === 0) return;
    const bodyKey =
      ids.length === 1 ? 'modal.bulk_delete_body_one_html' : 'modal.bulk_delete_body_many_html';
    const btnKey =
      ids.length === 1 ? 'modal.bulk_delete_button_one' : 'modal.bulk_delete_button_many';
    const confirmed = await App.appModal({
      title: App.t('modal.bulk_delete_title'),
      body: App.t(bodyKey, { n: ids.length }),
      variant: 'destructive',
      buttons: [
        { label: App.t('modal.cancel'), value: false },
        { label: App.t(btnKey, { n: ids.length }), value: true, destructive: true }
      ]
    });
    if (!confirmed) return;

    let ok = 0;
    let err = 0;
    // Loop (sequential) — keeps DB writes orderly and the log readable.
    for (const id of ids) {
      try {
        const res = await window.api.deleteFile(id);
        if (res && res.error) err++;
        else ok++;
      } catch (e) {
        err++;
      }
    }
    App.state.selectedIds.clear();
    App.logLine(
      'ok',
      err
        ? App.t('log.bulk_delete_done_partial', { ok, err })
        : App.t('log.bulk_delete_done', { ok })
    );
    if (App.toast) {
      if (err > 0) {
        const tk =
          ok === 1 ? 'toasts.bulk_deleted_partial_one' : 'toasts.bulk_deleted_partial_many';
        App.toast.warn(App.t(tk, { n: ok, err }));
      } else {
        const tk = ok === 1 ? 'toasts.bulk_deleted_one' : 'toasts.bulk_deleted_many';
        App.toast.success(App.t(tk, { n: ok }));
      }
    }
    await App.refreshDatabase();
  }

  // Wire up action bar buttons once (idempotent).
  function ensureActionBarWired() {
    if (App._dbActionBarWired) return;
    App._dbActionBarWired = true;
    const $ = App.$;

    const addBtn = $('#db-bulk-add-tag');
    if (addBtn) addBtn.addEventListener('click', () => togglePopover('#db-add-tag-popover'));

    const addInput = $('#db-add-tag-input');
    if (addInput) {
      addInput.addEventListener('keydown', async (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const v = addInput.value;
          addInput.value = '';
          closeAllPopovers();
          await bulkAddTag(v);
        } else if (e.key === 'Escape') {
          closeAllPopovers();
        }
      });
      // Autocomplete: exclude tags that are already present on ALL selected
      // rows (so the dropdown surfaces tags the user actually needs to add).
      if (typeof App.attachTagAutocomplete === 'function') {
        App.attachTagAutocomplete(addInput, {
          position: 'above',
          onPick: async (tag) => {
            addInput.value = '';
            closeAllPopovers();
            await bulkAddTag(tag);
          },
          excludeExisting: () => {
            const all = App._dbAllRowsCache || [];
            const byId = new Map(all.map((r) => [r.id, r]));
            const ids = Array.from(App.state.selectedIds);
            if (ids.length === 0) return [];
            // Intersection: tags present on EVERY selected file. Anything not
            // in the intersection is still useful to add to the rest.
            let intersection = null;
            for (const id of ids) {
              const row = byId.get(id);
              if (!row) continue;
              const tags = new Set(App.splitTags(row.tags));
              if (intersection === null) intersection = tags;
              else {
                for (const t of Array.from(intersection)) {
                  if (!tags.has(t)) intersection.delete(t);
                }
              }
            }
            return intersection ? Array.from(intersection) : [];
          }
        });
      }
    }

    const removeBtn = $('#db-bulk-remove-tag');
    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        // Populate dropdown with tags present on at least one selected file.
        const sel = $('#db-remove-tag-select');
        if (sel) {
          sel.innerHTML = '';
          const all = App._dbAllRowsCache || [];
          const byId = new Map(all.map((r) => [r.id, r]));
          const tagSet = new Set();
          for (const id of App.state.selectedIds) {
            const row = byId.get(id);
            if (!row) continue;
            for (const t of App.splitTags(row.tags)) tagSet.add(t);
          }
          if (tagSet.size === 0) {
            const opt = document.createElement('option');
            opt.value = '';
            opt.textContent = App.t('database.action_remove_tag_no_tags');
            sel.appendChild(opt);
            sel.disabled = true;
          } else {
            sel.disabled = false;
            for (const t of Array.from(tagSet).sort()) {
              const opt = document.createElement('option');
              opt.value = t;
              opt.textContent = t;
              sel.appendChild(opt);
            }
          }
        }
        togglePopover('#db-remove-tag-popover');
      });
    }

    const removeConfirm = $('#db-remove-tag-confirm');
    if (removeConfirm) {
      removeConfirm.addEventListener('click', async () => {
        const sel = $('#db-remove-tag-select');
        if (!sel || !sel.value) return;
        const v = sel.value;
        closeAllPopovers();
        await bulkRemoveTag(v);
      });
    }

    const openBtn = $('#db-bulk-open-folder');
    if (openBtn) openBtn.addEventListener('click', bulkOpenFolder);

    const delBtn = $('#db-bulk-delete');
    if (delBtn) delBtn.addEventListener('click', bulkDelete);

    const clearBtn = $('#db-bulk-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        App.state.selectedIds.clear();
        App.state.lastClickedRowId = null;
        updateActionBar();
        updateHeaderCheckbox();
        // Refresh visual selection on rows without a full reload.
        document.querySelectorAll('#db-tbody tr.row-selected').forEach((tr) => {
          tr.classList.remove('row-selected');
          const cb = tr.querySelector('.db-row-checkbox');
          if (cb) cb.checked = false;
        });
      });
    }

    // Header "select all visible" checkbox. The thead is re-rendered on every
    // refresh (column config can change order/widths), so the static element
    // is replaced — we use event delegation on the table to stay wired.
    const tableEl = $('#db-table');
    if (tableEl) {
      tableEl.addEventListener('change', (e) => {
        const target = e.target;
        if (!target || target.id !== 'db-select-all') return;
        const selectAll = target;
        const visible = App._dbVisibleSelectableIds || [];
        if (selectAll.checked) {
          for (const id of visible) App.state.selectedIds.add(id);
        } else {
          for (const id of visible) App.state.selectedIds.delete(id);
        }
        // Re-apply row classes/checkbox state without a full refresh.
        document.querySelectorAll('#db-tbody tr[data-id]').forEach((tr) => {
          const id = parseInt(tr.dataset.id, 10);
          if (Number.isNaN(id)) return;
          const cb = tr.querySelector('.db-row-checkbox');
          const isSel = App.state.selectedIds.has(id);
          if (cb) cb.checked = isSel;
          tr.classList.toggle('row-selected', isSel);
        });
        updateActionBar();
        updateHeaderCheckbox();
      });
    }

    // Click-outside to dismiss popovers.
    document.addEventListener('click', (e) => {
      const inBar = e.target.closest('.db-action-bar');
      if (!inBar) closeAllPopovers();
    });
  }

  // ---------- column-driven cell renderer ----------
  // Maps a column id to the HTML for that cell on a given row. Each entry
  // returns an outer <td>...</td> string so the row template can join them
  // straight into the row's innerHTML.
  //
  // Kept out of refreshDatabase to keep that function readable and so that
  // future columns can be added by extending only this object.
  function cellHtmlFor(col, row, ctx) {
    const escapeHtml = App.escapeHtml;
    const splitTags = App.splitTags;
    const formatBytes = App.formatBytes;
    const state = App.state;
    switch (col.id) {
      case 'select': {
        const checked = state.selectedIds.has(row.id) ? 'checked' : '';
        return `<td class="db-checkbox-cell"><input type="checkbox" class="db-row-checkbox" data-row-id="${row.id}" ${checked} /></td>`;
      }
      case 'expand': {
        const childCount =
          row.kind === 'original' && ctx.solutionsByParent[row.id]
            ? ctx.solutionsByParent[row.id].length
            : 0;
        const isExpanded = state.expandedOriginals.has(row.id);
        const titleKey =
          childCount === 1 ? 'database.card_solutions_one' : 'database.card_solutions_many';
        const btn =
          row.kind === 'original' && childCount > 0
            ? `<button class="db-expand-btn ${isExpanded ? 'expanded' : ''}" data-toggle-id="${row.id}" title="${App.escapeHtml(App.t(titleKey, { n: childCount }))}">▶</button>`
            : `<button class="db-expand-btn no-children" disabled></button>`;
        return `<td>${btn}</td>`;
      }
      case 'kind':
        return `<td><span class="kind-badge kind-${row.kind}">${row.kind.toUpperCase()}</span></td>`;
      case 'brand':
        return `<td class="editable" data-col="brand">${escapeHtml(row.brand || '?')}</td>`;
      case 'model':
        return `<td class="editable" data-col="model">${escapeHtml(row.model || '?')}</td>`;
      case 'ecu_type':
        return `<td class="editable" data-col="ecu_type">${escapeHtml(row.ecu_type || '?')}</td>`;
      case 'hw_id':
        return `<td class="editable" data-col="hw_id">${escapeHtml(row.hw_id || '—')}</td>`;
      case 'sw_id':
        return `<td class="editable" data-col="sw_id">${escapeHtml(row.sw_id || '—')}</td>`;
      case 'solution': {
        const childCount =
          row.kind === 'original' && ctx.solutionsByParent[row.id]
            ? ctx.solutionsByParent[row.id].length
            : 0;
        const html =
          row.kind === 'solution'
            ? `<span class="editable" data-col="solution_label">${escapeHtml(row.solution_label || '—')}</span>`
            : childCount > 0
              ? `<span class="hint">${escapeHtml(App.t(childCount === 1 ? 'database.card_solutions_one' : 'database.card_solutions_many', { n: childCount }))}</span>`
              : '—';
        return `<td>${html}</td>`;
      }
      case 'new_name':
        return `<td>${escapeHtml(row.new_name)}</td>`;
      case 'tags': {
        const tagsHtml = splitTags(row.tags)
          .map(
            (t) =>
              `<span class="tag-chip-mini" data-tag="${escapeHtml(t)}" data-color="${escapeHtml(App.getTagColor(t))}" title="${escapeHtml(App.t('database.no_tags_chip_title'))}">${escapeHtml(t)}</span>`
          )
          .join('');
        return `<td class="editable" data-col="tags">${tagsHtml || `<span class="hint">${escapeHtml(App.t('database.tags_empty'))}</span>`}</td>`;
      }
      case 'confidence':
        return `<td>${row.confidence}%</td>`;
      case 'file_size':
        return `<td>${formatBytes(row.file_size)}</td>`;
      case 'created_at':
        return `<td>${row.created_at ? new Date(row.created_at * 1000).toLocaleString() : '—'}</td>`;
      case 'actions':
        return `<td>
          <button class="db-compare-btn" data-cmp-id="${row.id}" title="${App.escapeHtml(App.t('database.row_compare_title'))}">↔</button>
          <button class="row-delete" data-id="${row.id}" title="${App.escapeHtml(App.t('database.row_delete_title'))}">✕</button>
        </td>`;
      default:
        return `<td></td>`;
    }
  }

  // ---------- main refresh ----------

  App.refreshDatabase = async function refreshDatabase() {
    const $ = App.$;
    const state = App.state;

    ensureActionBarWired();

    // First mount: load persisted view settings (mode/density/columns/group-by).
    if (!App._dbViewStateLoaded) {
      App._dbViewStateLoaded = true;
      if (typeof App.loadDatabaseViewState === 'function') {
        await App.loadDatabaseViewState();
      }
      // Apply persisted state to DOM controls + body class.
      if (typeof App.applyDbDensity === 'function') App.applyDbDensity(state.dbDensity);
      if (typeof App.applyDbViewMode === 'function') App.applyDbViewMode(state.dbViewMode);
      if (typeof App.syncDbGroupBySelect === 'function') App.syncDbGroupBySelect();
      // One-shot wiring for the new controls.
      if (typeof App.ensureDbViewModeWired === 'function') App.ensureDbViewModeWired();
      if (typeof App.ensureDbDensityWired === 'function') App.ensureDbDensityWired();
      if (typeof App.ensureDbGroupBySelectWired === 'function') App.ensureDbGroupBySelectWired();
      if (typeof App.ensureDbDetailPanelWired === 'function') App.ensureDbDetailPanelWired();
    }

    const dbSearchValue = $('#db-search').value.trim();
    const kindFilter = state.dbKindFilter;
    const treeFilter = state.dbTreeFilter || {};

    // Prefer the parsed query from the global topbar (chips + free text). When
    // the user typed something directly into the db-search input, fall back to
    // parsing that string with the same parser so both inputs share semantics.
    let parsed = null;
    if (App.SearchParser) {
      if (typeof App.getActiveSearchParsed === 'function') {
        parsed = App.getActiveSearchParsed();
      }
      // If the global bar is empty but db-search has content, parse that instead.
      const globalEmpty =
        !parsed ||
        (!parsed.search &&
          (!parsed.filters ||
            (!parsed.filters.brand &&
              !parsed.filters.model &&
              !parsed.filters.ecu &&
              !parsed.filters.hw &&
              !parsed.filters.sw &&
              !(parsed.filters.tags && parsed.filters.tags.length) &&
              !parsed.filters.kind &&
              !parsed.filters.conf &&
              !parsed.filters.protocol &&
              !(parsed.filters.has && parsed.filters.has.length))));
      if (globalEmpty && dbSearchValue) {
        parsed = App.SearchParser.parse(dbSearchValue);
      }
    }

    // Single source of truth — fetch all once, then filter client-side. This
    // lets the tree count by full hierarchy while the table reflects user filters.
    const allRows = await window.api.listFiles({});
    App._dbAllRowsCache = allRows;

    // Rebuild the suggestion cache from the same rows so autocomplete stays in
    // sync after inserts/edits/deletes without an extra IPC round-trip.
    if (App.SearchParser && App.SearchParser._cache) {
      try {
        const cache = App.SearchParser._cache;
        const brands = new Set();
        const models = new Set();
        const ecus = new Set();
        const hws = new Set();
        const sws = new Set();
        const tags = new Set();
        for (const r of allRows) {
          if (r.brand) brands.add(String(r.brand));
          if (r.model) models.add(String(r.model));
          if (r.ecu_type) ecus.add(String(r.ecu_type));
          if (r.hw_id) hws.add(String(r.hw_id));
          if (r.sw_id) sws.add(String(r.sw_id));
          if (r.tags) {
            for (const t of String(r.tags).split(',')) {
              const tt = t.trim();
              if (tt) tags.add(tt);
            }
          }
        }
        cache.brands = Array.from(brands).sort();
        cache.models = Array.from(models).sort();
        cache.ecuTypes = Array.from(ecus).sort();
        cache.hwIds = Array.from(hws).sort();
        cache.swIds = Array.from(sws).sort();
        cache.tags = Array.from(tags).sort();
        cache.size =
          cache.brands.length +
          cache.models.length +
          cache.ecuTypes.length +
          cache.hwIds.length +
          cache.swIds.length +
          cache.tags.length;
        cache.ready = true;
      } catch {
        /* non-fatal */
      }
    }

    pruneSelection();

    // Apply parsed filters first (chips + free text), then legacy filters.
    let rows = allRows;
    if (parsed) {
      rows = App.SearchParser.applyClientSideFilters(rows, parsed);
      // Free-text portion: scan the row blob like the legacy behaviour
      const lcSearch = (parsed.search || '').toLowerCase();
      if (lcSearch) {
        rows = rows.filter((r) => {
          const blob = [
            r.new_name,
            r.original_name,
            r.brand,
            r.model,
            r.ecu_type,
            r.hw_id,
            r.sw_id,
            r.tags,
            r.solution_label,
            r.notes
          ]
            .filter(Boolean)
            .join(' ')
            .toLowerCase();
          return blob.includes(lcSearch);
        });
      }
    }

    if (kindFilter === 'original') rows = rows.filter((r) => r.kind === 'original');
    else if (kindFilter === 'solution') rows = rows.filter((r) => r.kind === 'solution');
    else if (kindFilter === 'orphan')
      rows = rows.filter((r) => r.kind === 'solution' && !r.parent_id);

    // Tree filter — applied on top of search/kind.
    rows = rows.filter((r) => rowMatchesTreeFilter(r, treeFilter));

    // Render the tree first (it doesn't depend on filters except for counts that
    // reflect the full archive — we keep tree counts as global on purpose so the
    // user sees the whole archive structure even while a filter is active).
    App.renderDbTree();

    // Re-render the table header from the column config (sort indicator,
    // widths, resize handles all live there).
    if (typeof App.renderDbThead === 'function') App.renderDbThead();

    const solutionsByParent = {};
    for (const r of allRows) {
      if (r.kind === 'solution' && r.parent_id) {
        (solutionsByParent[r.parent_id] = solutionsByParent[r.parent_id] || []).push(r);
      }
    }

    // Determine the flat list of rows to render (after sort + expansion).
    // Sort is applied first — group-by sees already-sorted rows so each
    // section preserves the user's chosen order.
    let sortedRows = rows;
    if (typeof App.sortDbRows === 'function') {
      sortedRows = App.sortDbRows(rows);
    }

    const visibleRows = [];
    if (kindFilter === '' || kindFilter === 'original') {
      for (const r of sortedRows) {
        if (r.kind !== 'original') {
          if (kindFilter === '') visibleRows.push(r);
          continue;
        }
        visibleRows.push(r);
        if (state.expandedOriginals.has(r.id) && solutionsByParent[r.id]) {
          for (const child of solutionsByParent[r.id]) {
            // Children are expanded inline regardless of tree filter so users
            // never lose sight of a solution that hangs off a visible original.
            visibleRows.push(child);
          }
        }
      }
    } else {
      for (const r of sortedRows) visibleRows.push(r);
    }

    // Compute group-by sections (empty array = ungrouped).
    const groups = typeof App.groupDbRows === 'function' ? App.groupDbRows(visibleRows) : [];

    // Dispatch to grid render when active. Grid mode owns its own selection
    // wiring; we still update the action bar at the end.
    if (state.dbViewMode === 'grid' && typeof App.renderDbGrid === 'function') {
      App.renderDbGrid(visibleRows, groups);
      updateActionBar();
      updateHeaderCheckbox();
      return;
    }

    const tbody = $('#db-tbody');
    tbody.innerHTML = '';

    const cols = typeof App.getDbVisibleColumns === 'function' ? App.getDbVisibleColumns() : [];
    const colSpan = Math.max(1, cols.length);

    if (visibleRows.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = colSpan;
      td.className = 'db-empty-cell';
      // Distinguish "archive truly empty" from "filters returned nothing" so
      // the CTA matches the user's actual situation.
      const archiveEmpty = allRows.length === 0;
      const esc = App.escapeHtml;
      if (archiveEmpty) {
        td.innerHTML = `
          <div class="empty-state-cta">
            <div class="empty-state-cta-icon">📂</div>
            <div class="empty-state-cta-title">${esc(App.t('database.empty_archive_title'))}</div>
            <div class="empty-state-cta-sub">
              ${esc(App.t('database.empty_archive_sub'))}
            </div>
            <div class="empty-state-cta-actions">
              <button class="btn-primary" id="db-empty-goto-skinner">${esc(App.t('database.empty_archive_cta'))}</button>
            </div>
          </div>
        `;
      } else {
        td.innerHTML = `
          <div class="empty-state-cta">
            <div class="empty-state-cta-icon">🔍</div>
            <div class="empty-state-cta-title">${esc(App.t('database.no_match_title'))}</div>
            <div class="empty-state-cta-sub">
              ${esc(App.t('database.no_match_sub'))}
            </div>
            <div class="empty-state-cta-actions">
              <button class="btn-secondary" id="db-empty-clear-filters">${esc(App.t('database.no_match_cta'))}</button>
            </div>
          </div>
        `;
      }
      tr.appendChild(td);
      tbody.appendChild(tr);
      App._dbVisibleSelectableIds = [];
      updateActionBar();
      updateHeaderCheckbox();
      const gotoBtn = document.getElementById('db-empty-goto-skinner');
      if (gotoBtn) gotoBtn.addEventListener('click', () => App.switchView('skinner'));
      const clearBtn = document.getElementById('db-empty-clear-filters');
      if (clearBtn) {
        clearBtn.addEventListener('click', () => {
          state.dbKindFilter = '';
          state.dbTreeFilter = {};
          const ks = document.getElementById('db-kind-filter');
          if (ks) ks.value = '';
          const dbs = document.getElementById('db-search');
          if (dbs) dbs.value = '';
          if (typeof App.setSearchQuery === 'function') App.setSearchQuery('');
          App.refreshDatabase();
        });
      }
      return;
    }

    const ctx = { solutionsByParent };

    const renderRowDOM = (r) => {
      const tr = document.createElement('tr');
      tr.dataset.id = r.id;
      if (r.kind === 'solution') tr.classList.add('solution-row');
      if (state.selectedIds.has(r.id)) tr.classList.add('row-selected');
      tr.innerHTML = cols.map((c) => cellHtmlFor(c, r, ctx)).join('');
      return tr;
    };

    const buildGroupHeaderRow = (group) => {
      const collapsed = App.isDbGroupCollapsed(group.key);
      const tr = document.createElement('tr');
      tr.className = 'db-group-row' + (collapsed ? ' collapsed' : '');
      tr.dataset.groupKey = group.key;
      tr.innerHTML = `
        <td colspan="${colSpan}">
          <span class="db-group-toggle">${collapsed ? '▶' : '▼'}</span>
          <span class="db-group-label">${App.escapeHtml(group.label)}</span>
          <span class="db-group-count">${group.rows.length}</span>
        </td>
      `;
      tr.addEventListener('click', () => {
        App.toggleDbGroupCollapsed(group.key);
        App.refreshDatabase();
      });
      return tr;
    };

    // Batch all DOM into one fragment so the browser only paints once.
    const frag = document.createDocumentFragment();
    const renderedIds = [];

    if (groups.length > 0) {
      for (const g of groups) {
        frag.appendChild(buildGroupHeaderRow(g));
        if (App.isDbGroupCollapsed(g.key)) continue;
        for (const r of g.rows) {
          frag.appendChild(renderRowDOM(r));
          renderedIds.push(r.id);
        }
      }
    } else {
      for (const r of visibleRows) {
        frag.appendChild(renderRowDOM(r));
        renderedIds.push(r.id);
      }
    }
    tbody.appendChild(frag);

    // Track which ids are currently selectable from the rendered table (for
    // the "select all" checkbox + Shift+click range logic). De-dupe because
    // group-by 'tag' can repeat the same row id under multiple buckets.
    App._dbVisibleSelectableIds = Array.from(new Set(renderedIds));

    // --- existing handlers ---
    tbody.querySelectorAll('.db-expand-btn[data-toggle-id]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.toggleId, 10);
        if (state.expandedOriginals.has(id)) state.expandedOriginals.delete(id);
        else state.expandedOriginals.add(id);
        App.refreshDatabase();
      });
    });

    tbody.querySelectorAll('.row-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        await window.api.deleteFile(id);
        state.selectedIds.delete(id);
        App.refreshDatabase();
        App.logLine('info', App.t('log.row_removed', { id: btn.dataset.id }));
        if (App.toast) App.toast.success(App.t('toasts.file_removed_from_index'));
      });
    });

    tbody.querySelectorAll('.tag-chip-mini').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        // Promote into a parsed chip on the global search bar when available, so
        // the click stacks alongside existing filters instead of clobbering them.
        const tag = chip.dataset.tag;
        if (typeof App.setSearchQuery === 'function' && App.SearchParser) {
          const parsed = App.getActiveSearchParsed
            ? App.getActiveSearchParsed()
            : { filters: {}, search: '' };
          parsed.filters = parsed.filters || { tags: [] };
          parsed.filters.tags = parsed.filters.tags || [];
          if (!parsed.filters.tags.includes(tag)) parsed.filters.tags.push(tag);
          App.setSearchQuery(App.SearchParser.format(parsed));
        } else {
          $('#db-search').value = tag;
          App.refreshDatabase();
        }
      });
    });

    tbody.querySelectorAll('.editable').forEach((cell) => {
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        App.startEditingDbCell(cell);
      });
    });

    tbody.querySelectorAll('.db-compare-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.cmpId, 10);
        await App.sendToComparator(id, btn);
      });
    });

    // --- new: row checkbox + row-click selection ---
    tbody.querySelectorAll('.db-row-checkbox').forEach((cb) => {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        const id = parseInt(cb.dataset.rowId, 10);
        if (Number.isNaN(id)) return;
        const tr = cb.closest('tr');
        if (cb.checked) {
          state.selectedIds.add(id);
          if (tr) tr.classList.add('row-selected');
        } else {
          state.selectedIds.delete(id);
          if (tr) tr.classList.remove('row-selected');
        }
        state.lastClickedRowId = id;
        updateActionBar();
        updateHeaderCheckbox();
      });
    });

    // Row body click → open the detail panel. Shift-click extends selection.
    // Plain clicks toggle the row's selection state when shift is held; a
    // plain click without shift now opens the detail panel (more discoverable
    // and matches the spec). The checkbox is still the canonical "select"
    // gesture.
    tbody.querySelectorAll('tr[data-id]').forEach((tr) => {
      tr.addEventListener('click', (e) => {
        const t = e.target;
        if (
          t.closest('button') ||
          t.closest('.editable') ||
          t.closest('.tag-chip-mini') ||
          t.closest('.db-row-checkbox')
        ) {
          return;
        }
        const id = parseInt(tr.dataset.id, 10);
        if (Number.isNaN(id)) return;

        if (e.shiftKey) {
          const ids = App._dbVisibleSelectableIds || [];
          if (state.lastClickedRowId != null) {
            const a = ids.indexOf(state.lastClickedRowId);
            const b = ids.indexOf(id);
            if (a !== -1 && b !== -1) {
              const [lo, hi] = a < b ? [a, b] : [b, a];
              for (let i = lo; i <= hi; i++) state.selectedIds.add(ids[i]);
            } else {
              state.selectedIds.add(id);
            }
          } else {
            state.selectedIds.add(id);
          }
          state.lastClickedRowId = id;
          // Repaint selection without a full table re-render.
          document.querySelectorAll('#db-tbody tr[data-id]').forEach((row) => {
            const rid = parseInt(row.dataset.id, 10);
            const isSel = state.selectedIds.has(rid);
            row.classList.toggle('row-selected', isSel);
            const c = row.querySelector('.db-row-checkbox');
            if (c) c.checked = isSel;
          });
          updateActionBar();
          updateHeaderCheckbox();
        } else {
          state.lastClickedRowId = id;
          if (typeof App.openDbDetailPanel === 'function') {
            App.openDbDetailPanel(id);
          }
        }
      });
    });

    updateActionBar();
    updateHeaderCheckbox();
  };

  App.sendToComparator = async function sendToComparator(fileId, btnEl) {
    const App = window.App;
    const all = await window.api.listFiles({});
    const file = all.find((f) => f.id === fileId);
    if (!file) {
      App.logLine('err', App.t('log.file_not_found', { id: fileId }));
      return;
    }

    if (!App._compareArmedId) {
      App._compareArmedId = fileId;
      if (btnEl) btnEl.classList.add('armed');
      App.cmpState.fileA = null;
      App.cmpState.fileB = null;
      App.assignCmpSlot('a', file.archive_path, file);
      App.logLine('ok', App.t('log.loaded_into_a', { id: fileId }));
    } else if (App._compareArmedId === fileId) {
      App._compareArmedId = null;
      document
        .querySelectorAll('.db-compare-btn.armed')
        .forEach((b) => b.classList.remove('armed'));
      App.logLine('info', App.t('log.compare_cleared'));
    } else {
      App.assignCmpSlot('b', file.archive_path, file);
      App._compareArmedId = null;
      document
        .querySelectorAll('.db-compare-btn.armed')
        .forEach((b) => b.classList.remove('armed'));
      App.switchView('compare');
      setTimeout(() => App.runComparison(), 150);
    }
  };

  App.startEditingDbCell = function startEditingDbCell(cell) {
    const state = App.state;
    if (state.editingDbCell) return;
    state.editingDbCell = cell;

    // Resolve the file id from the parent <tr> (table view) OR fall back to
    // a `data-file-id` attribute (detail panel reuses this same editor).
    const tr = cell.closest('tr');
    let id = null;
    if (tr && tr.dataset && tr.dataset.id) {
      id = parseInt(tr.dataset.id, 10);
    } else if (cell.dataset && cell.dataset.fileId) {
      id = parseInt(cell.dataset.fileId, 10);
    } else if (state.dbDetailFileId != null) {
      // Last resort: the panel always tracks its open file id.
      id = state.dbDetailFileId;
    }
    if (id == null || Number.isNaN(id)) {
      state.editingDbCell = null;
      return;
    }
    const col = cell.dataset.col;

    let currentValue;
    if (col === 'tags') {
      currentValue = Array.from(cell.querySelectorAll('.tag-chip-mini'))
        .map((c) => c.dataset.tag)
        .join(', ');
    } else {
      const t = cell.textContent.trim();
      currentValue = t === '?' || t === '—' ? '' : t;
    }

    const input = document.createElement('input');
    input.type = 'text';
    input.value = currentValue;
    input.style.width = '100%';
    input.style.padding = '4px 6px';
    input.style.background = 'var(--bg-input)';
    input.style.border = '1px solid var(--accent)';
    input.style.color = 'var(--text)';
    input.style.borderRadius = '4px';
    input.style.fontFamily = 'inherit';
    input.style.fontSize = '12px';

    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    const finish = async (commit) => {
      if (!state.editingDbCell) return;
      state.editingDbCell = null;
      if (!commit) {
        App.refreshDatabase();
        return;
      }

      const newValue = input.value.trim();
      if (newValue === currentValue) {
        App.refreshDatabase();
        return;
      }

      const updates = {};
      if (col === 'tags') {
        updates.tags = newValue
          .split(/[,;]+/)
          .map((s) => s.trim())
          .filter(Boolean)
          .join(',');
      } else {
        updates[col] = newValue;
      }

      const res = await window.api.updateFile(id, updates);
      if (res.error) App.logLine('err', App.t('log.row_update_failed', { err: res.error }));
      else
        App.logLine(
          'ok',
          App.t('log.row_updated', { id, col, value: newValue || App.t('log.row_update_cleared') })
        );
      App.refreshDatabase();
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  };
})();
