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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeleteVsUpdateChoice {
    RespectDelete,
    Restore,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SyncConflictResolution {
    MediaField { side: MergeSide },
    ExtraDataEntry { side: MergeSide },
    DeleteVsUpdate { choice: DeleteVsUpdateChoice },
    ProfilePicture { side: MergeSide },
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

pub fn get_sync_conflicts(app_dir: &Path) -> Result<Vec<SyncConflict>, String> {
    sync_state::load_pending_conflicts(app_dir)
}

pub async fn resolve_sync_conflict(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    auth_config: &GoogleOAuthClientConfig,
    token_store: &dyn SecureTokenStore,
    conflict_index: usize,
    resolution: SyncConflictResolution,
) -> Result<SyncActionResult, String> {
    let client = GoogleDriveClient::new(auth_config.clone())?;
    resolve_sync_conflict_with_client(
        app_dir,
        conn,
        &client,
        token_store,
        conflict_index,
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

    sync_state::save_base_snapshot(app_dir, &built_snapshot.snapshot)?;
    sync_state::clear_pending_conflicts(app_dir)?;
    sync_state::save_sync_config(
        app_dir,
        &SyncConfig {
            sync_profile_id: profile_id.clone(),
            profile_name: built_snapshot.snapshot.profile.profile_name.clone(),
            google_account_email,
            remote_manifest_name: sync_drive::manifest_file_name(&profile_id),
            last_confirmed_snapshot_id: Some(built_snapshot.snapshot.snapshot_id.clone()),
            last_sync_at: Some(built_snapshot.created_at.clone()),
            last_sync_status: SyncLifecycleStatus::Clean,
            device_name: device_name_override.unwrap_or_else(default_device_name),
        },
    )?;
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
    let merge_outcome =
        sync_merge::merge_snapshots(None, &local_snapshot.snapshot, &remote_snapshot)?;

    apply_snapshot_and_materialize_with_client(
        conn,
        app_dir.join("covers").as_path(),
        &merge_outcome.merged_snapshot,
        client,
        token_store,
        SyncProgressOperation::AttachRemoteSyncProfile,
        progress,
    )
    .await?;

    sync_state::save_base_snapshot(app_dir, &remote_snapshot)?;
    sync_state::save_sync_config(
        app_dir,
        &SyncConfig {
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
        },
    )?;

    if !merge_outcome.conflicts.is_empty() {
        sync_state::save_pending_conflicts(app_dir, &merge_outcome.conflicts)?;
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

    sync_state::clear_pending_conflicts(app_dir)?;
    publish_snapshot_with_client(
        app_dir,
        conn,
        client,
        token_store,
        PublishSnapshotRequest {
            current_remote_generation: remote_manifest.manifest.remote_generation,
            snapshot: &merge_outcome.merged_snapshot,
            synced_at: local_snapshot.created_at.as_str(),
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
    let merge_outcome =
        sync_merge::merge_snapshots(None, &local_snapshot.snapshot, &remote_snapshot)?;

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

async fn run_sync_with_client<T: DriveTransport>(
    app_dir: &Path,
    conn: &Arc<Mutex<Connection>>,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    progress: Option<&SyncProgressReporter>,
) -> Result<SyncActionResult, String> {
    let _lock = sync_state::acquire_sync_lock(app_dir)?;
    let Some(config) = sync_state::load_sync_config(app_dir)? else {
        return Err("Sync is not configured for this profile".to_string());
    };

    if !sync_state::load_pending_conflicts(app_dir)?.is_empty() {
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
            sync_state::clear_pending_conflicts(app_dir)?;
            sync_state::update_sync_config(app_dir, |current| {
                current.profile_name = local_snapshot.snapshot.profile.profile_name.clone();
                current.last_confirmed_snapshot_id = Some(base_snapshot.snapshot_id.clone());
                current.last_sync_at = Some(local_snapshot.created_at.clone());
                current.last_sync_status = SyncLifecycleStatus::Clean;
            })?;
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
    let merge_outcome = sync_merge::merge_snapshots(
        Some(&base_snapshot),
        &local_snapshot.snapshot,
        &remote_snapshot,
    )?;

    if !merge_outcome.conflicts.is_empty() {
        apply_snapshot_and_materialize_with_client(
            conn,
            app_dir.join("covers").as_path(),
            &merge_outcome.merged_snapshot,
            client,
            token_store,
            SyncProgressOperation::RunSync,
            progress,
        )
        .await?;
        sync_state::save_base_snapshot(app_dir, &remote_snapshot)?;
        sync_state::save_pending_conflicts(app_dir, &merge_outcome.conflicts)?;
        sync_state::update_sync_config(app_dir, |current| {
            current.profile_name = merge_outcome.merged_snapshot.profile.profile_name.clone();
            current.last_confirmed_snapshot_id = Some(remote_snapshot.snapshot_id.clone());
            current.last_sync_at = Some(local_snapshot.created_at.clone());
            current.last_sync_status = SyncLifecycleStatus::ConflictPending;
        })?;
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

    apply_snapshot_and_materialize_with_client(
        conn,
        app_dir.join("covers").as_path(),
        &merge_outcome.merged_snapshot,
        client,
        token_store,
        SyncProgressOperation::RunSync,
        progress,
    )
    .await?;
    sync_state::clear_pending_conflicts(app_dir)?;

    publish_snapshot_with_client(
        app_dir,
        conn,
        client,
        token_store,
        PublishSnapshotRequest {
            current_remote_generation: remote_manifest.manifest.remote_generation,
            snapshot: &merge_outcome.merged_snapshot,
            synced_at: &local_snapshot.created_at,
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

        apply_snapshot_and_materialize_with_client(
            conn,
            app_dir.join("covers").as_path(),
            &remote_snapshot,
            client,
            token_store,
            SyncProgressOperation::ReplaceLocalFromRemote,
            progress,
        )
        .await?;

        let google_account_email = sync_auth::load_google_account_email(token_store)?;
        let recovered_at = Utc::now().to_rfc3339();
        sync_state::save_base_snapshot(app_dir, &remote_snapshot)?;
        sync_state::clear_pending_conflicts(app_dir)?;
        sync_state::update_sync_config(app_dir, |current| {
            current.profile_name = remote_snapshot.profile.profile_name.clone();
            current.google_account_email = google_account_email.clone();
            current.last_confirmed_snapshot_id = Some(remote_snapshot.snapshot_id.clone());
            current.last_sync_at = Some(recovered_at.clone());
            current.last_sync_status = SyncLifecycleStatus::Clean;
        })?;
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
        let cached_base_snapshot = sync_state::load_base_snapshot(app_dir)?;
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

        publish_snapshot_with_client(
            app_dir,
            conn,
            client,
            token_store,
            PublishSnapshotRequest {
                current_remote_generation: remote_manifest
                    .as_ref()
                    .map(|manifest| manifest.manifest.remote_generation)
                    .unwrap_or(0),
                snapshot: &built_snapshot.snapshot,
                synced_at: &built_snapshot.created_at,
                operation: SyncProgressOperation::ForcePublishLocalAsRemote,
                progress,
            },
        )
        .await
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
    resolution: SyncConflictResolution,
) -> Result<SyncActionResult, String> {
    let _lock = sync_state::acquire_sync_lock(app_dir)?;
    let Some(config) = sync_state::load_sync_config(app_dir)? else {
        return Err("Sync is not configured for this profile".to_string());
    };
    let base_snapshot = sync_state::load_base_snapshot(app_dir)?
        .ok_or_else(|| "Missing local base snapshot. Reconnect or recreate sync.".to_string())?;
    let mut conflicts = sync_state::load_pending_conflicts(app_dir)?;
    if conflict_index >= conflicts.len() {
        return Err(format!("Conflict index {conflict_index} is out of bounds"));
    }

    let conflict = conflicts
        .get(conflict_index)
        .cloned()
        .ok_or_else(|| format!("Conflict index {conflict_index} is out of bounds"))?;
    let mut local_snapshot =
        build_local_snapshot(app_dir, conn, &config.sync_profile_id, Some(&base_snapshot))?
            .snapshot;

    apply_conflict_resolution_to_snapshot(&mut local_snapshot, &conflict, &resolution)?;
    apply_snapshot_and_materialize_with_client(
        conn,
        app_dir.join("covers").as_path(),
        &local_snapshot,
        client,
        token_store,
        SyncProgressOperation::RunSync,
        None,
    )
    .await?;

    conflicts.remove(conflict_index);
    if conflicts.is_empty() {
        sync_state::clear_pending_conflicts(app_dir)?;
        sync_state::update_sync_config(app_dir, |current| {
            current.profile_name = local_snapshot.profile.profile_name.clone();
            current.last_sync_status = SyncLifecycleStatus::Dirty;
        })?;
    } else {
        sync_state::save_pending_conflicts(app_dir, &conflicts)?;
        sync_state::update_sync_config(app_dir, |current| {
            current.profile_name = local_snapshot.profile.profile_name.clone();
            current.last_sync_status = SyncLifecycleStatus::ConflictPending;
        })?;
    }

    build_action_result(app_dir, token_store, None, None, false, false)
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

    sync_state::save_base_snapshot(app_dir, snapshot)?;
    sync_state::clear_pending_conflicts(app_dir)?;
    sync_state::update_sync_config(app_dir, |current| {
        current.profile_name = snapshot.profile.profile_name.clone();
        current.google_account_email = google_account_email;
        current.last_confirmed_snapshot_id = Some(snapshot.snapshot_id.clone());
        current.last_sync_at = Some(synced_at.to_string());
        current.last_sync_status = SyncLifecycleStatus::Clean;
    })?;
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
    let remote_snapshot = client
        .download_snapshot(
            token_store,
            &remote_manifest.manifest.profile_id,
            &remote_manifest.manifest.snapshot_id,
            &remote_manifest.manifest.snapshot_sha256,
        )
        .await?;
    sync_drive::validate_remote_snapshot_compatibility(&remote_snapshot)?;
    Ok(remote_snapshot)
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
    let created_at = Utc::now().to_rfc3339();
    let device_id = sync_state::get_or_create_device_id(app_dir)?;
    let snapshot_id = generate_prefixed_id("snap");

    let tombstones = {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        derive_local_tombstones(&conn_guard, base_snapshot, &created_at, &device_id)?
    };

    let snapshot = {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
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

fn find_potential_duplicate_titles(local: &SyncSnapshot, remote: &SyncSnapshot) -> Vec<String> {
    let local_uids = local.library.keys().cloned().collect::<BTreeSet<_>>();
    let remote_uids = remote.library.keys().cloned().collect::<BTreeSet<_>>();
    let local_only = local_uids
        .difference(&remote_uids)
        .cloned()
        .collect::<BTreeSet<_>>();
    let remote_only = remote_uids
        .difference(&local_uids)
        .cloned()
        .collect::<BTreeSet<_>>();

    let local_titles = local_only
        .into_iter()
        .filter_map(|uid| local.library.get(&uid))
        .map(|media| (normalize_title(&media.title), media.title.clone()))
        .collect::<BTreeMap<_, _>>();
    let remote_titles = remote_only
        .into_iter()
        .filter_map(|uid| remote.library.get(&uid))
        .map(|media| (normalize_title(&media.title), media.title.clone()))
        .collect::<BTreeMap<_, _>>();

    let mut duplicates = BTreeSet::new();
    for (normalized, local_title) in local_titles {
        if let Some(remote_title) = remote_titles.get(&normalized) {
            duplicates.insert(local_title);
            duplicates.insert(remote_title.clone());
        }
    }

    duplicates.into_iter().collect()
}

fn normalize_title(title: &str) -> String {
    title.trim().to_lowercase()
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
        "media_type" => aggregate.media_type = required_choice(field_name, chosen)?,
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

async fn apply_snapshot_and_materialize_with_client<T: DriveTransport>(
    conn: &Arc<Mutex<Connection>>,
    covers_dir: &Path,
    snapshot: &SyncSnapshot,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    operation: SyncProgressOperation,
    progress: Option<&SyncProgressReporter>,
) -> Result<(), String> {
    report_progress(
        operation.clone(),
        progress,
        SyncProgressStage::ApplyingRemoteChanges,
        0,
        1,
        "Applying remote changes to this device...".to_string(),
    );
    {
        let conn_guard = conn.lock().map_err(|e| e.to_string())?;
        sync_snapshot::apply_snapshot(&conn_guard, snapshot)?;
    }

    materialize_snapshot_cover_blobs_with_client(
        conn,
        covers_dir,
        snapshot,
        client,
        token_store,
        operation.clone(),
        progress,
    )
    .await?;
    report_progress(
        operation,
        progress,
        SyncProgressStage::ApplyingRemoteChanges,
        1,
        1,
        "Remote changes applied on this device.".to_string(),
    );
    Ok(())
}

async fn materialize_snapshot_cover_blobs_with_client<T: DriveTransport>(
    conn: &Arc<Mutex<Connection>>,
    covers_dir: &Path,
    snapshot: &SyncSnapshot,
    client: &GoogleDriveClient<T>,
    token_store: &dyn SecureTokenStore,
    operation: SyncProgressOperation,
    progress: Option<&SyncProgressReporter>,
) -> Result<(), String> {
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
    for (uid, aggregate) in &snapshot.library {
        let Some(expected_hash) = aggregate.cover_blob_sha256.as_ref() else {
            continue;
        };
        let Some(media) = media_by_uid.get(uid) else {
            continue;
        };
        let current_hash =
            sync_snapshot::compute_cover_blob_sha256_from_path(Path::new(&media.cover_image))?;
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

        let media = media_by_uid
            .get(uid)
            .ok_or_else(|| format!("Snapshot media uid '{uid}' was not found in SQLite"))?;
        let current_hash =
            sync_snapshot::compute_cover_blob_sha256_from_path(Path::new(&media.cover_image))?;
        if current_hash.as_deref() == Some(expected_hash.as_str()) {
            continue;
        }

        let target_path = if let Some(existing_path) = local_hash_cache.get(expected_hash) {
            existing_path.clone()
        } else {
            return Err(format!(
                "Cover blob '{expected_hash}' was not materialized locally"
            ));
        };

        if media.cover_image != target_path {
            let conn_guard = conn.lock().map_err(|e| e.to_string())?;
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

    use crate::models::Media;
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

    #[derive(Debug, Default)]
    struct TestDriveState {
        next_id: usize,
        next_timestamp: usize,
        files: BTreeMap<String, StoredTestFile>,
        requests: Vec<(Method, String)>,
        expected_access_token: String,
        overwrite_manifest_after_write: Option<RemoteSyncManifest>,
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
                })),
            }
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

            {
                let mut state = self.state.lock().unwrap();
                state.requests.push((method.clone(), url.to_string()));
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

    fn add_media(conn: &Arc<Mutex<Connection>>, title: &str) -> String {
        let media = Media {
            id: None,
            uid: None,
            title: title.to_string(),
            media_type: "Playing".to_string(),
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
            &snapshot,
            &client,
            &token_store,
            SyncProgressOperation::RunSync,
            None,
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
                    media_type: "Playing".to_string(),
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
}
