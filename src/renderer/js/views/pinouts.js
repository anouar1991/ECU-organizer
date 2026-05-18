/* ===== Pinouts view =====
 * CRUD + search + SVG annotation editor for ECU connection guides.
 *
 * State:
 *   App.state.pinouts        — last fetched list
 *   App.state.activePinout   — currently-editing entry (or null for "new")
 *   App.state.pinoutSearch   — last applied search query
 *
 * IPC surface (via window.api):
 *   listPinouts / getPinout / createPinout / updatePinout / deletePinout
 *   suggestPinoutsForEcu / searchPinouts / importPinoutImage / getPinoutImageUrl
 */
window.App = window.App || {};
window.App.state.pinouts = window.App.state.pinouts || [];
window.App.state.activePinout = window.App.state.activePinout || null;
window.App.state.pinoutSearch = window.App.state.pinoutSearch || '';

(function () {
  const App = window.App;

  // ---------- list ----------

  /**
   * Reload the sidebar list. Applies the current search filter if non-empty,
   * otherwise lists all entries. Marks the active entry with a CSS class.
   */
  App.refreshPinoutList = async function refreshPinoutList() {
    const $ = App.$;
    const list = $('#pinout-list');
    const empty = $('#pinouts-empty');
    if (!list || !empty) return;

    let entries;
    if (App.state.pinoutSearch && App.state.pinoutSearch.trim()) {
      entries = await window.api.searchPinouts(App.state.pinoutSearch.trim(), 500);
    } else {
      entries = await window.api.listPinouts();
    }
    App.state.pinouts = Array.isArray(entries) ? entries : [];

    list.innerHTML = '';
    if (App.state.pinouts.length === 0) {
      empty.style.display = '';
      return;
    }
    empty.style.display = 'none';

    for (const p of App.state.pinouts) {
      const li = document.createElement('li');
      li.className = 'pinout-list-item';
      li.dataset.id = String(p.id);
      if (App.state.activePinout && App.state.activePinout.id === p.id) {
        li.classList.add('active');
      }
      const title = App.escapeHtml(formatTitle(p));
      const subtitle = App.escapeHtml(formatSubtitle(p));
      li.innerHTML =
        `<div class="pinout-list-item-title">${title}</div>` +
        `<div class="pinout-list-item-sub">${subtitle}</div>`;
      li.addEventListener('click', () => App.openPinout(p.id));
      list.appendChild(li);
    }
  };

  function formatTitle(p) {
    const parts = [];
    if (p.brand) parts.push(p.brand);
    parts.push(p.ecuFamily);
    if (p.ecuModel) parts.push(p.ecuModel);
    return parts.join(' · ');
  }

  function formatSubtitle(p) {
    const bits = [p.method];
    if (p.voltage) bits.push(p.voltage);
    if (Array.isArray(p.tools) && p.tools.length) bits.push(p.tools.join(', '));
    return bits.filter(Boolean).join(' — ');
  }

  // ---------- open / edit ----------

  App.openPinout = async function openPinout(id) {
    if (id == null) {
      // "+ New" path
      App.state.activePinout = makeBlankPinout();
    } else {
      const entry = await window.api.getPinout(id);
      if (!entry) return;
      App.state.activePinout = entry;
    }
    showForm();
    populateForm(App.state.activePinout);
    App.refreshPinoutList();
  };

  function makeBlankPinout() {
    return {
      id: null,
      brand: '',
      ecuFamily: '',
      ecuModel: '',
      method: 'BENCH',
      voltage: '',
      pins: [],
      annotations: {},
      imagePath: '',
      tools: [],
      warnings: '',
      notes: ''
    };
  }

  function showForm() {
    const $ = App.$;
    $('#pinout-form').hidden = false;
    $('#pinout-empty-detail').hidden = true;
    $('#pinout-delete-btn').hidden = !App.state.activePinout || !App.state.activePinout.id;
    const $title = $('#pinout-form-title');
    if ($title) {
      $title.textContent = App.t(
        App.state.activePinout && App.state.activePinout.id
          ? 'pinouts.form_title_edit'
          : 'pinouts.form_title_new'
      );
    }
  }

  function hideForm() {
    const $ = App.$;
    $('#pinout-form').hidden = true;
    $('#pinout-empty-detail').hidden = false;
    App.state.activePinout = null;
  }

  function populateForm(entry) {
    setInput('brand', entry.brand);
    setInput('ecuFamily', entry.ecuFamily);
    setInput('ecuModel', entry.ecuModel || '');
    setInput('method', entry.method || 'BENCH');
    setInput('voltage', entry.voltage);
    setInput('tools', Array.isArray(entry.tools) ? entry.tools.join(', ') : '');
    setInput('warnings', entry.warnings);
    setInput('notes', entry.notes);
    renderPinTable(entry.pins || []);
    renderImageEditor(entry);
  }

  function setInput(field, value) {
    const el = App.$(`.pinout-input[data-field="${field}"]`);
    if (!el) return;
    el.value = value == null ? '' : String(value);
  }

  function readForm() {
    const $ = App.$;
    const get = (f) => {
      const el = $(`.pinout-input[data-field="${f}"]`);
      return el ? el.value : '';
    };
    const toolsRaw = get('tools');
    return {
      brand: get('brand').trim(),
      ecuFamily: get('ecuFamily').trim(),
      ecuModel: get('ecuModel').trim() || null,
      method: get('method'),
      voltage: get('voltage').trim(),
      tools: toolsRaw
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
      warnings: get('warnings'),
      notes: get('notes'),
      pins: readPinTable(),
      annotations:
        App.state.activePinout && App.state.activePinout.annotations
          ? App.state.activePinout.annotations
          : {},
      imagePath: App.state.activePinout ? App.state.activePinout.imagePath || '' : ''
    };
  }

  // ---------- pin table ----------

  function renderPinTable(pins) {
    const tbody = App.$('#pinout-pins-tbody');
    tbody.innerHTML = '';
    for (const pin of pins) {
      tbody.appendChild(buildPinRow(pin));
    }
  }

  function buildPinRow(pin) {
    const tr = document.createElement('tr');
    tr.innerHTML =
      `<td><input type="text" class="text-input pin-cell" data-pin-field="label" value="${App.escapeHtml(pin.label || '')}"/></td>` +
      `<td><input type="text" class="text-input pin-cell" data-pin-field="function" value="${App.escapeHtml(pin.function || '')}"/></td>` +
      `<td><input type="text" class="text-input pin-cell pin-cell-narrow" data-pin-field="side" value="${App.escapeHtml(pin.side || '')}"/></td>` +
      `<td><input type="text" class="text-input pin-cell" data-pin-field="notes" value="${App.escapeHtml(pin.notes || '')}"/></td>` +
      `<td><button type="button" class="pin-cell-remove" aria-label="Remove pin">×</button></td>`;
    tr.querySelector('.pin-cell-remove').addEventListener('click', () => {
      tr.remove();
    });
    return tr;
  }

  function readPinTable() {
    const rows = App.$$('#pinout-pins-tbody tr');
    const out = [];
    for (const tr of rows) {
      const get = (f) => {
        const el = tr.querySelector(`[data-pin-field="${f}"]`);
        return el ? el.value.trim() : '';
      };
      const label = get('label');
      const fn = get('function');
      if (!label && !fn) continue; // skip empty rows
      out.push({
        label,
        function: fn,
        side: get('side'),
        notes: get('notes')
      });
    }
    return out;
  }

  function addEmptyPinRow() {
    App.$('#pinout-pins-tbody').appendChild(buildPinRow({}));
  }

  // ---------- save / delete ----------

  async function savePinout() {
    if (!App.state.activePinout) return;
    const payload = readForm();
    if (!payload.ecuFamily) {
      if (App.toast) App.toast.warn(App.t('pinouts.error_family_required'));
      return;
    }
    let res;
    if (App.state.activePinout.id) {
      res = await window.api.updatePinout(App.state.activePinout.id, payload);
    } else {
      res = await window.api.createPinout(payload);
    }
    if (res && res.error) {
      // Duplicate constraint is the common case — translate to a friendly message.
      if (App.toast) {
        const msg = String(res.error).includes('UNIQUE')
          ? App.t('pinouts.error_duplicate')
          : App.t('pinouts.error_save', { msg: res.error });
        App.toast.error(msg);
      }
      return;
    }
    App.state.activePinout = res;
    if (App.toast) App.toast.success(App.t('pinouts.saved'));
    await App.refreshPinoutList();
    populateForm(res);
    showForm();
  }

  async function deleteActivePinout() {
    if (!App.state.activePinout || !App.state.activePinout.id) return;
    const id = App.state.activePinout.id;
    const ok = await App.appModal({
      title: App.t('pinouts.delete_confirm_title'),
      body: App.t('pinouts.delete_confirm_body_html', {
        title: App.escapeHtml(formatTitle(App.state.activePinout))
      }),
      variant: 'destructive',
      buttons: [
        { label: App.t('modal.cancel'), value: false },
        { label: App.t('pinouts.delete'), value: true, destructive: true }
      ]
    });
    if (!ok) return;
    const res = await window.api.deletePinout(id);
    if (res && res.error) {
      if (App.toast) App.toast.error(App.t('pinouts.error_delete', { msg: res.error }));
      return;
    }
    hideForm();
    if (App.toast) App.toast.success(App.t('pinouts.deleted'));
    await App.refreshPinoutList();
  }

  // ---------- image upload + SVG editor ----------

  async function renderImageEditor(entry) {
    const $ = App.$;
    const editor = $('#pinout-svg-editor');
    const clearBtn = $('#pinout-clear-image-btn');
    if (!editor) return;

    if (!entry.imagePath) {
      editor.innerHTML = `<div class="pinout-svg-empty">${App.escapeHtml(App.t('pinouts.image_empty'))}</div>`;
      if (clearBtn) clearBtn.hidden = true;
      return;
    }

    const url = await window.api.getPinoutImageUrl(entry.imagePath);
    if (!url) {
      editor.innerHTML = `<div class="pinout-svg-empty">${App.escapeHtml(App.t('pinouts.image_missing'))}</div>`;
      if (clearBtn) clearBtn.hidden = true;
      return;
    }
    if (clearBtn) clearBtn.hidden = false;

    // Build the editor as an <img> with an absolutely-positioned SVG overlay.
    // The SVG uses a viewBox matching the image's intrinsic dimensions so the
    // annotation coordinates are resolution-independent.
    editor.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.className = 'pinout-svg-wrap';
    const img = document.createElement('img');
    img.className = 'pinout-svg-image';
    img.alt = '';
    img.src = url;
    img.draggable = false;
    wrap.appendChild(img);

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'pinout-svg-overlay');
    svg.setAttribute('preserveAspectRatio', 'none');
    wrap.appendChild(svg);

    editor.appendChild(wrap);

    img.addEventListener('load', () => {
      App.PinoutSvgEditor.init({
        wrap,
        img,
        svg,
        entry: App.state.activePinout,
        onChange: (annotations) => {
          if (App.state.activePinout) {
            App.state.activePinout.annotations = annotations;
          }
        }
      });
    });
    // If the image is cached, the load handler may have already fired.
    if (img.complete && img.naturalWidth > 0) {
      img.dispatchEvent(new Event('load'));
    }
  }

  async function uploadPinoutImage() {
    const paths = await window.api.selectFiles();
    if (!paths || paths.length === 0) return;
    const sourcePath = paths[0];
    const res = await window.api.importPinoutImage(sourcePath);
    if (!res || !res.success) {
      if (App.toast)
        App.toast.error(App.t('pinouts.error_image', { msg: (res && res.error) || 'unknown' }));
      return;
    }
    if (App.state.activePinout) {
      App.state.activePinout.imagePath = res.imagePath;
      App.state.activePinout.annotations = {};
      renderImageEditor(App.state.activePinout);
    }
  }

  function clearPinoutImage() {
    if (!App.state.activePinout) return;
    App.state.activePinout.imagePath = '';
    App.state.activePinout.annotations = {};
    renderImageEditor(App.state.activePinout);
  }

  // ---------- setup ----------

  App.setupPinoutsView = function setupPinoutsView() {
    const $ = App.$;

    $('#pinout-new-btn').addEventListener('click', () => App.openPinout(null));
    $('#pinout-cancel-btn').addEventListener('click', () => hideForm());
    $('#pinout-save-btn').addEventListener('click', () => savePinout());
    $('#pinout-delete-btn').addEventListener('click', () => deleteActivePinout());
    $('#pinout-add-pin-btn').addEventListener('click', addEmptyPinRow);
    $('#pinout-upload-image-btn').addEventListener('click', uploadPinoutImage);
    $('#pinout-clear-image-btn').addEventListener('click', clearPinoutImage);

    const search = $('#pinout-search');
    if (search) {
      let t;
      search.addEventListener('input', (e) => {
        clearTimeout(t);
        t = setTimeout(() => {
          App.state.pinoutSearch = e.target.value;
          App.refreshPinoutList();
        }, 200);
      });
    }
  };

  // Lazy-load: first time the view is shown, refresh the list. Subsequent
  // visits keep the cached state but still refresh in case other surfaces
  // changed entries (e.g. the auto-suggest card opens a quick-create dialog).
  App.onShowPinoutsView = function onShowPinoutsView() {
    App.refreshPinoutList();
  };
})();
