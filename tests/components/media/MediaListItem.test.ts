import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    disconnect,
    resetCoverLoaderTestState,
    triggerLatestIntersection,
} from './media_cover_test_utils';
import { Media } from '../../../src/api';
import * as api from '../../../src/api';
import { MediaListItem } from '../../../src/components/media/MediaListItem';

describe('MediaListItem', () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement('div');
        return resetCoverLoaderTestState('https://covers.example/list.jpg');
    });

    it('renders description and aggregated activity fields', () => {
        const media = {
            title: 'Library Item',
            description: 'A short blurb about this item.',
            status: 'Active',
            content_type: 'Anime',
            tracking_status: 'Ongoing',
            cover_image: '',
        };

        const component = new MediaListItem(
            container,
            media as Media,
            {
                firstActivityDate: '2026-03-01',
                lastActivityDate: '2026-03-20',
                totalMinutes: 125,
            },
            false,
            vi.fn(),
        );

        component.render();

        expect(container.textContent).toContain('Library Item');
        expect(container.textContent).toContain('A short blurb about this item.');
        expect(container.textContent).toContain('2026-03-01');
        expect(container.textContent).toContain('2026-03-20');
        expect(container.textContent).toContain('2h5min');
        expect(container.querySelector('.badge-status')?.classList.contains('badge')).toBe(true);
    });

    it('shows loading placeholders for metrics while list summaries are loading', () => {
        const component = new MediaListItem(
            container,
            {
                title: 'Pending Metrics',
                description: '',
                status: 'Active',
                content_type: 'Novel',
                tracking_status: 'Untracked',
                cover_image: '',
            } as Media,
            null,
            true,
            vi.fn(),
        );

        component.render();

        expect(container.textContent).toContain('Loading...');
    });

    it('loads cover images through the shared loader path', async () => {
        vi.mocked(api.readFileBytes).mockResolvedValue([1, 2, 3]);
        globalThis.URL.createObjectURL = vi.fn(() => 'blob:list-item');

        const component = new MediaListItem(
            container,
            {
                title: 'With Cover',
                description: '',
                status: 'Active',
                content_type: 'Anime',
                tracking_status: 'Complete',
                cover_image: '/path/to/cover.jpg',
            } as Media,
            null,
            false,
            vi.fn(),
        );

        triggerLatestIntersection();

        // @ts-expect-error - accessing private component state for verification
        await vi.waitUntil(() => component.state.imgSrc === 'blob:list-item');
        component.render();

        const img = container.querySelector('img');
        expect(img?.getAttribute('src')).toBe('blob:list-item');
        expect(disconnect).toHaveBeenCalled();
    });
});
