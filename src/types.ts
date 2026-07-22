/**
 * Shared data-model interfaces — used by both the frontend and the service adapters.
 * Import types from here instead of from api.ts to avoid circular dependencies.
 */

export interface MediaCsvRow {
    "Title": string;
    "Variant"?: string;
    "Default Activity Type"?: string;
    "Media Type"?: string;
    "Status": string;
    "Language": string;
    "Description": string;
    "Content Type": string;
    "Extra Data": string;
    "Cover Image (Base64)": string;
}

export interface MediaConflict {
    incoming: MediaCsvRow;
    existing?: {
        title: string;
        variant: string;
        status: string;
    };
}

export interface ActivityCsvRow {
    "Date": string;
    "Log Name": string;
    "Default Activity Type": string;
    "Duration": number;
    "Language": string;
    "Characters": number;
    "Activity Type": string;
    "Notes": string;
    "Media Variant": string;
}

export interface ActivityCsvContent {
    log_name: string;
    media_variant: string;
    date: string;
    duration: number;
    characters: number;
    activity_type: string;
    notes: string;
}

export interface ActivityCsvGroup {
    content: ActivityCsvContent;
    incoming_count: number;
    existing_count: number;
    media_exists: boolean;
}

export interface ActivityCsvAnalysis {
    rows: ActivityCsvRow[];
    groups: ActivityCsvGroup[];
}

export type ActivityCsvConflictAction = 'skip_possible_overlaps' | 'import_all';

export interface ActivityCsvConflictResolution {
    content: ActivityCsvContent;
    action: ActivityCsvConflictAction;
}

export interface ActivityCsvImportRequest {
    rows: ActivityCsvRow[];
    analyzed_groups: ActivityCsvGroup[];
    resolutions: ActivityCsvConflictResolution[];
}

export interface ActivityCsvImportResult {
    imported_count: number;
    skipped_count: number;
}

export interface Media {
    id?: number;
    uid?: string;
    title: string;
    variant?: string;
    default_activity_type: string;
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
    notes?: string;
}

export interface ActivitySummary {
    id: number;
    media_id: number;
    title: string;
    activity_type: string;
    duration_minutes: number;
    characters: number;
    date: string;
    language: string;
    notes: string;
}

export interface DailyHeatmap {
    date: string;
    total_minutes: number;
    total_characters: number;
}

export type DashboardBucket = 'day' | 'month' | 'year';
export type DashboardGroupBy = 'activity_type' | 'log_name';

export interface DashboardSnapshotRequest {
    request_id: number;
    today: string;
    heatmap_year: number;
    recent_offset: number;
    recent_limit: number;
}

export interface DashboardRangeRequest {
    request_id: number;
    start_date: string;
    end_date: string;
    bucket: DashboardBucket;
    group_by: DashboardGroupBy;
}

export interface DashboardHeatmapYearRequest {
    request_id: number;
    year: number;
}

export interface DashboardRecentLogsRequest {
    request_id: number;
    offset: number;
    limit: number;
}

export interface DashboardMedia {
    id: number;
    title: string;
    variant: string;
    default_activity_type: string;
    status: string;
    cover_image: string;
    content_type: string;
    tracking_status: string;
}

export interface DashboardNamedTotals {
    key: string;
    label: string;
    total_minutes: number;
    total_characters: number;
}

export interface DashboardSummary {
    total_logs: number;
    total_media: number;
    logged_days: number;
    first_activity_date: string | null;
    last_activity_date: string | null;
    max_streak: number;
    current_streak: number;
    total_minutes: number;
    total_characters: number;
    activity_totals: DashboardNamedTotals[];
}

export interface DashboardRecentLog {
    id: number;
    media_id: number;
    title: string;
    variant: string;
    activity_type: string;
    duration_minutes: number;
    characters: number;
    date: string;
    language: string;
    notes: string;
}

export interface DashboardRecentPage {
    request_id: number;
    offset: number;
    limit: number;
    total_count: number;
    items: DashboardRecentLog[];
}

export interface DashboardChartPoint {
    bucket: string;
    group_key: string;
    group_label: string;
    total_minutes: number;
    total_characters: number;
}

export interface DashboardBucketTotals {
    bucket: string;
    total_minutes: number;
    total_characters: number;
}

export type DashboardHighlightKind =
    | 'most_time'
    | 'most_characters'
    | 'most_sessions'
    | 'biggest_day'
    | 'biggest_streak';

export interface DashboardHighlight {
    kind: DashboardHighlightKind;
    media: DashboardMedia | null;
    date: string | null;
    total_minutes: number;
    total_characters: number;
    sessions: number;
    streak_days: number;
}

export interface DashboardWeekdayStats {
    /** Sunday is 0 and Saturday is 6. */
    weekday: number;
    average_minutes: number;
    median_minutes: number;
    average_characters: number;
    median_characters: number;
    sample_days: number;
}

export interface DashboardWeekdayDistribution {
    start_date: string;
    end_date: string;
    days: DashboardWeekdayStats[];
}

export interface DashboardRangeResponse {
    request_id: number;
    start_date: string;
    end_date: string;
    bucket: DashboardBucket;
    group_by: DashboardGroupBy;
    series: DashboardChartPoint[];
    bucket_totals: DashboardBucketTotals[];
    category_totals: DashboardNamedTotals[];
    highlights: DashboardHighlight[];
}

export interface DashboardHeatmapYearResponse {
    request_id: number;
    year: number;
    days: DailyHeatmap[];
}

export interface DashboardSettings {
    chart_type: 'bar' | 'line';
    group_by: DashboardGroupBy;
    week_start_day: number;
    migrate_legacy_group_by: boolean;
}

export interface DashboardSnapshot {
    request_id: number;
    settings: DashboardSettings;
    summary: DashboardSummary;
    quick_log_media: DashboardMedia[];
    recent_logs: DashboardRecentPage;
    heatmap: DashboardHeatmapYearResponse;
    range: DashboardRangeResponse;
    weekday_distribution: DashboardWeekdayDistribution;
}

export interface LibrarySnapshotRequest {
    request_id: number;
}

export interface LibrarySettings {
    hide_archived: boolean;
    preferred_layout: 'grid' | 'list';
    grid_zoom: number;
}

export interface LibraryActivityMetricsDto {
    media_id: number;
    first_activity_date: string | null;
    last_activity_date: string | null;
    total_minutes: number;
}

export interface LibrarySnapshot {
    request_id: number;
    settings: LibrarySettings;
    media: Media[];
    metrics: LibraryActivityMetricsDto[];
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
    mediaVariant: string;
    coverImage: string;
    activityType: string;
    contentType: string;
    trackingStatus: string;
    milestoneName: string | null;
    milestoneId: number | null;
    firstDate: string;
    lastDate: string;
    totalMinutes: number;
    totalCharacters: number;
    milestoneMinutes: number;
    milestoneCharacters: number;
    sameDayTerminal: boolean;
}

export interface TimelinePageRequest {
    request_id: number;
    year: number | null;
    kind: TimelineEventKind | null;
    search_query: string;
    offset: number;
    limit: number;
}

export interface TimelineSummary {
    total_minutes: number;
    completed_titles: number;
    total_characters: number;
}

export interface TimelinePage {
    request_id: number;
    offset: number;
    limit: number;
    total_count: number;
    all_event_count: number;
    has_more: boolean;
    available_years: number[];
    ambiguous_titles: string[];
    summary: TimelineSummary;
    events: TimelineEvent[];
}

export interface Milestone {
    id?: number;
    media_uid: string;
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

export type LocalHttpApiScope = 'automation' | 'full';

export interface LocalHttpApiConfig {
    enabled: boolean;
    bindHost: string;
    port: number;
    scope: LocalHttpApiScope;
    allowedOrigins: string[];
}

export interface LocalHttpApiStatus extends LocalHttpApiConfig {
    supported: boolean;
    running: boolean;
    url: string | null;
    lastError: string | null;
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
    backup_size_bytes: number;
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
    variant: string;
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
    activities: Array<{
        date: string;
        activity_type: string;
        duration_minutes: number;
        characters: number;
        notes: string;
    }>;
    milestones: Array<{
        name: string;
        duration: number;
        characters: number;
        date: string | null;
    }>;
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

export interface DuplicateMediaIdentityConflict {
    kind: 'duplicate_media_identity';
    local_media: SyncConflictMediaAggregate;
    remote_media: SyncConflictMediaAggregate;
    remote_tombstone: SyncSnapshotTombstone;
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
    { conflict_token: string } & (
        | DuplicateMediaIdentityConflict
        | MediaFieldConflict
        | ExtraDataEntryConflict
        | DeleteVsUpdateConflict
        | ProfilePictureConflict
    );

export type SyncConflictResolution =
    | {
        kind: 'duplicate_media_identity_merge';
    }
    | {
        kind: 'duplicate_media_identity_keep_both';
        side: MergeSide;
        title: string;
        variant: string;
    }
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
