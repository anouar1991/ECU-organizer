/* ===== Pinout suggest card =====
 *
 * Reusable read-only card that surfaces the most-relevant pinout entries for
 * a given ECU (brand / family / model). Used by:
 *   - Skinner view (active scanned file)
 *   - Database detail panel (selected row)
 *   - Right-click "Show connection guide" context action
 *
 * Render shape
 *   <div class="pinout-suggest-card">
 *     <div class="pinout-suggest-tabs">
 *       <button class="pinout-suggest-tab" data-i>OBD</button>
 *       <button class="pinout-suggest-tab active" data-i>BENCH</button>
 *       ...
 *     </div>
 *     <div class="pinout-suggest-body">
 *       (selected entry render: pins table + image + warnings)
 *     </div>
 *   </div>
 *
 * The card is intentionally lightweight — for the FULL editor experience the
 * user opens the Pinouts view via the "Open in editor" link in the card
 * footer.
 */
window.App = window.App || {};

(function () {
  const App = window.App;

  /**
   * Build the suggest card for a host element. If no matches are found, the
   * host is hidden (caller decides what to do with the empty slot).
   *
   * @param {HTMLElement} host  Container element to render into.
   * @param {{brand?: string, family?: string, model?: string}} ecu
   * @returns {Promise<{ matches: number }>}
   */
  App.renderPinoutSuggestCard = async function renderPinoutSuggestCard(host, ecu) {
    if (!host) return { matches: 0 };
    host.innerHTML = '';
    host.classList.remove('has-matches');

    if (!ecu || !ecu.family || ecu.family === 'Unknown') {
      // No usable ECU info to match against — keep the host hidden.
      host.hidden = true;
      return { matches: 0 };
    }

    const matches = (await window.api.suggestPinoutsForEcu(ecu)) || [];
    if (!Array.isArray(matches) || matches.length === 0) {
      // No entries yet — show a CTA so the user knows the feature exists.
      host.hidden = false;
      host.classList.add('is-empty');
      const cta = document.createElement('div');
      cta.className = 'pinout-suggest-empty';
      cta.innerHTML =
        `<div class="pinout-suggest-empty-title">${App.escapeHtml(App.t('pinouts.suggest_none_title'))}</div>` +
        `<div class="pinout-suggest-empty-sub">${App.escapeHtml(
          App.t('pinouts.suggest_none_sub', {
            ecu: [ecu.brand, ecu.family, ecu.model].filter(Boolean).join(' · ')
          })
        )}</div>` +
        `<button type="button" class="btn-secondary small pinout-suggest-create">+ ${App.escapeHtml(App.t('pinouts.suggest_create'))}</button>`;
      host.appendChild(cta);
      cta.querySelector('.pinout-suggest-create').addEventListener('click', () => {
        // Switch to the Pinouts view and open a fresh form prepopulated with
        // the ECU we tried to match.
        App.switchView('pinouts');
        // Wait for the view to mount before populating.
        setTimeout(() => {
          if (typeof App.openPinout !== 'function') return;
          App.openPinout(null).then(() => {
            // Prefill the form with the ECU info we already have.
            if (App.state.activePinout) {
              App.state.activePinout.brand = ecu.brand || '';
              App.state.activePinout.ecuFamily = ecu.family;
              App.state.activePinout.ecuModel = ecu.model || '';
              const bEl = document.querySelector('.pinout-input[data-field="brand"]');
              const fEl = document.querySelector('.pinout-input[data-field="ecuFamily"]');
              const mEl = document.querySelector('.pinout-input[data-field="ecuModel"]');
              if (bEl) bEl.value = ecu.brand || '';
              if (fEl) fEl.value = ecu.family;
              if (mEl) mEl.value = ecu.model || '';
            }
          });
        }, 60);
      });
      return { matches: 0 };
    }

    host.hidden = false;
    host.classList.add('has-matches');
    host.classList.remove('is-empty');

    // Group by method so we can render method tabs. Same method may have
    // multiple entries (e.g. specific vs family-wide) — we keep both and let
    // the user pick which one via a small sub-pill below the tabs.
    const byMethod = new Map();
    for (const m of matches) {
      if (!byMethod.has(m.method)) byMethod.set(m.method, []);
      byMethod.get(m.method).push(m);
    }
    const methods = Array.from(byMethod.keys());

    const card = document.createElement('div');
    card.className = 'pinout-suggest-card';

    const header = document.createElement('div');
    header.className = 'pinout-suggest-header';
    header.innerHTML =
      `<div class="pinout-suggest-title">${App.escapeHtml(App.t('pinouts.suggest_title'))}</div>` +
      `<div class="pinout-suggest-sub">${App.escapeHtml(
        [ecu.brand, ecu.family, ecu.model].filter(Boolean).join(' · ')
      )}</div>`;
    card.appendChild(header);

    const tabs = document.createElement('div');
    tabs.className = 'pinout-suggest-tabs';
    let activeMethod = methods[0];
    let activeEntry = byMethod.get(activeMethod)[0];

    for (const m of methods) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'pinout-suggest-tab';
      btn.dataset.method = m;
      btn.textContent = m;
      btn.addEventListener('click', () => {
        activeMethod = m;
        activeEntry = byMethod.get(m)[0];
        renderTabState();
        renderBody();
      });
      tabs.appendChild(btn);
    }
    card.appendChild(tabs);

    // If the active method has multiple entries (e.g. specific model + family-wide),
    // surface them as small pills so the user can switch between them.
    const variantBar = document.createElement('div');
    variantBar.className = 'pinout-suggest-variants';
    card.appendChild(variantBar);

    const body = document.createElement('div');
    body.className = 'pinout-suggest-body';
    card.appendChild(body);

    const footer = document.createElement('div');
    footer.className = 'pinout-suggest-footer';
    const openInEditor = document.createElement('button');
    openInEditor.type = 'button';
    openInEditor.className = 'btn-secondary small';
    openInEditor.textContent = App.t('pinouts.suggest_open_in_editor');
    openInEditor.addEventListener('click', () => {
      if (!activeEntry) return;
      App.switchView('pinouts');
      setTimeout(() => App.openPinout(activeEntry.id), 60);
    });
    footer.appendChild(openInEditor);
    card.appendChild(footer);

    function renderTabState() {
      const allTabs = tabs.querySelectorAll('.pinout-suggest-tab');
      allTabs.forEach((b) => {
        if (b.dataset.method === activeMethod) b.classList.add('active');
        else b.classList.remove('active');
      });
      const variants = byMethod.get(activeMethod) || [];
      variantBar.innerHTML = '';
      if (variants.length <= 1) {
        variantBar.style.display = 'none';
        return;
      }
      variantBar.style.display = '';
      for (const v of variants) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'pinout-suggest-variant' + (v.id === activeEntry.id ? ' active' : '');
        pill.textContent =
          (v.ecuModel || App.t('pinouts.family_wide_label')) + (v.voltage ? ` · ${v.voltage}` : '');
        pill.addEventListener('click', () => {
          activeEntry = v;
          renderTabState();
          renderBody();
        });
        variantBar.appendChild(pill);
      }
    }

    async function renderBody() {
      body.innerHTML = '';
      if (!activeEntry) return;
      const meta = document.createElement('div');
      meta.className = 'pinout-suggest-meta';
      const metaParts = [];
      if (activeEntry.voltage) {
        metaParts.push(
          `<span class="pinout-suggest-chip"><b>${App.escapeHtml(App.t('pinouts.voltage'))}:</b> ${App.escapeHtml(activeEntry.voltage)}</span>`
        );
      }
      if (Array.isArray(activeEntry.tools) && activeEntry.tools.length) {
        metaParts.push(
          `<span class="pinout-suggest-chip"><b>${App.escapeHtml(App.t('pinouts.tools'))}:</b> ${App.escapeHtml(activeEntry.tools.join(', '))}</span>`
        );
      }
      meta.innerHTML = metaParts.join('');
      if (metaParts.length) body.appendChild(meta);

      // Image + annotation overlay (read-only).
      if (activeEntry.imagePath) {
        const url = await window.api.getPinoutImageUrl(activeEntry.imagePath);
        if (url) {
          const wrap = document.createElement('div');
          wrap.className = 'pinout-svg-wrap pinout-suggest-image';
          const img = document.createElement('img');
          img.className = 'pinout-svg-image';
          img.alt = '';
          img.src = url;
          img.draggable = false;
          wrap.appendChild(img);
          const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
          svg.setAttribute('class', 'pinout-svg-overlay');
          wrap.appendChild(svg);
          body.appendChild(wrap);
          img.addEventListener('load', () => {
            App.PinoutSvgEditor.init({
              wrap,
              img,
              svg,
              entry: activeEntry,
              readonly: true
            });
          });
          if (img.complete && img.naturalWidth > 0) img.dispatchEvent(new Event('load'));
        }
      }

      // Pins table (always shown — easier to skim than the image).
      if (Array.isArray(activeEntry.pins) && activeEntry.pins.length) {
        const table = document.createElement('table');
        table.className = 'pinout-suggest-pins';
        const thead = document.createElement('thead');
        thead.innerHTML =
          `<tr><th>${App.escapeHtml(App.t('pinouts.pin_label'))}</th>` +
          `<th>${App.escapeHtml(App.t('pinouts.pin_function'))}</th>` +
          `<th>${App.escapeHtml(App.t('pinouts.pin_side'))}</th>` +
          `<th>${App.escapeHtml(App.t('pinouts.pin_notes'))}</th></tr>`;
        table.appendChild(thead);
        const tbody = document.createElement('tbody');
        for (const pin of activeEntry.pins) {
          const tr = document.createElement('tr');
          tr.innerHTML =
            `<td><span class="pin-chip">${App.escapeHtml(pin.label || '')}</span></td>` +
            `<td>${App.escapeHtml(pin.function || '')}</td>` +
            `<td>${App.escapeHtml(pin.side || '')}</td>` +
            `<td>${App.escapeHtml(pin.notes || '')}</td>`;
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        body.appendChild(table);
      }

      if (activeEntry.warnings) {
        const w = document.createElement('div');
        w.className = 'pinout-suggest-warnings';
        w.innerHTML =
          `<div class="pinout-suggest-warnings-icon" aria-hidden="true">⚠</div>` +
          `<div class="pinout-suggest-warnings-text">${App.escapeHtml(activeEntry.warnings)}</div>`;
        body.appendChild(w);
      }
    }

    host.appendChild(card);
    renderTabState();
    renderBody();
    return { matches: matches.length };
  };
})();
