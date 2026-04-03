import fs from 'node:fs';
import path from 'node:path';
import { waitForAppReady } from '../helpers/setup.js';
import { navigateTo, verifyActiveView } from '../helpers/navigation.js';
import { confirmAction, dismissAlert, safeClick } from '../helpers/common.js';
import { openCloudSyncCard, waitForSyncCardText } from '../helpers/sync.js';

describe('Local Sync Backup Management', () => {
    const dataDir = process.env.KECHIMOCHI_DATA_DIR!;
    const syncDir = path.join(dataDir, 'sync');

    before(async () => {
        // Prepare sync directory and mock config before app is ready or during early startup
        if (!fs.existsSync(syncDir)) {
            fs.mkdirSync(syncDir, { recursive: true });
        }

        // Mock a connected sync config so the tile shows up
        const configPath = path.join(syncDir, 'sync_config.json');
        const config = {
            sync_profile_id: 'prof_e2e_test',
            profile_name: 'E2E Test Profile',
            google_account_email: 'test@example.com',
            remote_manifest_name: 'kechimochi-manifest-prof_e2e_test.json',
            last_sync_status: 'clean',
            device_name: 'E2E Device'
        };
        fs.writeFileSync(configPath, JSON.stringify(config));

        // Create dummy backups: 1.0 MB + 1.0 MB = 2.0 MB
        fs.writeFileSync(path.join(syncDir, 'pre_sync_backup_1.zip'), Buffer.alloc(1024 * 1024));
        fs.writeFileSync(path.join(syncDir, 'pre_sync_backup_2.zip'), Buffer.alloc(1024 * 1024));
        fs.writeFileSync(path.join(syncDir, 'important_data.txt'), 'do not touch');

        await waitForAppReady();
    });

    it('should display the correct backup size in the profile page', async () => {
        await navigateTo('profile');
        expect(await verifyActiveView('profile')).toBe(true);

        await openCloudSyncCard();
        await waitForSyncCardText('Local backups size', 30000);
        await waitForSyncCardText('2 MB', 30000);

        const backupLabel = await $('span=Local backups size');
        const parent = await backupLabel.parentElement();
        const sizeValue = await parent.$('strong');
        expect(await sizeValue.getText()).toBe('2 MB');
    });

    it('should clear the backups when clicking the clear button', async () => {
        await safeClick('#profile-btn-clear-sync-backups');

        // Handle confirmation dialog
        await confirmAction(true);

        // Handle success alert
        await dismissAlert('Sync backups cleared.');

        // Verify UI updates to 0 Bytes
        await waitForSyncCardText('0 Bytes', 15000);
        
        const backupLabel = await $('span=Local backups size');
        const parent = await backupLabel.parentElement();
        const sizeValue = await parent.$('strong');
        expect(await sizeValue.getText()).toBe('0 Bytes');
        
        // Button should be gone
        const clearBtnExists = await browser.execute(() => {
            return document.querySelector('#profile-btn-clear-sync-backups') !== null;
        });
        expect(clearBtnExists).toBe(false);
    });

    it('should have removed the backup files from disk but kept unrelated files', async () => {
        expect(fs.existsSync(path.join(syncDir, 'pre_sync_backup_1.zip'))).toBe(false);
        expect(fs.existsSync(path.join(syncDir, 'pre_sync_backup_2.zip'))).toBe(false);
        expect(fs.existsSync(path.join(syncDir, 'important_data.txt'))).toBe(true);
    });
});
