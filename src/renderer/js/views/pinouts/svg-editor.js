/* ===== Pinout SVG annotation editor =====
 *
 * Interactive overlay editor that lets the user place LABELED PINS on an
 * uploaded ECU connector image, drag the label box anywhere on the canvas,
 * and the editor auto-draws an arrow from the label to the pin point —
 * matching the style of OEM connection-guide images.
 *
 * Coordinate system
 *   All coordinates are in the IMAGE'S INTRINSIC pixel space (e.g. if the
 *   uploaded image is 1280×720, x ∈ [0, 1280]). The SVG element uses a
 *   matching `viewBox` and `preserveAspectRatio="none"` so the overlay
 *   stretches with the <img>. This makes the annotation data portable across
 *   display sizes / DPI without re-saving on resize.
 *
 * Persisted shape (also documented in database.js)
 *   {
 *     "imageWidth": 1280,
 *     "imageHeight": 720,
 *     "points": [
 *       {
 *         "id": "p1",            // stable id, used for keyboard nav & undo
 *         "pinLabel": "A1",
 *         "labelText": "+12V (A1)",
 *         "pinX": 412, "pinY": 305,        // tip of the dot on the connector
 *         "labelX": 60, "labelY": 120,     // top-left of the label box
 *         "color": "#ff5e5e"
 *       },
 *       ...
 *     ]
 *   }
 *
 * Interactions
 *   - click on the image (no point under cursor) → create a new pin at click;
 *     label box drops at a sensible offset, label text prefilled with next pin.
 *   - drag a pin dot → moves the dot; arrow auto-re-aims at the label box.
 *   - drag a label box → moves the label; arrow auto-re-aims.
 *   - double-click a label → edit the text inline.
 *   - click a pin/label → selects it (DEL removes; arrow keys nudge by 1 px;
 *     SHIFT+arrow nudges by 10 px).
 *   - color picker per point in a small popover next to the selected label.
 *
 * Read-only mode
 *   If `opts.readonly === true`, no mouse / keyboard interactions are wired —
 *   the editor renders the overlay only. Used by the auto-suggest card.
 */
window.App = window.App || {};

(function () {
  const App = window.App;

  const DEFAULT_COLORS = [
    '#ff5e5e', // red — power
    '#fbbf24', // amber — ignition / signal
    '#10b981', // green — ground
    '#3b82f6', // blue — CAN H
    '#6366f1', // indigo — CAN L
    '#a855f7', // purple — K-Line / serial
    '#ec4899', // pink — boot / debug
    '#9ca3af' // gray — unknown / generic
  ];

  // Pin function → color preset. Used when the user creates a pin and types
  // a function in the inline label — the editor auto-picks a sensible color
  // so the user doesn't have to remember the convention.
  const FUNCTION_COLOR_MAP = [
    { match: /\+?12\s*v|vbat|power|supply/i, color: '#ff5e5e' },
    { match: /gnd|ground|earth/i, color: '#10b981' },
    { match: /can[_\s]?h/i, color: '#3b82f6' },
    { match: /can[_\s]?l/i, color: '#6366f1' },
    { match: /k[-_\s]?line|iso[\s-]?9141/i, color: '#a855f7' },
    { match: /boot|bsl|jtag/i, color: '#ec4899' },
    { match: /ign|ignition/i, color: '#fbbf24' }
  ];

  function colorForFunction(text) {
    for (const m of FUNCTION_COLOR_MAP) {
      if (m.match.test(text)) return m.color;
    }
    return DEFAULT_COLORS[0];
  }

  // SVG namespace shortcut — `document.createElement` doesn't work for SVG
  // children; they need the proper namespace or the browser silently renders
  // them as unknown HTML elements with no visual output.
  const NS = 'http://www.w3.org/2000/svg';
  function svgEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null) continue;
        el.setAttribute(k, String(v));
      }
    }
    return el;
  }

  class PinoutSvgEditor {
    constructor({ wrap, img, svg, entry, onChange, readonly }) {
      this.wrap = wrap;
      this.img = img;
      this.svg = svg;
      this.onChange = typeof onChange === 'function' ? onChange : () => {};
      this.readonly = !!readonly;
      this.iw = img.naturalWidth || 800;
      this.ih = img.naturalHeight || 480;

      // Defensive: if entry.annotations is from an older revision with a
      // different image, dimensions may not match. We snap the viewBox to the
      // current image and scale legacy coords proportionally.
      const ann = entry && entry.annotations ? entry.annotations : {};
      let points = Array.isArray(ann.points) ? ann.points.slice() : [];
      if (
        ann.imageWidth &&
        ann.imageHeight &&
        (ann.imageWidth !== this.iw || ann.imageHeight !== this.ih)
      ) {
        const sx = this.iw / ann.imageWidth;
        const sy = this.ih / ann.imageHeight;
        points = points.map((p) => ({
          ...p,
          pinX: (p.pinX || 0) * sx,
          pinY: (p.pinY || 0) * sy,
          labelX: (p.labelX || 0) * sx,
          labelY: (p.labelY || 0) * sy
        }));
      }
      this.points = points;
      this.selectedId = null;
      this.dragging = null; // { id, kind: 'pin' | 'label', startX, startY, originalX, originalY }
      this.pinSeq = points.reduce((max, p) => Math.max(max, parseInt(p.id?.slice(1), 10) || 0), 0);

      this.setupCanvas();
      this.render();
      if (!this.readonly) this.wireInteractions();
    }

    setupCanvas() {
      // Use the image's intrinsic dimensions as the SVG viewBox so x,y are
      // in image-pixel space regardless of how the wrap is sized on screen.
      this.svg.setAttribute('viewBox', `0 0 ${this.iw} ${this.ih}`);
      this.svg.setAttribute('preserveAspectRatio', 'none');
      // Match the SVG to the IMG's CSS size (which respects aspect-ratio).
      // We re-sync on every render in case the layout changes.
      this.syncSvgSize();
    }

    syncSvgSize() {
      this.svg.style.position = 'absolute';
      this.svg.style.top = '0';
      this.svg.style.left = '0';
      this.svg.style.width = '100%';
      this.svg.style.height = '100%';
      this.svg.style.pointerEvents = this.readonly ? 'none' : 'auto';
    }

    /** Translate a mouse event's clientX/Y to image-intrinsic coords. */
    eventToImageCoords(e) {
      const rect = this.img.getBoundingClientRect();
      // Guard against zero-size during initial layout — return the center.
      if (rect.width === 0 || rect.height === 0) return { x: this.iw / 2, y: this.ih / 2 };
      const xRatio = (e.clientX - rect.left) / rect.width;
      const yRatio = (e.clientY - rect.top) / rect.height;
      return {
        x: Math.max(0, Math.min(this.iw, xRatio * this.iw)),
        y: Math.max(0, Math.min(this.ih, yRatio * this.ih))
      };
    }

    render() {
      // Clear and rebuild the overlay. The point count is small (typically
      // <50 pins) so a full re-render per change is cheaper than diffing.
      this.svg.innerHTML = '';

      for (const p of this.points) {
        const isSel = p.id === this.selectedId;
        const color = p.color || DEFAULT_COLORS[0];

        // Arrow polyline: label-box edge → pin dot. We use a simple straight
        // line because connector images are dense and curved paths get
        // visually confused fast. The polyline endpoint is offset from the
        // label so the arrow points AT the box, not through it.
        const arrow = svgEl('line', {
          x1: p.labelX + 6,
          y1: p.labelY + 10,
          x2: p.pinX,
          y2: p.pinY,
          stroke: color,
          'stroke-width': 1.5,
          'stroke-linecap': 'round',
          'data-arrow-for': p.id
        });
        this.svg.appendChild(arrow);

        // Pin dot.
        const dot = svgEl('circle', {
          cx: p.pinX,
          cy: p.pinY,
          r: isSel ? 7 : 5,
          fill: color,
          stroke: isSel ? '#ffffff' : '#0b0d10',
          'stroke-width': isSel ? 2 : 1,
          'data-pin-id': p.id,
          'data-handle': 'pin',
          style: this.readonly ? 'pointer-events:none' : 'cursor:move'
        });
        this.svg.appendChild(dot);

        // Label box (foreignObject hosts a div so labels stay readable at any
        // viewBox zoom — pure SVG <text> is harder to size predictably).
        // We give the foreignObject a generous max width so the layout doesn't
        // clip multi-word functions.
        const labelW = Math.max(
          60,
          Math.min(180, (p.labelText || p.pinLabel || '').length * 8 + 24)
        );
        const fo = svgEl('foreignObject', {
          x: p.labelX,
          y: p.labelY,
          width: labelW,
          height: 24,
          'data-pin-id': p.id,
          'data-handle': 'label'
        });
        const div = document.createElement('div');
        div.className = 'pinout-svg-label' + (isSel ? ' selected' : '');
        div.style.borderColor = color;
        div.style.color = color;
        div.textContent = p.labelText || p.pinLabel || '';
        if (this.readonly) {
          div.style.pointerEvents = 'none';
        } else {
          div.style.cursor = 'move';
          div.style.userSelect = 'none';
        }
        fo.appendChild(div);
        this.svg.appendChild(fo);
      }
    }

    wireInteractions() {
      // Add — click on the image (anywhere not on a handle) creates a pin.
      this.img.addEventListener('click', (e) => {
        if (this.dragging) return;
        if (e.target !== this.img) return;
        const { x, y } = this.eventToImageCoords(e);
        this.addPoint(x, y);
      });

      // Mousedown on a pin or label → start drag.
      this.svg.addEventListener('mousedown', (e) => {
        const target = e.target.closest('[data-handle]');
        if (!target) return;
        const id = target.getAttribute('data-pin-id');
        const handle = target.getAttribute('data-handle');
        if (!id || !handle) return;
        const point = this.points.find((p) => p.id === id);
        if (!point) return;
        this.selectedId = id;
        const { x, y } = this.eventToImageCoords(e);
        this.dragging = {
          id,
          handle,
          startCoord: { x, y },
          originalCoord:
            handle === 'pin'
              ? { x: point.pinX, y: point.pinY }
              : { x: point.labelX, y: point.labelY }
        };
        e.preventDefault();
        e.stopPropagation();
        this.render();
      });

      window.addEventListener(
        'mousemove',
        (this._onMouseMove = (e) => {
          if (!this.dragging) return;
          const { x, y } = this.eventToImageCoords(e);
          const dx = x - this.dragging.startCoord.x;
          const dy = y - this.dragging.startCoord.y;
          const point = this.points.find((p) => p.id === this.dragging.id);
          if (!point) return;
          if (this.dragging.handle === 'pin') {
            point.pinX = clamp(this.dragging.originalCoord.x + dx, 0, this.iw);
            point.pinY = clamp(this.dragging.originalCoord.y + dy, 0, this.ih);
          } else {
            point.labelX = clamp(this.dragging.originalCoord.x + dx, 0, this.iw - 40);
            point.labelY = clamp(this.dragging.originalCoord.y + dy, 0, this.ih - 20);
          }
          this.render();
        })
      );

      window.addEventListener(
        'mouseup',
        (this._onMouseUp = () => {
          if (this.dragging) {
            this.dragging = null;
            this.flushChange();
          }
        })
      );

      // Inline edit on double-click of a label.
      this.svg.addEventListener('dblclick', (e) => {
        const target = e.target.closest('[data-handle="label"]');
        if (!target) return;
        const id = target.getAttribute('data-pin-id');
        const point = this.points.find((p) => p.id === id);
        if (!point) return;
        this.editLabelInline(point, target);
      });

      // Keyboard: DELETE selected; arrow keys nudge.
      this._onKey = (e) => {
        if (!this.selectedId) return;
        const point = this.points.find((p) => p.id === this.selectedId);
        if (!point) return;
        if (e.key === 'Delete' || e.key === 'Backspace') {
          // Only intercept when no input is focused, so the user can still
          // backspace inside the form's text inputs.
          if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
          if (document.activeElement && document.activeElement.tagName === 'TEXTAREA') return;
          e.preventDefault();
          this.removePoint(this.selectedId);
          return;
        }
        const step = e.shiftKey ? 10 : 1;
        const moveLabel = e.altKey; // hold ALT to nudge the LABEL instead of the pin
        let handled = true;
        const target = moveLabel ? 'label' : 'pin';
        const xKey = target === 'pin' ? 'pinX' : 'labelX';
        const yKey = target === 'pin' ? 'pinY' : 'labelY';
        if (e.key === 'ArrowLeft') point[xKey] = clamp(point[xKey] - step, 0, this.iw);
        else if (e.key === 'ArrowRight') point[xKey] = clamp(point[xKey] + step, 0, this.iw);
        else if (e.key === 'ArrowUp') point[yKey] = clamp(point[yKey] - step, 0, this.ih);
        else if (e.key === 'ArrowDown') point[yKey] = clamp(point[yKey] + step, 0, this.ih);
        else handled = false;
        if (handled) {
          e.preventDefault();
          this.render();
          this.flushChange();
        }
      };
      window.addEventListener('keydown', this._onKey);
    }

    /** Detach window listeners — called by the view layer when leaving the page. */
    destroy() {
      if (this._onMouseMove) window.removeEventListener('mousemove', this._onMouseMove);
      if (this._onMouseUp) window.removeEventListener('mouseup', this._onMouseUp);
      if (this._onKey) window.removeEventListener('keydown', this._onKey);
    }

    addPoint(x, y) {
      this.pinSeq += 1;
      const id = 'p' + this.pinSeq;
      const labelLeft = x > this.iw / 2 ? x - 140 : x + 40;
      const labelTop = clamp(y - 30, 10, this.ih - 30);
      const point = {
        id,
        pinLabel: '',
        labelText: 'pin ' + this.pinSeq,
        pinX: x,
        pinY: y,
        labelX: labelLeft,
        labelY: labelTop,
        color: DEFAULT_COLORS[(this.pinSeq - 1) % DEFAULT_COLORS.length]
      };
      this.points.push(point);
      this.selectedId = id;
      this.render();
      this.flushChange();
      // Immediately prompt for label text.
      setTimeout(() => {
        const fo = this.svg.querySelector(`[data-handle="label"][data-pin-id="${id}"]`);
        if (fo) this.editLabelInline(point, fo);
      }, 10);
    }

    removePoint(id) {
      this.points = this.points.filter((p) => p.id !== id);
      this.selectedId = null;
      this.render();
      this.flushChange();
    }

    editLabelInline(point, foreignObject) {
      const div = foreignObject.querySelector('div');
      if (!div) return;
      const input = document.createElement('input');
      input.type = 'text';
      input.value = point.labelText || point.pinLabel || '';
      input.className = 'pinout-svg-label-input';
      input.style.borderColor = point.color || DEFAULT_COLORS[0];
      div.replaceWith(input);
      input.focus();
      input.select();
      const finish = (commit) => {
        if (commit) {
          point.labelText = input.value.trim() || 'pin';
          // Auto-color based on function keywords (e.g. "+12V" → red).
          const inferred = colorForFunction(point.labelText);
          if (inferred) point.color = inferred;
        }
        this.render();
        this.flushChange();
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      });
      input.addEventListener('blur', () => finish(true));
    }

    flushChange() {
      const payload = {
        imageWidth: this.iw,
        imageHeight: this.ih,
        points: this.points
      };
      this.onChange(payload);
    }
  }

  function clamp(v, lo, hi) {
    if (v < lo) return lo;
    if (v > hi) return hi;
    return v;
  }

  let _currentInstance = null;

  App.PinoutSvgEditor = {
    /**
     * Create (or replace) the editor for the given wrap. Returns the
     * instance so callers can call `.destroy()` when leaving the view.
     */
    init(opts) {
      if (_currentInstance) {
        _currentInstance.destroy();
        _currentInstance = null;
      }
      _currentInstance = new PinoutSvgEditor(opts);
      return _currentInstance;
    },
    destroyCurrent() {
      if (_currentInstance) {
        _currentInstance.destroy();
        _currentInstance = null;
      }
    }
  };
})();
