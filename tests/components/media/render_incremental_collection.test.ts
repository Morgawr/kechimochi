import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createCollectionItemWrapper, renderIncrementalMediaCollection } from '../../../src/media/render_incremental_collection';

describe('renderIncrementalMediaCollection onRenderComplete', () => {
    let host: HTMLElement;

    beforeEach(() => {
        host = document.createElement('div');
        vi.useFakeTimers();
        vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
            callback(0);
            return 1;
        }));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    function baseOptions(overrides: Partial<Parameters<typeof renderIncrementalMediaCollection<number>>[0]> = {}) {
        return {
            host,
            items: [] as number[],
            containerId: 'test-container',
            containerClassName: 'test-scroll',
            containerStyle: '',
            emptyStateMarkup: '<div>Empty</div>',
            initialBatchSize: 2,
            batchSize: 2,
            firstBatchDelayMs: 10,
            subsequentBatchDelayMs: 10,
            shouldContinue: () => true,
            performanceOperation: 'test_op',
            createItemWrapper: () => createCollectionItemWrapper('item', 'auto 10px'),
            ...overrides,
        };
    }

    it('fires onRenderComplete for an empty collection', () => {
        const onRenderComplete = vi.fn();
        renderIncrementalMediaCollection(baseOptions({ items: [], onRenderComplete }));

        expect(onRenderComplete).toHaveBeenCalledOnce();
    });

    it('fires onRenderComplete once all batches for a populated collection finish', () => {
        const onRenderComplete = vi.fn();
        renderIncrementalMediaCollection(baseOptions({ items: [1, 2, 3, 4, 5], onRenderComplete }));

        expect(onRenderComplete).not.toHaveBeenCalled();

        vi.runAllTimers();

        expect(onRenderComplete).toHaveBeenCalledOnce();
    });

    it('does not fire onRenderComplete for a render superseded before it completes', () => {
        const onRenderComplete = vi.fn();
        let isSuperseded = false;
        renderIncrementalMediaCollection(baseOptions({
            items: [1, 2, 3, 4, 5],
            shouldContinue: () => !isSuperseded,
            onRenderComplete,
        }));

        isSuperseded = true;
        vi.runAllTimers();

        expect(onRenderComplete).not.toHaveBeenCalled();
    });
});
