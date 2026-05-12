# Compare Files — Integration Snippets

This document contains every snippet you need to splice into existing files
to wire the **Compare** feature into the ECU File Skinner Pro app.

The backend module `src/main/ecu-comparator.js` is already created (no edit
required there). The snippets below are inserted into existing files only.

All splice points were verified against the working tree at the time of
authoring (see "Splice points by line number" at the end).

---

## 1. Sidebar nav button — splice into `src/renderer/index.html`

**Location**: inside `<nav class="nav">`, **after** the `data-view="checksum"`
button (its closing `</button>` lives at **line 62** of the current file),
and **before** the `data-view="settings"` button that opens at **line 63**.

**Snippet:**

```html
<button class="nav-item" data-view="compare">
  <span class="nav-icon">
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
      <path
        d="M9 3v18M15 3v18"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
      <path
        d="M4 7h5M4 12h5M4 17h5M15 7h5M15 12h5M15 17h5"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
      />
    </svg>
  </span>
  Compare
</button>
```

---

## 2. New view section — splice into `src/renderer/index.html`

**Location**: inside `<main class="main">`, **after** the existing
`<section class="view view-checksum" data-view="checksum"> ... </section>`
block (which closes at **line 324** of the current file), and **before** the
`<section class="view view-settings" data-view="settings">` opening at **line
326**.

**Snippet:**

```html
<section class="view view-compare" data-view="compare">
  <div class="card">
    <div class="card-header">
      <span class="card-title">
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            d="M9 3v18M15 3v18"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
          <path
            d="M4 7h5M4 12h5M4 17h5M15 7h5M15 12h5M15 17h5"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          />
        </svg>
        COMPARE FILES
      </span>
      <div class="card-header-right">
        <span class="cmp-elapsed" id="cmp-elapsed"></span>
        <button class="more-btn" type="button">⋯</button>
      </div>
    </div>

    <div class="cmp-pickers">
      <div class="cmp-slot" id="cmp-slot-a" data-slot="a">
        <div class="cmp-slot-label">
          <span class="cmp-slot-letter">A</span>
          <span class="cmp-slot-title">FILE A · Original / Stock</span>
        </div>
        <div
          class="cmp-dropzone"
          data-slot="a"
          tabindex="0"
          role="button"
          aria-label="Choose file A"
        >
          <div class="cmp-empty">
            <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
              <rect
                x="10"
                y="6"
                width="28"
                height="36"
                rx="3"
                fill="none"
                stroke="#5fc8e8"
                stroke-width="2"
              />
              <path
                d="M14 16h20M14 22h20M14 28h14"
                stroke="#5fc8e8"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
            <div class="cmp-empty-text">Drop a .bin file here<br />or click to choose</div>
          </div>
          <div class="cmp-file-card" hidden>
            <div class="cmp-file-name" data-role="name">—</div>
            <div class="cmp-file-meta">
              <span class="cmp-meta-row"
                ><span class="cmp-k">Size</span><span class="cmp-v" data-role="size">—</span></span
              >
              <span class="cmp-meta-row"
                ><span class="cmp-k">MD5</span
                ><span class="cmp-v cmp-mono" data-role="md5">computing…</span></span
              >
            </div>
            <button type="button" class="cmp-clear-slot" data-slot="a" title="Remove file A">
              ×
            </button>
          </div>
        </div>
      </div>

      <div class="cmp-slot" id="cmp-slot-b" data-slot="b">
        <div class="cmp-slot-label">
          <span class="cmp-slot-letter cmp-letter-b">B</span>
          <span class="cmp-slot-title">FILE B · Modified / Tuned</span>
        </div>
        <div
          class="cmp-dropzone"
          data-slot="b"
          tabindex="0"
          role="button"
          aria-label="Choose file B"
        >
          <div class="cmp-empty">
            <svg viewBox="0 0 48 48" width="40" height="40" aria-hidden="true">
              <rect
                x="10"
                y="6"
                width="28"
                height="36"
                rx="3"
                fill="none"
                stroke="#7eea7e"
                stroke-width="2"
              />
              <path
                d="M14 16h20M14 22h20M14 28h14"
                stroke="#7eea7e"
                stroke-width="2"
                stroke-linecap="round"
              />
            </svg>
            <div class="cmp-empty-text">Drop a .bin file here<br />or click to choose</div>
          </div>
          <div class="cmp-file-card" hidden>
            <div class="cmp-file-name" data-role="name">—</div>
            <div class="cmp-file-meta">
              <span class="cmp-meta-row"
                ><span class="cmp-k">Size</span><span class="cmp-v" data-role="size">—</span></span
              >
              <span class="cmp-meta-row"
                ><span class="cmp-k">MD5</span
                ><span class="cmp-v cmp-mono" data-role="md5">computing…</span></span
              >
            </div>
            <button type="button" class="cmp-clear-slot" data-slot="b" title="Remove file B">
              ×
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="cmp-actions">
      <button id="cmp-swap" class="btn-secondary small" type="button" disabled>
        <svg
          viewBox="0 0 24 24"
          width="14"
          height="14"
          aria-hidden="true"
          style="vertical-align:middle;margin-right:4px"
        >
          <path
            d="M7 4l-4 4 4 4M3 8h13M17 12l4 4-4 4M21 16H8"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        SWAP A↔B
      </button>
      <button id="cmp-clear" class="btn-secondary small" type="button" disabled>CLEAR</button>
      <button id="cmp-run" class="btn-primary cmp-run-btn" type="button" disabled>COMPARE</button>
    </div>
  </div>

  <div class="cmp-result-area" id="cmp-result-area" hidden>
    <div class="card" id="cmp-summary-card">
      <div class="card-header">
        <span class="card-title">SUMMARY</span>
        <span class="cmp-md5-badge" id="cmp-md5-badge"></span>
      </div>
      <div class="cmp-summary-grid">
        <div class="cmp-stat" id="cmp-stat-similarity">
          <div class="cmp-stat-value">—</div>
          <div class="cmp-stat-label">Similarity</div>
        </div>
        <div class="cmp-stat" id="cmp-stat-differ">
          <div class="cmp-stat-value">—</div>
          <div class="cmp-stat-label">Bytes differ</div>
        </div>
        <div class="cmp-stat" id="cmp-stat-regions">
          <div class="cmp-stat-value">—</div>
          <div class="cmp-stat-label">Regions changed</div>
        </div>
        <div class="cmp-stat" id="cmp-stat-sizes">
          <div class="cmp-stat-value">—</div>
          <div class="cmp-stat-label">Sizes</div>
        </div>
      </div>
    </div>

    <div class="card" id="cmp-identical-banner" hidden>
      <div class="cmp-identical">
        <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
          <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2" />
          <path
            d="m7 12 3.5 3.5L17 9"
            fill="none"
            stroke="currentColor"
            stroke-width="2.4"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        <div>
          <div class="cmp-identical-title">Files are identical</div>
          <div class="cmp-identical-sub">MD5 match, byte-perfect.</div>
        </div>
      </div>
    </div>

    <div class="card" id="cmp-heatmap-card">
      <div class="card-header">
        <span class="card-title">DIFFERENCE MAP</span>
        <span class="cmp-heat-legend">
          <span class="cmp-heat-dot cmp-heat-dot-empty"></span>identical
          <span class="cmp-heat-dot cmp-heat-dot-low"></span>some
          <span class="cmp-heat-dot cmp-heat-dot-high"></span>heavy
        </span>
      </div>
      <div class="cmp-heatmap" id="cmp-heatmap" role="img" aria-label="Difference heatmap"></div>
      <div class="cmp-heatmap-axis">
        <span id="cmp-heat-min">0x0</span>
        <span class="cmp-heat-hover" id="cmp-heat-hover"></span>
        <span id="cmp-heat-max">0x0</span>
      </div>
    </div>

    <div class="card" id="cmp-regions-card">
      <div class="card-header">
        <span class="card-title">
          CHANGED REGIONS
          <span class="cmp-region-count" id="cmp-region-count"></span>
        </span>
        <div class="card-header-right">
          <label class="cmp-toggle">
            <input type="checkbox" id="cmp-toggle-ascii" checked />
            <span>Show ASCII</span>
          </label>
        </div>
      </div>
      <div class="cmp-regions" id="cmp-regions"></div>
      <div class="cmp-region-cap" id="cmp-region-cap" hidden></div>
    </div>
  </div>

  <div class="cmp-spinner-overlay" id="cmp-spinner" hidden>
    <div class="cmp-spinner"></div>
    <div class="cmp-spinner-text">Comparing files…</div>
  </div>
</section>
```

---

## 3. CSS additions — append to `src/renderer/styles.css`

**Location**: just **before** the line that reads `/* ===== Scrollbar ===== */`
(currently **line 941** of the current file).

**Snippet:**

```css
/* ===== Compare ===== */
.cmp-pickers {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 14px;
  margin-bottom: 12px;
}

@media (max-width: 1100px) {
  .cmp-pickers {
    grid-template-columns: 1fr;
  }
}

.cmp-slot {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cmp-slot-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
  letter-spacing: 0.6px;
  color: var(--text-muted);
  font-weight: 600;
  padding-left: 4px;
}

.cmp-slot-letter {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  background: rgba(95, 200, 232, 0.15);
  color: var(--accent);
  font-weight: 700;
  font-size: 11px;
}

.cmp-slot-letter.cmp-letter-b {
  background: rgba(126, 234, 126, 0.15);
  color: var(--accent-2);
}

.cmp-slot-title {
  text-transform: uppercase;
}

.cmp-dropzone {
  position: relative;
  border: 2px dashed var(--border-strong);
  border-radius: 8px;
  background: var(--bg-input);
  min-height: 140px;
  padding: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition:
    border-color 0.15s,
    background 0.15s;
  outline: none;
}

.cmp-dropzone:hover,
.cmp-dropzone:focus-visible {
  border-color: var(--border-strong);
  background: var(--bg-card-hover);
}

.cmp-dropzone.dragover {
  border-color: var(--accent);
  background: rgba(95, 200, 232, 0.06);
}

.cmp-dropzone[data-slot='b'].dragover {
  border-color: var(--accent-2);
  background: rgba(126, 234, 126, 0.06);
}

.cmp-dropzone.has-file {
  border-style: solid;
  cursor: default;
}

.cmp-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--text-muted);
  text-align: center;
  pointer-events: none;
}

.cmp-empty-text {
  font-size: 12px;
  letter-spacing: 0.3px;
  line-height: 1.5;
}

.cmp-dropzone.has-file .cmp-empty {
  display: none;
}

.cmp-file-card {
  width: 100%;
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  text-align: left;
}

.cmp-file-name {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 13px;
  color: var(--text);
  word-break: break-all;
  padding-right: 24px;
  user-select: text;
}

.cmp-file-meta {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 11px;
}

.cmp-meta-row {
  display: grid;
  grid-template-columns: 38px 1fr;
  gap: 10px;
  align-items: baseline;
}

.cmp-k {
  color: var(--text-muted);
  letter-spacing: 0.3px;
  text-transform: uppercase;
  font-size: 10px;
}

.cmp-v {
  color: var(--text);
  word-break: break-all;
  user-select: text;
}

.cmp-mono {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: var(--accent);
}

.cmp-clear-slot {
  position: absolute;
  top: -4px;
  right: -4px;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--bg-elev);
  border: 1px solid var(--border-strong);
  color: var(--text-muted);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}

.cmp-clear-slot:hover {
  color: var(--err);
  border-color: var(--err);
}

.cmp-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.cmp-actions .cmp-run-btn {
  width: auto;
  flex: 0 0 auto;
  padding: 9px 24px;
  margin-left: auto;
}

.cmp-actions .btn-secondary[disabled] {
  opacity: 0.4;
  cursor: not-allowed;
}

.cmp-elapsed {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 10px;
  color: var(--text-dim);
}

/* Summary */
.cmp-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

@media (max-width: 900px) {
  .cmp-summary-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

.cmp-stat {
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-left: 3px solid var(--border-strong);
  border-radius: 6px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cmp-stat-value {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 22px;
  font-weight: 600;
  color: var(--text);
  line-height: 1.1;
}

.cmp-stat-label {
  font-size: 10px;
  letter-spacing: 0.6px;
  color: var(--text-muted);
  text-transform: uppercase;
}

.cmp-stat.cmp-stat-ok {
  border-left-color: var(--ok);
}
.cmp-stat.cmp-stat-ok .cmp-stat-value {
  color: var(--ok);
}
.cmp-stat.cmp-stat-warn {
  border-left-color: var(--warn);
}
.cmp-stat.cmp-stat-warn .cmp-stat-value {
  color: var(--warn);
}
.cmp-stat.cmp-stat-err {
  border-left-color: var(--err);
}
.cmp-stat.cmp-stat-err .cmp-stat-value {
  color: var(--err);
}

.cmp-md5-badge {
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 4px;
  border: 1px solid;
  letter-spacing: 0.3px;
}

.cmp-md5-badge.match {
  color: var(--ok);
  border-color: var(--ok);
  background: rgba(126, 234, 126, 0.08);
}
.cmp-md5-badge.mismatch {
  color: var(--err);
  border-color: var(--err);
  background: rgba(255, 112, 112, 0.08);
}

/* Identical banner */
.cmp-identical {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 6px 4px;
  color: var(--ok);
}

.cmp-identical-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--ok);
}

.cmp-identical-sub {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
}

/* Heatmap */
.cmp-heat-legend {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  font-size: 10px;
  letter-spacing: 0.4px;
  color: var(--text-muted);
}

.cmp-heat-dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
  margin-right: 4px;
  margin-left: 8px;
  vertical-align: middle;
}

.cmp-heat-dot-empty {
  background: var(--bg-input);
  border: 1px solid var(--border);
}
.cmp-heat-dot-low {
  background: rgba(255, 179, 71, 0.4);
}
.cmp-heat-dot-high {
  background: var(--accent-3);
}

.cmp-heatmap {
  display: grid;
  grid-template-columns: repeat(256, 1fr);
  gap: 1px;
  width: 100%;
  height: 38px;
  background: var(--bg-input);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 3px;
  overflow: hidden;
}

.cmp-heat-cell {
  height: 100%;
  background: transparent;
  border-radius: 1px;
  cursor: pointer;
  transition: outline 0.1s;
  outline: 1px solid transparent;
}

.cmp-heat-cell:hover {
  outline: 1px solid var(--accent);
  z-index: 1;
}

.cmp-heat-cell.has-diff {
  background: var(--accent-3);
}

.cmp-heatmap-axis {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: 6px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 10px;
  color: var(--text-dim);
}

.cmp-heat-hover {
  color: var(--accent);
  flex: 1;
  text-align: center;
  min-height: 12px;
}

/* Regions */
.cmp-region-count {
  margin-left: 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--accent);
  letter-spacing: 0;
}

.cmp-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
}

.cmp-toggle input[type='checkbox'] {
  accent-color: var(--accent);
  width: 13px;
  height: 13px;
  cursor: pointer;
}

.cmp-regions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 540px;
  overflow-y: auto;
  padding-right: 4px;
}

.cmp-region {
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-input);
  padding: 10px 12px;
  scroll-margin-top: 6px;
}

.cmp-region.highlight {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px rgba(95, 200, 232, 0.25);
}

.cmp-region-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: 8px;
  letter-spacing: 0.3px;
}

.cmp-region-head .cmp-region-idx {
  color: var(--text);
  font-weight: 600;
}
.cmp-region-head .cmp-region-off {
  color: var(--accent);
}
.cmp-region-head .cmp-region-len {
  color: var(--text-muted);
}

.cmp-region-lines {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-family: 'JetBrains Mono', Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  white-space: pre;
  user-select: text;
}

.cmp-region-line {
  display: grid;
  grid-template-columns: 16px 1fr auto;
  gap: 10px;
  align-items: baseline;
}

.cmp-region-line .cmp-line-tag {
  font-weight: 700;
  text-align: center;
}

.cmp-region-line.cmp-line-a .cmp-line-tag {
  color: var(--accent);
}
.cmp-region-line.cmp-line-b .cmp-line-tag {
  color: var(--accent-2);
}

.cmp-region-line .cmp-line-hex {
  color: var(--text);
  word-break: break-all;
}
.cmp-region-line .cmp-line-ascii {
  color: var(--text-dim);
  font-style: italic;
}

.cmp-region.no-ascii .cmp-line-ascii {
  display: none;
}

.cmp-region-cap {
  margin-top: 10px;
  padding: 8px 12px;
  border-radius: 6px;
  background: rgba(255, 179, 71, 0.08);
  border: 1px solid rgba(255, 179, 71, 0.4);
  color: var(--warn);
  font-size: 11px;
}

.cmp-empty-result {
  padding: 28px;
  text-align: center;
  color: var(--text-muted);
  font-style: italic;
  font-size: 12px;
}

/* Spinner overlay */
.cmp-spinner-overlay {
  position: fixed;
  inset: 0;
  background: rgba(26, 29, 35, 0.78);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 14px;
  z-index: 50;
  pointer-events: all;
}

.cmp-spinner {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  animation: cmp-spin 0.8s linear infinite;
}

.cmp-spinner-text {
  font-size: 12px;
  letter-spacing: 0.6px;
  color: var(--text);
  font-weight: 600;
}

@keyframes cmp-spin {
  to {
    transform: rotate(360deg);
  }
}
```

---

## 4. JS additions — splice into `src/renderer/renderer.js`

### Location A — inside `init()`

Find the line at **line 23** that reads:

```js
setupChecksumTool();
```

Add immediately after it (i.e. between `setupChecksumTool();` at line 23 and
`setupSettings();` at line 24):

```js
setupComparator();
```

### Location B — inside `switchView(viewName)`

Find the line at **line 45** that reads:

```js
if (viewName === 'settings') loadArchiveRoot();
```

Add immediately after it (still inside the `switchView` function, before its
closing `}` on line 46):

```js
if (viewName === 'compare') resetComparatorIfEmpty();
```

### Location C — at the end of `renderer.js`

Find the line at **line 751** that reads:

```js
window.addEventListener('DOMContentLoaded', init);
```

Insert the following block **immediately before** that line (so the new
functions are defined when `init` runs):

```js
/* ===== Compare ===== */
const cmpState = {
  fileA: null, // { path, name, size }
  fileB: null,
  result: null,
  busy: false,
  showAscii: true
};

function setupComparator() {
  if (!$('#cmp-slot-a')) return;

  setupCmpDropzone('a');
  setupCmpDropzone('b');

  $('#cmp-swap').addEventListener('click', () => {
    if (cmpState.busy) return;
    const t = cmpState.fileA;
    cmpState.fileA = cmpState.fileB;
    cmpState.fileB = t;
    renderCmpSlots();
    clearCmpResult();
    logLine('info', 'Compare slots swapped.');
  });

  $('#cmp-clear').addEventListener('click', () => {
    if (cmpState.busy) return;
    cmpState.fileA = null;
    cmpState.fileB = null;
    cmpState.result = null;
    renderCmpSlots();
    clearCmpResult();
  });

  $('#cmp-run').addEventListener('click', runComparison);

  $('#cmp-toggle-ascii').addEventListener('change', (e) => {
    cmpState.showAscii = !!e.target.checked;
    renderCmpRegions();
  });

  document.querySelectorAll('.cmp-clear-slot').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (cmpState.busy) return;
      const slot = btn.dataset.slot;
      if (slot === 'a') cmpState.fileA = null;
      if (slot === 'b') cmpState.fileB = null;
      clearCmpResult();
      renderCmpSlots();
    });
  });

  renderCmpSlots();
}

function setupCmpDropzone(slot) {
  const dz = document.querySelector(`.cmp-dropzone[data-slot="${slot}"]`);
  if (!dz) return;

  ['dragenter', 'dragover'].forEach((ev) => {
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (cmpState.busy) return;
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
    if (cmpState.busy) return;
    const items = Array.from(e.dataTransfer.files);
    const paths = items.map((f) => window.api.getPathForFile(f)).filter(Boolean);
    if (paths.length === 0) {
      logLine('warn', 'No file path could be read from the drop.');
      return;
    }
    assignCmpSlot(slot, paths[0]);
  });

  dz.addEventListener('click', async () => {
    if (cmpState.busy) return;
    const paths = await window.api.selectFiles();
    if (!paths || paths.length === 0) return;
    assignCmpSlot(slot, paths[0]);
  });

  dz.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (cmpState.busy) return;
      const paths = await window.api.selectFiles();
      if (!paths || paths.length === 0) return;
      assignCmpSlot(slot, paths[0]);
    }
  });
}

function assignCmpSlot(slot, filePath) {
  const fileName = filePath.split(/[\\/]/).pop();
  const entry = { path: filePath, name: fileName, size: null };
  if (slot === 'a') cmpState.fileA = entry;
  else cmpState.fileB = entry;
  clearCmpResult();
  renderCmpSlots();
  logLine('info', `File ${slot.toUpperCase()}: ${fileName}`);
}

function renderCmpSlots() {
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
        ? `${cmpFormatBytes(file.size)} (${file.size.toLocaleString()} bytes)`
        : '—';
    card.querySelector('[data-role="md5"]').textContent = file.md5 || 'computed on COMPARE';
  }

  const ready = !!(cmpState.fileA && cmpState.fileB) && !cmpState.busy;
  $('#cmp-run').disabled = !ready;
  $('#cmp-swap').disabled = !(cmpState.fileA || cmpState.fileB) || cmpState.busy;
  $('#cmp-clear').disabled = !(cmpState.fileA || cmpState.fileB) || cmpState.busy;
}

function clearCmpResult() {
  cmpState.result = null;
  $('#cmp-result-area').hidden = true;
  $('#cmp-elapsed').textContent = '';
}

function resetComparatorIfEmpty() {
  // Hook called when the user navigates to the Compare view. We deliberately
  // do NOT wipe state — users may switch tabs mid-flow. Just refresh the UI.
  renderCmpSlots();
}

async function runComparison() {
  if (cmpState.busy) return;
  if (!cmpState.fileA || !cmpState.fileB) return;
  cmpState.busy = true;
  renderCmpSlots();
  $('#cmp-spinner').hidden = false;
  $('#cmp-elapsed').textContent = '';
  clearCmpResult();

  try {
    const res = await window.api.compareFiles(cmpState.fileA.path, cmpState.fileB.path);
    if (res && res.error) {
      logLine('err', `Compare failed: ${res.error}`);
      return;
    }
    cmpState.result = res;
    // Sync size/md5 back into slot state so the cards reflect verified values.
    cmpState.fileA.size = res.fileA.size;
    cmpState.fileA.md5 = res.fileA.md5;
    cmpState.fileB.size = res.fileB.size;
    cmpState.fileB.md5 = res.fileB.md5;
    renderCmpSlots();
    renderCmpResult(res);
    $('#cmp-elapsed').textContent = `compared in ${res.meta.elapsedMs} ms`;
    logLine(
      'ok',
      `Compare done: ${res.similarity}% similar, ${res.totalChangedRegions} changed region(s), ${res.bytesDiffer.toLocaleString()} bytes differ.`
    );
  } catch (err) {
    logLine('err', `Compare failed: ${err.message || err}`);
  } finally {
    cmpState.busy = false;
    $('#cmp-spinner').hidden = true;
    renderCmpSlots();
  }
}

function renderCmpResult(r) {
  $('#cmp-result-area').hidden = false;

  // Summary stats
  const statSimilarity = $('#cmp-stat-similarity');
  const statDiffer = $('#cmp-stat-differ');
  const statRegions = $('#cmp-stat-regions');
  const statSizes = $('#cmp-stat-sizes');

  statSimilarity.querySelector('.cmp-stat-value').textContent = `${r.similarity}%`;
  statDiffer.querySelector('.cmp-stat-value').textContent = r.bytesDiffer.toLocaleString();
  statRegions.querySelector('.cmp-stat-value').textContent = r.totalChangedRegions.toLocaleString();
  const sameSize = r.fileA.size === r.fileB.size;
  statSizes.querySelector('.cmp-stat-value').textContent = sameSize
    ? cmpFormatBytes(r.fileA.size)
    : `${cmpFormatBytes(r.fileA.size)} / ${cmpFormatBytes(r.fileB.size)}`;

  // Color-code by similarity bucket.
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
    md5Badge.textContent = 'MD5: match ✓';
  } else {
    md5Badge.classList.add('mismatch');
    md5Badge.textContent = 'MD5: differ ✗';
  }

  // Identical banner replaces the regions list visually.
  const banner = $('#cmp-identical-banner');
  const heatCard = $('#cmp-heatmap-card');
  const regCard = $('#cmp-regions-card');
  if (r.identical) {
    banner.hidden = false;
    heatCard.hidden = true;
    regCard.hidden = true;
    return;
  }
  banner.hidden = true;
  heatCard.hidden = false;
  regCard.hidden = false;

  renderCmpHeatmap(r);
  renderCmpRegions();
}

function renderCmpHeatmap(r) {
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
      // Opacity scales with diff intensity for readability.
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
    cell.addEventListener('click', () => jumpToFirstRegionAtOrAfter(start));
    grid.appendChild(cell);
  }

  $('#cmp-heat-min').textContent = '0x0';
  $('#cmp-heat-max').textContent = `0x${r.comparableLength.toString(16).toUpperCase()}`;
}

function jumpToFirstRegionAtOrAfter(byteOffset) {
  const r = cmpState.result;
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
}

function renderCmpRegions() {
  const r = cmpState.result;
  if (!r) return;

  const wrap = $('#cmp-regions');
  wrap.innerHTML = '';
  const count = $('#cmp-region-count');
  count.textContent = r.totalChangedRegions > 0 ? `(${r.totalChangedRegions})` : '';

  if (!r.changedRegions || r.changedRegions.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'cmp-empty-result';
    empty.textContent = 'No differing regions within the comparable range.';
    wrap.appendChild(empty);
  } else {
    r.changedRegions.forEach((reg, idx) => {
      wrap.appendChild(buildCmpRegionEl(reg, idx));
    });
  }

  const cap = $('#cmp-region-cap');
  if (r.totalChangedRegions > r.changedRegions.length) {
    cap.hidden = false;
    cap.textContent =
      `Showing the first ${r.changedRegions.length} of ${r.totalChangedRegions} changed regions. ` +
      `Additional regions exist but were truncated to keep the view responsive.`;
  } else {
    cap.hidden = true;
    cap.textContent = '';
  }
}

function buildCmpRegionEl(region, idx) {
  const el = document.createElement('div');
  el.className = 'cmp-region';
  if (!cmpState.showAscii) el.classList.add('no-ascii');
  el.dataset.idx = String(idx);

  const head = document.createElement('div');
  head.className = 'cmp-region-head';
  head.innerHTML =
    `<span><span class="cmp-region-idx">Region ${idx + 1}</span>` +
    `<span> · </span>` +
    `<span class="cmp-region-off">0x${region.offset.toString(16).toUpperCase().padStart(8, '0')}</span></span>` +
    `<span class="cmp-region-len">${region.length} ${region.length === 1 ? 'byte' : 'bytes'}</span>`;
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
}

function cmpFormatBytes(bytes) {
  return formatBytes(bytes);
}
```

---

## 5. IPC handler — splice into `src/main/main.js`

**Location**: at the **end** of the file. The current file ends at **line
213** with the `checksum:compute` handler. Append immediately after that
handler.

**Snippet:**

```js
const ecuComparator = require('./ecu-comparator');

ipcMain.handle('compare:two-files', async (_event, pathA, pathB) => {
  try {
    return await ecuComparator.compareFiles(pathA, pathB);
  } catch (err) {
    return { error: err.message };
  }
});
```

---

## 6. Preload — splice into `src/main/preload.js`

**Location**: inside the `contextBridge.exposeInMainWorld('api', { ... })`
object, add the following entry. A natural place is right after the existing
`hexPeek:` line at **line 26**, before the blank line at line 27 / the
`getPathForFile:` entry at line 28.

**Snippet:**

```js
  compareFiles:    (a, b)                  => ipcRenderer.invoke('compare:two-files', a, b),
```

---

## Splice points by line number (verified)

The line numbers below were captured against the working tree at the time
this document was written. Re-confirm them with `wc -l` / `grep -n` before
splicing if the files have been edited since.

| File                       | Line | Anchor                                                                              |
| -------------------------- | ---- | ----------------------------------------------------------------------------------- |
| `src/renderer/index.html`  | 62   | end of `data-view="checksum"` nav button — insert `Compare` btn after               |
| `src/renderer/index.html`  | 324  | end of `view-checksum` section — insert new `view-compare` section after            |
| `src/renderer/styles.css`  | 941  | line `/* ===== Scrollbar ===== */` — insert Compare CSS block before                |
| `src/renderer/renderer.js` | 23   | `setupChecksumTool();` — add `setupComparator();` on next line                      |
| `src/renderer/renderer.js` | 45   | `if (viewName === 'settings')  loadArchiveRoot();` — add compare hook after         |
| `src/renderer/renderer.js` | 751  | `window.addEventListener('DOMContentLoaded', init);` — paste Compare JS block above |
| `src/main/main.js`         | 213  | end of `checksum:compute` handler — append IPC handler after                        |
| `src/main/preload.js`      | 26   | end of `hexPeek:` line — add `compareFiles:` entry after                            |

---

## DOM-element / JS-handler cross-check

Every selector referenced by the JS block is created by the HTML block above:

| DOM ID / Selector                                   | Created in HTML? |
| --------------------------------------------------- | ---------------- | ------ | --- |
| `#cmp-slot-a`, `#cmp-slot-b`                        | yes              |
| `.cmp-dropzone[data-slot="a"                        | "b"]`            | yes    |
| `.cmp-file-card` + `[data-role="name                | size             | md5"]` | yes |
| `.cmp-clear-slot[data-slot="a                       | b"]`             | yes    |
| `#cmp-swap`, `#cmp-clear`, `#cmp-run`               | yes              |
| `#cmp-elapsed`                                      | yes              |
| `#cmp-result-area`                                  | yes              |
| `#cmp-summary-card` and the 4 `#cmp-stat-*`         | yes              |
| `#cmp-md5-badge`                                    | yes              |
| `#cmp-identical-banner`                             | yes              |
| `#cmp-heatmap-card`, `#cmp-heatmap`                 | yes              |
| `#cmp-heat-min`, `#cmp-heat-max`, `#cmp-heat-hover` | yes              |
| `#cmp-regions-card`, `#cmp-regions`                 | yes              |
| `#cmp-region-count`, `#cmp-region-cap`              | yes              |
| `#cmp-toggle-ascii`                                 | yes              |
| `#cmp-spinner`                                      | yes              |
