// @ts-check
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp } = require('./_launcher');

test.describe('Locale switching', () => {
  /** @type {Awaited<ReturnType<typeof launchApp>>} */
  let ctx;
  test.beforeAll(async () => {
    ctx = await launchApp();
  });
  test.afterAll(async () => {
    await closeApp(ctx);
  });

  test('app starts in English', async () => {
    const dashboardBtn = ctx.win.locator('.sidebar button[data-view="dashboard"]');
    await expect(dashboardBtn).toContainText('Dashboard');
  });

  test('switching to French translates the sidebar', async () => {
    // Go to settings and pick French
    await ctx.win.click('.sidebar button[data-view="settings"]');
    await ctx.win.waitForTimeout(200);
    await ctx.win.selectOption('#locale-select', 'fr');
    await ctx.win.waitForTimeout(400); // re-render

    const dashboardBtn = ctx.win.locator('.sidebar button[data-view="dashboard"]');
    await expect(dashboardBtn).toContainText('Tableau de bord');
  });

  test('switching back to English restores', async () => {
    await ctx.win.click('.sidebar button[data-view="settings"]');
    await ctx.win.waitForTimeout(200);
    await ctx.win.selectOption('#locale-select', 'en');
    await ctx.win.waitForTimeout(400);

    const dashboardBtn = ctx.win.locator('.sidebar button[data-view="dashboard"]');
    await expect(dashboardBtn).toContainText('Dashboard');
  });

  test('search bar placeholder is translated', async () => {
    await ctx.win.click('.sidebar button[data-view="settings"]');
    await ctx.win.waitForTimeout(200);
    await ctx.win.selectOption('#locale-select', 'fr');
    await ctx.win.waitForTimeout(400);

    const search = ctx.win.locator('#global-search');
    const placeholder = await search.getAttribute('placeholder');
    expect(placeholder).not.toContain('Quick Search');
    expect(placeholder).toMatch(/[Rr]echerche|[Ff]iltre/); // contains some French
  });
});
