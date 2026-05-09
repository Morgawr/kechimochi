export type BackHandler = () => boolean | Promise<boolean>;
type SubscribeSystemBack = (handler: () => void | Promise<void>) => Promise<() => void>;

interface BackEntry {
    id: number;
    handler: BackHandler;
}

let nextEntryId = 1;
let entries: BackEntry[] = [];
let subscribeSystemBack: SubscribeSystemBack | null = null;
let handleEmptyStack: (() => void) | null = null;
let unlistenSystemBack: (() => void) | null = null;
let syncChain: Promise<void> = Promise.resolve();

async function onSystemBack(): Promise<void> {
    const topEntry = entries[entries.length - 1];
    if (!topEntry) {
        handleEmptyStack?.();
        return;
    }

    const handled = await topEntry.handler();
    if (!handled) {
        handleEmptyStack?.();
    }
}

function scheduleSubscriptionSync(): void {
    syncChain = syncChain.then(async () => {
        if (!subscribeSystemBack) {
            return;
        }

        if (entries.length === 0) {
            if (unlistenSystemBack) {
                unlistenSystemBack();
                unlistenSystemBack = null;
            }
            return;
        }

        unlistenSystemBack ??= await subscribeSystemBack(onSystemBack);
    });
}

export function configureBackStack(options: {
    subscribe: SubscribeSystemBack;
    onEmpty: () => void;
}): void {
    subscribeSystemBack = options.subscribe;
    handleEmptyStack = options.onEmpty;
    scheduleSubscriptionSync();
}

export function pushBackHandler(handler: BackHandler): () => void {
    const entryId = nextEntryId++;
    entries = [...entries, { id: entryId, handler }];
    scheduleSubscriptionSync();

    let isActive = true;
    return () => {
        if (!isActive) {
            return;
        }

        isActive = false;
        entries = entries.filter((entry) => entry.id !== entryId);
        scheduleSubscriptionSync();
    };
}

export function resetBackStack(): void {
    entries = [];
    if (unlistenSystemBack) {
        unlistenSystemBack();
        unlistenSystemBack = null;
    }
    subscribeSystemBack = null;
    handleEmptyStack = null;
    nextEntryId = 1;
    syncChain = Promise.resolve();
}
