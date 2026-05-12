// @ts-check
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, makeFixture } = require('./_launcher');

test.describe('Compare view', () => {
  /** @type {Awaited<ReturnType<typeof launchApp>>} */
  let ctx;
  /** @type {string} */
  let fixA;
  /** @type {string} */
  let fixB;

  test.beforeAll(async () => {
    ctx = await launchApp();
    // Build two fixtures with different signature placements so they have a
    // measurable similarity (high but not identical).
    fixA = makeFixture('cmp-a.bin', ['AUDI', 'MED17.5'], { size: 256 * 1024 });
    fixB = makeFixture('cmp-b.bin', ['AUDI', 'MED17.5'], { size: 256 * 1024 });
  });

  test.afterAll(async () => {
    await closeApp(ctx);
  });

  test('switching to compare view + running compare produces results', async () => {
    await ctx.win.evaluate(() => window.App.switchView('compare'));
    await ctx.win.locator('#cmp-slot-a').waitFor({ state: 'visible' });

    // Assign both slots via the public renderer helper. This bypasses the file
    // dialog and the drag-drop simulation entirely.
    await ctx.win.evaluate(async ([a, b]) => {
      window.App.assignCmpSlot('a', a);
      window.App.assignCmpSlot('b', b);
    }, [fixA, fixB]);

    // Run button should be enabled now.
    const runBtn = ctx.win.locator('#cmp-run');
    await expect(runBtn).toBeEnabled({ timeout: 5000 });

    // Trigger the comparison via the public function (more reliable than
    // clicking — avoids any debounce / pointer-event nuance).
    await ctx.win.evaluate(async () => {
      await window.App.runComparison();
    });

    // Result area should be revealed.
    const resultArea = ctx.win.locator('#cmp-result-area');
    await expect(resultArea).toBeVisible({ timeout: 15000 });

    // Similarity stat should be present and formatted as a percentage.
    const simValue = ctx.win.locator('#cmp-stat-similarity .cmp-stat-value');
    await expect(simValue).toContainText('%');

    // Regions stat should show a numeric value (>= 0).
    const regValue = ctx.win.locator('#cmp-stat-regions .cmp-stat-value');
    await expect(regValue).not.toHaveText('');
  });
});
