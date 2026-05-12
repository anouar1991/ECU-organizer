// @ts-check
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { launchApp, closeApp } = require('./_launcher');

test.describe('Settings persistence across restart', () => {
  // Use a shared userDataDir + archiveRoot across BOTH app launches so the
  // SQLite DB (which lives inside userData) persists between them.
  const sharedUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'ecu-e2e-persist-'));
  const sharedArchive = fs.mkdtempSync(path.join(os.tmpdir(), 'ecu-e2e-archive-persist-'));

  test.afterAll(async () => {
    try {
      fs.rmSync(sharedUserData, { recursive: true, force: true });
    } catch {
      // ignore
    }
    try {
      fs.rmSync(sharedArchive, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  test('toggle auto-organize, restart app, value persists', async () => {
    // ---- First launch: toggle the setting on ----
    let ctx = await launchApp({ userDataDir: sharedUserData, archiveRoot: sharedArchive });
    try {
      await ctx.win.evaluate(() => window.App.switchView('settings'));

      const toggle = ctx.win.locator('#auto-organize-enabled');
      await expect(toggle).toBeVisible();

      // Read the starting state (default is unchecked).
      const wasChecked = await toggle.isChecked();
      expect(wasChecked).toBe(false);

      // Click to enable, then dispatch a change event explicitly to trigger
      // the persistence handler. Playwright's check() does fire change, but
      // belt-and-suspenders here matches the test brief's "toggle" intent.
      await toggle.check();
      await ctx.win.evaluate(() => {
        const el = document.getElementById('auto-organize-enabled');
        if (el) el.dispatchEvent(new Event('change'));
      });

      // Confirm DB persists by reading back via IPC inside the renderer.
      const settingsNow = await ctx.win.evaluate(() => window.api.getSettings());
      expect(settingsNow.auto_organize_enabled).toBe('1');
    } finally {
      await closeApp(ctx, { keepDirs: true });
    }

    // ---- Second launch: same userData dir → same SQLite DB ----
    ctx = await launchApp({ userDataDir: sharedUserData, archiveRoot: sharedArchive });
    try {
      // The renderer auto-loads settings at boot; verify the checkbox state.
      await ctx.win.evaluate(() => window.App.switchView('settings'));
      const toggleAgain = ctx.win.locator('#auto-organize-enabled');
      await expect(toggleAgain).toBeChecked({ timeout: 5000 });

      // Cross-check via IPC.
      const settingsLater = await ctx.win.evaluate(() => window.api.getSettings());
      expect(settingsLater.auto_organize_enabled).toBe('1');
    } finally {
      await closeApp(ctx, { keepDirs: true });
    }
  });
});
