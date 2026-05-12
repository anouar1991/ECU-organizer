// @ts-check
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./_launcher');

test.describe('Tag management', () => {
  /** @type {Awaited<ReturnType<typeof launchApp>>} */
  let ctx;

  test.beforeAll(async () => {
    ctx = await launchApp();
    await ctx.win.evaluate(() => window.App.switchView('tag-management'));
  });

  test.afterAll(async () => {
    await closeApp(ctx);
  });

  test('create a tag via the toolbar input', async () => {
    const input = ctx.win.locator('#tm-new-tag-name');
    const btn = ctx.win.locator('#tm-new-tag-btn');
    await input.fill('TestTag');
    await btn.click();

    // The new tag should appear in the tbody.
    const row = ctx.win.locator('#tm-tbody tr[data-tag-name="TestTag"]');
    await expect(row).toBeVisible({ timeout: 5000 });
  });

  test('change tag color via IPC and re-render', async () => {
    // Drive the color update via the IPC helper (the renderer's color picker
    // ultimately calls upsertTagMeta with a color string). This is more reliable
    // than driving the floating palette which positions itself via JS.
    await ctx.win.evaluate(async () => {
      await window.api.upsertTagMeta('TestTag', { color: 'orange' });
      if (typeof window.App.refreshTagManagement === 'function') {
        await window.App.refreshTagManagement();
      }
    });

    // The color dot inside the TestTag row should now have data-color="orange".
    const dot = ctx.win.locator(
      '#tm-tbody tr[data-tag-name="TestTag"] .tm-color-dot'
    );
    await expect(dot).toHaveAttribute('data-color', 'orange');
  });

  test('rename a tag via IPC', async () => {
    await ctx.win.evaluate(async () => {
      await window.api.renameTag('TestTag', 'RenamedTag');
      if (typeof window.App.refreshTagManagement === 'function') {
        await window.App.refreshTagManagement();
      }
    });

    await expect(
      ctx.win.locator('#tm-tbody tr[data-tag-name="RenamedTag"]')
    ).toBeVisible();
    await expect(
      ctx.win.locator('#tm-tbody tr[data-tag-name="TestTag"]')
    ).toHaveCount(0);
  });

  test('delete a tag via IPC', async () => {
    await ctx.win.evaluate(async () => {
      await window.api.deleteTag('RenamedTag');
      if (typeof window.App.refreshTagManagement === 'function') {
        await window.App.refreshTagManagement();
      }
    });

    await expect(
      ctx.win.locator('#tm-tbody tr[data-tag-name="RenamedTag"]')
    ).toHaveCount(0);
  });
});
