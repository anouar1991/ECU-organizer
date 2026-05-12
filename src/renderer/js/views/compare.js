/* ===== Compare view =====
 * File slots (A/B), dropzones, archive picker, comparison run,
 * heatmap + regions + insights, recent comparisons, export.
 */
window.App = window.App || {};

(function () {
  const App = window.App;

  App.setupComparator = function setupComparator() {
    const $ = App.$;
    if (!$('#cmp-slot-a')) return;

    App.setupCmpDropzone('a');
    App.setupCmpDropzone('b');

    $('#cmp-swap').addEventListener('click', App.cmpSwap);
    $('#cmp-clear').addEventListener('click', App.cmpClearAll);
    $('#cmp-run').addEventListener('click', App.runComparison);
    $('#cmp-pick-a').addEventListener('click', () => App.openArchivePicker('a'));
    $('#cmp-pick-b').addEventListener('click', () => App.openArchivePicker('b'));

    $('#cmp-toggle-ascii').addEventListener('change', (e) => {
      App.cmpState.showAscii = !!e.target.checked;
      App.renderCmpRegions();
    });

    $('#cmp-min-size').addEventListener('change', (e) => {
      App.cmpState.minRegionSize = parseInt(e.target.value, 10) || 1;
      App.renderCmpRegions();
    });

    $('#cmp-jump-offset').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const v = e.target.value.trim().replace(/^0x/i, '');
      if (!v) return;
      const off = parseInt(v, 16);
      if (Number.isNaN(off)) {
        App.logLine('warn', App.t('log.invalid_offset', { v: e.target.value }));
        return;
      }
      App.jumpToFirstRegionAtOrAfter(off);
    });

    $('#cmp-export-btn')?.addEventListener('click', App.exportComparison);

    document.querySelectorAll('.cmp-clear-slot').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (App.cmpState.busy) return;
        const slot = btn.dataset.slot;
        if (slot === 'a') App.cmpState.fileA = null;
        if (slot === 'b') App.cmpState.fileB = null;
        App.clearCmpResult();
        App.renderCmpSlots();
      });
    });

    // Archive picker
    $('#picker-close').addEventListener('click', App.closeArchivePicker);
    $('#archive-picker-overlay').addEventListener('click', (e) => {
      if (e.target.id === 'archive-picker-overlay') App.closeArchivePicker();
    });
    $('#picker-search').addEventListener('input', (e) => {
      App.cmpState.pickerQuery = e.target.value.trim().toLowerCase();
      App.renderPickerList();
    });

    // Keyboard shortcuts (only fire when in Compare view to avoid stomping on other shortcuts)
    document.addEventListener('keydown', (e) => {
      const inCompare = document.querySelector('.view-compare.active');
      const inPicker = !$('#archive-picker-overlay').hidden;
      if (inPicker && e.key === 'Escape') {
        e.preventDefault();
        App.closeArchivePicker();
        return;
      }
      if (!inCompare || inPicker) return;
      const tagName = (e.target && e.target.tagName) || '';
      const typing = tagName === 'INPUT' || tagName === 'TEXTAREA' || tagName === 'SELECT';
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        if (!$('#cmp-run').disabled) App.runComparison();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        if (!$('#cmp-swap').disabled) App.cmpSwap();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'e' || e.key === 'E')) {
        e.preventDefault();
        if (App.cmpState.result) App.exportComparison();
      } else if (e.key === 'Escape' && !typing) {
        e.preventDefault();
        App.cmpClearAll();
      }
    });

    App.loadRecentComparisons();
    App.renderCmpSlots();
  };

  App.cmpSwap = function cmpSwap() {
    const cmpState = App.cmpState;
    if (cmpState.busy) return;
    const t = cmpState.fileA;
    cmpState.fileA = cmpState.fileB;
    cmpState.fileB = t;
    App.renderCmpSlots();
    App.clearCmpResult();
    App.logLine('info', App.t('log.compare_slots_swapped'));
  };

  App.cmpClearAll = function cmpClearAll() {
    const cmpState = App.cmpState;
    if (cmpState.busy) return;
    cmpState.fileA = null;
    cmpState.fileB = null;
    cmpState.result = null;
    App.renderCmpSlots();
    App.clearCmpResult();
  };

  App.setupCmpDropzone = function setupCmpDropzone(slot) {
    const dz = document.querySelector(`.cmp-dropzone[data-slot="${slot}"]`);
    if (!dz) return;

    ['dragenter', 'dragover'].forEach((ev) => {
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (App.cmpState.busy) return;
        dz.classList.add('dragover');
      });
    });

    ['dragleave', 'drop'].forEach((ev) => {
      dz.addEventListener(ev, (e) => {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.remove('dragover');
      });
    });

    dz.addEventListener('drop', (e) => {
      if (App.cmpState.busy) return;
      const items = Array.from(e.dataTransfer.files);
      const paths = items.map((f) => window.api.getPathForFile(f)).filter(Boolean);
      if (paths.length === 0) {
        App.logLine('warn', App.t('log.no_path_drop_one'));
        return;
      }
      App.assignCmpSlot(slot, paths[0]);
    });

    dz.addEventListener('click', async () => {
      if (App.cmpState.busy) return;
      const paths = await window.api.selectFiles();
      if (!paths || paths.length === 0) return;
      App.assignCmpSlot(slot, paths[0]);
    });

    dz.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (App.cmpState.busy) return;
        const paths = await window.api.selectFiles();
        if (!paths || paths.length === 0) return;
        App.assignCmpSlot(slot, paths[0]);
      }
    });
  };

  App.assignCmpSlot = function assignCmpSlot(slot, filePath, knownRecord) {
    const cmpState = App.cmpState;
    const fileName = filePath.split(/[\\/]/).pop();
    const entry = { path: filePath, name: fileName, size: null, recognized: null };
    if (knownRecord) {
      entry.recognized = knownRecord;
      entry.size = knownRecord.file_size;
      entry.md5 = knownRecord.md5;
    }
    if (slot === 'a') cmpState.fileA = entry;
    else cmpState.fileB = entry;
    App.clearCmpResult();
    App.renderCmpSlots();
    const recoSuffix = knownRecord
      ? App.t('log.file_slot_recognized_suffix', { id: knownRecord.id })
      : '';
    App.logLine(
      'info',
      App.t('log.file_slot_loaded', { slot: slot.toUpperCase(), name: fileName, reco: recoSuffix })
    );
    if (!knownRecord) App.recognizeFile(slot, filePath);
  };

  App.recognizeFile = async function recognizeFile(slot, filePath) {
    const cmpState = App.cmpState;
    try {
      const checks = await window.api.computeChecksum(filePath);
      if (!checks || !checks.md5) return;
      const matches = await window.api.findByMd5(checks.md5);
      const entry = slot === 'a' ? cmpState.fileA : cmpState.fileB;
      if (!entry || entry.path !== filePath) return;
      entry.md5 = checks.md5;
      entry.size = checks.fileSize;
      if (matches && matches.length > 0) {
        entry.recognized = matches[0];
        App.logLine(
          'ok',
          App.t('log.file_slot_recognized', {
            slot: slot.toUpperCase(),
            id: matches[0].id,
            name: matches[0].new_name
          })
        );
      }
      App.renderCmpSlots();
    } catch (_err) {
      // silent fail — recognition is best-effort
    }
  };

  App.renderCmpSlots = function renderCmpSlots() {
    const cmpState = App.cmpState;
    const $ = App.$;
    for (const slot of ['a', 'b']) {
      const file = slot === 'a' ? cmpState.fileA : cmpState.fileB;
      const dz = document.querySelector(`.cmp-dropzone[data-slot="${slot}"]`);
      if (!dz) continue;
      const card = dz.querySelector('.cmp-file-card');
      if (!file) {
        dz.classList.remove('has-file');
        card.hidden = true;
        continue;
      }
      dz.classList.add('has-file');
      card.hidden = false;
      card.querySelector('[data-role="name"]').textContent = file.name;
      card.querySelector('[data-role="size"]').textContent =
        file.size != null
          ? `${App.formatBytes(file.size)} (${file.size.toLocaleString()} bytes)`
          : '—';
      card.querySelector('[data-role="md5"]').textContent =
        file.md5 || App.t('compare.md5_will_compute');

      const reco = card.querySelector('[data-role="recognized"]');
      if (file.recognized) {
        reco.hidden = false;
        const r = file.recognized;
        reco.innerHTML = `
          <span class="reco-kind ${r.kind || 'original'}">${(r.kind || 'original').toUpperCase()}</span>
          <span class="reco-name">#${r.id} · ${App.escapeHtml(r.brand || '?')} ${App.escapeHtml(r.model || '?')}${r.solution_label ? ' · ' + App.escapeHtml(r.solution_label) : ''}</span>
        `;
      } else {
        reco.hidden = true;
        reco.innerHTML = '';
      }
    }

    const ready = !!(cmpState.fileA && cmpState.fileB) && !cmpState.busy;
    $('#cmp-run').disabled = !ready;
    $('#cmp-swap').disabled = !(cmpState.fileA || cmpState.fileB) || cmpState.busy;
    $('#cmp-clear').disabled = !(cmpState.fileA || cmpState.fileB) || cmpState.busy;
  };

  App.clearCmpResult = function clearCmpResult() {
    App.cmpState.result = null;
    App.$('#cmp-result-area').hidden = true;
    App.$('#cmp-elapsed').textContent = '';
  };

  App.resetComparatorIfEmpty = function resetComparatorIfEmpty() {
    App.renderCmpSlots();
  };

  App.runComparison = async function runComparison() {
    const cmpState = App.cmpState;
    const $ = App.$;
    if (cmpState.busy) return;
    if (!cmpState.fileA || !cmpState.fileB) return;
    cmpState.busy = true;
    App.renderCmpSlots();
    $('#cmp-spinner').hidden = false;
    $('#cmp-elapsed').textContent = '';
    App.clearCmpResult();

    try {
      const res = await window.api.compareFiles(cmpState.fileA.path, cmpState.fileB.path);
      if (res && res.error) {
        App.logLine('err', App.t('log.compare_failed', { err: res.error }));
        if (App.toast) App.toast.error(App.t('toasts.compare_failed', { msg: res.error }));
        return;
      }
      cmpState.result = res;
      cmpState.fileA.size = res.fileA.size;
      cmpState.fileA.md5 = res.fileA.md5;
      cmpState.fileB.size = res.fileB.size;
      cmpState.fileB.md5 = res.fileB.md5;
      // Try to recognize both files now that we have MD5 (in case it wasn't picked up earlier)
      if (!cmpState.fileA.recognized) {
        const matchA = await window.api.findByMd5(res.fileA.md5);
        if (matchA && matchA.length) cmpState.fileA.recognized = matchA[0];
      }
      if (!cmpState.fileB.recognized) {
        const matchB = await window.api.findByMd5(res.fileB.md5);
        if (matchB && matchB.length) cmpState.fileB.recognized = matchB[0];
      }
      App.renderCmpSlots();
      App.renderCmpResult(res);
      $('#cmp-elapsed').textContent = App.t('compare.elapsed', { ms: res.meta.elapsedMs });
      App.logLine(
        'ok',
        App.t('log.compare_done', {
          pct: res.similarity,
          regions: res.totalChangedRegions,
          bytes: res.bytesDiffer.toLocaleString()
        })
      );
      if (App.toast) {
        if (res.identical) {
          App.toast.success(App.t('toasts.compare_identical'));
        } else {
          App.toast.success(
            App.t('toasts.compare_done_summary', {
              pct: res.similarity,
              regions: res.totalChangedRegions
            })
          );
        }
      }

      await window.api.recordComparison({
        aPath: cmpState.fileA.path,
        bPath: cmpState.fileB.path,
        aName: cmpState.fileA.name,
        bName: cmpState.fileB.name,
        aMd5: res.fileA.md5,
        bMd5: res.fileB.md5,
        aId: cmpState.fileA.recognized?.id || null,
        bId: cmpState.fileB.recognized?.id || null,
        similarity: res.similarity,
        bytesDiffer: res.bytesDiffer,
        totalRegions: res.totalChangedRegions
      });
      App.loadRecentComparisons();
    } catch (err) {
      App.logLine('err', App.t('log.compare_failed', { err: err.message || err }));
    } finally {
      cmpState.busy = false;
      $('#cmp-spinner').hidden = true;
      App.renderCmpSlots();
    }
  };

  App.renderCmpResult = function renderCmpResult(r) {
    const $ = App.$;
    $('#cmp-result-area').hidden = false;

    const statSimilarity = $('#cmp-stat-similarity');
    const statDiffer = $('#cmp-stat-differ');
    const statRegions = $('#cmp-stat-regions');
    const statSizes = $('#cmp-stat-sizes');

    statSimilarity.querySelector('.cmp-stat-value').textContent = `${r.similarity}%`;
    statDiffer.querySelector('.cmp-stat-value').textContent = r.bytesDiffer.toLocaleString();
    statRegions.querySelector('.cmp-stat-value').textContent =
      r.totalChangedRegions.toLocaleString();
    const sameSize = r.fileA.size === r.fileB.size;
    statSizes.querySelector('.cmp-stat-value').textContent = sameSize
      ? App.formatBytes(r.fileA.size)
      : `${App.formatBytes(r.fileA.size)} / ${App.formatBytes(r.fileB.size)}`;

    for (const el of [statSimilarity, statDiffer, statRegions, statSizes]) {
      el.classList.remove('cmp-stat-ok', 'cmp-stat-warn', 'cmp-stat-err');
    }
    if (r.identical) {
      statSimilarity.classList.add('cmp-stat-ok');
      statDiffer.classList.add('cmp-stat-ok');
      statRegions.classList.add('cmp-stat-ok');
    } else if (r.similarity >= 95) {
      statSimilarity.classList.add('cmp-stat-warn');
      statRegions.classList.add('cmp-stat-warn');
      statDiffer.classList.add('cmp-stat-warn');
    } else {
      statSimilarity.classList.add('cmp-stat-err');
      statRegions.classList.add('cmp-stat-err');
      statDiffer.classList.add('cmp-stat-err');
    }
    statSizes.classList.add(sameSize ? 'cmp-stat-ok' : 'cmp-stat-warn');

    const md5Badge = $('#cmp-md5-badge');
    const md5Match = r.fileA.md5 === r.fileB.md5 && sameSize;
    md5Badge.classList.remove('match', 'mismatch');
    if (md5Match) {
      md5Badge.classList.add('match');
      md5Badge.textContent = App.t('compare.md5_match');
    } else {
      md5Badge.classList.add('mismatch');
      md5Badge.textContent = App.t('compare.md5_mismatch');
    }

    const banner = $('#cmp-identical-banner');
    const heatCard = $('#cmp-heatmap-card');
    const regCard = $('#cmp-regions-card');
    const insightsCard = $('#cmp-insights-card');
    if (r.identical) {
      banner.hidden = false;
      heatCard.hidden = true;
      regCard.hidden = true;
      if (insightsCard) insightsCard.hidden = true;
      return;
    }
    banner.hidden = true;
    heatCard.hidden = false;
    regCard.hidden = false;
    if (insightsCard) insightsCard.hidden = false;

    App.renderCmpHeatmap(r);
    App.renderCmpRegions();
    App.renderInsights(r);
  };

  App.renderInsights = function renderInsights(r) {
    const $ = App.$;
    const cmpState = App.cmpState;
    const escapeHtml = App.escapeHtml;
    const formatBytes = App.formatBytes;
    const body = $('#cmp-insights-body');
    if (!body) return;

    const bytes = r.bytesDiffer;
    let weightClass, weightLabel, weightDesc;
    if (bytes <= 16) {
      weightClass = 'tiny';
      weightLabel = App.t('compare.weight_tiny');
      weightDesc = App.t('compare.weight_tiny_desc');
    } else if (bytes <= 256) {
      weightClass = 'small';
      weightLabel = App.t('compare.weight_small');
      weightDesc = App.t('compare.weight_small_desc');
    } else if (bytes <= 4096) {
      weightClass = 'medium';
      weightLabel = App.t('compare.weight_medium');
      weightDesc = App.t('compare.weight_medium_desc');
    } else if (bytes <= 65536) {
      weightClass = 'large';
      weightLabel = App.t('compare.weight_large');
      weightDesc = App.t('compare.weight_large_desc');
    } else {
      weightClass = 'massive';
      weightLabel = App.t('compare.weight_massive');
      weightDesc = App.t('compare.weight_massive_desc');
    }

    let firstOff = Infinity,
      lastOff = -1,
      largest = null;
    for (const reg of r.changedRegions) {
      if (reg.offset < firstOff) firstOff = reg.offset;
      if (reg.offset + reg.length > lastOff) lastOff = reg.offset + reg.length;
      if (!largest || reg.length > largest.length) largest = reg;
    }
    if (firstOff === Infinity) {
      firstOff = 0;
      lastOff = 0;
    }
    const span = lastOff - firstOff;

    const denseBuckets = r.heatmap.map((v, i) => ({ i, v })).filter((b) => b.v > 0).length;
    const totalBuckets = r.heatmap.length;
    const coverage = totalBuckets > 0 ? Math.round((denseBuckets / totalBuckets) * 100) : 0;

    const sameSize = r.fileA.size === r.fileB.size;
    const sizeDelta = r.fileB.size - r.fileA.size;

    let classification = null;
    const aReco = cmpState.fileA.recognized;
    const bReco = cmpState.fileB.recognized;
    if (aReco && bReco) {
      if (aReco.kind === 'original' && bReco.kind === 'solution' && bReco.parent_id === aReco.id) {
        classification = App.t('compare.insight_classify_a_orig_b_sol', {
          label: escapeHtml(bReco.solution_label || 'mod')
        });
      } else if (
        aReco.kind === 'solution' &&
        bReco.kind === 'original' &&
        aReco.parent_id === bReco.id
      ) {
        classification = App.t('compare.insight_classify_b_orig_a_sol', {
          label: escapeHtml(aReco.solution_label || 'mod')
        });
      } else if (
        aReco.kind === 'solution' &&
        bReco.kind === 'solution' &&
        aReco.parent_id &&
        aReco.parent_id === bReco.parent_id
      ) {
        classification = App.t('compare.insight_classify_siblings', {
          parent: aReco.parent_id
        });
      } else if (aReco.hw_id && aReco.hw_id === bReco.hw_id) {
        classification = App.t('compare.insight_classify_same_hw', {
          hw: escapeHtml(aReco.hw_id)
        });
      }
    } else if (aReco || bReco) {
      const known = aReco || bReco;
      const which = aReco ? 'A' : 'B';
      classification = App.t('compare.insight_classify_one_known', {
        which,
        id: known.id,
        name: escapeHtml(known.new_name),
        kind: (known.kind || 'original').toUpperCase()
      });
    }

    const headline = App.t('compare.insight_headline', {
      bytes: bytes.toLocaleString(),
      desc: weightDesc
    });
    const diffSpanValue = App.t('compare.insight_diff_span_value', {
      first: firstOff.toString(16).toUpperCase(),
      last: lastOff.toString(16).toUpperCase(),
      range: formatBytes(span)
    });
    const largestValue = largest
      ? App.t('compare.insight_largest_region_value', {
          length: largest.length,
          offset: largest.offset.toString(16).toUpperCase()
        })
      : App.t('compare.insight_none');
    const coverageValue = App.t('compare.insight_coverage_value', { pct: coverage });
    const densityValue =
      span > 0
        ? App.t('compare.insight_density_value', { rate: (bytes / (span / 1024)).toFixed(1) })
        : App.t('compare.insight_none');
    const fileSizesValue = sameSize
      ? App.t('compare.insight_file_sizes_identical', { size: formatBytes(r.fileA.size) })
      : App.t('compare.insight_file_sizes_diff', {
          a: formatBytes(r.fileA.size),
          b: formatBytes(r.fileB.size),
          sign: sizeDelta > 0 ? '+' : '',
          delta: sizeDelta
        });
    const avgRegionValue =
      r.totalChangedRegions > 0
        ? App.t('compare.insight_avg_region_value', {
            rate: (bytes / r.totalChangedRegions).toFixed(1)
          })
        : App.t('compare.insight_none');

    body.innerHTML = `
      <div class="cmp-insight-headline">
        <span class="pill ${weightClass}">${escapeHtml(weightLabel)}</span>
        ${headline}
      </div>

      ${classification ? `<div class="cmp-insight-classification">${classification}</div>` : ''}

      <div class="cmp-insight-grid">
        <div class="cmp-insight-item">
          <div class="insight-label">${App.t('compare.insight_diff_span')}</div>
          <div class="insight-value">${diffSpanValue}</div>
        </div>
        <div class="cmp-insight-item">
          <div class="insight-label">${App.t('compare.insight_largest_region')}</div>
          <div class="insight-value">${largestValue}</div>
        </div>
        <div class="cmp-insight-item">
          <div class="insight-label">${App.t('compare.insight_coverage')}</div>
          <div class="insight-value">${coverageValue}</div>
        </div>
        <div class="cmp-insight-item">
          <div class="insight-label">${App.t('compare.insight_density')}</div>
          <div class="insight-value">${densityValue}</div>
        </div>
        <div class="cmp-insight-item">
          <div class="insight-label">${App.t('compare.insight_file_sizes')}</div>
          <div class="insight-value">${fileSizesValue}</div>
        </div>
        <div class="cmp-insight-item">
          <div class="insight-label">${App.t('compare.insight_avg_region')}</div>
          <div class="insight-value">${avgRegionValue}</div>
        </div>
      </div>
    `;
  };

  App.renderCmpHeatmap = function renderCmpHeatmap(r) {
    const $ = App.$;
    const grid = $('#cmp-heatmap');
    grid.innerHTML = '';
    const heatmap = r.heatmap || [];
    const bucketBytes = heatmap.length > 0 ? r.comparableLength / heatmap.length : 0;

    for (let i = 0; i < heatmap.length; i++) {
      const cell = document.createElement('div');
      cell.className = 'cmp-heat-cell';
      const pct = heatmap[i];
      if (pct > 0) {
        cell.classList.add('has-diff');
        const alpha = Math.max(0.15, Math.min(1, pct / 100));
        cell.style.opacity = alpha.toFixed(3);
      }
      const start = Math.round(i * bucketBytes);
      const end = Math.round((i + 1) * bucketBytes);
      cell.dataset.start = String(start);
      cell.dataset.end = String(end);
      cell.dataset.pct = String(pct);
      cell.title = `0x${start.toString(16)} – 0x${end.toString(16)} : ${pct}% changed`;
      cell.addEventListener('mouseenter', () => {
        const hover = $('#cmp-heat-hover');
        hover.textContent = `0x${start.toString(16).toUpperCase()} – 0x${end.toString(16).toUpperCase()} · ${pct}% changed`;
      });
      cell.addEventListener('mouseleave', () => {
        $('#cmp-heat-hover').textContent = '';
      });
      cell.addEventListener('click', () => App.jumpToFirstRegionAtOrAfter(start));
      grid.appendChild(cell);
    }

    $('#cmp-heat-min').textContent = '0x0';
    $('#cmp-heat-max').textContent = `0x${r.comparableLength.toString(16).toUpperCase()}`;
  };

  App.jumpToFirstRegionAtOrAfter = function jumpToFirstRegionAtOrAfter(byteOffset) {
    const r = App.cmpState.result;
    if (!r) return;
    const target =
      r.changedRegions.find((reg) => reg.offset >= byteOffset) ||
      r.changedRegions.find((reg) => reg.offset + reg.length > byteOffset);
    if (!target) return;
    const idx = r.changedRegions.indexOf(target);
    const node = document.querySelector(`.cmp-region[data-idx="${idx}"]`);
    if (!node) return;
    node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    document
      .querySelectorAll('.cmp-region.highlight')
      .forEach((n) => n.classList.remove('highlight'));
    node.classList.add('highlight');
    setTimeout(() => node.classList.remove('highlight'), 1400);
  };

  App.renderCmpRegions = function renderCmpRegions() {
    const $ = App.$;
    const cmpState = App.cmpState;
    const r = cmpState.result;
    if (!r) return;

    const wrap = $('#cmp-regions');
    wrap.innerHTML = '';
    const count = $('#cmp-region-count');
    const minSize = cmpState.minRegionSize || 1;
    const filtered = r.changedRegions.filter((reg) => reg.length >= minSize);
    const filteredOut = r.changedRegions.length - filtered.length;
    count.textContent =
      r.totalChangedRegions > 0
        ? filteredOut > 0
          ? App.t('compare.region_count_some_hidden', {
              shown: filtered.length,
              total: r.totalChangedRegions,
              hidden: filteredOut
            })
          : App.t('compare.region_count_total', { total: r.totalChangedRegions })
        : '';

    if (!filtered || filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'cmp-empty-result';
      if (r.changedRegions.length === 0) {
        empty.textContent = App.t('compare.no_diffs');
      } else {
        const tk = minSize === 1 ? 'compare.all_below_min_one' : 'compare.all_below_min_many';
        empty.textContent = App.t(tk, { total: r.changedRegions.length, min: minSize });
      }
      wrap.appendChild(empty);
    } else {
      filtered.forEach((reg) => {
        const idx = r.changedRegions.indexOf(reg);
        wrap.appendChild(App.buildCmpRegionEl(reg, idx));
      });
    }

    const cap = $('#cmp-region-cap');
    if (r.totalChangedRegions > r.changedRegions.length) {
      cap.hidden = false;
      cap.textContent = App.t('compare.region_truncated', {
        shown: r.changedRegions.length,
        total: r.totalChangedRegions
      });
    } else {
      cap.hidden = true;
      cap.textContent = '';
    }
  };

  App.buildCmpRegionEl = function buildCmpRegionEl(region, idx) {
    const escapeHtml = App.escapeHtml;
    const el = document.createElement('div');
    el.className = 'cmp-region';
    if (!App.cmpState.showAscii) el.classList.add('no-ascii');
    el.dataset.idx = String(idx);

    const head = document.createElement('div');
    head.className = 'cmp-region-head';
    const regionLabel = App.t('compare.region_label', { idx: idx + 1 });
    const byteWord =
      region.length === 1 ? App.t('compare.regions_byte') : App.t('compare.regions_bytes');
    head.innerHTML =
      `<span><span class="cmp-region-idx">${App.escapeHtml(regionLabel)}</span>` +
      `<span> · </span>` +
      `<span class="cmp-region-off">0x${region.offset.toString(16).toUpperCase().padStart(8, '0')}</span></span>` +
      `<span class="cmp-region-len">${region.length} ${App.escapeHtml(byteWord)}</span>`;
    el.appendChild(head);

    const lines = document.createElement('div');
    lines.className = 'cmp-region-lines';

    const lineA = document.createElement('div');
    lineA.className = 'cmp-region-line cmp-line-a';
    lineA.innerHTML =
      `<span class="cmp-line-tag">A</span>` +
      `<span class="cmp-line-hex">${escapeHtml(region.hexA)}</span>` +
      `<span class="cmp-line-ascii">${escapeHtml(region.asciiA)}</span>`;

    const lineB = document.createElement('div');
    lineB.className = 'cmp-region-line cmp-line-b';
    lineB.innerHTML =
      `<span class="cmp-line-tag">B</span>` +
      `<span class="cmp-line-hex">${escapeHtml(region.hexB)}</span>` +
      `<span class="cmp-line-ascii">${escapeHtml(region.asciiB)}</span>`;

    lines.appendChild(lineA);
    lines.appendChild(lineB);
    el.appendChild(lines);
    return el;
  };

  /* ===== Archive Picker ===== */
  App.openArchivePicker = async function openArchivePicker(slot) {
    const $ = App.$;
    const cmpState = App.cmpState;
    cmpState.pickerSlot = slot;
    cmpState.pickerQuery = '';
    $('#picker-search').value = '';
    const tag = $('#picker-slot-tag');
    tag.textContent = App.t('picker.slot_tag', { letter: slot.toUpperCase() });
    tag.className = `picker-slot-tag slot-${slot}`;

    const allFiles = await window.api.listFiles({});

    const otherSlotFile = slot === 'a' ? cmpState.fileB : cmpState.fileA;
    const otherReco = otherSlotFile?.recognized;

    let suggestedIds = new Set();
    if (otherReco) {
      if (otherReco.kind === 'original') {
        const sols = await window.api.listSolutionsOf(otherReco.id);
        for (const s of sols) suggestedIds.add(s.id);
      } else if (otherReco.kind === 'solution' && otherReco.parent_id) {
        suggestedIds.add(otherReco.parent_id);
        const siblings = allFiles.filter(
          (f) =>
            f.kind === 'solution' && f.parent_id === otherReco.parent_id && f.id !== otherReco.id
        );
        for (const s of siblings) suggestedIds.add(s.id);
      }
      if (otherReco.hw_id) {
        for (const f of allFiles) {
          if (f.hw_id === otherReco.hw_id && f.id !== otherReco.id) suggestedIds.add(f.id);
        }
      }
    }

    cmpState.pickerCandidates = allFiles
      .map((f) => ({
        ...f,
        _suggested: suggestedIds.has(f.id)
      }))
      .sort((a, b) => b._suggested - a._suggested || b.created_at - a.created_at);

    $('#archive-picker-overlay').hidden = false;
    App.renderPickerList();
    setTimeout(() => $('#picker-search').focus(), 50);
  };

  App.closeArchivePicker = function closeArchivePicker() {
    App.$('#archive-picker-overlay').hidden = true;
    App.cmpState.pickerSlot = null;
  };

  App.renderPickerList = function renderPickerList() {
    const $ = App.$;
    const cmpState = App.cmpState;
    const list = $('#picker-list');
    list.innerHTML = '';
    const q = cmpState.pickerQuery;
    const filtered = q
      ? cmpState.pickerCandidates.filter((f) => {
          const hay =
            `${f.brand} ${f.model} ${f.ecu_type} ${f.hw_id} ${f.sw_id} ${f.new_name} ${f.tags} ${f.solution_label}`.toLowerCase();
          return hay.includes(q);
        })
      : cmpState.pickerCandidates;

    $('#picker-result-count').textContent = App.t('picker.result_count', {
      n: filtered.length,
      total: cmpState.pickerCandidates.length
    });

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'picker-empty';
      empty.textContent =
        cmpState.pickerCandidates.length === 0
          ? App.t('picker.no_files')
          : App.t('picker.no_match');
      list.appendChild(empty);
      return;
    }

    const suggested = filtered.filter((f) => f._suggested);
    const others = filtered.filter((f) => !f._suggested);

    if (suggested.length > 0) {
      const lbl = document.createElement('div');
      lbl.className = 'picker-section-label';
      lbl.textContent = App.t('picker.suggested_label');
      list.appendChild(lbl);
      for (const f of suggested) list.appendChild(App.buildPickerRow(f, true));
      if (others.length > 0) {
        const lbl2 = document.createElement('div');
        lbl2.className = 'picker-section-label';
        lbl2.textContent = App.t('picker.all_label');
        list.appendChild(lbl2);
      }
    }
    for (const f of others) list.appendChild(App.buildPickerRow(f, false));
  };

  App.buildPickerRow = function buildPickerRow(file, suggested) {
    const escapeHtml = App.escapeHtml;
    const row = document.createElement('div');
    row.className = 'picker-row' + (suggested ? ' suggested' : '');
    row.innerHTML = `
      <span class="picker-kind ${file.kind || 'original'}">${(file.kind || 'original').toUpperCase()}</span>
      <div class="picker-info">
        <div class="picker-name">${escapeHtml(file.new_name)}</div>
        <div class="picker-meta">${escapeHtml(file.brand || '?')} ${escapeHtml(file.model || '?')} · ${escapeHtml(file.ecu_type || '?')} · HW <span class="hw">${escapeHtml(file.hw_id || '—')}</span>${file.solution_label ? ' · ' + escapeHtml(file.solution_label) : ''}${file.tags ? ' · ' + escapeHtml(file.tags) : ''}</div>
      </div>
      <div class="picker-id">#${file.id}</div>
    `;
    row.addEventListener('click', () => {
      App.assignCmpSlot(App.cmpState.pickerSlot, file.archive_path, file);
      App.closeArchivePicker();
    });
    return row;
  };

  /* ===== Recent Comparisons ===== */
  App.loadRecentComparisons = async function loadRecentComparisons() {
    const $ = App.$;
    const escapeHtml = App.escapeHtml;
    const list = await window.api.listRecentComparisons(5);
    const card = $('#cmp-recent-card');
    const body = $('#cmp-recent-list');
    if (!list || list.length === 0) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    body.innerHTML = '';
    for (const r of list) {
      const row = document.createElement('div');
      row.className = 'cmp-recent-row';
      row.innerHTML = `
        <div class="recent-pair">
          ${escapeHtml(r.file_a_name || '?')}
          <span class="pair-sep">↔</span>
          ${escapeHtml(r.file_b_name || '?')}
        </div>
        <div class="recent-stats">
          <strong>${r.similarity}%</strong> · ${r.bytes_differ.toLocaleString()}b · ${r.total_regions} regions · ${App.timeAgo(r.created_at)}
        </div>
        <button class="recent-rerun">${App.escapeHtml(App.t('compare.rerun'))}</button>
      `;
      row.querySelector('.recent-rerun').addEventListener('click', async (e) => {
        e.stopPropagation();
        await App.rerunComparison(r);
      });
      body.appendChild(row);
    }
  };

  App.rerunComparison = async function rerunComparison(rec) {
    const aMatch = rec.file_a_md5 ? await window.api.findByMd5(rec.file_a_md5) : null;
    const bMatch = rec.file_b_md5 ? await window.api.findByMd5(rec.file_b_md5) : null;
    App.assignCmpSlot('a', rec.file_a_path, aMatch?.[0] || null);
    App.assignCmpSlot('b', rec.file_b_path, bMatch?.[0] || null);
    setTimeout(() => App.runComparison(), 100);
  };

  /* ===== Export diff ===== */
  App.exportComparison = async function exportComparison() {
    const formatBytes = App.formatBytes;
    const r = App.cmpState.result;
    if (!r) {
      App.logLine('warn', App.t('log.no_diff_to_export'));
      return;
    }

    const format = await App.appModal({
      title: App.t('compare.export_modal_title'),
      body: App.t('compare.export_modal_body'),
      variant: 'choice',
      buttons: [
        { label: App.t('compare.export_cancel'), value: null },
        { label: App.t('compare.export_json'), value: 'json' },
        { label: App.t('compare.export_markdown'), value: 'markdown', primary: true }
      ]
    });
    if (!format) return;
    let payload;
    if (format === 'json') {
      payload = JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          fileA: { ...r.fileA, recognized: App.cmpState.fileA.recognized || null },
          fileB: { ...r.fileB, recognized: App.cmpState.fileB.recognized || null },
          similarity: r.similarity,
          bytesEqual: r.bytesEqual,
          bytesDiffer: r.bytesDiffer,
          totalChangedRegions: r.totalChangedRegions,
          identical: r.identical,
          changedRegions: r.changedRegions
        },
        null,
        2
      );
    } else {
      const lines = [];
      lines.push(`# ${App.t('compare.md_title')}`);
      lines.push(`${App.t('compare.md_exported', { date: new Date().toISOString() })}\n`);
      lines.push(`## ${App.t('compare.md_files')}`);
      lines.push(
        `- **A**: \`${r.fileA.name}\` (${formatBytes(r.fileA.size)})  MD5 \`${r.fileA.md5}\``
      );
      lines.push(
        `- **B**: \`${r.fileB.name}\` (${formatBytes(r.fileB.size)})  MD5 \`${r.fileB.md5}\`\n`
      );
      lines.push(`## ${App.t('compare.md_summary')}`);
      lines.push(`- ${App.t('compare.md_similarity')}: **${r.similarity}%**`);
      lines.push(`- ${App.t('compare.md_bytes_differ')}: **${r.bytesDiffer.toLocaleString()}**`);
      lines.push(`- ${App.t('compare.md_regions_changed')}: **${r.totalChangedRegions}**`);
      lines.push(
        `- ${App.t('compare.md_identical')}: ${r.identical ? '✅ ' + App.t('compare.md_yes') : '❌ ' + App.t('compare.md_no')}\n`
      );
      lines.push(`## ${App.t('compare.md_changed_regions')}`);
      for (let i = 0; i < r.changedRegions.length; i++) {
        const reg = r.changedRegions[i];
        lines.push(
          `### ${App.t('compare.region_label', { idx: i + 1 })} @ 0x${reg.offset.toString(16).toUpperCase()} (${reg.length} ${App.t('compare.regions_bytes')})`
        );
        lines.push('```');
        lines.push(`A: ${reg.hexA}`);
        lines.push(`B: ${reg.hexB}`);
        lines.push('```\n');
      }
      payload = lines.join('\n');
    }

    const res = await window.api.exportComparison(payload, format);
    if (res.canceled) return;
    if (res.success) App.logLine('ok', App.t('log.diff_saved', { path: res.path }));
    else App.logLine('err', App.t('log.diff_export_failed', { err: res.error }));
  };
})();
