import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickLog } from '../../../src/dashboard/QuickLog';
import type { ActivitySummary, Media } from '../../../src/api';
import { EVENTS } from '../../../src/constants';
import { Logger } from '../../../src/logger';

vi.mock('../../../src/activity_modal', () => ({
    showLogActivityModal: vi.fn(),
}));

vi.mock('../../../src/media/cover_loader', () => ({
    MediaCoverLoader: {
        load: vi.fn().mockResolvedValue(null),
    }
}));

import { showLogActivityModal } from '../../../src/activity_modal';
import { MediaCoverLoader } from '../../../src/media/cover_loader';

function makeMedia(overrides: Partial<Media> = {}): Media {
    return {
        id: 1,
        title: 'Test Media',
        default_activity_type: 'Reading',
        status: 'Active',
        language: 'Japanese',
        description: '',
        cover_image: '',
        extra_data: '{}',
        content_type: 'Novel',
        tracking_status: 'Ongoing',
        ...overrides,
    };
}

describe('QuickLog', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.innerHTML = '';
        document.body.appendChild(container);
        document.body.dataset.runtime = 'desktop';
        vi.clearAllMocks();
        vi.mocked(showLogActivityModal).mockResolvedValue(false);
        vi.mocked(MediaCoverLoader.load).mockResolvedValue(null);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('shows an empty state when there is no loggable media', () => {
        const component = new QuickLog(container, { logs: [], mediaList: [] }, { onLogged: vi.fn() });

        component.render();

        expect(container.querySelector('#quick-log-list')?.textContent).toContain('No loggable media yet.');
        expect(container.querySelector('.quick-log-item')).toBeNull();
    });

    it('sorts unfinished media first, then by latest log date', () => {
        const mediaList: Media[] = [
            { id: 1, title: 'Complete Recent', default_activity_type: 'Reading', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Manga', tracking_status: 'Complete' },
            { id: 2, title: 'Ongoing Older', default_activity_type: 'Reading', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Novel', tracking_status: 'Ongoing' },
            { id: 3, title: 'Ongoing Recent', default_activity_type: 'Watching', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Anime', tracking_status: 'Ongoing' },
            { id: 4, title: 'Archived Item', default_activity_type: 'Reading', status: 'Archived', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Manga', tracking_status: 'Ongoing' },
        ];
        const logs: ActivitySummary[] = [
            { id: 10, media_id: 2, title: 'Ongoing Older', activity_type: 'Reading', duration_minutes: 20, characters: 0, date: '2026-04-01', language: 'Japanese' },
            { id: 15, media_id: 1, title: 'Complete Recent', activity_type: 'Reading', duration_minutes: 15, characters: 0, date: '2026-04-02', language: 'Japanese' },
            { id: 21, media_id: 3, title: 'Ongoing Recent', activity_type: 'Watching', duration_minutes: 30, characters: 0, date: '2026-04-03', language: 'Japanese' },
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
            { id: 10, title: 'Older Date Newer Id', default_activity_type: 'Reading', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Manga', tracking_status: 'Ongoing' },
            { id: 11, title: 'Newer Date Older Id', default_activity_type: 'Watching', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Anime', tracking_status: 'Ongoing' },
        ];
        const logs: ActivitySummary[] = [
            { id: 55, media_id: 10, title: 'Older Date Newer Id', activity_type: 'Reading', duration_minutes: 20, characters: 0, date: '2026-04-10', language: 'Japanese' },
            { id: 12, media_id: 11, title: 'Newer Date Older Id', activity_type: 'Watching', duration_minutes: 20, characters: 0, date: '2026-04-11', language: 'Japanese' },
        ];

        const component = new QuickLog(container, { logs, mediaList }, { onLogged: vi.fn().mockResolvedValue(undefined) });
        component.render();

        const titles = Array.from(container.querySelectorAll('.quick-log-item')).map(node => node.textContent || '');
        expect(titles[0]).toContain('Newer Date Older Id');
    });

    it('uses latest log id as tiebreaker when two media share the same latest date', () => {
        const mediaList: Media[] = [
            { id: 1, title: 'Top 1', default_activity_type: 'Reading', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Manga', tracking_status: 'Ongoing' },
            { id: 2, title: 'Top 2', default_activity_type: 'Reading', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Manga', tracking_status: 'Ongoing' },
            { id: 3, title: 'Top 3', default_activity_type: 'Reading', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Manga', tracking_status: 'Ongoing' },
            { id: 4, title: 'Top 4', default_activity_type: 'Reading', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Manga', tracking_status: 'Ongoing' },
            { id: 5, title: 'Same Day Higher Id', default_activity_type: 'Reading', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Manga', tracking_status: 'Ongoing' },
            { id: 6, title: 'Same Day Lower Id', default_activity_type: 'Reading', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Manga', tracking_status: 'Ongoing' },
        ];
        const logs: ActivitySummary[] = [
            { id: 101, media_id: 1, title: 'Top 1', activity_type: 'Reading', duration_minutes: 10, characters: 0, date: '2026-04-20', language: 'Japanese' },
            { id: 102, media_id: 2, title: 'Top 2', activity_type: 'Reading', duration_minutes: 10, characters: 0, date: '2026-04-19', language: 'Japanese' },
            { id: 103, media_id: 3, title: 'Top 3', activity_type: 'Reading', duration_minutes: 10, characters: 0, date: '2026-04-18', language: 'Japanese' },
            { id: 104, media_id: 4, title: 'Top 4', activity_type: 'Reading', duration_minutes: 10, characters: 0, date: '2026-04-17', language: 'Japanese' },
            { id: 250, media_id: 5, title: 'Same Day Higher Id', activity_type: 'Reading', duration_minutes: 10, characters: 0, date: '2026-04-16', language: 'Japanese' },
            { id: 200, media_id: 6, title: 'Same Day Lower Id', activity_type: 'Reading', duration_minutes: 10, characters: 0, date: '2026-04-16', language: 'Japanese' },
        ];

        const component = new QuickLog(container, { logs, mediaList }, { onLogged: vi.fn().mockResolvedValue(undefined) });
        component.render();

        const titles = Array.from(container.querySelectorAll('.quick-log-item .quick-log-title')).map(node => node.textContent || '');
        expect(titles).toHaveLength(6);
        expect(titles).toContain('Same Day Higher Id');
        expect(titles).toContain('Same Day Lower Id');
    });

    it('opens the activity modal for the clicked media and refreshes after success', async () => {
        vi.mocked(showLogActivityModal).mockResolvedValue(true);
        const onLogged = vi.fn().mockResolvedValue(undefined);
        const mediaList: Media[] = [
            { id: 7, title: 'Blue Box', default_activity_type: 'Reading', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Manga', tracking_status: 'Ongoing' },
        ];

        const component = new QuickLog(container, { logs: [], mediaList }, { onLogged });
        component.render();

        (container.querySelector('.quick-log-item') as HTMLElement).click();

        await vi.waitFor(() => {
            expect(showLogActivityModal).toHaveBeenCalledWith(7);
            expect(onLogged).toHaveBeenCalled();
        });
    });

    it('opens media details from the desktop quick action button', () => {
        const mediaList: Media[] = [
            { id: 8, title: 'Dandadan', default_activity_type: 'Reading', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Manga', tracking_status: 'Ongoing' },
        ];
        const dispatchSpy = vi.spyOn(globalThis, 'dispatchEvent');

        const component = new QuickLog(container, { logs: [], mediaList }, { onLogged: vi.fn().mockResolvedValue(undefined) });
        component.render();

        (container.querySelector('[data-quick-log-open-media-id="8"]') as HTMLButtonElement).click();

        expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: 'app-navigate',
        }));
    });

    it('shows the variant alongside the content type', () => {
        const mediaList: Media[] = [
            { id: 9, title: 'Horimiya', variant: 'TV Series', default_activity_type: 'Watching', status: 'Active', language: 'Japanese', description: '', cover_image: '', extra_data: '{}', content_type: 'Anime', tracking_status: 'Ongoing' },
        ];

        const component = new QuickLog(container, { logs: [], mediaList }, { onLogged: vi.fn().mockResolvedValue(undefined) });
        component.render();

        expect(container.querySelector('.quick-log-type')?.textContent).toBe('Anime · TV Series');
    });

    it('sorts alphabetically when status and log recency are tied', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Zeta' }),
            makeMedia({ id: 2, title: 'Alpha' }),
        ];

        const component = new QuickLog(container, { logs: [], mediaList }, { onLogged: vi.fn() });
        component.render();

        const titles = Array.from(container.querySelectorAll('.quick-log-title')).map(node => node.textContent);
        expect(titles).toEqual(['Alpha', 'Zeta']);
    });

    it('keeps only loggable media and limits the list to six items', () => {
        const mediaList = [
            makeMedia({ id: 0, title: 'Missing Id' }),
            makeMedia({ id: 1, title: 'Archived', status: 'Archived' }),
            ...Array.from({ length: 7 }, (_unused, index) => makeMedia({
                id: index + 2,
                title: `Active ${index + 1}`,
            })),
        ];

        const component = new QuickLog(container, { logs: [], mediaList }, { onLogged: vi.fn() });
        component.render();

        expect(container.querySelectorAll('.quick-log-item')).toHaveLength(6);
        expect(container.textContent).not.toContain('Missing Id');
        expect(container.textContent).not.toContain('Archived');
    });

    it('uses the newest log per medium before sorting', () => {
        const mediaList = [
            makeMedia({ id: 1, title: 'Updated Twice' }),
            makeMedia({ id: 2, title: 'Middle' }),
        ];
        const logs = [
            { id: 1, media_id: 1, title: 'Updated Twice', activity_type: 'Reading', duration_minutes: 10, characters: 0, date: '2026-07-01', language: 'Japanese' },
            { id: 2, media_id: 1, title: 'Updated Twice', activity_type: 'Reading', duration_minutes: 10, characters: 0, date: '2026-07-03', language: 'Japanese' },
            { id: 3, media_id: 1, title: 'Updated Twice', activity_type: 'Reading', duration_minutes: 10, characters: 0, date: '2026-07-03', language: 'Japanese' },
            { id: 4, media_id: 2, title: 'Middle', activity_type: 'Reading', duration_minutes: 10, characters: 0, date: '2026-07-02', language: 'Japanese' },
        ] as ActivitySummary[];

        const component = new QuickLog(container, { logs, mediaList }, { onLogged: vi.fn() });
        component.render();

        expect(container.querySelector('.quick-log-title')?.textContent).toBe('Updated Twice');
    });

    it('renders fallback labels, equivalent variants, and mobile shortcuts correctly', () => {
        document.body.dataset.runtime = 'mobile-app';
        const mediaList = [
            makeMedia({ id: 1, title: 'Default Type', content_type: '', default_activity_type: 'Listening' }),
            makeMedia({ id: 2, title: 'Equivalent Variant', content_type: 'Anime', variant: 'anime' }),
            makeMedia({ id: 3, title: 'Unknown Type', content_type: '   ', default_activity_type: '' }),
        ];

        const component = new QuickLog(container, { logs: [], mediaList }, { onLogged: vi.fn() });
        component.render();

        const typeFor = (id: number) => container
            .querySelector(`[data-quick-log-media-id="${id}"] .quick-log-type`)?.textContent;
        expect(typeFor(1)).toBe('Listening');
        expect(typeFor(2)).toBe('anime');
        expect(typeFor(3)).toBe('Unknown');
        expect(container.querySelector('.quick-log-shortcut-btn')?.getAttribute('style')).toContain('display: none');
        expect(container.textContent).toContain('No Image');
    });

    it('loads and displays a cover once', async () => {
        vi.mocked(MediaCoverLoader.load).mockResolvedValue('data:image/png;base64,cover');
        const media = makeMedia({ cover_image: 'cover.jpg' });
        const component = new QuickLog(container, { logs: [], mediaList: [media] }, { onLogged: vi.fn() });

        component.render();

        expect(container.textContent).toContain('Loading');
        await vi.waitFor(() => expect(container.querySelector('.quick-log-cover img')).not.toBeNull());
        expect(container.querySelector('.quick-log-cover img')?.getAttribute('src')).toBe('data:image/png;base64,cover');
        expect(MediaCoverLoader.load).toHaveBeenCalledOnce();

        component.render();
        await Promise.resolve();
        expect(MediaCoverLoader.load).toHaveBeenCalledOnce();
    });

    it('does not retry a cover that failed to load', async () => {
        const failure = new Error('cover unavailable');
        const loggerSpy = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        vi.mocked(MediaCoverLoader.load).mockRejectedValue(failure);
        const component = new QuickLog(
            container,
            { logs: [], mediaList: [makeMedia({ cover_image: 'broken.jpg' })] },
            { onLogged: vi.fn() },
        );

        component.render();

        await vi.waitFor(() => expect(loggerSpy).toHaveBeenCalledWith('Failed to load Quick Log cover image', failure));
        component.render();
        await Promise.resolve();
        expect(MediaCoverLoader.load).toHaveBeenCalledOnce();
    });

    it('logs an unexpected failure while preparing covers', async () => {
        const failure = new Error('cover preparation failed');
        const loggerSpy = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        const component = new QuickLog(
            container,
            { logs: [], mediaList: [makeMedia()] },
            { onLogged: vi.fn() },
        );
        vi.spyOn(
            component as unknown as { ensureCoverUrls(items: Media[]): Promise<void> },
            'ensureCoverUrls',
        ).mockRejectedValue(failure);

        component.render();

        await vi.waitFor(() => expect(loggerSpy).toHaveBeenCalledWith('Failed to prepare Quick Log cover images', failure));
    });

    it('does not refresh or dispatch a data event when logging is cancelled', async () => {
        const onLogged = vi.fn();
        const dispatchSpy = vi.spyOn(globalThis, 'dispatchEvent');
        const component = new QuickLog(
            container,
            { logs: [], mediaList: [makeMedia()] },
            { onLogged },
        );
        component.render();

        (container.querySelector('.quick-log-item') as HTMLElement).click();

        await vi.waitFor(() => expect(showLogActivityModal).toHaveBeenCalledWith(1));
        expect(onLogged).not.toHaveBeenCalled();
        expect(dispatchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: EVENTS.LOCAL_DATA_CHANGED }));
    });

    it.each(['Enter', ' '])('opens the activity modal from the %j keyboard shortcut', async key => {
        vi.mocked(showLogActivityModal).mockResolvedValue(true);
        const onLogged = vi.fn().mockResolvedValue(undefined);
        const dispatchSpy = vi.spyOn(globalThis, 'dispatchEvent');
        const component = new QuickLog(
            container,
            { logs: [], mediaList: [makeMedia()] },
            { onLogged },
        );
        component.render();
        const item = container.querySelector('.quick-log-item') as HTMLElement;
        const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });

        item.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        await vi.waitFor(() => expect(onLogged).toHaveBeenCalledOnce());
        expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({ type: EVENTS.LOCAL_DATA_CHANGED }));
    });

    it('ignores unrelated keys', async () => {
        const component = new QuickLog(
            container,
            { logs: [], mediaList: [makeMedia()] },
            { onLogged: vi.fn() },
        );
        component.render();

        (container.querySelector('.quick-log-item') as HTMLElement).dispatchEvent(
            new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        await Promise.resolve();

        expect(showLogActivityModal).not.toHaveBeenCalled();
    });

    it('logs activity-modal failures from both click and keyboard activation', async () => {
        const failure = new Error('modal failed');
        const loggerSpy = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
        vi.mocked(showLogActivityModal).mockRejectedValue(failure);
        const component = new QuickLog(
            container,
            { logs: [], mediaList: [makeMedia()] },
            { onLogged: vi.fn() },
        );
        component.render();
        const item = container.querySelector('.quick-log-item') as HTMLElement;

        item.click();
        await vi.waitFor(() => expect(loggerSpy).toHaveBeenCalledTimes(1));
        item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        await vi.waitFor(() => expect(loggerSpy).toHaveBeenCalledTimes(2));
        expect(loggerSpy).toHaveBeenNthCalledWith(1, 'Failed to open Quick Log activity modal', failure);
        expect(loggerSpy).toHaveBeenNthCalledWith(2, 'Failed to open Quick Log activity modal', failure);
    });

    it('ignores a malformed media-detail shortcut id', () => {
        const dispatchSpy = vi.spyOn(globalThis, 'dispatchEvent');
        const component = new QuickLog(
            container,
            { logs: [], mediaList: [makeMedia()] },
            { onLogged: vi.fn() },
        );
        component.render();
        const shortcut = container.querySelector('[data-quick-log-open-media-id]') as HTMLElement;
        shortcut.dataset.quickLogOpenMediaId = 'not-a-number';

        shortcut.click();

        expect(dispatchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: EVENTS.APP_NAVIGATE }));
        expect(showLogActivityModal).not.toHaveBeenCalled();
    });

    it('opens media details on a mobile long press and suppresses the following click', () => {
        vi.useFakeTimers();
        document.body.dataset.runtime = 'mobile-app';
        const dispatchSpy = vi.spyOn(globalThis, 'dispatchEvent');
        const component = new QuickLog(
            container,
            { logs: [], mediaList: [makeMedia({ id: 42 })] },
            { onLogged: vi.fn() },
        );
        component.render();
        const item = container.querySelector('.quick-log-item') as HTMLElement;

        item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
        vi.advanceTimersByTime(420);
        item.click();

        expect(dispatchSpy).toHaveBeenCalledWith(expect.objectContaining({
            type: EVENTS.APP_NAVIGATE,
            detail: { view: 'media', focusMediaId: 42, source: 'dashboard' },
        }));
        expect(showLogActivityModal).not.toHaveBeenCalled();
    });

    it('cancels a pending mobile long press and ignores mouse pointerdown', () => {
        vi.useFakeTimers();
        document.body.dataset.runtime = 'mobile-app';
        const dispatchSpy = vi.spyOn(globalThis, 'dispatchEvent');
        const component = new QuickLog(
            container,
            { logs: [], mediaList: [makeMedia()] },
            { onLogged: vi.fn() },
        );
        component.render();
        const item = container.querySelector('.quick-log-item') as HTMLElement;

        item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
        vi.advanceTimersByTime(420);
        item.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'touch' }));
        item.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerType: 'touch' }));
        vi.advanceTimersByTime(420);

        expect(dispatchSpy).not.toHaveBeenCalledWith(expect.objectContaining({ type: EVENTS.APP_NAVIGATE }));
    });
});
