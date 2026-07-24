import { beforeEach, describe, expect, it, vi } from 'vitest';
import { applyDatabaseRecovery } from '../src/api';
import { renderDatabaseRecoveryScreen } from '../src/database_recovery';
import { customConfirm } from '../src/modal_base';
import type { DatabaseRecoveryPlan } from '../src/types';

const closeWindow = vi.fn();
const reload = vi.fn();

vi.mock('../src/api', () => ({
    applyDatabaseRecovery: vi.fn(),
}));

vi.mock('../src/modal_base', () => ({
    customConfirm: vi.fn(),
}));

vi.mock('../src/services', () => ({
    getServices: () => ({ closeWindow }),
}));

const plan: DatabaseRecoveryPlan = {
    session_token: 'recovery-session',
    issues: [{
        kind: 'orphaned_milestone_groups',
        groups: [{
            group_token: 'group-ss',
            media_title: 'SS',
            milestones: [
                {
                    id: 2,
                    name: 'First story',
                    duration: 30,
                    characters: 1200,
                    date: '2026-04-01',
                },
                {
                    id: 3,
                    name: 'Second story',
                    duration: 0,
                    characters: 2500,
                },
            ],
        }],
    }],
    media: [
        {
            uid: 'uid-manga',
            title: 'Shared title',
            variant: 'Manga',
            status: 'Active',
            tracking_status: 'Ongoing',
        },
        {
            uid: 'uid-anime',
            title: 'Shared title',
            variant: 'Anime',
            status: 'Archived',
            tracking_status: 'Complete',
        },
        {
            uid: 'uid-blank',
            title: 'No variant title',
            variant: '',
            status: 'Active',
            tracking_status: 'Ongoing',
        },
    ],
};

describe('database recovery screen', () => {
    beforeEach(() => {
        document.body.innerHTML = '<div id="app"></div>';
        vi.clearAllMocks();
        vi.stubGlobal('location', { reload });
        vi.mocked(applyDatabaseRecovery).mockResolvedValue({
            safety_backup_path: '/kechimochi/pre_recovery.zip',
        });
        vi.mocked(customConfirm).mockResolvedValue(true);
        localStorage.clear();
        localStorage.setItem('theme', 'pastel-pink');
    });

    it('groups milestones by missing title and shows searchable variant-aware media choices', () => {
        renderDatabaseRecoveryScreen(plan);

        expect(document.querySelectorAll('.database-recovery-group')).toHaveLength(1);
        expect(document.body.textContent).toContain('SS');
        expect(document.body.textContent).toContain('First story');
        expect(document.body.textContent).toContain('Second story');

        document.querySelector<HTMLInputElement>('input[value="attach"]')!.click();
        const input = document.querySelector<HTMLInputElement>('.database-recovery-media-input')!;
        input.focus();

        const optionText = [...document.querySelectorAll('.database-recovery-media-option')]
            .map(option => option.textContent);
        expect(optionText.some(text => text?.includes('Manga'))).toBe(true);
        expect(optionText.some(text => text?.includes('Anime'))).toBe(true);
        expect(optionText.some(text => text?.includes('(no variant)'))).toBe(true);

        input.value = 'anime';
        input.dispatchEvent(new Event('input'));
        const filteredOptions = document.querySelectorAll('.database-recovery-media-option');
        expect(filteredOptions).toHaveLength(1);
        expect(filteredOptions[0].textContent).toContain('Anime');
    });

    it('attaches a whole group to the selected media UID', async () => {
        renderDatabaseRecoveryScreen(plan);
        document.querySelector<HTMLInputElement>('input[value="attach"]')!.click();
        const input = document.querySelector<HTMLInputElement>('.database-recovery-media-input')!;
        input.focus();
        document.querySelector<HTMLElement>('[data-media-uid="uid-anime"]')!.click();
        document.querySelector<HTMLButtonElement>('#database-recovery-apply')!.click();

        await vi.waitFor(() => expect(applyDatabaseRecovery).toHaveBeenCalledWith({
            session_token: 'recovery-session',
            resolutions: [{
                kind: 'attach_milestone_group',
                group_token: 'group-ss',
                media_uid: 'uid-anime',
            }],
            local_storage: JSON.stringify({ theme: 'pastel-pink' }),
        }));
        expect(reload).toHaveBeenCalled();
    });

    it('supports creating a titled media entry or explicitly discarding the whole group', async () => {
        renderDatabaseRecoveryScreen(plan);
        document.querySelector<HTMLInputElement>('input[value="create"]')!.click();
        document.querySelector<HTMLInputElement>('.database-recovery-variant-input')!.value =
            'Recovered stories';
        document.querySelector<HTMLButtonElement>('#database-recovery-apply')!.click();

        await vi.waitFor(() => expect(applyDatabaseRecovery).toHaveBeenCalledWith(
            expect.objectContaining({
                resolutions: [{
                    kind: 'create_media_for_milestone_group',
                    group_token: 'group-ss',
                    variant: 'Recovered stories',
                }],
            }),
        ));

        vi.mocked(applyDatabaseRecovery).mockClear();
        reload.mockClear();
        renderDatabaseRecoveryScreen(plan);
        document.querySelector<HTMLInputElement>('input[value="discard"]')!.click();
        document.querySelector<HTMLButtonElement>('#database-recovery-apply')!.click();

        await vi.waitFor(() => expect(customConfirm).toHaveBeenCalledWith(
            'Discard milestones?',
            expect.stringContaining('2 milestones'),
            'btn-danger',
            'Discard and Continue',
        ));
        await vi.waitFor(() => expect(applyDatabaseRecovery).toHaveBeenCalledWith(
            expect.objectContaining({
                resolutions: [{
                    kind: 'discard_milestone_group',
                    group_token: 'group-ss',
                }],
            }),
        ));
    });

    it('restores staged backup local storage after recovery succeeds', async () => {
        vi.mocked(applyDatabaseRecovery).mockResolvedValue({
            safety_backup_path: '/kechimochi/pre_recovery.zip',
            local_storage: JSON.stringify({ theme: 'restored-theme', restored: 'yes' }),
        });
        renderDatabaseRecoveryScreen(plan);
        document.querySelector<HTMLInputElement>('input[value="attach"]')!.click();
        const input = document.querySelector<HTMLInputElement>('.database-recovery-media-input')!;
        input.focus();
        document.querySelector<HTMLElement>('[data-media-uid="uid-anime"]')!.click();
        document.querySelector<HTMLButtonElement>('#database-recovery-apply')!.click();

        await vi.waitFor(() => expect(localStorage.getItem('restored')).toBe('yes'));
        expect(localStorage.getItem('theme')).toBe('restored-theme');
        expect(reload).toHaveBeenCalled();
    });
});
