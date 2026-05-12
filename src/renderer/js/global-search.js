/* ===== Global search bar (Pack A.3) =====
 * Wires the topbar #search-box into a chip-style query builder that drives the
 * Database view via window.App.SearchParser. Surfaces:
 *   - chip rendering for recognised field:value tokens
 *   - live suggestions dropdown (autocomplete)
 *   - history dropdown when the input is empty + focused
 *   - history persistence via window.api.{addSearchHistory, listSearchHistory}
 *
 * State model:
 *   App.state.searchChips   — array of parsed-token objects { field, value, raw, label }
 *   <input>.value           — the free-text remainder (no recognised tokens)
 * The composed query passed to the Database view is:
 *   chips.map(c => c.raw).join(' ') + ' ' + input.value
 */
window.App = window.App || {};
window.App.state.searchChips = window.App.state.searchChips || [];

(function () {
  const App = window.App;
  const DEBOUNCE_MS = 200;

  let inputEl = null;
  let chipsEl = null;
  let dropdownEl = null;
  let clearBtn = null;
  let boxEl = null;
  let activeIndex = -1; // dropdown highlight
  let dropdownItems = []; // currently rendered { kind, value, replacement, start, end } items
  let dropdownMode = 'closed'; // 'history' | 'suggestions' | 'closed'
  let debounceT = null;

  // ---------- chip <-> input helpers ----------

  function chipToRaw(c) {
    if (!c) return '';
    return c.raw;
  }

  function composedQuery() {
    const chipPart = (App.state.searchChips || []).map(chipToRaw).join(' ');
    const free = inputEl ? inputEl.value : '';
    return [chipPart, free].filter(Boolean).join(' ').trim();
  }

  function renderChips() {
    if (!chipsEl) return;
    chipsEl.innerHTML = '';
    for (const c of App.state.searchChips || []) {
      const span = document.createElement('span');
      span.className = 'search-chip';
      span.dataset.field = c.field;
      span.dataset.value = c.value;
      span.title = c.raw;
      // Tag chips inherit the per-tag color so users see at a glance which
      // tag is being filtered on.
      if (c.field === 'tag' && typeof App.getTagColor === 'function') {
        span.dataset.color = App.getTagColor(c.value);
      }

      const label = document.createElement('span');
      label.textContent = c.label;
      span.appendChild(label);

      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'search-chip-remove';
      // Field name is itself technical (brand/tag/hw/etc) — keep ARIA label in English.
      x.setAttribute('aria-label', `Remove ${c.field} filter`);
      x.textContent = '×';
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        removeChip(c);
      });
      span.appendChild(x);
      chipsEl.appendChild(span);
    }
    updateClearVisibility();
  }

  function updateClearVisibility() {
    if (!clearBtn) return;
    const has =
      (App.state.searchChips && App.state.searchChips.length > 0) ||
      (inputEl && inputEl.value.length > 0);
    clearBtn.hidden = !has;
  }

  /**
   * Convert a "field" token from the parser into a chip object.
   */
  function tokenToChip(token) {
    if (!token || token.type !== 'field') return null;
    return {
      field: token.field,
      value: token.value,
      raw: token.raw,
      label: App.SearchParser.chipLabel(token)
    };
  }

  function removeChip(c) {
    App.state.searchChips = (App.state.searchChips || []).filter((x) => x !== c);
    renderChips();
    applyQuery({ skipParseInput: true });
  }

  function clearAll() {
    App.state.searchChips = [];
    if (inputEl) inputEl.value = '';
    renderChips();
    closeDropdown();
    applyQuery({ skipParseInput: true });
  }

  /**
   * Parse the input's current value. Promote any recognised field tokens to chips
   * (replacing duplicates of the same field except for tag/has which stack), leave
   * the remaining free text in the input.
   *
   * Triggered when:
   *   - the user types a space after a token
   *   - the user hits Enter
   *   - we restore from history or smart folder
   */
  function promoteTokensFromInput() {
    if (!inputEl) return false;
    const raw = inputEl.value;
    if (!raw) return false;
    const parsed = App.SearchParser.parse(raw);
    if (!parsed || !parsed.tokens) return false;

    const fieldTokens = parsed.tokens.filter((t) => t.type === 'field' && t.value);
    if (fieldTokens.length === 0) return false;

    const chips = App.state.searchChips || [];
    const STACKABLE = new Set(['tag', 'has']);
    for (const t of fieldTokens) {
      const newChip = tokenToChip(t);
      if (!newChip) continue;
      if (STACKABLE.has(newChip.field)) {
        const dup = chips.find((c) => c.field === newChip.field && c.value === newChip.value);
        if (!dup) chips.push(newChip);
      } else {
        const idx = chips.findIndex((c) => c.field === newChip.field);
        if (idx >= 0) chips[idx] = newChip;
        else chips.push(newChip);
      }
    }
    App.state.searchChips = chips;
    inputEl.value = parsed.search || '';
    renderChips();
    return true;
  }

  /**
   * Restore the search bar from a free-form query string (history, smart folder).
   * Chips + free-text input are rebuilt from scratch.
   */
  function setQuery(queryString) {
    const parsed = App.SearchParser.parse(queryString || '');
    const chips = [];
    for (const t of parsed.tokens) {
      if (t.type !== 'field' || !t.value) continue;
      chips.push(tokenToChip(t));
    }
    App.state.searchChips = chips;
    if (inputEl) inputEl.value = parsed.search || '';
    renderChips();
  }

  // ---------- query application ----------

  function currentParsed() {
    return App.SearchParser.parse(composedQuery());
  }

  function syncDbSearchInputs() {
    // Keep the db-search input visually in sync so users who jump to that field
    // still see the filters that are active. Setting `.value` does NOT re-fire
    // the input handler — we route through refreshDatabase ourselves.
    const dbSearch = App.$('#db-search');
    if (dbSearch) {
      const parsed = currentParsed();
      dbSearch.value = parsed.search || '';
    }
  }

  function applyQuery({ skipParseInput = false } = {}) {
    if (!skipParseInput) promoteTokensFromInput();
    syncDbSearchInputs();
    updateClearVisibility();
    const q = composedQuery();
    if (App.state.searchChips.length > 0 || q) {
      // Make sure the table reflects the new query
      App.switchView('database');
      App.refreshDatabase();
    } else {
      App.refreshDatabase();
    }
  }

  function commitAndPersist() {
    promoteTokensFromInput();
    closeDropdown();
    syncDbSearchInputs();
    updateClearVisibility();
    const q = composedQuery();
    if (!q) return;
    // Apply, then record to history with the resulting row count.
    App.switchView('database');
    App.refreshDatabase().then(() => {
      const count =
        (App._dbVisibleSelectableIds && App._dbVisibleSelectableIds.length) ||
        (App._dbAllRowsCache && App._dbAllRowsCache.length) ||
        0;
      try {
        window.api.addSearchHistory(q, count);
      } catch {
        /* non-fatal */
      }
    });
  }

  // ---------- dropdown (history + suggestions) ----------

  function closeDropdown() {
    if (!dropdownEl) return;
    dropdownEl.hidden = true;
    dropdownEl.innerHTML = '';
    activeIndex = -1;
    dropdownItems = [];
    dropdownMode = 'closed';
  }

  function renderDropdown(items, mode, headerLabel, footerHtml) {
    if (!dropdownEl) return;
    dropdownEl.innerHTML = '';
    dropdownMode = mode;
    dropdownItems = items.slice();

    if (headerLabel) {
      const h = document.createElement('div');
      h.className = 'search-dropdown-section';
      h.textContent = headerLabel;
      dropdownEl.appendChild(h);
    }

    if (items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'search-dropdown-empty';
      empty.textContent =
        mode === 'history' ? App.t('search_dropdown.no_recent') : App.t('search_dropdown.no_match');
      dropdownEl.appendChild(empty);
    } else {
      items.forEach((it, idx) => {
        const row = document.createElement('div');
        row.className = 'search-dropdown-item';
        row.dataset.index = idx;
        row.setAttribute('role', 'option');
        const label = document.createElement('span');
        label.className = 'sd-label';
        label.textContent = it.label;
        const hint = document.createElement('span');
        hint.className = 'sd-hint';
        hint.textContent = it.hint || '';
        row.appendChild(label);
        row.appendChild(hint);
        row.addEventListener('mousedown', (e) => {
          // mousedown beats input blur — we want the click to win
          e.preventDefault();
          acceptDropdownItem(idx);
        });
        row.addEventListener('mouseenter', () => setActiveDropdownIndex(idx));
        dropdownEl.appendChild(row);
      });
    }

    if (footerHtml) {
      const f = document.createElement('div');
      f.className = 'search-dropdown-footer';
      f.innerHTML = footerHtml;
      dropdownEl.appendChild(f);
      const clearBtnEl = f.querySelector('[data-action="clear-history"]');
      if (clearBtnEl) {
        clearBtnEl.addEventListener('mousedown', async (e) => {
          e.preventDefault();
          try {
            await window.api.clearSearchHistory();
          } catch {
            /* non-fatal */
          }
          closeDropdown();
        });
      }
    }

    dropdownEl.hidden = false;
    setActiveDropdownIndex(items.length > 0 ? 0 : -1);
  }

  function setActiveDropdownIndex(idx) {
    activeIndex = idx;
    const rows = dropdownEl ? dropdownEl.querySelectorAll('.search-dropdown-item') : [];
    rows.forEach((r, i) => r.classList.toggle('is-active', i === idx));
    if (idx >= 0 && rows[idx] && rows[idx].scrollIntoView) {
      rows[idx].scrollIntoView({ block: 'nearest' });
    }
  }

  function acceptDropdownItem(idx) {
    const it = dropdownItems[idx];
    if (!it) return;
    if (dropdownMode === 'history') {
      setQuery(it.query);
      closeDropdown();
      applyQuery({ skipParseInput: true });
    } else if (dropdownMode === 'suggestions') {
      applySuggestion(it);
    }
  }

  function applySuggestion(it) {
    if (!inputEl) return;
    const v = inputEl.value;
    const before = v.slice(0, it.start);
    const after = v.slice(it.end);
    inputEl.value = before + it.replacement + after;
    // Move caret to end of inserted text + add a trailing space for chaining
    const caretPos = (before + it.replacement).length;
    inputEl.value = inputEl.value.slice(0, caretPos) + ' ' + inputEl.value.slice(caretPos);
    inputEl.setSelectionRange(caretPos + 1, caretPos + 1);
    inputEl.focus();
    // Promote the now-complete field token into a chip
    promoteTokensFromInput();
    // Re-show suggestions for the next token
    showSuggestions();
    applyQuery({ skipParseInput: true });
  }

  async function showHistory() {
    if (!inputEl) return;
    let rows = [];
    try {
      rows = await window.api.listSearchHistory(10);
    } catch {
      rows = [];
    }
    const items = (rows || []).map((r) => ({
      kind: 'history',
      label: r.query,
      hint: relativeTime(r.created_at),
      query: r.query
    }));
    const footer =
      rows && rows.length > 0
        ? `<span></span><button data-action="clear-history" type="button">${App.escapeHtml(App.t('search_dropdown.clear_history'))}</button>`
        : '';
    renderDropdown(items, 'history', App.t('search_dropdown.section_recent'), footer);
  }

  function showSuggestions() {
    if (!inputEl) return;
    const caret = inputEl.selectionStart == null ? inputEl.value.length : inputEl.selectionStart;
    const sugg = App.SearchParser.suggest(inputEl.value, caret, 8) || [];
    const items = sugg.map((s) => ({
      kind: 'suggest',
      label: s.label,
      hint: s.hint,
      replacement: s.replacement,
      start: s.start,
      end: s.end
    }));
    if (items.length === 0) {
      closeDropdown();
      return;
    }
    renderDropdown(items, 'suggestions', App.t('search_dropdown.section_suggestions'));
  }

  function relativeTime(unix) {
    if (!unix) return '';
    return App.timeAgo(unix);
  }

  // ---------- event wiring ----------

  function onInput() {
    clearTimeout(debounceT);
    debounceT = setTimeout(() => {
      // Auto-promote when the user types a trailing space after a complete token
      const v = inputEl.value;
      if (v.endsWith(' ')) {
        promoteTokensFromInput();
      }
      // Decide between history (empty input + no chips) vs suggestions
      if (!inputEl.value && (App.state.searchChips || []).length === 0) {
        showHistory();
      } else if (inputEl.value) {
        showSuggestions();
      } else {
        closeDropdown();
      }
      updateClearVisibility();
      applyQuery({ skipParseInput: true });
    }, DEBOUNCE_MS);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      if (dropdownEl && dropdownEl.hidden) {
        if (!inputEl.value && (App.state.searchChips || []).length === 0) showHistory();
        else showSuggestions();
        return;
      }
      e.preventDefault();
      if (dropdownItems.length === 0) return;
      setActiveDropdownIndex((activeIndex + 1) % dropdownItems.length);
      return;
    }
    if (e.key === 'ArrowUp') {
      if (dropdownEl && dropdownEl.hidden) return;
      e.preventDefault();
      if (dropdownItems.length === 0) return;
      setActiveDropdownIndex((activeIndex - 1 + dropdownItems.length) % dropdownItems.length);
      return;
    }
    if (e.key === 'Enter') {
      if (!dropdownEl.hidden && activeIndex >= 0) {
        e.preventDefault();
        acceptDropdownItem(activeIndex);
        return;
      }
      e.preventDefault();
      commitAndPersist();
      return;
    }
    if (e.key === 'Escape') {
      if (!dropdownEl.hidden) {
        e.preventDefault();
        closeDropdown();
      }
      return;
    }
    if (e.key === 'Backspace') {
      // Backspace at start of empty input → remove the last chip
      if (
        inputEl.value === '' &&
        (App.state.searchChips || []).length > 0 &&
        inputEl.selectionStart === 0
      ) {
        e.preventDefault();
        App.state.searchChips.pop();
        renderChips();
        applyQuery({ skipParseInput: true });
      }
    }
  }

  function onFocus() {
    if (!inputEl.value && (App.state.searchChips || []).length === 0) {
      showHistory();
    } else if (inputEl.value) {
      showSuggestions();
    }
  }

  function onBlur() {
    // Delay so a mousedown on a dropdown item still wins
    setTimeout(() => {
      if (!document.activeElement || !boxEl.contains(document.activeElement)) {
        closeDropdown();
      }
    }, 120);
  }

  // ---------- expose ----------

  App.setupGlobalSearchBar = function setupGlobalSearchBar() {
    inputEl = App.$('#global-search');
    chipsEl = App.$('#search-chips');
    dropdownEl = App.$('#search-dropdown');
    clearBtn = App.$('#search-clear');
    boxEl = App.$('#search-box');
    if (!inputEl || !chipsEl || !dropdownEl || !boxEl) return;

    inputEl.addEventListener('input', onInput);
    inputEl.addEventListener('keydown', onKeyDown);
    inputEl.addEventListener('focus', onFocus);
    inputEl.addEventListener('blur', onBlur);

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        clearAll();
        inputEl.focus();
      });
    }

    // Focus the input when the box is clicked anywhere (not on a chip remove)
    boxEl.addEventListener('click', (e) => {
      if (e.target.closest('.search-chip-remove')) return;
      if (e.target === inputEl) return;
      inputEl.focus();
    });

    // Click-outside to close dropdown
    document.addEventListener('mousedown', (e) => {
      if (!boxEl.contains(e.target)) closeDropdown();
    });

    // Initial cache refresh — wait a beat so the DB is ready
    setTimeout(() => {
      App.SearchParser.refreshCache().catch(() => {});
    }, 200);

    updateClearVisibility();
  };

  // Expose so the database view and smart folders can apply queries
  App.setSearchQuery = function setSearchQuery(q) {
    setQuery(q || '');
    applyQuery({ skipParseInput: true });
  };

  App.getActiveSearchParsed = function getActiveSearchParsed() {
    return currentParsed();
  };

  App.refreshSearchCache = function refreshSearchCache() {
    return App.SearchParser.refreshCache();
  };
})();
