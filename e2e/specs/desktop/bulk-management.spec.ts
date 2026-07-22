import path from "node:path";
import { fileURLToPath } from "node:url";
import { waitForAppReady } from '../../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../../helpers/navigation.js';
import { resolveActivityConflicts, resolveConflicts } from '../../helpers/import.js';
import { isMediaVisible } from '../../helpers/library.js';
import {
    dismissAlert,
    getTopmostVisibleOverlay,
    setDialogMockPath,
    waitForOverlayToDisappear,
} from '../../helpers/common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '..', '..', 'fixtures');
const MEDIA_CSV = path.join(FIXTURES_DIR, 'bulk_media.csv');
const ACTIVITY_CSV = path.join(FIXTURES_DIR, 'bulk_activities.csv');
const ACTIVITY_CSV_INVALID_DATE = path.join(FIXTURES_DIR, 'bulk_activities_invalid_date.csv');
const ACTIVITY_CSV_CONFLICTING_TYPES = path.join(FIXTURES_DIR, 'bulk_activities_conflicting_types.csv');
const ACTIVITY_CSV_CONFLICT_BASELINE = path.join(FIXTURES_DIR, 'bulk_activities_conflict_baseline.csv');
const ACTIVITY_CSV_CONFLICTS = path.join(FIXTURES_DIR, 'bulk_activities_conflicts.csv');
const ACTIVITY_CSV_NEGATIVE = path.join(FIXTURES_DIR, 'bulk_activities_negative.csv');

describe('CUJ: Bulk Management (Data Import)', () => {
    before(async () => {
        await waitForAppReady();
    });

    it('should import media library and handle conflicts', async () => {
        await navigateTo('profile');
        expect(await verifyActiveView('profile')).toBe(true);

        await setDialogMockPath(MEDIA_CSV);
        const importMediaBtn = $('#profile-btn-import-media');
        await importMediaBtn.waitForClickable({ timeout: 5000 });
        await importMediaBtn.click();

        // Our bulk_media.csv contains "呪術廻戦" which exists, so conflict modal will show.
        await resolveConflicts('replace');

        await navigateTo('media');
        expect(await isMediaVisible('Bulk Imported Manga')).toBe(true);
        expect(await isMediaVisible('呪術廻戦')).toBe(true);
    });

    it('should cancel a conflicting media import without applying new rows', async () => {
        await navigateTo('profile');
        await setDialogMockPath(MEDIA_CSV);
        await $('#profile-btn-import-media').click();
        const overlay = await getTopmostVisibleOverlay('#conflict-cancel');
        await $('#conflict-cancel').waitForDisplayed({ timeout: 5000 });
        await $('#conflict-cancel').click();
        await waitForOverlayToDisappear(overlay);

        await navigateTo('media');
        // The title was imported by the previous CUJ. Cancellation must not duplicate it.
        expect(await $$(`.media-grid-item[data-title="Bulk Imported Manga"]`).length).toBe(1);
    });

    it('should keep existing media values when resolving a conflict with Keep Existing', async () => {
        await navigateTo('media');
        const existing = $(`.media-grid-item[data-title="呪術廻戦"]`);
        const existingText = await existing.getText();

        await navigateTo('profile');
        await setDialogMockPath(MEDIA_CSV);
        await $('#profile-btn-import-media').click();
        await resolveConflicts('keep', false);

        await navigateTo('media');
        expect(await $(`.media-grid-item[data-title="呪術廻戦"]`).getText()).toBe(existingText);
    });

    it('should import activity logs and reflect on dashboard', async () => {
        await navigateTo('profile');
        
        await setDialogMockPath(ACTIVITY_CSV);
        const importActivitiesBtn = $('#profile-btn-import-csv');
        await importActivitiesBtn.waitForClickable({ timeout: 5000 });
        await importActivitiesBtn.click();

        await dismissAlert();

        await navigateTo('dashboard');
        expect(await verifyActiveView('dashboard')).toBe(true);

        const recentLog = $(`.dashboard-activity-item[data-activity-title="Bulk Imported Manga"]`);
        await recentLog.waitForExist({ timeout: 5000 });
        const text = await recentLog.getText();
        expect(text).toContain('60 Minutes');
    });

    it('should resolve possible duplicate activities by content and preserve multiplicity', async () => {
        await navigateTo('profile');
        await setDialogMockPath(ACTIVITY_CSV_CONFLICT_BASELINE);
        await $('#profile-btn-import-csv').click();
        await dismissAlert('Successfully imported 1 activity logs!');

        await setDialogMockPath(ACTIVITY_CSV_CONFLICTS);
        await $('#profile-btn-import-csv').click();
        const conflict = $('.activity-csv-conflict');
        await conflict.waitForDisplayed({ timeout: 5000 });
        const conflictText = await conflict.getText();
        expect(conflictText).toContain('Activity Conflict E2E');
        expect(conflictText).toContain('1 matching activity already in the profile; 2 in this CSV');

        await resolveActivityConflicts(
            'skip_possible_overlaps',
            'Successfully imported 2 activity logs! Skipped 1 possible duplicate.',
        );

        await navigateTo('dashboard');
        expect(await verifyActiveView('dashboard')).toBe(true);
        const imported = $$(`.dashboard-activity-item[data-activity-title="Activity Conflict E2E"]`);
        expect(await imported.length).toBe(3);
    });

    it('should cancel duplicate activity review without applying any rows', async () => {
        await navigateTo('profile');
        await setDialogMockPath(ACTIVITY_CSV_CONFLICTS);
        await $('#profile-btn-import-csv').click();
        const overlay = await getTopmostVisibleOverlay('#activity-conflict-cancel');
        await $('#activity-conflict-cancel').click();
        await waitForOverlayToDisappear(overlay);

        await navigateTo('dashboard');
        const imported = $$(`.dashboard-activity-item[data-activity-title="Activity Conflict E2E"]`);
        expect(await imported.length).toBe(3);
    });

    it('should reject activity CSV import when a row has an invalid date format', async () => {
        await navigateTo('profile');

        await setDialogMockPath(ACTIVITY_CSV_INVALID_DATE);
        const importActivitiesBtn = $('#profile-btn-import-csv');
        await importActivitiesBtn.waitForClickable({ timeout: 5000 });
        await importActivitiesBtn.click();

        await dismissAlert("Import failed: Invalid date format on CSV row 3: '03/28/2024'. Expected YYYY/MM/DD or YYYY-MM-DD.");

        await navigateTo('dashboard');
        expect(await verifyActiveView('dashboard')).toBe(true);

        const validLookingRow = $(`.dashboard-activity-item[data-activity-title="Should Not Import - Valid Looking Row"]`);
        const invalidRow = $(`.dashboard-activity-item[data-activity-title="Should Not Import - Invalid Date Row"]`);
        expect(await validLookingRow.isExisting()).toBe(false);
        expect(await invalidRow.isExisting()).toBe(false);
    });

    it('should reject negative activity metrics before applying any CSV rows', async () => {
        await navigateTo('profile');
        await setDialogMockPath(ACTIVITY_CSV_NEGATIVE);
        await $('#profile-btn-import-csv').click();

        await dismissAlert('Import failed: Invalid activity CSV row 3: Activity duration cannot be negative');

        await navigateTo('dashboard');
        const validLookingRow = $(`.dashboard-activity-item[data-activity-title="Should Not Import - Valid Before Negative"]`);
        const negativeRow = $(`.dashboard-activity-item[data-activity-title="Should Not Import - Negative Duration"]`);
        expect(await validLookingRow.isExisting()).toBe(false);
        expect(await negativeRow.isExisting()).toBe(false);
    });

    it('should reject the entire activity CSV when default and legacy media types conflict', async () => {
        await navigateTo('profile');

        await setDialogMockPath(ACTIVITY_CSV_CONFLICTING_TYPES);
        const importActivitiesBtn = $('#profile-btn-import-csv');
        await importActivitiesBtn.waitForClickable({ timeout: 5000 });
        await importActivitiesBtn.click();

        await dismissAlert("Import failed: Conflicting Default Activity Type ('Reading') and Media Type ('Watching') in activity CSV row 3");

        await navigateTo('dashboard');
        expect(await verifyActiveView('dashboard')).toBe(true);

        const matchingRow = $(`.dashboard-activity-item[data-activity-title="Should Not Import - Matching Types"]`);
        const conflictingRow = $(`.dashboard-activity-item[data-activity-title="Should Not Import - Conflicting Types"]`);
        expect(await matchingRow.isExisting()).toBe(false);
        expect(await conflictingRow.isExisting()).toBe(false);
    });
});
