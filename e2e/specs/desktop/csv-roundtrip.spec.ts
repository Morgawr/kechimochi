import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';
import { addMedia, clickMediaItem, isMediaNotVisible, isMediaVisible } from '../../helpers/library.js';
import {
  addExtraField,
  editDescription,
  getExtraField,
  logActivityFromDetail,
} from '../../helpers/media-detail.js';
import {
  confirmAction,
  dismissAlert,
  safeClick,
  setDialogMockPath,
} from '../../helpers/common.js';
import { resolveConflicts } from '../../helpers/import.js';
import { setSelect } from '../../helpers/form-controls.js';

function parseCsv(content: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < content.length; index += 1) {
    const character = content[index];
    if (character === '"') {
      if (quoted && content[index + 1] === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if (character === '\n' && !quoted) {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (character !== '\r' || quoted) {
      field += character;
    }
  }
  if (field || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  const [headers = [], ...records] = rows;
  return records
    .filter(record => record.some(value => value !== ''))
    .map(record => Object.fromEntries(headers.map((header, index) => [header, record[index] || ''])));
}

describe('CUJ: Exact CSV Round Trips', () => {
  const activityTitle = 'Activity CSV Fidelity';
  const mediaTitle = 'Media CSV Fidelity';
  const stageDirectory = process.env.SPEC_STAGE_DIR || os.tmpdir();
  const activityCsv = path.join(stageDirectory, `activity-roundtrip-${Date.now()}.csv`);
  const mediaCsv = path.join(stageDirectory, `media-roundtrip-${Date.now()}.csv`);

  before(async () => {
    await waitForAppReady();
  });

  after(() => {
    if (!process.env.SPEC_STAGE_DIR) {
      for (const file of [activityCsv, mediaCsv]) {
        if (fs.existsSync(file)) fs.unlinkSync(file);
      }
    }
  });

  it('exports, clears, and reimports exact activity fields', async () => {
    const notes = 'CSV note, with comma\nand a "quoted" value';
    await navigateTo('media');
    await addMedia(activityTitle, 'Reading', 'Novel', 'Collector Edition');
    await logActivityFromDetail(activityTitle, '41', '2300', 'Watching', notes);

    await navigateTo('profile');
    await setDialogMockPath(activityCsv);
    await safeClick('#profile-btn-export-csv');
    await safeClick('input[name="export-mode"][value="all"]');
    await safeClick('#export-confirm');
    await dismissAlert(undefined, 15000);

    const exported = parseCsv(fs.readFileSync(activityCsv, 'utf8'));
    const record = exported.find(row => row['Log Name'] === activityTitle);
    expect(record).toMatchObject({
      'Log Name': activityTitle,
      'Default Activity Type': 'Reading',
      'Duration': '41',
      'Characters': '2300',
      'Activity Type': 'Watching',
      'Notes': notes,
      'Media Variant': 'Collector Edition',
    });

    await safeClick('#profile-btn-clear-activities');
    await confirmAction(true);
    await dismissAlert('All activity logs removed.');

    await setDialogMockPath(activityCsv);
    await safeClick('#profile-btn-import-csv');
    await dismissAlert('Successfully imported', 15000);

    await navigateTo('dashboard');
    const entries = $$(`.dashboard-activity-item[data-activity-title="${activityTitle}"]`);
    expect(await entries.length).toBe(1);
    expect(await entries[0].getText()).toContain('41 Minutes');
    expect((await entries[0].getText()).replaceAll(',', '')).toContain('2300 characters');
    expect(await entries[0].getText()).toContain('of Watching');

    await navigateTo('media');
    await clickMediaItem(activityTitle);
    expect(await $('#media-logs-container').getText()).toContain('CSV note, with comma');
    expect(await $('#media-logs-container').getText()).toContain('and a "quoted" value');
  });

  it('exports, deletes, and reimports supported media fields without replacing existing entries', async () => {
    await navigateTo('media');
    await addMedia(mediaTitle, 'Reading', 'Visual Novel', 'Steam Edition');
    await editDescription('Portable description, with punctuation.');
    await addExtraField('Developer', 'Round Trip Studio');
    await setSelect('#default-activity-type', { text: 'Reading' });
    await setSelect('#media-content-type', { text: 'Visual Novel' });

    await navigateTo('profile');
    await setDialogMockPath(mediaCsv);
    await safeClick('#profile-btn-export-media');
    await dismissAlert('Successfully exported', 15000);

    const exported = parseCsv(fs.readFileSync(mediaCsv, 'utf8'));
    const record = exported.find(row => row.Title === mediaTitle);
    expect(record).toMatchObject({
      Title: mediaTitle,
      Variant: 'Steam Edition',
      'Default Activity Type': 'Reading',
      Status: 'Active',
      Language: 'Japanese',
      Description: 'Portable description, with punctuation.',
      'Content Type': 'Visual Novel',
      'Extra Data': JSON.stringify({ Developer: 'Round Trip Studio' }),
    });

    await navigateTo('media');
    await clickMediaItem(mediaTitle);
    await safeClick('#btn-media-overflow');
    await safeClick('#btn-delete-media-detail');
    await confirmAction(true);
    await navigateTo('media');
    expect(await isMediaNotVisible(mediaTitle)).toBe(true);

    await navigateTo('profile');
    await setDialogMockPath(mediaCsv);
    await safeClick('#profile-btn-import-media');
    await resolveConflicts('keep');

    await navigateTo('media');
    expect(await isMediaVisible(mediaTitle)).toBe(true);
    await clickMediaItem(mediaTitle);
    expect(await $('#media-title').getText()).toBe(mediaTitle);
    expect(await $('#media-variant').getText()).toBe('Steam Edition');
    expect(await $('#default-activity-type').getValue()).toBe('Reading');
    expect(await $('#media-content-type').getValue()).toBe('Visual Novel');
    expect(await $('#media-description').getText()).toContain('Portable description, with punctuation.');
    expect(await getExtraField('Developer')).toBe('Round Trip Studio');
  });
});
