/* ===== Checksum + Hex peek tool ===== */
window.App = window.App || {};

(function () {
  const App = window.App;

  App.setupChecksumTool = function setupChecksumTool() {
    const $ = App.$;
    const escapeHtml = App.escapeHtml;
    const formatBytes = App.formatBytes;

    $('#checksum-pick').addEventListener('click', async () => {
      const paths = await window.api.selectFiles();
      if (paths.length === 0) return;
      const results = $('#checksum-results');
      results.innerHTML = '';
      const labels = {
        file: App.t('checksum.row_file'),
        size: App.t('checksum.row_size'),
        md5: App.t('checksum.row_md5'),
        bs: App.t('checksum.row_byte_sum')
      };
      for (const p of paths) {
        const r = await window.api.computeChecksum(p);
        const fileName = p.split(/[\\/]/).pop();
        const block = document.createElement('div');
        block.innerHTML = `
          <div class="checksum-row"><div class="k">${escapeHtml(labels.file)}</div><div class="v">${escapeHtml(fileName)}</div></div>
          <div class="checksum-row"><div class="k">${escapeHtml(labels.size)}</div><div class="v">${formatBytes(r.fileSize)} (${r.fileSize.toLocaleString()} bytes)</div></div>
          <div class="checksum-row"><div class="k">${escapeHtml(labels.md5)}</div><div class="v">${r.md5}</div></div>
          <div class="checksum-row"><div class="k">${escapeHtml(labels.bs)}</div><div class="v">0x${r.byteSum.toUpperCase()}</div></div>
        `;
        results.appendChild(block);
      }
      App.logLine('ok', App.t('log.checksum_loaded', { n: paths.length }));
    });

    $('#hex-peek-pick').addEventListener('click', async () => {
      const paths = await window.api.selectFiles();
      if (paths.length === 0) return;
      const byteCount = Math.max(
        16,
        Math.min(65536, parseInt($('#hex-peek-bytes').value, 10) || 512)
      );
      const target = $('#hex-peek-results');
      target.innerHTML = '';

      for (const p of paths) {
        const r = await window.api.hexPeek(p, byteCount, 0);
        if (r.error) {
          App.logLine('err', App.t('log.hex_failed', { err: r.error }));
          continue;
        }
        const fileName = p.split(/[\\/]/).pop();
        const block = document.createElement('div');
        block.style.marginBottom = '14px';

        const header = document.createElement('div');
        header.className = 'hex-header';
        header.textContent = App.t('checksum.header_template', {
          name: fileName,
          len: r.length,
          size: formatBytes(r.fileSize)
        });
        block.appendChild(header);

        const grid = document.createElement('div');
        for (const row of r.rows) {
          const line = document.createElement('div');
          line.className = 'hex-row';
          line.innerHTML = `<span class="hex-offset">${row.offset}</span><span class="hex-bytes">${row.hex}</span><span class="hex-ascii">${escapeHtml(row.ascii)}</span>`;
          grid.appendChild(line);
        }
        block.appendChild(grid);
        target.appendChild(block);
      }
      App.logLine('ok', App.t('log.hex_loaded', { n: paths.length }));
    });
  };
})();
