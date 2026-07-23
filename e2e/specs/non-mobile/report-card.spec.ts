import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';
import { dismissAlert } from '../../helpers/common.js';
import { isDesktop, isWeb } from '../../config/platform.js';

// The 8-byte PNG file signature (see e2e/fixtures/seed.ts for the same constant).
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Redirect the native save dialog to a fixed path (read by the desktop service's
// getMockSavePath) and neutralize native dialogs, mirroring data-management.spec.
// On web, the same mockSavePath global signals the web service to capture the
// saved PNG on an in-page global instead of triggering a real download.
async function applyDialogMock(savePath: string) {
  await browser.execute(() => {
    const g = globalThis as unknown as Record<string, unknown>;
    g.confirm = () => true;
    g.alert = () => { };
  });
  await browser.execute((p) => {
    (globalThis as unknown as { mockSavePath: string }).mockSavePath = p;
  }, savePath);
}

async function clickSaveCardButton(buttonSelector: string): Promise<void> {
  const button = $(buttonSelector);
  await button.waitForClickable({ timeout: 10000 });
  await button.click();
}

async function setMetricToggle(useCharacters: boolean): Promise<void> {
  const option = $(useCharacters ? '#report-card-metric-characters' : '#report-card-metric-time');
  await option.waitForClickable({ timeout: 5000 });
  await option.click();
}

async function saveCardToDisk(buttonSelector: string, savePath: string): Promise<void> {
  await applyDialogMock(savePath);
  await clickSaveCardButton(buttonSelector);

  await browser.waitUntil(() => fs.existsSync(savePath), {
    timeout: 15000,
    timeoutMsg: `Report card PNG was not written to disk within 15s (${buttonSelector})`,
  });

  await dismissAlert('Report card image saved.');
}

async function saveCardToWebGlobal(buttonSelector: string): Promise<Buffer> {
  await applyDialogMock('web-capture');
  await browser.execute(() => {
    delete (globalThis as unknown as Record<string, unknown>).__lastSavedReportCard;
  });
  await clickSaveCardButton(buttonSelector);

  await browser.waitUntil(async () => {
    const value = await browser.execute(() => (globalThis as unknown as Record<string, unknown>).__lastSavedReportCard);
    return typeof value === 'string' && value.length > 0;
  }, {
    timeout: 15000,
    timeoutMsg: `Report card PNG was not captured within 15s (${buttonSelector})`,
  });

  await dismissAlert('Report card image saved.');

  const base64 = await browser.execute(() => (globalThis as unknown as Record<string, unknown>).__lastSavedReportCard as string);
  return Buffer.from(base64, 'base64');
}

function expectValidPngBytes(bytes: Buffer): void {
  // Valid PNG: starts with the signature and is more than a trivial header.
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  expect(bytes.length).toBeGreaterThan(1000);
}

function expectValidPng(filePath: string): Buffer {
  expect(fs.existsSync(filePath)).toBe(true);
  const bytes = fs.readFileSync(filePath);
  expectValidPngBytes(bytes);
  return bytes;
}

describe('CUJ: Report Card (shareable PNG export)', () => {
  let activityCardPath: string;
  let contentCardPath: string;
  let charactersContentCardPath: string;
  let activityCardBytes: Buffer;
  let contentCardBytes: Buffer;

  before(async () => {
    await waitForAppReady();
    const baseDir = process.env.SPEC_STAGE_DIR || os.tmpdir();
    activityCardPath = path.join(baseDir, `kechimochi_card_activity_${Date.now()}.png`);
    contentCardPath = path.join(baseDir, `kechimochi_card_content_${Date.now()}.png`);
    charactersContentCardPath = path.join(baseDir, `kechimochi_card_content_chars_${Date.now()}.png`);
  });

  after(() => {
    // Keep artifacts when staging; otherwise clean up the temp files.
    if (isDesktop() && !process.env.SPEC_STAGE_DIR) {
      if (fs.existsSync(activityCardPath)) fs.unlinkSync(activityCardPath);
      if (fs.existsSync(contentCardPath)) fs.unlinkSync(contentCardPath);
      if (fs.existsSync(charactersContentCardPath)) fs.unlinkSync(charactersContentCardPath);
    }
  });

  it('saves the activity-breakdown card as a valid PNG', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    if (isDesktop()) {
      await saveCardToDisk('#profile-btn-save-card-activity', activityCardPath);
      activityCardBytes = expectValidPng(activityCardPath);
    } else if (isWeb()) {
      activityCardBytes = await saveCardToWebGlobal('#profile-btn-save-card-activity');
      expectValidPngBytes(activityCardBytes);
    }
  });

  it('saves the content-breakdown card as a valid PNG for both the time and characters metrics', async () => {
    if (!(await verifyActiveView('profile'))) {
      await navigateTo('profile');
    }

    // Default metric (time).
    await setMetricToggle(false);
    if (isDesktop()) {
      await saveCardToDisk('#profile-btn-save-card-content', contentCardPath);
      contentCardBytes = expectValidPng(contentCardPath);
    } else if (isWeb()) {
      contentCardBytes = await saveCardToWebGlobal('#profile-btn-save-card-content');
      expectValidPngBytes(contentCardBytes);
    }

    await setMetricToggle(true);
    if (isDesktop()) {
      await saveCardToDisk('#profile-btn-save-card-content', charactersContentCardPath);
      const charactersCardBytes = expectValidPng(charactersContentCardPath);
      expect(charactersCardBytes.equals(contentCardBytes)).toBe(false);
    } else if (isWeb()) {
      const charactersCardBytes = await saveCardToWebGlobal('#profile-btn-save-card-content');
      expectValidPngBytes(charactersCardBytes);
      expect(charactersCardBytes.equals(contentCardBytes)).toBe(false);
    }
  });

  it('produces distinct images for the two breakdowns', () => {
    // Different subtitles and different slice data must yield different bytes,
    // confirming the variant actually changes what is rendered.
    expect(activityCardBytes.equals(contentCardBytes)).toBe(false);
  });
});
