/**
 * Shared data-model interfaces — used by both the frontend and the service adapters.
 * Import types from here instead of from api.ts to avoid circular dependencies.
 */

export interface MediaCsvRow {
    "Title": string;
    "Media Type": string;
    "Status": string;
    "Language": string;
    "Description": string;
    "Content Type": string;
    "Extra Data": string;
    "Cover Image (Base64)": string;
}

export interface MediaConflict {
    incoming: MediaCsvRow;
    existing?: Media;
}

export interface Media {
    id?: number;
    uid?: string;
    title: string;
    media_type: string;
    status: string;
    language: string;
    description: string;
    cover_image: string;
    extra_data: string;
    content_type: string;
    tracking_status: string;
}

export interface ActivityLog {
    id?: number;
    media_id: number;
    duration_minutes: number;
    characters: number;
    date: string;
    activity_type?: string;
}

export interface ActivitySummary {
    id: number;
    media_id: number;
    title: string;
    media_type: string;
    duration_minutes: number;
    characters: number;
    date: string;
    language: string;
}

export interface DailyHeatmap {
    date: string;
    total_minutes: number;
    total_characters: number;
}

export type TimelineEventKind =
    | 'started'
    | 'finished'
    | 'paused'
    | 'dropped'
    | 'milestone';

export interface TimelineEvent {
    kind: TimelineEventKind;
    date: string;
    mediaId: number;
    mediaTitle: string;
    coverImage: string;
    activityType: string;
    contentType: string;
    trackingStatus: string;
    milestoneName: string | null;
    firstDate: string;
    lastDate: string;
    totalMinutes: number;
    totalCharacters: number;
    milestoneMinutes: number;
    milestoneCharacters: number;
    sameDayTerminal: boolean;
}

export interface Milestone {
    id?: number;
    media_uid?: string | null;
    media_title: string;
    name: string;
    duration: number;
    characters: number;
    date?: string;
}

export interface ProfilePicture {
    mime_type: string;
    base64_data: string;
    byte_size: number;
    width: number;
    height: number;
    updated_at: string;
}

export interface ReleaseInfo {
    version: string;
    body: string;
    url: string;
    publishedAt: string;
    prerelease: boolean;
}

export interface UpdateState {
    checking: boolean;
    autoCheckEnabled: boolean;
    availableRelease: ReleaseInfo | null;
    installedVersion: string;
    isSupported: boolean;
}

export type SyncConnectionState =
    | 'disconnected'
    | 'connected_clean'
    | 'dirty'
    | 'syncing'
    | 'conflict_pending'
    | 'error';

export type MergeSide = 'local' | 'remote';

export type DeleteVsUpdateChoice = 'respect_delete' | 'restore';

export type JsonValue =
    | string
    | number
    | boolean
    | null
    | JsonValue[]
    | { [key: string]: JsonValue };

export interface SyncStatus {
    state: SyncConnectionState;
    google_authenticated: boolean;
    sync_profile_id: string | null;
    profile_name: string | null;
    google_account_email: string | null;
    last_sync_at: string | null;
    device_name: string | null;
    conflict_count: number;
}

export interface GoogleDriveAuthSession {
    device_id: string;
    google_account_email: string | null;
    access_token_expires_at: string | null;
}

export interface RemoteSyncProfileSummary {
    profile_id: string;
    profile_name: string;
    snapshot_id: string;
    remote_generation: number;
    updated_at: string;
    last_writer_device_id: string;
}

export interface SyncActionResult {
    sync_status: SyncStatus;
    safety_backup_path: string | null;
    published_snapshot_id: string | null;
    lost_race: boolean;
    remote_changed: boolean;
}

export type SyncProgressOperation =
    | 'create_remote_sync_profile'
    | 'attach_remote_sync_profile'
    | 'run_sync'
    | 'replace_local_from_remote'
    | 'force_publish_local_as_remote';

export type SyncProgressStage =
    | 'loading_remote'
    | 'preparing_snapshot'
    | 'applying_remote_changes'
    | 'uploading_covers'
    | 'uploading_snapshot'
    | 'writing_manifest'
    | 'complete';

export interface SyncProgressUpdate {
    operation: SyncProgressOperation;
    stage: SyncProgressStage;
    current: number;
    total: number;
    message: string;
}

export interface SyncAttachPreview {
    profile_id: string;
    profile_name: string;
    local_only_media_count: number;
    remote_only_media_count: number;
    matched_media_count: number;
    potential_duplicate_titles: string[];
    conflict_count: number;
}

export interface SyncConflictMediaAggregate {
    uid: string;
    title: string;
    media_type: string;
    status: string;
    language: string;
    description: string;
    content_type: string;
    tracking_status: string;
    extra_data: string;
    cover_blob_sha256: string | null;
    updated_at: string;
    updated_by_device_id: string;
}

export interface SyncSnapshotTombstone {
    media_uid: string;
    deleted_at: string;
    deleted_by_device_id: string;
}

export interface SyncConflictProfilePicture {
    mime_type: string;
    base64_data: string;
    byte_size: number;
    width: number;
    height: number;
    updated_at: string;
    updated_by_device_id: string;
}

export interface MediaFieldConflict {
    kind: 'media_field_conflict';
    media_uid: string;
    field_name: string;
    base_value: string | null;
    local_value: string | null;
    remote_value: string | null;
}

export interface ExtraDataEntryConflict {
    kind: 'extra_data_entry_conflict';
    media_uid: string;
    entry_key: string;
    base_value: JsonValue | null;
    local_value: JsonValue | null;
    remote_value: JsonValue | null;
}

export interface DeleteVsUpdateConflict {
    kind: 'delete_vs_update';
    media_uid: string;
    deleted_side: MergeSide;
    tombstone: SyncSnapshotTombstone;
    base_media: SyncConflictMediaAggregate | null;
    local_media: SyncConflictMediaAggregate | null;
    remote_media: SyncConflictMediaAggregate | null;
}

export interface ProfilePictureConflict {
    kind: 'profile_picture_conflict';
    base_picture: SyncConflictProfilePicture | null;
    local_picture: SyncConflictProfilePicture | null;
    remote_picture: SyncConflictProfilePicture | null;
}

export type SyncConflict =
    | MediaFieldConflict
    | ExtraDataEntryConflict
    | DeleteVsUpdateConflict
    | ProfilePictureConflict;

export type SyncConflictResolution =
    | {
        kind: 'media_field';
        side: MergeSide;
    }
    | {
        kind: 'extra_data_entry';
        side: MergeSide;
    }
    | {
        kind: 'delete_vs_update';
        choice: DeleteVsUpdateChoice;
    }
    | {
        kind: 'profile_picture';
        side: MergeSide;
    };
