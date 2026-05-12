/* ===== Database view: columns (sort + resize + reorder) =====
 * Builds the table's <thead> based on App.state.dbColumnsConfig and wires
 * three independent interactions:
 *
 *   - sort: click on a sortable header. Same column twice flips direction.
 *   - resize: drag the right edge of a <th>; widths persist on mouseup.
 *   - reorder: HTML5 native drag-and-drop of <th> elements; persists.
 *
 * Sort is applied client-side by sortRows() over the row array — the table
 * and grid renderers consume the already-sorted array.
 */
window.App = window.App || {};

(function () {
  const App = window.App;

  // ---------- value extraction (kept robust to nullish/strings) ----------
  function valueFor(row, colId) {
    switch (colId) {
      case 'kind':
        return row.kind || '';
      case 'brand':
        return row.brand || '';
      case 'model':
        return row.model || '';
      case 'ecu_type':
        return row.ecu_type || '';
      case 'hw_id':
        return row.hw_id || '';
      case 'sw_id':
        return row.sw_id || '';
      case 'solution':
        return row.solution_label || '';
      case 'new_name':
        return row.new_name || '';
      case 'tags':
        return row.tags || '';
      case 'confidence':
        // numeric — return Number for proper ordering
        return Number(row.confidence) || 0;
      case 'file_size':
        return Number(row.file_size) || 0;
      case 'created_at':
        return Number(row.created_at) || 0;
      default:
        return '';
    }
  }

  function cmp(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return a - b;
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  App.sortDbRows = function sortDbRows(rows) {
    const cfg = App.state.dbColumnsConfig;
    if (!cfg || !cfg.sort || !cfg.sort.col) return rows;
    const { col, dir } = cfg.sort;
    const meta = App.DB_COLUMN_CATALOG[col];
    if (!meta || !meta.sortable) return rows;
    const sign = dir === 'asc' ? 1 : -1;
    // Slice keeps caller's array intact — important since refreshDatabase
    // caches the full row list separately.
    return rows.slice().sort((r1, r2) => sign * cmp(valueFor(r1, col), valueFor(r2, col)));
  };

  App.getDbVisibleColumns = function getDbVisibleColumns() {
    const cfg = App.state.dbColumnsConfig;
    return cfg.order.map((id) => App.DB_COLUMN_CATALOG[id]).filter(Boolean);
  };

  // ---------- header render ----------
  App.renderDbThead = function renderDbThead() {
    const thead = App.$('#db-thead');
    if (!thead) return;
    const cfg = App.state.dbColumnsConfig;
    const cols = App.getDbVisibleColumns();

    // Build the single tr from scratch (cheap; <= ~20 columns).
    const tr = document.createElement('tr');
    for (const col of cols) {
      const th = document.createElement('th');
      th.dataset.col = col.id;
      th.style.width = (cfg.widths[col.id] || col.width) + 'px';
      if (col.id === 'select') th.classList.add('db-checkbox-cell');

      // Sortable label + arrow indicator. Translate column label at render
      // time so locale changes re-render correctly. Map of col.id → i18n key:
      const LABEL_KEYS = {
        kind: 'database.col_kind',
        brand: 'database.col_brand',
        model: 'database.col_model',
        ecu_type: 'database.col_ecu_type',
        hw_id: 'database.col_hw_id',
        sw_id: 'database.col_sw_id',
        solution: 'database.col_solution',
        new_name: 'database.col_new_name',
        tags: 'database.col_tags',
        confidence: 'database.col_confidence',
        file_size: 'database.col_file_size',
        created_at: 'database.col_created_at'
      };
      const label = document.createElement('span');
      label.className = 'db-th-label';
      if (col.id === 'select') {
        // The select-all checkbox lives here so existing wiring keeps working.
        label.innerHTML = `<input type="checkbox" id="db-select-all" class="db-row-checkbox" title="${App.escapeHtml(App.t('database.select_all_title'))}" />`;
      } else {
        const key = LABEL_KEYS[col.id];
        label.textContent = key ? App.t(key) : col.label;
      }
      th.appendChild(label);

      if (col.sortable) {
        th.classList.add('sortable');
        if (cfg.sort.col === col.id) {
          th.classList.add('sorted', cfg.sort.dir === 'asc' ? 'asc' : 'desc');
          const arrow = document.createElement('span');
          arrow.className = 'db-th-arrow';
          arrow.textContent = cfg.sort.dir === 'asc' ? ' ▲' : ' ▼';
          th.appendChild(arrow);
        }
        th.addEventListener('click', (e) => {
          // Resize handle has its own mousedown listener that already
          // stopPropagation()s, so a click here means "sort".
          if (e.target.closest('.col-resize-handle')) return;
          if (cfg.sort.col === col.id) {
            cfg.sort.dir = cfg.sort.dir === 'asc' ? 'desc' : 'asc';
          } else {
            cfg.sort.col = col.id;
            cfg.sort.dir = 'asc';
          }
          App.saveDbColumnsConfig(cfg);
          // Sort+re-render only; row data is unchanged.
          App.refreshDatabase();
        });
      }

      // Reorder via native HTML5 drag/drop.
      if (col.id !== 'select' && col.id !== 'expand' && col.id !== 'actions') {
        th.draggable = true;
        th.addEventListener('dragstart', (e) => {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', col.id);
          th.classList.add('dragging');
        });
        th.addEventListener('dragend', () => th.classList.remove('dragging'));
        th.addEventListener('dragover', (e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          th.classList.add('drop-target');
        });
        th.addEventListener('dragleave', () => th.classList.remove('drop-target'));
        th.addEventListener('drop', (e) => {
          e.preventDefault();
          th.classList.remove('drop-target');
          const src = e.dataTransfer.getData('text/plain');
          if (!src || src === col.id) return;
          const order = cfg.order.slice();
          const from = order.indexOf(src);
          const to = order.indexOf(col.id);
          if (from < 0 || to < 0) return;
          order.splice(from, 1);
          order.splice(to, 0, src);
          cfg.order = order;
          App.saveDbColumnsConfig(cfg);
          App.refreshDatabase();
        });
      }

      // Resize handle on the right edge.
      if (col.resizable) {
        const handle = document.createElement('span');
        handle.className = 'col-resize-handle';
        handle.title = App.t('database.resize_title');
        handle.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          startResize(e, col.id, th);
        });
        // Clicking the handle alone (no drag) should not bubble to "sort".
        handle.addEventListener('click', (e) => e.stopPropagation());
        th.appendChild(handle);
      }

      tr.appendChild(th);
    }

    thead.innerHTML = '';
    thead.appendChild(tr);
  };

  // ---------- resize (mousedown -> mousemove -> mouseup) ----------
  function startResize(downEvent, colId, th) {
    const cfg = App.state.dbColumnsConfig;
    const startX = downEvent.clientX;
    const startWidth = th.getBoundingClientRect().width;
    const minW = 32;
    const maxW = 800;

    document.body.classList.add('db-col-resizing');

    function onMove(e) {
      const delta = e.clientX - startX;
      let next = Math.round(startWidth + delta);
      if (next < minW) next = minW;
      if (next > maxW) next = maxW;
      th.style.width = next + 'px';
      // Update widths on the matching cells in the body too, so the user
      // sees the column actually move (otherwise tablelayout: auto fights us).
      const idx = Array.from(th.parentElement.children).indexOf(th);
      const tbody = App.$('#db-tbody');
      if (tbody) {
        // Touch only the first row to set width — colgroup-less tables sync
        // automatically via the cell's width once one row is set.
        const firstRow = tbody.querySelector('tr');
        if (firstRow && firstRow.children[idx]) {
          firstRow.children[idx].style.width = next + 'px';
        }
      }
    }

    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('db-col-resizing');
      const finalW = parseInt(th.style.width, 10);
      if (Number.isFinite(finalW)) {
        cfg.widths[colId] = finalW;
        App.saveDbColumnsConfig(cfg);
      }
    }

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }
})();
