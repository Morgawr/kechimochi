import {
    attachRemoteSyncProfile,
    connectGoogleDrive,
    listRemoteSyncProfiles,
    previewAttachRemoteSyncProfile,
    subscribeSyncProgress,
} from './api';
import { customAlert, showBlockingStatus, showSyncAttachPreview, showSyncEnablementWizard } from './modals';
import type { SyncEnablementWizardOptions } from './modals/sync';
import type { GoogleDriveAuthSession, SyncAttachPreview, SyncProgressUpdate } from './types';

export const ENABLE_SYNC_AUTH_TIMEOUT_MS = 60_000;
export const ENABLE_SYNC_AUTH_TIMEOUT_ERROR =
    'Google sign-in timed out before the app received the authorization result.';

export type BlockingStatusRunner = <T>(
    title: string,
    text: string,
    operation: () => Promise<T>,
    options?: {
        timeoutMs?: number;
        timeoutMessage?: string;
    },
) => Promise<T>;

export type SyncProgressBlockingStatusRunner = <T>(
    title: string,
    text: string,
    operationName: SyncProgressUpdate['operation'],
    operation: () => Promise<T>,
) => Promise<T>;

export type SyncEnablementSelection =
    | { action: 'create_new' }
    | { action: 'attach'; profileId: string; preview: SyncAttachPreview };

export function stringifySyncEnablementError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

export async function runBlockingStatus<T>(
    title: string,
    text: string,
    operation: () => Promise<T>,
    options?: {
        timeoutMs?: number;
        timeoutMessage?: string;
    },
): Promise<T> {
    const progress = showBlockingStatus(title, text);
    let timeoutHandle: ReturnType<typeof globalThis.setTimeout> | undefined;
    try {
        if (!options?.timeoutMs) {
            return await operation();
        }

        const timeoutPromise = new Promise<T>((_, reject) => {
            timeoutHandle = globalThis.setTimeout(() => {
                reject(new Error(options.timeoutMessage || 'Operation timed out.'));
            }, options.timeoutMs);
        });

        return await Promise.race([operation(), timeoutPromise]);
    } finally {
        if (timeoutHandle !== undefined) {
            globalThis.clearTimeout(timeoutHandle);
        }
        await progress.close();
    }
}

export async function runSyncProgressBlockingStatus<T>(
    title: string,
    text: string,
    operationName: SyncProgressUpdate['operation'],
    operation: () => Promise<T>,
): Promise<T> {
    const progress = showBlockingStatus(title, text);
    let unsubscribe: (() => void) | undefined;
    try {
        unsubscribe = await subscribeSyncProgress((update) => {
            if (update.operation !== operationName) {
                return;
            }
            progress.setText?.(update.message);
            progress.setProgress?.(
                update.current,
                update.total,
                update.total > 0 ? `${Math.min(update.current, update.total)} / ${update.total}` : undefined,
            );
        });
        return await operation();
    } finally {
        unsubscribe?.();
        await progress.close();
    }
}

export async function connectGoogleDriveForSync(
    withBlockingStatus: BlockingStatusRunner,
    promptText = 'Complete the Google sign-in flow to keep going.',
): Promise<GoogleDriveAuthSession> {
    return withBlockingStatus(
        'Connecting to Google Drive',
        promptText,
        () => connectGoogleDrive(),
        {
            timeoutMs: ENABLE_SYNC_AUTH_TIMEOUT_MS,
            timeoutMessage: ENABLE_SYNC_AUTH_TIMEOUT_ERROR,
        },
    );
}

export async function resolveSyncEnablementSelection(options: {
    googleAuthenticated: boolean;
    googleEmail?: string | null;
    withBlockingStatus: BlockingStatusRunner;
    wizardOptions?: SyncEnablementWizardOptions;
    onNoProfiles?: () => Promise<void>;
    connectPromptText?: string;
}): Promise<SyncEnablementSelection | null> {
    let googleEmail = options.googleEmail || null;

    if (!options.googleAuthenticated) {
        const authSession = await connectGoogleDriveForSync(
            options.withBlockingStatus,
            options.connectPromptText,
        );
        googleEmail = authSession.google_account_email;
    }

    const profiles = await options.withBlockingStatus(
        'Loading Cloud Profiles',
        'Checking Google Drive for existing Kechimochi sync profiles...',
        () => listRemoteSyncProfiles(),
    );

    const allowCreateNew = options.wizardOptions?.allowCreateNew ?? true;
    if (profiles.length === 0 && !allowCreateNew) {
        await options.onNoProfiles?.();
        return null;
    }

    const choice = await showSyncEnablementWizard(
        profiles,
        googleEmail,
        options.wizardOptions,
    );
    if (!choice) {
        return null;
    }

    if (choice.action === 'create_new') {
        return choice;
    }

    const preview = await options.withBlockingStatus(
        'Preparing Attach Preview',
        'Comparing this device with the selected cloud profile...',
        () => previewAttachRemoteSyncProfile(choice.profileId),
    );

    const confirmed = await showSyncAttachPreview(preview);
    if (!confirmed) {
        return null;
    }

    return {
        action: 'attach',
        profileId: choice.profileId,
        preview,
    };
}

export async function showNoCloudProfilesFoundAlert(): Promise<void> {
    await customAlert(
        'No Cloud Profiles Found',
        'This Google account does not have any existing Kechimochi sync profiles yet. Create a local profile instead.',
    );
}

export async function attachSelectedRemoteProfile(
    withSyncProgressBlockingStatus: SyncProgressBlockingStatusRunner,
    profileId: string,
    title = 'Attaching Cloud Sync Profile',
    text = 'Downloading remote data, applying changes on this device, and publishing the merged result...',
) {
    return withSyncProgressBlockingStatus(
        title,
        text,
        'attach_remote_sync_profile',
        () => attachRemoteSyncProfile(profileId),
    );
}
