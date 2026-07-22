import { measureSynchronous } from '../performance';

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
    createItemWrapper: (item: T, index: number) => HTMLElement;
    performanceOperation: string;
}

export function createCollectionItemWrapper(
    className: string,
    containIntrinsicSize: string,
): HTMLDivElement {
    const itemWrapper = document.createElement('div');
    itemWrapper.className = className;
    itemWrapper.style.contentVisibility = 'auto';
    itemWrapper.style.containIntrinsicSize = containIntrinsicSize;
    return itemWrapper;
}

export function createLibrarySectionHeaderWrapper(
    label: string,
    spanFullWidth: boolean,
): HTMLDivElement {
    const headerWrapper = createCollectionItemWrapper(
        'media-library-section-header',
        'auto 48px',
    );
    if (spanFullWidth) {
        headerWrapper.style.gridColumn = '1 / -1';
    }
    headerWrapper.textContent = label;
    return headerWrapper;
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
    performanceOperation,
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

        measureSynchronous('render', performanceOperation, () => {
            const fragment = document.createDocumentFragment();
            for (let i = currentIndex; i < end; i += 1) {
                fragment.appendChild(createItemWrapper(items[i], i));
            }
            container.appendChild(fragment);
        }, { batch_size: end - currentIndex, rendered_count: end, total_count: items.length });
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
