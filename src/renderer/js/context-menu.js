/* ===== Right-click context menus =====
 * App.contextMenu.show({ x, y, items })       — open at a coordinate
 * App.contextMenu.attach(selector, builder)   — bind right-click delegation
 *                                                builder(event, target) → items[]
 * App.contextMenu.hide()                      — close any open menu
 *
 * Item shape:
 *   { label, icon?, shortcut?, run(), disabled?, destructive? }
 *   { separator: true }
 *
 * Menus auto-position so they never overflow the viewport. Closing happens on
 * click-outside, Escape, scroll, or switching views. Event delegation is bound
 * to the document so dynamically-added rows are covered without rewiring.
 */
window.App = window.App || {};

(function () {
  const App = window.App;
  const attachments = []; // { selector, builder }
  let menuEl = null;

  function ensureRoot() {
    if (menuEl && menuEl.isConnected) return menuEl;
    menuEl = document.createElement('div');
    menuEl.className = 'ctx-menu';
    menuEl.setAttribute('role', 'menu');
    menuEl.hidden = true;
    document.body.appendChild(menuEl);
    return menuEl;
  }

  function hide() {
    if (!menuEl) return;
    menuEl.hidden = true;
    menuEl.innerHTML = '';
  }

  function render(items) {
    const root = ensureRoot();
    root.innerHTML = '';
    for (const it of items) {
      if (!it) continue;
      if (it.separator) {
        const sep = document.createElement('div');
        sep.className = 'ctx-menu-separator';
        root.appendChild(sep);
        continue;
      }
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ctx-menu-item' + (it.destructive ? ' destructive' : '');
      btn.setAttribute('role', 'menuitem');
      if (it.disabled) {
        btn.disabled = true;
        btn.classList.add('disabled');
      }

      const left = document.createElement('span');
      left.className = 'ctx-menu-left';
      if (it.icon) {
        const ic = document.createElement('span');
        ic.className = 'ctx-menu-icon';
        ic.innerHTML = it.icon; // caller controls safety; we use simple glyphs
        left.appendChild(ic);
      }
      const label = document.createElement('span');
      label.className = 'ctx-menu-label';
      label.textContent = String(it.label == null ? '' : it.label);
      left.appendChild(label);
      btn.appendChild(left);

      if (it.shortcut) {
        const k = document.createElement('kbd');
        k.className = 'ctx-menu-shortcut';
        k.textContent = String(it.shortcut);
        btn.appendChild(k);
      }

      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (it.disabled) return;
        hide();
        try {
          if (typeof it.run === 'function') it.run();
        } catch (err) {
          if (App.toast)
            App.toast.error(App.t('toasts.action_failed', { msg: err.message || err }));
        }
      });
      root.appendChild(btn);
    }
  }

  function show({ x, y, items }) {
    if (!Array.isArray(items) || items.length === 0) return;
    render(items);
    const root = ensureRoot();
    // Position off-screen first so we can measure, then constrain to viewport.
    root.style.left = '-9999px';
    root.style.top = '-9999px';
    root.hidden = false;

    const rect = root.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let left = x;
    let top = y;
    if (left + rect.width + 6 > vw) left = Math.max(6, vw - rect.width - 6);
    if (top + rect.height + 6 > vh) top = Math.max(6, vh - rect.height - 6);
    root.style.left = left + 'px';
    root.style.top = top + 'px';

    // Focus first non-disabled item for keyboard users.
    const first = root.querySelector('.ctx-menu-item:not(.disabled)');
    if (first) setTimeout(() => first.focus(), 0);
  }

  // Global wiring (idempotent).
  let wired = false;
  function wire() {
    if (wired) return;
    wired = true;

    document.addEventListener(
      'contextmenu',
      (e) => {
        // Walk attachments in registration order; the first matching selector
        // wins. This lets specific selectors (e.g. .smart-folder-item) take
        // precedence over generic ones if they were registered first.
        for (const a of attachments) {
          const t = e.target.closest(a.selector);
          if (!t) continue;
          let items = null;
          try {
            items = a.builder(e, t);
          } catch (err) {
            if (App.toast) App.toast.error(App.t('toasts.menu_error', { msg: err.message || err }));
            return;
          }
          if (!Array.isArray(items) || items.length === 0) continue;
          e.preventDefault();
          e.stopPropagation();
          show({ x: e.clientX, y: e.clientY, items });
          return;
        }
      },
      true
    );

    // Dismiss on click anywhere except inside the menu.
    document.addEventListener(
      'mousedown',
      (e) => {
        if (!menuEl || menuEl.hidden) return;
        if (e.target.closest('.ctx-menu')) return;
        hide();
      },
      true
    );

    document.addEventListener('keydown', (e) => {
      if (!menuEl || menuEl.hidden) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        hide();
        return;
      }
      // Arrow-key navigation within the menu.
      const items = Array.from(menuEl.querySelectorAll('.ctx-menu-item:not(.disabled)'));
      if (items.length === 0) return;
      const idx = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        items[(idx + 1) % items.length].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        items[(idx - 1 + items.length) % items.length].focus();
      }
    });

    // Scroll, resize, or view-switch all dismiss the menu.
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
  }

  App.contextMenu = {
    show,
    hide,
    attach(selector, builder) {
      if (typeof selector !== 'string' || typeof builder !== 'function') return;
      attachments.push({ selector, builder });
    }
  };

  App.setupContextMenu = function setupContextMenu() {
    wire();
  };
})();
