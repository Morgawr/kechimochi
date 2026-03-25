import { afterEach, beforeEach, vi } from 'vitest';
import type { Media } from '../../../src/api';

export function useCollectionRenderTestEnv() {
    let container: HTMLElement;
    let requestAnimationFrameSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        container = document.createElement('div');
        vi.clearAllMocks();
        vi.useFakeTimers();
        requestAnimationFrameSpy = vi.fn((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        });
        vi.stubGlobal('requestAnimationFrame', requestAnimationFrameSpy);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    return {
        get container() {
            return container;
        },
        get requestAnimationFrameSpy() {
            return requestAnimationFrameSpy;
        },
    };
}

export function createCollectionMediaList(count: number): Media[] {
    return Array.from({ length: count }, (_, index) => ({
        id: index + 1,
        title: `Item ${index + 1}`,
        status: 'Active',
        content_type: 'Anime',
        tracking_status: 'Ongoing',
    })) as Media[];
}
