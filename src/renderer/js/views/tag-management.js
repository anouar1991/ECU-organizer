/* ===== Tag Management view =====
 * Lets the user rename, recolor, describe, merge, and delete tags, and edit
 * the smart-tag rules that auto-suggest tags at scan time.
 *
 * State source of truth lives in the backend (tag_meta + tag_rules tables);
 * this view re-reads via window.api on every refresh so external bulk edits
 * (e.g. via the bulk-action bar) show up immediately when the user returns.
 */
window.App = window.App || {};

(function () {
  const App = window.App;

  // Static IDs; labels are resolved via App.t at render time so locale changes
  // re-translate without a module reload.
  const RULE_FIELDS = [
    { id: 'filename', key: 'tag_management.rule_field_filename' },
    { id: 'brand', key: 'tag_management.rule_field_brand' },
    { id: 'model', key: 'tag_management.rule_field_model' },
    { id: 'ecu_type', key: 'tag_management.rule_field_ecu_type' },
    { id: 'hw_id', key: 'tag_management.rule_field_hw_id' },
    { id: 'sw_id', key: 'tag_management.rule_field_sw_id' },
    { id: 'confidence', key: 'tag_management.rule_field_confidence' }
  ];

  const RULE_OPS_STRING = [
    { id: 'contains', key: 'tag_management.rule_op_contains' },
    { id: 'equals', key: 'tag_management.rule_op_equals' },
    { id: 'startsWith', key: 'tag_management.rule_op_starts_with' },
    { id: 'endsWith', key: 'tag_management.rule_op_ends_with' },
    { id: 'regex', key: 'tag_management.rule_op_regex' }
  ];

  const RULE_OPS_NUMERIC = [
    { id: 'gt', key: 'tag_management.rule_op_gt' },
    { id: 'lt', key: 'tag_management.rule_op_lt' },
    { id: 'equals', key: 'tag_management.rule_op_equals_n' },
    { id: 'range', key: 'tag_management.rule_op_range' }
  ];

  function opsForField(field) {
    return field === 'confidence' ? RULE_OPS_NUMERIC : RULE_OPS_STRING;
  }

  /**
   * One-shot wiring for the toolbar buttons + tab switcher. Idempotent so the
   * view can be re-mounted without leaking listeners.
   */
  App.setupTagManagement = function setupTagManagement() {
    if (App._tagManagementWired) return;
    App._tagManagementWired = true;

    const tabs = document.querySelectorAll('.tm-tab');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const which = tab.dataset.tab;
        tabs.forEach((t) => t.classList.toggle('active', t === tab));
        document.querySelectorAll('.tm-panel').forEach((p) => {
          p.hidden = p.dataset.tab !== which;
        });
        if (which === 'rules') App.refreshTagRulesList();
      });
    });

    const newBtn = App.$('#tm-new-tag-btn');
    const newInput = App.$('#tm-new-tag-name');
    const onCreate = async () => {
      const v = (newInput.value || '').trim();
      if (!v) return;
      const res = await window.api.upsertTagMeta(v, { color: 'gray', description: '' });
      if (res && res.error) {
        App.logLine('err', App.t('log.tag_create_failed', { err: res.error }));
        if (App.toast) App.toast.error(App.t('toasts.tag_create_failed', { msg: res.error }));
        return;
      }
      newInput.value = '';
      await App.loadTagMeta();
      App.refreshTagManagement();
      App.logLine('ok', App.t('log.tag_created', { name: v }));
      if (App.toast) App.toast.success(App.t('toasts.tag_created', { name: v }));
    };
    if (newBtn) newBtn.addEventListener('click', onCreate);
    if (newInput) {
      newInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onCreate();
        }
      });
    }

    const searchInput = App.$('#tm-search');
    if (searchInput) {
      searchInput.addEventListener('input', () => {
        App._tmSearchQuery = (searchInput.value || '').trim().toLowerCase();
        App.refreshTagManagement();
      });
    }

    const newRuleBtn = App.$('#tm-new-rule-btn');
    if (newRuleBtn) {
      newRuleBtn.addEventListener('click', async () => {
        const res = await window.api.createTagRule({
          name: App.t('tag_management.new_rule_name'),
          enabled: true,
          match_field: 'filename',
          match_op: 'contains',
          match_value: '',
          tag_to_add: App.t('tag_management.new_rule_tag')
        });
        if (res && res.error) {
          App.logLine('err', App.t('log.rule_create_failed', { err: res.error }));
          return;
        }
        await App.refreshTagRulesList();
      });
    }
  };

  /* ===== Tags tab ===== */

  App.refreshTagManagement = async function refreshTagManagement() {
    App.setupTagManagement();
    const tbody = App.$('#tm-tbody');
    if (!tbody) return;

    const list = (await window.api.listTagMeta()) || [];
    // Keep the global tag-color cache in sync — caller may have edited.
    if (typeof App.loadTagMeta === 'function') await App.loadTagMeta();

    const query = App._tmSearchQuery || '';
    const filtered = query ? list.filter((t) => t.name.toLowerCase().includes(query)) : list;

    tbody.innerHTML = '';
    if (filtered.length === 0) {
      const tr = document.createElement('tr');
      const td = document.createElement('td');
      td.colSpan = 5;
      const esc = App.escapeHtml;
      if (query) {
        td.innerHTML = `
          <div class="empty-state-cta">
            <div class="empty-state-cta-icon">🔍</div>
            <div class="empty-state-cta-title">${esc(App.t('tag_management.empty_with_query_title', { q: esc(query) }))}</div>
            <div class="empty-state-cta-sub">${esc(App.t('tag_management.empty_with_query_sub'))}</div>
          </div>
        `;
      } else {
        td.innerHTML = `
          <div class="empty-state-cta">
            <div class="empty-state-cta-icon">🏷</div>
            <div class="empty-state-cta-title">${esc(App.t('tag_management.empty_no_tags_title'))}</div>
            <div class="empty-state-cta-sub">
              ${esc(App.t('tag_management.empty_no_tags_sub'))}
            </div>
          </div>
        `;
      }
      tr.appendChild(td);
      tbody.appendChild(tr);
      // Refresh rules tab anyway so the autocomplete suggestion list stays warm.
      if (typeof App.refreshTagRulesList === 'function') App.refreshTagRulesList();
      return;
    }

    for (const tag of filtered) {
      tbody.appendChild(buildTagRow(tag));
    }
  };

  function buildTagRow(tag) {
    const tr = document.createElement('tr');
    tr.dataset.tagName = tag.name;
    tr.className = 'tm-row';

    // Color dot + picker.
    const colorTd = document.createElement('td');
    colorTd.className = 'tm-cell-color';
    const dot = document.createElement('span');
    dot.className = 'tm-color-dot tag-chip';
    dot.setAttribute('data-color', tag.color || 'gray');
    dot.title = App.t('tag_management.color_change_title');
    dot.textContent = ' ';
    dot.addEventListener('click', () => openColorPicker(tag.name, dot));
    colorTd.appendChild(dot);
    tr.appendChild(colorTd);

    // Name — click to rename inline.
    const nameTd = document.createElement('td');
    nameTd.className = 'tm-cell-name';
    const nameSpan = document.createElement('span');
    nameSpan.className = 'tag-chip';
    nameSpan.setAttribute('data-color', tag.color || 'gray');
    nameSpan.textContent = tag.name;
    nameSpan.title = App.t('tag_management.rename_title');
    nameSpan.style.cursor = 'pointer';
    nameSpan.addEventListener('click', () => startRename(tr, tag));
    nameTd.appendChild(nameSpan);
    tr.appendChild(nameTd);

    // Files count — click jumps to DB view filtered by this tag.
    const countTd = document.createElement('td');
    countTd.className = 'tm-cell-count';
    const countLink = document.createElement('button');
    countLink.type = 'button';
    countLink.className = 'tm-count-link';
    countLink.textContent = String(tag.file_count || 0);
    countLink.title = App.t('tag_management.filter_by_tag_title');
    countLink.addEventListener('click', () => {
      App.switchView('database');
      if (typeof App.setSearchQuery === 'function') {
        App.setSearchQuery(`tag:${/\s/.test(tag.name) ? `"${tag.name}"` : tag.name}`);
      }
    });
    countTd.appendChild(countLink);
    tr.appendChild(countTd);

    // Description — click to edit inline.
    const descTd = document.createElement('td');
    descTd.className = 'tm-cell-desc';
    descTd.title = App.t('tag_management.description_edit_title');
    descTd.textContent = tag.description || '';
    descTd.style.cursor = 'text';
    descTd.addEventListener('click', () => startDescriptionEdit(descTd, tag));
    tr.appendChild(descTd);

    // Actions menu (merge / delete).
    const actionsTd = document.createElement('td');
    actionsTd.className = 'tm-cell-actions';
    const mergeBtn = document.createElement('button');
    mergeBtn.type = 'button';
    mergeBtn.className = 'btn-secondary small';
    mergeBtn.textContent = App.t('tag_management.merge_button');
    mergeBtn.addEventListener('click', () => openMergeDialog(tag));
    actionsTd.appendChild(mergeBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-secondary small destructive';
    delBtn.textContent = App.t('tag_management.delete_button');
    delBtn.style.marginLeft = '6px';
    delBtn.addEventListener('click', () => openDeleteDialog(tag));
    actionsTd.appendChild(delBtn);

    tr.appendChild(actionsTd);
    return tr;
  }

  function openColorPicker(tagName, anchorEl) {
    // Remove any existing picker.
    const existing = document.querySelector('.tm-color-palette');
    if (existing) existing.remove();
    const palette = document.createElement('div');
    palette.className = 'tm-color-palette';
    for (const color of App.TAG_COLORS) {
      const swatch = document.createElement('button');
      swatch.type = 'button';
      swatch.className = 'tm-color-swatch tag-chip';
      swatch.setAttribute('data-color', color);
      swatch.title = color;
      swatch.textContent = ' ';
      swatch.addEventListener('click', async (e) => {
        e.stopPropagation();
        await window.api.upsertTagMeta(tagName, { color });
        palette.remove();
        await App.loadTagMeta();
        // Repaint everything that renders tag chips.
        App.refreshTagManagement();
        if (typeof App.refreshDatabase === 'function') App.refreshDatabase();
        if (typeof App.renderTagList === 'function') {
          const f = App.state.files[App.state.activeFileIndex];
          if (f) App.renderTagList(App.splitTags(f.tags));
        }
        App.logLine('ok', App.t('log.tag_color_set', { name: tagName, color }));
      });
      palette.appendChild(swatch);
    }
    // Position relative to anchor.
    const rect = anchorEl.getBoundingClientRect();
    palette.style.position = 'fixed';
    palette.style.left = rect.left + 'px';
    palette.style.top = rect.bottom + 4 + 'px';
    document.body.appendChild(palette);

    const dismiss = (e) => {
      if (e && palette.contains(e.target)) return;
      palette.remove();
      document.removeEventListener('mousedown', dismiss);
    };
    setTimeout(() => document.addEventListener('mousedown', dismiss), 50);
  }

  function startRename(tr, tag) {
    const nameTd = tr.querySelector('.tm-cell-name');
    if (!nameTd) return;
    nameTd.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = tag.name;
    input.className = 'tm-inline-input';
    nameTd.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      const v = (input.value || '').trim();
      if (!commit || !v || v === tag.name) {
        App.refreshTagManagement();
        return;
      }
      const res = await window.api.renameTag(tag.name, v);
      if (res && res.error) {
        App.logLine('err', App.t('log.tag_rename_failed', { err: res.error }));
        if (App.toast) App.toast.error(App.t('toasts.tag_rename_failed', { msg: res.error }));
      } else {
        App.logLine(
          'ok',
          App.t('log.tag_renamed', { from: tag.name, to: v, n: res.filesTouched || 0 })
        );
        if (App.toast) App.toast.success(App.t('toasts.tag_renamed', { from: tag.name, to: v }));
      }
      await App.loadTagMeta();
      App.refreshTagManagement();
      if (typeof App.refreshDatabase === 'function') App.refreshDatabase();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  function startDescriptionEdit(td, tag) {
    if (td._editing) return;
    td._editing = true;
    const original = tag.description || '';
    td.innerHTML = '';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = original;
    input.placeholder = App.t('tag_management.description_placeholder');
    input.className = 'tm-inline-input';
    td.appendChild(input);
    input.focus();
    input.select();

    let done = false;
    const finish = async (commit) => {
      if (done) return;
      done = true;
      td._editing = false;
      const v = input.value;
      if (!commit || v === original) {
        td.textContent = original;
        return;
      }
      const res = await window.api.upsertTagMeta(tag.name, { description: v });
      if (res && res.error) {
        App.logLine('err', App.t('log.tag_description_failed', { err: res.error }));
        td.textContent = original;
        return;
      }
      td.textContent = v;
      await App.loadTagMeta();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        finish(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  async function openMergeDialog(tag) {
    // List candidate target tags (everything except the source).
    const all = (await window.api.listTagMeta()) || [];
    const candidates = all.filter((t) => t.name !== tag.name);
    if (candidates.length === 0) {
      await App.appModal({
        title: App.t('modal.merge_tag_no_others_title'),
        body: App.t('modal.merge_tag_no_others_body'),
        buttons: [{ label: App.t('modal.ok'), value: true, primary: true }]
      });
      return;
    }
    const opts = candidates
      .map(
        (t) =>
          `<option value="${App.escapeHtml(t.name)}">${App.escapeHtml(t.name)}${t.file_count ? ` (${t.file_count} files)` : ''}</option>`
      )
      .join('');
    const id = `tm-merge-target-${Date.now()}`;
    const confirmed = await App.appModal({
      title: App.t('modal.merge_tag_title', { name: tag.name }),
      body:
        App.t('modal.merge_tag_body_html', { name: App.escapeHtml(tag.name) }) +
        `<div class="form-row" style="margin-top: 10px">
          <label for="${id}">${App.escapeHtml(App.t('modal.merge_tag_target_label'))}</label>
          <select id="${id}" class="text-input">${opts}</select>
        </div>`,
      buttons: [
        { label: App.t('modal.cancel'), value: false },
        { label: App.t('modal.merge'), value: true, primary: true }
      ]
    });
    if (!confirmed) return;
    const select = document.getElementById(id);
    const target = select ? select.value : '';
    if (!target) return;
    const res = await window.api.mergeTag(tag.name, target);
    if (res && res.error) {
      App.logLine('err', App.t('log.tag_merge_failed', { err: res.error }));
      if (App.toast) App.toast.error(App.t('toasts.tag_merge_failed', { msg: res.error }));
      return;
    }
    App.logLine(
      'ok',
      App.t('log.tag_merged', { from: tag.name, to: target, n: res.filesTouched || 0 })
    );
    if (App.toast) App.toast.success(App.t('toasts.tag_merged', { from: tag.name, to: target }));
    await App.loadTagMeta();
    App.refreshTagManagement();
    if (typeof App.refreshDatabase === 'function') App.refreshDatabase();
  }

  async function openDeleteDialog(tag) {
    const count = tag.file_count || 0;
    const bodyKey =
      count === 1 ? 'modal.delete_tag_body_one_html' : 'modal.delete_tag_body_many_html';
    const confirmed = await App.appModal({
      title: App.t('modal.delete_tag_title', { name: tag.name }),
      body: App.t(bodyKey, { name: App.escapeHtml(tag.name), n: count }),
      variant: 'destructive',
      buttons: [
        { label: App.t('modal.cancel'), value: false },
        { label: App.t('modal.delete'), value: true, destructive: true }
      ]
    });
    if (!confirmed) return;
    const res = await window.api.deleteTag(tag.name);
    if (res && res.error) {
      App.logLine('err', App.t('log.tag_delete_failed', { err: res.error }));
      if (App.toast) App.toast.error(App.t('toasts.tag_delete_failed', { msg: res.error }));
      return;
    }
    App.logLine('ok', App.t('log.tag_deleted', { name: tag.name, n: res.filesTouched || 0 }));
    if (App.toast) App.toast.success(App.t('toasts.tag_deleted', { name: tag.name }));
    await App.loadTagMeta();
    App.refreshTagManagement();
    if (typeof App.refreshDatabase === 'function') App.refreshDatabase();
  }

  /* ===== Smart Rules tab ===== */

  App.refreshTagRulesList = async function refreshTagRulesList() {
    const host = App.$('#tm-rules-list');
    if (!host) return;
    const rules = (await window.api.listTagRules({})) || [];
    host.innerHTML = '';
    if (!Array.isArray(rules) || rules.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'empty-state-cta';
      empty.innerHTML = `
        <div class="empty-state-cta-icon">⚡</div>
        <div class="empty-state-cta-title">${App.escapeHtml(App.t('tag_management.rules_empty_title'))}</div>
        <div class="empty-state-cta-sub">
          ${App.escapeHtml(App.t('tag_management.rules_empty_sub'))}
        </div>
      `;
      host.appendChild(empty);
      return;
    }
    for (const rule of rules) host.appendChild(buildRuleCard(rule));
  };

  function buildRuleCard(rule) {
    const card = document.createElement('div');
    card.className = 'tm-rule-card' + (rule.enabled ? '' : ' disabled');
    card.dataset.ruleId = String(rule.id);

    // Header row: enabled checkbox + name + delete.
    const header = document.createElement('div');
    header.className = 'tm-rule-header';

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = !!rule.enabled;
    cb.title = rule.enabled
      ? App.t('tag_management.rule_disable_title')
      : App.t('tag_management.rule_enable_title');
    cb.addEventListener('change', async () => {
      const res = await window.api.updateTagRule(rule.id, { enabled: cb.checked });
      if (res && res.error) {
        App.logLine('err', App.t('log.rule_toggle_failed', { err: res.error }));
        cb.checked = !cb.checked;
        return;
      }
      card.classList.toggle('disabled', !cb.checked);
    });
    header.appendChild(cb);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = rule.name || '';
    nameInput.placeholder = App.t('tag_management.rule_name_placeholder');
    nameInput.className = 'tm-rule-name';
    nameInput.addEventListener('change', () => commitRule(rule.id, { name: nameInput.value }));
    header.appendChild(nameInput);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn-secondary small destructive';
    delBtn.textContent = '✕';
    delBtn.title = App.t('tag_management.rule_delete_title');
    delBtn.addEventListener('click', async () => {
      const confirmed = await App.appModal({
        title: App.t('modal.delete_rule_title'),
        body: App.t('modal.delete_rule_body_html', {
          name: App.escapeHtml(rule.name || App.t('detail_panel.unnamed'))
        }),
        variant: 'destructive',
        buttons: [
          { label: App.t('modal.cancel'), value: false },
          { label: App.t('modal.delete'), value: true, destructive: true }
        ]
      });
      if (!confirmed) return;
      const res = await window.api.deleteTagRule(rule.id);
      if (res && res.error) {
        App.logLine('err', App.t('log.rule_delete_failed', { err: res.error }));
        return;
      }
      App.refreshTagRulesList();
    });
    header.appendChild(delBtn);
    card.appendChild(header);

    // Condition row: IF <field> <op> <value> THEN add tag <tag>
    const cond = document.createElement('div');
    cond.className = 'tm-rule-condition';

    const ifLabel = document.createElement('span');
    ifLabel.className = 'tm-rule-keyword';
    ifLabel.textContent = App.t('tag_management.rule_if');
    cond.appendChild(ifLabel);

    const fieldSel = document.createElement('select');
    fieldSel.className = 'text-input';
    for (const f of RULE_FIELDS) {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = App.t(f.key);
      if (rule.match_field === f.id) opt.selected = true;
      fieldSel.appendChild(opt);
    }
    cond.appendChild(fieldSel);

    const opSel = document.createElement('select');
    opSel.className = 'text-input';
    populateOps(opSel, fieldSel.value, rule.match_op);
    cond.appendChild(opSel);

    fieldSel.addEventListener('change', () => {
      populateOps(opSel, fieldSel.value, null);
      commitRule(rule.id, { match_field: fieldSel.value, match_op: opSel.value });
    });
    opSel.addEventListener('change', () => commitRule(rule.id, { match_op: opSel.value }));

    const valInput = document.createElement('input');
    valInput.type = 'text';
    valInput.value = rule.match_value || '';
    valInput.placeholder = App.t('tag_management.rule_value_placeholder');
    valInput.className = 'text-input';
    valInput.addEventListener('change', () => commitRule(rule.id, { match_value: valInput.value }));
    cond.appendChild(valInput);

    const thenLabel = document.createElement('span');
    thenLabel.className = 'tm-rule-keyword';
    thenLabel.textContent = App.t('tag_management.rule_then');
    cond.appendChild(thenLabel);

    const tagInput = document.createElement('input');
    tagInput.type = 'text';
    tagInput.value = rule.tag_to_add || '';
    tagInput.placeholder = App.t('tag_management.rule_tag_placeholder');
    tagInput.className = 'text-input';
    tagInput.autocomplete = 'off';
    tagInput.addEventListener('change', () => commitRule(rule.id, { tag_to_add: tagInput.value }));
    if (typeof App.attachTagAutocomplete === 'function') {
      App.attachTagAutocomplete(tagInput, {
        position: 'below',
        onPick: (tag) => {
          tagInput.value = tag;
          commitRule(rule.id, { tag_to_add: tag });
        }
      });
    }
    cond.appendChild(tagInput);

    card.appendChild(cond);
    return card;
  }

  function populateOps(selectEl, field, currentOpId) {
    selectEl.innerHTML = '';
    for (const op of opsForField(field)) {
      const opt = document.createElement('option');
      opt.value = op.id;
      opt.textContent = App.t(op.key);
      if (currentOpId === op.id) opt.selected = true;
      selectEl.appendChild(opt);
    }
  }

  async function commitRule(id, updates) {
    const res = await window.api.updateTagRule(id, updates);
    if (res && res.error) App.logLine('err', App.t('log.rule_save_failed', { err: res.error }));
  }
})();
