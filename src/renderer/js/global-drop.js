/* ===== Full-window file drop =====
 * Drop a recognised ECU file ANYWHERE in the window → switch to File Skinner
 * and ingest. Sub-zones (the Skinner card, Compare slots) keep working as
 * before; this overlay only shows when the drag is outside those targeted
 * zones.
 *
 * Accepted extensions (case-insensitive): .bin .ori .mod .frf .sgo .kp
 *
 * Visual: a fixed overlay fades in on dragenter, fades out on dragleave/drop.
 * We track a depth counter because dragenter/dragleave fire many times as the
 * pointer crosses child elements — the overlay must only hide when the count
 * returns to zero.
 */
window.App = window.App || {};

(function () {
  const App = window.App;

  const ACCEPT_EXTS = new Set(['.bin', '.ori', '.mod', '.frf', '.sgo', '.kp']);

  function extOf(name) {
    if (!name) return '';
    const i = String(name).lastIndexOf('.');
    return i >= 0 ? String(name).slice(i).toLowerCase() : '';
  }

  App.isSupportedEcuFileName = function isSupportedEcuFileName(name) {
    return ACCEPT_EXTS.has(extOf(name));
  };

  function isFileDrag(e) {
    if (!e.dataTransfer) return false;
    const types = e.dataTransfer.types;
    if (!types) return false;
    // DataTransferItemList is array-like across Chromium/Firefox; both have
    // .includes via Array.from. Fall back to a manual loop just in case.
    if (typeof types.includes === 'function') return types.includes('Files');
    for (let i = 0; i < types.length; i++) if (types[i] === 'Files') return true;
    return false;
  }

  // Skinner card + compare slots already handle their own dragenter/drop.
  // When the overlay is over one of those, we suppress the global one to let
  // the local zone style its own outline.
  function isOverLocalZone(target) {
    if (!target) return false;
    if (target.closest && target.closest('#drop-zone')) return true;
    if (target.closest && target.closest('.cmp-dropzone')) return true;
    return false;
  }

  App.setupGlobalDrop = function setupGlobalDrop() {
    const overlay = document.getElementById('global-drop-overlay');
    if (!overlay) return;
    let depth = 0;

    function showOverlay() {
      overlay.hidden = false;
      // Force reflow so the visibility class transition runs.
      void overlay.offsetWidth;
      overlay.classList.add('is-visible');
    }
    function hideOverlay() {
      overlay.classList.remove('is-visible');
      depth = 0;
      // Give the fade time to play before hiding the node.
      setTimeout(() => {
        if (!overlay.classList.contains('is-visible')) overlay.hidden = true;
      }, 180);
    }

    document.addEventListener('dragenter', (e) => {
      if (!isFileDrag(e)) return;
      if (isOverLocalZone(e.target)) {
        // Don't fight with the local zone — but still consume so the cursor
        // shows the correct "copy" affordance globally.
        e.preventDefault();
        return;
      }
      e.preventDefault();
      depth++;
      if (depth === 1) showOverlay();
    });

    document.addEventListener('dragover', (e) => {
      if (!isFileDrag(e)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });

    document.addEventListener('dragleave', (e) => {
      if (!isFileDrag(e)) return;
      // dragleave fires when crossing child boundaries — only treat the
      // event as "left the window" when relatedTarget is null or the body.
      const left = !e.relatedTarget || e.relatedTarget.nodeName === 'HTML';
      depth = Math.max(0, depth - 1);
      if (depth === 0 || left) {
        depth = 0;
        hideOverlay();
      }
    });

    document.addEventListener('drop', async (e) => {
      if (!isFileDrag(e)) return;
      // If the drop is inside the Skinner card or a Compare slot, those
      // listeners already handle it; we just hide the overlay.
      if (isOverLocalZone(e.target)) {
        hideOverlay();
        return;
      }
      e.preventDefault();
      hideOverlay();

      const files = e.dataTransfer ? Array.from(e.dataTransfer.files || []) : [];
      if (files.length === 0) return;

      const paths = [];
      const rejected = [];
      for (const f of files) {
        const p = window.api.getPathForFile(f);
        if (!p) {
          rejected.push(f.name + ' (no path)');
          continue;
        }
        if (!App.isSupportedEcuFileName(f.name)) {
          rejected.push(f.name);
          continue;
        }
        paths.push(p);
      }

      if (rejected.length > 0 && App.toast) {
        const names = rejected.slice(0, 3).join(', ') + (rejected.length > 3 ? '…' : '');
        const tk =
          rejected.length === 1 ? 'toasts.drop_unsupported_one' : 'toasts.drop_unsupported_many';
        App.toast.warn(App.t(tk, { n: rejected.length, names }));
      }
      if (paths.length === 0) {
        if (rejected.length === 0 && App.toast) {
          App.toast.warn(App.t('toasts.no_file_path'));
        }
        return;
      }

      // Always switch to Skinner so the user sees the file tray + metadata.
      if (typeof App.switchView === 'function') App.switchView('skinner');
      if (typeof App.ingestFiles === 'function') {
        await App.ingestFiles(paths);
      }
    });

    // Hard-reset overlay state when the window loses focus / drag aborts on
    // platforms that swallow dragleave (rare but observed on Linux Wayland).
    window.addEventListener('blur', () => {
      if (!overlay.hidden) hideOverlay();
    });
  };
})();
