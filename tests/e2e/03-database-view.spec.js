// @ts-check
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, makeFixture } = require('./_launcher');

test.describe('Database view — search + selection', () => {
  /** @type {Awaited<ReturnType<typeof launchApp>>} */
  let ctx;

  test.beforeAll(async () => {
    ctx = await launchApp();
    // Pre-seed the database with one Audi/MED17 file via the IPC pipeline.
    const audiFixture = makeFixture('audi-med17-seed.bin', ['AUDI', 'MED17.5']);
    const bmwFixture = makeFixture('bmw-edc17-seed.bin', ['BMW', 'EDC17C46']);
    for (const fp of [audiFixture, bmwFixture]) {
      await ctx.win.evaluate(async (p) => {
        await window.App.ingestFiles([p]);
        await window.App.organizeAll();
      }, fp);
    }
  });

  test.afterAll(async () => {
    await closeApp(ctx);
  });

  test('navigating to database shows the seeded rows', async () => {
    await ctx.win.evaluate(() => window.App.switchView('database'));
    // Refresh the table from disk to make sure inserts are loaded.
    await ctx.win.evaluate(async () => {
      if (typeof window.App.refreshDatabase === 'function') await window.App.refreshDatabase();
    });

    const rows = ctx.win.locator('#db-tbody tr[data-id]');
    await expect(rows).toHaveCount(2);
  });

  test('global search with brand:audi narrows the table', async () => {
    // The search is debounced ~250ms and applies a filter to the table. Use the
    // public search-chip pipeline rather than driving keystrokes (more reliable
    // — bypasses debounce, focus, and dropdown management).
    await ctx.win.evaluate(() => {
      window.App.state.searchChips = [{ key: 'brand', value: 'audi' }];
      if (typeof window.App.applySearchFromState === 'function') {
        window.App.applySearchFromState();
      } else if (typeof window.App.refreshDatabase === 'function') {
        window.App.refreshDatabase();
      }
    });

    // Use the input as a fallback to trigger filter — type and press Enter
    // so the chip is persisted via the regular Enter-commit path.
    const search = ctx.win.locator('#global-search');
    await search.fill('');
    await search.type('brand:audi');
    await search.press('Enter');

    // Wait for chip to appear in the chips strip.
    const chip = ctx.win.locator('#search-chips .search-chip');
    await expect(chip.first()).toBeVisible({ timeout: 5000 });

    // Table should now show only Audi rows. We accept >=1 (Audi seed exists)
    // and assert no BMW rows are visible by checking the brand cell content.
    await ctx.win.evaluate(async () => {
      if (typeof window.App.refreshDatabase === 'function') await window.App.refreshDatabase();
    });

    const rows = ctx.win.locator('#db-tbody tr[data-id]');
    const count = await rows.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // None of the visible rows should mention BMW.
    const visibleText = (await rows.allInnerTexts()).join(' ').toLowerCase();
    expect(visibleText).not.toMatch(/\bbmw\b/);

    // Clear via the clear button.
    const clearBtn = ctx.win.locator('#search-clear');
    if (await clearBtn.isVisible()) {
      await clearBtn.click();
    }
  });

  test('selecting a row reveals the bulk action bar', async () => {
    // Clear any leftover filters first.
    await ctx.win.evaluate(async () => {
      window.App.state.searchChips = [];
      if (typeof window.App.refreshDatabase === 'function') await window.App.refreshDatabase();
    });

    // Select the first row by setting selectedIds directly + re-rendering.
    // The action bar listens for changes via updateDbActionBar.
    await ctx.win.evaluate(async () => {
      const firstId = (window.App._dbAllRowsCache || [])[0]?.id;
      if (firstId == null) throw new Error('no rows to select');
      window.App.state.selectedIds = new Set([firstId]);
      if (typeof window.App.updateDbActionBar === 'function') window.App.updateDbActionBar();
      if (typeof window.App.refreshDatabase === 'function') await window.App.refreshDatabase();
    });

    // Action bar should be visible.
    const bar = ctx.win.locator('#db-action-bar');
    await expect(bar).toBeVisible();
    await expect(ctx.win.locator('#db-action-count')).toContainText('selected');

    // Clear via the Clear button.
    await ctx.win.locator('#db-bulk-clear').click();

    // The bar has a 220ms hide animation; wait for the hidden attribute to return.
    await expect(bar).toBeHidden({ timeout: 2000 });
  });
});
