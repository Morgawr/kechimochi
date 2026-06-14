import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { dismissAlert } from '../helpers/common.js';

// The 8-byte PNG file signature (see e2e/fixtures/seed.ts for the same constant).
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Redirect the native save dialog to a fixed path (read by the desktop service's
// getMockSavePath) and neutralize native dialogs, mirroring data-management.spec.
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

async function saveCardTo(buttonSelector: string, savePath: string): Promise<void> {
  await applyDialogMock(savePath);

  const button = await $(buttonSelector);
  await button.waitForClickable({ timeout: 10000 });
  await button.click();

  await browser.waitUntil(() => fs.existsSync(savePath), {
    timeout: 15000,
    timeoutMsg: `Report card PNG was not written to disk within 15s (${buttonSelector})`,
  });

  await dismissAlert('Report card image saved.');
}

function expectValidPng(filePath: string): Buffer {
  expect(fs.existsSync(filePath)).toBe(true);
  const bytes = fs.readFileSync(filePath);
  // Valid PNG: starts with the signature and is more than a trivial header.
  expect(bytes.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  expect(bytes.length).toBeGreaterThan(1000);
  return bytes;
}

describe('CUJ: Report Card (shareable PNG export)', () => {
  let activityCardPath: string;
  let contentCardPath: string;

  before(async () => {
    await waitForAppReady();
    const baseDir = process.env.SPEC_STAGE_DIR || os.tmpdir();
    activityCardPath = path.join(baseDir, `kechimochi_card_activity_${Date.now()}.png`);
    contentCardPath = path.join(baseDir, `kechimochi_card_content_${Date.now()}.png`);
  });

  after(() => {
    // Keep artifacts when staging; otherwise clean up the temp files.
    if (!process.env.SPEC_STAGE_DIR) {
      if (fs.existsSync(activityCardPath)) fs.unlinkSync(activityCardPath);
      if (fs.existsSync(contentCardPath)) fs.unlinkSync(contentCardPath);
    }
  });

  it('saves the activity-breakdown card as a valid PNG', async () => {
    await navigateTo('profile');
    expect(await verifyActiveView('profile')).toBe(true);

    await saveCardTo('#profile-btn-save-card-activity', activityCardPath);
    expectValidPng(activityCardPath);
  });

  it('saves the content-breakdown card as a valid PNG', async () => {
    if (!(await verifyActiveView('profile'))) {
      await navigateTo('profile');
    }

    await saveCardTo('#profile-btn-save-card-content', contentCardPath);
    expectValidPng(contentCardPath);
  });

  it('produces distinct images for the two breakdowns', () => {
    // Different subtitles and different slice data must yield different bytes,
    // confirming the variant actually changes what is rendered.
    const activityBytes = fs.readFileSync(activityCardPath);
    const contentBytes = fs.readFileSync(contentCardPath);
    expect(activityBytes.equals(contentBytes)).toBe(false);
  });
});
