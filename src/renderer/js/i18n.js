/* ===== i18n (localization) =====
 * Hierarchical-key translation system. Catalogs live in `locales/<code>.json`.
 *
 * Usage from JS:    App.t('skinner.title')
 *                   App.t('toasts.organized', { name: 'foo.bin' })
 *
 * Usage from HTML:  <span data-i18n="sidebar.dashboard">Dashboard</span>
 *                   <input data-i18n-placeholder="topbar.search_placeholder">
 *                   <button data-i18n-title="cmp.swap">SWAP</button>
 *                   <button data-i18n-aria-label="cmp.clear_aria">×</button>
 *
 * Falls back to English when a key is missing in the active locale, and to the
 * raw key when both catalogs lack it. Placeholders use `{name}` syntax.
 */
window.App = window.App || {};

window.App.i18n = (function () {
  let _currentLocale = 'en';
  let _catalog = {};
  let _fallbackCatalog = {};
  const _listeners = new Set();

  async function load(code) {
    const res = await fetch(`locales/${code}.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${code}.json`);
    return res.json();
  }

  async function setLocale(code) {
    // Avoid pointless re-loads of the same locale.
    if (code === _currentLocale && Object.keys(_catalog).length > 0) {
      applyDom();
      return;
    }
    try {
      const next = await load(code);
      _catalog = next;
      _currentLocale = code;
      // Keep an English fallback warm so missing keys in fr/de degrade gracefully.
      if (code !== 'en' && Object.keys(_fallbackCatalog).length === 0) {
        try {
          _fallbackCatalog = await load('en');
        } catch (_e) {
          /* non-fatal — fall back to raw key */
        }
      } else if (code === 'en') {
        _fallbackCatalog = next;
      }
      applyDom();
      for (const cb of _listeners) {
        try {
          cb(code);
        } catch (_e) {
          /* listener errors must never break the i18n pipeline */
        }
      }
    } catch (err) {
      // Log but never throw: a missing locale file must NOT brick the UI.
      // eslint-disable-next-line no-console
      console.error('[i18n] failed to load locale', code, err);
    }
  }

  /**
   * Hierarchical key lookup: 'sidebar.dashboard' -> catalog.sidebar.dashboard.
   * Returns undefined if any segment is missing.
   */
  function lookup(catalog, key) {
    if (!catalog || typeof key !== 'string') return undefined;
    return key
      .split('.')
      .reduce((obj, seg) => (obj && obj[seg] !== undefined ? obj[seg] : undefined), catalog);
  }

  /**
   * Translate. Falls back to English, then to the raw key. Supports {placeholders}.
   * @param {string} key
   * @param {Record<string, string|number>=} params
   */
  function t(key, params) {
    let s = lookup(_catalog, key);
    if (s === undefined) s = lookup(_fallbackCatalog, key);
    if (s === undefined) {
      // eslint-disable-next-line no-console
      console.warn('[i18n] missing key:', key);
      return key;
    }
    if (params && typeof s === 'string') {
      for (const [k, v] of Object.entries(params)) {
        // Global replace so a token can appear more than once in a sentence.
        s = s.replace(new RegExp('\\{' + k + '\\}', 'g'), String(v));
      }
    }
    return s;
  }

  /**
   * Replace data-i18n=, data-i18n-placeholder=, data-i18n-title=, and
   * data-i18n-aria-label= attributes in the live DOM. Idempotent — safe to call
   * after partial re-renders.
   */
  function applyDom(root) {
    const r = root || document;
    r.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (key) el.textContent = t(key);
    });
    r.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', t(key));
    });
    r.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.setAttribute('title', t(key));
    });
    r.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria-label');
      if (key) el.setAttribute('aria-label', t(key));
    });
  }

  function getLocale() {
    return _currentLocale;
  }

  function onLocaleChange(cb) {
    _listeners.add(cb);
    return () => _listeners.delete(cb);
  }

  return { t, setLocale, getLocale, onLocaleChange, applyDom, _internal: { lookup } };
})();

// Top-level shortcut so `App.t('foo.bar')` works.
window.App.t = (...args) => window.App.i18n.t(...args);
