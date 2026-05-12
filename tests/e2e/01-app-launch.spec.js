// @ts-check
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./_launcher');

test.describe('App launch', () => {
  /** @type {Awaited<ReturnType<typeof launchApp>>} */
  let ctx;
  test.beforeAll(async () => {
    ctx = await launchApp();
  });
  test.afterAll(async () => {
    await closeApp(ctx);
  });

  test('window opens with correct title', async () => {
    expect(await ctx.win.title()).toBe('ECU File Skinner Pro');
  });

  test('sidebar shows all main views', async () => {
    const nav = ctx.win.locator('.sidebar .nav');
    await expect(nav.locator('button[data-view="dashboard"]')).toBeVisible();
    await expect(nav.locator('button[data-view="skinner"]')).toBeVisible();
    await expect(nav.locator('button[data-view="database"]')).toBeVisible();
    await expect(nav.locator('button[data-view="tag-management"]')).toBeVisible();
    await expect(nav.locator('button[data-view="duplicates"]')).toBeVisible();
    await expect(nav.locator('button[data-view="compare"]')).toBeVisible();
    // Settings appears both in main nav AND in sidebar footer; only assert one.
    await expect(
      ctx.win.locator('.sidebar button[data-view="settings"]').first()
    ).toBeVisible();
  });

  test('search bar has advanced syntax hint', async () => {
    const search = ctx.win.locator('#global-search');
    const placeholder = await search.getAttribute('placeholder');
    expect(placeholder || '').toMatch(/brand:audi/i);
  });

  test('no JS errors in console during startup', async () => {
    const errors = [];
    ctx.win.on('pageerror', (err) => errors.push(err.message));
    // Settle for ~1.5s — bootstrap is already done by launchApp, but give the
    // settings/manifest fetches a moment to fire any pending warnings.
    await ctx.win.waitForTimeout(1500);
    // Filter out known electron-updater warnings which are infrastructure, not app bugs.
    const real = errors.filter((e) => !/electron-updater|ENOENT.*latest-linux/i.test(e));
    expect(real).toEqual([]);
  });
});
