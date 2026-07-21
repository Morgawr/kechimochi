use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use chrono::Utc;
use futures::stream::{self, StreamExt};
use image::ImageFormat;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};

use crate::backup;
use crate::db;
use crate::sync_auth::{self, GoogleOAuthClientConfig, SecureTokenStore};
use crate::sync_drive::{
    self, DriveTransport, GoogleDriveClient, RemoteManifestFile, RemoteSyncManifest,
};
use crate::sync_merge::{self, MergeSide, SyncConflict};
use crate::sync_snapshot::{
    self, SnapshotBuildOptions, SnapshotMediaAggregate, SnapshotTombstone, SyncSnapshot,
};
use crate::sync_state::{self, SyncConfig, SyncLifecycleStatus, SyncStatus};

const COVER_UPLOAD_CONCURRENCY: usize = 4;
const COVER_DOWNLOAD_CONCURRENCY: usize = 8;
const COVER_UPLOAD_MAX_ATTEMPTS: usize = 3;
const COVER_UPLOAD_RETRY_DELAY_MS: u64 = 1_500;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RemoteSyncProfileSummary {
    pub profile_id: String,
    pub profile_name: String,
    pub snapshot_id: String,
    pub remote_generation: i64,
    pub updated_at: String,
    pub last_writer_device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncActionResult {
    pub sync_status: SyncStatus,
    #[serde(default)]
    pub safety_backup_path: Option<String>,
    #[serde(default)]
    pub published_snapshot_id: Option<String>,
    pub lost_race: bool,
    pub remote_changed: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AttachPreviewResult {
    pub profile_id: String,
    pub profile_name: String,
    pub local_only_media_count: usize,
    pub remote_only_media_count: usize,
    pub matched_media_count: usize,
    pub potential_duplicate_titles: Vec<String>,
    pub conflict_count: usize,
}

/// Conflict payload exposed across the IPC boundary. The token identifies the
/// exact queued value the client rendered without requiring it to echo large
/// conflict payloads (which can include activity histories or profile images).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncConflictView {
    pub conflict_token: String,
    #[serde(flatten)]
    pub conflict: SyncConflict,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeleteVsUpdateChoice {
    RespectDelete,
    Restore,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SyncConflictResolution {
    DuplicateMediaIdentityMerge,
    DuplicateMediaIdentityKeepBoth {
        side: MergeSide,
        title: String,
        #[serde(default)]
        variant: String,
    },
    MediaField {
        side: MergeSide,
    },
    ExtraDataEntry {
        side: MergeSide,
    },
    DeleteVsUpdate {
        choice: DeleteVsUpdateChoice,
    },
    ProfilePicture {
        side: MergeSide,
    },
}

struct BuiltSnapshot {
    snapshot: SyncSnapshot,
    created_at: String,
    device_id: String,
}

struct PublishSnapshotRequest<'a> {
    current_remote_generation: i64,
    snapshot: &'a SyncSnapshot,
    synced_at: &'a str,
    operation: SyncProgressOperation,
    progress: Option<&'a SyncProgressReporter>,
}

struct JournaledConflictResolutionRequest<'a> {
    conflict_index: usize,
    conflict_token: &'a str,
    resolution: SyncConflictResolution,
}

struct ReplaceLocalRecoveryRequest<'a> {
    recovered_at: &'a str,
    operation_id: Option<String>,
    database_applied: bool,
    progress: Option<&'a SyncProgressReporter>,
}

struct MaterializeCoverBlobsRequest<'a> {
    snapshot: &'a SyncSnapshot,
    cas_baseline: Option<&'a SyncSnapshot>,
    operation: SyncProgressOperation,
    progress: Option<&'a SyncProgressReporter>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncProgressOperation {
    CreateRemoteSyncProfile,
    AttachRemoteSyncProfile,
    RunSync,
    ReplaceLocalFromRemote,
    ForcePublishLocalAsRemote,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncProgressStage {
    LoadingRemote,
    PreparingSnapshot,
    ApplyingRemoteChanges,
    UploadingCovers,
    UploadingSnapshot,
    WritingManifest,
    Complete,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncProgressUpdate {
    pub operation: SyncProgressOperation,
    pub stage: SyncProgressStage,
    pub current: usize,
    pub total: usize,
    pub message: String,
}

pub type SyncProgressReporter = dyn Fn(SyncProgressUpdate) + Send + Sync;

fn report_progress(
    operation: SyncProgressOperation,
    progress: Option<&SyncProgressReporter>,
    stage: SyncProgressStage,
    current: usize,
    total: usize,
    message: String,
) {
    if let Some(progress) = progress {
        progress(SyncProgressUpdate {
            operation,
            stage,
            current,
            total,
            message,
        });
    }
}

pub async fn list_remote_sync_profiles(
    auth_config: &GoogleOAuthClientConfig,
    token_store: &dyn SecureTokenStore,
) -> Result<Vec<RemoteSyncProfileSummary>, String> {
    let client = GoogleDriveClient::new(auth_config.clone())?;
    list_remote_sync_profiles_with_client(&client, token_store).await
}

pub async fn create_remote_sync_profile(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    auth_config: &GoogleOAuthClientConfig,
    token_store: &dyn SecureTokenStore,
    device_name_override: Option<String>,
) -> Result<SyncActionResult, String> {
    create_remote_sync_profile_with_progress(
        app_dir,
        conn,
        auth_config,
        token_store,
        device_name_override,
        None,
    )
    .await
}

pub async fn create_remote_sync_profile_with_progress(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    auth_config: &GoogleOAuthClientConfig,
    token_store: &dyn SecureTokenStore,
    device_name_override: Option<String>,
    progress: Option<&SyncProgressReporter>,
) -> Result<SyncActionResult, String> {
    let client = GoogleDriveClient::new(auth_config.clone())?;
    create_remote_sync_profile_with_client(
        app_dir,
        conn,
        &client,
        token_store,
        device_name_override,
        progress,
    )
    .await
}

pub async fn attach_remote_sync_profile(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    auth_config: &GoogleOAuthClientConfig,
    token_store: &dyn SecureTokenStore,
    profile_id: &str,
    device_name_override: Option<String>,
) -> Result<SyncActionResult, String> {
    attach_remote_sync_profile_with_progress(
        app_dir,
        conn,
        auth_config,
        token_store,
        profile_id,
        device_name_override,
        None,
    )
    .await
}

pub async fn attach_remote_sync_profile_with_progress(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    auth_config: &GoogleOAuthClientConfig,
    token_store: &dyn SecureTokenStore,
    profile_id: &str,
    device_name_override: Option<String>,
    progress: Option<&SyncProgressReporter>,
) -> Result<SyncActionResult, String> {
    let client = GoogleDriveClient::new(auth_config.clone())?;
    attach_remote_sync_profile_with_client(
        app_dir,
        conn,
        &client,
        token_store,
        profile_id,
        device_name_override,
        progress,
    )
    .await
}

pub async fn preview_attach_remote_sync_profile(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    auth_config: &GoogleOAuthClientConfig,
    token_store: &dyn SecureTokenStore,
    profile_id: &str,
) -> Result<AttachPreviewResult, String> {
    let client = GoogleDriveClient::new(auth_config.clone())?;
    preview_attach_remote_sync_profile_with_client(app_dir, conn, &client, token_store, profile_id)
        .await
}

pub async fn run_sync(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    auth_config: &GoogleOAuthClientConfig,
    token_store: &dyn SecureTokenStore,
) -> Result<SyncActionResult, String> {
    run_sync_with_progress(app_dir, conn, auth_config, token_store, None).await
}

pub async fn run_sync_with_progress(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    auth_config: &GoogleOAuthClientConfig,
    token_store: &dyn SecureTokenStore,
    progress: Option<&SyncProgressReporter>,
) -> Result<SyncActionResult, String> {
    let client = GoogleDriveClient::new(auth_config.clone())?;
    run_sync_with_client(app_dir, conn, &client, token_store, progress).await
}

pub async fn replace_local_from_remote(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    auth_config: &GoogleOAuthClientConfig,
    token_store: &dyn SecureTokenStore,
) -> Result<SyncActionResult, String> {
    replace_local_from_remote_with_progress(app_dir, conn, auth_config, token_store, None).await
}

pub async fn replace_local_from_remote_with_progress(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    auth_config: &GoogleOAuthClientConfig,
    token_store: &dyn SecureTokenStore,
    progress: Option<&SyncProgressReporter>,
) -> Result<SyncActionResult, String> {
    let client = GoogleDriveClient::new(auth_config.clone())?;
    replace_local_from_remote_with_client(app_dir, conn, &client, token_store, progress).await
}

pub async fn force_publish_local_as_remote(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    auth_config: &GoogleOAuthClientConfig,
    token_store: &dyn SecureTokenStore,
) -> Result<SyncActionResult, String> {
    force_publish_local_as_remote_with_progress(app_dir, conn, auth_config, token_store, None).await
}

pub async fn force_publish_local_as_remote_with_progress(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    auth_config: &GoogleOAuthClientConfig,
    token_store: &dyn SecureTokenStore,
    progress: Option<&SyncProgressReporter>,
) -> Result<SyncActionResult, String> {
    let client = GoogleDriveClient::new(auth_config.clone())?;
    force_publish_local_as_remote_with_client(app_dir, conn, &client, token_store, progress).await
}

pub fn get_sync_conflicts(app_dir: &Path) -> Result<Vec<SyncConflictView>, String> {
    let _lock = sync_state::acquire_sync_lock(app_dir)?;
    if let Some(mut pending) = sync_state::load_pending_sync_state(app_dir)? {
        let repaired_tokens = reconcile_conflict_tokens(
            &pending.conflicts,
            &pending.conflict_tokens,
            &pending.conflicts,
        );
        if repaired_tokens != pending.conflict_tokens {
            pending.conflict_tokens = repaired_tokens;
            sync_state::save_pending_sync_state(app_dir, &pending)?;
        }
        return Ok(pending
            .conflicts
            .into_iter()
            .zip(pending.conflict_tokens)
            .map(|(conflict, conflict_token)| SyncConflictView {
                conflict_token,
                conflict,
            })
            .collect());
    }

    // Pre-journal builds stored only the conflict payload. Its content hash is
    // stable long enough to authenticate migration into the new journal at the
    // first resolution request; every new queue uses random persisted tokens.
    sync_state::load_pending_conflicts(app_dir)?
        .into_iter()
        .map(|conflict| {
            Ok(SyncConflictView {
                conflict_token: legacy_sync_conflict_token(&conflict)?,
                conflict,
            })
        })
        .collect()
}

pub async fn resolve_sync_conflict(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    auth_config: &GoogleOAuthClientConfig,
    token_store: &dyn SecureTokenStore,
    conflict_index: usize,
    conflict_token: String,
    resolution: SyncConflictResolution,
) -> Result<SyncActionResult, String> {
    let client = GoogleDriveClient::new(auth_config.clone())?;
    resolve_sync_conflict_with_client(
        app_dir,
        conn,
        &client,
        token_store,
        conflict_index,
        &conflict_token,
        resolution,
    )
    .await
}

async fn list_remote_sync_profiles_with_client<T: DriveTransport>(
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
) -> Result<Vec<RemoteSyncProfileSummary>, String> {
    Ok(client
        .list_remote_sync_profiles(token_store)
        .await?
        .into_iter()
        .map(|entry| RemoteSyncProfileSummary {
            profile_id: entry.manifest.profile_id,
            profile_name: entry.manifest.profile_name,
            snapshot_id: entry.manifest.snapshot_id,
            remote_generation: entry.manifest.remote_generation,
            updated_at: entry.manifest.updated_at,
            last_writer_device_id: entry.manifest.last_writer_device_id,
        })
        .collect())
}

async fn create_remote_sync_profile_with_client<T: DriveTransport>(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    device_name_override: Option<String>,
    progress: Option<&SyncProgressReporter>,
) -> Result<SyncActionResult, String> {
    let _lock = sync_state::acquire_sync_lock(app_dir)?;
    if sync_state::load_sync_config(app_dir)?.is_some() {
        return Err("Sync is already configured for this profile".to_string());
    }

    let google_account_email = sync_auth::load_google_account_email(token_store)?;
    let profile_id = generate_prefixed_id("prof");
    let built_snapshot = build_local_snapshot_with_progress(
        app_dir,
        conn,
        &profile_id,
        None,
        SyncProgressOperation::CreateRemoteSyncProfile,
        progress,
    )?;

    upload_missing_cover_blobs_with_client(
        conn,
        &built_snapshot.snapshot,
        client,
        token_store,
        SyncProgressOperation::CreateRemoteSyncProfile,
        progress,
    )
    .await?;
    report_progress(
        SyncProgressOperation::CreateRemoteSyncProfile,
        progress,
        SyncProgressStage::UploadingSnapshot,
        0,
        1,
        "Uploading the initial cloud snapshot...".to_string(),
    );
    let uploaded_snapshot = client
        .upload_snapshot(token_store, &profile_id, &built_snapshot.snapshot)
        .await?;
    report_progress(
        SyncProgressOperation::CreateRemoteSyncProfile,
        progress,
        SyncProgressStage::UploadingSnapshot,
        1,
        1,
        "Initial cloud snapshot uploaded.".to_string(),
    );

    let manifest = RemoteSyncManifest::new(
        &profile_id,
        &built_snapshot.snapshot.profile.profile_name,
        &built_snapshot.snapshot.snapshot_id,
        &uploaded_snapshot.snapshot_sha256,
        1,
        &built_snapshot.created_at,
        &built_snapshot.device_id,
    );
    report_progress(
        SyncProgressOperation::CreateRemoteSyncProfile,
        progress,
        SyncProgressStage::WritingManifest,
        0,
        1,
        "Saving the cloud sync profile manifest...".to_string(),
    );
    let manifest_write = client
        .upsert_manifest_and_confirm(token_store, &manifest)
        .await?;
    if !manifest_write.race_won {
        return Err("Remote manifest changed unexpectedly while creating sync profile".to_string());
    }
    report_progress(
        SyncProgressOperation::CreateRemoteSyncProfile,
        progress,
        SyncProgressStage::WritingManifest,
        1,
        1,
        "Cloud sync profile manifest saved.".to_string(),
    );

    sync_state::clear_pending_conflicts(app_dir)?;
    sync_state::clear_pending_merged_snapshot(app_dir)?;
    sync_state::clear_pending_sync_state(app_dir)?;
    let mut config = SyncConfig {
        sync_profile_id: profile_id.clone(),
        profile_name: built_snapshot.snapshot.profile.profile_name.clone(),
        google_account_email,
        remote_manifest_name: sync_drive::manifest_file_name(&profile_id),
        last_confirmed_snapshot_id: Some(built_snapshot.snapshot.snapshot_id.clone()),
        last_sync_at: Some(built_snapshot.created_at.clone()),
        last_sync_status: SyncLifecycleStatus::Clean,
        device_name: device_name_override.unwrap_or_else(default_device_name),
    };
    {
        let finalized_at = Utc::now().to_rfc3339();
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let tombstones = derive_local_tombstones(
            &conn_guard,
            Some(&built_snapshot.snapshot),
            &finalized_at,
            &built_snapshot.device_id,
        )?;
        let live = sync_snapshot::build_snapshot(
            &conn_guard,
            SnapshotBuildOptions {
                snapshot_id: &generate_prefixed_id("snap"),
                created_at: &finalized_at,
                created_by_device_id: &built_snapshot.device_id,
                profile_id: &profile_id,
                base_snapshot: Some(&built_snapshot.snapshot),
                tombstones: &tombstones,
            },
        )?;
        config.last_sync_status = if snapshots_logically_equal(&live, &built_snapshot.snapshot) {
            SyncLifecycleStatus::Clean
        } else {
            SyncLifecycleStatus::Dirty
        };
        sync_state::save_base_snapshot(app_dir, &built_snapshot.snapshot)?;
        sync_state::save_sync_config(app_dir, &config)?;
    }
    report_progress(
        SyncProgressOperation::CreateRemoteSyncProfile,
        progress,
        SyncProgressStage::Complete,
        1,
        1,
        "Cloud sync is ready to use.".to_string(),
    );

    build_action_result(
        app_dir,
        token_store,
        None,
        Some(built_snapshot.snapshot.snapshot_id),
        false,
        false,
    )
}

async fn attach_remote_sync_profile_with_client<T: DriveTransport>(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    profile_id: &str,
    device_name_override: Option<String>,
    progress: Option<&SyncProgressReporter>,
) -> Result<SyncActionResult, String> {
    let _lock = sync_state::acquire_sync_lock(app_dir)?;
    if sync_state::load_sync_config(app_dir)?.is_some() {
        return Err("Sync is already configured for this profile".to_string());
    }

    let safety_backup_path = create_local_safety_backup(app_dir, conn)?;
    let google_account_email = sync_auth::load_google_account_email(token_store)?;
    report_progress(
        SyncProgressOperation::AttachRemoteSyncProfile,
        progress,
        SyncProgressStage::LoadingRemote,
        0,
        2,
        "Loading remote sync profile...".to_string(),
    );
    let remote_manifest = load_remote_manifest(client, token_store, profile_id).await?;
    report_progress(
        SyncProgressOperation::AttachRemoteSyncProfile,
        progress,
        SyncProgressStage::LoadingRemote,
        1,
        2,
        "Downloading remote snapshot...".to_string(),
    );
    let remote_snapshot = download_remote_snapshot(client, token_store, &remote_manifest).await?;
    report_progress(
        SyncProgressOperation::AttachRemoteSyncProfile,
        progress,
        SyncProgressStage::LoadingRemote,
        2,
        2,
        "Remote snapshot downloaded.".to_string(),
    );
    let local_snapshot = build_local_snapshot_with_progress(
        app_dir,
        conn,
        profile_id,
        None,
        SyncProgressOperation::AttachRemoteSyncProfile,
        progress,
    )?;
    let local_is_pristine_attach_shell = is_pristine_attach_shell(&local_snapshot.snapshot);
    let mut merge_outcome =
        sync_merge::merge_snapshots(None, &local_snapshot.snapshot, &remote_snapshot)?;
    if local_is_pristine_attach_shell {
        merge_outcome.merged_snapshot.profile = remote_snapshot.profile.clone();
    }
    merge_outcome
        .conflicts
        .extend(duplicate_media_identity_conflicts(
            &local_snapshot.snapshot,
            &remote_snapshot,
            &merge_outcome.merged_snapshot,
            &local_snapshot.created_at,
            &local_snapshot.device_id,
        ));
    let has_identity_conflicts = has_duplicate_media_identity_conflicts(&merge_outcome.conflicts);
    let next_config = SyncConfig {
        sync_profile_id: profile_id.to_string(),
        profile_name: merge_outcome.merged_snapshot.profile.profile_name.clone(),
        google_account_email,
        remote_manifest_name: sync_drive::manifest_file_name(profile_id),
        last_confirmed_snapshot_id: Some(remote_snapshot.snapshot_id.clone()),
        last_sync_at: Some(local_snapshot.created_at.clone()),
        last_sync_status: if merge_outcome.conflicts.is_empty() {
            SyncLifecycleStatus::Dirty
        } else {
            SyncLifecycleStatus::ConflictPending
        },
        device_name: device_name_override.unwrap_or_else(default_device_name),
    };

    let queued = queue_pending_sync_with_client(
        app_dir,
        conn,
        client,
        token_store,
        QueuePendingSyncRequest {
            local_baseline: &local_snapshot.snapshot,
            merged_snapshot: &merge_outcome.merged_snapshot,
            remote_base_snapshot: &remote_snapshot,
            conflicts: &merge_outcome.conflicts,
            config: next_config,
            apply_snapshot_now: !has_identity_conflicts,
            operation: SyncProgressOperation::AttachRemoteSyncProfile,
            progress,
        },
    )
    .await?;
    merge_outcome.merged_snapshot = queued.snapshot;
    merge_outcome.conflicts = queued.conflicts;

    if !merge_outcome.conflicts.is_empty() {
        report_progress(
            SyncProgressOperation::AttachRemoteSyncProfile,
            progress,
            SyncProgressStage::Complete,
            1,
            1,
            format!(
                "Remote data was attached. {} conflict{} need review before publishing.",
                merge_outcome.conflicts.len(),
                if merge_outcome.conflicts.len() == 1 {
                    ""
                } else {
                    "s"
                }
            ),
        );
        return build_action_result(
            app_dir,
            token_store,
            Some(safety_backup_path),
            None,
            false,
            true,
        );
    }

    let synced_at = merge_outcome.merged_snapshot.created_at.clone();
    publish_snapshot_with_client(
        app_dir,
        conn,
        client,
        token_store,
        PublishSnapshotRequest {
            current_remote_generation: remote_manifest.manifest.remote_generation,
            snapshot: &merge_outcome.merged_snapshot,
            synced_at: &synced_at,
            operation: SyncProgressOperation::AttachRemoteSyncProfile,
            progress,
        },
    )
    .await
    .map(|mut result| {
        result.safety_backup_path = Some(safety_backup_path);
        result.remote_changed = true;
        result
    })
}

async fn preview_attach_remote_sync_profile_with_client<T: DriveTransport>(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    profile_id: &str,
) -> Result<AttachPreviewResult, String> {
    let _lock = sync_state::acquire_sync_lock(app_dir)?;
    if sync_state::load_sync_config(app_dir)?.is_some() {
        return Err("Sync is already configured for this profile".to_string());
    }

    let remote_manifest = load_remote_manifest(client, token_store, profile_id).await?;
    let remote_snapshot = download_remote_snapshot(client, token_store, &remote_manifest).await?;
    let local_snapshot = build_local_snapshot(app_dir, conn, profile_id, None)?;
    let mut merge_outcome =
        sync_merge::merge_snapshots(None, &local_snapshot.snapshot, &remote_snapshot)?;
    merge_outcome
        .conflicts
        .extend(duplicate_media_identity_conflicts(
            &local_snapshot.snapshot,
            &remote_snapshot,
            &merge_outcome.merged_snapshot,
            &local_snapshot.created_at,
            &local_snapshot.device_id,
        ));

    let local_uids = local_snapshot
        .snapshot
        .library
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>();
    let remote_uids = remote_snapshot
        .library
        .keys()
        .cloned()
        .collect::<BTreeSet<_>>();
    let matched_media_count = local_uids.intersection(&remote_uids).count();
    let local_only_media_count = local_uids.difference(&remote_uids).count();
    let remote_only_media_count = remote_uids.difference(&local_uids).count();

    Ok(AttachPreviewResult {
        profile_id: profile_id.to_string(),
        profile_name: remote_snapshot.profile.profile_name.clone(),
        local_only_media_count,
        remote_only_media_count,
        matched_media_count,
        potential_duplicate_titles: find_potential_duplicate_titles(
            &local_snapshot.snapshot,
            &remote_snapshot,
        ),
        conflict_count: merge_outcome.conflicts.len(),
    })
}

fn is_pristine_attach_shell(snapshot: &SyncSnapshot) -> bool {
    snapshot.profile.profile_name == "default"
        && snapshot.library.is_empty()
        && snapshot.settings.is_empty()
        && snapshot.profile_picture.is_none()
        && snapshot.tombstones.is_empty()
}

async fn run_sync_with_client<T: DriveTransport>(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    progress: Option<&SyncProgressReporter>,
) -> Result<SyncActionResult, String> {
    let _lock = sync_state::acquire_sync_lock(app_dir)?;
    let recovered = recover_pending_snapshot_apply(
        app_dir,
        conn,
        client,
        token_store,
        SyncProgressOperation::RunSync,
        progress,
    )
    .await?;
    if let Some(result) = recovered.action_result {
        return Ok(result);
    }
    let Some(config) = sync_state::load_sync_config(app_dir)? else {
        return Err("Sync is not configured for this profile".to_string());
    };

    if sync_state::has_pending_sync_state(app_dir)
        || !sync_state::load_pending_conflicts(app_dir)?.is_empty()
    {
        sync_state::update_sync_config(app_dir, |current| {
            current.last_sync_status = SyncLifecycleStatus::ConflictPending;
        })?;
        return build_action_result(app_dir, token_store, None, None, false, false);
    }

    sync_state::update_sync_config(app_dir, |current| {
        current.last_sync_status = SyncLifecycleStatus::Syncing;
    })?;

    let result = run_sync_inner(app_dir, conn, client, token_store, &config, progress).await;
    if let Err(err) = &result {
        let _ = sync_state::update_sync_config(app_dir, |current| {
            current.last_sync_status = SyncLifecycleStatus::Error;
        });
        return Err(err.clone());
    }

    result
}

async fn replace_local_from_remote_with_client<T: DriveTransport>(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    progress: Option<&SyncProgressReporter>,
) -> Result<SyncActionResult, String> {
    let _lock = sync_state::acquire_sync_lock(app_dir)?;
    if sync_state::load_pending_sync_state(app_dir)?.is_some_and(|pending| {
        matches!(
            pending.phase,
            sync_state::PendingSyncPhase::ReplacingLocalFromRemote { .. }
        )
    }) {
        recover_pending_snapshot_apply(
            app_dir,
            conn,
            client,
            token_store,
            SyncProgressOperation::ReplaceLocalFromRemote,
            progress,
        )
        .await?;
        return build_action_result(app_dir, token_store, None, None, false, true);
    }
    let Some(config) = sync_state::load_sync_config(app_dir)? else {
        return Err("Sync is not configured for this profile".to_string());
    };

    sync_state::update_sync_config(app_dir, |current| {
        current.last_sync_status = SyncLifecycleStatus::Syncing;
    })?;

    let result =
        replace_local_from_remote_inner(app_dir, conn, client, token_store, &config, progress)
            .await;
    if let Err(err) = &result {
        let _ = sync_state::update_sync_config(app_dir, |current| {
            current.last_sync_status = SyncLifecycleStatus::Error;
        });
        return Err(err.clone());
    }

    result
}

async fn force_publish_local_as_remote_with_client<T: DriveTransport>(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    progress: Option<&SyncProgressReporter>,
) -> Result<SyncActionResult, String> {
    let _lock = sync_state::acquire_sync_lock(app_dir)?;
    if sync_state::load_pending_sync_state(app_dir)?.is_some_and(|pending| {
        matches!(
            pending.phase,
            sync_state::PendingSyncPhase::ForcePublishingLocal { .. }
        )
    }) {
        let recovered = recover_pending_snapshot_apply(
            app_dir,
            conn,
            client,
            token_store,
            SyncProgressOperation::ForcePublishLocalAsRemote,
            progress,
        )
        .await?;
        return recovered.action_result.ok_or_else(|| {
            "Force publish journal recovery completed without a publish result".to_string()
        });
    }
    let Some(config) = sync_state::load_sync_config(app_dir)? else {
        return Err("Sync is not configured for this profile".to_string());
    };

    sync_state::update_sync_config(app_dir, |current| {
        current.last_sync_status = SyncLifecycleStatus::Syncing;
    })?;

    let result =
        force_publish_local_as_remote_inner(app_dir, conn, client, token_store, &config, progress)
            .await;
    if let Err(err) = &result {
        let _ = sync_state::update_sync_config(app_dir, |current| {
            current.last_sync_status = SyncLifecycleStatus::Error;
        });
        return Err(err.clone());
    }

    result
}

async fn run_sync_inner<T: DriveTransport>(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    config: &SyncConfig,
    progress: Option<&SyncProgressReporter>,
) -> Result<SyncActionResult, String> {
    let base_snapshot = sync_state::load_base_snapshot(app_dir)?
        .ok_or_else(|| "Missing local base snapshot. Reconnect or recreate sync.".to_string())?;
    report_progress(
        SyncProgressOperation::RunSync,
        progress,
        SyncProgressStage::LoadingRemote,
        0,
        2,
        "Loading remote sync state...".to_string(),
    );
    let remote_manifest =
        load_remote_manifest(client, token_store, &config.sync_profile_id).await?;
    report_progress(
        SyncProgressOperation::RunSync,
        progress,
        SyncProgressStage::LoadingRemote,
        1,
        2,
        "Remote sync state loaded.".to_string(),
    );

    if remote_manifest.manifest.snapshot_id == base_snapshot.snapshot_id {
        let local_snapshot = build_local_snapshot_with_progress(
            app_dir,
            conn,
            &config.sync_profile_id,
            Some(&base_snapshot),
            SyncProgressOperation::RunSync,
            progress,
        )?;
        if snapshots_logically_equal(&local_snapshot.snapshot, &base_snapshot) {
            match finalize_clean_if_local_still_matches_base_with_hook(
                app_dir,
                conn,
                &config.sync_profile_id,
                &base_snapshot,
                || {},
            )? {
                None => {
                    report_progress(
                        SyncProgressOperation::RunSync,
                        progress,
                        SyncProgressStage::Complete,
                        1,
                        1,
                        "Cloud sync is already up to date.".to_string(),
                    );
                    return build_action_result(app_dir, token_store, None, None, false, false);
                }
                Some(fresh_local_snapshot) => {
                    // A DB writer landed after the first snapshot capture. Use
                    // the state observed while holding the finalization mutex;
                    // never overwrite its Dirty transition with stale Clean.
                    return publish_snapshot_with_client(
                        app_dir,
                        conn,
                        client,
                        token_store,
                        PublishSnapshotRequest {
                            current_remote_generation: remote_manifest.manifest.remote_generation,
                            snapshot: &fresh_local_snapshot.snapshot,
                            synced_at: &fresh_local_snapshot.created_at,
                            operation: SyncProgressOperation::RunSync,
                            progress,
                        },
                    )
                    .await;
                }
            }
        }

        return publish_snapshot_with_client(
            app_dir,
            conn,
            client,
            token_store,
            PublishSnapshotRequest {
                current_remote_generation: remote_manifest.manifest.remote_generation,
                snapshot: &local_snapshot.snapshot,
                synced_at: &local_snapshot.created_at,
                operation: SyncProgressOperation::RunSync,
                progress,
            },
        )
        .await;
    }

    report_progress(
        SyncProgressOperation::RunSync,
        progress,
        SyncProgressStage::LoadingRemote,
        1,
        2,
        "Downloading remote snapshot...".to_string(),
    );
    let remote_snapshot = download_remote_snapshot(client, token_store, &remote_manifest).await?;
    report_progress(
        SyncProgressOperation::RunSync,
        progress,
        SyncProgressStage::LoadingRemote,
        2,
        2,
        "Remote snapshot downloaded.".to_string(),
    );
    let local_snapshot = build_local_snapshot_with_progress(
        app_dir,
        conn,
        &config.sync_profile_id,
        Some(&base_snapshot),
        SyncProgressOperation::RunSync,
        progress,
    )?;
    let mut merge_outcome = sync_merge::merge_snapshots(
        Some(&base_snapshot),
        &local_snapshot.snapshot,
        &remote_snapshot,
    )?;
    merge_outcome
        .conflicts
        .extend(duplicate_media_identity_conflicts(
            &local_snapshot.snapshot,
            &remote_snapshot,
            &merge_outcome.merged_snapshot,
            &local_snapshot.created_at,
            &local_snapshot.device_id,
        ));
    let has_identity_conflicts = has_duplicate_media_identity_conflicts(&merge_outcome.conflicts);

    if !merge_outcome.conflicts.is_empty() {
        let mut pending_config = config.clone();
        pending_config.profile_name = merge_outcome.merged_snapshot.profile.profile_name.clone();
        pending_config.last_confirmed_snapshot_id = Some(remote_snapshot.snapshot_id.clone());
        pending_config.last_sync_at = Some(local_snapshot.created_at.clone());
        pending_config.last_sync_status = SyncLifecycleStatus::ConflictPending;
        let queued = queue_pending_sync_with_client(
            app_dir,
            conn,
            client,
            token_store,
            QueuePendingSyncRequest {
                local_baseline: &local_snapshot.snapshot,
                merged_snapshot: &merge_outcome.merged_snapshot,
                remote_base_snapshot: &remote_snapshot,
                conflicts: &merge_outcome.conflicts,
                config: pending_config,
                apply_snapshot_now: !has_identity_conflicts,
                operation: SyncProgressOperation::RunSync,
                progress,
            },
        )
        .await?;
        merge_outcome.merged_snapshot = queued.snapshot;
        merge_outcome.conflicts = queued.conflicts;
        report_progress(
            SyncProgressOperation::RunSync,
            progress,
            SyncProgressStage::Complete,
            1,
            1,
            format!(
                "Sync downloaded remote changes. {} conflict{} need review before publishing.",
                merge_outcome.conflicts.len(),
                if merge_outcome.conflicts.len() == 1 {
                    ""
                } else {
                    "s"
                }
            ),
        );
        return build_action_result(app_dir, token_store, None, None, false, true);
    }

    let mut applying_config = config.clone();
    applying_config.profile_name = merge_outcome.merged_snapshot.profile.profile_name.clone();
    applying_config.last_confirmed_snapshot_id = Some(remote_snapshot.snapshot_id.clone());
    applying_config.last_sync_at = Some(local_snapshot.created_at.clone());
    applying_config.last_sync_status = SyncLifecycleStatus::Dirty;
    let queued = queue_pending_sync_with_client(
        app_dir,
        conn,
        client,
        token_store,
        QueuePendingSyncRequest {
            local_baseline: &local_snapshot.snapshot,
            merged_snapshot: &merge_outcome.merged_snapshot,
            remote_base_snapshot: &remote_snapshot,
            conflicts: &[],
            config: applying_config,
            apply_snapshot_now: true,
            operation: SyncProgressOperation::RunSync,
            progress,
        },
    )
    .await?;
    merge_outcome.merged_snapshot = queued.snapshot;
    merge_outcome.conflicts = queued.conflicts;

    if !merge_outcome.conflicts.is_empty() {
        report_progress(
            SyncProgressOperation::RunSync,
            progress,
            SyncProgressStage::Complete,
            1,
            1,
            format!(
                "Sync detected {} conflict{} while committing live local edits.",
                merge_outcome.conflicts.len(),
                if merge_outcome.conflicts.len() == 1 {
                    ""
                } else {
                    "s"
                }
            ),
        );
        return build_action_result(app_dir, token_store, None, None, false, true);
    }

    let synced_at = merge_outcome.merged_snapshot.created_at.clone();
    publish_snapshot_with_client(
        app_dir,
        conn,
        client,
        token_store,
        PublishSnapshotRequest {
            current_remote_generation: remote_manifest.manifest.remote_generation,
            snapshot: &merge_outcome.merged_snapshot,
            synced_at: &synced_at,
            operation: SyncProgressOperation::RunSync,
            progress,
        },
    )
    .await
    .map(|mut result| {
        result.remote_changed = true;
        result
    })
}

async fn replace_local_from_remote_inner<T: DriveTransport>(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    config: &SyncConfig,
    progress: Option<&SyncProgressReporter>,
) -> Result<SyncActionResult, String> {
    let safety_backup_path = create_local_safety_backup(app_dir, conn)?;
    let operation_result = async {
        report_progress(
            SyncProgressOperation::ReplaceLocalFromRemote,
            progress,
            SyncProgressStage::LoadingRemote,
            0,
            2,
            "Loading remote sync state...".to_string(),
        );
        let remote_manifest =
            load_remote_manifest(client, token_store, &config.sync_profile_id).await?;
        report_progress(
            SyncProgressOperation::ReplaceLocalFromRemote,
            progress,
            SyncProgressStage::LoadingRemote,
            1,
            2,
            "Downloading the latest cloud snapshot...".to_string(),
        );
        let remote_snapshot =
            download_remote_snapshot(client, token_store, &remote_manifest).await?;
        report_progress(
            SyncProgressOperation::ReplaceLocalFromRemote,
            progress,
            SyncProgressStage::LoadingRemote,
            2,
            2,
            "Cloud snapshot downloaded.".to_string(),
        );

        let google_account_email = sync_auth::load_google_account_email(token_store)?;
        let recovered_at = Utc::now().to_rfc3339();
        let mut replacement_config = config.clone();
        replacement_config.profile_name = remote_snapshot.profile.profile_name.clone();
        replacement_config.google_account_email = google_account_email;
        replacement_config.last_confirmed_snapshot_id = Some(remote_snapshot.snapshot_id.clone());
        replacement_config.last_sync_at = Some(recovered_at.clone());
        replacement_config.last_sync_status = SyncLifecycleStatus::Clean;
        let local_baseline = if let Some(pending) = sync_state::load_pending_sync_state(app_dir)? {
            pending.local_baseline
        } else {
            build_local_snapshot(
                app_dir,
                conn,
                &config.sync_profile_id,
                sync_state::load_base_snapshot(app_dir)?.as_ref(),
            )?
            .snapshot
        };
        let replacement = sync_state::PendingSyncState {
            version: sync_state::PENDING_SYNC_STATE_VERSION,
            conflicts: Vec::new(),
            conflict_tokens: Vec::new(),
            local_baseline,
            merged_snapshot: remote_snapshot.clone(),
            remote_base_snapshot: remote_snapshot.clone(),
            config: replacement_config,
            phase: sync_state::PendingSyncPhase::ReplacingLocalFromRemote {
                recovered_at: recovered_at.clone(),
                operation_id: Some(generate_prefixed_id("replace")),
                database_applied: false,
            },
        };
        sync_state::clear_completed_resolution(app_dir)?;
        sync_state::save_pending_sync_state(app_dir, &replacement)?;
        recover_pending_snapshot_apply(
            app_dir,
            conn,
            client,
            token_store,
            SyncProgressOperation::ReplaceLocalFromRemote,
            progress,
        )
        .await?;
        report_progress(
            SyncProgressOperation::ReplaceLocalFromRemote,
            progress,
            SyncProgressStage::Complete,
            1,
            1,
            "Local state was replaced from the latest cloud snapshot.".to_string(),
        );

        build_action_result(app_dir, token_store, None, None, false, true)
    }
    .await;

    match operation_result {
        Ok(mut result) => {
            result.safety_backup_path = Some(safety_backup_path);
            Ok(result)
        }
        Err(err) => Err(format!(
            "{err} Emergency backup created at {safety_backup_path}."
        )),
    }
}

async fn force_publish_local_as_remote_inner<T: DriveTransport>(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    config: &SyncConfig,
    progress: Option<&SyncProgressReporter>,
) -> Result<SyncActionResult, String> {
    let safety_backup_path = create_local_safety_backup(app_dir, conn)?;
    let operation_result = async {
        let pending_remote_base = sync_state::load_pending_sync_state(app_dir)?
            .map(|pending| pending.remote_base_snapshot);
        let cached_base_snapshot = match pending_remote_base {
            Some(snapshot) => Some(snapshot),
            None => sync_state::load_base_snapshot(app_dir)?,
        };
        let remote_manifest =
            load_remote_manifest_optional(client, token_store, &config.sync_profile_id).await?;

        let remote_snapshot = if let Some(remote_manifest) = remote_manifest.as_ref() {
            report_progress(
                SyncProgressOperation::ForcePublishLocalAsRemote,
                progress,
                SyncProgressStage::LoadingRemote,
                0,
                2,
                "Loading the current cloud sync state...".to_string(),
            );
            report_progress(
                SyncProgressOperation::ForcePublishLocalAsRemote,
                progress,
                SyncProgressStage::LoadingRemote,
                1,
                2,
                "Downloading the current cloud snapshot before overwrite...".to_string(),
            );

            match download_remote_snapshot(client, token_store, remote_manifest).await {
                Ok(snapshot) => {
                    report_progress(
                        SyncProgressOperation::ForcePublishLocalAsRemote,
                        progress,
                        SyncProgressStage::LoadingRemote,
                        2,
                        2,
                        "Current cloud snapshot downloaded.".to_string(),
                    );
                    Some(snapshot)
                }
                Err(err) => {
                    report_progress(
                        SyncProgressOperation::ForcePublishLocalAsRemote,
                        progress,
                        SyncProgressStage::LoadingRemote,
                        2,
                        2,
                        format!(
                            "Current cloud snapshot could not be read ({err}). Using the last known base snapshot for overwrite."
                        ),
                    );
                    None
                }
            }
        } else {
            report_progress(
                SyncProgressOperation::ForcePublishLocalAsRemote,
                progress,
                SyncProgressStage::LoadingRemote,
                1,
                1,
                "No remote manifest was found. Recreating cloud state from this device.".to_string(),
            );
            None
        };

        let build_base_snapshot = remote_snapshot.as_ref().or(cached_base_snapshot.as_ref());
        let built_snapshot = build_local_snapshot_with_progress(
            app_dir,
            conn,
            &config.sync_profile_id,
            build_base_snapshot,
            SyncProgressOperation::ForcePublishLocalAsRemote,
            progress,
        )?;
        let current_remote_generation = remote_manifest
            .as_ref()
            .map(|manifest| manifest.manifest.remote_generation)
            .unwrap_or(0);
        let mut force_config = config.clone();
        force_config.profile_name = built_snapshot.snapshot.profile.profile_name.clone();
        // This operation supersedes any prior conflict queue. Do not carry a
        // ConflictPending cache into finalization, where it would suppress
        // normal Dirty marking for edits made during the upload.
        force_config.last_sync_status = SyncLifecycleStatus::Dirty;
        let force_state = sync_state::PendingSyncState {
            version: sync_state::PENDING_SYNC_STATE_VERSION,
            conflicts: Vec::new(),
            conflict_tokens: Vec::new(),
            local_baseline: built_snapshot.snapshot.clone(),
            merged_snapshot: built_snapshot.snapshot.clone(),
            remote_base_snapshot: build_base_snapshot
                .cloned()
                .unwrap_or_else(|| built_snapshot.snapshot.clone()),
            config: force_config,
            phase: sync_state::PendingSyncPhase::ForcePublishingLocal {
                current_remote_generation,
                synced_at: built_snapshot.created_at.clone(),
            },
        };
        sync_state::clear_completed_resolution(app_dir)?;
        sync_state::save_pending_sync_state(app_dir, &force_state)?;
        let recovered = recover_pending_snapshot_apply(
            app_dir,
            conn,
            client,
            token_store,
            SyncProgressOperation::ForcePublishLocalAsRemote,
            progress,
        )
        .await?;
        recovered.action_result.ok_or_else(|| {
            "Force publish journal recovery completed without a publish result".to_string()
        })
    }
    .await;

    match operation_result {
        Ok(mut result) => {
            result.safety_backup_path = Some(safety_backup_path);
            Ok(result)
        }
        Err(err) => Err(format!(
            "{err} Emergency backup created at {safety_backup_path}."
        )),
    }
}

async fn resolve_sync_conflict_with_client<T: DriveTransport>(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    conflict_index: usize,
    conflict_token: &str,
    resolution: SyncConflictResolution,
) -> Result<SyncActionResult, String> {
    let _lock = sync_state::acquire_sync_lock(app_dir)?;
    let resolution_value = serde_json::to_value(&resolution).map_err(|e| e.to_string())?;
    if sync_state::has_pending_sync_state(app_dir) {
        let recovered = recover_pending_snapshot_apply(
            app_dir,
            conn,
            client,
            token_store,
            SyncProgressOperation::RunSync,
            None,
        )
        .await?;
        if let Some(result) = recovered.action_result {
            return Ok(result);
        }
    }
    if !sync_state::has_pending_sync_state(app_dir)
        && !sync_state::load_pending_conflicts(app_dir)?.is_empty()
    {
        // A legacy split queue has no generation nonce. Treat migration as a
        // wholly new generation before checking an older content-hash receipt.
        sync_state::clear_completed_resolution(app_dir)?;
        migrate_legacy_conflict_queue(app_dir, conn)?;
    }
    if let Some(receipt) = sync_state::load_completed_resolution(app_dir)? {
        if receipt.conflict_token == conflict_token && receipt.resolution == resolution_value {
            return build_action_result(app_dir, token_store, None, None, false, false);
        }
    }

    let Some(mut pending) = sync_state::load_pending_sync_state(app_dir)? else {
        return Err(
            "The conflict queue changed before this choice was applied. Refresh conflicts and try again."
                .to_string(),
        );
    };
    let repaired_tokens = reconcile_conflict_tokens(
        &pending.conflicts,
        &pending.conflict_tokens,
        &pending.conflicts,
    );
    if repaired_tokens != pending.conflict_tokens {
        pending.conflict_tokens = repaired_tokens;
        sync_state::save_pending_sync_state(app_dir, &pending)?;
    }
    if conflict_index >= pending.conflicts.len() {
        return Err(format!("Conflict index {conflict_index} is out of bounds"));
    }
    if pending
        .conflict_tokens
        .get(conflict_index)
        .map(String::as_str)
        != Some(conflict_token)
    {
        return Err(
            "The conflict queue changed before this choice was applied. Refresh conflicts and try again."
                .to_string(),
        );
    }

    resolve_journaled_sync_conflict(
        app_dir,
        conn,
        client,
        token_store,
        &mut pending,
        JournaledConflictResolutionRequest {
            conflict_index,
            conflict_token,
            resolution,
        },
    )
    .await
}

fn migrate_legacy_conflict_queue(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
) -> Result<(), String> {
    let conflicts = sync_state::load_pending_conflicts(app_dir)?;
    if conflicts.is_empty() {
        return Ok(());
    }
    let Some(mut config) = sync_state::load_sync_config(app_dir)? else {
        return Err("Sync is not configured for this profile".to_string());
    };
    let remote_base_snapshot = sync_state::load_base_snapshot(app_dir)?
        .ok_or_else(|| "Missing local base snapshot. Reconnect or recreate sync.".to_string())?;
    // Legacy builds had already applied their provisional merged snapshot to
    // SQLite. Capture that exact visible state as both the local baseline and
    // target before deleting any split-state cache.
    let current = build_local_snapshot(
        app_dir,
        conn,
        &config.sync_profile_id,
        Some(&remote_base_snapshot),
    )?
    .snapshot;
    config.profile_name = current.profile.profile_name.clone();
    config.last_sync_status = SyncLifecycleStatus::ConflictPending;
    let conflict_tokens = conflicts
        .iter()
        .map(legacy_sync_conflict_token)
        .collect::<Result<Vec<_>, _>>()?;
    let pending = sync_state::PendingSyncState {
        version: sync_state::PENDING_SYNC_STATE_VERSION,
        conflicts,
        conflict_tokens,
        local_baseline: current.clone(),
        merged_snapshot: current,
        remote_base_snapshot,
        config,
        phase: sync_state::PendingSyncPhase::AwaitingResolution,
    };
    sync_state::save_pending_sync_state(app_dir, &pending)?;
    sync_state::clear_pending_conflicts(app_dir)?;
    sync_state::clear_pending_merged_snapshot(app_dir)?;
    Ok(())
}

async fn resolve_journaled_sync_conflict<T: DriveTransport>(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    pending: &mut sync_state::PendingSyncState,
    request: JournaledConflictResolutionRequest<'_>,
) -> Result<SyncActionResult, String> {
    let JournaledConflictResolutionRequest {
        conflict_index,
        conflict_token: requested_conflict_token,
        resolution,
    } = request;
    if conflict_index >= pending.conflicts.len() {
        return Err(format!("Conflict index {conflict_index} is out of bounds"));
    }
    let requested_conflict = pending.conflicts[conflict_index].clone();
    let previous_conflicts = pending.conflicts.clone();
    let previous_tokens = pending.conflict_tokens.clone();

    // Rebase the database as it exists *now* over the provisional cloud merge.
    // The queue-time local snapshot is essential here: without it, a local row
    // absent from the provisional snapshot cannot be distinguished from a
    // post-conflict deletion, and applying the frozen merge would erase edits
    // made while the conflict dialog was open.
    let rebase_base = pending.local_baseline.clone();
    let live_local = build_local_snapshot(
        app_dir,
        conn,
        &pending.config.sync_profile_id,
        Some(&rebase_base),
    )?;
    let rebased = sync_merge::merge_snapshots(
        Some(&rebase_base),
        &live_local.snapshot,
        &pending.merged_snapshot,
    )?;
    pending.local_baseline = live_local.snapshot;
    pending.merged_snapshot = rebased.merged_snapshot;
    for conflict in rebased.conflicts {
        if !pending.conflicts.contains(&conflict) {
            pending.conflicts.push(conflict);
        }
    }

    let resolution_timestamp = Utc::now().to_rfc3339();
    let device_id = sync_state::get_or_create_device_id(app_dir)?;
    refresh_rebased_conflicts(
        &mut pending.conflicts,
        &mut pending.merged_snapshot,
        &rebase_base,
        &pending.remote_base_snapshot,
    )?;
    refresh_duplicate_identity_conflicts_with_origins(
        &mut pending.conflicts,
        &pending.merged_snapshot,
        Some(&pending.local_baseline),
        Some(&pending.remote_base_snapshot),
        &resolution_timestamp,
        &device_id,
    );
    pending.conflict_tokens =
        reconcile_conflict_tokens(&previous_conflicts, &previous_tokens, &pending.conflicts);

    let requested_position = pending
        .conflict_tokens
        .iter()
        .position(|candidate| candidate == requested_conflict_token)
        .or_else(|| {
            pending
                .conflicts
                .iter()
                .position(|candidate| same_conflict_slot(candidate, &requested_conflict))
        });

    let mut new_conflicts = Vec::new();
    if let Some(requested_position) = requested_position {
        let current_conflict = pending.conflicts[requested_position].clone();
        match (&current_conflict, &resolution) {
            (
                SyncConflict::DuplicateMediaIdentity { .. },
                SyncConflictResolution::DuplicateMediaIdentityMerge
                | SyncConflictResolution::DuplicateMediaIdentityKeepBoth { .. },
            ) => {
                ensure_duplicate_identity_is_ready_to_resolve(
                    &pending.conflicts,
                    requested_position,
                    &current_conflict,
                )?;
                new_conflicts = resolve_duplicate_media_identity(
                    &mut pending.merged_snapshot,
                    &current_conflict,
                    &resolution,
                    &resolution_timestamp,
                    &device_id,
                )?;
            }
            (SyncConflict::DuplicateMediaIdentity { .. }, _) => {
                return Err(
                    "Conflict resolution kind does not match the pending duplicate media identity"
                        .to_string(),
                );
            }
            _ => apply_conflict_resolution_to_snapshot(
                &mut pending.merged_snapshot,
                &current_conflict,
                &resolution,
            )?,
        }
        pending.conflicts.remove(requested_position);
        pending.conflict_tokens.remove(requested_position);
    }

    let conflicts_before_new = pending.conflicts.clone();
    let tokens_before_new = pending.conflict_tokens.clone();
    for conflict in new_conflicts {
        if !pending.conflicts.contains(&conflict) {
            pending.conflicts.push(conflict);
        }
    }
    refresh_duplicate_identity_conflicts_with_origins(
        &mut pending.conflicts,
        &pending.merged_snapshot,
        Some(&pending.local_baseline),
        Some(&pending.remote_base_snapshot),
        &resolution_timestamp,
        &device_id,
    );
    pending.conflict_tokens = reconcile_conflict_tokens(
        &conflicts_before_new,
        &tokens_before_new,
        &pending.conflicts,
    );

    pending.config.profile_name = pending.merged_snapshot.profile.profile_name.clone();
    if has_duplicate_media_identity_conflicts(&pending.conflicts) {
        pending.config.last_sync_status = SyncLifecycleStatus::ConflictPending;
    } else {
        pending.config.last_sync_status = if pending.conflicts.is_empty() {
            SyncLifecycleStatus::Dirty
        } else {
            SyncLifecycleStatus::ConflictPending
        };
        ensure_unique_media_identities(&pending.merged_snapshot)?;
    }
    let remaining_conflicts = pending.conflicts.clone();
    pending.phase = sync_state::PendingSyncPhase::ApplyingSnapshot {
        remaining_conflicts,
        resolution: Some(serde_json::to_value(&resolution).map_err(|e| e.to_string())?),
        conflict_index: Some(conflict_index),
        conflict_token: Some(requested_conflict_token.to_string()),
        operation_id: Some(generate_prefixed_id("apply")),
        database_applied: false,
    };
    // Commit the chosen target and phase before touching SQLite. A restart can
    // either replay the exact snapshot or finalize a duplicate-only queue and
    // its durable retry receipt.
    sync_state::save_pending_sync_state(app_dir, pending)?;
    let _ = recover_pending_snapshot_apply(
        app_dir,
        conn,
        client,
        token_store,
        SyncProgressOperation::RunSync,
        None,
    )
    .await?;

    build_action_result(app_dir, token_store, None, None, false, false)
}

fn duplicate_conflict_uid_pair(conflict: &SyncConflict) -> Option<[String; 2]> {
    let SyncConflict::DuplicateMediaIdentity {
        local_media,
        remote_media,
        ..
    } = conflict
    else {
        return None;
    };
    let mut pair = [local_media.uid.clone(), remote_media.uid.clone()];
    pair.sort();
    Some(pair)
}

fn same_conflict_slot(left: &SyncConflict, right: &SyncConflict) -> bool {
    match (left, right) {
        (
            SyncConflict::MediaFieldConflict {
                media_uid: left_uid,
                field_name: left_field,
                ..
            },
            SyncConflict::MediaFieldConflict {
                media_uid: right_uid,
                field_name: right_field,
                ..
            },
        ) => left_uid == right_uid && left_field == right_field,
        (
            SyncConflict::ExtraDataEntryConflict {
                media_uid: left_uid,
                entry_key: left_key,
                ..
            },
            SyncConflict::ExtraDataEntryConflict {
                media_uid: right_uid,
                entry_key: right_key,
                ..
            },
        ) => left_uid == right_uid && left_key == right_key,
        (
            SyncConflict::DeleteVsUpdate {
                media_uid: left_uid,
                ..
            },
            SyncConflict::DeleteVsUpdate {
                media_uid: right_uid,
                ..
            },
        ) => left_uid == right_uid,
        (
            SyncConflict::ProfilePictureConflict { .. },
            SyncConflict::ProfilePictureConflict { .. },
        ) => true,
        (
            SyncConflict::DuplicateMediaIdentity { .. },
            SyncConflict::DuplicateMediaIdentity { .. },
        ) => duplicate_conflict_uid_pair(left) == duplicate_conflict_uid_pair(right),
        _ => false,
    }
}

fn reconcile_conflict_tokens(
    previous_conflicts: &[SyncConflict],
    previous_tokens: &[String],
    current_conflicts: &[SyncConflict],
) -> Vec<String> {
    let mut claimed_previous = BTreeSet::new();
    current_conflicts
        .iter()
        .map(|current| {
            previous_conflicts
                .iter()
                .enumerate()
                .find(|(index, previous)| {
                    !claimed_previous.contains(index)
                        && previous_tokens
                            .get(*index)
                            .is_some_and(|token| !token.is_empty())
                        && same_conflict_slot(previous, current)
                })
                .and_then(|(index, _)| {
                    claimed_previous.insert(index);
                    previous_tokens.get(index).cloned()
                })
                .unwrap_or_else(|| generate_prefixed_id("conflict"))
        })
        .collect()
}

fn legacy_sync_conflict_token(conflict: &SyncConflict) -> Result<String, String> {
    let payload = serde_json::to_vec(conflict).map_err(|e| e.to_string())?;
    Ok(format!("legacy_conflict_{}", compute_sha256_hex(&payload)))
}

fn media_field_value(
    aggregate: &SnapshotMediaAggregate,
    field_name: &str,
) -> Result<Option<String>, String> {
    let value = match field_name {
        "title" => Some(aggregate.title.clone()),
        "variant" => Some(aggregate.variant.clone()),
        "media_type" | "default_activity_type" => Some(aggregate.default_activity_type.clone()),
        "status" => Some(aggregate.status.clone()),
        "language" => Some(aggregate.language.clone()),
        "description" => Some(aggregate.description.clone()),
        "content_type" => Some(aggregate.content_type.clone()),
        "tracking_status" => Some(aggregate.tracking_status.clone()),
        "extra_data" => Some(aggregate.extra_data.clone()),
        "cover_blob_sha256" => aggregate.cover_blob_sha256.clone(),
        other => return Err(format!("Unsupported media field conflict '{other}'")),
    };
    Ok(value)
}

fn refresh_rebased_conflicts(
    conflicts: &mut Vec<SyncConflict>,
    snapshot: &mut SyncSnapshot,
    rebase_base_snapshot: &SyncSnapshot,
    remote_base_snapshot: &SyncSnapshot,
) -> Result<(), String> {
    let invalid_entry_conflict_media = conflicts
        .iter()
        .filter_map(|conflict| {
            let SyncConflict::ExtraDataEntryConflict { media_uid, .. } = conflict else {
                return None;
            };
            snapshot
                .library
                .get(media_uid)
                .filter(|aggregate| parse_extra_data_object(&aggregate.extra_data).is_err())
                .map(|_| media_uid.clone())
        })
        .collect::<BTreeSet<_>>();
    let mut refreshed = Vec::new();
    for mut conflict in std::mem::take(conflicts) {
        let invalid_extra_data_uid = match &conflict {
            SyncConflict::ExtraDataEntryConflict { media_uid, .. }
                if invalid_entry_conflict_media.contains(media_uid) =>
            {
                Some(media_uid.clone())
            }
            SyncConflict::MediaFieldConflict {
                media_uid,
                field_name,
                ..
            } if field_name == "extra_data" && invalid_entry_conflict_media.contains(media_uid) => {
                Some(media_uid.clone())
            }
            _ => None,
        };
        if let Some(media_uid) = invalid_extra_data_uid {
            let Some(aggregate) = snapshot.library.get(&media_uid) else {
                continue;
            };
            // Per-entry choices cannot represent this live raw value. Use the
            // downloaded snapshot for the cloud side; the provisional merge
            // may already contain old local entry choices.
            conflict = SyncConflict::MediaFieldConflict {
                field_name: "extra_data".to_string(),
                base_value: rebase_base_snapshot
                    .library
                    .get(&media_uid)
                    .map(|media| media.extra_data.clone()),
                local_value: Some(aggregate.extra_data.clone()),
                remote_value: remote_base_snapshot
                    .library
                    .get(&media_uid)
                    .map(|media| media.extra_data.clone()),
                media_uid,
            };
        }

        let keep = match &mut conflict {
            SyncConflict::MediaFieldConflict {
                media_uid,
                field_name,
                base_value: _,
                local_value,
                remote_value,
            } => {
                let Some(aggregate) = snapshot.library.get(media_uid) else {
                    continue;
                };
                let current = media_field_value(aggregate, field_name)?;
                if &current == remote_value {
                    false
                } else {
                    *local_value = current;
                    true
                }
            }
            SyncConflict::ExtraDataEntryConflict {
                media_uid,
                entry_key,
                base_value: _,
                local_value,
                remote_value,
            } => {
                let Some(aggregate) = snapshot.library.get(media_uid) else {
                    continue;
                };
                let Ok(current_object) = parse_extra_data_object(&aggregate.extra_data) else {
                    // Malformed/non-object values are converted to a
                    // whole-field conflict before this match.
                    continue;
                };
                let current = current_object.get(entry_key).cloned();
                if &current == remote_value {
                    false
                } else {
                    *local_value = current;
                    true
                }
            }
            SyncConflict::ProfilePictureConflict {
                base_picture: _,
                local_picture,
                remote_picture,
            } => {
                let current = snapshot.profile_picture.clone();
                if &current == remote_picture.as_ref() {
                    false
                } else {
                    **local_picture = current;
                    true
                }
            }
            SyncConflict::DeleteVsUpdate {
                media_uid,
                deleted_side,
                local_media,
                remote_media,
                ..
            } => {
                if let Some(current) = snapshot.library.get(media_uid) {
                    match deleted_side {
                        MergeSide::Remote => **local_media = Some(current.clone()),
                        MergeSide::Local => **remote_media = Some(current.clone()),
                    }
                } else if *deleted_side == MergeSide::Remote {
                    // The local restore candidate was deleted while the
                    // dialog was open, so both sides now agree on delete.
                    continue;
                }
                true
            }
            SyncConflict::DuplicateMediaIdentity { .. } => true,
        };
        if keep
            && !refreshed
                .iter()
                .any(|existing| same_conflict_slot(existing, &conflict))
        {
            refreshed.push(conflict);
        }
    }
    *conflicts = refreshed;
    Ok(())
}

struct QueuePendingSyncRequest<'a> {
    local_baseline: &'a SyncSnapshot,
    merged_snapshot: &'a SyncSnapshot,
    remote_base_snapshot: &'a SyncSnapshot,
    conflicts: &'a [SyncConflict],
    config: SyncConfig,
    apply_snapshot_now: bool,
    operation: SyncProgressOperation,
    progress: Option<&'a SyncProgressReporter>,
}

async fn queue_pending_sync_with_client<T: DriveTransport>(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    request: QueuePendingSyncRequest<'_>,
) -> Result<QueuePendingSyncOutcome, String> {
    let QueuePendingSyncRequest {
        local_baseline,
        merged_snapshot,
        remote_base_snapshot,
        conflicts,
        config,
        apply_snapshot_now,
        operation,
        progress,
    } = request;
    let phase = if apply_snapshot_now {
        sync_state::PendingSyncPhase::ApplyingSnapshot {
            remaining_conflicts: conflicts.to_vec(),
            resolution: None,
            conflict_index: None,
            conflict_token: None,
            operation_id: Some(generate_prefixed_id("apply")),
            database_applied: false,
        }
    } else {
        sync_state::PendingSyncPhase::AwaitingResolution
    };
    let pending = sync_state::PendingSyncState {
        version: sync_state::PENDING_SYNC_STATE_VERSION,
        conflicts: conflicts.to_vec(),
        conflict_tokens: conflicts
            .iter()
            .map(|_| generate_prefixed_id("conflict"))
            .collect(),
        local_baseline: local_baseline.clone(),
        merged_snapshot: merged_snapshot.clone(),
        remote_base_snapshot: remote_base_snapshot.clone(),
        config,
        phase,
    };

    // Remove obsolete split-state files before committing the authoritative
    // journal. Once the atomic rename below succeeds, every piece required to
    // recover this queue belongs to the same generation.
    sync_state::clear_pending_conflicts(app_dir)?;
    sync_state::clear_pending_merged_snapshot(app_dir)?;
    sync_state::clear_completed_resolution(app_dir)?;
    sync_state::save_pending_sync_state(app_dir, &pending)?;

    if apply_snapshot_now {
        let recovered =
            recover_pending_snapshot_apply(app_dir, conn, client, token_store, operation, progress)
                .await?;
        Ok(QueuePendingSyncOutcome {
            snapshot: recovered
                .snapshot
                .unwrap_or_else(|| merged_snapshot.clone()),
            conflicts: recovered.conflicts,
        })
    } else {
        // These are derived caches only. If either write is interrupted, the
        // complete journal remains authoritative and resolution repairs them.
        sync_state::save_base_snapshot(app_dir, remote_base_snapshot)?;
        sync_state::save_sync_config(app_dir, &pending.config)?;
        Ok(QueuePendingSyncOutcome {
            snapshot: merged_snapshot.clone(),
            conflicts: conflicts.to_vec(),
        })
    }
}

struct QueuePendingSyncOutcome {
    snapshot: SyncSnapshot,
    conflicts: Vec<SyncConflict>,
}

#[derive(Debug)]
struct PendingRecoveryOutcome {
    snapshot: Option<SyncSnapshot>,
    conflicts: Vec<SyncConflict>,
    action_result: Option<SyncActionResult>,
}

impl PendingRecoveryOutcome {
    fn none() -> Self {
        Self {
            snapshot: None,
            conflicts: Vec::new(),
            action_result: None,
        }
    }
}

async fn recover_pending_snapshot_apply<T: DriveTransport>(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    operation: SyncProgressOperation,
    progress: Option<&SyncProgressReporter>,
) -> Result<PendingRecoveryOutcome, String> {
    let Some(mut pending) = sync_state::load_pending_sync_state(app_dir)? else {
        return Ok(PendingRecoveryOutcome::none());
    };
    match pending.phase.clone() {
        sync_state::PendingSyncPhase::AwaitingResolution => Ok(PendingRecoveryOutcome {
            snapshot: Some(pending.merged_snapshot),
            conflicts: pending.conflicts,
            action_result: None,
        }),
        sync_state::PendingSyncPhase::ApplyingSnapshot {
            remaining_conflicts,
            resolution,
            conflict_index,
            conflict_token,
            operation_id,
            database_applied,
        } => {
            let resolution_timestamp = Utc::now().to_rfc3339();
            let device_id = sync_state::get_or_create_device_id(app_dir)?;
            let operation_id = operation_id.unwrap_or_else(|| generate_prefixed_id("apply"));

            if !database_applied {
                // Legacy journals did not carry an operation ID. Persist one
                // before looking for or creating a SQLite commit proof so a
                // stale marker can never be mistaken for this attempt.
                pending.phase = sync_state::PendingSyncPhase::ApplyingSnapshot {
                    remaining_conflicts: remaining_conflicts.clone(),
                    resolution: resolution.clone(),
                    conflict_index,
                    conflict_token: conflict_token.clone(),
                    operation_id: Some(operation_id.clone()),
                    database_applied: false,
                };
                sync_state::save_pending_sync_state(app_dir, &pending)?;
            }

            report_progress(
                operation.clone(),
                progress,
                SyncProgressStage::ApplyingRemoteChanges,
                0,
                1,
                "Applying the journaled sync snapshot to this device...".to_string(),
            );

            // Snapshot comparison/rebase and SQLite replacement share this one
            // mutex critical section. The SQLite marker and snapshot commit in
            // one transaction; the external phase advances before this mutex
            // is released, closing both sides of the commit gap.
            {
                let conn_guard = conn.lock().map_err(|e| e.to_string())?;
                let committed_marker = if database_applied {
                    None
                } else {
                    sync_snapshot::load_snapshot_apply_commit_marker(&conn_guard)?.filter(
                        |marker| {
                            marker.operation_id == operation_id
                                && marker.target_snapshot_id == pending.merged_snapshot.snapshot_id
                        },
                    )
                };
                let commit_was_proven = committed_marker.is_some();

                if let Some(marker) = committed_marker.as_ref() {
                    // COMMIT succeeded but the process stopped before the
                    // filesystem journal advanced. Never replay the destructive
                    // transaction: later DB edits are intentionally left live.
                    pending.local_baseline =
                        snapshot_apply_marker_baseline(&pending.merged_snapshot, marker);
                    pending.conflicts = remaining_conflicts.clone();
                } else if !database_applied {
                    let tombstones = derive_local_tombstones(
                        &conn_guard,
                        Some(&pending.local_baseline),
                        &resolution_timestamp,
                        &device_id,
                    )?;
                    let current = sync_snapshot::build_snapshot(
                        &conn_guard,
                        SnapshotBuildOptions {
                            snapshot_id: &generate_prefixed_id("snap"),
                            created_at: &resolution_timestamp,
                            created_by_device_id: &device_id,
                            profile_id: &pending.config.sync_profile_id,
                            base_snapshot: Some(&pending.local_baseline),
                            tombstones: &tombstones,
                        },
                    )?;

                    if !snapshots_logically_equal(&current, &pending.local_baseline) {
                        let previous_conflicts = pending.conflicts.clone();
                        let previous_tokens = pending.conflict_tokens.clone();
                        let rebase_base = pending.local_baseline.clone();
                        let rebased = sync_merge::merge_snapshots(
                            Some(&rebase_base),
                            &current,
                            &pending.merged_snapshot,
                        )?;
                        pending.local_baseline = current;
                        pending.merged_snapshot = rebased.merged_snapshot;
                        pending.conflicts = remaining_conflicts.clone();
                        for conflict in rebased.conflicts {
                            if !pending
                                .conflicts
                                .iter()
                                .any(|existing| same_conflict_slot(existing, &conflict))
                            {
                                pending.conflicts.push(conflict);
                            }
                        }
                        refresh_rebased_conflicts(
                            &mut pending.conflicts,
                            &mut pending.merged_snapshot,
                            &rebase_base,
                            &pending.remote_base_snapshot,
                        )?;
                        refresh_duplicate_identity_conflicts_with_origins(
                            &mut pending.conflicts,
                            &pending.merged_snapshot,
                            Some(&pending.local_baseline),
                            Some(&pending.remote_base_snapshot),
                            &resolution_timestamp,
                            &device_id,
                        );
                        pending.conflict_tokens = reconcile_conflict_tokens(
                            &previous_conflicts,
                            &previous_tokens,
                            &pending.conflicts,
                        );
                    } else {
                        pending.conflicts = remaining_conflicts.clone();
                    }
                } else {
                    // The external phase is already authoritative. Any edits
                    // made after the prior commit stay in SQLite and are
                    // detected by the next sync after recovery finishes.
                    pending.conflicts = remaining_conflicts.clone();
                }

                if has_duplicate_media_identity_conflicts(&pending.conflicts) {
                    pending.config.last_sync_status = SyncLifecycleStatus::ConflictPending;
                    if let (Some(conflict_index), Some(conflict_token), Some(resolution)) =
                        (conflict_index, conflict_token.clone(), resolution.clone())
                    {
                        sync_state::save_completed_resolution(
                            app_dir,
                            &sync_state::CompletedResolution {
                                conflict_index,
                                conflict_token,
                                resolution,
                            },
                        )?;
                    }
                    // The on-disk journal is still ApplyingSnapshot here. Save
                    // the retry receipt first: a crash before the following
                    // transition simply replays that phase and receipt, while
                    // the inverse order could lose the resolved token forever.
                    pending.phase = sync_state::PendingSyncPhase::AwaitingResolution;
                    sync_state::save_pending_sync_state(app_dir, &pending)?;
                    sync_state::save_sync_config(app_dir, &pending.config)?;
                    return Ok(PendingRecoveryOutcome {
                        snapshot: Some(pending.merged_snapshot),
                        conflicts: pending.conflicts,
                        action_result: None,
                    });
                }

                ensure_unique_media_identities(&pending.merged_snapshot)?;
                if !database_applied && !commit_was_proven {
                    // The CAS/rebase may have changed the exact target. Commit
                    // that target to the external journal before SQLite so the
                    // marker can only ever prove the same staged operation.
                    pending.phase = sync_state::PendingSyncPhase::ApplyingSnapshot {
                        remaining_conflicts: pending.conflicts.clone(),
                        resolution: resolution.clone(),
                        conflict_index,
                        conflict_token: conflict_token.clone(),
                        operation_id: Some(operation_id.clone()),
                        database_applied: false,
                    };
                    sync_state::save_pending_sync_state(app_dir, &pending)?;
                    let marker = sync_snapshot::apply_snapshot_with_commit_marker(
                        &conn_guard,
                        &pending.merged_snapshot,
                        &operation_id,
                        &resolution_timestamp,
                    )?;
                    pending.local_baseline =
                        snapshot_apply_marker_baseline(&pending.merged_snapshot, &marker);
                }
                pending.phase = sync_state::PendingSyncPhase::ApplyingSnapshot {
                    remaining_conflicts: pending.conflicts.clone(),
                    resolution: resolution.clone(),
                    conflict_index,
                    conflict_token: conflict_token.clone(),
                    operation_id: Some(operation_id.clone()),
                    database_applied: true,
                };
                // Persist the post-DB checkpoint before releasing the mutex.
                // Cover download failures can then retry without mistaking the
                // partially materialized target for a fresh local edit.
                sync_state::save_pending_sync_state(app_dir, &pending)?;
                sync_snapshot::clear_snapshot_apply_commit_marker(&conn_guard)?;
            }

            materialize_snapshot_cover_blobs_with_client(
                conn,
                app_dir.join("covers").as_path(),
                client,
                token_store,
                MaterializeCoverBlobsRequest {
                    snapshot: &pending.merged_snapshot,
                    cas_baseline: Some(&pending.local_baseline),
                    operation: operation.clone(),
                    progress,
                },
            )
            .await?;
            report_progress(
                operation,
                progress,
                SyncProgressStage::ApplyingRemoteChanges,
                1,
                1,
                "Journaled sync snapshot applied on this device.".to_string(),
            );

            pending.local_baseline = pending.merged_snapshot.clone();
            pending.config.profile_name = pending.merged_snapshot.profile.profile_name.clone();
            pending.config.last_sync_status = if pending.conflicts.is_empty() {
                SyncLifecycleStatus::Dirty
            } else {
                SyncLifecycleStatus::ConflictPending
            };

            // The journal remains ApplyingSnapshot until all derived caches and
            // the durable retry receipt have reached the committed target.
            sync_state::save_base_snapshot(app_dir, &pending.remote_base_snapshot)?;
            sync_state::save_sync_config(app_dir, &pending.config)?;
            if let (Some(conflict_index), Some(conflict_token), Some(resolution)) =
                (conflict_index, conflict_token, resolution)
            {
                sync_state::save_completed_resolution(
                    app_dir,
                    &sync_state::CompletedResolution {
                        conflict_index,
                        conflict_token,
                        resolution,
                    },
                )?;
            }
            sync_state::clear_pending_conflicts(app_dir)?;
            sync_state::clear_pending_merged_snapshot(app_dir)?;
            if pending.conflicts.is_empty() {
                sync_state::clear_pending_sync_state(app_dir)?;
            } else {
                pending.phase = sync_state::PendingSyncPhase::AwaitingResolution;
                sync_state::save_pending_sync_state(app_dir, &pending)?;
            }
            Ok(PendingRecoveryOutcome {
                snapshot: Some(pending.merged_snapshot),
                conflicts: pending.conflicts,
                action_result: None,
            })
        }
        sync_state::PendingSyncPhase::ReplacingLocalFromRemote {
            recovered_at,
            operation_id,
            database_applied,
        } => {
            recover_replace_local_from_remote(
                app_dir,
                conn,
                client,
                token_store,
                &mut pending,
                ReplaceLocalRecoveryRequest {
                    recovered_at: &recovered_at,
                    operation_id,
                    database_applied,
                    progress,
                },
            )
            .await?;
            Ok(PendingRecoveryOutcome {
                snapshot: Some(pending.merged_snapshot),
                conflicts: Vec::new(),
                action_result: None,
            })
        }
        sync_state::PendingSyncPhase::ForcePublishingLocal {
            current_remote_generation,
            synced_at,
        } => {
            let target = pending.merged_snapshot.clone();
            if let Some(remote) =
                load_remote_manifest_optional(client, token_store, &pending.config.sync_profile_id)
                    .await?
            {
                if remote.manifest.remote_generation == current_remote_generation + 1
                    && remote.manifest.snapshot_id == target.snapshot_id
                {
                    // The prior attempt committed the manifest but lost its
                    // response (or crashed before local finalization). Do not
                    // write a second generation; finish the local commit only.
                    let device_id = sync_state::get_or_create_device_id(app_dir)?;
                    let google_account_email = sync_auth::load_google_account_email(token_store)?;
                    finalize_published_snapshot(
                        app_dir,
                        conn,
                        &target,
                        &synced_at,
                        &device_id,
                        google_account_email,
                    )?;
                    let result = build_action_result(
                        app_dir,
                        token_store,
                        None,
                        Some(target.snapshot_id.clone()),
                        false,
                        false,
                    )?;
                    return Ok(PendingRecoveryOutcome {
                        snapshot: Some(target),
                        conflicts: Vec::new(),
                        action_result: Some(result),
                    });
                }
                if remote.manifest.remote_generation > current_remote_generation {
                    // A different writer advanced the manifest. Persist Dirty
                    // in the authoritative journal/cache, then delete the
                    // obsolete Force phase before reporting the lost race.
                    pending.config.last_sync_status = SyncLifecycleStatus::Dirty;
                    sync_state::save_pending_sync_state(app_dir, &pending)?;
                    sync_state::save_sync_config(app_dir, &pending.config)?;
                    sync_state::clear_pending_sync_state(app_dir)?;
                    let result =
                        build_action_result(app_dir, token_store, None, None, true, false)?;
                    return Ok(PendingRecoveryOutcome {
                        snapshot: Some(target),
                        conflicts: Vec::new(),
                        action_result: Some(result),
                    });
                }
            }
            let result = publish_snapshot_with_client(
                app_dir,
                conn,
                client,
                token_store,
                PublishSnapshotRequest {
                    current_remote_generation,
                    snapshot: &target,
                    synced_at: &synced_at,
                    operation: SyncProgressOperation::ForcePublishLocalAsRemote,
                    progress,
                },
            )
            .await?;
            if result.lost_race {
                // A force publish is a single compare-and-swap attempt. Once
                // another writer wins, this staged generation is obsolete and
                // must not be replayed forever by the next Run Sync.
                sync_state::clear_pending_sync_state(app_dir)?;
            }
            Ok(PendingRecoveryOutcome {
                snapshot: Some(target),
                conflicts: Vec::new(),
                action_result: Some(result),
            })
        }
    }
}

async fn recover_replace_local_from_remote<T: DriveTransport>(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    pending: &mut sync_state::PendingSyncState,
    request: ReplaceLocalRecoveryRequest<'_>,
) -> Result<(), String> {
    let ReplaceLocalRecoveryRequest {
        recovered_at,
        operation_id,
        database_applied,
        progress,
    } = request;
    let remote_target = pending.remote_base_snapshot.clone();
    let device_id = sync_state::get_or_create_device_id(app_dir)?;
    let operation_id = operation_id.unwrap_or_else(|| generate_prefixed_id("replace"));
    pending.merged_snapshot = remote_target.clone();

    if !database_applied {
        // Persist the exact operation and strict replacement target before the
        // SQLite transaction. A legacy journal receives a fresh operation ID,
        // so it cannot consume a marker left by an unrelated attempt.
        pending.phase = sync_state::PendingSyncPhase::ReplacingLocalFromRemote {
            recovered_at: recovered_at.to_string(),
            operation_id: Some(operation_id.clone()),
            database_applied: false,
        };
        sync_state::save_pending_sync_state(app_dir, pending)?;
    }
    report_progress(
        SyncProgressOperation::ReplaceLocalFromRemote,
        progress,
        SyncProgressStage::ApplyingRemoteChanges,
        0,
        1,
        "Applying the journaled cloud snapshot to this device...".to_string(),
    );
    {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        ensure_unique_media_identities(&pending.merged_snapshot)?;
        if !database_applied {
            let committed_marker = sync_snapshot::load_snapshot_apply_commit_marker(&conn_guard)?
                .filter(|marker| {
                    marker.operation_id == operation_id
                        && marker.target_snapshot_id == remote_target.snapshot_id
                });
            let marker = if let Some(marker) = committed_marker {
                // The target transaction committed before the external phase
                // update. The marker is atomic proof, so any current divergence
                // is a post-commit local edit and must not be replaced again.
                marker
            } else {
                sync_snapshot::apply_snapshot_with_commit_marker(
                    &conn_guard,
                    &remote_target,
                    &operation_id,
                    recovered_at,
                )?
            };
            pending.local_baseline = snapshot_apply_marker_baseline(&remote_target, &marker);
        }
        pending.phase = sync_state::PendingSyncPhase::ReplacingLocalFromRemote {
            recovered_at: recovered_at.to_string(),
            operation_id: Some(operation_id),
            database_applied: true,
        };
        // Persist the post-DB phase before releasing the connection mutex so a
        // later cover failure cannot cause live edits to be replaced on retry.
        sync_state::save_pending_sync_state(app_dir, pending)?;
        sync_snapshot::clear_snapshot_apply_commit_marker(&conn_guard)?;
    }
    materialize_snapshot_cover_blobs_with_client(
        conn,
        app_dir.join("covers").as_path(),
        client,
        token_store,
        MaterializeCoverBlobsRequest {
            snapshot: &pending.merged_snapshot,
            cas_baseline: Some(&pending.local_baseline),
            operation: SyncProgressOperation::ReplaceLocalFromRemote,
            progress,
        },
    )
    .await?;

    pending.conflicts.clear();
    pending.conflict_tokens.clear();
    pending.config.profile_name = pending.merged_snapshot.profile.profile_name.clone();
    pending.config.google_account_email = sync_auth::load_google_account_email(token_store)?;
    pending.config.last_confirmed_snapshot_id = Some(remote_target.snapshot_id.clone());
    pending.config.last_sync_at = Some(recovered_at.to_string());
    {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let tombstones =
            derive_local_tombstones(&conn_guard, Some(&remote_target), recovered_at, &device_id)?;
        let live = sync_snapshot::build_snapshot(
            &conn_guard,
            SnapshotBuildOptions {
                snapshot_id: &generate_prefixed_id("snap"),
                created_at: recovered_at,
                created_by_device_id: &device_id,
                profile_id: &pending.config.sync_profile_id,
                base_snapshot: Some(&remote_target),
                tombstones: &tombstones,
            },
        )?;
        pending.config.last_sync_status = if snapshots_logically_equal(&live, &remote_target) {
            SyncLifecycleStatus::Clean
        } else {
            SyncLifecycleStatus::Dirty
        };
        sync_state::save_base_snapshot(app_dir, &remote_target)?;
        sync_state::save_sync_config(app_dir, &pending.config)?;
    }
    sync_state::clear_pending_conflicts(app_dir)?;
    sync_state::clear_pending_merged_snapshot(app_dir)?;
    sync_state::clear_pending_sync_state(app_dir)?;
    report_progress(
        SyncProgressOperation::ReplaceLocalFromRemote,
        progress,
        SyncProgressStage::ApplyingRemoteChanges,
        1,
        1,
        "Journaled cloud snapshot applied on this device.".to_string(),
    );
    Ok(())
}

fn finalize_published_snapshot(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    snapshot: &SyncSnapshot,
    synced_at: &str,
    device_id: &str,
    google_account_email: Option<String>,
) -> Result<(), String> {
    // A database edit may land while network upload is in flight. Rebuild and
    // compare while holding the same mutex used by every local writer, and
    // commit the base/config caches before releasing it. The published target
    // remains the merge base either way, but a newer local state must stay
    // Dirty instead of being mislabeled Clean.
    {
        let finalized_at = Utc::now().to_rfc3339();
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let tombstones =
            derive_local_tombstones(&conn_guard, Some(snapshot), &finalized_at, device_id)?;
        let live = sync_snapshot::build_snapshot(
            &conn_guard,
            SnapshotBuildOptions {
                snapshot_id: &generate_prefixed_id("snap"),
                created_at: &finalized_at,
                created_by_device_id: device_id,
                profile_id: &snapshot.profile.profile_id,
                base_snapshot: Some(snapshot),
                tombstones: &tombstones,
            },
        )?;
        let mut finalized_config = sync_state::load_sync_config(app_dir)?
            .ok_or_else(|| "Sync is not configured for this profile".to_string())?;
        finalized_config.profile_name = snapshot.profile.profile_name.clone();
        finalized_config.google_account_email = google_account_email;
        finalized_config.last_confirmed_snapshot_id = Some(snapshot.snapshot_id.clone());
        finalized_config.last_sync_at = Some(synced_at.to_string());
        finalized_config.last_sync_status = if snapshots_logically_equal(&live, snapshot) {
            SyncLifecycleStatus::Clean
        } else {
            SyncLifecycleStatus::Dirty
        };
        sync_state::save_base_snapshot(app_dir, snapshot)?;
        sync_state::save_sync_config(app_dir, &finalized_config)?;
    }
    sync_state::clear_pending_conflicts(app_dir)?;
    sync_state::clear_pending_merged_snapshot(app_dir)?;
    // The operation journal is the commit marker and must be deleted last.
    sync_state::clear_pending_sync_state(app_dir)
}

async fn publish_snapshot_with_client<T: DriveTransport>(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    request: PublishSnapshotRequest<'_>,
) -> Result<SyncActionResult, String> {
    let PublishSnapshotRequest {
        current_remote_generation,
        snapshot,
        synced_at,
        operation,
        progress,
    } = request;

    upload_missing_cover_blobs_with_client(
        conn,
        snapshot,
        client,
        token_store,
        operation.clone(),
        progress,
    )
    .await?;
    report_progress(
        operation.clone(),
        progress,
        SyncProgressStage::UploadingSnapshot,
        0,
        1,
        "Uploading the merged snapshot to Google Drive...".to_string(),
    );
    let uploaded_snapshot = client
        .upload_snapshot(token_store, &snapshot.profile.profile_id, snapshot)
        .await?;
    report_progress(
        operation.clone(),
        progress,
        SyncProgressStage::UploadingSnapshot,
        1,
        1,
        "Merged snapshot uploaded.".to_string(),
    );
    let google_account_email = sync_auth::load_google_account_email(token_store)?;
    let device_id = sync_state::get_or_create_device_id(app_dir)?;
    let next_manifest = RemoteSyncManifest::new(
        &snapshot.profile.profile_id,
        &snapshot.profile.profile_name,
        &snapshot.snapshot_id,
        &uploaded_snapshot.snapshot_sha256,
        current_remote_generation + 1,
        synced_at,
        &device_id,
    );
    report_progress(
        operation.clone(),
        progress,
        SyncProgressStage::WritingManifest,
        0,
        1,
        "Updating the cloud sync manifest...".to_string(),
    );
    let manifest_write = client
        .upsert_manifest_and_confirm(token_store, &next_manifest)
        .await?;

    if !manifest_write.race_won {
        sync_state::update_sync_config(app_dir, |current| {
            current.profile_name = snapshot.profile.profile_name.clone();
            current.last_sync_status = SyncLifecycleStatus::Dirty;
        })?;
        return build_action_result(app_dir, token_store, None, None, true, false);
    }
    report_progress(
        operation.clone(),
        progress,
        SyncProgressStage::WritingManifest,
        1,
        1,
        "Cloud sync manifest updated.".to_string(),
    );

    finalize_published_snapshot(
        app_dir,
        conn,
        snapshot,
        synced_at,
        &device_id,
        google_account_email,
    )?;
    report_progress(
        operation,
        progress,
        SyncProgressStage::Complete,
        1,
        1,
        "Cloud sync completed successfully.".to_string(),
    );

    build_action_result(
        app_dir,
        token_store,
        None,
        Some(snapshot.snapshot_id.clone()),
        false,
        false,
    )
}

async fn load_remote_manifest<T: DriveTransport>(
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    profile_id: &str,
) -> Result<RemoteManifestFile, String> {
    let remote_manifest = client
        .read_manifest(token_store, profile_id)
        .await?
        .ok_or_else(|| {
            format!(
                "Remote manifest '{}' is missing",
                sync_drive::manifest_file_name(profile_id)
            )
        })?;
    sync_drive::validate_remote_manifest_compatibility(&remote_manifest.manifest)?;
    Ok(remote_manifest)
}

async fn load_remote_manifest_optional<T: DriveTransport>(
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    profile_id: &str,
) -> Result<Option<RemoteManifestFile>, String> {
    let Some(remote_manifest) = client.read_manifest(token_store, profile_id).await? else {
        return Ok(None);
    };
    sync_drive::validate_remote_manifest_compatibility(&remote_manifest.manifest)?;
    Ok(Some(remote_manifest))
}

async fn download_remote_snapshot<T: DriveTransport>(
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    remote_manifest: &RemoteManifestFile,
) -> Result<SyncSnapshot, String> {
    let mut remote_snapshot = client
        .download_snapshot(
            token_store,
            &remote_manifest.manifest.profile_id,
            &remote_manifest.manifest.snapshot_id,
            &remote_manifest.manifest.snapshot_sha256,
        )
        .await?;
    normalize_snapshot_media_variants(&mut remote_snapshot);
    sync_drive::validate_remote_snapshot_compatibility(&remote_snapshot)?;
    Ok(remote_snapshot)
}

fn normalize_snapshot_media_variants(snapshot: &mut SyncSnapshot) {
    for media in snapshot.library.values_mut() {
        media.variant = media.variant.trim().to_string();
    }
}

fn build_local_snapshot(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    profile_id: &str,
    base_snapshot: Option<&SyncSnapshot>,
) -> Result<BuiltSnapshot, String> {
    build_local_snapshot_with_progress(
        app_dir,
        conn,
        profile_id,
        base_snapshot,
        SyncProgressOperation::RunSync,
        None,
    )
}

fn build_local_snapshot_with_progress(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    profile_id: &str,
    base_snapshot: Option<&SyncSnapshot>,
    operation: SyncProgressOperation,
    progress: Option<&SyncProgressReporter>,
) -> Result<BuiltSnapshot, String> {
    build_local_snapshot_with_progress_and_hook(
        app_dir,
        conn,
        profile_id,
        base_snapshot,
        operation,
        progress,
        || {},
    )
}

fn build_local_snapshot_with_progress_and_hook<F>(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    profile_id: &str,
    base_snapshot: Option<&SyncSnapshot>,
    operation: SyncProgressOperation,
    progress: Option<&SyncProgressReporter>,
    after_tombstones: F,
) -> Result<BuiltSnapshot, String>
where
    F: FnOnce(),
{
    let created_at = Utc::now().to_rfc3339();
    let device_id = sync_state::get_or_create_device_id(app_dir)?;
    let snapshot_id = generate_prefixed_id("snap");

    let snapshot = {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let tombstones =
            derive_local_tombstones(&conn_guard, base_snapshot, &created_at, &device_id)?;
        after_tombstones();
        sync_snapshot::build_snapshot_with_progress(
            &conn_guard,
            SnapshotBuildOptions {
                snapshot_id: &snapshot_id,
                created_at: &created_at,
                created_by_device_id: &device_id,
                profile_id,
                base_snapshot,
                tombstones: &tombstones,
            },
            |snapshot_progress| {
                report_progress(
                    operation.clone(),
                    progress,
                    SyncProgressStage::PreparingSnapshot,
                    snapshot_progress.processed_media,
                    snapshot_progress.total_media,
                    format!(
                        "Preparing your library snapshot... {} of {} items processed.",
                        snapshot_progress.processed_media, snapshot_progress.total_media
                    ),
                );
            },
        )?
    };

    Ok(BuiltSnapshot {
        snapshot,
        created_at,
        device_id,
    })
}

fn finalize_clean_if_local_still_matches_base_with_hook<F>(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    profile_id: &str,
    base_snapshot: &SyncSnapshot,
    before_final_check: F,
) -> Result<Option<BuiltSnapshot>, String>
where
    F: FnOnce(),
{
    before_final_check();
    let created_at = Utc::now().to_rfc3339();
    let device_id = sync_state::get_or_create_device_id(app_dir)?;
    let snapshot_id = generate_prefixed_id("snap");

    let conn_guard = conn.lock().map_err(|e| e.to_string())?;
    let tombstones =
        derive_local_tombstones(&conn_guard, Some(base_snapshot), &created_at, &device_id)?;
    let snapshot = sync_snapshot::build_snapshot(
        &conn_guard,
        SnapshotBuildOptions {
            snapshot_id: &snapshot_id,
            created_at: &created_at,
            created_by_device_id: &device_id,
            profile_id,
            base_snapshot: Some(base_snapshot),
            tombstones: &tombstones,
        },
    )?;

    if !snapshots_logically_equal(&snapshot, base_snapshot) {
        return Ok(Some(BuiltSnapshot {
            snapshot,
            created_at,
            device_id,
        }));
    }

    // Keep the final comparison and Clean state commit under the same DB mutex
    // used by all app writers. A writer either lands before this snapshot and
    // is returned for publishing, or lands afterward and marks sync Dirty.
    sync_state::clear_pending_conflicts(app_dir)?;
    sync_state::clear_pending_merged_snapshot(app_dir)?;
    sync_state::clear_pending_sync_state(app_dir)?;
    sync_state::update_sync_config(app_dir, |current| {
        current.profile_name = snapshot.profile.profile_name.clone();
        current.last_confirmed_snapshot_id = Some(base_snapshot.snapshot_id.clone());
        current.last_sync_at = Some(created_at.clone());
        current.last_sync_status = SyncLifecycleStatus::Clean;
    })?;
    Ok(None)
}

fn derive_local_tombstones(
    conn: &Connection,
    base_snapshot: Option<&SyncSnapshot>,
    deleted_at: &str,
    device_id: &str,
) -> Result<Vec<SnapshotTombstone>, String> {
    let Some(base_snapshot) = base_snapshot else {
        return Ok(Vec::new());
    };

    let local_media_uids = db::get_all_media(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(|media| media.uid)
        .collect::<BTreeSet<_>>();
    let base_tombstones = base_snapshot
        .tombstones
        .iter()
        .map(|tombstone| (tombstone.media_uid.clone(), tombstone.clone()))
        .collect::<BTreeMap<_, _>>();
    let mut tombstones = BTreeMap::new();

    for uid in base_snapshot.library.keys() {
        if local_media_uids.contains(uid) {
            continue;
        }
        if let Some(existing) = base_tombstones.get(uid) {
            tombstones.insert(uid.clone(), existing.clone());
        } else {
            tombstones.insert(
                uid.clone(),
                SnapshotTombstone {
                    media_uid: uid.clone(),
                    deleted_at: deleted_at.to_string(),
                    deleted_by_device_id: device_id.to_string(),
                },
            );
        }
    }

    for tombstone in &base_snapshot.tombstones {
        if !local_media_uids.contains(&tombstone.media_uid) {
            tombstones
                .entry(tombstone.media_uid.clone())
                .or_insert_with(|| tombstone.clone());
        }
    }

    Ok(tombstones.into_values().collect())
}

fn snapshots_logically_equal(left: &SyncSnapshot, right: &SyncSnapshot) -> bool {
    left.sync_protocol_version == right.sync_protocol_version
        && left.db_schema_version == right.db_schema_version
        && left.profile == right.profile
        && left.library == right.library
        && left.settings == right.settings
        && left.profile_picture == right.profile_picture
        && left.tombstones == right.tombstones
}

fn snapshot_apply_marker_baseline(
    target: &SyncSnapshot,
    marker: &sync_snapshot::SnapshotApplyCommitMarker,
) -> SyncSnapshot {
    let mut baseline = target.clone();
    for (uid, aggregate) in &mut baseline.library {
        aggregate.cover_blob_sha256 = marker
            .post_apply_cover_blob_sha256
            .get(uid)
            .cloned()
            .flatten();
    }
    baseline
}

fn find_potential_duplicate_titles(local: &SyncSnapshot, remote: &SyncSnapshot) -> Vec<String> {
    let local_identities = snapshot_identity_uids(local);
    let remote_identities = snapshot_identity_uids(remote);

    local_identities
        .into_iter()
        .filter_map(|(identity, local_uid)| {
            remote_identities
                .get(&identity)
                .filter(|remote_uid| *remote_uid != &local_uid)
                .map(|_| format_media_identity(&identity.0, &identity.1))
        })
        .collect()
}

fn snapshot_identity_uids(snapshot: &SyncSnapshot) -> BTreeMap<(String, String), String> {
    snapshot
        .library
        .iter()
        .map(|(uid, media)| {
            (
                (media.title.clone(), media.variant.trim().to_string()),
                uid.clone(),
            )
        })
        .collect()
}

fn format_media_identity(title: &str, variant: &str) -> String {
    if variant.is_empty() {
        title.to_string()
    } else {
        format!("{title} — {variant}")
    }
}

fn duplicate_media_identity_conflicts(
    local: &SyncSnapshot,
    remote: &SyncSnapshot,
    merged: &SyncSnapshot,
    deleted_at: &str,
    device_id: &str,
) -> Vec<SyncConflict> {
    let mut merged_by_identity: BTreeMap<(String, String), Vec<String>> = BTreeMap::new();
    for (uid, media) in &merged.library {
        merged_by_identity
            .entry((media.title.clone(), media.variant.trim().to_string()))
            .or_default()
            .push(uid.clone());
    }

    let mut conflicts = Vec::new();
    for (identity, mut uids) in merged_by_identity {
        if uids.len() < 2 {
            continue;
        }
        uids.sort();

        // Prefer the UID which has this exact natural identity in the local
        // snapshot as the combine target. For unusual concurrent field edits
        // which synthesize a new pair, fall back to a deterministic UID.
        let canonical_uid = uids
            .iter()
            .find(|uid| {
                local.library.get(*uid).is_some_and(|media| {
                    media.title == identity.0 && media.variant.trim() == identity.1
                })
            })
            .cloned()
            .unwrap_or_else(|| uids[0].clone());

        for duplicate_uid in uids.into_iter().filter(|uid| uid != &canonical_uid) {
            let Some(canonical_media) = merged.library.get(&canonical_uid) else {
                continue;
            };
            let Some(duplicate_media) = merged.library.get(&duplicate_uid) else {
                continue;
            };

            // If exactly one side owns the pair, preserve that side's label in
            // the conflict payload. The fallback still remains deterministic.
            let (local_media, remote_media) =
                if remote.library.get(&canonical_uid).is_some_and(|media| {
                    media.title == identity.0 && media.variant.trim() == identity.1
                }) && local.library.get(&duplicate_uid).is_some_and(|media| {
                    media.title == identity.0 && media.variant.trim() == identity.1
                }) {
                    (duplicate_media, canonical_media)
                } else {
                    (canonical_media, duplicate_media)
                };

            conflicts.push(SyncConflict::DuplicateMediaIdentity {
                local_media: Box::new(local_media.clone()),
                remote_media: Box::new(remote_media.clone()),
                remote_tombstone: SnapshotTombstone {
                    media_uid: remote_media.uid.clone(),
                    deleted_at: deleted_at.to_string(),
                    deleted_by_device_id: device_id.to_string(),
                },
            });
        }
    }
    conflicts
}

fn has_duplicate_media_identity_conflicts(conflicts: &[SyncConflict]) -> bool {
    conflicts
        .iter()
        .any(|conflict| matches!(conflict, SyncConflict::DuplicateMediaIdentity { .. }))
}

fn ensure_unique_media_identities(snapshot: &SyncSnapshot) -> Result<(), String> {
    let mut identities = BTreeMap::new();
    for (uid, media) in &snapshot.library {
        let identity = (media.title.clone(), media.variant.trim().to_string());
        if let Some(existing_uid) = identities.insert(identity.clone(), uid) {
            return Err(format!(
                "Media identity '{}' is used by more than one internal media entry ({existing_uid} and {uid})",
                format_media_identity(&identity.0, &identity.1)
            ));
        }
    }
    Ok(())
}

fn create_local_safety_backup(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
) -> Result<String, String> {
    sync_state::ensure_sync_dir(app_dir)?;
    let file_name = format!(
        "pre_sync_backup_{}.zip",
        Utc::now().format("%Y%m%dT%H%M%SZ")
    );
    let path = sync_state::sync_dir(app_dir).join(file_name);
    let conn_guard = conn.lock().map_err(|e| e.to_string())?;
    backup::export_full_backup_internal(
        app_dir,
        &conn_guard,
        &path.to_string_lossy(),
        "{}",
        env!("CARGO_PKG_VERSION"),
    )?;
    Ok(path.to_string_lossy().to_string())
}

fn default_device_name() -> String {
    std::env::var("COMPUTERNAME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var("HOSTNAME")
                .ok()
                .filter(|value| !value.trim().is_empty())
        })
        .or_else(read_hostname_from_system_file)
        .unwrap_or_else(|| "Device".to_string())
}

fn generate_prefixed_id(prefix: &str) -> String {
    format!("{prefix}_{}", uuid::Uuid::new_v4().simple())
}

#[cfg(target_os = "windows")]
fn read_hostname_from_system_file() -> Option<String> {
    None
}

#[cfg(not(target_os = "windows"))]
fn read_hostname_from_system_file() -> Option<String> {
    fs::read_to_string("/etc/hostname")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn build_action_result(
    app_dir: &Path,
    token_store: &dyn SecureTokenStore,
    safety_backup_path: Option<String>,
    published_snapshot_id: Option<String>,
    lost_race: bool,
    remote_changed: bool,
) -> Result<SyncActionResult, String> {
    let google_account_email = sync_auth::load_google_account_email(token_store)?;
    let sync_status = sync_state::get_sync_status(app_dir, true, google_account_email)?;
    Ok(SyncActionResult {
        sync_status,
        safety_backup_path,
        published_snapshot_id,
        lost_race,
        remote_changed,
    })
}

fn conflict_media_uid(conflict: &SyncConflict) -> Option<&str> {
    match conflict {
        SyncConflict::MediaFieldConflict { media_uid, .. }
        | SyncConflict::ExtraDataEntryConflict { media_uid, .. }
        | SyncConflict::DeleteVsUpdate { media_uid, .. } => Some(media_uid),
        SyncConflict::DuplicateMediaIdentity { .. }
        | SyncConflict::ProfilePictureConflict { .. } => None,
    }
}

fn ensure_duplicate_identity_is_ready_to_resolve(
    conflicts: &[SyncConflict],
    conflict_index: usize,
    conflict: &SyncConflict,
) -> Result<(), String> {
    let SyncConflict::DuplicateMediaIdentity {
        local_media,
        remote_media,
        ..
    } = conflict
    else {
        return Ok(());
    };

    let blocked = conflicts.iter().enumerate().any(|(index, other)| {
        index != conflict_index
            && conflict_media_uid(other).is_some_and(|uid| {
                uid == local_media.uid.as_str() || uid == remote_media.uid.as_str()
            })
    });
    if blocked {
        return Err(
            "Resolve the other pending changes for these media entries before combining or renaming them"
                .to_string(),
        );
    }
    Ok(())
}

fn resolve_duplicate_media_identity(
    snapshot: &mut SyncSnapshot,
    conflict: &SyncConflict,
    resolution: &SyncConflictResolution,
    updated_at: &str,
    device_id: &str,
) -> Result<Vec<SyncConflict>, String> {
    let SyncConflict::DuplicateMediaIdentity {
        local_media,
        remote_media,
        remote_tombstone,
    } = conflict
    else {
        return Err("Expected a duplicate media identity conflict".to_string());
    };
    let local_uid = local_media.uid.as_str();
    let remote_uid = remote_media.uid.as_str();
    if local_uid == remote_uid {
        return Err(
            "Duplicate media identity conflict contains the same internal identity twice"
                .to_string(),
        );
    }

    let mut current_local = snapshot.library.get(local_uid).cloned().ok_or_else(|| {
        "The local media entry is no longer present in the pending sync".to_string()
    })?;
    let mut current_remote = snapshot.library.get(remote_uid).cloned().ok_or_else(|| {
        "The cloud media entry is no longer present in the pending sync".to_string()
    })?;
    current_local.variant = current_local.variant.trim().to_string();
    current_remote.variant = current_remote.variant.trim().to_string();
    if current_local.title != current_remote.title
        || current_local.variant != current_remote.variant
    {
        return Err(
            "These media entries no longer have the same title and variant; refresh the conflicts"
                .to_string(),
        );
    }

    match resolution {
        SyncConflictResolution::DuplicateMediaIdentityMerge => {
            let (mut merged, generated_conflicts) = sync_merge::merge_duplicate_media_identity(
                local_uid,
                &current_local,
                &current_remote,
            )?;
            merged.updated_at = updated_at.to_string();
            merged.updated_by_device_id = device_id.to_string();

            snapshot.library.remove(local_uid);
            snapshot.library.remove(remote_uid);
            snapshot.library.insert(local_uid.to_string(), merged);
            remove_tombstone(snapshot, local_uid);

            let mut tombstone = remote_tombstone.clone();
            tombstone.media_uid = remote_uid.to_string();
            tombstone.deleted_at = updated_at.to_string();
            tombstone.deleted_by_device_id = device_id.to_string();
            upsert_tombstone(snapshot, tombstone);
            Ok(generated_conflicts)
        }
        SyncConflictResolution::DuplicateMediaIdentityKeepBoth {
            side,
            title,
            variant,
        } => {
            let title = title.trim();
            let variant = variant.trim();
            if title.is_empty() {
                return Err("A media title cannot be blank".to_string());
            }
            let target_uid = match side {
                MergeSide::Local => local_uid,
                MergeSide::Remote => remote_uid,
            };
            if snapshot.library.iter().any(|(uid, media)| {
                uid != target_uid && media.title == title && media.variant.trim() == variant
            }) {
                return Err(format!(
                    "Another media entry already uses '{}'",
                    format_media_identity(title, variant)
                ));
            }
            let target = snapshot.library.get_mut(target_uid).ok_or_else(|| {
                "The selected media entry is no longer present in the pending sync".to_string()
            })?;
            target.title = title.to_string();
            target.variant = variant.to_string();
            target.updated_at = updated_at.to_string();
            target.updated_by_device_id = device_id.to_string();
            Ok(Vec::new())
        }
        _ => Err("Conflict resolution kind does not match the pending conflict".to_string()),
    }
}

fn refresh_duplicate_identity_conflicts_with_origins(
    conflicts: &mut Vec<SyncConflict>,
    snapshot: &SyncSnapshot,
    local_origin: Option<&SyncSnapshot>,
    remote_origin: Option<&SyncSnapshot>,
    deleted_at: &str,
    device_id: &str,
) {
    let mut existing = BTreeMap::new();
    for conflict in conflicts.iter() {
        if let SyncConflict::DuplicateMediaIdentity {
            local_media,
            remote_media,
            remote_tombstone,
        } = conflict
        {
            let mut pair = [local_media.uid.clone(), remote_media.uid.clone()];
            pair.sort();
            existing.insert(
                (pair[0].clone(), pair[1].clone()),
                (
                    local_media.uid.clone(),
                    remote_media.uid.clone(),
                    remote_tombstone.clone(),
                ),
            );
        }
    }
    conflicts.retain(|conflict| !matches!(conflict, SyncConflict::DuplicateMediaIdentity { .. }));

    let mut grouped: BTreeMap<(String, String), Vec<String>> = BTreeMap::new();
    for (uid, media) in &snapshot.library {
        grouped
            .entry((media.title.clone(), media.variant.trim().to_string()))
            .or_default()
            .push(uid.clone());
    }

    for mut uids in grouped.into_values() {
        if uids.len() < 2 {
            continue;
        }
        uids.sort();
        let identity = snapshot
            .library
            .get(&uids[0])
            .map(|media| (media.title.as_str(), media.variant.trim()))
            .unwrap_or_default();
        let anchor = local_origin
            .and_then(|origin| {
                uids.iter().find(|uid| {
                    origin.library.get(*uid).is_some_and(|media| {
                        media.title == identity.0 && media.variant.trim() == identity.1
                    })
                })
            })
            .cloned()
            .unwrap_or_else(|| uids[0].clone());
        for duplicate in uids.into_iter().filter(|uid| uid != &anchor) {
            let mut pair = [anchor.clone(), duplicate.clone()];
            pair.sort();
            let key = (pair[0].clone(), pair[1].clone());
            let (local_uid, remote_uid, tombstone) =
                existing.get(&key).cloned().unwrap_or_else(|| {
                    let anchor_is_local = local_origin.is_some_and(|origin| {
                        origin.library.get(&anchor).is_some_and(|media| {
                            media.title == identity.0 && media.variant.trim() == identity.1
                        })
                    });
                    let duplicate_is_local = local_origin.is_some_and(|origin| {
                        origin.library.get(&duplicate).is_some_and(|media| {
                            media.title == identity.0 && media.variant.trim() == identity.1
                        })
                    });
                    let anchor_is_remote = remote_origin.is_some_and(|origin| {
                        origin.library.get(&anchor).is_some_and(|media| {
                            media.title == identity.0 && media.variant.trim() == identity.1
                        })
                    });
                    let duplicate_is_remote = remote_origin.is_some_and(|origin| {
                        origin.library.get(&duplicate).is_some_and(|media| {
                            media.title == identity.0 && media.variant.trim() == identity.1
                        })
                    });
                    let (local_uid, remote_uid) = if anchor_is_local && duplicate_is_remote {
                        (anchor.clone(), duplicate.clone())
                    } else if duplicate_is_local && anchor_is_remote {
                        (duplicate.clone(), anchor.clone())
                    } else {
                        (anchor.clone(), duplicate.clone())
                    };
                    (
                        local_uid,
                        remote_uid.clone(),
                        SnapshotTombstone {
                            media_uid: remote_uid,
                            deleted_at: deleted_at.to_string(),
                            deleted_by_device_id: device_id.to_string(),
                        },
                    )
                });
            let (Some(local_media), Some(remote_media)) = (
                snapshot.library.get(&local_uid),
                snapshot.library.get(&remote_uid),
            ) else {
                continue;
            };
            conflicts.push(SyncConflict::DuplicateMediaIdentity {
                local_media: Box::new(local_media.clone()),
                remote_media: Box::new(remote_media.clone()),
                remote_tombstone: tombstone,
            });
        }
    }
}

fn apply_conflict_resolution_to_snapshot(
    snapshot: &mut SyncSnapshot,
    conflict: &SyncConflict,
    resolution: &SyncConflictResolution,
) -> Result<(), String> {
    match (conflict, resolution) {
        (
            SyncConflict::MediaFieldConflict {
                media_uid,
                field_name,
                local_value,
                remote_value,
                ..
            },
            SyncConflictResolution::MediaField { side },
        ) => {
            let aggregate = snapshot.library.get_mut(media_uid).ok_or_else(|| {
                format!("Media '{media_uid}' was not found in the current snapshot")
            })?;
            let chosen = match side {
                MergeSide::Local => local_value.clone(),
                MergeSide::Remote => remote_value.clone(),
            };
            apply_media_field_choice(aggregate, field_name, chosen)?;
            Ok(())
        }
        (
            SyncConflict::ExtraDataEntryConflict {
                media_uid,
                entry_key,
                local_value,
                remote_value,
                ..
            },
            SyncConflictResolution::ExtraDataEntry { side },
        ) => {
            let aggregate = snapshot.library.get_mut(media_uid).ok_or_else(|| {
                format!("Media '{media_uid}' was not found in the current snapshot")
            })?;
            let chosen = match side {
                MergeSide::Local => local_value.clone(),
                MergeSide::Remote => remote_value.clone(),
            };
            apply_extra_data_entry_choice(&mut aggregate.extra_data, entry_key, chosen)?;
            Ok(())
        }
        (
            SyncConflict::DeleteVsUpdate {
                media_uid,
                deleted_side,
                local_media,
                remote_media,
                tombstone,
                ..
            },
            SyncConflictResolution::DeleteVsUpdate { choice },
        ) => {
            match choice {
                DeleteVsUpdateChoice::RespectDelete => {
                    snapshot.library.remove(media_uid);
                    upsert_tombstone(snapshot, tombstone.clone());
                }
                DeleteVsUpdateChoice::Restore => {
                    let restored = match deleted_side {
                        MergeSide::Local => remote_media.as_ref().clone(),
                        MergeSide::Remote => local_media.as_ref().clone(),
                    }
                    .ok_or_else(|| {
                        format!(
                            "Conflict for media '{media_uid}' does not contain a restore candidate"
                        )
                    })?;
                    snapshot.library.insert(media_uid.clone(), restored);
                    remove_tombstone(snapshot, media_uid);
                }
            }
            Ok(())
        }
        (
            SyncConflict::ProfilePictureConflict {
                local_picture,
                remote_picture,
                ..
            },
            SyncConflictResolution::ProfilePicture { side },
        ) => {
            snapshot.profile_picture = match side {
                MergeSide::Local => local_picture.as_ref().clone(),
                MergeSide::Remote => remote_picture.as_ref().clone(),
            };
            Ok(())
        }
        _ => Err("Conflict resolution kind does not match the pending conflict".to_string()),
    }
}

fn apply_media_field_choice(
    aggregate: &mut SnapshotMediaAggregate,
    field_name: &str,
    chosen: Option<String>,
) -> Result<(), String> {
    match field_name {
        "title" => aggregate.title = required_choice(field_name, chosen)?,
        "variant" => aggregate.variant = required_choice(field_name, chosen)?,
        "media_type" | "default_activity_type" => {
            aggregate.default_activity_type = required_choice(field_name, chosen)?
        }
        "status" => aggregate.status = required_choice(field_name, chosen)?,
        "language" => aggregate.language = required_choice(field_name, chosen)?,
        "description" => aggregate.description = required_choice(field_name, chosen)?,
        "content_type" => aggregate.content_type = required_choice(field_name, chosen)?,
        "tracking_status" => aggregate.tracking_status = required_choice(field_name, chosen)?,
        "extra_data" => aggregate.extra_data = required_choice(field_name, chosen)?,
        "cover_blob_sha256" => aggregate.cover_blob_sha256 = chosen,
        other => return Err(format!("Unsupported media field conflict '{other}'")),
    }
    Ok(())
}

fn apply_extra_data_entry_choice(
    extra_data: &mut String,
    entry_key: &str,
    chosen: Option<Value>,
) -> Result<(), String> {
    let mut object = parse_extra_data_object(extra_data)?;
    match chosen {
        Some(value) => {
            object.insert(entry_key.to_string(), sort_json_value(value));
        }
        None => {
            object.remove(entry_key);
        }
    }
    *extra_data = serialize_extra_data_object(&object)?;
    Ok(())
}

fn required_choice(field_name: &str, chosen: Option<String>) -> Result<String, String> {
    chosen.ok_or_else(|| format!("Conflict field '{field_name}' requires a non-null value"))
}

fn parse_extra_data_object(raw: &str) -> Result<BTreeMap<String, Value>, String> {
    let trimmed = raw.trim();
    let normalized = if trimmed.is_empty() { "{}" } else { trimmed };
    let value = serde_json::from_str::<Value>(normalized)
        .map_err(|e| format!("Failed to parse extra_data object: {e}"))?;
    match sort_json_value(value) {
        Value::Object(map) => Ok(map.into_iter().collect()),
        _ => Err("extra_data is not a JSON object".to_string()),
    }
}

fn serialize_extra_data_object(entries: &BTreeMap<String, Value>) -> Result<String, String> {
    let mut map = Map::new();
    for (key, value) in entries {
        map.insert(key.clone(), sort_json_value(value.clone()));
    }
    serde_json::to_string(&Value::Object(map)).map_err(|e| e.to_string())
}

fn sort_json_value(value: Value) -> Value {
    match value {
        Value::Array(values) => Value::Array(values.into_iter().map(sort_json_value).collect()),
        Value::Object(map) => {
            let mut sorted = Map::new();
            let ordered: BTreeMap<_, _> = map.into_iter().collect();
            for (key, value) in ordered {
                sorted.insert(key, sort_json_value(value));
            }
            Value::Object(sorted)
        }
        other => other,
    }
}

fn upsert_tombstone(snapshot: &mut SyncSnapshot, tombstone: SnapshotTombstone) {
    if let Some(existing) = snapshot
        .tombstones
        .iter_mut()
        .find(|existing| existing.media_uid == tombstone.media_uid)
    {
        *existing = tombstone;
    } else {
        snapshot.tombstones.push(tombstone);
        snapshot
            .tombstones
            .sort_by(|left, right| left.media_uid.cmp(&right.media_uid));
    }
}

fn remove_tombstone(snapshot: &mut SyncSnapshot, media_uid: &str) {
    snapshot
        .tombstones
        .retain(|tombstone| tombstone.media_uid != media_uid);
}

async fn upload_missing_cover_blobs_with_client<T: DriveTransport>(
    conn: &Arc<Mutex<Connection>>,
    snapshot: &SyncSnapshot,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    operation: SyncProgressOperation,
    progress: Option<&SyncProgressReporter>,
) -> Result<(), String> {
    let local_hash_cache = build_local_cover_hash_cache_from_snapshot(conn, snapshot)?;
    let remote_hashes = client.list_blob_hashes(token_store).await?;
    let missing_hashes = required_cover_hashes(snapshot)
        .into_iter()
        .filter(|hash| !remote_hashes.contains(hash))
        .collect::<Vec<_>>();
    let total_missing = missing_hashes.len();

    report_progress(
        operation.clone(),
        progress,
        SyncProgressStage::UploadingCovers,
        0,
        total_missing,
        if total_missing == 0 {
            "No cover art uploads were needed.".to_string()
        } else {
            format!(
                "Uploading missing cover art... 0 of {} uploaded.",
                total_missing
            )
        },
    );

    if total_missing == 0 {
        return Ok(());
    }

    let mut uploads = stream::iter(missing_hashes.into_iter().map(|hash| {
        let client = client.clone();
        let path = local_hash_cache
            .get(&hash)
            .cloned()
            .ok_or_else(|| format!("Local cover blob '{hash}' is missing"));
        async move {
            let path = path?;
            upload_cover_blob_with_retry(client, token_store, hash, path).await
        }
    }))
    .buffer_unordered(COVER_UPLOAD_CONCURRENCY);

    let mut uploaded = 0usize;
    while let Some(result) = uploads.next().await {
        result?;
        uploaded += 1;
        report_progress(
            operation.clone(),
            progress,
            SyncProgressStage::UploadingCovers,
            uploaded,
            total_missing,
            format!(
                "Uploading missing cover art... {} of {} uploaded.",
                uploaded, total_missing
            ),
        );
    }

    Ok(())
}

async fn upload_cover_blob_with_retry<T: DriveTransport>(
    client: GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    hash: String,
    path: String,
) -> Result<String, String> {
    let bytes = tokio::fs::read(&path)
        .await
        .map_err(|e| format!("Failed to read local cover blob '{hash}' from '{path}': {e}"))?;
    // The cache was built before this async read. Revalidate the bytes after
    // the await so an in-place file replacement cannot be uploaded under the
    // stale content-addressed name, including the known-missing fast path.
    validate_cover_blob_bytes(&hash, &bytes)?;

    for attempt in 1..=COVER_UPLOAD_MAX_ATTEMPTS {
        let result = if attempt == 1 {
            client
                .upload_blob_known_missing(token_store, &hash, &bytes)
                .await
        } else {
            client.upload_blob(token_store, &hash, &bytes).await
        };

        match result {
            Ok(_) => return Ok(hash),
            Err(_err) if attempt < COVER_UPLOAD_MAX_ATTEMPTS => {
                tokio::time::sleep(Duration::from_millis(
                    COVER_UPLOAD_RETRY_DELAY_MS * attempt as u64,
                ))
                .await;
            }
            Err(err) => {
                return Err(format!(
                    "Failed to upload cover art blob '{hash}' after {} attempts: {err}",
                    COVER_UPLOAD_MAX_ATTEMPTS
                ));
            }
        }
    }

    Err(format!(
        "Failed to upload cover art blob '{hash}' after {} attempts",
        COVER_UPLOAD_MAX_ATTEMPTS
    ))
}

async fn materialize_snapshot_cover_blobs_with_client<T: DriveTransport>(
    conn: &Arc<Mutex<Connection>>,
    covers_dir: &Path,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    request: MaterializeCoverBlobsRequest<'_>,
) -> Result<(), String> {
    let MaterializeCoverBlobsRequest {
        snapshot,
        cas_baseline,
        operation,
        progress,
    } = request;
    let mut local_hash_cache = build_local_cover_hash_cache(conn)?;
    let existing_media = {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        db::get_all_media(&conn_guard).map_err(|e| e.to_string())?
    };
    let media_by_uid = existing_media
        .into_iter()
        .filter_map(|media| media.uid.clone().map(|uid| (uid, media)))
        .collect::<BTreeMap<_, _>>();

    let mut pending_hashes = BTreeSet::new();
    let mut observed_cover_hashes = BTreeMap::new();
    for (uid, aggregate) in &snapshot.library {
        let Some(expected_hash) = aggregate.cover_blob_sha256.as_ref() else {
            continue;
        };
        let Some(media) = media_by_uid.get(uid) else {
            continue;
        };
        let current_hash =
            sync_snapshot::compute_cover_blob_sha256_from_path(Path::new(&media.cover_image))?;
        match cas_baseline {
            Some(baseline) => {
                if let Some(checkpoint) = baseline.library.get(uid) {
                    observed_cover_hashes.insert(uid.clone(), checkpoint.cover_blob_sha256.clone());
                }
            }
            None => {
                observed_cover_hashes.insert(uid.clone(), current_hash.clone());
            }
        }
        if current_hash.as_deref() == Some(expected_hash.as_str()) {
            continue;
        }
        if !local_hash_cache.contains_key(expected_hash) {
            pending_hashes.insert(expected_hash.clone());
        }
    }
    let pending_downloads = pending_hashes.len();

    report_progress(
        operation.clone(),
        progress,
        SyncProgressStage::ApplyingRemoteChanges,
        0,
        pending_downloads.max(1),
        if pending_downloads == 0 {
            "No remote cover downloads were needed.".to_string()
        } else {
            format!(
                "Downloading missing remote cover art... 0 of {} downloaded.",
                pending_downloads
            )
        },
    );
    let mut downloaded = 0usize;

    if pending_downloads > 0 {
        let remote_blob_files = client.list_blob_files(token_store).await?;
        let covers_dir = covers_dir.to_path_buf();
        let mut downloads = stream::iter(pending_hashes.into_iter().map(|expected_hash| {
            let client = client.clone();
            let remote_file_id = remote_blob_files
                .get(&expected_hash)
                .map(|file| file.id.clone())
                .ok_or_else(|| format!("Missing cover blob '{expected_hash}' on remote store"));
            let covers_dir = covers_dir.clone();
            async move {
                let remote_file_id = remote_file_id?;
                let bytes = client
                    .download_app_data_file_by_id(token_store, &remote_file_id)
                    .await
                    .map_err(|e| format!("Failed to download cover blob '{expected_hash}': {e}"))?;
                validate_cover_blob_bytes(&expected_hash, &bytes)?;
                let materialized = materialize_cover_blob(&covers_dir, &expected_hash, &bytes)?;
                Ok::<_, String>((expected_hash, materialized.to_string_lossy().to_string()))
            }
        }))
        .buffer_unordered(COVER_DOWNLOAD_CONCURRENCY);

        while let Some(result) = downloads.next().await {
            let (expected_hash, materialized_path) = result?;
            local_hash_cache.insert(expected_hash, materialized_path);
            downloaded += 1;
            report_progress(
                operation.clone(),
                progress,
                SyncProgressStage::ApplyingRemoteChanges,
                downloaded,
                pending_downloads.max(1),
                format!(
                    "Downloading missing remote cover art... {} of {} downloaded.",
                    downloaded, pending_downloads
                ),
            );
        }
    }

    for (uid, aggregate) in &snapshot.library {
        let Some(expected_hash) = aggregate.cover_blob_sha256.as_ref() else {
            continue;
        };

        let target_path = if let Some(existing_path) = local_hash_cache.get(expected_hash) {
            existing_path.clone()
        } else {
            return Err(format!(
                "Cover blob '{expected_hash}' was not materialized locally"
            ));
        };

        let Some(observed_hash) = observed_cover_hashes.get(uid) else {
            // The row was created after the snapshot was applied. It is a live
            // local edit, not a target for this materialization pass.
            continue;
        };
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        let live_media = db::get_all_media(&conn_guard)
            .map_err(|e| e.to_string())?
            .into_iter()
            .find(|media| media.uid.as_deref() == Some(uid.as_str()));
        let Some(live_media) = live_media else {
            // A local deletion during download wins and will be represented by
            // a tombstone on the next snapshot build.
            continue;
        };
        let live_hash =
            sync_snapshot::compute_cover_blob_sha256_from_path(Path::new(&live_media.cover_image))?;
        if live_hash.as_deref() == Some(expected_hash.as_str()) {
            continue;
        }
        if &live_hash != observed_hash {
            // The user changed this cover while the blob was downloading.
            // Preserve that live edit; final snapshot comparison will remain
            // Dirty and a later sync can merge it normally.
            continue;
        }
        if live_media.cover_image != target_path {
            let target_hash =
                sync_snapshot::compute_cover_blob_sha256_from_path(Path::new(&target_path))?;
            if target_hash.as_deref() != Some(expected_hash.as_str()) {
                return Err(format!(
                    "Local cover cache entry for blob '{expected_hash}' changed before it could be applied"
                ));
            }
            db::update_media_cover_image_by_uid(&conn_guard, uid, &target_path)?;
        }
    }

    Ok(())
}

fn build_local_cover_hash_cache(
    conn: &Arc<Mutex<Connection>>,
) -> Result<BTreeMap<String, String>, String> {
    let conn_guard = conn.lock().map_err(|e| e.to_string())?;
    let mut cache = BTreeMap::new();
    for media in db::get_all_media(&conn_guard).map_err(|e| e.to_string())? {
        let path = Path::new(&media.cover_image);
        let Some(hash) = sync_snapshot::compute_cover_blob_sha256_from_path(path)? else {
            continue;
        };
        cache.entry(hash).or_insert(media.cover_image);
    }
    Ok(cache)
}

fn build_local_cover_hash_cache_from_snapshot(
    conn: &Arc<Mutex<Connection>>,
    snapshot: &SyncSnapshot,
) -> Result<BTreeMap<String, String>, String> {
    let conn_guard = conn.lock().map_err(|e| e.to_string())?;
    let media_by_uid = db::get_all_media(&conn_guard)
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(|media| media.uid.map(|uid| (uid, media.cover_image)))
        .collect::<BTreeMap<_, _>>();
    let mut cache = BTreeMap::new();

    for (uid, aggregate) in &snapshot.library {
        let Some(hash) = aggregate.cover_blob_sha256.as_ref() else {
            continue;
        };
        let Some(cover_path) = media_by_uid.get(uid) else {
            continue;
        };
        cache
            .entry(hash.clone())
            .or_insert_with(|| cover_path.clone());
    }

    Ok(cache)
}

fn required_cover_hashes(snapshot: &SyncSnapshot) -> BTreeSet<String> {
    snapshot
        .library
        .values()
        .filter_map(|aggregate| aggregate.cover_blob_sha256.clone())
        .collect()
}

fn validate_cover_blob_bytes(expected_hash: &str, bytes: &[u8]) -> Result<(), String> {
    if bytes.is_empty() {
        return Err(format!(
            "Cover blob '{expected_hash}' is corrupted or empty"
        ));
    }

    let actual_hash = compute_sha256_hex(bytes);
    if actual_hash != expected_hash {
        return Err(format!(
            "Cover blob '{expected_hash}' is corrupted (expected hash {expected_hash}, got {actual_hash})"
        ));
    }

    Ok(())
}

fn materialize_cover_blob(
    covers_dir: &Path,
    sha256: &str,
    bytes: &[u8],
) -> Result<PathBuf, String> {
    fs::create_dir_all(covers_dir).map_err(|e| e.to_string())?;

    let extension = match image::guess_format(bytes) {
        Ok(ImageFormat::Png) => "png",
        Ok(ImageFormat::Jpeg) => "jpg",
        Ok(ImageFormat::WebP) => "webp",
        _ => "img",
    };
    let path = covers_dir.join(format!("sync_blob_{sha256}.{extension}"));

    if path.exists() {
        let existing_hash = sync_snapshot::compute_cover_blob_sha256_from_path(&path)?;
        if existing_hash.as_deref() == Some(sha256) {
            return Ok(path);
        }
    }

    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

fn compute_sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(&mut output, "{byte:02x}");
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgba};
    use reqwest::Method;
    use tempfile::TempDir;
    use url::Url;

    use crate::models::{Media, Milestone};
    use crate::sync_auth::{StoredGoogleTokens, GOOGLE_DRIVE_APPDATA_SCOPE};

    #[derive(Debug, Default, Clone)]
    struct MemoryTokenStore {
        tokens: Arc<Mutex<Option<StoredGoogleTokens>>>,
    }

    impl SecureTokenStore for MemoryTokenStore {
        fn load_tokens(&self) -> Result<Option<StoredGoogleTokens>, String> {
            Ok(self.tokens.lock().unwrap().clone())
        }

        fn save_tokens(&self, tokens: &StoredGoogleTokens) -> Result<(), String> {
            *self.tokens.lock().unwrap() = Some(tokens.clone());
            Ok(())
        }

        fn clear_tokens(&self) -> Result<(), String> {
            *self.tokens.lock().unwrap() = None;
            Ok(())
        }
    }

    #[derive(Debug, Clone)]
    struct StoredTestFile {
        id: String,
        name: String,
        mime_type: String,
        modified_time: String,
        parents: Vec<String>,
        bytes: Vec<u8>,
    }

    #[derive(Default)]
    struct TestDriveState {
        next_id: usize,
        next_timestamp: usize,
        files: BTreeMap<String, StoredTestFile>,
        requests: Vec<(Method, String)>,
        expected_access_token: String,
        overwrite_manifest_after_write: Option<RemoteSyncManifest>,
        after_next_request: Option<Arc<dyn Fn() + Send + Sync>>,
    }

    #[derive(Debug, Deserialize)]
    struct TestUploadMetadata {
        name: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
        #[serde(default)]
        parents: Vec<String>,
    }

    enum MemoryDriveResponse {
        Json(serde_json::Value),
        Bytes(Vec<u8>),
    }

    #[derive(Clone)]
    struct MemoryDriveTransport {
        state: Arc<Mutex<TestDriveState>>,
    }

    impl DriveTransport for MemoryDriveTransport {
        fn request_json<'a>(
            &'a self,
            method: Method,
            url: &'a str,
            access_token: &'a str,
            content_type: Option<String>,
            body: Option<Vec<u8>>,
        ) -> sync_drive::TransportFuture<'a, serde_json::Value> {
            let transport = self.clone();
            let url = url.to_string();
            let access_token = access_token.to_string();
            Box::pin(async move {
                match transport.handle_request(method, &url, &access_token, content_type, body)? {
                    MemoryDriveResponse::Json(value) => Ok(value),
                    MemoryDriveResponse::Bytes(_) => {
                        Err("Expected JSON response but transport returned bytes".to_string())
                    }
                }
            })
        }

        fn request_bytes<'a>(
            &'a self,
            method: Method,
            url: &'a str,
            access_token: &'a str,
            content_type: Option<String>,
            body: Option<Vec<u8>>,
        ) -> sync_drive::TransportFuture<'a, Vec<u8>> {
            let transport = self.clone();
            let url = url.to_string();
            let access_token = access_token.to_string();
            Box::pin(async move {
                match transport.handle_request(method, &url, &access_token, content_type, body)? {
                    MemoryDriveResponse::Bytes(bytes) => Ok(bytes),
                    MemoryDriveResponse::Json(_) => {
                        Err("Expected byte response but transport returned JSON".to_string())
                    }
                }
            })
        }
    }

    impl MemoryDriveTransport {
        fn new() -> Self {
            Self {
                state: Arc::new(Mutex::new(TestDriveState {
                    next_id: 0,
                    next_timestamp: 0,
                    files: BTreeMap::new(),
                    requests: Vec::new(),
                    expected_access_token: "access-token".to_string(),
                    overwrite_manifest_after_write: None,
                    after_next_request: None,
                })),
            }
        }

        fn after_next_request<F>(&self, hook: F)
        where
            F: Fn() + Send + Sync + 'static,
        {
            self.state.lock().unwrap().after_next_request = Some(Arc::new(hook));
        }

        fn overwrite_manifest_after_next_write(&self, manifest: RemoteSyncManifest) {
            self.state.lock().unwrap().overwrite_manifest_after_write = Some(manifest);
        }

        fn recorded_requests(&self) -> Vec<(Method, String)> {
            self.state.lock().unwrap().requests.clone()
        }

        fn clear_requests(&self) {
            self.state.lock().unwrap().requests.clear();
        }

        fn handle_request(
            &self,
            method: Method,
            url: &str,
            access_token: &str,
            content_type: Option<String>,
            body: Option<Vec<u8>>,
        ) -> Result<MemoryDriveResponse, String> {
            let url = Url::parse(url).map_err(|e| e.to_string())?;
            let path = url.path();

            let after_request = {
                let mut state = self.state.lock().unwrap();
                state.requests.push((method.clone(), url.to_string()));
                state.after_next_request.take()
            };
            if let Some(after_request) = after_request {
                after_request();
            }

            self.authorize_request(access_token)?;

            if method == Method::GET && path.ends_with("/drive/v3/files") {
                let query = url
                    .query_pairs()
                    .find(|(key, _)| key == "q")
                    .map(|(_, value)| value.to_string());
                let state = self.state.lock().unwrap();
                let mut files = state.files.values().cloned().collect::<Vec<_>>();
                if let Some(query) = query.as_deref() {
                    files.retain(|file| file_matches_query(file, query));
                }

                return Ok(MemoryDriveResponse::Json(serde_json::json!({
                    "files": files.into_iter().map(file_to_json).collect::<Vec<_>>()
                })));
            }

            if method == Method::GET && path.contains("/drive/v3/files/") {
                let file_id = path
                    .rsplit('/')
                    .next()
                    .ok_or_else(|| "Missing file id".to_string())?;
                let alt = url
                    .query_pairs()
                    .find(|(key, _)| key == "alt")
                    .map(|(_, value)| value.to_string());
                let state = self.state.lock().unwrap();
                let file = state
                    .files
                    .get(file_id)
                    .ok_or_else(|| "File not found".to_string())?;

                return if alt.as_deref() == Some("media") {
                    Ok(MemoryDriveResponse::Bytes(file.bytes.clone()))
                } else {
                    Ok(MemoryDriveResponse::Json(file_to_json(file.clone())))
                };
            }

            if method == Method::POST && path.ends_with("/upload/drive/v3/files") {
                let content_type =
                    content_type.ok_or_else(|| "Missing upload Content-Type".to_string())?;
                let body = body.ok_or_else(|| "Missing upload body".to_string())?;
                let (metadata, bytes) = parse_multipart_related(&content_type, &body)?;

                let mut state = self.state.lock().unwrap();
                state.next_id += 1;
                let id = format!("file_{}", state.next_id);
                let file = StoredTestFile {
                    id: id.clone(),
                    name: metadata.name.clone(),
                    mime_type: metadata.mime_type.clone(),
                    modified_time: next_timestamp(&mut state),
                    parents: metadata.parents,
                    bytes,
                };
                state.files.insert(id.clone(), file.clone());
                maybe_overwrite_manifest_after_write(&mut state, &metadata.name);
                return Ok(MemoryDriveResponse::Json(file_to_json(file)));
            }

            if method == Method::PATCH && path.contains("/upload/drive/v3/files/") {
                let content_type =
                    content_type.ok_or_else(|| "Missing upload Content-Type".to_string())?;
                let body = body.ok_or_else(|| "Missing upload body".to_string())?;
                let (metadata, bytes) = parse_multipart_related(&content_type, &body)?;
                let file_id = path
                    .rsplit('/')
                    .next()
                    .ok_or_else(|| "Missing file id".to_string())?;

                let mut state = self.state.lock().unwrap();
                let modified_time = next_timestamp(&mut state);
                let file = state
                    .files
                    .get_mut(file_id)
                    .ok_or_else(|| "File not found".to_string())?;
                file.name = metadata.name.clone();
                file.mime_type = metadata.mime_type.clone();
                file.bytes = bytes;
                file.modified_time = modified_time;
                if !metadata.parents.is_empty() {
                    file.parents = metadata.parents;
                }
                let updated = file.clone();
                maybe_overwrite_manifest_after_write(&mut state, &metadata.name);
                return Ok(MemoryDriveResponse::Json(file_to_json(updated)));
            }

            Err(format!("Unhandled transport request: {} {}", method, url))
        }

        fn authorize_request(&self, access_token: &str) -> Result<(), String> {
            let state = self.state.lock().unwrap();
            if access_token == state.expected_access_token {
                Ok(())
            } else {
                Err("Unauthorized".to_string())
            }
        }
    }

    fn test_client_config() -> GoogleOAuthClientConfig {
        GoogleOAuthClientConfig {
            client_id: "client-id".to_string(),
            client_secret: Some("client-secret".to_string()),
            auth_endpoint: "https://accounts.example.test/authorize".to_string(),
            token_endpoint: "https://oauth.example.test/token".to_string(),
            scope: GOOGLE_DRIVE_APPDATA_SCOPE.to_string(),
            callback_timeout_secs: 5,
        }
    }

    fn test_token_store() -> MemoryTokenStore {
        let store = MemoryTokenStore::default();
        store
            .save_tokens(&StoredGoogleTokens {
                refresh_token: "refresh-token".to_string(),
                access_token: Some("access-token".to_string()),
                access_token_expires_at: Some("2999-01-01T00:00:00Z".to_string()),
                scope: Some(GOOGLE_DRIVE_APPDATA_SCOPE.to_string()),
                token_type: Some("Bearer".to_string()),
                google_account_email: Some("user@example.com".to_string()),
            })
            .unwrap();
        store
    }

    fn build_client(transport: MemoryDriveTransport) -> GoogleDriveClient<MemoryDriveTransport> {
        GoogleDriveClient::new_with_transport(
            test_client_config(),
            "https://drive.example.test/drive/v3",
            "https://drive.example.test/upload/drive/v3",
            transport,
        )
    }

    fn setup_app() -> (TempDir, Arc<Mutex<Connection>>) {
        let temp_dir = TempDir::new().unwrap();
        let conn = db::init_db(temp_dir.path().to_path_buf(), Some("Morg")).unwrap();
        (temp_dir, Arc::new(Mutex::new(conn)))
    }

    fn pending_conflict_token(app_dir: &Path, conflict_index: usize) -> String {
        sync_state::load_pending_sync_state(app_dir)
            .unwrap()
            .and_then(|pending| pending.conflict_tokens.get(conflict_index).cloned())
            .unwrap_or_else(|| {
                let conflict =
                    sync_state::load_pending_conflicts(app_dir).unwrap()[conflict_index].clone();
                legacy_sync_conflict_token(&conflict).unwrap()
            })
    }

    fn add_media(conn: &Arc<Mutex<Connection>>, title: &str) -> String {
        let media = Media {
            id: None,
            uid: None,
            title: title.to_string(),
            variant: String::new(),
            default_activity_type: "Playing".to_string(),
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: String::new(),
            cover_image: String::new(),
            extra_data: "{}".to_string(),
            content_type: "Videogame".to_string(),
            tracking_status: "Ongoing".to_string(),
        };
        let conn_guard = conn.lock().unwrap();
        db::add_media_with_id(&conn_guard, &media).unwrap();
        db::get_all_media(&conn_guard)
            .unwrap()
            .into_iter()
            .find(|existing| existing.title == title)
            .and_then(|existing| existing.uid)
            .unwrap()
    }

    fn update_media_title(conn: &Arc<Mutex<Connection>>, media_uid: &str, title: &str) {
        let conn_guard = conn.lock().unwrap();
        let mut media = db::get_all_media(&conn_guard)
            .unwrap()
            .into_iter()
            .find(|existing| existing.uid.as_deref() == Some(media_uid))
            .unwrap();
        media.title = title.to_string();
        db::update_media(&conn_guard, &media).unwrap();
    }

    fn update_media_variant(conn: &Arc<Mutex<Connection>>, media_uid: &str, variant: &str) {
        let conn_guard = conn.lock().unwrap();
        let mut media = db::get_all_media(&conn_guard)
            .unwrap()
            .into_iter()
            .find(|existing| existing.uid.as_deref() == Some(media_uid))
            .unwrap();
        media.variant = variant.to_string();
        db::update_media(&conn_guard, &media).unwrap();
    }

    fn update_media_extra_data(conn: &Arc<Mutex<Connection>>, media_uid: &str, extra_data: &str) {
        let conn_guard = conn.lock().unwrap();
        let mut media = db::get_all_media(&conn_guard)
            .unwrap()
            .into_iter()
            .find(|existing| existing.uid.as_deref() == Some(media_uid))
            .unwrap();
        media.extra_data = extra_data.to_string();
        db::update_media(&conn_guard, &media).unwrap();
    }

    fn update_media_cover(conn: &Arc<Mutex<Connection>>, media_uid: &str, cover_image: &str) {
        let conn_guard = conn.lock().unwrap();
        let mut media = db::get_all_media(&conn_guard)
            .unwrap()
            .into_iter()
            .find(|existing| existing.uid.as_deref() == Some(media_uid))
            .unwrap();
        media.cover_image = cover_image.to_string();
        db::update_media(&conn_guard, &media).unwrap();
    }

    fn delete_media_by_uid(conn: &Arc<Mutex<Connection>>, media_uid: &str) {
        let conn_guard = conn.lock().unwrap();
        let media_id = db::get_all_media(&conn_guard)
            .unwrap()
            .into_iter()
            .find(|existing| existing.uid.as_deref() == Some(media_uid))
            .and_then(|media| media.id)
            .unwrap();
        db::delete_media(&conn_guard, media_id).unwrap();
    }

    async fn upload_remote_snapshot_for_test(
        client: &GoogleDriveClient<MemoryDriveTransport>,
        token_store: &MemoryTokenStore,
        config: &SyncConfig,
        previous_generation: i64,
        snapshot: &SyncSnapshot,
    ) {
        let uploaded = client
            .upload_snapshot(token_store, &config.sync_profile_id, snapshot)
            .await
            .unwrap();
        let manifest = RemoteSyncManifest::new(
            &config.sync_profile_id,
            &snapshot.profile.profile_name,
            &snapshot.snapshot_id,
            &uploaded.snapshot_sha256,
            previous_generation + 1,
            &snapshot.created_at,
            &snapshot.created_by_device_id,
        );
        client
            .upsert_manifest_and_confirm(token_store, &manifest)
            .await
            .unwrap();
    }

    async fn queue_title_conflict_for_test(
        app_dir: &Path,
        conn: &Arc<Mutex<Connection>>,
        client: &GoogleDriveClient<MemoryDriveTransport>,
        token_store: &MemoryTokenStore,
    ) -> String {
        let media_uid = add_media(conn, "Base Title");
        create_remote_sync_profile_with_client(app_dir, conn, client, token_store, None, None)
            .await
            .unwrap();
        update_media_title(conn, &media_uid, "Local Title");
        sync_state::mark_sync_dirty_if_configured(app_dir).unwrap();

        let config = sync_state::load_sync_config(app_dir).unwrap().unwrap();
        let manifest = load_remote_manifest(client, token_store, &config.sync_profile_id)
            .await
            .unwrap();
        let mut remote = download_remote_snapshot(client, token_store, &manifest)
            .await
            .unwrap();
        let remote_media = remote.library.get_mut(&media_uid).unwrap();
        remote_media.title = "Remote Title".to_string();
        remote_media.updated_at = "2026-07-21T03:00:00Z".to_string();
        remote_media.updated_by_device_id = "dev_remote".to_string();
        remote.snapshot_id = generate_prefixed_id("snap_remote_conflict");
        remote.created_at = "2026-07-21T03:00:00Z".to_string();
        remote.created_by_device_id = "dev_remote".to_string();
        upload_remote_snapshot_for_test(
            client,
            token_store,
            &config,
            manifest.manifest.remote_generation,
            &remote,
        )
        .await;
        let result = run_sync_with_client(app_dir, conn, client, token_store, None)
            .await
            .unwrap();
        assert_eq!(
            result.sync_status.state,
            sync_state::SyncConnectionState::ConflictPending
        );
        media_uid
    }

    async fn queue_remote_duplicate_for_test(
        app_dir: &Path,
        conn: &Arc<Mutex<Connection>>,
        client: &GoogleDriveClient<MemoryDriveTransport>,
        token_store: &MemoryTokenStore,
        title: &str,
    ) -> (SyncConfig, String, String) {
        create_remote_sync_profile_with_client(app_dir, conn, client, token_store, None, None)
            .await
            .unwrap();
        let local_uid = add_media(conn, title);
        {
            let conn_guard = conn.lock().unwrap();
            let media = db::get_all_media(&conn_guard)
                .unwrap()
                .into_iter()
                .find(|media| media.uid.as_deref() == Some(local_uid.as_str()))
                .unwrap();
            db::add_log(
                &conn_guard,
                &crate::models::ActivityLog {
                    id: None,
                    media_id: media.id.unwrap(),
                    duration_minutes: 30,
                    characters: 0,
                    date: "2026-07-20".to_string(),
                    activity_type: "Playing".to_string(),
                    notes: "local history".to_string(),
                },
            )
            .unwrap();
            db::add_milestone(
                &conn_guard,
                &Milestone {
                    id: None,
                    media_uid: Some(local_uid.clone()),
                    media_title: title.to_string(),
                    name: "Local milestone".to_string(),
                    duration: 30,
                    characters: 0,
                    date: Some("2026-07-20".to_string()),
                },
            )
            .unwrap();
        }
        sync_state::mark_sync_dirty_if_configured(app_dir).unwrap();

        let config = sync_state::load_sync_config(app_dir).unwrap().unwrap();
        let remote_manifest = load_remote_manifest(client, token_store, &config.sync_profile_id)
            .await
            .unwrap();
        let mut remote_snapshot = download_remote_snapshot(client, token_store, &remote_manifest)
            .await
            .unwrap();
        let local_snapshot = build_local_snapshot(
            app_dir,
            conn,
            &config.sync_profile_id,
            Some(&remote_snapshot),
        )
        .unwrap()
        .snapshot;
        let remote_uid = "uid-remote-keep-both".to_string();
        let mut remote_media = local_snapshot.library[&local_uid].clone();
        remote_media.uid = remote_uid.clone();
        remote_media.updated_by_device_id = "dev_remote".to_string();
        remote_media.activities = vec![crate::sync_snapshot::SnapshotActivity {
            date: "2026-07-21".to_string(),
            activity_type: "Playing".to_string(),
            duration_minutes: 45,
            characters: 0,
            notes: "remote history".to_string(),
        }];
        remote_media.milestones = vec![crate::sync_snapshot::SnapshotMilestone {
            name: "Remote milestone".to_string(),
            duration: 45,
            characters: 0,
            date: Some("2026-07-21".to_string()),
        }];
        remote_snapshot
            .library
            .insert(remote_uid.clone(), remote_media);
        remote_snapshot.snapshot_id = "snap_remote_keep_both".to_string();
        remote_snapshot.created_at = "2026-07-21T01:00:00Z".to_string();
        remote_snapshot.created_by_device_id = "dev_remote".to_string();
        upload_remote_snapshot_for_test(
            client,
            token_store,
            &config,
            remote_manifest.manifest.remote_generation,
            &remote_snapshot,
        )
        .await;

        let result = run_sync_with_client(app_dir, conn, client, token_store, None)
            .await
            .unwrap();
        assert_eq!(
            result.sync_status.state,
            sync_state::SyncConnectionState::ConflictPending
        );
        (config, local_uid, remote_uid)
    }

    fn first_media_title(conn: &Arc<Mutex<Connection>>) -> String {
        let conn_guard = conn.lock().unwrap();
        db::get_all_media(&conn_guard).unwrap()[0].title.clone()
    }

    fn encode_test_png(seed: u8) -> Vec<u8> {
        let image = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(
            4,
            4,
            Rgba([seed, 255u8.saturating_sub(seed), seed / 2, 255]),
        ));
        let mut cursor = std::io::Cursor::new(Vec::new());
        image.write_to(&mut cursor, ImageFormat::Png).unwrap();
        cursor.into_inner()
    }

    fn file_to_json(file: StoredTestFile) -> serde_json::Value {
        serde_json::json!({
            "id": file.id,
            "name": file.name,
            "mimeType": file.mime_type,
            "size": file.bytes.len().to_string(),
            "modifiedTime": file.modified_time,
        })
    }

    fn file_matches_query(file: &StoredTestFile, query: &str) -> bool {
        let exact_name = query
            .split("name = '")
            .nth(1)
            .and_then(|rest| rest.split('\'').next());
        if let Some(name) = exact_name {
            return file.name == name;
        }

        let prefix = query
            .split("name contains '")
            .nth(1)
            .and_then(|rest| rest.split('\'').next());
        if let Some(prefix) = prefix {
            return file.name.contains(prefix);
        }

        true
    }

    fn next_timestamp(state: &mut TestDriveState) -> String {
        state.next_timestamp += 1;
        format!("2026-04-02T10:00:{:02}Z", state.next_timestamp)
    }

    fn parse_multipart_related(
        content_type: &str,
        body: &[u8],
    ) -> Result<(TestUploadMetadata, Vec<u8>), String> {
        let boundary = content_type
            .split("boundary=")
            .nth(1)
            .ok_or_else(|| "Missing multipart boundary".to_string())?;

        let first_prefix = format!("--{boundary}\r\n");
        let second_prefix = format!("\r\n--{boundary}\r\n");
        let final_suffix = format!("\r\n--{boundary}--\r\n");

        let after_first = body
            .strip_prefix(first_prefix.as_bytes())
            .ok_or_else(|| "Multipart body missing first boundary".to_string())?;
        let first_header_end = find_bytes(after_first, b"\r\n\r\n")
            .ok_or_else(|| "Multipart metadata headers missing".to_string())?;
        let metadata_start = first_header_end + 4;
        let metadata_end = find_bytes(&after_first[metadata_start..], second_prefix.as_bytes())
            .ok_or_else(|| "Multipart metadata section missing".to_string())?
            + metadata_start;
        let metadata = serde_json::from_slice::<TestUploadMetadata>(
            &after_first[metadata_start..metadata_end],
        )
        .map_err(|e| e.to_string())?;

        let after_second = &after_first[metadata_end + second_prefix.len()..];
        let second_header_end = find_bytes(after_second, b"\r\n\r\n")
            .ok_or_else(|| "Multipart media headers missing".to_string())?;
        let data_start = second_header_end + 4;
        let data_end = find_bytes(&after_second[data_start..], final_suffix.as_bytes())
            .ok_or_else(|| "Multipart final boundary missing".to_string())?
            + data_start;

        Ok((metadata, after_second[data_start..data_end].to_vec()))
    }

    fn maybe_overwrite_manifest_after_write(state: &mut TestDriveState, file_name: &str) {
        if !file_name.starts_with("kechimochi-manifest-") {
            return;
        }

        let Some(override_manifest) = state.overwrite_manifest_after_write.take() else {
            return;
        };
        let override_name = sync_drive::manifest_file_name(&override_manifest.profile_id);
        let target_id = state
            .files
            .iter()
            .find_map(|(id, file)| (file.name == override_name).then(|| id.clone()));
        let modified_time = next_timestamp(state);
        if let Some(target_id) = target_id {
            if let Some(file) = state.files.get_mut(&target_id) {
                file.bytes = serde_json::to_vec(&override_manifest).unwrap();
                file.modified_time = modified_time;
            }
        }
    }

    fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack
            .windows(needle.len())
            .position(|window| window == needle)
    }

    #[tokio::test]
    async fn create_remote_sync_profile_persists_sync_state() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport);
        let token_store = test_token_store();

        let media_uid = add_media(&conn, "Base Title");
        let result = create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            Some("Desk".to_string()),
            None,
        )
        .await
        .unwrap();

        assert_eq!(
            result.sync_status.state,
            sync_state::SyncConnectionState::ConnectedClean
        );
        assert!(result.published_snapshot_id.is_some());
        assert!(sync_state::load_base_snapshot(temp_dir.path())
            .unwrap()
            .is_some());

        let config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        assert_eq!(config.device_name, "Desk");
        assert_eq!(config.last_sync_status, SyncLifecycleStatus::Clean);

        let profiles = list_remote_sync_profiles_with_client(&client, &token_store)
            .await
            .unwrap();
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].profile_name, config.profile_name);
        assert!(!profiles[0].profile_name.is_empty());
        assert!(sync_state::load_pending_conflicts(temp_dir.path())
            .unwrap()
            .is_empty());
        assert!(!media_uid.is_empty());
    }

    #[tokio::test]
    async fn create_remote_profile_stays_dirty_when_local_data_changes_during_upload() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport.clone());
        let token_store = test_token_store();
        let media_uid = add_media(&conn, "Initial create target");
        let edit_conn = conn.clone();
        let edit_uid = media_uid.clone();
        transport.after_next_request(move || {
            update_media_title(&edit_conn, &edit_uid, "Edited during create");
        });

        let result = create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();

        assert_eq!(
            result.sync_status.state,
            sync_state::SyncConnectionState::Dirty
        );
        assert_eq!(first_media_title(&conn), "Edited during create");
        let config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        let manifest = load_remote_manifest(&client, &token_store, &config.sync_profile_id)
            .await
            .unwrap();
        let published = download_remote_snapshot(&client, &token_store, &manifest)
            .await
            .unwrap();
        assert_eq!(published.library[&media_uid].title, "Initial create target");
    }

    #[tokio::test]
    async fn noop_clean_finalization_rechecks_under_the_database_mutex() {
        let (temp_dir, conn) = setup_app();
        let client = build_client(MemoryDriveTransport::new());
        let token_store = test_token_store();
        let media_uid = add_media(&conn, "Initially clean");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();
        let base = sync_state::load_base_snapshot(temp_dir.path())
            .unwrap()
            .unwrap();
        sync_state::update_sync_config(temp_dir.path(), |config| {
            config.last_sync_status = SyncLifecycleStatus::Syncing;
        })
        .unwrap();

        let fresh = finalize_clean_if_local_still_matches_base_with_hook(
            temp_dir.path(),
            &conn,
            &base.profile.profile_id,
            &base,
            || {
                update_media_title(&conn, &media_uid, "Edited in clean-finalize gap");
                sync_state::update_sync_config(temp_dir.path(), |config| {
                    config.last_sync_status = SyncLifecycleStatus::Dirty;
                })
                .unwrap();
            },
        )
        .unwrap()
        .expect("the final locked snapshot must detect the intervening edit");

        assert_eq!(
            fresh.snapshot.library[&media_uid].title,
            "Edited in clean-finalize gap"
        );
        assert_eq!(
            sync_state::load_sync_config(temp_dir.path())
                .unwrap()
                .unwrap()
                .last_sync_status,
            SyncLifecycleStatus::Dirty
        );
    }

    #[tokio::test]
    async fn publish_stays_dirty_when_local_data_changes_during_network_upload() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport.clone());
        let token_store = test_token_store();
        let media_uid = add_media(&conn, "Base publish target");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();
        update_media_title(&conn, &media_uid, "Published value");
        let config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        let manifest = load_remote_manifest(&client, &token_store, &config.sync_profile_id)
            .await
            .unwrap();
        let built = build_local_snapshot(
            temp_dir.path(),
            &conn,
            &config.sync_profile_id,
            sync_state::load_base_snapshot(temp_dir.path())
                .unwrap()
                .as_ref(),
        )
        .unwrap();
        let edit_conn = conn.clone();
        let edit_uid = media_uid.clone();
        let edit_dir = temp_dir.path().to_path_buf();
        transport.after_next_request(move || {
            update_media_title(&edit_conn, &edit_uid, "Edited during publish");
            sync_state::mark_sync_dirty_if_configured(&edit_dir).unwrap();
        });

        let result = publish_snapshot_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            PublishSnapshotRequest {
                current_remote_generation: manifest.manifest.remote_generation,
                snapshot: &built.snapshot,
                synced_at: &built.created_at,
                operation: SyncProgressOperation::RunSync,
                progress: None,
            },
        )
        .await
        .unwrap();

        assert_eq!(
            result.sync_status.state,
            sync_state::SyncConnectionState::Dirty
        );
        assert_eq!(first_media_title(&conn), "Edited during publish");
        let published_manifest =
            load_remote_manifest(&client, &token_store, &config.sync_profile_id)
                .await
                .unwrap();
        let published = download_remote_snapshot(&client, &token_store, &published_manifest)
            .await
            .unwrap();
        assert_eq!(published.library[&media_uid].title, "Published value");
    }

    #[tokio::test]
    async fn create_remote_sync_profile_reports_progress_updates() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport);
        let token_store = test_token_store();
        let updates = Arc::new(Mutex::new(Vec::new()));
        let reporter_updates = updates.clone();

        add_media(&conn, "Base Title");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            Some(&move |update| {
                reporter_updates.lock().unwrap().push(update);
            }),
        )
        .await
        .unwrap();

        let recorded = updates.lock().unwrap().clone();
        assert!(recorded
            .iter()
            .any(|update| update.stage == SyncProgressStage::PreparingSnapshot));
        assert!(recorded
            .iter()
            .any(|update| update.stage == SyncProgressStage::UploadingCovers));
        assert!(recorded
            .iter()
            .any(|update| update.stage == SyncProgressStage::UploadingSnapshot));
        assert!(recorded
            .iter()
            .any(|update| update.stage == SyncProgressStage::WritingManifest));
        assert!(recorded
            .iter()
            .any(|update| update.stage == SyncProgressStage::Complete));
    }

    #[tokio::test]
    async fn attach_remote_sync_profile_inherits_remote_profile_name_for_pristine_local_db() {
        let (source_dir, source_conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport);
        let token_store = test_token_store();

        {
            let conn_guard = source_conn.lock().unwrap();
            db::set_setting(&conn_guard, "profile_name", "Remote User").unwrap();
        }
        add_media(&source_conn, "Base Title");
        create_remote_sync_profile_with_client(
            source_dir.path(),
            &source_conn,
            &client,
            &token_store,
            Some("Source".to_string()),
            None,
        )
        .await
        .unwrap();

        let source_config = sync_state::load_sync_config(source_dir.path())
            .unwrap()
            .unwrap();

        let target_dir = TempDir::new().unwrap();
        let target_conn = Arc::new(Mutex::new(
            db::init_db(target_dir.path().to_path_buf(), None).unwrap(),
        ));

        let result = attach_remote_sync_profile_with_client(
            target_dir.path(),
            &target_conn,
            &client,
            &token_store,
            &source_config.sync_profile_id,
            Some("Target".to_string()),
            None,
        )
        .await
        .unwrap();

        assert_eq!(
            result.sync_status.profile_name.as_deref(),
            Some("Remote User")
        );

        let target_config = sync_state::load_sync_config(target_dir.path())
            .unwrap()
            .unwrap();
        assert_eq!(target_config.profile_name, "Remote User");

        let persisted_profile_name = {
            let conn_guard = target_conn.lock().unwrap();
            db::get_setting(&conn_guard, "profile_name").unwrap()
        };
        assert_eq!(persisted_profile_name.as_deref(), Some("Remote User"));
    }

    #[tokio::test]
    async fn attach_cover_failure_keeps_a_recoverable_journal_for_run_sync() {
        let (source_dir, source_conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport.clone());
        let token_store = test_token_store();
        let source_uid = add_media(&source_conn, "Remote with cover");
        let source_cover_path = source_dir.path().join("source-cover.png");
        fs::write(&source_cover_path, encode_test_png(73)).unwrap();
        let source_hash = compute_sha256_hex(&fs::read(&source_cover_path).unwrap());
        update_media_cover(
            &source_conn,
            &source_uid,
            source_cover_path.to_string_lossy().as_ref(),
        );
        create_remote_sync_profile_with_client(
            source_dir.path(),
            &source_conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();
        let source_config = sync_state::load_sync_config(source_dir.path())
            .unwrap()
            .unwrap();
        let removed_blob = {
            let mut state = transport.state.lock().unwrap();
            let file_id = state
                .files
                .iter()
                .find(|(_, file)| file.name.contains(&source_hash))
                .map(|(id, _)| id.clone())
                .unwrap();
            state.files.remove(&file_id).unwrap()
        };

        let (target_dir, target_conn) = setup_app();
        let error = attach_remote_sync_profile_with_client(
            target_dir.path(),
            &target_conn,
            &client,
            &token_store,
            &source_config.sync_profile_id,
            None,
            None,
        )
        .await
        .unwrap_err();
        assert!(error.contains("Missing cover blob"));
        assert!(sync_state::has_pending_sync_state(target_dir.path()));
        assert_ne!(
            sync_state::get_sync_status(target_dir.path(), true, None)
                .unwrap()
                .state,
            sync_state::SyncConnectionState::Disconnected
        );
        transport
            .state
            .lock()
            .unwrap()
            .files
            .insert(removed_blob.id.clone(), removed_blob);

        let recovered =
            run_sync_with_client(target_dir.path(), &target_conn, &client, &token_store, None)
                .await
                .unwrap();

        assert_eq!(recovered.sync_status.conflict_count, 0);
        assert!(!sync_state::has_pending_sync_state(target_dir.path()));
        let target_media = db::get_all_media(&target_conn.lock().unwrap()).unwrap();
        assert_eq!(target_media.len(), 1);
        assert!(!target_media[0].cover_image.is_empty());
        assert!(Path::new(&target_media[0].cover_image).exists());
    }

    #[tokio::test]
    async fn materialize_snapshot_cover_blobs_lists_remote_blob_inventory_once() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport.clone());
        let token_store = test_token_store();

        let first_uid = add_media(&conn, "Alpha");
        let second_uid = add_media(&conn, "Beta");
        let mut snapshot = build_local_snapshot(temp_dir.path(), &conn, "prof_test", None)
            .unwrap()
            .snapshot;

        let first_cover = encode_test_png(32);
        let second_cover = encode_test_png(196);
        let first_hash = compute_sha256_hex(&first_cover);
        let second_hash = compute_sha256_hex(&second_cover);

        client
            .upload_blob(&token_store, &first_hash, &first_cover)
            .await
            .unwrap();
        client
            .upload_blob(&token_store, &second_hash, &second_cover)
            .await
            .unwrap();

        snapshot
            .library
            .get_mut(&first_uid)
            .unwrap()
            .cover_blob_sha256 = Some(first_hash.clone());
        snapshot
            .library
            .get_mut(&second_uid)
            .unwrap()
            .cover_blob_sha256 = Some(second_hash.clone());

        transport.clear_requests();
        materialize_snapshot_cover_blobs_with_client(
            &conn,
            temp_dir.path().join("covers").as_path(),
            &client,
            &token_store,
            MaterializeCoverBlobsRequest {
                snapshot: &snapshot,
                cas_baseline: None,
                operation: SyncProgressOperation::RunSync,
                progress: None,
            },
        )
        .await
        .unwrap();

        let list_requests = transport
            .recorded_requests()
            .into_iter()
            .filter(|(method, request_url)| {
                *method == Method::GET
                    && Url::parse(request_url)
                        .map(|url| url.path().ends_with("/drive/v3/files"))
                        .unwrap_or(false)
            })
            .count();

        assert_eq!(list_requests, 1);

        let media = {
            let conn_guard = conn.lock().unwrap();
            db::get_all_media(&conn_guard).unwrap()
        };
        assert!(media.iter().all(|entry| !entry.cover_image.is_empty()));
    }

    #[tokio::test]
    async fn cover_materialization_preserves_live_cover_changes_and_deletions_during_download() {
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport.clone());
        let token_store = test_token_store();
        let remote_cover = encode_test_png(44);
        let remote_hash = compute_sha256_hex(&remote_cover);
        client
            .upload_blob(&token_store, &remote_hash, &remote_cover)
            .await
            .unwrap();

        let (temp_dir, conn) = setup_app();
        let media_uid = add_media(&conn, "Cover race");
        let mut snapshot = build_local_snapshot(temp_dir.path(), &conn, "prof_cover", None)
            .unwrap()
            .snapshot;
        snapshot
            .library
            .get_mut(&media_uid)
            .unwrap()
            .cover_blob_sha256 = Some(remote_hash.clone());
        let user_cover_path = temp_dir.path().join("user-cover.png");
        fs::write(&user_cover_path, encode_test_png(201)).unwrap();
        let edit_conn = conn.clone();
        let edit_uid = media_uid.clone();
        let edit_path = user_cover_path.to_string_lossy().to_string();
        transport.after_next_request(move || {
            update_media_cover(&edit_conn, &edit_uid, &edit_path);
        });

        materialize_snapshot_cover_blobs_with_client(
            &conn,
            temp_dir.path().join("covers").as_path(),
            &client,
            &token_store,
            MaterializeCoverBlobsRequest {
                snapshot: &snapshot,
                cas_baseline: None,
                operation: SyncProgressOperation::RunSync,
                progress: None,
            },
        )
        .await
        .unwrap();
        let media = db::get_all_media(&conn.lock().unwrap()).unwrap();
        assert_eq!(media[0].cover_image, user_cover_path.to_string_lossy());

        let (deleted_dir, deleted_conn) = setup_app();
        let deleted_uid = add_media(&deleted_conn, "Deleted during cover download");
        let mut deleted_snapshot =
            build_local_snapshot(deleted_dir.path(), &deleted_conn, "prof_cover_delete", None)
                .unwrap()
                .snapshot;
        deleted_snapshot
            .library
            .get_mut(&deleted_uid)
            .unwrap()
            .cover_blob_sha256 = Some(remote_hash);
        let delete_conn = deleted_conn.clone();
        let delete_uid = deleted_uid.clone();
        transport.after_next_request(move || delete_media_by_uid(&delete_conn, &delete_uid));

        materialize_snapshot_cover_blobs_with_client(
            &deleted_conn,
            deleted_dir.path().join("covers").as_path(),
            &client,
            &token_store,
            MaterializeCoverBlobsRequest {
                snapshot: &deleted_snapshot,
                cas_baseline: None,
                operation: SyncProgressOperation::RunSync,
                progress: None,
            },
        )
        .await
        .unwrap();
        assert!(db::get_all_media(&deleted_conn.lock().unwrap())
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn cover_materialization_uses_the_journaled_post_apply_baseline_before_initial_capture() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport);
        let token_store = test_token_store();
        let media_uid = add_media(&conn, "Post-apply cover edit");
        let baseline = build_local_snapshot(temp_dir.path(), &conn, "prof_cover_cas", None)
            .unwrap()
            .snapshot;
        let remote_cover = encode_test_png(61);
        let remote_hash = compute_sha256_hex(&remote_cover);
        client
            .upload_blob(&token_store, &remote_hash, &remote_cover)
            .await
            .unwrap();
        let mut target = baseline.clone();
        target
            .library
            .get_mut(&media_uid)
            .unwrap()
            .cover_blob_sha256 = Some(remote_hash);
        let user_path = temp_dir.path().join("post-apply-user-cover.png");
        fs::write(&user_path, encode_test_png(211)).unwrap();
        update_media_cover(&conn, &media_uid, user_path.to_string_lossy().as_ref());

        materialize_snapshot_cover_blobs_with_client(
            &conn,
            temp_dir.path().join("covers").as_path(),
            &client,
            &token_store,
            MaterializeCoverBlobsRequest {
                snapshot: &target,
                cas_baseline: Some(&baseline),
                operation: SyncProgressOperation::RunSync,
                progress: None,
            },
        )
        .await
        .unwrap();

        let media = db::get_all_media(&conn.lock().unwrap()).unwrap();
        assert_eq!(media[0].cover_image, user_path.to_string_lossy());
    }

    #[tokio::test]
    async fn stale_local_cover_cache_is_rejected_before_installing_its_path() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport.clone());
        let token_store = test_token_store();
        let source_uid = add_media(&conn, "Cached source");
        let target_uid = add_media(&conn, "Cached target");
        let download_uid = add_media(&conn, "Needs download");
        let cached_path = temp_dir.path().join("cached-source.png");
        let cached_bytes = encode_test_png(50);
        let cached_hash = compute_sha256_hex(&cached_bytes);
        fs::write(&cached_path, &cached_bytes).unwrap();
        update_media_cover(&conn, &source_uid, cached_path.to_string_lossy().as_ref());
        let downloaded_bytes = encode_test_png(90);
        let downloaded_hash = compute_sha256_hex(&downloaded_bytes);
        client
            .upload_blob(&token_store, &downloaded_hash, &downloaded_bytes)
            .await
            .unwrap();
        let mut snapshot = build_local_snapshot(temp_dir.path(), &conn, "prof_cache", None)
            .unwrap()
            .snapshot;
        snapshot
            .library
            .get_mut(&source_uid)
            .unwrap()
            .cover_blob_sha256 = Some(cached_hash.clone());
        snapshot
            .library
            .get_mut(&target_uid)
            .unwrap()
            .cover_blob_sha256 = Some(cached_hash.clone());
        snapshot
            .library
            .get_mut(&download_uid)
            .unwrap()
            .cover_blob_sha256 = Some(downloaded_hash);
        let corrupt_path = cached_path.clone();
        transport.after_next_request(move || {
            fs::write(&corrupt_path, encode_test_png(230)).unwrap();
        });

        let error = materialize_snapshot_cover_blobs_with_client(
            &conn,
            temp_dir.path().join("covers").as_path(),
            &client,
            &token_store,
            MaterializeCoverBlobsRequest {
                snapshot: &snapshot,
                cas_baseline: None,
                operation: SyncProgressOperation::RunSync,
                progress: None,
            },
        )
        .await
        .unwrap_err();

        assert!(error.contains("changed before it could be applied"));
        let target = db::get_all_media(&conn.lock().unwrap())
            .unwrap()
            .into_iter()
            .find(|media| media.uid.as_deref() == Some(target_uid.as_str()))
            .unwrap();
        assert!(target.cover_image.is_empty());
    }

    #[tokio::test]
    async fn cover_upload_revalidates_bytes_after_the_remote_inventory_await() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport.clone());
        let token_store = test_token_store();
        let media_uid = add_media(&conn, "Upload cover race");
        let cover_path = temp_dir.path().join("upload-cover.png");
        let original = encode_test_png(12);
        let expected_hash = compute_sha256_hex(&original);
        fs::write(&cover_path, &original).unwrap();
        update_media_cover(&conn, &media_uid, cover_path.to_string_lossy().as_ref());
        let snapshot = build_local_snapshot(temp_dir.path(), &conn, "prof_upload", None)
            .unwrap()
            .snapshot;
        let changed_path = cover_path.clone();
        transport.after_next_request(move || {
            fs::write(&changed_path, encode_test_png(199)).unwrap();
        });

        let error = upload_missing_cover_blobs_with_client(
            &conn,
            &snapshot,
            &client,
            &token_store,
            SyncProgressOperation::RunSync,
            None,
        )
        .await
        .unwrap_err();

        assert!(error.contains("corrupted"));
        assert!(!transport
            .state
            .lock()
            .unwrap()
            .files
            .values()
            .any(|file| file.name.contains(&expected_hash)));
    }

    #[tokio::test]
    async fn run_sync_queues_conflicts_and_resolution_restores_local_choice() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport.clone());
        let token_store = test_token_store();

        let media_uid = add_media(&conn, "Base Title");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();

        update_media_title(&conn, &media_uid, "Local Title");
        sync_state::mark_sync_dirty_if_configured(temp_dir.path()).unwrap();

        let config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        let remote_manifest = load_remote_manifest(&client, &token_store, &config.sync_profile_id)
            .await
            .unwrap();
        let mut remote_snapshot = download_remote_snapshot(&client, &token_store, &remote_manifest)
            .await
            .unwrap();
        let remote_media = remote_snapshot.library.get_mut(&media_uid).unwrap();
        remote_media.title = "Remote Title".to_string();
        remote_media.updated_at = "2026-04-02T11:00:00Z".to_string();
        remote_media.updated_by_device_id = "dev_remote".to_string();
        remote_snapshot.snapshot_id = "snap_remote_conflict".to_string();
        remote_snapshot.created_at = "2026-04-02T11:00:00Z".to_string();
        remote_snapshot.created_by_device_id = "dev_remote".to_string();

        let uploaded = client
            .upload_snapshot(&token_store, &config.sync_profile_id, &remote_snapshot)
            .await
            .unwrap();
        let next_manifest = RemoteSyncManifest::new(
            &config.sync_profile_id,
            &remote_snapshot.profile.profile_name,
            &remote_snapshot.snapshot_id,
            &uploaded.snapshot_sha256,
            remote_manifest.manifest.remote_generation + 1,
            &remote_snapshot.created_at,
            "dev_remote",
        );
        client
            .upsert_manifest_and_confirm(&token_store, &next_manifest)
            .await
            .unwrap();

        let sync_result = run_sync_with_client(temp_dir.path(), &conn, &client, &token_store, None)
            .await
            .unwrap();
        assert_eq!(
            sync_result.sync_status.state,
            sync_state::SyncConnectionState::ConflictPending
        );
        assert!(sync_result.remote_changed);

        let conflicts = sync_state::load_pending_conflicts(temp_dir.path()).unwrap();
        assert_eq!(conflicts.len(), 1);
        assert!(matches!(
            &conflicts[0],
            SyncConflict::MediaFieldConflict { field_name, .. } if field_name == "title"
        ));

        let resolve_result = resolve_sync_conflict_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            0,
            &pending_conflict_token(temp_dir.path(), 0),
            SyncConflictResolution::MediaField {
                side: MergeSide::Local,
            },
        )
        .await
        .unwrap();

        assert_eq!(
            resolve_result.sync_status.state,
            sync_state::SyncConnectionState::Dirty
        );
        assert!(sync_state::load_pending_conflicts(temp_dir.path())
            .unwrap()
            .is_empty());
        assert_eq!(first_media_title(&conn), "Local Title");
    }

    #[tokio::test]
    async fn field_resolution_rebases_the_exact_live_value_before_applying_the_choice() {
        for (live_title, side, expected_title) in [
            ("Live Title", MergeSide::Local, "Live Title"),
            ("Live Title", MergeSide::Remote, "Remote Title"),
            ("Base Title", MergeSide::Local, "Base Title"),
        ] {
            let (temp_dir, conn) = setup_app();
            let client = build_client(MemoryDriveTransport::new());
            let token_store = test_token_store();
            let media_uid =
                queue_title_conflict_for_test(temp_dir.path(), &conn, &client, &token_store).await;
            let token = pending_conflict_token(temp_dir.path(), 0);

            update_media_title(&conn, &media_uid, live_title);
            let result = resolve_sync_conflict_with_client(
                temp_dir.path(),
                &conn,
                &client,
                &token_store,
                0,
                &token,
                SyncConflictResolution::MediaField { side },
            )
            .await
            .unwrap();

            assert_eq!(result.sync_status.conflict_count, 0);
            assert_eq!(first_media_title(&conn), expected_title);
        }
    }

    #[tokio::test]
    async fn deleting_media_while_a_field_conflict_is_open_prunes_the_stale_conflict() {
        let (temp_dir, conn) = setup_app();
        let client = build_client(MemoryDriveTransport::new());
        let token_store = test_token_store();
        let media_uid =
            queue_title_conflict_for_test(temp_dir.path(), &conn, &client, &token_store).await;
        let token = pending_conflict_token(temp_dir.path(), 0);
        delete_media_by_uid(&conn, &media_uid);

        let result = resolve_sync_conflict_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            0,
            &token,
            SyncConflictResolution::MediaField {
                side: MergeSide::Local,
            },
        )
        .await
        .unwrap();

        assert_eq!(result.sync_status.conflict_count, 0);
        assert!(sync_state::load_pending_conflicts(temp_dir.path())
            .unwrap()
            .is_empty());
        let rebuilt = build_local_snapshot(
            temp_dir.path(),
            &conn,
            result.sync_status.sync_profile_id.as_deref().unwrap(),
            sync_state::load_base_snapshot(temp_dir.path())
                .unwrap()
                .as_ref(),
        )
        .unwrap()
        .snapshot;
        assert!(!rebuilt.library.contains_key(&media_uid));
        assert!(rebuilt
            .tombstones
            .iter()
            .any(|tombstone| tombstone.media_uid == media_uid));
    }

    #[tokio::test]
    async fn conflict_tokens_make_lost_responses_idempotent_without_consuming_the_next_choice() {
        let (temp_dir, conn) = setup_app();
        let client = build_client(MemoryDriveTransport::new());
        let token_store = test_token_store();
        let first_uid = add_media(&conn, "First");
        let second_uid = add_media(&conn, "Second");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();
        let base = sync_state::load_base_snapshot(temp_dir.path())
            .unwrap()
            .unwrap();
        let config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        let conflicts = vec![
            SyncConflict::MediaFieldConflict {
                media_uid: first_uid,
                field_name: "title".to_string(),
                base_value: Some("First".to_string()),
                local_value: Some("First".to_string()),
                remote_value: Some("First remote".to_string()),
            },
            SyncConflict::MediaFieldConflict {
                media_uid: second_uid,
                field_name: "title".to_string(),
                base_value: Some("Second".to_string()),
                local_value: Some("Second".to_string()),
                remote_value: Some("Second remote".to_string()),
            },
        ];
        queue_pending_sync_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            QueuePendingSyncRequest {
                local_baseline: &base,
                merged_snapshot: &base,
                remote_base_snapshot: &base,
                conflicts: &conflicts,
                config,
                apply_snapshot_now: true,
                operation: SyncProgressOperation::RunSync,
                progress: None,
            },
        )
        .await
        .unwrap();
        let initial = get_sync_conflicts(temp_dir.path()).unwrap();
        assert_eq!(initial.len(), 2);
        let first_token = initial[0].conflict_token.clone();
        let second_token = initial[1].conflict_token.clone();
        let local_choice = SyncConflictResolution::MediaField {
            side: MergeSide::Local,
        };

        let first = resolve_sync_conflict_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            0,
            &first_token,
            local_choice.clone(),
        )
        .await
        .unwrap();
        assert_eq!(first.sync_status.conflict_count, 1);

        // Receiving/refetching the queue is not an acknowledgement. A lost IPC
        // response retried with the old token remains an idempotent no-op.
        assert_eq!(get_sync_conflicts(temp_dir.path()).unwrap().len(), 1);
        let retry = resolve_sync_conflict_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            0,
            &first_token,
            local_choice.clone(),
        )
        .await
        .unwrap();
        assert_eq!(retry.sync_status.conflict_count, 1);

        let stale = resolve_sync_conflict_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            0,
            &first_token,
            SyncConflictResolution::MediaField {
                side: MergeSide::Remote,
            },
        )
        .await
        .unwrap_err();
        assert!(stale.contains("queue changed"));
        assert_eq!(
            sync_state::pending_conflict_count(temp_dir.path()).unwrap(),
            1
        );

        let second = resolve_sync_conflict_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            0,
            &second_token,
            local_choice,
        )
        .await
        .unwrap();
        assert_eq!(second.sync_status.conflict_count, 0);
    }

    #[tokio::test]
    async fn duplicate_resolution_receipt_is_durable_while_another_duplicate_waits() {
        let (temp_dir, conn) = setup_app();
        let client = build_client(MemoryDriveTransport::new());
        let token_store = test_token_store();
        let local_uid = add_media(&conn, "Shared duplicate");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();
        let base = sync_state::load_base_snapshot(temp_dir.path())
            .unwrap()
            .unwrap();
        let mut merged = base.clone();
        for uid in ["aa-cloud-one", "bb-cloud-two"] {
            let mut cloud = base.library[&local_uid].clone();
            cloud.uid = uid.to_string();
            cloud.updated_by_device_id = "dev_cloud".to_string();
            merged.library.insert(uid.to_string(), cloud);
        }
        let conflicts = ["aa-cloud-one", "bb-cloud-two"]
            .into_iter()
            .map(|remote_uid| SyncConflict::DuplicateMediaIdentity {
                local_media: Box::new(merged.library[&local_uid].clone()),
                remote_media: Box::new(merged.library[remote_uid].clone()),
                remote_tombstone: SnapshotTombstone {
                    media_uid: remote_uid.to_string(),
                    deleted_at: "2026-07-21T04:00:00Z".to_string(),
                    deleted_by_device_id: "dev_local".to_string(),
                },
            })
            .collect::<Vec<_>>();
        let tokens = vec![
            generate_prefixed_id("conflict"),
            generate_prefixed_id("conflict"),
        ];
        let mut config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        config.last_sync_status = SyncLifecycleStatus::ConflictPending;
        sync_state::save_pending_sync_state(
            temp_dir.path(),
            &sync_state::PendingSyncState {
                version: sync_state::PENDING_SYNC_STATE_VERSION,
                conflicts,
                conflict_tokens: tokens.clone(),
                local_baseline: base.clone(),
                merged_snapshot: merged.clone(),
                remote_base_snapshot: merged,
                config,
                phase: sync_state::PendingSyncPhase::AwaitingResolution,
            },
        )
        .unwrap();
        let first_choice = SyncConflictResolution::DuplicateMediaIdentityKeepBoth {
            side: MergeSide::Remote,
            title: "Shared duplicate".to_string(),
            variant: "Cloud one".to_string(),
        };

        let first = resolve_sync_conflict_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            0,
            &tokens[0],
            first_choice.clone(),
        )
        .await
        .unwrap();
        assert_eq!(first.sync_status.conflict_count, 1);
        assert!(matches!(
            sync_state::load_pending_sync_state(temp_dir.path())
                .unwrap()
                .unwrap()
                .phase,
            sync_state::PendingSyncPhase::AwaitingResolution
        ));
        let receipt = sync_state::load_completed_resolution(temp_dir.path())
            .unwrap()
            .unwrap();
        assert_eq!(receipt.conflict_token, tokens[0]);

        let retry = resolve_sync_conflict_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            0,
            &tokens[0],
            first_choice,
        )
        .await
        .unwrap();
        assert_eq!(retry.sync_status.conflict_count, 1);

        let second = resolve_sync_conflict_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            0,
            &tokens[1],
            SyncConflictResolution::DuplicateMediaIdentityKeepBoth {
                side: MergeSide::Remote,
                title: "Shared duplicate".to_string(),
                variant: "Cloud two".to_string(),
            },
        )
        .await
        .unwrap();
        assert_eq!(second.sync_status.conflict_count, 0);
        assert_eq!(db::get_all_media(&conn.lock().unwrap()).unwrap().len(), 3);
    }

    #[tokio::test]
    async fn legacy_split_conflict_queue_migrates_before_resolution() {
        let (temp_dir, conn) = setup_app();
        let client = build_client(MemoryDriveTransport::new());
        let token_store = test_token_store();
        let media_uid = add_media(&conn, "Legacy local");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();
        let conflict = SyncConflict::MediaFieldConflict {
            media_uid,
            field_name: "title".to_string(),
            base_value: Some("Legacy base".to_string()),
            local_value: Some("Legacy local".to_string()),
            remote_value: Some("Legacy remote".to_string()),
        };
        sync_state::save_pending_conflicts(temp_dir.path(), &[conflict.clone()]).unwrap();
        let token = legacy_sync_conflict_token(&conflict).unwrap();
        sync_state::save_completed_resolution(
            temp_dir.path(),
            &sync_state::CompletedResolution {
                conflict_index: 0,
                conflict_token: token.clone(),
                resolution: serde_json::json!({"kind":"media_field","side":"local"}),
            },
        )
        .unwrap();

        let result = resolve_sync_conflict_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            0,
            &token,
            SyncConflictResolution::MediaField {
                side: MergeSide::Local,
            },
        )
        .await
        .unwrap();

        assert_eq!(result.sync_status.conflict_count, 0);
        assert!(!sync_state::pending_conflicts_path(temp_dir.path()).exists());
        assert!(!sync_state::has_pending_sync_state(temp_dir.path()));
        assert_eq!(first_media_title(&conn), "Legacy local");
    }

    #[tokio::test]
    async fn no_conflict_apply_rebases_live_edits_and_returns_the_committed_target() {
        let (temp_dir, conn) = setup_app();
        let client = build_client(MemoryDriveTransport::new());
        let token_store = test_token_store();
        let media_uid = add_media(&conn, "Original");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();
        let base = sync_state::load_base_snapshot(temp_dir.path())
            .unwrap()
            .unwrap();
        let mut target = base.clone();
        target.snapshot_id = "snap_remote_non_conflicting".to_string();
        let mut remote_added = base.library[&media_uid].clone();
        remote_added.uid = "uid-remote-added".to_string();
        remote_added.title = "Remote added".to_string();
        remote_added.updated_by_device_id = "dev_remote".to_string();
        target
            .library
            .insert(remote_added.uid.clone(), remote_added);
        let mut config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        config.last_sync_status = SyncLifecycleStatus::Dirty;
        sync_state::save_pending_sync_state(
            temp_dir.path(),
            &sync_state::PendingSyncState {
                version: sync_state::PENDING_SYNC_STATE_VERSION,
                conflicts: Vec::new(),
                conflict_tokens: Vec::new(),
                local_baseline: base.clone(),
                merged_snapshot: target.clone(),
                remote_base_snapshot: target,
                config,
                phase: sync_state::PendingSyncPhase::ApplyingSnapshot {
                    remaining_conflicts: Vec::new(),
                    resolution: None,
                    conflict_index: None,
                    conflict_token: None,
                    operation_id: Some("apply_live_rebase".to_string()),
                    database_applied: false,
                },
            },
        )
        .unwrap();
        update_media_title(&conn, &media_uid, "Live edit");

        let recovered = recover_pending_snapshot_apply(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            SyncProgressOperation::RunSync,
            None,
        )
        .await
        .unwrap();
        let committed = recovered.snapshot.unwrap();

        assert!(recovered.conflicts.is_empty());
        assert_eq!(committed.library[&media_uid].title, "Live edit");
        assert!(committed.library.contains_key("uid-remote-added"));
        let media = db::get_all_media(&conn.lock().unwrap()).unwrap();
        assert!(media.iter().any(|row| row.title == "Live edit"));
        assert!(media.iter().any(|row| row.title == "Remote added"));
        assert!(!sync_state::has_pending_sync_state(temp_dir.path()));
    }

    #[tokio::test]
    async fn applying_false_phase_uses_commit_proof_without_replaying_over_live_edits() {
        let (temp_dir, conn) = setup_app();
        let client = build_client(MemoryDriveTransport::new());
        let token_store = test_token_store();
        let media_uid = add_media(&conn, "Apply crash base");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();
        let base = sync_state::load_base_snapshot(temp_dir.path())
            .unwrap()
            .unwrap();
        let mut target = base.clone();
        target.snapshot_id = "snap_apply_crash_target".to_string();
        target.library.get_mut(&media_uid).unwrap().title = "Applied target".to_string();
        let mut config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        config.last_sync_status = SyncLifecycleStatus::Dirty;
        sync_state::save_pending_sync_state(
            temp_dir.path(),
            &sync_state::PendingSyncState {
                version: sync_state::PENDING_SYNC_STATE_VERSION,
                conflicts: Vec::new(),
                conflict_tokens: Vec::new(),
                local_baseline: base,
                merged_snapshot: target.clone(),
                remote_base_snapshot: target.clone(),
                config,
                phase: sync_state::PendingSyncPhase::ApplyingSnapshot {
                    remaining_conflicts: Vec::new(),
                    resolution: None,
                    conflict_index: None,
                    conflict_token: None,
                    operation_id: Some("apply_unmarked_commit".to_string()),
                    database_applied: false,
                },
            },
        )
        .unwrap();
        sync_snapshot::apply_snapshot_with_commit_marker(
            &conn.lock().unwrap(),
            &target,
            "apply_unmarked_commit",
            "2026-07-21T05:20:00Z",
        )
        .unwrap();
        update_media_title(&conn, &media_uid, "Edited after unmarked apply");

        recover_pending_snapshot_apply(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            SyncProgressOperation::RunSync,
            None,
        )
        .await
        .unwrap();

        let media = db::get_all_media(&conn.lock().unwrap()).unwrap();
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].title, "Edited after unmarked apply");
        assert!(!sync_state::has_pending_sync_state(temp_dir.path()));
        assert_eq!(
            sync_state::load_sync_config(temp_dir.path())
                .unwrap()
                .unwrap()
                .last_sync_status,
            SyncLifecycleStatus::Dirty
        );
    }

    #[tokio::test]
    async fn resolution_retry_recovers_after_database_apply_before_journal_cleanup() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport);
        let token_store = test_token_store();

        let media_uid = add_media(&conn, "Before recovery");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();

        let config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        let remote_base = sync_state::load_base_snapshot(temp_dir.path())
            .unwrap()
            .unwrap();
        let mut target = remote_base.clone();
        target.snapshot_id = "snap_journaled_resolution".to_string();
        target.library.get_mut(&media_uid).unwrap().title = "Recovered target".to_string();
        let conflict = SyncConflict::MediaFieldConflict {
            media_uid: media_uid.clone(),
            field_name: "title".to_string(),
            base_value: Some("Before recovery".to_string()),
            local_value: Some("Before recovery".to_string()),
            remote_value: Some("Recovered target".to_string()),
        };
        let pending = sync_state::PendingSyncState {
            version: sync_state::PENDING_SYNC_STATE_VERSION,
            conflicts: vec![conflict],
            conflict_tokens: vec!["conflict_recovery".to_string()],
            local_baseline: remote_base.clone(),
            merged_snapshot: target.clone(),
            remote_base_snapshot: remote_base,
            config,
            phase: sync_state::PendingSyncPhase::ApplyingSnapshot {
                remaining_conflicts: Vec::new(),
                resolution: Some(serde_json::json!({
                    "kind": "media_field",
                    "side": "remote"
                })),
                conflict_index: Some(0),
                conflict_token: Some("conflict_recovery".to_string()),
                operation_id: Some("apply_resolution_recovery".to_string()),
                database_applied: true,
            },
        };
        sync_state::save_pending_sync_state(temp_dir.path(), &pending).unwrap();

        // This is the crash checkpoint: SQLite committed the chosen snapshot,
        // but the process stopped before derived state files and the journal
        // could be finalized.
        {
            let conn_guard = conn.lock().unwrap();
            sync_snapshot::apply_snapshot(&conn_guard, &target).unwrap();
        }
        assert!(sync_state::has_pending_sync_state(temp_dir.path()));

        let retried = resolve_sync_conflict_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            0,
            "conflict_recovery",
            SyncConflictResolution::MediaField {
                side: MergeSide::Remote,
            },
        )
        .await
        .unwrap();

        assert_eq!(
            retried.sync_status.state,
            sync_state::SyncConnectionState::Dirty
        );
        assert_eq!(first_media_title(&conn), "Recovered target");
        assert!(!sync_state::has_pending_sync_state(temp_dir.path()));
        assert!(sync_state::load_pending_conflicts(temp_dir.path())
            .unwrap()
            .is_empty());
    }

    #[tokio::test]
    async fn run_sync_requires_explicit_combine_for_same_pair_with_different_uids() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport);
        let token_store = test_token_store();

        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();

        let local_uid = add_media(&conn, "Same natural identity");
        let unrelated_uid = add_media(&conn, "Rename after conflict");
        {
            let conn_guard = conn.lock().unwrap();
            let media_id = db::get_all_media(&conn_guard)
                .unwrap()
                .into_iter()
                .find(|entry| entry.uid.as_deref() == Some(local_uid.as_str()))
                .and_then(|entry| entry.id)
                .unwrap();
            db::add_log(
                &conn_guard,
                &crate::models::ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: 25,
                    characters: 0,
                    date: "2026-07-21".to_string(),
                    activity_type: "Playing".to_string(),
                    notes: "same visible record".to_string(),
                },
            )
            .unwrap();
        }
        sync_state::mark_sync_dirty_if_configured(temp_dir.path()).unwrap();

        let config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        let remote_manifest = load_remote_manifest(&client, &token_store, &config.sync_profile_id)
            .await
            .unwrap();
        let mut remote_snapshot = download_remote_snapshot(&client, &token_store, &remote_manifest)
            .await
            .unwrap();
        let local_snapshot = build_local_snapshot(
            temp_dir.path(),
            &conn,
            &config.sync_profile_id,
            Some(&remote_snapshot),
        )
        .unwrap()
        .snapshot;
        let mut remote_media = local_snapshot.library[&local_uid].clone();
        remote_media.uid = "uid-remote-independent".to_string();
        remote_media.updated_by_device_id = "dev_remote".to_string();
        remote_media
            .milestones
            .push(crate::sync_snapshot::SnapshotMilestone {
                name: "Remote checkpoint".to_string(),
                duration: 60,
                characters: 0,
                date: Some("2026-07-20".to_string()),
            });
        remote_snapshot
            .library
            .insert(remote_media.uid.clone(), remote_media);
        remote_snapshot.snapshot_id = "snap_remote_independent".to_string();
        remote_snapshot.created_at = "2026-07-21T01:00:00Z".to_string();
        remote_snapshot.created_by_device_id = "dev_remote".to_string();

        let uploaded = client
            .upload_snapshot(&token_store, &config.sync_profile_id, &remote_snapshot)
            .await
            .unwrap();
        let next_manifest = RemoteSyncManifest::new(
            &config.sync_profile_id,
            &remote_snapshot.profile.profile_name,
            &remote_snapshot.snapshot_id,
            &uploaded.snapshot_sha256,
            remote_manifest.manifest.remote_generation + 1,
            &remote_snapshot.created_at,
            "dev_remote",
        );
        client
            .upsert_manifest_and_confirm(&token_store, &next_manifest)
            .await
            .unwrap();

        let result = run_sync_with_client(temp_dir.path(), &conn, &client, &token_store, None)
            .await
            .unwrap();
        assert_eq!(
            result.sync_status.state,
            sync_state::SyncConnectionState::ConflictPending
        );
        let conflicts = sync_state::load_pending_conflicts(temp_dir.path()).unwrap();
        assert_eq!(conflicts.len(), 1);
        assert!(matches!(
            conflicts[0],
            SyncConflict::DuplicateMediaIdentity { .. }
        ));
        assert_eq!(
            sync_state::load_pending_merged_snapshot(temp_dir.path())
                .unwrap()
                .unwrap()
                .library
                .len(),
            3
        );
        {
            let conn_guard = conn.lock().unwrap();
            let media = db::get_all_media(&conn_guard).unwrap();
            assert_eq!(media.len(), 2);
            assert!(media
                .iter()
                .any(|entry| entry.uid.as_deref() == Some(local_uid.as_str())));
        }

        // Local changes made after the collision was queued must be rebased
        // over the pending remote merge, not replaced by its frozen snapshot.
        {
            let conn_guard = conn.lock().unwrap();
            let local_media = db::get_all_media(&conn_guard)
                .unwrap()
                .into_iter()
                .find(|entry| entry.uid.as_deref() == Some(local_uid.as_str()))
                .unwrap();
            db::add_log(
                &conn_guard,
                &crate::models::ActivityLog {
                    id: None,
                    media_id: local_media.id.unwrap(),
                    duration_minutes: 40,
                    characters: 0,
                    date: "2026-07-22".to_string(),
                    activity_type: "Playing".to_string(),
                    notes: "added while waiting".to_string(),
                },
            )
            .unwrap();
            db::add_milestone(
                &conn_guard,
                &Milestone {
                    id: None,
                    media_uid: Some(local_uid.clone()),
                    media_title: "Same natural identity".to_string(),
                    name: "Local checkpoint".to_string(),
                    duration: 90,
                    characters: 0,
                    date: Some("2026-07-22".to_string()),
                },
            )
            .unwrap();
        }
        update_media_title(&conn, &unrelated_uid, "Renamed while waiting");
        let added_while_waiting_uid = add_media(&conn, "Added while waiting");

        let resolved = resolve_sync_conflict_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            0,
            &pending_conflict_token(temp_dir.path(), 0),
            SyncConflictResolution::DuplicateMediaIdentityMerge,
        )
        .await
        .unwrap();
        assert_eq!(
            resolved.sync_status.state,
            sync_state::SyncConnectionState::Dirty
        );
        assert!(sync_state::load_pending_merged_snapshot(temp_dir.path())
            .unwrap()
            .is_none());
        {
            let conn_guard = conn.lock().unwrap();
            let media = db::get_all_media(&conn_guard).unwrap();
            assert_eq!(media.len(), 3);
            assert!(media
                .iter()
                .any(|entry| entry.uid.as_deref() == Some(local_uid.as_str())));
            assert!(media.iter().any(|entry| {
                entry.uid.as_deref() == Some(unrelated_uid.as_str())
                    && entry.title == "Renamed while waiting"
            }));
            assert!(media
                .iter()
                .any(|entry| entry.uid.as_deref() == Some(added_while_waiting_uid.as_str())));
            assert_eq!(db::get_logs(&conn_guard).unwrap().len(), 3);
            let milestones = db::get_all_milestones(&conn_guard).unwrap();
            assert_eq!(milestones.len(), 2);
            assert!(milestones
                .iter()
                .any(|milestone| milestone.name == "Local checkpoint"));
            assert!(milestones
                .iter()
                .any(|milestone| milestone.name == "Remote checkpoint"));
        }

        run_sync_with_client(temp_dir.path(), &conn, &client, &token_store, None)
            .await
            .unwrap();
        let published_manifest =
            load_remote_manifest(&client, &token_store, &config.sync_profile_id)
                .await
                .unwrap();
        let published = download_remote_snapshot(&client, &token_store, &published_manifest)
            .await
            .unwrap();
        assert!(published.library.contains_key(&local_uid));
        assert_eq!(published.library[&local_uid].activities.len(), 3);
        assert_eq!(published.library[&local_uid].milestones.len(), 2);
        assert_eq!(
            published.library[&unrelated_uid].title,
            "Renamed while waiting"
        );
        assert!(published.library.contains_key(&added_while_waiting_uid));
        assert!(published
            .tombstones
            .iter()
            .any(|tombstone| tombstone.media_uid == "uid-remote-independent"));
    }

    #[tokio::test]
    async fn keep_both_publishes_and_redownloads_isolated_histories_without_a_tombstone() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport);
        let token_store = test_token_store();
        let (config, local_uid, remote_uid) = queue_remote_duplicate_for_test(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            "Parallel identity",
        )
        .await;

        let conflicts = sync_state::load_pending_conflicts(temp_dir.path()).unwrap();
        let conflict_index = conflicts
            .iter()
            .position(|conflict| matches!(conflict, SyncConflict::DuplicateMediaIdentity { .. }))
            .unwrap();
        let resolved = resolve_sync_conflict_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            conflict_index,
            &pending_conflict_token(temp_dir.path(), conflict_index),
            SyncConflictResolution::DuplicateMediaIdentityKeepBoth {
                side: MergeSide::Remote,
                title: "Parallel identity".to_string(),
                variant: "Cloud copy".to_string(),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            resolved.sync_status.state,
            sync_state::SyncConnectionState::Dirty
        );

        {
            let conn_guard = conn.lock().unwrap();
            let media = db::get_all_media(&conn_guard).unwrap();
            assert_eq!(media.len(), 2);
            assert_eq!(
                media
                    .iter()
                    .find(|entry| entry.uid.as_deref() == Some(local_uid.as_str()))
                    .unwrap()
                    .variant,
                ""
            );
            assert_eq!(
                media
                    .iter()
                    .find(|entry| entry.uid.as_deref() == Some(remote_uid.as_str()))
                    .unwrap()
                    .variant,
                "Cloud copy"
            );
            let logs = db::get_logs(&conn_guard).unwrap();
            for entry in &media {
                let notes = logs
                    .iter()
                    .filter(|log| Some(log.media_id) == entry.id)
                    .map(|log| log.notes.as_str())
                    .collect::<Vec<_>>();
                if entry.uid.as_deref() == Some(local_uid.as_str()) {
                    assert_eq!(notes, vec!["local history"]);
                } else {
                    assert_eq!(notes, vec!["remote history"]);
                }
            }
            let milestones = db::get_all_milestones(&conn_guard).unwrap();
            assert!(milestones.iter().any(|milestone| {
                milestone.media_uid.as_deref() == Some(local_uid.as_str())
                    && milestone.name == "Local milestone"
            }));
            assert!(milestones.iter().any(|milestone| {
                milestone.media_uid.as_deref() == Some(remote_uid.as_str())
                    && milestone.name == "Remote milestone"
            }));
        }

        run_sync_with_client(temp_dir.path(), &conn, &client, &token_store, None)
            .await
            .unwrap();
        let manifest = load_remote_manifest(&client, &token_store, &config.sync_profile_id)
            .await
            .unwrap();
        let published = download_remote_snapshot(&client, &token_store, &manifest)
            .await
            .unwrap();
        assert_eq!(published.library[&local_uid].activities.len(), 1);
        assert_eq!(published.library[&remote_uid].activities.len(), 1);
        assert_eq!(published.library[&local_uid].milestones.len(), 1);
        assert_eq!(published.library[&remote_uid].milestones.len(), 1);
        assert!(
            !published
                .tombstones
                .iter()
                .any(|tombstone| tombstone.media_uid == local_uid
                    || tombstone.media_uid == remote_uid)
        );

        let redownload_dir = TempDir::new().unwrap();
        let redownload_conn = Arc::new(Mutex::new(
            db::init_db(redownload_dir.path().to_path_buf(), None).unwrap(),
        ));
        let attached = attach_remote_sync_profile_with_client(
            redownload_dir.path(),
            &redownload_conn,
            &client,
            &token_store,
            &config.sync_profile_id,
            Some("Redownload".to_string()),
            None,
        )
        .await
        .unwrap();
        assert_ne!(
            attached.sync_status.state,
            sync_state::SyncConnectionState::ConflictPending
        );
        let redownloaded = build_local_snapshot(
            redownload_dir.path(),
            &redownload_conn,
            &config.sync_profile_id,
            None,
        )
        .unwrap()
        .snapshot;
        assert_eq!(redownloaded.library[&local_uid].activities.len(), 1);
        assert_eq!(redownloaded.library[&remote_uid].activities.len(), 1);
        assert_eq!(redownloaded.library[&local_uid].milestones.len(), 1);
        assert_eq!(redownloaded.library[&remote_uid].milestones.len(), 1);
    }

    #[tokio::test]
    async fn attach_queues_duplicate_identity_until_an_explicit_resolution() {
        let (source_dir, source_conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport);
        let token_store = test_token_store();
        let remote_uid = add_media(&source_conn, "Attach collision");
        create_remote_sync_profile_with_client(
            source_dir.path(),
            &source_conn,
            &client,
            &token_store,
            Some("Source".to_string()),
            None,
        )
        .await
        .unwrap();
        let source_config = sync_state::load_sync_config(source_dir.path())
            .unwrap()
            .unwrap();

        let target_dir = TempDir::new().unwrap();
        let target_conn = Arc::new(Mutex::new(
            db::init_db(target_dir.path().to_path_buf(), None).unwrap(),
        ));
        let local_uid = add_media(&target_conn, "Attach collision");
        let attached = attach_remote_sync_profile_with_client(
            target_dir.path(),
            &target_conn,
            &client,
            &token_store,
            &source_config.sync_profile_id,
            Some("Target".to_string()),
            None,
        )
        .await
        .unwrap();
        assert_eq!(
            attached.sync_status.state,
            sync_state::SyncConnectionState::ConflictPending
        );
        assert!(sync_state::has_pending_sync_state(target_dir.path()));
        {
            let conn_guard = target_conn.lock().unwrap();
            let media = db::get_all_media(&conn_guard).unwrap();
            assert_eq!(media.len(), 1);
            assert_eq!(media[0].uid.as_deref(), Some(local_uid.as_str()));
        }

        let resolved = resolve_sync_conflict_with_client(
            target_dir.path(),
            &target_conn,
            &client,
            &token_store,
            0,
            &pending_conflict_token(target_dir.path(), 0),
            SyncConflictResolution::DuplicateMediaIdentityKeepBoth {
                side: MergeSide::Remote,
                title: "Attach collision".to_string(),
                variant: "Remote".to_string(),
            },
        )
        .await
        .unwrap();
        assert_eq!(
            resolved.sync_status.state,
            sync_state::SyncConnectionState::Dirty
        );
        let conn_guard = target_conn.lock().unwrap();
        let media = db::get_all_media(&conn_guard).unwrap();
        assert_eq!(media.len(), 2);
        assert!(media
            .iter()
            .any(|entry| entry.uid.as_deref() == Some(local_uid.as_str())));
        assert!(media.iter().any(|entry| {
            entry.uid.as_deref() == Some(remote_uid.as_str()) && entry.variant == "Remote"
        }));
    }

    #[tokio::test]
    async fn field_resolution_that_creates_an_identity_collision_queues_a_duplicate_choice() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport);
        let token_store = test_token_store();

        let first_uid = add_media(&conn, "Variant collision");
        update_media_variant(&conn, &first_uid, "Base");
        let second_uid = add_media(&conn, "Variant collision");
        update_media_variant(&conn, &second_uid, "Other");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();

        update_media_variant(&conn, &first_uid, "Local");
        update_media_variant(&conn, &second_uid, "Remote");
        sync_state::mark_sync_dirty_if_configured(temp_dir.path()).unwrap();
        let config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        let manifest = load_remote_manifest(&client, &token_store, &config.sync_profile_id)
            .await
            .unwrap();
        let mut remote = download_remote_snapshot(&client, &token_store, &manifest)
            .await
            .unwrap();
        let first_remote = remote.library.get_mut(&first_uid).unwrap();
        first_remote.variant = "Remote".to_string();
        first_remote.updated_at = "2026-07-21T04:00:00Z".to_string();
        first_remote.updated_by_device_id = "dev_remote".to_string();
        remote.snapshot_id = "snap_variant_field_collision".to_string();
        remote.created_at = "2026-07-21T04:00:00Z".to_string();
        remote.created_by_device_id = "dev_remote".to_string();
        upload_remote_snapshot_for_test(
            &client,
            &token_store,
            &config,
            manifest.manifest.remote_generation,
            &remote,
        )
        .await;

        run_sync_with_client(temp_dir.path(), &conn, &client, &token_store, None)
            .await
            .unwrap();
        let conflicts = sync_state::load_pending_conflicts(temp_dir.path()).unwrap();
        assert_eq!(conflicts.len(), 1);
        assert!(matches!(
            &conflicts[0],
            SyncConflict::MediaFieldConflict { field_name, .. } if field_name == "variant"
        ));

        let resolved = resolve_sync_conflict_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            0,
            &pending_conflict_token(temp_dir.path(), 0),
            SyncConflictResolution::MediaField {
                side: MergeSide::Remote,
            },
        )
        .await
        .unwrap();
        assert_eq!(
            resolved.sync_status.state,
            sync_state::SyncConnectionState::ConflictPending
        );
        let conflicts = sync_state::load_pending_conflicts(temp_dir.path()).unwrap();
        assert_eq!(conflicts.len(), 1);
        assert!(matches!(
            conflicts[0],
            SyncConflict::DuplicateMediaIdentity { .. }
        ));
        let pending = sync_state::load_pending_merged_snapshot(temp_dir.path())
            .unwrap()
            .unwrap();
        assert_eq!(pending.library[&first_uid].variant, "Remote");
        assert_eq!(pending.library[&second_uid].variant, "Remote");
        let conn_guard = conn.lock().unwrap();
        let media = db::get_all_media(&conn_guard).unwrap();
        assert!(media.iter().any(|entry| {
            entry.uid.as_deref() == Some(first_uid.as_str()) && entry.variant == "Local"
        }));
        assert!(media.iter().any(|entry| {
            entry.uid.as_deref() == Some(second_uid.as_str()) && entry.variant == "Remote"
        }));
    }

    #[tokio::test]
    async fn pending_conflicts_block_publish_attempts() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport);
        let token_store = test_token_store();

        let media_uid = add_media(&conn, "Base Title");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();

        let config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        let manifest_before = load_remote_manifest(&client, &token_store, &config.sync_profile_id)
            .await
            .unwrap();

        update_media_title(&conn, &media_uid, "Locally Dirty");
        sync_state::save_pending_conflicts(
            temp_dir.path(),
            &[SyncConflict::MediaFieldConflict {
                media_uid,
                field_name: "title".to_string(),
                base_value: Some("Base Title".to_string()),
                local_value: Some("Locally Dirty".to_string()),
                remote_value: Some("Remote Title".to_string()),
            }],
        )
        .unwrap();

        let result = run_sync_with_client(temp_dir.path(), &conn, &client, &token_store, None)
            .await
            .unwrap();

        assert_eq!(
            result.sync_status.state,
            sync_state::SyncConnectionState::ConflictPending
        );
        assert!(!result.remote_changed);
        assert!(!result.lost_race);

        let manifest_after = load_remote_manifest(&client, &token_store, &config.sync_profile_id)
            .await
            .unwrap();
        assert_eq!(
            manifest_before.manifest.snapshot_id,
            manifest_after.manifest.snapshot_id
        );
        assert_eq!(
            manifest_before.manifest.remote_generation,
            manifest_after.manifest.remote_generation
        );
    }

    #[tokio::test]
    async fn publish_lost_race_keeps_sync_status_dirty() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport.clone());
        let token_store = test_token_store();

        let media_uid = add_media(&conn, "Base Title");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();

        update_media_title(&conn, &media_uid, "Local Title");
        sync_state::mark_sync_dirty_if_configured(temp_dir.path()).unwrap();

        let config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        let manifest_before = load_remote_manifest(&client, &token_store, &config.sync_profile_id)
            .await
            .unwrap();
        transport.overwrite_manifest_after_next_write(RemoteSyncManifest::new(
            &config.sync_profile_id,
            &config.profile_name,
            "snap_rival",
            "sha_rival",
            manifest_before.manifest.remote_generation + 1,
            "2026-04-02T12:00:00Z",
            "dev_rival",
        ));

        let result = run_sync_with_client(temp_dir.path(), &conn, &client, &token_store, None)
            .await
            .unwrap();

        assert!(result.lost_race);
        assert_eq!(
            result.sync_status.state,
            sync_state::SyncConnectionState::Dirty
        );

        let config_after = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        assert_eq!(config_after.last_sync_status, SyncLifecycleStatus::Dirty);
        assert_eq!(
            config_after.last_confirmed_snapshot_id,
            Some(manifest_before.manifest.snapshot_id)
        );
    }

    #[tokio::test]
    async fn replace_local_from_remote_overwrites_local_state_and_clears_conflicts() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport.clone());
        let token_store = test_token_store();

        let media_uid = add_media(&conn, "Base Title");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();

        update_media_title(&conn, &media_uid, "Local Dirty");
        sync_state::save_pending_conflicts(
            temp_dir.path(),
            &[SyncConflict::MediaFieldConflict {
                media_uid: media_uid.clone(),
                field_name: "title".to_string(),
                base_value: Some("Base Title".to_string()),
                local_value: Some("Local Dirty".to_string()),
                remote_value: Some("Remote Truth".to_string()),
            }],
        )
        .unwrap();

        let config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        let remote_manifest = load_remote_manifest(&client, &token_store, &config.sync_profile_id)
            .await
            .unwrap();
        let mut remote_snapshot = download_remote_snapshot(&client, &token_store, &remote_manifest)
            .await
            .unwrap();
        let remote_media = remote_snapshot.library.get_mut(&media_uid).unwrap();
        remote_media.title = "Remote Truth".to_string();
        remote_media.updated_at = "2026-04-02T13:00:00Z".to_string();
        remote_media.updated_by_device_id = "dev_remote".to_string();
        remote_snapshot.snapshot_id = "snap_remote_truth".to_string();
        remote_snapshot.created_at = "2026-04-02T13:00:00Z".to_string();
        remote_snapshot.created_by_device_id = "dev_remote".to_string();

        let uploaded = client
            .upload_snapshot(&token_store, &config.sync_profile_id, &remote_snapshot)
            .await
            .unwrap();
        let next_manifest = RemoteSyncManifest::new(
            &config.sync_profile_id,
            &remote_snapshot.profile.profile_name,
            &remote_snapshot.snapshot_id,
            &uploaded.snapshot_sha256,
            remote_manifest.manifest.remote_generation + 1,
            &remote_snapshot.created_at,
            "dev_remote",
        );
        client
            .upsert_manifest_and_confirm(&token_store, &next_manifest)
            .await
            .unwrap();

        let result = replace_local_from_remote_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
        )
        .await
        .unwrap();

        assert_eq!(
            result.sync_status.state,
            sync_state::SyncConnectionState::ConnectedClean
        );
        assert!(result.remote_changed);
        assert!(result.published_snapshot_id.is_none());
        assert!(std::path::Path::new(result.safety_backup_path.as_deref().unwrap()).exists());
        assert_eq!(first_media_title(&conn), "Remote Truth");
        assert!(sync_state::load_pending_conflicts(temp_dir.path())
            .unwrap()
            .is_empty());

        let config_after = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        assert_eq!(config_after.last_sync_status, SyncLifecycleStatus::Clean);
        assert_eq!(
            config_after.last_confirmed_snapshot_id,
            Some("snap_remote_truth".to_string())
        );
    }

    #[tokio::test]
    async fn replace_local_from_remote_drops_local_only_identity_collisions() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport);
        let token_store = test_token_store();
        let local_uid = add_media(&conn, "Same natural identity");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();

        let config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        let remote_manifest = load_remote_manifest(&client, &token_store, &config.sync_profile_id)
            .await
            .unwrap();
        let mut remote_snapshot = download_remote_snapshot(&client, &token_store, &remote_manifest)
            .await
            .unwrap();
        let remote_uid = "media_remote_same_identity".to_string();
        let mut aggregate = remote_snapshot.library.remove(&local_uid).unwrap();
        aggregate.uid = remote_uid.clone();
        remote_snapshot
            .library
            .insert(remote_uid.clone(), aggregate);
        remote_snapshot.snapshot_id = "snap_remote_different_uid".to_string();
        let uploaded = client
            .upload_snapshot(&token_store, &config.sync_profile_id, &remote_snapshot)
            .await
            .unwrap();
        client
            .upsert_manifest_and_confirm(
                &token_store,
                &RemoteSyncManifest::new(
                    &config.sync_profile_id,
                    &remote_snapshot.profile.profile_name,
                    &remote_snapshot.snapshot_id,
                    &uploaded.snapshot_sha256,
                    remote_manifest.manifest.remote_generation + 1,
                    &remote_snapshot.created_at,
                    "dev_remote",
                ),
            )
            .await
            .unwrap();

        replace_local_from_remote_with_client(temp_dir.path(), &conn, &client, &token_store, None)
            .await
            .unwrap();

        let media = db::get_all_media(&conn.lock().unwrap()).unwrap();
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].uid.as_deref(), Some(remote_uid.as_str()));
        assert_ne!(media[0].uid.as_deref(), Some(local_uid.as_str()));
    }

    #[tokio::test]
    async fn replace_cover_retry_does_not_reapply_sqlite_over_a_live_edit() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport.clone());
        let token_store = test_token_store();
        let media_uid = add_media(&conn, "Before replacement");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();
        let base = sync_state::load_base_snapshot(temp_dir.path())
            .unwrap()
            .unwrap();
        let mut target = base.clone();
        target.snapshot_id = "snap_replace_cover".to_string();
        target.library.get_mut(&media_uid).unwrap().title = "Remote replacement".to_string();
        let cover = encode_test_png(101);
        let cover_hash = compute_sha256_hex(&cover);
        target
            .library
            .get_mut(&media_uid)
            .unwrap()
            .cover_blob_sha256 = Some(cover_hash.clone());
        client
            .upload_blob(&token_store, &cover_hash, &cover)
            .await
            .unwrap();
        let removed_blob = {
            let mut state = transport.state.lock().unwrap();
            let id = state
                .files
                .iter()
                .find(|(_, file)| file.name.contains(&cover_hash))
                .map(|(id, _)| id.clone())
                .unwrap();
            state.files.remove(&id).unwrap()
        };
        let config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        sync_state::save_pending_sync_state(
            temp_dir.path(),
            &sync_state::PendingSyncState {
                version: sync_state::PENDING_SYNC_STATE_VERSION,
                conflicts: Vec::new(),
                conflict_tokens: Vec::new(),
                local_baseline: base,
                merged_snapshot: target.clone(),
                remote_base_snapshot: target,
                config,
                phase: sync_state::PendingSyncPhase::ReplacingLocalFromRemote {
                    recovered_at: "2026-07-21T05:00:00Z".to_string(),
                    operation_id: Some("replace_cover_retry".to_string()),
                    database_applied: false,
                },
            },
        )
        .unwrap();

        let first_error = recover_pending_snapshot_apply(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            SyncProgressOperation::ReplaceLocalFromRemote,
            None,
        )
        .await
        .unwrap_err();
        assert!(first_error.contains("Missing cover blob"));
        assert_eq!(first_media_title(&conn), "Remote replacement");
        assert!(matches!(
            sync_state::load_pending_sync_state(temp_dir.path())
                .unwrap()
                .unwrap()
                .phase,
            sync_state::PendingSyncPhase::ReplacingLocalFromRemote {
                database_applied: true,
                ..
            }
        ));
        update_media_title(&conn, &media_uid, "Edited after cover failure");
        let user_cover_path = temp_dir.path().join("replace-retry-user-cover.png");
        fs::write(&user_cover_path, encode_test_png(222)).unwrap();
        update_media_cover(
            &conn,
            &media_uid,
            user_cover_path.to_string_lossy().as_ref(),
        );
        transport
            .state
            .lock()
            .unwrap()
            .files
            .insert(removed_blob.id.clone(), removed_blob);

        recover_pending_snapshot_apply(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            SyncProgressOperation::ReplaceLocalFromRemote,
            None,
        )
        .await
        .unwrap();

        assert_eq!(first_media_title(&conn), "Edited after cover failure");
        assert!(!sync_state::has_pending_sync_state(temp_dir.path()));
        assert_eq!(
            sync_state::load_sync_config(temp_dir.path())
                .unwrap()
                .unwrap()
                .last_sync_status,
            SyncLifecycleStatus::Dirty
        );
        let media = db::get_all_media(&conn.lock().unwrap()).unwrap();
        assert_eq!(media[0].cover_image, user_cover_path.to_string_lossy());
        assert!(Path::new(&media[0].cover_image).exists());
    }

    #[tokio::test]
    async fn replace_false_phase_uses_commit_proof_without_replaying_live_edits() {
        let (temp_dir, conn) = setup_app();
        let client = build_client(MemoryDriveTransport::new());
        let token_store = test_token_store();
        let media_uid = add_media(&conn, "Replace crash base");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();
        let base = sync_state::load_base_snapshot(temp_dir.path())
            .unwrap()
            .unwrap();
        let mut remote_target = base.clone();
        remote_target.snapshot_id = "snap_replace_crash_target".to_string();
        remote_target.library.get_mut(&media_uid).unwrap().title = "Cloud target".to_string();
        let config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        sync_state::save_pending_sync_state(
            temp_dir.path(),
            &sync_state::PendingSyncState {
                version: sync_state::PENDING_SYNC_STATE_VERSION,
                conflicts: Vec::new(),
                conflict_tokens: Vec::new(),
                local_baseline: base,
                merged_snapshot: remote_target.clone(),
                remote_base_snapshot: remote_target.clone(),
                config,
                phase: sync_state::PendingSyncPhase::ReplacingLocalFromRemote {
                    recovered_at: "2026-07-21T05:30:00Z".to_string(),
                    operation_id: Some("replace_unmarked_commit".to_string()),
                    database_applied: false,
                },
            },
        )
        .unwrap();
        // Simulate SQLite COMMIT followed by a crash before the external phase
        // marker, then a user edit before restart recovery.
        sync_snapshot::apply_snapshot_with_commit_marker(
            &conn.lock().unwrap(),
            &remote_target,
            "replace_unmarked_commit",
            "2026-07-21T05:30:00Z",
        )
        .unwrap();
        update_media_title(&conn, &media_uid, "Edited after unmarked commit");

        recover_pending_snapshot_apply(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            SyncProgressOperation::ReplaceLocalFromRemote,
            None,
        )
        .await
        .unwrap();

        assert_eq!(first_media_title(&conn), "Edited after unmarked commit");
        assert_eq!(
            sync_state::load_sync_config(temp_dir.path())
                .unwrap()
                .unwrap()
                .last_sync_status,
            SyncLifecycleStatus::Dirty
        );
        assert_eq!(
            sync_state::load_base_snapshot(temp_dir.path())
                .unwrap()
                .unwrap()
                .snapshot_id,
            remote_target.snapshot_id
        );
    }

    #[tokio::test]
    async fn force_publish_local_as_remote_overwrites_remote_and_clears_conflicts() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport.clone());
        let token_store = test_token_store();

        let media_uid = add_media(&conn, "Base Title");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();

        update_media_title(&conn, &media_uid, "Local Authoritative");
        sync_state::mark_sync_dirty_if_configured(temp_dir.path()).unwrap();
        sync_state::save_pending_conflicts(
            temp_dir.path(),
            &[SyncConflict::MediaFieldConflict {
                media_uid: media_uid.clone(),
                field_name: "title".to_string(),
                base_value: Some("Base Title".to_string()),
                local_value: Some("Local Authoritative".to_string()),
                remote_value: Some("Remote Diverged".to_string()),
            }],
        )
        .unwrap();

        let config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        let remote_manifest = load_remote_manifest(&client, &token_store, &config.sync_profile_id)
            .await
            .unwrap();
        let mut remote_snapshot = download_remote_snapshot(&client, &token_store, &remote_manifest)
            .await
            .unwrap();
        let remote_media = remote_snapshot.library.get_mut(&media_uid).unwrap();
        remote_media.title = "Remote Diverged".to_string();
        remote_media.updated_at = "2026-04-02T14:00:00Z".to_string();
        remote_media.updated_by_device_id = "dev_remote".to_string();
        remote_snapshot.snapshot_id = "snap_remote_diverged".to_string();
        remote_snapshot.created_at = "2026-04-02T14:00:00Z".to_string();
        remote_snapshot.created_by_device_id = "dev_remote".to_string();

        let uploaded = client
            .upload_snapshot(&token_store, &config.sync_profile_id, &remote_snapshot)
            .await
            .unwrap();
        let next_manifest = RemoteSyncManifest::new(
            &config.sync_profile_id,
            &remote_snapshot.profile.profile_name,
            &remote_snapshot.snapshot_id,
            &uploaded.snapshot_sha256,
            remote_manifest.manifest.remote_generation + 1,
            &remote_snapshot.created_at,
            "dev_remote",
        );
        client
            .upsert_manifest_and_confirm(&token_store, &next_manifest)
            .await
            .unwrap();

        let result = force_publish_local_as_remote_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
        )
        .await
        .unwrap();

        assert_eq!(
            result.sync_status.state,
            sync_state::SyncConnectionState::ConnectedClean
        );
        assert!(!result.remote_changed);
        assert!(result.published_snapshot_id.is_some());
        assert!(std::path::Path::new(result.safety_backup_path.as_deref().unwrap()).exists());
        assert!(sync_state::load_pending_conflicts(temp_dir.path())
            .unwrap()
            .is_empty());

        let manifest_after = load_remote_manifest(&client, &token_store, &config.sync_profile_id)
            .await
            .unwrap();
        assert_eq!(
            result.published_snapshot_id,
            Some(manifest_after.manifest.snapshot_id.clone())
        );

        let remote_after = download_remote_snapshot(&client, &token_store, &manifest_after)
            .await
            .unwrap();
        assert_eq!(
            remote_after.library.get(&media_uid).unwrap().title,
            "Local Authoritative"
        );

        let config_after = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        assert_eq!(config_after.last_sync_status, SyncLifecycleStatus::Clean);
    }

    #[tokio::test]
    async fn force_publish_uses_pending_remote_base_tombstones_when_cloud_and_cache_are_missing() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport);
        let token_store = test_token_store();
        add_media(&conn, "Local force source");
        let local = build_local_snapshot(temp_dir.path(), &conn, "prof_force_fallback", None)
            .unwrap()
            .snapshot;
        let mut remote_base = local.clone();
        let mut cloud_only = local.library.values().next().unwrap().clone();
        cloud_only.uid = "uid-cloud-deleted".to_string();
        cloud_only.title = "Cloud row deleted locally".to_string();
        remote_base
            .library
            .insert(cloud_only.uid.clone(), cloud_only);
        let config = SyncConfig {
            sync_profile_id: "prof_force_fallback".to_string(),
            profile_name: local.profile.profile_name.clone(),
            google_account_email: Some("user@example.com".to_string()),
            remote_manifest_name: sync_drive::manifest_file_name("prof_force_fallback"),
            last_confirmed_snapshot_id: Some(remote_base.snapshot_id.clone()),
            last_sync_at: Some(remote_base.created_at.clone()),
            last_sync_status: SyncLifecycleStatus::ConflictPending,
            device_name: "Test".to_string(),
        };
        sync_state::save_sync_config(temp_dir.path(), &config).unwrap();
        sync_state::save_pending_sync_state(
            temp_dir.path(),
            &sync_state::PendingSyncState {
                version: sync_state::PENDING_SYNC_STATE_VERSION,
                conflicts: Vec::new(),
                conflict_tokens: Vec::new(),
                local_baseline: local.clone(),
                merged_snapshot: local,
                remote_base_snapshot: remote_base,
                config,
                phase: sync_state::PendingSyncPhase::AwaitingResolution,
            },
        )
        .unwrap();
        assert!(!sync_state::base_snapshot_path(temp_dir.path()).exists());

        let result = force_publish_local_as_remote_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
        )
        .await
        .unwrap();

        assert!(!result.lost_race);
        let manifest = load_remote_manifest(&client, &token_store, "prof_force_fallback")
            .await
            .unwrap();
        let published = download_remote_snapshot(&client, &token_store, &manifest)
            .await
            .unwrap();
        assert!(published
            .tombstones
            .iter()
            .any(|tombstone| tombstone.media_uid == "uid-cloud-deleted"));
    }

    #[tokio::test]
    async fn force_publish_lost_race_returns_the_real_result_and_clears_stale_force_phase() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport.clone());
        let token_store = test_token_store();
        let media_uid = add_media(&conn, "Force race base");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();
        update_media_title(&conn, &media_uid, "Force race local");
        sync_state::mark_sync_dirty_if_configured(temp_dir.path()).unwrap();
        let config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        let current = load_remote_manifest(&client, &token_store, &config.sync_profile_id)
            .await
            .unwrap();
        let rival = RemoteSyncManifest::new(
            &config.sync_profile_id,
            &current.manifest.profile_name,
            &current.manifest.snapshot_id,
            &current.manifest.snapshot_sha256,
            current.manifest.remote_generation + 1,
            "2026-07-21T07:00:00Z",
            "dev_rival",
        );
        transport.overwrite_manifest_after_next_write(rival);

        let result = force_publish_local_as_remote_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
        )
        .await
        .unwrap();

        assert!(result.lost_race);
        assert!(result.published_snapshot_id.is_none());
        assert_eq!(
            result.sync_status.state,
            sync_state::SyncConnectionState::Dirty
        );
        assert!(!sync_state::has_pending_sync_state(temp_dir.path()));
    }

    #[tokio::test]
    async fn force_recovery_finalizes_an_already_committed_manifest_without_republishing() {
        let (temp_dir, conn) = setup_app();
        let transport = MemoryDriveTransport::new();
        let client = build_client(transport.clone());
        let token_store = test_token_store();
        let media_uid = add_media(&conn, "Force replay base");
        create_remote_sync_profile_with_client(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            None,
            None,
        )
        .await
        .unwrap();
        let config = sync_state::load_sync_config(temp_dir.path())
            .unwrap()
            .unwrap();
        let current = load_remote_manifest(&client, &token_store, &config.sync_profile_id)
            .await
            .unwrap();
        update_media_title(&conn, &media_uid, "Already published target");
        let target = build_local_snapshot(
            temp_dir.path(),
            &conn,
            &config.sync_profile_id,
            sync_state::load_base_snapshot(temp_dir.path())
                .unwrap()
                .as_ref(),
        )
        .unwrap();
        upload_remote_snapshot_for_test(
            &client,
            &token_store,
            &config,
            current.manifest.remote_generation,
            &target.snapshot,
        )
        .await;
        let mut force_config = config;
        force_config.last_sync_status = SyncLifecycleStatus::Dirty;
        sync_state::save_pending_sync_state(
            temp_dir.path(),
            &sync_state::PendingSyncState {
                version: sync_state::PENDING_SYNC_STATE_VERSION,
                conflicts: Vec::new(),
                conflict_tokens: Vec::new(),
                local_baseline: target.snapshot.clone(),
                merged_snapshot: target.snapshot.clone(),
                remote_base_snapshot: target.snapshot.clone(),
                config: force_config,
                phase: sync_state::PendingSyncPhase::ForcePublishingLocal {
                    current_remote_generation: current.manifest.remote_generation,
                    synced_at: target.created_at.clone(),
                },
            },
        )
        .unwrap();
        transport.clear_requests();

        let recovered = recover_pending_snapshot_apply(
            temp_dir.path(),
            &conn,
            &client,
            &token_store,
            SyncProgressOperation::ForcePublishLocalAsRemote,
            None,
        )
        .await
        .unwrap();

        let result = recovered.action_result.unwrap();
        assert!(!result.lost_race);
        assert_eq!(
            result.published_snapshot_id,
            Some(target.snapshot.snapshot_id)
        );
        assert!(!sync_state::has_pending_sync_state(temp_dir.path()));
        assert!(!transport
            .recorded_requests()
            .iter()
            .any(|(method, _)| *method == Method::POST || *method == Method::PATCH));
    }

    #[test]
    fn extra_data_entry_resolution_updates_only_the_target_key() {
        let mut snapshot = SyncSnapshot {
            sync_protocol_version: sync_snapshot::SYNC_PROTOCOL_VERSION,
            db_schema_version: db::CURRENT_SCHEMA_VERSION,
            snapshot_id: "snap_1".to_string(),
            created_at: "2026-04-02T10:00:00Z".to_string(),
            created_by_device_id: "dev_local".to_string(),
            profile: sync_snapshot::SnapshotProfile {
                profile_id: "prof_1".to_string(),
                profile_name: "Morg".to_string(),
                updated_at: "2026-04-02T10:00:00Z".to_string(),
            },
            library: BTreeMap::from([(
                "uid-1".to_string(),
                sync_snapshot::SnapshotMediaAggregate {
                    uid: "uid-1".to_string(),
                    title: "Test".to_string(),
                    variant: String::new(),
                    default_activity_type: "Playing".to_string(),
                    status: "Active".to_string(),
                    language: "Japanese".to_string(),
                    description: String::new(),
                    content_type: "Videogame".to_string(),
                    tracking_status: "Ongoing".to_string(),
                    extra_data: r#"{"conflict":1,"stable":"keep"}"#.to_string(),
                    cover_blob_sha256: None,
                    updated_at: "2026-04-02T10:00:00Z".to_string(),
                    updated_by_device_id: "dev_local".to_string(),
                    activities: vec![],
                    milestones: vec![],
                },
            )]),
            settings: BTreeMap::new(),
            profile_picture: None,
            tombstones: vec![],
        };

        let conflict = SyncConflict::ExtraDataEntryConflict {
            media_uid: "uid-1".to_string(),
            entry_key: "conflict".to_string(),
            base_value: Some(serde_json::json!(0)),
            local_value: Some(serde_json::json!(1)),
            remote_value: None,
        };

        apply_conflict_resolution_to_snapshot(
            &mut snapshot,
            &conflict,
            &SyncConflictResolution::ExtraDataEntry {
                side: MergeSide::Remote,
            },
        )
        .unwrap();

        assert_eq!(
            serde_json::from_str::<Value>(&snapshot.library["uid-1"].extra_data).unwrap(),
            serde_json::json!({"stable":"keep"})
        );
    }

    #[test]
    fn malformed_or_non_object_live_extra_data_deduplicates_to_one_whole_field_conflict() {
        for live_raw in ["not-json", r#"["not-an-object"]"#] {
            let (temp_dir, conn) = setup_app();
            let media_uid = add_media(&conn, "Extra data rebase");
            update_media_extra_data(
                &conn,
                &media_uid,
                r#"{"first":1,"second":10,"shared":"base"}"#,
            );
            let base = build_local_snapshot(temp_dir.path(), &conn, "prof_extra_data_rebase", None)
                .unwrap()
                .snapshot;

            let local_raw = r#"{"first":2,"local_only":"left","second":20,"shared":"base"}"#;
            update_media_extra_data(&conn, &media_uid, local_raw);
            let local = build_local_snapshot(
                temp_dir.path(),
                &conn,
                "prof_extra_data_rebase",
                Some(&base),
            )
            .unwrap()
            .snapshot;
            let cloud_raw = r#"{"first":3,"remote_only":"right","second":30,"shared":"base"}"#;
            let mut remote = base.clone();
            remote.library.get_mut(&media_uid).unwrap().extra_data = cloud_raw.to_string();

            let initial = sync_merge::merge_snapshots(Some(&base), &local, &remote).unwrap();
            let mut queued_conflicts = initial.conflicts;
            assert_eq!(queued_conflicts.len(), 2);
            assert!(queued_conflicts.iter().all(|conflict| matches!(
                conflict,
                SyncConflict::ExtraDataEntryConflict { entry_key, .. }
                    if entry_key == "first" || entry_key == "second"
            )));
            let mut provisional = initial.merged_snapshot;
            let first_index = queued_conflicts
                .iter()
                .position(|conflict| {
                    matches!(
                        conflict,
                        SyncConflict::ExtraDataEntryConflict { entry_key, .. }
                            if entry_key == "first"
                    )
                })
                .unwrap();
            let resolved_first = queued_conflicts.remove(first_index);
            apply_conflict_resolution_to_snapshot(
                &mut provisional,
                &resolved_first,
                &SyncConflictResolution::ExtraDataEntry {
                    side: MergeSide::Remote,
                },
            )
            .unwrap();
            assert_eq!(queued_conflicts.len(), 1);

            update_media_extra_data(&conn, &media_uid, live_raw);
            let live = build_local_snapshot(
                temp_dir.path(),
                &conn,
                "prof_extra_data_rebase",
                Some(&local),
            )
            .unwrap()
            .snapshot;
            let rebased = sync_merge::merge_snapshots(Some(&local), &live, &provisional).unwrap();
            assert!(rebased.conflicts.iter().any(|conflict| matches!(
                conflict,
                SyncConflict::MediaFieldConflict { field_name, .. }
                    if field_name == "extra_data"
            )));
            let mut rebased_snapshot = rebased.merged_snapshot;
            for conflict in rebased.conflicts {
                if !queued_conflicts.contains(&conflict) {
                    queued_conflicts.push(conflict);
                }
            }
            assert_eq!(queued_conflicts.len(), 2);

            refresh_rebased_conflicts(
                &mut queued_conflicts,
                &mut rebased_snapshot,
                &local,
                &remote,
            )
            .unwrap();

            assert_eq!(queued_conflicts.len(), 1);
            match &queued_conflicts[0] {
                SyncConflict::MediaFieldConflict {
                    field_name,
                    base_value,
                    local_value,
                    remote_value,
                    ..
                } => {
                    assert_eq!(field_name, "extra_data");
                    assert_eq!(base_value.as_deref(), Some(local_raw));
                    assert_eq!(local_value.as_deref(), Some(live_raw));
                    assert_eq!(remote_value.as_deref(), Some(cloud_raw));
                }
                other => panic!("expected whole-field extra_data conflict, got {other:?}"),
            }

            apply_conflict_resolution_to_snapshot(
                &mut rebased_snapshot,
                &queued_conflicts[0],
                &SyncConflictResolution::MediaField {
                    side: MergeSide::Remote,
                },
            )
            .unwrap();
            sync_snapshot::apply_snapshot(&conn.lock().unwrap(), &rebased_snapshot).unwrap();
            let media = db::get_all_media(&conn.lock().unwrap())
                .unwrap()
                .into_iter()
                .find(|media| media.uid.as_deref() == Some(media_uid.as_str()))
                .unwrap();
            assert_eq!(media.extra_data, cloud_raw);
        }
    }

    fn duplicate_test_media(uid: &str) -> SnapshotMediaAggregate {
        SnapshotMediaAggregate {
            uid: uid.to_string(),
            title: "Same title".to_string(),
            variant: "Audio".to_string(),
            default_activity_type: "Listening".to_string(),
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: String::new(),
            content_type: "Audiobook".to_string(),
            tracking_status: "Ongoing".to_string(),
            extra_data: "{}".to_string(),
            cover_blob_sha256: None,
            updated_at: "2026-07-21T00:00:00Z".to_string(),
            updated_by_device_id: "dev_source".to_string(),
            activities: vec![],
            milestones: vec![],
        }
    }

    fn duplicate_test_snapshot() -> SyncSnapshot {
        SyncSnapshot {
            sync_protocol_version: sync_snapshot::SYNC_PROTOCOL_VERSION,
            db_schema_version: db::CURRENT_SCHEMA_VERSION,
            snapshot_id: "snap_duplicate".to_string(),
            created_at: "2026-07-21T00:00:00Z".to_string(),
            created_by_device_id: "dev_local".to_string(),
            profile: sync_snapshot::SnapshotProfile {
                profile_id: "prof_1".to_string(),
                profile_name: "Morg".to_string(),
                updated_at: "2026-07-21T00:00:00Z".to_string(),
            },
            library: BTreeMap::from([
                ("uid-local".to_string(), duplicate_test_media("uid-local")),
                ("uid-remote".to_string(), duplicate_test_media("uid-remote")),
            ]),
            settings: BTreeMap::new(),
            profile_picture: None,
            tombstones: vec![],
        }
    }

    fn duplicate_test_conflict(snapshot: &SyncSnapshot) -> SyncConflict {
        SyncConflict::DuplicateMediaIdentity {
            local_media: Box::new(snapshot.library["uid-local"].clone()),
            remote_media: Box::new(snapshot.library["uid-remote"].clone()),
            remote_tombstone: SnapshotTombstone {
                media_uid: "uid-remote".to_string(),
                deleted_at: "2026-07-21T00:00:00Z".to_string(),
                deleted_by_device_id: "dev_local".to_string(),
            },
        }
    }

    #[test]
    fn sync_detects_same_title_variant_with_different_internal_identities() {
        let merged = duplicate_test_snapshot();
        let mut local = merged.clone();
        local.library.remove("uid-remote");
        let mut remote = merged.clone();
        remote.library.remove("uid-local");

        let conflicts = duplicate_media_identity_conflicts(
            &local,
            &remote,
            &merged,
            "2026-07-21T01:00:00Z",
            "dev_local",
        );

        assert_eq!(conflicts.len(), 1);
        assert!(matches!(
            &conflicts[0],
            SyncConflict::DuplicateMediaIdentity {
                local_media,
                remote_media,
                ..
            } if local_media.uid == "uid-local" && remote_media.uid == "uid-remote"
        ));
    }

    #[test]
    fn snapshot_build_holds_one_database_lock_across_tombstones_and_rows() {
        let (temp_dir, conn) = setup_app();
        add_media(&conn, "Locked snapshot");

        let built = build_local_snapshot_with_progress_and_hook(
            temp_dir.path(),
            &conn,
            "prof_lock",
            None,
            SyncProgressOperation::RunSync,
            None,
            || {
                assert!(conn.try_lock().is_err());
            },
        )
        .unwrap();

        assert_eq!(built.snapshot.library.len(), 1);
        assert!(built.snapshot.tombstones.is_empty());
    }

    #[test]
    fn delete_vs_update_restore_refreshes_the_live_candidate_and_prunes_agreed_deletes() {
        let mut current = duplicate_test_snapshot();
        current.library.remove("uid-remote");
        let mut live = current.library["uid-local"].clone();
        live.title = "Live restore candidate".to_string();
        current
            .library
            .insert("uid-local".to_string(), live.clone());
        let conflict = SyncConflict::DeleteVsUpdate {
            media_uid: "uid-local".to_string(),
            deleted_side: MergeSide::Remote,
            tombstone: SnapshotTombstone {
                media_uid: "uid-local".to_string(),
                deleted_at: "2026-07-21T01:00:00Z".to_string(),
                deleted_by_device_id: "dev_remote".to_string(),
            },
            base_media: Box::new(Some(duplicate_test_media("uid-local"))),
            local_media: Box::new(Some(duplicate_test_media("uid-local"))),
            remote_media: Box::new(None),
        };
        let mut conflicts = vec![conflict];
        let conflict_base = current.clone();
        refresh_rebased_conflicts(&mut conflicts, &mut current, &conflict_base, &conflict_base)
            .unwrap();
        assert!(matches!(
            &conflicts[0],
            SyncConflict::DeleteVsUpdate { local_media, .. }
                if local_media.as_ref().as_ref().unwrap().title == "Live restore candidate"
        ));
        apply_conflict_resolution_to_snapshot(
            &mut current,
            &conflicts[0],
            &SyncConflictResolution::DeleteVsUpdate {
                choice: DeleteVsUpdateChoice::Restore,
            },
        )
        .unwrap();
        assert_eq!(current.library["uid-local"].title, "Live restore candidate");

        current.library.clear();
        refresh_rebased_conflicts(&mut conflicts, &mut current, &conflict_base, &conflict_base)
            .unwrap();
        assert!(conflicts.is_empty());
    }

    #[test]
    fn delete_vs_update_refreshes_a_materialized_remote_restore_candidate() {
        let mut current = duplicate_test_snapshot();
        current.library.remove("uid-remote");
        current.library.get_mut("uid-local").unwrap().title =
            "Remote candidate refreshed".to_string();
        let conflict = SyncConflict::DeleteVsUpdate {
            media_uid: "uid-local".to_string(),
            deleted_side: MergeSide::Local,
            tombstone: SnapshotTombstone {
                media_uid: "uid-local".to_string(),
                deleted_at: "2026-07-21T01:00:00Z".to_string(),
                deleted_by_device_id: "dev_local".to_string(),
            },
            base_media: Box::new(Some(duplicate_test_media("uid-local"))),
            local_media: Box::new(None),
            remote_media: Box::new(Some(duplicate_test_media("uid-local"))),
        };
        let mut conflicts = vec![conflict];
        let conflict_base = current.clone();

        refresh_rebased_conflicts(&mut conflicts, &mut current, &conflict_base, &conflict_base)
            .unwrap();

        assert!(matches!(
            &conflicts[0],
            SyncConflict::DeleteVsUpdate { remote_media, .. }
                if remote_media.as_ref().as_ref().unwrap().title == "Remote candidate refreshed"
        ));
    }

    #[test]
    fn duplicate_identity_provenance_is_not_inferred_from_uid_sort_order() {
        let mut merged = duplicate_test_snapshot();
        let mut local_media = duplicate_test_media("zz-local");
        local_media.title = "Shared identity".to_string();
        local_media.variant.clear();
        let mut remote_media = local_media.clone();
        remote_media.uid = "aa-cloud".to_string();
        merged.library = BTreeMap::from([
            (local_media.uid.clone(), local_media.clone()),
            (remote_media.uid.clone(), remote_media.clone()),
        ]);
        let mut local_origin = merged.clone();
        local_origin.library.remove("aa-cloud");
        let mut remote_origin = merged.clone();
        remote_origin.library.remove("zz-local");
        let mut conflicts = Vec::new();

        refresh_duplicate_identity_conflicts_with_origins(
            &mut conflicts,
            &merged,
            Some(&local_origin),
            Some(&remote_origin),
            "2026-07-21T01:00:00Z",
            "dev_local",
        );

        assert!(matches!(
            &conflicts[0],
            SyncConflict::DuplicateMediaIdentity { local_media, remote_media, .. }
                if local_media.uid == "zz-local" && remote_media.uid == "aa-cloud"
        ));
        resolve_duplicate_media_identity(
            &mut merged,
            &conflicts[0],
            &SyncConflictResolution::DuplicateMediaIdentityKeepBoth {
                side: MergeSide::Local,
                title: "Local renamed".to_string(),
                variant: String::new(),
            },
            "2026-07-21T01:00:00Z",
            "dev_local",
        )
        .unwrap();
        assert_eq!(merged.library["zz-local"].title, "Local renamed");
        assert_eq!(merged.library["aa-cloud"].title, "Shared identity");
    }

    #[test]
    fn duplicate_identity_keep_both_requires_and_applies_a_unique_pair() {
        let mut snapshot = duplicate_test_snapshot();
        let conflict = duplicate_test_conflict(&snapshot);

        let error = resolve_duplicate_media_identity(
            &mut snapshot,
            &conflict,
            &SyncConflictResolution::DuplicateMediaIdentityKeepBoth {
                side: MergeSide::Remote,
                title: "Same title".to_string(),
                variant: "Audio".to_string(),
            },
            "2026-07-21T01:00:00Z",
            "dev_resolution",
        )
        .unwrap_err();
        assert!(error.contains("already uses"));

        resolve_duplicate_media_identity(
            &mut snapshot,
            &conflict,
            &SyncConflictResolution::DuplicateMediaIdentityKeepBoth {
                side: MergeSide::Remote,
                title: "Same title".to_string(),
                variant: "Drama CD".to_string(),
            },
            "2026-07-21T01:00:00Z",
            "dev_resolution",
        )
        .unwrap();

        assert_eq!(snapshot.library.len(), 2);
        assert_eq!(snapshot.library["uid-remote"].variant, "Drama CD");
        ensure_unique_media_identities(&snapshot).unwrap();
    }

    #[test]
    fn duplicate_identity_merge_keeps_one_uid_and_tombstones_the_other() {
        let mut snapshot = duplicate_test_snapshot();
        let conflict = duplicate_test_conflict(&snapshot);

        let conflicts = resolve_duplicate_media_identity(
            &mut snapshot,
            &conflict,
            &SyncConflictResolution::DuplicateMediaIdentityMerge,
            "2026-07-21T01:00:00Z",
            "dev_resolution",
        )
        .unwrap();

        assert!(conflicts.is_empty());
        assert_eq!(snapshot.library.len(), 1);
        assert!(snapshot.library.contains_key("uid-local"));
        assert_eq!(snapshot.tombstones.len(), 1);
        assert_eq!(snapshot.tombstones[0].media_uid, "uid-remote");
        ensure_unique_media_identities(&snapshot).unwrap();
    }
}
