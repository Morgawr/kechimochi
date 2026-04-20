import path from "node:path";
import { fileURLToPath } from "node:url";
import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { resolveConflicts } from '../helpers/import.js';
import { isMediaVisible } from '../helpers/library.js';
import { dismissAlert, setDialogMockPath } from '../helpers/common.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');
const MEDIA_CSV = path.join(FIXTURES_DIR, 'bulk_media.csv');
const ACTIVITY_CSV = path.join(FIXTURES_DIR, 'bulk_activities.csv');

describe('CUJ: Bulk Management (Data Import)', () => {
    beforeAll(async () => {
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
});
