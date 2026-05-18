// @ts-check
/**
 * Regression specs for tester-reported issues (videos 1 & 2):
 *
 *   - #1 selection bug: bulk "Open Folder" must open every selected row's
 *     parent folder, deduplicated — not just the first id in the Set.
 *   - #2 smart folders discoverability: empty-query save is refused with a
 *     toast; help button is present.
 *   - #3 scanning UX: duplicate drop surfaces a visible toast (not just a
 *     log line); low-confidence scan surfaces a toast steering the user to
 *     manual entry.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { test, expect } = require('@playwright/test');
const { launchApp, closeApp, makeFixture } = require('./_launcher');

/**
 * Build a binary that matches NONE of the parser's signatures. The renderer
 * should still ingest it, with a low-confidence toast pointing the user at
 * the metadata inputs.
 *
 * We avoid `crypto.randomBytes` because random data produces false-positive
 * ASCII matches over 1 MB (the parser found "Volkswagen" in random bytes in
 * one test run). Filling with bytes >= 0x80 guarantees scanAscii sees no
 * printable characters at all.
 */
function makeUnknownFixture(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ecu-unknown-fix-'));
  const fp = path.join(dir, name);
  const buf = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < buf.length; i++) buf[i] = ((i * 7 + 131) & 0x7f) | 0x80;
  fs.writeFileSync(fp, buf);
  return fp;
}

test.describe('Tester feedback fixes', () => {
  /** @type {Awaited<ReturnType<typeof launchApp>>} */
  let ctx;

  test.beforeAll(async () => {
    ctx = await launchApp();
  });

  test.afterAll(async () => {
    await closeApp(ctx);
  });

  test('#3 unknown-signature file lands in tray with Unknown fields (not silently dropped)', async () => {
    const fp = makeUnknownFixture('mystery.bin');
    const result = await ctx.win.evaluate(async (p) => {
      window.App.state.files = [];
      window.App.state.activeFileIndex = -1;
      await window.App.ingestFiles([p]);
      const file = window.App.state.files[0] || null;
      return file
        ? {
            count: window.App.state.files.length,
            brand: file.metadata.brand,
            model: file.metadata.model,
            ecuType: file.metadata.ecuType,
            confidence: file.metadata.confidence
          }
        : { count: 0 };
    }, fp);

    expect(result.count).toBe(1);
    expect(result.brand).toBe('Unknown');
    expect(result.confidence).toBeLessThan(30);
  });

  test('#3 low-confidence drop surfaces a visible toast pointing at manual entry', async () => {
    const fp = makeUnknownFixture('mystery2.bin');
    await ctx.win.evaluate(() => {
      // Clean any leftover toasts from prior tests.
      if (window.App.toast && typeof window.App.toast.dismissAll === 'function') {
        window.App.toast.dismissAll();
      }
      window.App.state.files = [];
      window.App.state.activeFileIndex = -1;
    });
    await ctx.win.evaluate(async (p) => {
      await window.App.ingestFiles([p]);
    }, fp);

    // The toast should be in the DOM after ingest. We don't care which title key
    // is used — both 'Couldn't auto-detect' (en) and 'Détection automatique
    // impossible' (fr) end up in the .toast-title node.
    const titleText = await ctx.win
      .locator('.toast-warn .toast-title')
      .first()
      .innerText({ timeout: 4000 })
      .catch(() => '');
    expect(titleText.length).toBeGreaterThan(0);
  });

  test('#3 dropping the same file twice shows a "already in archive" toast on the second drop', async () => {
    // Drop a real signature-bearing fixture and organize it so it lands in the DB.
    const known = makeFixture('vw-edc17-dup.bin', ['VW', 'EDC17C46', '03L906022AB']);
    await ctx.win.evaluate(async (p) => {
      window.App.state.files = [];
      window.App.state.activeFileIndex = -1;
      await window.App.ingestFiles([p]);
      await window.App.organizeAll();
      if (window.App.toast) window.App.toast.dismissAll();
    }, known);

    // Now drop it again — must trigger a duplicate toast.
    await ctx.win.evaluate(async (p) => {
      await window.App.ingestFiles([p]);
    }, known);

    const dupToast = await ctx.win
      .locator('.toast-warn .toast-title')
      .first()
      .innerText({ timeout: 4000 })
      .catch(() => '');
    expect(dupToast.length).toBeGreaterThan(0);
  });

  test('#2 saving a Smart Folder with empty query is refused with an info toast', async () => {
    await ctx.win.evaluate(() => {
      window.App.switchView('database');
      // Clear the search bar so the active query is empty.
      const inp = document.getElementById('global-search');
      if (inp) inp.value = '';
      const dbInp = document.getElementById('db-search');
      if (dbInp) dbInp.value = '';
      window.App.state.searchChips = [];
      window.App.state.dbTreeFilter = '';
      window.App.state.dbKindFilter = '';
      const kindFilter = document.getElementById('db-kind-filter');
      if (kindFilter) kindFilter.value = '';
      if (window.App.toast) window.App.toast.dismissAll();
    });

    await ctx.win.evaluate(() => window.App.saveCurrentAsSmartFolder());

    // The save modal should NOT open (no name input visible) and an info toast
    // should appear instead.
    const modalNameInputCount = await ctx.win
      .locator('input[id^="smart-folder-name-input-"]')
      .count();
    expect(modalNameInputCount).toBe(0);

    const toastText = await ctx.win
      .locator('.toast-info .toast-message')
      .first()
      .innerText({ timeout: 3000 })
      .catch(() => '');
    expect(toastText.length).toBeGreaterThan(0);
  });

  test('#2 smart folders sidebar has a help button that opens an explainer modal', async () => {
    const helpBtn = ctx.win.locator('#smart-folder-help-btn');
    await expect(helpBtn).toBeVisible();
    await helpBtn.click();

    // The modal title contains "Smart Folders" / "Dossiers Intelligents".
    const modalTitle = await ctx.win
      .locator('#app-modal-title')
      .innerText({ timeout: 3000 })
      .catch(() => '');
    expect(modalTitle.length).toBeGreaterThan(0);

    // Close the modal (last button = "Got it" / "J'ai compris").
    await ctx.win.locator('#app-modal-buttons button').last().click();
  });

  test('#1 bulk Open Folder shows a success toast with the count of folders opened', async () => {
    // Seed two rows from different brands so we have two distinct parent dirs.
    const a = makeFixture('fiat-edc17-row.bin', ['FIAT', 'EDC17C54']);
    const b = makeFixture('hyundai-med17-row.bin', ['HYUNDAI', 'MED17.5']);
    for (const fp of [a, b]) {
      await ctx.win.evaluate(async (p) => {
        window.App.state.files = [];
        window.App.state.activeFileIndex = -1;
        await window.App.ingestFiles([p]);
        await window.App.organizeAll();
      }, fp);
    }

    // Switch to the database view and refresh.
    await ctx.win.evaluate(async () => {
      window.App.switchView('database');
      if (typeof window.App.refreshDatabase === 'function') await window.App.refreshDatabase();
      if (window.App.toast && typeof window.App.toast.dismissAll === 'function') {
        window.App.toast.dismissAll();
      }
    });

    // contextBridge freezes window.api so we can't spy on `openFolder` directly.
    // Instead we assert the user-visible outcome: the bulk action ran across
    // *all* selected rows (success toast says "Opened N folders"), and the
    // bulk action bar reports the right selection size. The old bug was that
    // bulkOpenFolder picked only `ids[0]` from the Set, ignoring the rest —
    // which would result in either no toast or a "1 folder" toast for 2+
    // selected rows.
    const result = await ctx.win.evaluate(async () => {
      const rows = document.querySelectorAll('#db-tbody tr[data-id]');
      window.App.state.selectedIds.clear();
      rows.forEach((tr) => {
        const id = parseInt(tr.getAttribute('data-id'), 10);
        if (!Number.isNaN(id)) window.App.state.selectedIds.add(id);
      });
      const btn = document.getElementById('db-bulk-open-folder');
      btn.click();
      await new Promise((r) => setTimeout(r, 250));
      const toastMsg = document.querySelector('.toast-success .toast-message');
      return {
        selectedCount: window.App.state.selectedIds.size,
        toastText: toastMsg ? toastMsg.textContent.trim() : null
      };
    });

    expect(result.selectedCount).toBeGreaterThanOrEqual(2);
    expect(result.toastText).not.toBeNull();
    // The toast text should contain a number >= 2 (i.e. "Opened 2 folders" /
    // "2 dossiers ouverts"). We match any digit >= 2 anywhere in the string.
    expect(result.toastText).toMatch(/\b[2-9]\b/);
  });
});
