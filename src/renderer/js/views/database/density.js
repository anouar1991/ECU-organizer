/* ===== Database view: density toggle (compact / comfortable / spacious) =====
 * Toggles a single body class. CSS does the rest (see styles.css density-*).
 * Wires the three buttons once and exposes App.applyDbDensity for callers
 * that change density programmatically (settings restore at view mount).
 */
window.App = window.App || {};

(function () {
  const App = window.App;

  const VALID = new Set(['compact', 'comfortable', 'spacious']);

  App.applyDbDensity = function applyDbDensity(d) {
    const density = VALID.has(d) ? d : 'comfortable';
    App.state.dbDensity = density;
    const body = document.body;
    body.classList.remove('density-compact', 'density-comfortable', 'density-spacious');
    body.classList.add('density-' + density);
    // Reflect the active button.
    document.querySelectorAll('.db-density-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.density === density);
    });
  };

  App.ensureDbDensityWired = function ensureDbDensityWired() {
    if (App._dbDensityWired) return;
    App._dbDensityWired = true;
    document.querySelectorAll('.db-density-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const d = btn.dataset.density;
        if (!VALID.has(d)) return;
        App.applyDbDensity(d);
        App.saveDbDensity(d);
      });
    });
  };
})();
