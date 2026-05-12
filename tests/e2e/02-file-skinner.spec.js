// @ts-check
const { test, expect } = require('@playwright/test');
const path = require('path');
const { launchApp, closeApp, makeFixture } = require('./_launcher');

test.describe('File Skinner — scan + organize', () => {
  /** @type {Awaited<ReturnType<typeof launchApp>>} */
  let ctx;
  /** @type {string} */
  let fixturePath;

  test.beforeAll(async () => {
    ctx = await launchApp();
    // Build a synthetic ECU file with planted "AUDI" + "MED17" signatures so
    // the parser populates brand+ECU fields. Sized ~1MB so all 3 chunks (head,
    // mid, tail) read paths exercise.
    fixturePath = makeFixture('audi-med17-mock.bin', ['AUDI', 'MED17.5', 'EDC17']);
  });

  test.afterAll(async () => {
    await closeApp(ctx);
  });

  test('scan populates metadata fields', async () => {
    // Make sure we start on the skinner view (it's the default landing view).
    await ctx.win.evaluate(() => window.App.switchView('skinner'));

    // Trigger ingest via the renderer's own pipeline — same path as the file
    // dialog/drop, but bypasses the native dialog. The scan IPC fires through
    // ecuParser.parseFile() exactly as it would for a real drop.
    await ctx.win.evaluate(async (p) => {
      await window.App.ingestFiles([p]);
    }, fixturePath);

    // Wait for the brand input to be populated. The parser is async (TLSH +
    // hashing + ASCII scan), so we poll the value via locator auto-retry.
    const brandInput = ctx.win.locator('.meta-input[data-field="brand"]');
    await expect(brandInput).not.toHaveValue('');

    // Brand should match AUDI (case-insensitive — parser normalizes to "Audi").
    expect((await brandInput.inputValue()).toLowerCase()).toContain('audi');

    // ECU type should mention MED17 family.
    const ecuInput = ctx.win.locator('.meta-input[data-field="ecuType"]');
    expect((await ecuInput.inputValue()).toUpperCase()).toMatch(/MED17|MEDC17|EDC17/);

    // Inputs become editable once a file is loaded.
    await expect(brandInput).toBeEnabled();
  });

  test('TAGS section is enabled after scan', async () => {
    const tagInput = ctx.win.locator('#tag-input');
    await expect(tagInput).toBeEnabled();
    const tagAdd = ctx.win.locator('#tag-add-btn');
    await expect(tagAdd).toBeEnabled();
  });

  test('organize button is enabled after scan', async () => {
    const orgBtn = ctx.win.locator('#organize-btn');
    await expect(orgBtn).toBeEnabled();
  });

  test('organize succeeds without producing an error toast', async () => {
    // Snapshot the file count before. The organize() pipeline copies the file
    // into the archive root + inserts a DB row.
    const beforeCount = await ctx.win.evaluate(async () => {
      const rows = await window.api.listFiles({});
      return Array.isArray(rows) ? rows.length : 0;
    });

    // Invoke the renderer's organizeAll() directly — same logic the button click runs.
    await ctx.win.evaluate(async () => {
      await window.App.organizeAll();
    });

    // The DB should now have one more row.
    const afterCount = await ctx.win.evaluate(async () => {
      const rows = await window.api.listFiles({});
      return Array.isArray(rows) ? rows.length : 0;
    });
    expect(afterCount).toBe(beforeCount + 1);

    // After organize, the file tray should be empty and the organize button disabled again.
    await expect(ctx.win.locator('#organize-btn')).toBeDisabled();

    // No error toasts should be present.
    const errorToasts = await ctx.win.locator('.toast.toast-error').count();
    expect(errorToasts).toBe(0);

    // And the archive root should now contain at least one .bin file.
    const fs = require('fs');
    const archiveContents = fs.readdirSync(ctx.archiveRoot);
    expect(archiveContents.length).toBeGreaterThan(0);
  });
});
