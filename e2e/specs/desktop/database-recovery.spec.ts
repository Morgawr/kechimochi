import fs from 'node:fs';
import path from 'node:path';
import { TEST_PROFILE_NAME } from '../../config/test-constants.js';
import { waitForAppReady } from '../../helpers/setup.js';

const LEGACY_TITLE = '薬屋のひとりごと';
const RENAMED_TITLE = '薬屋のひとりごと 改';

describe('Desktop database recovery', () => {
  before(async () => {
    await browser.execute((profileName: string) => {
      localStorage.setItem('kechimochi_profile', profileName);
    }, TEST_PROFILE_NAME);
    await browser.refresh();
  });

  it('keeps the instance lock and attaches a grouped set of orphaned milestones', async () => {
    const recoveryTitle = $('#database-recovery-title');
    await recoveryTitle.waitForDisplayed({ timeout: 10000 });
    expect(await recoveryTitle.getText()).toBe('Some data needs your help');
    expect(await $('#view-container').isExisting()).toBe(false);

    const dataDir = process.env.KECHIMOCHI_DATA_DIR!;
    const ownerRecord = fs.readFileSync(
      path.join(dataDir, '.kechimochi.instance.owner'),
      'utf8',
    );
    expect(ownerRecord).toContain('kind=desktop');

    const groups = await $$('.database-recovery-group');
    expect(groups).toHaveLength(1);
    expect(await groups[0].getText()).toContain(LEGACY_TITLE);
    expect(await groups[0].getText()).toContain('後宮の謎');
    expect(await groups[0].getText()).toContain('Recovery fixture second milestone');
    expect(await groups[0].getText()).toContain('2 milestones');

    await $('input[value="attach"]').click();
    const mediaInput = $('.database-recovery-media-input');
    await mediaInput.setValue(RENAMED_TITLE);
    const option = $('.database-recovery-media-option');
    await option.waitForDisplayed({ timeout: 5000 });
    expect(await option.getText()).toContain(RENAMED_TITLE);
    expect(await option.getText()).toContain('(no variant)');
    await option.click();
    expect(await $('.database-recovery-selection').getText()).toContain(RENAMED_TITLE);

    await $('#database-recovery-apply').click();
    await waitForAppReady();

    const linkedMilestones = await browser.execute(async (title: string) => {
      const invoke = (globalThis as unknown as {
        __TAURI_INTERNALS__: {
          invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
        };
      }).__TAURI_INTERNALS__.invoke;
      const media = await invoke<Array<{ uid: string; title: string }>>('get_all_media');
      const parent = media.find(entry => entry.title === title);
      if (!parent) return [];
      return invoke<Array<{ media_uid: string; media_title: string; name: string }>>(
        'get_milestones',
        { mediaUid: parent.uid },
      );
    }, RENAMED_TITLE);

    expect(linkedMilestones.map(milestone => milestone.name).sort()).toEqual([
      'Recovery fixture second milestone',
      '後宮の謎',
    ].sort());
    expect(linkedMilestones.every(milestone => milestone.media_title === RENAMED_TITLE)).toBe(true);

    const safetyBackups = fs.readdirSync(path.join(dataDir, 'recovery_backups'))
      .filter(fileName => fileName.endsWith('.zip'));
    expect(safetyBackups.length).toBeGreaterThan(0);
  });
});
