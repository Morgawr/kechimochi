import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { dismissAlert } from '../helpers/common.js';

async function applyDialogMock(savePath: string) {
  await browser.execute(() => {
          const g = globalThis as unknown as Record<string, unknown>;
          g.confirm = () => true;
          g.alert = () => { };
      });
  await browser.execute((p) => {
      (globalThis as unknown as { mockSavePath: string, mockOpenPath: string }).mockSavePath = p;
      (globalThis as unknown as { mockSavePath: string, mockOpenPath: string }).mockOpenPath = p; // If needed for imports
  }, savePath);
}

describe('CUJ: Data Management (CSV Export)', () => {
    let tempExportAll: string;
    let tempExportRange: string;
  
    before(async () => {
      await waitForAppReady();
      const exportBaseDir = process.env.SPEC_STAGE_DIR || os.tmpdir();
      tempExportAll = path.join(exportBaseDir, `kechimochi_full_${Date.now()}.csv`);
      tempExportRange = path.join(exportBaseDir, `kechimochi_range_${Date.now()}.csv`);
    });
  
    after(() => {
      // Only cleanup if we are NOT in a staging environment (where we want to capture artifacts)
      if (!process.env.SPEC_STAGE_DIR) {
          if (fs.existsSync(tempExportAll)) fs.unlinkSync(tempExportAll);
          if (fs.existsSync(tempExportRange)) fs.unlinkSync(tempExportRange);
      }
    });

  it('should export all history and verify file contents', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    await applyDialogMock(tempExportAll);

    const exportBtn = await $('#profile-btn-export-csv');
    await exportBtn.click();

    const radioAll = await $('input[name="export-mode"][value="all"]');
    await radioAll.waitForDisplayed();
    await radioAll.click();

    const confirmBtn = await $('#export-confirm');
    await confirmBtn.click();

    await browser.waitUntil(() => fs.existsSync(tempExportAll), {
        timeout: 15000,
        timeoutMsg: 'Export file was not created within 15s'
    });

    await dismissAlert();

    expect(fs.existsSync(tempExportAll)).toBe(true);
    
    const content = fs.readFileSync(tempExportAll, 'utf-8');
    expect(content).toContain('Date,Log Name,Media Type,Duration,Language');
    expect(content).toContain('呪術廻戦');
    expect(content.split('\n').length).toBeGreaterThan(10); 
  });

  it('should export custom range and verify difference', async () => {
    if (!(await verifyActiveView('profile'))) {
        await navigateTo('profile');
    }

    await applyDialogMock(tempExportRange);

    const exportBtn = await $('#profile-btn-export-csv');
    try {
        await exportBtn.click();
    } catch (e: unknown) {
        // Fallback to JS click if element is obscured, ignoring the initial click error
        // eslint-disable-next-line no-console
        if (process.env.DEBUG) console.warn('Standard click failed, using fallback', (e as Error).message);
        await browser.execute((el: unknown) => (el as HTMLElement).click(), exportBtn);
    }

    const radioRange = await $('input[name="export-mode"][value="range"]');
    await radioRange.waitForDisplayed();
    await radioRange.click();

    const confirmBtn = await $('#export-confirm');
    await confirmBtn.click();

    await browser.waitUntil(() => fs.existsSync(tempExportRange), {
        timeout: 15000,
        timeoutMsg: 'Range export file was not created within 15s'
    });

    await dismissAlert();

    expect(fs.existsSync(tempExportRange)).toBe(true);
    const fullContent = fs.readFileSync(tempExportAll, 'utf-8');
    const rangeContent = fs.readFileSync(tempExportRange, 'utf-8');

    expect(fullContent).not.toBe(rangeContent);
    expect(fullContent.length).toBeGreaterThan(rangeContent.length);
  });
});
