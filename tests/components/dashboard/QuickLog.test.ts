import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickLog } from '../../../src/components/dashboard/QuickLog';
import type { ActivitySummary, Media } from '../../../src/api';

vi.mock('../../../src/modals', () => ({
    showLogActivityModal: vi.fn(),
}));

vi.mock('../../../src/components/media/cover_loader', () => ({
    MediaCoverLoader: {
        load: vi.fn().mockResolvedValue(null),
    }
}));

import { showLogActivityModal } from '../../../src/modals';

describe('QuickLog', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.innerHTML = '';
        document.body.appendChild(container);
        vi.clearAllMocks();
    });

    it('sorts unfinished media first, then by latest log date', () => {
        const mediaList: Media[] = [
            { id: 1, title: 'Complete Recent', media_type: 'Reading', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Manga', tracking_status: 'Complete' },
            { id: 2, title: 'Ongoing Older', media_type: 'Reading', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Novel', tracking_status: 'Ongoing' },
            { id: 3, title: 'Ongoing Recent', media_type: 'Watching', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Anime', tracking_status: 'Ongoing' },
            { id: 4, title: 'Archived Item', media_type: 'Reading', status: 'Archived', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Manga', tracking_status: 'Ongoing' },
        ];
        const logs: ActivitySummary[] = [
            { id: 10, media_id: 2, title: 'Ongoing Older', media_type: 'Reading', duration_minutes: 20, characters: 0, date: '2026-04-01', language: 'Japanese' },
            { id: 15, media_id: 1, title: 'Complete Recent', media_type: 'Reading', duration_minutes: 15, characters: 0, date: '2026-04-02', language: 'Japanese' },
            { id: 21, media_id: 3, title: 'Ongoing Recent', media_type: 'Watching', duration_minutes: 30, characters: 0, date: '2026-04-03', language: 'Japanese' },
        ];

        const component = new QuickLog(container, { logs, mediaList }, { onLogged: vi.fn().mockResolvedValue(undefined) });
        component.render();

        const titles = Array.from(container.querySelectorAll('.quick-log-item')).map(node => node.textContent || '');
        expect(titles[0]).toContain('Ongoing Recent');
        expect(titles[1]).toContain('Ongoing Older');
        expect(titles[2]).toContain('Complete Recent');
        expect(titles.some(text => text.includes('Archived Item'))).toBe(false);
    });

    it('prefers a newer log date over a larger log id', () => {
        const mediaList: Media[] = [
            { id: 10, title: 'Older Date Newer Id', media_type: 'Reading', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Manga', tracking_status: 'Ongoing' },
            { id: 11, title: 'Newer Date Older Id', media_type: 'Watching', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Anime', tracking_status: 'Ongoing' },
        ];
        const logs: ActivitySummary[] = [
            { id: 55, media_id: 10, title: 'Older Date Newer Id', media_type: 'Reading', duration_minutes: 20, characters: 0, date: '2026-04-10', language: 'Japanese' },
            { id: 12, media_id: 11, title: 'Newer Date Older Id', media_type: 'Watching', duration_minutes: 20, characters: 0, date: '2026-04-11', language: 'Japanese' },
        ];

        const component = new QuickLog(container, { logs, mediaList }, { onLogged: vi.fn().mockResolvedValue(undefined) });
        component.render();

        const titles = Array.from(container.querySelectorAll('.quick-log-item')).map(node => node.textContent || '');
        expect(titles[0]).toContain('Newer Date Older Id');
    });

    it('opens the activity modal for the clicked media and refreshes after success', async () => {
        vi.mocked(showLogActivityModal).mockResolvedValue(true);
        const onLogged = vi.fn().mockResolvedValue(undefined);
        const mediaList: Media[] = [
            { id: 7, title: 'Blue Box', media_type: 'Reading', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Manga', tracking_status: 'Ongoing' },
        ];

        const component = new QuickLog(container, { logs: [], mediaList }, { onLogged });
        component.render();

        (container.querySelector('.quick-log-item') as HTMLElement).click();

        await vi.waitFor(() => {
            expect(showLogActivityModal).toHaveBeenCalledWith('Blue Box');
            expect(onLogged).toHaveBeenCalled();
        });
    });
});
