import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MediaLog } from '../../../src/components/media/MediaLog';
import * as api from '../../../src/api';
import { showLogActivityModal } from '../../../src/modals/activity';
import { customConfirm } from '../../../src/modals/base';

vi.mock('../../../src/api', () => ({
    deleteLog: vi.fn(),
}));

vi.mock('../../../src/modals/activity', () => ({
    showLogActivityModal: vi.fn(),
}));

vi.mock('../../../src/modals/base', () => ({
    customConfirm: vi.fn(),
}));

describe('MediaLog', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        vi.clearAllMocks();
    });

    it('renders an empty state when there are no logs', () => {
        new MediaLog(container, []).render();
        expect(container.textContent).toContain('No activity logs found for this media.');
    });

    it('renders duration, characters, and dispatches activity-updated after edit success', async () => {
        const dispatchSpy = vi.fn();
        container.addEventListener('activity-updated', dispatchSpy);
        vi.mocked(showLogActivityModal).mockResolvedValue(true);

        const logs = [{
            id: 1,
            title: 'Test Media',
            media_id: 1,
            media_type: 'Reading',
            language: 'Japanese',
            date: '2024-03-01',
            duration_minutes: 30,
            characters: 1200,
        }] as unknown as api.ActivitySummary[];

        new MediaLog(container, logs).render();

        expect(container.textContent).toContain('30 Minutes');
        expect(container.textContent).toContain('1,200 chars');
        expect(container.textContent).toContain('|');

        (container.querySelector('.edit-log-btn') as HTMLButtonElement).click();

        await vi.waitFor(() => {
            expect(showLogActivityModal).toHaveBeenCalledWith('Test Media', logs[0]);
            expect(dispatchSpy).toHaveBeenCalled();
        });
    });

    it('deletes a log after confirmation and dispatches activity-updated', async () => {
        const dispatchSpy = vi.fn();
        container.addEventListener('activity-updated', dispatchSpy);
        vi.mocked(customConfirm).mockResolvedValue(true);

        const logs = [{
            id: 5,
            title: 'Delete Me',
            media_id: 1,
            media_type: 'Reading',
            language: 'Japanese',
            date: '2024-03-01',
            duration_minutes: 0,
            characters: 0,
        }] as unknown as api.ActivitySummary[];

        new MediaLog(container, logs).render();
        (container.querySelector('.delete-log-btn') as HTMLButtonElement).click();

        await vi.waitFor(() => {
            expect(customConfirm).toHaveBeenCalled();
            expect(api.deleteLog).toHaveBeenCalledWith(5);
            expect(dispatchSpy).toHaveBeenCalled();
        });
    });

    it('does not delete a log when confirmation is cancelled', async () => {
        vi.mocked(customConfirm).mockResolvedValue(false);

        const logs = [{
            id: 7,
            title: 'Keep Me',
            media_id: 1,
            media_type: 'Reading',
            language: 'Japanese',
            date: '2024-03-01',
            duration_minutes: 12,
            characters: 0,
        }] as unknown as api.ActivitySummary[];

        new MediaLog(container, logs).render();
        (container.querySelector('.delete-log-btn') as HTMLButtonElement).click();

        await vi.waitFor(() => expect(customConfirm).toHaveBeenCalled());
        expect(api.deleteLog).not.toHaveBeenCalled();
    });
});
