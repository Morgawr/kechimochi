export abstract class Component<T = unknown> {
    protected container: HTMLElement;
    protected state: T;

    private isMounted = false;

    constructor(container: HTMLElement, initialState: T) {
        this.container = container;
        this.state = initialState;
        // Trigger onMount after the current execution context (usually after first render)
        queueMicrotask(() => this.triggerMount());
    }

    public triggerMount() {
        if (!this.isMounted) {
            this.isMounted = true;
            this.onMount?.();
        }
    }

    /**
     * Updates the component state and triggers a re-render.
     */
    public setState(newState: Partial<T>) {
        this.state = { ...this.state, ...newState };
        this.render();
    }

    /**
     * Renders the component into the container.
     */
    public abstract render(): void;

    /**
     * Lifecycle hook called after the component is first mounted to the DOM.
     */
    protected onMount?(): void;

    /**
     * Lifecycle hook called after every render updates the DOM.
     */
    protected onUpdate?(): void;

    /**
     * Lifecycle hook called when the component is removed from the DOM.
     */
    public destroy(): void {
        // Default implementation
    }

    /**
     * Helper to clear the container safely.
     */
    protected clear() {
        while (this.container.firstChild) {
            this.container.firstChild.remove();
        }
    }
}
