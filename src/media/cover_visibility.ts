export type VisibleCoverTask = () => void;

/** One observer per rendered collection instead of one observer per card. */
export class CoverVisibilityController {
    private readonly callbacks = new Map<Element, VisibleCoverTask>();
    private readonly observer: IntersectionObserver | null;
    private isDisconnected = false;

    constructor(rootMargin: string, root: Element | null = null) {
        this.observer = typeof IntersectionObserver === 'undefined'
            ? null
            : new IntersectionObserver(entries => {
                for (const entry of entries) {
                    if (!entry.isIntersecting) continue;
                    this.run(entry.target);
                }
            }, { root, rootMargin, threshold: 0.01 });
    }

    public observe(element: Element, task: VisibleCoverTask): () => void {
        if (this.isDisconnected) return () => undefined;
        this.callbacks.set(element, task);
        if (!this.observer) {
            queueMicrotask(() => this.run(element));
        } else {
            this.observer.observe(element);
        }
        return () => this.unobserve(element);
    }

    public loadNow(element: Element, task: VisibleCoverTask): void {
        if (this.isDisconnected) return;
        this.callbacks.set(element, task);
        this.run(element);
    }

    public disconnect(): void {
        this.isDisconnected = true;
        this.observer?.disconnect();
        this.callbacks.clear();
    }

    private run(element: Element): void {
        const task = this.callbacks.get(element);
        if (!task) return;
        this.callbacks.delete(element);
        this.observer?.unobserve?.(element);
        if (this.callbacks.size === 0) {
            this.observer?.disconnect();
        }
        task();
    }

    private unobserve(element: Element): void {
        this.callbacks.delete(element);
        this.observer?.unobserve?.(element);
    }
}
