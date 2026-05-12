// @ts-check
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./_launcher');

test.describe('Command palette', () => {
  /** @type {Awaited<ReturnType<typeof launchApp>>} */
  let ctx;

  test.beforeAll(async () => {
    ctx = await launchApp();
  });

  test.afterAll(async () => {
    await closeApp(ctx);
  });

  test('Ctrl+K opens the palette', async () => {
    await ctx.win.keyboard.press('Control+k');
    const overlay = ctx.win.locator('#cmd-palette-overlay');
    await expect(overlay).toBeVisible();
    // The input should be focused after open.
    const input = ctx.win.locator('#cmd-palette-input');
    await expect(input).toBeFocused();
  });

  test('typing "data" surfaces "Go to Database" result', async () => {
    const input = ctx.win.locator('#cmd-palette-input');
    await input.fill('data');
    const results = ctx.win.locator('#cmd-palette-results');
    await expect(results).toContainText(/Database/i, { timeout: 5000 });
  });

  test('Enter on the active result navigates to Database', async () => {
    const input = ctx.win.locator('#cmd-palette-input');
    // Ensure "data" still typed in.
    if ((await input.inputValue()) === '') {
      await input.fill('data');
    }
    await input.press('Enter');
    // Palette closes (animation 160ms).
    await expect(ctx.win.locator('#cmd-palette-overlay')).toBeHidden({ timeout: 2000 });
    // Database view is now active.
    await expect(
      ctx.win.locator('.view-database')
    ).toHaveClass(/active/);
  });

  test('Escape closes the palette', async () => {
    // Re-open
    await ctx.win.keyboard.press('Control+k');
    await expect(ctx.win.locator('#cmd-palette-overlay')).toBeVisible();

    await ctx.win.keyboard.press('Escape');
    await expect(ctx.win.locator('#cmd-palette-overlay')).toBeHidden({ timeout: 2000 });
  });
});
