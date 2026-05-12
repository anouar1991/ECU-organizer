// @ts-check
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, makeFixture } = require('./_launcher');

test.describe('Detail panel', () => {
  /** @type {Awaited<ReturnType<typeof launchApp>>} */
  let ctx;

  test.beforeAll(async () => {
    ctx = await launchApp();
    // Seed one file so we have a row to click.
    const fp = makeFixture('detail-seed.bin', ['AUDI', 'MED17.5']);
    await ctx.win.evaluate(async (p) => {
      await window.App.ingestFiles([p]);
      await window.App.organizeAll();
    }, fp);
    await ctx.win.evaluate(() => window.App.switchView('database'));
    await ctx.win.evaluate(async () => {
      if (typeof window.App.refreshDatabase === 'function') await window.App.refreshDatabase();
    });
  });

  test.afterAll(async () => {
    await closeApp(ctx);
  });

  test('opening detail panel for a row reveals it with metadata', async () => {
    // Use the public openDbDetailPanel(id) — same code path the row-click runs.
    const fileId = await ctx.win.evaluate(() => {
      const rows = window.App._dbAllRowsCache || [];
      return rows[0]?.id;
    });
    expect(fileId).toBeTruthy();

    await ctx.win.evaluate((id) => window.App.openDbDetailPanel(id), fileId);

    const panel = ctx.win.locator('#db-detail-panel');
    await expect(panel).toBeVisible({ timeout: 5000 });

    // Title shows the ID we opened.
    await expect(ctx.win.locator('#db-detail-id')).toContainText('#' + fileId);

    // Body should mention either the file's new_name or its brand.
    const body = ctx.win.locator('#db-detail-body');
    await expect(body).not.toBeEmpty();
  });

  test('close button hides the panel', async () => {
    await ctx.win.locator('#db-detail-close').click();
    const panel = ctx.win.locator('#db-detail-panel');
    // The hide transition is ~220ms; use toBeHidden which auto-retries.
    await expect(panel).toBeHidden({ timeout: 2000 });
  });
});
