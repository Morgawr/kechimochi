import { afterEach, describe, expect, it, vi } from 'vitest';

import { CoverVisibilityController } from '../../../src/media/cover_visibility';

describe('CoverVisibilityController', () => {
    const originalObserver = globalThis.IntersectionObserver;

    afterEach(() => {
        Object.defineProperty(globalThis, 'IntersectionObserver', {
            writable: true,
            value: originalObserver,
        });
    });

    it('uses one observer for a collection and runs only intersecting tasks', () => {
        let callback!: IntersectionObserverCallback;
        const observe = vi.fn();
        const unobserve = vi.fn();
        const disconnect = vi.fn();
        vi.stubGlobal('IntersectionObserver', vi.fn((nextCallback: IntersectionObserverCallback) => {
            callback = nextCallback;
            return { observe, unobserve, disconnect };
        }));
        const controller = new CoverVisibilityController('300px 0px');
        const first = document.createElement('div');
        const second = document.createElement('div');
        const firstTask = vi.fn();
        const secondTask = vi.fn();

        controller.observe(first, firstTask);
        controller.observe(second, secondTask);
        expect(IntersectionObserver).toHaveBeenCalledTimes(1);
        callback([
            { target: first, isIntersecting: true },
            { target: second, isIntersecting: false },
        ] as unknown as IntersectionObserverEntry[], {} as IntersectionObserver);

        expect(firstTask).toHaveBeenCalledOnce();
        expect(secondTask).not.toHaveBeenCalled();
        expect(unobserve).toHaveBeenCalledWith(first);
        expect(disconnect).not.toHaveBeenCalled();

        controller.disconnect();
        expect(disconnect).toHaveBeenCalledOnce();
    });

    it('falls back to microtasks when IntersectionObserver is unavailable', async () => {
        vi.stubGlobal('IntersectionObserver', undefined);
        const controller = new CoverVisibilityController('300px');
        const task = vi.fn();

        controller.observe(document.createElement('div'), task);
        await Promise.resolve();

        expect(task).toHaveBeenCalledOnce();
    });
});
