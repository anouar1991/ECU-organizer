// @ts-check
/**
 * Helper to launch and tear down the Electron app under Playwright control,
 * with an isolated `userData` directory per-test-suite so the user's real DB
 * is never touched.
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { _electron } = require('playwright');

const APP_ROOT = path.resolve(__dirname, '..', '..');

/**
 * Launch the Electron app with an isolated user data dir + archive root.
 *
 * @param {object} [opts]
 * @param {string} [opts.archiveRoot]   Optional pre-created archive root.
 * @param {string} [opts.userDataDir]   Reuse a previously-created user-data-dir
 *                                      (useful for "restart" persistence tests).
 * @returns {Promise<{app: import('playwright').ElectronApplication, win: import('playwright').Page, testDataDir: string, archiveRoot: string}>}
 */
async function launchApp(opts = {}) {
  const testDataDir =
    opts.userDataDir || fs.mkdtempSync(path.join(os.tmpdir(), 'ecu-e2e-userdata-'));
  const archiveRoot = opts.archiveRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'ecu-e2e-archive-'));

  const env = {
    ...process.env,
    NODE_ENV: 'test',
    // Disable hardware accel + sandbox for CI / xvfb friendliness
    ELECTRON_DISABLE_SANDBOX: '1'
  };

  const electronApp = await _electron.launch({
    args: [APP_ROOT, `--user-data-dir=${testDataDir}`, '--no-sandbox', '--disable-gpu'],
    env,
    cwd: APP_ROOT,
    timeout: 30000
  });

  // Wait for the first window
  const win = await electronApp.firstWindow({ timeout: 20000 });
  await win.waitForLoadState('domcontentloaded');

  // Wait until the app's bootstrap finishes — `App.state` exists when the
  // renderer has loaded all its modules. The DOMContentLoaded init() is async
  // (it awaits getSettings + getArchiveRoot), so we poll for the marker.
  await win.waitForFunction(() => !!(window.App && window.App.state && window.App.switchView), {
    timeout: 15000
  });

  // Force the archive root to the isolated test directory so organize() doesn't
  // litter the user's real ~/Documents/ECU_Archive folder. Persists via the
  // SQLite settings table inside this test's user-data-dir.
  await win.evaluate(async (root) => {
    await window.api.setArchiveRoot(root);
    if (typeof window.App.loadArchiveRoot === 'function') {
      await window.App.loadArchiveRoot();
    }
  }, archiveRoot);

  return { app: electronApp, win, testDataDir, archiveRoot };
}

/**
 * Close the Electron app and (optionally) clean up the temp directories.
 *
 * @param {{app: import('playwright').ElectronApplication, testDataDir: string, archiveRoot: string}} ctx
 * @param {object} [opts]
 * @param {boolean} [opts.keepDirs]  If true, do not delete the temp dirs.
 *                                   Useful when a later test wants to launch
 *                                   the same userData dir to test persistence.
 */
async function closeApp(ctx, opts = {}) {
  try {
    await ctx.app.close();
  } catch {
    // ignore
  }
  if (!opts.keepDirs) {
    try {
      fs.rmSync(ctx.testDataDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
    try {
      fs.rmSync(ctx.archiveRoot, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
}

/**
 * Synthesize a fixture binary the parser will recognize. Embeds ASCII
 * signature strings the parser scans for (e.g. "MED17", "AUDI", "EDC17",
 * "BMW") plus a HW/SW-id-like token so the metadata table populates.
 *
 * @param {string} filename
 * @param {string[]} signatures  Tokens to plant in the header (ASCII).
 * @param {object} [opts]
 * @param {number} [opts.size]   Total file size in bytes (default ~1MB).
 * @returns {string} absolute path to the fixture file.
 */
function makeFixture(filename, signatures, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecu-fix-'));
  const fp = path.join(dir, filename);
  const size = opts.size || 1024 * 1024;

  // Build a 64KB header padded with 0xff and stamp the signature strings at
  // distinct offsets so the parser's scanAscii() picks them up.
  const header = Buffer.alloc(Math.min(64 * 1024, size), 0xff);
  let off = 64;
  for (const sig of signatures) {
    if (off + sig.length + 1 < header.length) {
      header.write(sig, off, 'ascii');
      off += sig.length + 16;
    }
  }
  // Plant a HW-id token the parser recognizes: e.g. "03L 906 022 XX"
  // (VAG-style box number). We use a generic recognizable HW token.
  const hwToken = '03L906022AB';
  if (off + hwToken.length < header.length) {
    header.write(hwToken, off, 'ascii');
  }

  const body = Buffer.alloc(Math.max(0, size - header.length), 0xaa);
  fs.writeFileSync(fp, Buffer.concat([header, body]));
  return fp;
}

module.exports = { launchApp, closeApp, makeFixture, APP_ROOT };
