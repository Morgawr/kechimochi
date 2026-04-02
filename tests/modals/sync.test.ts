import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    showSyncAttachPreview,
    showSyncEnablementWizard,
} from '../../src/modals/sync';

describe('modals/sync.ts', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.runAllTimers();
    });

    it('resolves create_new when no remote profiles exist', async () => {
        const promise = showSyncEnablementWizard([], 'sync@example.com');

        expect(document.body.textContent).toContain('sync@example.com');
        expect(document.body.textContent).toContain('No existing sync profiles were found');
        expect(document.querySelector('#sync-enable-attach')).toBeNull();

        (document.querySelector('#sync-enable-create') as HTMLButtonElement).click();

        await expect(promise).resolves.toEqual({ action: 'create_new' });
    });

    it('resolves the selected profile when attaching to an existing sync profile', async () => {
        const promise = showSyncEnablementWizard([
            {
                profile_id: 'prof_1',
                profile_name: 'Laptop',
                snapshot_id: 'snap_1',
                remote_generation: 1,
                updated_at: 'not-a-date',
                last_writer_device_id: 'dev_1',
            },
            {
                profile_id: 'prof_2',
                profile_name: 'Desktop',
                snapshot_id: 'snap_2',
                remote_generation: 2,
                updated_at: '2026-04-02T12:00:00Z',
                last_writer_device_id: 'dev_2',
            },
        ]);

        const attachButton = document.querySelector('#sync-enable-attach') as HTMLButtonElement;
        const radios = Array.from(document.querySelectorAll<HTMLInputElement>('input[name="sync-profile-choice"]'));

        expect(radios).toHaveLength(2);
        expect(document.body.textContent).toContain('not-a-date');
        expect(attachButton.disabled).toBe(false);

        radios[1].checked = true;
        radios[1].dispatchEvent(new Event('change'));
        attachButton.click();

        await expect(promise).resolves.toEqual({ action: 'attach', profileId: 'prof_2' });
    });

    it('resolves null when the enablement wizard is cancelled', async () => {
        const promise = showSyncEnablementWizard([
            {
                profile_id: 'prof_1',
                profile_name: 'Laptop',
                snapshot_id: 'snap_1',
                remote_generation: 1,
                updated_at: '2026-04-02T12:00:00Z',
                last_writer_device_id: 'dev_1',
            },
        ]);

        (document.querySelector('#sync-enable-cancel') as HTMLButtonElement).click();

        await expect(promise).resolves.toBeNull();
    });

    it('shows attach preview warnings and resolves false on cancel', async () => {
        const promise = showSyncAttachPreview({
            profile_id: 'prof_1',
            profile_name: 'Desktop',
            local_only_media_count: 1,
            remote_only_media_count: 2,
            matched_media_count: 3,
            potential_duplicate_titles: ['Foo', 'Bar'],
            conflict_count: 2,
        });

        expect(document.body.textContent).toContain('Potential duplicate titles');
        expect(document.body.textContent).toContain('Attach and Review');
        expect(document.body.textContent).toContain('land in conflict review');
        expect(document.body.textContent).toContain('Counts compare media by sync UID');
        expect(document.body.textContent).toContain('Only on this device');
        expect(document.body.textContent).toContain('Only in cloud');

        (document.querySelector('#sync-attach-cancel') as HTMLButtonElement).click();

        await expect(promise).resolves.toBe(false);
    });

    it('resolves true when attach preview is confirmed without warnings', async () => {
        const promise = showSyncAttachPreview({
            profile_id: 'prof_1',
            profile_name: 'Desktop',
            local_only_media_count: 0,
            remote_only_media_count: 0,
            matched_media_count: 5,
            potential_duplicate_titles: [],
            conflict_count: 0,
        });

        expect(document.body.textContent).toContain('Attach Profile');
        expect(document.body.textContent).not.toContain('Potential duplicate titles');
        expect(document.body.textContent).toContain('5 media entries already line up');
        expect(document.body.textContent).not.toContain('Only on this device');
        expect(document.body.textContent).not.toContain('Only in cloud');
        expect(document.body.textContent).not.toContain('Conflicts to review');

        (document.querySelector('#sync-attach-confirm') as HTMLButtonElement).click();

        await expect(promise).resolves.toBe(true);
    });
});
