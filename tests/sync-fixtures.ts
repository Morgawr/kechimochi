import type {
    GoogleDriveAuthSession,
    RemoteSyncProfileSummary,
    SyncActionResult,
    SyncAttachPreview,
    SyncStatus,
} from '../src/types';

const DEFAULT_SYNC_STATUS: SyncStatus = {
    state: 'disconnected',
    google_authenticated: false,
    sync_profile_id: null,
    profile_name: null,
    google_account_email: null,
    last_sync_at: null,
    device_name: null,
    conflict_count: 0,
};

const DEFAULT_CONNECTED_SYNC_STATUS: SyncStatus = {
    ...DEFAULT_SYNC_STATUS,
    state: 'connected_clean',
    google_authenticated: true,
    sync_profile_id: 'prof_1',
    profile_name: 'test-user',
    google_account_email: 'sync@example.com',
    last_sync_at: '2026-04-02T00:00:00Z',
    device_name: 'Desk',
};

type SyncActionResultOverrides = Omit<Partial<SyncActionResult>, 'sync_status'> & {
    sync_status?: Partial<SyncStatus>;
};

export function buildSyncStatus(overrides: Partial<SyncStatus> = {}): SyncStatus {
    return {
        ...DEFAULT_SYNC_STATUS,
        ...overrides,
    };
}

export function buildConnectedSyncStatus(overrides: Partial<SyncStatus> = {}): SyncStatus {
    return {
        ...DEFAULT_CONNECTED_SYNC_STATUS,
        ...overrides,
    };
}

export function buildGoogleDriveAuthSession(
    overrides: Partial<GoogleDriveAuthSession> = {},
): GoogleDriveAuthSession {
    return {
        device_id: 'dev_1',
        google_account_email: 'sync@example.com',
        access_token_expires_at: null,
        ...overrides,
    };
}

export function buildRemoteSyncProfileSummary(
    overrides: Partial<RemoteSyncProfileSummary> = {},
): RemoteSyncProfileSummary {
    return {
        profile_id: 'prof_1',
        profile_name: 'test-user',
        snapshot_id: 'snap_1',
        remote_generation: 1,
        updated_at: '2026-04-02T00:00:00Z',
        last_writer_device_id: 'Desk',
        ...overrides,
    };
}

export function buildSyncAttachPreview(
    overrides: Partial<SyncAttachPreview> = {},
): SyncAttachPreview {
    return {
        profile_id: 'prof_1',
        profile_name: 'test-user',
        local_only_media_count: 0,
        remote_only_media_count: 0,
        matched_media_count: 3,
        potential_duplicate_titles: [],
        conflict_count: 0,
        ...overrides,
    };
}

export function buildSyncActionResult(
    overrides: SyncActionResultOverrides = {},
): SyncActionResult {
    const { sync_status, ...rest } = overrides;

    return {
        sync_status: buildConnectedSyncStatus(sync_status),
        safety_backup_path: null,
        published_snapshot_id: null,
        lost_race: false,
        remote_changed: false,
        ...rest,
    };
}
