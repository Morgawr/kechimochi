import { Component } from '../component';
import { MediaCoverLoader } from './cover_loader';
import { CoverVisibilityController } from './cover_visibility';

interface ProgressiveCoverState {
    media: {
        title: string;
        cover_image?: string | null;
    };
    imgSrc: string | null;
}

interface ProgressiveCoverPresentation {
    rootMargin: string;
    imageSelector: string;
    targetSelector: string;
    layoutClass: string;
    mount: 'replace-target' | 'replace-children';
}

interface ProgressiveCoverLoadOptions {
    element: HTMLElement;
    coverRef?: string | null;
    initialSrc: string | null;
    eager: boolean;
    visibilityController?: CoverVisibilityController;
    rootMargin: string;
    onLoad: (src: string) => void;
}

const doNothing: () => void = () => undefined;

export const MEDIA_GRID_COVER: ProgressiveCoverPresentation = {
    rootMargin: '240px 0px',
    imageSelector: 'img.media-grid-cover-image',
    targetSelector: '.image-placeholder',
    layoutClass: 'media-grid-cover-image',
    mount: 'replace-target',
};

export const MEDIA_LIST_COVER: ProgressiveCoverPresentation = {
    rootMargin: '280px 0px',
    imageSelector: 'img.media-list-cover-image',
    targetSelector: '.media-list-cover-shell',
    layoutClass: 'media-list-cover-image',
    mount: 'replace-children',
};

/**
 * Shared lifecycle for collection items whose covers load as they approach the viewport.
 */
export abstract class ProgressiveCoverComponent<State extends ProgressiveCoverState> extends Component<State> {
    private readonly stopCoverLoading: () => void;

    protected constructor(
        container: HTMLElement,
        initialState: State,
        presentation: ProgressiveCoverPresentation,
        visibilityController?: CoverVisibilityController,
        eager = false,
    ) {
        const coverRef = initialState.media.cover_image?.trim();
        const initialSrc = coverRef ? MediaCoverLoader.getCached(coverRef) : null;
        super(container, { ...initialState, imgSrc: initialSrc });
        this.stopCoverLoading = startProgressiveCoverLoad({
            element: container,
            coverRef,
            initialSrc,
            eager,
            visibilityController,
            rootMargin: presentation.rootMargin,
            onLoad: src => {
                this.state.imgSrc = src;
                commitProgressiveCoverImage(container, presentation, src, this.state.media.title);
            },
        });
    }

    public override destroy(): void {
        this.stopCoverLoading();
        super.destroy();
    }
}

/**
 * Starts one visibility-aware cover load and returns its lifecycle cleanup.
 * The underlying loader remains responsible for cache bounds and dataset
 * generation isolation; disposed components never commit late results.
 */
function startProgressiveCoverLoad(options: ProgressiveCoverLoadOptions): () => void {
    const coverRef = options.coverRef?.trim();
    if (!coverRef || options.initialSrc) return doNothing;

    const visibility = options.visibilityController ?? new CoverVisibilityController(options.rootMargin);
    const ownsVisibilityController = options.visibilityController === undefined;
    let isDisposed = false;
    let stopObserving = doNothing;
    const load = () => {
        MediaCoverLoader.load(coverRef)
            .then(src => {
                if (src && !isDisposed) options.onLoad(src);
            })
            .catch(doNothing);
    };

    if (options.eager) {
        visibility.loadNow(options.element, load);
    } else {
        stopObserving = visibility.observe(options.element, load);
    }

    return () => {
        isDisposed = true;
        stopObserving();
        if (ownsVisibilityController) visibility.disconnect();
    };
}

function commitProgressiveCoverImage(
    container: HTMLElement,
    presentation: ProgressiveCoverPresentation,
    src: string,
    alt: string,
): void {
    const existing = container.querySelector<HTMLImageElement>(presentation.imageSelector);
    if (existing) {
        if (existing.src !== src) existing.src = src;
        return;
    }

    const target = container.querySelector<HTMLElement>(presentation.targetSelector);
    if (!target) return;
    const image = createProgressiveCoverImage(src, presentation.layoutClass, alt);
    if (presentation.mount === 'replace-target') {
        target.replaceWith(image);
    } else {
        target.replaceChildren(image);
    }
}

function createProgressiveCoverImage(src: string, layoutClass: string, alt: string): HTMLImageElement {
    const image = document.createElement('img');
    const markLoaded = () => image.classList.add('is-loaded');
    image.className = `${layoutClass} progressive-cover-image`;
    image.alt = alt;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.addEventListener('load', markLoaded, { once: true });
    image.src = src;
    if (image.complete) requestAnimationFrame(markLoaded);
    return image;
}
