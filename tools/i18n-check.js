// @ts-check
/**
 * Scans renderer source for residual literal strings and missing keys.
 *
 * Outputs:
 *   - Total keys defined in en.json
 *   - Missing keys (referenced in code but not defined in en.json)
 *   - Unused keys (defined but never referenced) — informational only
 *
 * Exit code: 1 if any keys are missing, 0 otherwise.
 */
const fs = require('fs');
const path = require('path');

const RENDERER = path.join(__dirname, '..', 'src', 'renderer');
const LOCALES = path.join(RENDERER, 'locales');

const enPath = path.join(LOCALES, 'en.json');
if (!fs.existsSync(enPath)) {
  console.error('Missing en.json at', enPath);
  process.exit(2);
}

let en;
try {
  en = JSON.parse(fs.readFileSync(enPath, 'utf8'));
} catch (err) {
  console.error('Failed to parse en.json:', err.message);
  process.exit(2);
}

function flatten(obj, prefix = '') {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? prefix + '.' + k : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}

const allKeys = new Set(Object.keys(flatten(en)));
const missing = new Set();
const unused = new Set(allKeys);

// Skip i18n.js itself (it does pattern-matching on keys, not actual lookups).
const SKIP_BASENAMES = new Set(['i18n.js']);

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip locales/ — those are catalogs, not call sites.
      if (entry.name === 'locales') continue;
      walk(fp);
      continue;
    }
    if (!fp.endsWith('.js') && !fp.endsWith('.html')) continue;
    if (SKIP_BASENAMES.has(entry.name)) continue;

    const src = fs.readFileSync(fp, 'utf8');
    const rel = path.relative(RENDERER, fp);

    // 1) App.t('key', ...) or App.t("key", ...). Also catches a one-character
    //    local alias like `T('key', ...)` (cmd-palette.js declares `const T = App.t`).
    const tRegex = /(?:\bApp\.t|\bT)\(\s*['"]([^'"]+)['"]/g;
    let m;
    while ((m = tRegex.exec(src))) {
      const k = m[1];
      if (!allKeys.has(k)) missing.add(`${k}  (${rel})`);
      unused.delete(k);
    }

    // 2) data-i18n="key" / data-i18n-placeholder="key" / data-i18n-title="key" /
    //    data-i18n-aria-label="key"
    const dRegex = /data-i18n(?:-placeholder|-title|-aria-label)?=["']([^"']+)["']/g;
    while ((m = dRegex.exec(src))) {
      const k = m[1];
      if (!allKeys.has(k)) missing.add(`${k}  (${rel})`);
      unused.delete(k);
    }

    // 3) Quoted strings that look like i18n keys (dotted, lowercase + underscores,
    //    no spaces). This catches dynamic dispatches such as
    //    `App.t(bodyKey)` where bodyKey = '...one' or '...many', and look-up
    //    tables (`{ kind: 'database.col_kind' }`).
    //    We only consume it as "found" if it actually exists in en.json — keys
    //    in code that don't match are NOT reported as missing here (would yield
    //    false positives), they would still surface via path #1 if they're real.
    const sRegex = /['"]([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+)['"]/g;
    while ((m = sRegex.exec(src))) {
      const k = m[1];
      if (allKeys.has(k)) unused.delete(k);
    }
  }
}

walk(RENDERER);

console.log('=== i18n check ===');
console.log('Total keys in en.json:', allKeys.size);
console.log('Missing keys (referenced but not defined):', missing.size);
for (const k of Array.from(missing).sort()) console.log('  x ' + k);
console.log('Unused keys (defined but not referenced):', unused.size);
for (const k of Array.from(unused).sort()) console.log('  ? ' + k);

process.exit(missing.size > 0 ? 1 : 0);
