/* ===== Database view: grid (card) renderer =====
 * Renders the same row set as the table, but as cards in a CSS grid.
 *
 * Shares selection state (App.state.selectedIds) with the table view; the
 * detail panel and bulk action bar work identically regardless of mode.
 *
 * Cards are batched into a DocumentFragment, then appended once — keeps
 * paint < 200ms for ~1000 rows.
 */
window.App = window.App || {};

(function () {
  const App = window.App;

  function renderCard(row) {
    const escapeHtml = App.escapeHtml;
    const splitTags = App.splitTags;
    const formatBytes = App.formatBytes;
    const state = App.state;

    const card = document.createElement('div');
    card.className = 'db-card kind-' + (row.kind || 'original');
    card.dataset.id = row.id;
    if (state.selectedIds.has(row.id)) card.classList.add('row-selected');

    const tagsHtml = splitTags(row.tags)
      .slice(0, 6)
      .map(
        (t) =>
          `<span class="tag-chip-mini" data-tag="${escapeHtml(t)}" data-color="${escapeHtml(App.getTagColor(t))}">${escapeHtml(t)}</span>`
      )
      .join('');

    const conf = Number(row.confidence) || 0;
    const confClass = conf >= 80 ? 'high' : conf >= 50 ? 'mid' : 'low';
    const checked = state.selectedIds.has(row.id) ? 'checked' : '';
    const kindLabel = (row.kind || 'original').toUpperCase();
    const stage = row.kind === 'solution' && row.solution_label ? row.solution_label : '';

    const hwLabel = App.t('database.card_hw');
    const swLabel = App.t('database.card_sw');
    const stageLabel = App.t('database.card_stage');
    const noTags = App.t('database.card_no_tags');
    const cmpTitle = App.t('database.card_compare_title');
    const delTitle = App.t('database.card_delete_title');
    const selTitle = App.t('database.card_select_title');
    card.innerHTML = `
      <header class="db-card-header">
        <span class="kind-badge kind-${row.kind || 'original'}">${kindLabel}</span>
        <span class="db-card-id">#${row.id}</span>
        <input type="checkbox" class="db-row-checkbox db-card-checkbox"
               data-row-id="${row.id}" ${checked} title="${escapeHtml(selTitle)}" />
      </header>
      <div class="db-card-title" title="${escapeHtml(row.new_name)}">
        ${escapeHtml(row.brand || '—')} ${escapeHtml(row.model || '')}
      </div>
      <div class="db-card-sub">${escapeHtml(row.ecu_type || '—')}</div>
      <dl class="db-card-meta">
        <div><dt>${escapeHtml(hwLabel)}</dt><dd>${escapeHtml(row.hw_id || '—')}</dd></div>
        <div><dt>${escapeHtml(swLabel)}</dt><dd>${escapeHtml(row.sw_id || '—')}</dd></div>
        ${stage ? `<div><dt>${escapeHtml(stageLabel)}</dt><dd>${escapeHtml(stage)}</dd></div>` : ''}
      </dl>
      <div class="db-card-tags">${tagsHtml || `<span class="hint">${escapeHtml(noTags)}</span>`}</div>
      <footer class="db-card-footer">
        <span class="db-card-size">${formatBytes(row.file_size)}</span>
        <span class="db-card-conf conf-${confClass}">${conf}%</span>
        <span class="db-card-actions">
          <button class="db-compare-btn" data-cmp-id="${row.id}" title="${escapeHtml(cmpTitle)}">↔</button>
          <button class="row-delete" data-id="${row.id}" title="${escapeHtml(delTitle)}">✕</button>
        </span>
      </footer>
    `;

    return card;
  }

  /**
   * @param {Array<any>} rows  rows already filtered/sorted by refreshDatabase
   * @param {Array<{key:string,label:string,rows:any[]}>} groups  empty → ungrouped
   */
  App.renderDbGrid = function renderDbGrid(rows, groups) {
    const host = App.$('#db-grid');
    if (!host) return;
    host.innerHTML = '';

    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'db-grid-empty';
      empty.textContent = App.t('database.grid_no_match');
      host.appendChild(empty);
      App._dbVisibleSelectableIds = [];
      return;
    }

    const visibleIds = [];

    if (groups && groups.length > 0) {
      // Grouped: one section per group, with the section header sticky-top.
      for (const g of groups) {
        const section = document.createElement('section');
        section.className = 'db-grid-section';
        section.dataset.groupKey = g.key;

        const header = App.buildDbGroupHeader(g, { onToggle: App.refreshDatabase });
        section.appendChild(header);

        if (!App.isDbGroupCollapsed(g.key)) {
          const body = document.createElement('div');
          body.className = 'db-grid-section-body';
          const frag = document.createDocumentFragment();
          for (const row of g.rows) {
            frag.appendChild(renderCard(row));
            visibleIds.push(row.id);
          }
          body.appendChild(frag);
          section.appendChild(body);
        }

        host.appendChild(section);
      }
    } else {
      const grid = document.createElement('div');
      grid.className = 'db-grid-section-body';
      const frag = document.createDocumentFragment();
      for (const row of rows) {
        frag.appendChild(renderCard(row));
        visibleIds.push(row.id);
      }
      grid.appendChild(frag);
      host.appendChild(grid);
    }

    App._dbVisibleSelectableIds = visibleIds;
    wireGridInteractions(host);
  };

  function wireGridInteractions(host) {
    // Body click: open detail panel (unless clicking on checkbox, tags, buttons).
    host.querySelectorAll('.db-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        const t = e.target;
        if (t.closest('button') || t.closest('.db-row-checkbox') || t.closest('.tag-chip-mini')) {
          return;
        }
        const id = parseInt(card.dataset.id, 10);
        if (Number.isNaN(id)) return;
        if (typeof App.openDbDetailPanel === 'function') App.openDbDetailPanel(id);
      });
    });

    // Checkbox -> toggle selection.
    host.querySelectorAll('.db-card-checkbox').forEach((cb) => {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', () => {
        const id = parseInt(cb.dataset.rowId, 10);
        if (Number.isNaN(id)) return;
        const card = cb.closest('.db-card');
        if (cb.checked) {
          App.state.selectedIds.add(id);
          if (card) card.classList.add('row-selected');
        } else {
          App.state.selectedIds.delete(id);
          if (card) card.classList.remove('row-selected');
        }
        App.state.lastClickedRowId = id;
        if (typeof App.updateDbActionBar === 'function') App.updateDbActionBar();
      });
    });

    // Tag chip filter (delegates to global search bar like table view does).
    host.querySelectorAll('.tag-chip-mini').forEach((chip) => {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
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
          const el = App.$('#db-search');
          if (el) el.value = tag;
          App.refreshDatabase();
        }
      });
    });

    // Compare button armed-state.
    host.querySelectorAll('.db-compare-btn').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.cmpId, 10);
        await App.sendToComparator(id, btn);
      });
    });

    // Delete from index.
    host.querySelectorAll('.row-delete').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const id = parseInt(btn.dataset.id, 10);
        await window.api.deleteFile(id);
        App.state.selectedIds.delete(id);
        App.refreshDatabase();
        App.logLine('info', App.t('log.row_removed', { id: btn.dataset.id }));
      });
    });
  }

  // ---------- view-mode toggle wiring ----------
  App.applyDbViewMode = function applyDbViewMode(mode) {
    const m = mode === 'grid' ? 'grid' : 'table';
    App.state.dbViewMode = m;
    document.querySelectorAll('.db-view-mode-btn').forEach((b) => {
      b.classList.toggle('active', b.dataset.mode === m);
    });
    const tableHost = App.$('#db-table-host');
    const gridHost = App.$('#db-grid-host');
    if (tableHost) tableHost.hidden = m !== 'table';
    if (gridHost) gridHost.hidden = m !== 'grid';
  };

  App.ensureDbViewModeWired = function ensureDbViewModeWired() {
    if (App._dbViewModeWired) return;
    App._dbViewModeWired = true;
    document.querySelectorAll('.db-view-mode-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.mode;
        App.applyDbViewMode(mode);
        App.saveDbViewMode(mode);
        App.refreshDatabase();
      });
    });
  };
})();
