/* ===== Reusable modal dialog =====
 * appModal({ title, body, buttons, variant }) -> Promise<value>
 *   title    : string
 *   body     : string (HTML allowed; caller controls safety)
 *   buttons  : [{ label, value, primary?, destructive? }]
 *   variant  : 'confirm' | 'choice' | 'destructive' (optional)
 * Resolves with the clicked button's value, or null if dismissed
 * (Esc, overlay click, or close icon).
 */
window.App = window.App || {};

window.App.appModal = function appModal({ title, body, buttons, variant }) {
  const $ = window.App.$;
  return new Promise((resolve) => {
    const overlay = $('#app-modal-overlay');
    const modal = $('#app-modal');
    modal.className = 'app-modal' + (variant ? ' variant-' + variant : '');
    $('#app-modal-title').textContent = title;
    $('#app-modal-body').innerHTML = body; // caller controls safety

    const btnContainer = $('#app-modal-buttons');
    btnContainer.innerHTML = '';
    const buttonEls = [];
    let defaultBtn = null;
    for (const b of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className =
        'btn-secondary small' +
        (b.primary ? ' primary' : '') +
        (b.destructive ? ' destructive' : '');
      el.textContent = b.label;
      el.addEventListener('click', () => closeModal(b.value));
      if ((b.primary || b.destructive) && !defaultBtn) defaultBtn = el;
      buttonEls.push(el);
      btnContainer.appendChild(el);
    }
    if (!defaultBtn && buttonEls.length) defaultBtn = buttonEls[buttonEls.length - 1];

    const focusable = () => [$('#app-modal-close'), ...buttonEls].filter(Boolean);

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeModal(null);
      } else if (e.key === 'Tab') {
        // Focus trap within the modal
        const els = focusable();
        if (!els.length) return;
        const idx = els.indexOf(document.activeElement);
        e.preventDefault();
        let nextIdx;
        if (e.shiftKey) {
          nextIdx = idx <= 0 ? els.length - 1 : idx - 1;
        } else {
          nextIdx = idx === els.length - 1 || idx === -1 ? 0 : idx + 1;
        }
        els[nextIdx].focus();
      }
    };
    const onOverlayClick = (e) => {
      if (e.target === overlay) closeModal(null);
    };

    function closeModal(value) {
      overlay.hidden = true;
      document.removeEventListener('keydown', onKey);
      overlay.removeEventListener('click', onOverlayClick);
      resolve(value);
    }

    $('#app-modal-close').onclick = () => closeModal(null);
    overlay.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKey);

    overlay.hidden = false;
    setTimeout(() => defaultBtn && defaultBtn.focus(), 50);
  });
};
