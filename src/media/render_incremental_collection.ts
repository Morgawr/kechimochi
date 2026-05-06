interface IncrementalMediaCollectionOptions<T> {
    host: HTMLElement;
    items: T[];
    containerId: string;
    containerClassName: string;
    containerStyle: string;
    emptyStateMarkup: string;
    initialBatchSize: number;
    batchSize: number;
    firstBatchDelayMs: number;
    subsequentBatchDelayMs: number;
    shouldContinue: () => boolean;
    createItemWrapper: (item: T, index: number, isFirstBatch: boolean) => HTMLElement;
}

export function createAnimatedCollectionItemWrapper(
    className: string,
    animationDelaySeconds: number,
    containIntrinsicSize: string,
): HTMLDivElement {
    const itemWrapper = document.createElement('div');
    itemWrapper.className = `${className} animate-page-fade-in`;
    itemWrapper.style.opacity = '0';
    itemWrapper.style.animation = `fadeIn 0.25s ease-out ${animationDelaySeconds}s forwards`;
    itemWrapper.style.contentVisibility = 'auto';
    itemWrapper.style.containIntrinsicSize = containIntrinsicSize;
    return itemWrapper;
}

export function renderIncrementalMediaCollection<T>({
    host,
    items,
    containerId,
    containerClassName,
    containerStyle,
    emptyStateMarkup,
    initialBatchSize,
    batchSize,
    firstBatchDelayMs,
    subsequentBatchDelayMs,
    shouldContinue,
    createItemWrapper,
}: IncrementalMediaCollectionOptions<T>) {
    const container = document.createElement('div');
    container.id = containerId;
    container.className = containerClassName;
    container.style.cssText = containerStyle;
    host.appendChild(container);

    if (items.length === 0) {
        container.innerHTML = emptyStateMarkup;
        return;
    }

    let currentIndex = 0;

    const renderBatch = (isFirstBatch = false) => {
        if (!shouldContinue()) return;

        const currentLimit = isFirstBatch ? initialBatchSize : batchSize;
        const end = Math.min(currentIndex + currentLimit, items.length);

        const fragment = document.createDocumentFragment();
        for (let i = currentIndex; i < end; i += 1) {
            fragment.appendChild(createItemWrapper(items[i], i, isFirstBatch));
        }

        container.appendChild(fragment);
        currentIndex = end;

        if (currentIndex >= items.length || !shouldContinue()) {
            return;
        }

        setTimeout(() => {
            if (!shouldContinue()) {
                return;
            }

            requestAnimationFrame(() => renderBatch());
        }, isFirstBatch ? firstBatchDelayMs : subsequentBatchDelayMs);
    };

    renderBatch(true);
}
