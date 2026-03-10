import path from 'path';
import { fileURLToPath } from 'url';
import { waitForAppReady } from '../helpers/setup.js';
import { 
    navigateTo, 
    verifyActiveView, 
    resolveConflicts, 
    isMediaVisible,
    dismissAlert
} from '../helpers/interactions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');
const MEDIA_CSV = path.join(FIXTURES_DIR, 'bulk_media.csv');
const ACTIVITY_CSV = path.join(FIXTURES_DIR, 'bulk_activities.csv');

describe('CUJ: Bulk Management (Data Import)', () => {
    before(async () => {
        await waitForAppReady();
    });

    // Reusable helper to set the mock open path
    async function setMockOpenPath(filePath: string) {
        await browser.execute((p) => {
            (window as any).mockOpenPath = p;
        }, filePath);
    }

    it('should import media library and handle conflicts', async () => {
        // 1) Open the app and navigate to "Profile"
        await navigateTo('profile');
        expect(await verifyActiveView('profile')).toBe(true);

        // 2) Locate the "Data Management" card & 3) Click "Import Media Library (CSV)"
        await setMockOpenPath(MEDIA_CSV);
        const importMediaBtn = await $('#profile-btn-import-media');
        await importMediaBtn.click();

        // 4) Select a valid media CSV file (handled by mock)
        // 5) In the merge modal, review any conflicts and select "Merge All" (Replace)
        // Our bulk_media.csv contains "呪術廻戦" which exists, so conflict modal will show.
        await resolveConflicts('replace');

        // 6) Navigate to the "Library" tab and verify the new media entries are present
        await navigateTo('media');
        expect(await isMediaVisible('Bulk Imported Manga')).toBe(true);
        expect(await isMediaVisible('呪術廻戦')).toBe(true);
    });

    it('should import activity logs and reflect on dashboard', async () => {
        // 7) Return to the "Profile" tab and click "Import Activities (CSV)"
        await navigateTo('profile');
        
        await setMockOpenPath(ACTIVITY_CSV);
        const importActivitiesBtn = await $('#profile-btn-import-csv');
        await importActivitiesBtn.click();

        // Success alert should appear
        await $('#alert-ok').waitForDisplayed({ timeout: 5000 });
        await dismissAlert();

        // 8) Navigate to the "Dashboard" and verify data reflects imported activities
        await navigateTo('dashboard');
        expect(await verifyActiveView('dashboard')).toBe(true);

        const recentLogs = await $('#recent-logs-list');
        const text = await recentLogs.getText();
        expect(text).toContain('Bulk Imported Manga');
        expect(text).toContain('60 minutes');
    });
});
