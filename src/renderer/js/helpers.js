/* ===== DOM + string helpers shared by every view ===== */
window.App = window.App || {};

window.App.$ = (sel) => document.querySelector(sel);
window.App.$$ = (sel) => document.querySelectorAll(sel);

window.App.escapeHtml = function escapeHtml(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
};

window.App.formatBytes = function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '0 B';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
};

window.App.timeAgo = function timeAgo(unixTs) {
  const diff = Math.floor(Date.now() / 1000 - unixTs);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

window.App.sanitize = function sanitize(value) {
  if (!value) return 'Unknown';
  return String(value)
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 80);
};

window.App.applyMask = function applyMask(mask, metadata, fileName, stageOverride) {
  const sanitize = window.App.sanitize;
  const ext = (fileName.match(/\.[^.]+$/) || ['.bin'])[0];
  const baseName = fileName.replace(/\.[^.]+$/, '');
  const stage = stageOverride || 'STOCK';
  const replacements = {
    '[BRAND]': sanitize(metadata.brand),
    '[MODEL]': sanitize(metadata.model),
    '[ECU]': sanitize(metadata.ecuType),
    '[HW]': sanitize(metadata.hwId || 'NOHW'),
    '[SW]': sanitize(metadata.swId || 'NOSW'),
    '[STAGE]': sanitize(stage),
    '[ORIG]': sanitize(baseName),
    '[DATE]': new Date().toISOString().slice(0, 10).replace(/-/g, ''),
    '[PROTOCOL]': sanitize(
      Array.isArray(metadata.protocol) ? metadata.protocol[0] : metadata.protocol
    )
  };
  let result = mask;
  for (const [token, value] of Object.entries(replacements)) {
    result = result.split(token).join(value);
  }
  if (!/\.[^.]+$/.test(result)) result += ext;
  return result;
};

window.App.splitTags = function splitTags(tagsStr) {
  if (!tagsStr) return [];
  return tagsStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

window.App.detectStage = function detectStage(fileName) {
  const m = /stage[ _]?(\d+)/i.exec(fileName) || /(STG|stg)(\d+)/i.exec(fileName);
  if (m) return `STAGE${m[m.length - 1]}`;
  if (/stock|orig/i.test(fileName)) return 'STOCK';
  if (/mod|tuned|map/i.test(fileName)) return 'MOD';
  return 'STOCK';
};

/** Fixed palette — must mirror the CSS data-color rules. */
window.App.TAG_COLORS = [
  'gray',
  'red',
  'orange',
  'yellow',
  'lime',
  'green',
  'cyan',
  'blue',
  'indigo',
  'purple',
  'pink',
  'slate'
];

/** Returns the persisted color for a tag, defaulting to 'gray'. */
window.App.getTagColor = function getTagColor(tagName) {
  if (!tagName) return 'gray';
  const map = window.App.state.tagColors;
  return (map && map.get(tagName)) || 'gray';
};

/**
 * Fetch tag_meta from the backend and refresh the in-memory color/description
 * caches. Returns the raw list for callers that need usage counts.
 */
window.App.loadTagMeta = async function loadTagMeta() {
  if (!window.api || typeof window.api.listTagMeta !== 'function') {
    return [];
  }
  let list;
  try {
    list = await window.api.listTagMeta();
  } catch {
    return [];
  }
  if (!Array.isArray(list)) return [];
  const colors = new Map();
  const descs = new Map();
  for (const t of list) {
    if (!t || !t.name) continue;
    colors.set(t.name, t.color || 'gray');
    if (t.description) descs.set(t.name, t.description);
  }
  window.App.state.tagColors = colors;
  window.App.state.tagDescriptions = descs;
  return list;
};

/* ===== Reusable tag-autocomplete helper =====
 * Attaches an inline dropdown to any tag-add input, drawing suggestions from
 * the global SearchParser tag cache. The caller controls what happens when
 * a tag is picked via `onPick(tag)` — typical use is "push into the file's
 * tag list and clear the input".
 *
 * Options:
 *   onPick(tag)            -> called with the chosen tag (existing or freshly typed)
 *   position: 'below'|'above'  -> dropdown anchor (default 'below')
 *   excludeExisting()      -> () => string[] of tags already on the row, hidden from suggestions
 *   limit                  -> max suggestions (default 10)
 *
 * Returns a `detach()` function so the caller can remove the dropdown if the
 * input is replaced (re-render cycles).
 */
window.App.attachTagAutocomplete = function attachTagAutocomplete(inputEl, options) {
  if (!inputEl || inputEl._tagAcAttached) return () => {};
  inputEl._tagAcAttached = true;
  const App = window.App;
  const opts = options || {};
  const position = opts.position === 'above' ? 'above' : 'below';
  const limit = typeof opts.limit === 'number' ? opts.limit : 10;
  const onPick = typeof opts.onPick === 'function' ? opts.onPick : null;

  // Dropdown is built lazily on first focus to avoid layout cost.
  let dropdown = null;
  let activeIdx = -1;
  let currentList = [];

  function ensureDropdown() {
    if (dropdown) return dropdown;
    dropdown = document.createElement('div');
    dropdown.className = 'tag-autocomplete-dropdown';
    dropdown.setAttribute('role', 'listbox');
    dropdown.hidden = true;
    // The dropdown must be a sibling of the input so position: absolute is
    // anchored to a positioned wrapper. We climb to the closest positioned
    // ancestor; if none is found we wrap the input.
    let host = inputEl.parentElement;
    if (host) {
      const cs = window.getComputedStyle(host);
      if (cs.position === 'static') host.style.position = 'relative';
    } else {
      host = inputEl;
    }
    host.appendChild(dropdown);
    return dropdown;
  }

  function computeList(prefix) {
    const cache = App.SearchParser && App.SearchParser._cache;
    const all = cache && Array.isArray(cache.tags) ? cache.tags : [];
    const exclude = new Set(
      typeof opts.excludeExisting === 'function' ? opts.excludeExisting() || [] : []
    );
    const lc = String(prefix || '').toLowerCase();
    const matches = [];
    for (const t of all) {
      if (exclude.has(t)) continue;
      const lct = t.toLowerCase();
      if (!lc || lct.includes(lc)) matches.push(t);
    }
    matches.sort((a, b) => {
      const sa = a.toLowerCase().startsWith(lc) ? 0 : 1;
      const sb = b.toLowerCase().startsWith(lc) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      return a.localeCompare(b);
    });
    return matches.slice(0, limit);
  }

  function render(prefix) {
    const dd = ensureDropdown();
    const list = computeList(prefix);
    currentList = list;
    activeIdx = list.length > 0 ? 0 : -1;
    if (list.length === 0) {
      dd.hidden = true;
      return;
    }
    dd.innerHTML = '';
    list.forEach((tag, i) => {
      const item = document.createElement('div');
      item.className = 'tag-autocomplete-item' + (i === activeIdx ? ' is-active' : '');
      item.setAttribute('role', 'option');
      const color = App.getTagColor(tag);
      item.innerHTML = `<span class="tag-chip tag-chip-mini" data-color="${App.escapeHtml(color)}">${App.escapeHtml(tag)}</span>`;
      // Use mousedown so the click fires before the input's blur handler hides
      // the dropdown.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(tag);
      });
      item.addEventListener('mouseenter', () => {
        activeIdx = i;
        refreshActive();
      });
      dd.appendChild(item);
    });
    dd.classList.toggle('tag-autocomplete-above', position === 'above');
    dd.hidden = false;
  }

  function refreshActive() {
    if (!dropdown) return;
    dropdown.querySelectorAll('.tag-autocomplete-item').forEach((el, i) => {
      el.classList.toggle('is-active', i === activeIdx);
    });
  }

  function hide() {
    if (dropdown) dropdown.hidden = true;
  }

  function pick(tag) {
    if (!tag) return;
    if (onPick) onPick(tag);
    inputEl.value = '';
    hide();
    inputEl.focus();
  }

  inputEl.addEventListener('focus', () => {
    render(inputEl.value);
  });
  inputEl.addEventListener('input', () => {
    render(inputEl.value);
  });
  inputEl.addEventListener('blur', () => {
    // Delay so a click on a dropdown item still registers.
    setTimeout(hide, 120);
  });
  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      if (!dropdown || dropdown.hidden) return;
      e.preventDefault();
      activeIdx = Math.min(currentList.length - 1, activeIdx + 1);
      refreshActive();
    } else if (e.key === 'ArrowUp') {
      if (!dropdown || dropdown.hidden) return;
      e.preventDefault();
      activeIdx = Math.max(0, activeIdx - 1);
      refreshActive();
    } else if (e.key === 'Enter') {
      // If a suggestion is highlighted AND the input is non-empty, prefer the
      // suggestion. If the input is empty, do nothing (the suggestion-list
      // default-highlight should not commit on bare Enter). If no suggestion,
      // fall through so the caller's own Enter handler can create a new tag.
      if (dropdown && !dropdown.hidden && activeIdx >= 0 && currentList[activeIdx]) {
        // Only consume Enter when the highlighted suggestion is NOT just the
        // verbatim user input. That way pressing Enter with a free-text tag
        // creates a new tag instead of "auto-completing" to the same string.
        const suggestion = currentList[activeIdx];
        const typed = inputEl.value.trim();
        if (suggestion.toLowerCase() !== typed.toLowerCase()) {
          e.preventDefault();
          e.stopPropagation();
          pick(suggestion);
          return;
        }
      }
      // Otherwise let the caller's Enter handler proceed.
      hide();
    } else if (e.key === 'Escape') {
      if (dropdown && !dropdown.hidden) {
        e.preventDefault();
        e.stopPropagation();
        hide();
      }
    }
  });

  return function detach() {
    inputEl._tagAcAttached = false;
    if (dropdown && dropdown.parentNode) dropdown.parentNode.removeChild(dropdown);
    dropdown = null;
  };
};
