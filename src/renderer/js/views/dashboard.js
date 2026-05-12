/* ===== Dashboard view ===== */
window.App = window.App || {};

(function () {
  const App = window.App;

  App.refreshDashboard = async function refreshDashboard() {
    const $ = App.$;
    const escapeHtml = App.escapeHtml;
    const formatBytes = App.formatBytes;

    const stats = await window.api.getStats();
    $('#stat-total').textContent = stats.total;
    $('#stat-size').textContent = formatBytes(stats.totalSize);
    $('#stat-confidence').textContent = `${stats.avgConfidence}%`;
    if ($('#stat-kind-split'))
      $('#stat-kind-split').textContent = `${stats.originals || 0} / ${stats.solutions || 0}`;

    App.renderBarList('brand-list', stats.byBrand);
    App.renderBarList('ecu-list', stats.byEcu);
    if ($('#top-originals-list')) App.renderBarList('top-originals-list', stats.topOriginals || []);

    const recentEl = $('#recent-list');
    recentEl.innerHTML = '';
    if (stats.recent.length === 0) {
      // Friendly CTA for first-run users. Skips when stats are still loading
      // (we only reach this branch after the IPC resolves).
      recentEl.innerHTML = `
        <div class="empty-state-cta">
          <div class="empty-state-cta-icon">🎯</div>
          <div class="empty-state-cta-title">${escapeHtml(App.t('dashboard.welcome_title'))}</div>
          <div class="empty-state-cta-sub">
            ${escapeHtml(App.t('dashboard.welcome_sub'))}
          </div>
          <div class="empty-state-cta-actions">
            <button class="btn-primary" id="dashboard-cta-drop">${escapeHtml(App.t('dashboard.drop_a_file'))}</button>
            <button class="btn-secondary" id="dashboard-cta-pick">${escapeHtml(App.t('dashboard.pick_from_disk'))}</button>
          </div>
        </div>
      `;
      const dropBtn = $('#dashboard-cta-drop');
      const pickBtn = $('#dashboard-cta-pick');
      if (dropBtn) dropBtn.addEventListener('click', () => App.switchView('skinner'));
      if (pickBtn) {
        pickBtn.addEventListener('click', async () => {
          App.switchView('skinner');
          const paths = await window.api.selectFiles();
          if (paths && paths.length > 0 && typeof App.ingestFiles === 'function') {
            await App.ingestFiles(paths);
          }
        });
      }
      return;
    }
    for (const r of stats.recent) {
      const row = document.createElement('div');
      row.className = 'recent-row';
      const kindTag =
        r.kind === 'solution'
          ? `<span class="kind-badge kind-solution">${App.escapeHtml(App.t('dashboard.kind_solution'))}</span> `
          : `<span class="kind-badge kind-original">${App.escapeHtml(App.t('dashboard.kind_original'))}</span> `;
      row.innerHTML = `<div class="left">${kindTag}${escapeHtml(r.new_name)}</div>
                       <div class="right">${escapeHtml(r.brand || '?')} • ${escapeHtml(r.ecu_type || '?')} • ${new Date(r.created_at * 1000).toLocaleString()}</div>`;
      recentEl.appendChild(row);
    }
  };

  App.renderBarList = function renderBarList(elId, items) {
    const escapeHtml = App.escapeHtml;
    const el = document.getElementById(elId);
    el.innerHTML = '';
    if (!items || items.length === 0) {
      el.innerHTML = `<div class="empty-row">${App.escapeHtml(App.t('dashboard.no_data'))}</div>`;
      return;
    }
    const max = Math.max(...items.map((i) => i.c));
    for (const it of items) {
      const row = document.createElement('div');
      row.className = 'bar-row';
      const pct = max > 0 ? (it.c / max) * 100 : 0;
      row.innerHTML = `<div class="bar-label">${escapeHtml(it.k || App.t('dashboard.unknown_bucket'))}</div>
                       <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
                       <div class="bar-count">${it.c}</div>`;
      el.appendChild(row);
    }
  };
})();
