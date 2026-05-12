/* ===== Toast notifications =====
 * Non-blocking top-right corner messages. Stacking, auto-dismiss, click to
 * dismiss. Exposes App.toast.{success,info,warn,error}(message, opts?) and
 * returns a handle { dismiss(), update(msg, opts?) } for programmatic control.
 *
 * Options:
 *   duration   — ms before auto-dismiss (default 4000). 0 or `persistent:true`
 *                disables auto-dismiss.
 *   persistent — boolean; equivalent to duration:0
 *   title      — optional bold header text; the message becomes the body
 *
 * Visual: colored left border + icon, slide-in from right. z-index lives
 * ABOVE the modal overlay so error toasts don't get hidden behind dialogs.
 */
window.App = window.App || {};

(function () {
  const App = window.App;

  let containerEl = null;
  let seq = 0;

  function ensureContainer() {
    if (containerEl && containerEl.isConnected) return containerEl;
    containerEl = document.getElementById('toast-container');
    if (!containerEl) {
      containerEl = document.createElement('div');
      containerEl.id = 'toast-container';
      containerEl.className = 'toast-container';
      document.body.appendChild(containerEl);
    }
    return containerEl;
  }

  function iconSvgFor(level) {
    switch (level) {
      case 'success':
        return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="m7 12 3.5 3.5L17 9" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      case 'warn':
        return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 3 2 21h20Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 10v5M12 18h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      case 'error':
        return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      case 'info':
      default:
        return '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 8v0M12 11v6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    }
  }

  function show(level, message, opts) {
    const o = opts || {};
    const id = `toast-${++seq}`;
    const duration = o.persistent ? 0 : typeof o.duration === 'number' ? o.duration : 4000;
    const container = ensureContainer();

    const el = document.createElement('div');
    el.className = `toast toast-${level}`;
    el.id = id;
    el.setAttribute('role', level === 'error' || level === 'warn' ? 'alert' : 'status');

    const iconWrap = document.createElement('span');
    iconWrap.className = 'toast-icon';
    iconWrap.innerHTML = iconSvgFor(level);

    const body = document.createElement('div');
    body.className = 'toast-body';

    if (o.title) {
      const t = document.createElement('div');
      t.className = 'toast-title';
      t.textContent = String(o.title);
      body.appendChild(t);
    }
    const msg = document.createElement('div');
    msg.className = 'toast-message';
    msg.textContent = String(message == null ? '' : message);
    body.appendChild(msg);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = 'toast-close';
    // App.t is available once App.i18n has loaded a catalog; before that we fall
    // back to the raw key (the i18n module handles missing keys).
    closeBtn.setAttribute(
      'aria-label',
      App.t ? App.t('toasts.dismiss_aria') : 'Dismiss notification'
    );
    closeBtn.textContent = '×';

    el.appendChild(iconWrap);
    el.appendChild(body);
    el.appendChild(closeBtn);
    container.appendChild(el);

    // Force a layout flush so the slide-in transition can run.
    void el.offsetWidth;
    el.classList.add('is-visible');

    let timer = null;
    let dismissed = false;

    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      el.classList.remove('is-visible');
      el.classList.add('is-leaving');
      // Match the CSS exit transition before removing the node.
      setTimeout(() => {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 220);
    }

    function armTimer() {
      if (duration > 0) {
        if (timer) clearTimeout(timer);
        timer = setTimeout(dismiss, duration);
      }
    }

    function update(newMessage, newOpts) {
      msg.textContent = String(newMessage == null ? '' : newMessage);
      if (newOpts && Object.prototype.hasOwnProperty.call(newOpts, 'title')) {
        let titleEl = body.querySelector('.toast-title');
        if (newOpts.title) {
          if (!titleEl) {
            titleEl = document.createElement('div');
            titleEl.className = 'toast-title';
            body.insertBefore(titleEl, msg);
          }
          titleEl.textContent = String(newOpts.title);
        } else if (titleEl) {
          titleEl.remove();
        }
      }
      // Reset auto-dismiss countdown unless explicitly told not to.
      if (!newOpts || newOpts.resetTimer !== false) armTimer();
    }

    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      dismiss();
    });
    el.addEventListener('click', dismiss);
    el.addEventListener('mouseenter', () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    });
    el.addEventListener('mouseleave', () => {
      if (!dismissed) armTimer();
    });

    armTimer();
    return { id, dismiss, update };
  }

  App.toast = {
    success(message, opts) {
      return show('success', message, opts);
    },
    info(message, opts) {
      return show('info', message, opts);
    },
    warn(message, opts) {
      return show('warn', message, opts);
    },
    error(message, opts) {
      // Errors default to a longer dwell — 8s.
      const o = Object.assign({ duration: 8000 }, opts || {});
      return show('error', message, o);
    },
    // Convenience: dismiss every visible toast.
    dismissAll() {
      const c = ensureContainer();
      Array.from(c.querySelectorAll('.toast .toast-close')).forEach((b) => b.click());
    }
  };

  // Idempotent init hook (called from main.js, safe to call multiple times).
  App.setupToasts = function setupToasts() {
    ensureContainer();
  };
})();
