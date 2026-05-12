/* ===== Search query parser (Pack A.3) =====
 * Tokenises a free-form search string into:
 *   - `filters`  — recognised field operators (brand:, hw:, conf:>80, has:notes…)
 *   - `search`   — the leftover free-text (substring search over name/brand/etc)
 *
 * The parser is intentionally permissive: an unknown field name (e.g. `foo:bar`)
 * is treated as free text so users can't paint themselves into a corner. Tokens
 * with no value (`tag:`) are kept around so the UI can offer completion for them.
 *
 * Recognised fields:
 *   brand:<v>        substring match on row.brand
 *   model:<v>        substring match on row.model
 *   ecu:<v>          substring match on row.ecu_type
 *   hw:<v>           substring; suffix `*` enables prefix-only match
 *   sw:<v>           substring; suffix `*` enables prefix-only match
 *   tag:<v>          tag membership (repeatable → AND)
 *   kind:<v>         exact match (original|solution|orphan)
 *   conf:<expr>      >N, <N, N-M, =N
 *   protocol:<v>     substring match on row.protocol (csv)
 *   has:notes|tags|vin   presence (repeatable → AND)
 *
 * Quoted values (`notes:"customer john"`) are supported. The parser is a small
 * hand-written state machine; no regex over the whole input.
 */
window.App = window.App || {};

(function () {
  const App = window.App;

  const KNOWN_FIELDS = new Set([
    'brand',
    'model',
    'ecu',
    'hw',
    'sw',
    'tag',
    'kind',
    'conf',
    'protocol',
    'has'
  ]);

  // ---------- tokeniser ----------

  /** Tokenise into raw atoms: quoted strings stay one atom. */
  function tokenise(input) {
    const out = [];
    const s = String(input || '');
    let i = 0;
    while (i < s.length) {
      const ch = s[i];
      if (ch === ' ' || ch === '\t' || ch === '\n') {
        i++;
        continue;
      }
      // Bare quoted string (treat as free text)
      if (ch === '"') {
        let j = i + 1;
        while (j < s.length && s[j] !== '"') j++;
        out.push({
          start: i,
          end: j + 1,
          raw: s.slice(i, Math.min(j + 1, s.length)),
          quoted: true
        });
        i = j + 1;
        continue;
      }
      // Read up to next whitespace OR a colon if no colon yet OR a quoted value
      let j = i;
      let sawColon = false;
      while (j < s.length) {
        const c = s[j];
        if (c === ' ' || c === '\t' || c === '\n') break;
        if (c === ':' && !sawColon) {
          sawColon = true;
          j++;
          // If the value is quoted, consume the quoted run inline
          if (s[j] === '"') {
            j++;
            while (j < s.length && s[j] !== '"') j++;
            if (j < s.length) j++; // closing quote
            break; // atom ends at closing quote
          }
          continue;
        }
        j++;
      }
      out.push({ start: i, end: j, raw: s.slice(i, j), quoted: false });
      i = j;
    }
    return out;
  }

  function stripQuotes(v) {
    if (v && v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') {
      return v.slice(1, -1);
    }
    return v;
  }

  function parseConfRange(raw) {
    const v = String(raw || '').trim();
    if (!v) return null;
    if (v[0] === '>') {
      const n = parseInt(v.slice(v[1] === '=' ? 2 : 1), 10);
      if (!Number.isFinite(n)) return null;
      return { min: v[1] === '=' ? n : n + 1, max: 100 };
    }
    if (v[0] === '<') {
      const n = parseInt(v.slice(v[1] === '=' ? 2 : 1), 10);
      if (!Number.isFinite(n)) return null;
      return { min: 0, max: v[1] === '=' ? n : n - 1 };
    }
    if (v[0] === '=') {
      const n = parseInt(v.slice(1), 10);
      if (!Number.isFinite(n)) return null;
      return { min: n, max: n };
    }
    const m = v.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) return { min: parseInt(m[1], 10), max: parseInt(m[2], 10) };
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return { min: n, max: n };
    return null;
  }

  // ---------- parser ----------

  function parse(input) {
    const atoms = tokenise(input);
    const filters = {
      brand: '',
      model: '',
      ecu: '',
      hw: '',
      hwPrefix: false,
      sw: '',
      swPrefix: false,
      tags: [],
      kind: '',
      conf: null,
      protocol: '',
      has: []
    };
    const freeParts = [];
    /** @type {{type:string, field?:string, value:string, raw:string, start:number, end:number}[]} */
    const tokens = [];

    for (const atom of atoms) {
      const raw = atom.raw;
      const colon = atom.quoted ? -1 : raw.indexOf(':');
      if (colon > 0 && colon < raw.length - 0) {
        const field = raw.slice(0, colon).toLowerCase();
        let value = raw.slice(colon + 1);
        value = stripQuotes(value);

        if (KNOWN_FIELDS.has(field)) {
          tokens.push({
            type: 'field',
            field,
            value,
            raw,
            start: atom.start,
            end: atom.end
          });

          if (!value) continue; // empty `tag:` still recognised but contributes nothing

          if (field === 'brand') filters.brand = value;
          else if (field === 'model') filters.model = value;
          else if (field === 'ecu') filters.ecu = value;
          else if (field === 'hw') {
            const isPrefix = value.endsWith('*');
            filters.hw = isPrefix ? value.slice(0, -1) : value;
            filters.hwPrefix = isPrefix;
          } else if (field === 'sw') {
            const isPrefix = value.endsWith('*');
            filters.sw = isPrefix ? value.slice(0, -1) : value;
            filters.swPrefix = isPrefix;
          } else if (field === 'tag') {
            if (!filters.tags.includes(value)) filters.tags.push(value);
          } else if (field === 'kind') filters.kind = value.toLowerCase();
          else if (field === 'conf') filters.conf = parseConfRange(value);
          else if (field === 'protocol') filters.protocol = value.toLowerCase();
          else if (field === 'has') {
            const k = value.toLowerCase();
            if (!filters.has.includes(k)) filters.has.push(k);
          }
          continue;
        }
      }
      // Unknown field or bare word → free text
      const cleaned = stripQuotes(raw).trim();
      if (cleaned) {
        freeParts.push(cleaned);
        tokens.push({
          type: 'free',
          value: cleaned,
          raw,
          start: atom.start,
          end: atom.end
        });
      }
    }

    return {
      search: freeParts.join(' '),
      filters,
      tokens // ordered list of recognised tokens (chip + free)
    };
  }

  // ---------- format (reverse) ----------

  function format(parsed) {
    if (!parsed) return '';
    const parts = [];
    const f = parsed.filters || {};
    if (f.brand) parts.push(`brand:${quoteIfNeeded(f.brand)}`);
    if (f.model) parts.push(`model:${quoteIfNeeded(f.model)}`);
    if (f.ecu) parts.push(`ecu:${quoteIfNeeded(f.ecu)}`);
    if (f.hw) parts.push(`hw:${quoteIfNeeded(f.hw)}${f.hwPrefix ? '*' : ''}`);
    if (f.sw) parts.push(`sw:${quoteIfNeeded(f.sw)}${f.swPrefix ? '*' : ''}`);
    for (const t of f.tags || []) parts.push(`tag:${quoteIfNeeded(t)}`);
    if (f.kind) parts.push(`kind:${f.kind}`);
    if (f.conf) {
      if (f.conf.min === f.conf.max) parts.push(`conf:=${f.conf.min}`);
      else if (f.conf.max === 100) parts.push(`conf:>=${f.conf.min}`);
      else if (f.conf.min === 0) parts.push(`conf:<=${f.conf.max}`);
      else parts.push(`conf:${f.conf.min}-${f.conf.max}`);
    }
    if (f.protocol) parts.push(`protocol:${f.protocol}`);
    for (const h of f.has || []) parts.push(`has:${h}`);
    if (parsed.search) parts.push(parsed.search);
    return parts.join(' ');
  }

  function quoteIfNeeded(v) {
    const s = String(v == null ? '' : v);
    if (/\s/.test(s)) return `"${s}"`;
    return s;
  }

  // ---------- backend filter mapping ----------

  /**
   * Reduce parsed query to the shape window.api.listFiles accepts. The remaining
   * filters (model, hw/sw prefix, conf, has, protocol, multi-tag) are applied
   * client-side via applyClientSideFilters.
   */
  function toListFilesQuery(parsed) {
    const out = {};
    if (!parsed) return out;
    const f = parsed.filters || {};
    if (parsed.search) out.search = parsed.search;
    if (f.brand) out.brand = f.brand;
    if (f.ecu) out.ecuType = f.ecu;
    if (f.kind && f.kind !== 'orphan') out.kind = f.kind;
    // Pass only the FIRST tag — the rest get AND'd client-side.
    if (f.tags && f.tags.length > 0) out.tag = f.tags[0];
    return out;
  }

  function lcContains(haystack, needle) {
    return String(haystack || '')
      .toLowerCase()
      .includes(String(needle || '').toLowerCase());
  }

  function rowTags(row) {
    if (!row || !row.tags) return [];
    return String(row.tags)
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  function applyClientSideFilters(rows, parsed) {
    if (!parsed || !Array.isArray(rows)) return rows || [];
    const f = parsed.filters || {};
    const lcTags = (f.tags || []).map((t) => t.toLowerCase());
    const wantOrphan = f.kind === 'orphan';

    return rows.filter((r) => {
      // brand/model/ecu — substring (case-insensitive); brand also handled server-side
      // but tolerate that the server pulled by exact match while the chip is substring.
      if (f.brand && !lcContains(r.brand, f.brand)) return false;
      if (f.model && !lcContains(r.model, f.model)) return false;
      if (f.ecu && !lcContains(r.ecu_type, f.ecu)) return false;

      // hw / sw — prefix vs substring
      if (f.hw) {
        const hw = String(r.hw_id || '').toLowerCase();
        const v = f.hw.toLowerCase();
        if (f.hwPrefix ? !hw.startsWith(v) : !hw.includes(v)) return false;
      }
      if (f.sw) {
        const sw = String(r.sw_id || '').toLowerCase();
        const v = f.sw.toLowerCase();
        if (f.swPrefix ? !sw.startsWith(v) : !sw.includes(v)) return false;
      }

      // tags — every requested tag must be present
      if (lcTags.length > 0) {
        const rt = rowTags(r);
        for (const t of lcTags) if (!rt.includes(t)) return false;
      }

      // kind / orphan
      if (wantOrphan) {
        if (r.kind !== 'solution' || r.parent_id) return false;
      } else if (f.kind === 'original' || f.kind === 'solution') {
        if (r.kind !== f.kind) return false;
      }

      // conf range
      if (f.conf) {
        const c = Number(r.confidence);
        if (!Number.isFinite(c)) return false;
        if (c < f.conf.min || c > f.conf.max) return false;
      }

      // protocol — substring against the csv
      if (f.protocol && !lcContains(r.protocol, f.protocol)) return false;

      // has — required fields are non-empty
      for (const h of f.has || []) {
        if (h === 'notes' && !(r.notes && String(r.notes).trim())) return false;
        if (h === 'tags' && rowTags(r).length === 0) return false;
        if (h === 'vin' && !(r.vin && String(r.vin).trim())) return false;
      }

      return true;
    });
  }

  // ---------- suggestion cache ----------

  const cache = {
    ready: false,
    loading: null,
    brands: [],
    models: [],
    ecuTypes: [],
    hwIds: [],
    swIds: [],
    tags: [],
    size: 0
  };

  async function refreshCache() {
    if (!window.api || typeof window.api.listFiles !== 'function') return cache;
    cache.loading = (async () => {
      const rows = await window.api.listFiles({});
      const brands = new Set();
      const models = new Set();
      const ecus = new Set();
      const hws = new Set();
      const sws = new Set();
      const tags = new Set();
      for (const r of rows || []) {
        if (r.brand) brands.add(String(r.brand));
        if (r.model) models.add(String(r.model));
        if (r.ecu_type) ecus.add(String(r.ecu_type));
        if (r.hw_id) hws.add(String(r.hw_id));
        if (r.sw_id) sws.add(String(r.sw_id));
        if (r.tags) {
          for (const t of String(r.tags).split(',')) {
            const tt = t.trim();
            if (tt) tags.add(tt);
          }
        }
      }
      cache.brands = Array.from(brands).sort();
      cache.models = Array.from(models).sort();
      cache.ecuTypes = Array.from(ecus).sort();
      cache.hwIds = Array.from(hws).sort();
      cache.swIds = Array.from(sws).sort();
      cache.tags = Array.from(tags).sort();
      cache.size =
        cache.brands.length +
        cache.models.length +
        cache.ecuTypes.length +
        cache.hwIds.length +
        cache.swIds.length +
        cache.tags.length;
      cache.ready = true;
      return cache;
    })();
    try {
      await cache.loading;
    } finally {
      cache.loading = null;
    }
    return cache;
  }

  /**
   * Identify the token under the caret, given the raw input string + caret index.
   * Returns { token, atom, isField, field, value, prefix } where prefix is the
   * part of the value already typed (used to filter suggestions).
   */
  function tokenAtCaret(input, caret) {
    const s = String(input || '');
    const c = Math.max(0, Math.min(caret == null ? s.length : caret, s.length));
    // Walk backwards to the previous whitespace boundary
    let start = c;
    while (start > 0 && !/\s/.test(s[start - 1])) start--;
    let end = c;
    while (end < s.length && !/\s/.test(s[end])) end++;
    const raw = s.slice(start, end);
    const colon = raw.indexOf(':');
    if (colon > 0) {
      const field = raw.slice(0, colon).toLowerCase();
      const value = raw.slice(colon + 1);
      // Value-side caret only — completing field names is also supported when
      // the caret sits before the colon, but we keep that simple: treat the
      // pre-colon segment as a field-name prefix only if the caret is inside it.
      const caretInValue = c > start + colon;
      if (caretInValue && KNOWN_FIELDS.has(field)) {
        return {
          start,
          end,
          raw,
          isField: true,
          field,
          value,
          prefix: stripQuotes(value)
        };
      }
    }
    return {
      start,
      end,
      raw,
      isField: false,
      field: null,
      value: raw,
      prefix: stripQuotes(raw)
    };
  }

  function suggest(input, caret, limit = 8) {
    const tk = tokenAtCaret(input, caret);
    const out = [];

    function push(label, replacement, hint) {
      if (out.length >= limit) return;
      out.push({
        label,
        replacement,
        hint: hint || '',
        start: tk.start,
        end: tk.end
      });
    }

    const prefix = (tk.prefix || '').toLowerCase();

    if (tk.isField) {
      // Field-value autocomplete
      const list = listForField(tk.field);
      const matches = list.filter((v) => v.toLowerCase().includes(prefix)).slice(0, limit * 2);
      // Prioritise startsWith
      matches.sort((a, b) => {
        const sa = a.toLowerCase().startsWith(prefix) ? 0 : 1;
        const sb = b.toLowerCase().startsWith(prefix) ? 0 : 1;
        if (sa !== sb) return sa - sb;
        return a.localeCompare(b);
      });
      for (const v of matches) {
        const repl = `${tk.field}:${/\s/.test(v) ? `"${v}"` : v}`;
        push(repl, repl, hintFor(tk.field));
      }
      // Always offer raw value typed
      if (tk.field === 'has') {
        for (const v of ['notes', 'tags', 'vin']) {
          if (!prefix || v.includes(prefix)) push(`has:${v}`, `has:${v}`, 'presence');
        }
      }
      if (tk.field === 'kind') {
        for (const v of ['original', 'solution', 'orphan']) {
          if (!prefix || v.includes(prefix)) push(`kind:${v}`, `kind:${v}`, 'file kind');
        }
      }
      return out;
    }

    // Bare word: suggest known field prefixes + value matches
    const FIELD_HINTS = [
      ['brand:', 'brand'],
      ['model:', 'model'],
      ['ecu:', 'ECU type'],
      ['hw:', 'hardware id (suffix * for prefix)'],
      ['sw:', 'software id (suffix * for prefix)'],
      ['tag:', 'tag'],
      ['kind:', 'kind (original / solution / orphan)'],
      ['conf:', 'confidence (>80, 50-90, =100)'],
      ['protocol:', 'protocol substring'],
      ['has:', 'has notes / tags / vin']
    ];
    for (const [token, hint] of FIELD_HINTS) {
      if (!prefix || token.startsWith(prefix)) push(token, token, hint);
    }

    // Value matches across all catalogues
    const valSources = [
      { list: cache.brands, key: 'brand' },
      { list: cache.models, key: 'model' },
      { list: cache.ecuTypes, key: 'ecu' },
      { list: cache.hwIds, key: 'hw' },
      { list: cache.swIds, key: 'sw' },
      { list: cache.tags, key: 'tag' }
    ];
    for (const src of valSources) {
      for (const v of src.list) {
        if (!prefix) break;
        const lc = v.toLowerCase();
        if (!lc.includes(prefix)) continue;
        const repl = `${src.key}:${/\s/.test(v) ? `"${v}"` : v}`;
        push(repl, repl, `${src.key} match`);
        if (out.length >= limit) break;
      }
      if (out.length >= limit) break;
    }
    return out;
  }

  function listForField(field) {
    switch (field) {
      case 'brand':
        return cache.brands;
      case 'model':
        return cache.models;
      case 'ecu':
        return cache.ecuTypes;
      case 'hw':
        return cache.hwIds;
      case 'sw':
        return cache.swIds;
      case 'tag':
        return cache.tags;
      case 'kind':
        return ['original', 'solution', 'orphan'];
      case 'has':
        return ['notes', 'tags', 'vin'];
      default:
        return [];
    }
  }

  function hintFor(field) {
    switch (field) {
      case 'brand':
        return 'brand';
      case 'model':
        return 'model';
      case 'ecu':
        return 'ECU type';
      case 'hw':
        return 'hw id';
      case 'sw':
        return 'sw id';
      case 'tag':
        return 'tag';
      case 'kind':
        return 'kind';
      case 'conf':
        return 'confidence';
      case 'protocol':
        return 'protocol';
      case 'has':
        return 'presence';
      default:
        return '';
    }
  }

  // ---------- chip label helpers (used by the input renderer) ----------

  function chipLabel(token) {
    if (!token || token.type !== 'field') return '';
    const f = token.field;
    const v = token.value;
    if (f === 'conf') {
      const r = parseConfRange(v);
      if (r) {
        if (r.min === r.max) return `conf =${r.min}`;
        if (r.max === 100) return `conf ≥ ${r.min}`;
        if (r.min === 0) return `conf ≤ ${r.max}`;
        return `conf ${r.min}-${r.max}`;
      }
    }
    return `${f}: ${v}`;
  }

  App.SearchParser = {
    parse,
    format,
    toListFilesQuery,
    applyClientSideFilters,
    refreshCache,
    suggest,
    tokenAtCaret,
    chipLabel,
    _cache: cache,
    KNOWN_FIELDS
  };

  // CommonJS export so vitest can require this file directly (no Electron).
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = App.SearchParser;
  }
})();
