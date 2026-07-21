import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo } from '../../helpers/navigation.js';
import { addMedia, clickMediaItem, isMediaNotVisible, isMediaVisible } from '../../helpers/library.js';
import {
  addExtraField,
  backToGrid,
  editDescription,
  getExtraField,
  logActivityFromDetail,
} from '../../helpers/media-detail.js';
import {
  closeModal,
  confirmAction,
  dismissAlert,
  getTopmostVisibleOverlay,
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
  const exactVariantActivityCsv = path.join(stageDirectory, `activity-exact-variants-${Date.now()}.csv`);
  const mixedActivityCsv = path.join(stageDirectory, `activity-mixed-types-${Date.now()}.csv`);
  const ambiguousActivityCsv = path.join(stageDirectory, `activity-ambiguous-title-${Date.now()}.csv`);
  const conflictingDefaultsCsv = path.join(stageDirectory, `activity-conflicting-defaults-${Date.now()}.csv`);
  const identifierActivityCsv = path.join(stageDirectory, `activity-forbidden-id-${Date.now()}.csv`);

  before(async () => {
    await waitForAppReady();
  });

  after(() => {
    if (!process.env.SPEC_STAGE_DIR) {
      for (const file of [
        activityCsv,
        mediaCsv,
        exactVariantActivityCsv,
        mixedActivityCsv,
        ambiguousActivityCsv,
        conflictingDefaultsCsv,
        identifierActivityCsv,
      ]) {
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
    expect(Object.keys(record || {})).toEqual([
      'Date',
      'Log Name',
      'Default Activity Type',
      'Duration',
      'Language',
      'Characters',
      'Activity Type',
      'Notes',
      'Media Variant',
    ]);
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

  it('imports different per-log activity types into one unambiguous legacy-title media', async () => {
    const title = 'CSV Mixed Per-Log Types';
    fs.writeFileSync(
      mixedActivityCsv,
      [
        'Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type,Notes',
        `2026-07-20,${title},Reading,17,Japanese,100,Reading,First type`,
        `2026-07-21,${title},Reading,23,Japanese,0,Watching,Second type`,
      ].join('\n'),
      'utf8',
    );

    await navigateTo('profile');
    await setDialogMockPath(mixedActivityCsv);
    await safeClick('#profile-btn-import-csv');
    await dismissAlert('Successfully imported 2 activity logs', 15_000);

    await navigateTo('dashboard');
    const activities = $$(`.dashboard-activity-item[data-activity-title="${title}"]`);
    expect(await activities.length).toBe(2);
    const activityText = await activities.map(activity => activity.getText());
    expect(activityText.some(text => text.includes('of Reading'))).toBe(true);
    expect(activityText.some(text => text.includes('of Watching'))).toBe(true);

    await navigateTo('media');
    expect(await $$(`.media-grid-item[data-title="${title}"]`).length).toBe(1);
    await clickMediaItem(title);
    expect(await $$('.media-detail-log-item').length).toBe(2);
  });

  it('routes activity CSV rows to exact same-title variants without using activity type as identity', async () => {
    const title = 'CSV Exact Same-Title Variants';
    await navigateTo('media');
    await addMedia(title, 'Watching', 'Anime', 'Anime');
    await backToGrid();
    await addMedia(title, 'Reading', 'Manga', 'Manga');

    fs.writeFileSync(
      exactVariantActivityCsv,
      [
        'Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type,Notes,Media Variant',
        `2026-07-20,${title},Watching,7,Japanese,0,Listening,Anime row,Anime`,
        `2026-07-21,${title},Reading,13,Japanese,1200,Playing,Manga row,Manga`,
      ].join('\n'),
      'utf8',
    );

    await navigateTo('profile');
    await setDialogMockPath(exactVariantActivityCsv);
    await safeClick('#profile-btn-import-csv');
    await dismissAlert('Successfully imported 2 activity logs', 15_000);

    await navigateTo('media');
    await clickMediaItem(title, 'Anime');
    expect(await $$('.media-detail-log-item').length).toBe(1);
    expect(await $('.media-detail-log-item').getAttribute('data-duration-minutes')).toBe('7');
    expect(await $('#media-logs-container').getText()).toContain('Anime row');
    await $('.media-detail-log-item .edit-log-btn').click();
    let editOverlay = await getTopmostVisibleOverlay('#add-activity-form');
    expect(await editOverlay.$('#activity-type').getValue()).toBe('Listening');
    await closeModal('#activity-cancel');

    await backToGrid();
    await clickMediaItem(title, 'Manga');
    expect(await $$('.media-detail-log-item').length).toBe(1);
    expect(await $('.media-detail-log-item').getAttribute('data-duration-minutes')).toBe('13');
    expect(await $('#media-logs-container').getText()).toContain('Manga row');
    await $('.media-detail-log-item .edit-log-btn').click();
    editOverlay = await getTopmostVisibleOverlay('#add-activity-form');
    expect(await editOverlay.$('#activity-type').getValue()).toBe('Playing');
    await closeModal('#activity-cancel');
  });

  it('rejects ambiguous legacy titles and conflicting new-media defaults atomically', async () => {
    const ambiguousTitle = 'CSV Ambiguous Legacy Title';
    const conflictingTitle = 'CSV Conflicting Defaults';
    const forbiddenIdentifierTitle = 'CSV Forbidden Identifier';

    await navigateTo('media');
    await addMedia(ambiguousTitle, 'Watching', 'Anime', 'Anime');
    await backToGrid();
    await addMedia(ambiguousTitle, 'Reading', 'Manga', 'Manga');

    fs.writeFileSync(
      ambiguousActivityCsv,
      [
        'Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type',
        `2026-07-21,${ambiguousTitle},Reading,15,Japanese,0,Reading`,
      ].join('\n'),
      'utf8',
    );
    await navigateTo('profile');
    await setDialogMockPath(ambiguousActivityCsv);
    await safeClick('#profile-btn-import-csv');
    await dismissAlert('Ambiguous activity CSV row 2', 15_000);

    fs.writeFileSync(
      conflictingDefaultsCsv,
      [
        'Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type',
        `2026-07-20,${conflictingTitle},Reading,10,Japanese,0,Reading`,
        `2026-07-21,${conflictingTitle},Watching,20,Japanese,0,Watching`,
      ].join('\n'),
      'utf8',
    );
    await setDialogMockPath(conflictingDefaultsCsv);
    await safeClick('#profile-btn-import-csv');
    await dismissAlert('Conflicting Default Activity Type values for new media', 15_000);

    fs.writeFileSync(
      identifierActivityCsv,
      [
        'Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type,Media UID',
        `2026-07-21,${forbiddenIdentifierTitle},Reading,20,Japanese,0,Reading,private-uid`,
      ].join('\n'),
      'utf8',
    );
    await setDialogMockPath(identifierActivityCsv);
    await safeClick('#profile-btn-import-csv');
    await dismissAlert("Unsupported 'Media UID' column", 15_000);

    await navigateTo('dashboard');
    expect(await $$(`.dashboard-activity-item[data-activity-title="${ambiguousTitle}"]`).length).toBe(0);
    expect(await $$(`.dashboard-activity-item[data-activity-title="${conflictingTitle}"]`).length).toBe(0);
    expect(await $$(`.dashboard-activity-item[data-activity-title="${forbiddenIdentifierTitle}"]`).length).toBe(0);
    await navigateTo('media');
    expect(await isMediaNotVisible(conflictingTitle)).toBe(true);
    expect(await isMediaNotVisible(forbiddenIdentifierTitle)).toBe(true);
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
    expect(Object.keys(record || {})).toEqual([
      'Title',
      'Default Activity Type',
      'Status',
      'Language',
      'Description',
      'Content Type',
      'Extra Data',
      'Cover Image (Base64)',
      'Variant',
    ]);
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
