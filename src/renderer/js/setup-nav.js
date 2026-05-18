/* ===== Navigation ===== */
window.App = window.App || {};

window.App.setupNavigation = function setupNavigation() {
  window.App.$$('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => window.App.switchView(btn.dataset.view));
  });

  // Global Ctrl+K / Cmd+K → toggle the command palette. Bound at document
  // level so it works from anywhere — even when no input is focused.
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      // Don't fight with browser/Electron find shortcuts on Mac (Cmd+K is free).
      e.preventDefault();
      e.stopPropagation();
      if (window.App.cmdPalette && typeof window.App.cmdPalette.toggle === 'function') {
        window.App.cmdPalette.toggle();
      }
    }
  });
};

window.App.switchView = function switchView(viewName) {
  const $$ = window.App.$$;
  $$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === viewName));
  $$('.view').forEach((v) => v.classList.toggle('active', v.dataset.view === viewName));

  if (viewName === 'dashboard') window.App.refreshDashboard();
  if (viewName === 'database') window.App.refreshDatabase();
  if (viewName === 'settings') window.App.loadArchiveRoot();
  if (viewName === 'compare') window.App.resetComparatorIfEmpty();
  if (viewName === 'duplicates' && typeof window.App.refreshDuplicates === 'function') {
    window.App.refreshDuplicates('exact');
  }
  if (viewName === 'tag-management' && typeof window.App.refreshTagManagement === 'function') {
    window.App.refreshTagManagement();
  }
  if (viewName === 'pinouts' && typeof window.App.onShowPinoutsView === 'function') {
    window.App.onShowPinoutsView();
  }
};
