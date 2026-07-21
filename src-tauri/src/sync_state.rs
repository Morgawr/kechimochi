use std::fs;
use std::fs::File;
use std::fs::OpenOptions;
use std::io::{Read, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, OnceLock};

use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use uuid::Uuid;

use crate::sync_merge::SyncConflict;
use crate::sync_snapshot::SyncSnapshot;

const SYNC_DIR_NAME: &str = "sync";
const SYNC_CONFIG_FILE: &str = "sync_config.json";
const SYNC_DEVICE_ID_FILE: &str = "sync_device_id.txt";
const BASE_SNAPSHOT_FILE: &str = "base_snapshot.json.gz";
const PENDING_CONFLICTS_FILE: &str = "pending_conflicts.json";
const PENDING_MERGED_SNAPSHOT_FILE: &str = "pending_merged_snapshot.json.gz";
const PENDING_SYNC_STATE_FILE: &str = "pending_sync_state.json.gz";
const COMPLETED_RESOLUTION_FILE: &str = "completed_resolution.json";
pub const PENDING_SYNC_STATE_VERSION: i64 = 1;
const SYNC_LOCK_FILE: &str = "sync.lock";
pub const SYNC_OPERATION_IN_PROGRESS_ERROR: &str = "Another sync operation is already in progress";

// Sync operations already serialize their network workflow with `sync.lock`,
// but ordinary database writers can mark the profile dirty while that workflow
// is running. Serialize the short local state-file transactions separately so
// a dirty read-modify-write cannot resurrect an older pending phase after a
// newer phase was saved or cleared.
static SYNC_STATE_FILES_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();

fn lock_sync_state_files() -> MutexGuard<'static, ()> {
    SYNC_STATE_FILES_MUTEX
        .get_or_init(|| Mutex::new(()))
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncLifecycleStatus {
    Clean,
    Dirty,
    Syncing,
    ConflictPending,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncConfig {
    pub sync_profile_id: String,
    pub profile_name: String,
    #[serde(default)]
    pub google_account_email: Option<String>,
    pub remote_manifest_name: String,
    #[serde(default)]
    pub last_confirmed_snapshot_id: Option<String>,
    #[serde(default)]
    pub last_sync_at: Option<String>,
    pub last_sync_status: SyncLifecycleStatus,
    pub device_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum PendingSyncPhase {
    AwaitingResolution,
    ApplyingSnapshot {
        remaining_conflicts: Vec<SyncConflict>,
        #[serde(default)]
        resolution: Option<Value>,
        #[serde(default)]
        conflict_index: Option<usize>,
        /// Stable token for the exact conflict displayed by the client. This
        /// travels with the journaled choice so a retry can be distinguished
        /// from choosing the same action for the next conflict at that index.
        #[serde(default)]
        conflict_token: Option<String>,
        /// Unique ID for the SQLite commit proof associated with this staged
        /// apply. Legacy journals acquire one before touching SQLite.
        #[serde(default)]
        operation_id: Option<String>,
        /// SQLite reached the journaled target (or its CAS-rebased equivalent)
        /// and only cover materialization/cache finalization may remain.
        #[serde(default)]
        database_applied: bool,
    },
    ReplacingLocalFromRemote {
        recovered_at: String,
        /// Unique ID for the SQLite commit proof associated with this
        /// destructive replacement.
        #[serde(default)]
        operation_id: Option<String>,
        #[serde(default)]
        database_applied: bool,
    },
    ForcePublishingLocal {
        current_remote_generation: i64,
        synced_at: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct CompletedResolution {
    #[serde(default)]
    pub conflict_index: usize,
    #[serde(default)]
    pub conflict_token: String,
    pub resolution: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PendingSyncState {
    pub version: i64,
    pub conflicts: Vec<SyncConflict>,
    /// Opaque, never-reused tokens paired positionally with `conflicts`.
    /// Tokens survive value refreshes for the same logical conflict slot so
    /// IPC retries can be validated without echoing the full conflict payload.
    #[serde(default)]
    pub conflict_tokens: Vec<String>,
    /// The database-visible snapshot against which edits made while the
    /// conflict dialog is open must be detected.
    pub local_baseline: SyncSnapshot,
    /// The provisional merged snapshot. This may intentionally contain two
    /// internal UIDs with the same visible identity until the user decides how
    /// to resolve that collision.
    pub merged_snapshot: SyncSnapshot,
    /// The downloaded snapshot that becomes the next three-way merge base once
    /// every pending conflict has been committed locally.
    pub remote_base_snapshot: SyncSnapshot,
    pub config: SyncConfig,
    pub phase: PendingSyncPhase,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SyncConnectionState {
    Disconnected,
    ConnectedClean,
    Dirty,
    Syncing,
    ConflictPending,
    Error,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncStatus {
    pub state: SyncConnectionState,
    pub google_authenticated: bool,
    #[serde(default)]
    pub sync_profile_id: Option<String>,
    #[serde(default)]
    pub profile_name: Option<String>,
    #[serde(default)]
    pub google_account_email: Option<String>,
    #[serde(default)]
    pub last_sync_at: Option<String>,
    #[serde(default)]
    pub device_name: Option<String>,
    pub conflict_count: usize,
    pub backup_size_bytes: u64,
}

pub fn sync_dir(app_dir: &Path) -> PathBuf {
    app_dir.join(SYNC_DIR_NAME)
}

pub fn sync_config_path(app_dir: &Path) -> PathBuf {
    sync_dir(app_dir).join(SYNC_CONFIG_FILE)
}

pub fn sync_device_id_path(app_dir: &Path) -> PathBuf {
    sync_dir(app_dir).join(SYNC_DEVICE_ID_FILE)
}

pub fn base_snapshot_path(app_dir: &Path) -> PathBuf {
    sync_dir(app_dir).join(BASE_SNAPSHOT_FILE)
}

pub fn pending_conflicts_path(app_dir: &Path) -> PathBuf {
    sync_dir(app_dir).join(PENDING_CONFLICTS_FILE)
}

pub fn pending_merged_snapshot_path(app_dir: &Path) -> PathBuf {
    sync_dir(app_dir).join(PENDING_MERGED_SNAPSHOT_FILE)
}

pub fn pending_sync_state_path(app_dir: &Path) -> PathBuf {
    sync_dir(app_dir).join(PENDING_SYNC_STATE_FILE)
}

pub fn completed_resolution_path(app_dir: &Path) -> PathBuf {
    sync_dir(app_dir).join(COMPLETED_RESOLUTION_FILE)
}

pub fn sync_lock_path(app_dir: &Path) -> PathBuf {
    sync_dir(app_dir).join(SYNC_LOCK_FILE)
}

pub fn ensure_sync_dir(app_dir: &Path) -> Result<PathBuf, String> {
    let dir = sync_dir(app_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn get_or_create_device_id(app_dir: &Path) -> Result<String, String> {
    let _state_guard = lock_sync_state_files();
    let path = sync_device_id_path(app_dir);
    if path.exists() {
        let existing = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let existing = existing.trim().to_string();
        if !existing.is_empty() {
            return Ok(existing);
        }
    }

    ensure_sync_dir(app_dir)?;
    let device_id = format!("dev_{}", Uuid::new_v4().simple());
    atomic_write(&path, format!("{device_id}\n").as_bytes())?;
    Ok(device_id)
}

pub fn load_sync_config(app_dir: &Path) -> Result<Option<SyncConfig>, String> {
    let _state_guard = lock_sync_state_files();
    load_sync_config_unlocked(app_dir)
}

fn load_sync_config_unlocked(app_dir: &Path) -> Result<Option<SyncConfig>, String> {
    // The journal is the transaction record, while sync_config.json is only a
    // derived cache. Prefer it even when an older cache file still exists: a
    // queue commit followed by a failed cache overwrite must not expose the
    // previous profile/generation.
    if let Some(pending) = load_pending_sync_state_unlocked(app_dir)? {
        return Ok(Some(pending.config));
    }
    let path = sync_config_path(app_dir);
    if !path.exists() {
        return Ok(None);
    }

    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw)
        .map(Some)
        .map_err(|e| e.to_string())
}

pub fn save_sync_config(app_dir: &Path, config: &SyncConfig) -> Result<(), String> {
    let _state_guard = lock_sync_state_files();
    save_sync_config_unlocked(app_dir, config)
}

fn save_sync_config_unlocked(app_dir: &Path, config: &SyncConfig) -> Result<(), String> {
    ensure_sync_dir(app_dir)?;
    let raw = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    atomic_write(&sync_config_path(app_dir), raw.as_bytes())
}

pub fn update_sync_config<F>(app_dir: &Path, update: F) -> Result<Option<SyncConfig>, String>
where
    F: FnOnce(&mut SyncConfig),
{
    let _state_guard = lock_sync_state_files();
    if let Some(mut pending) = load_pending_sync_state_unlocked(app_dir)? {
        update(&mut pending.config);
        let config = pending.config.clone();
        // The journal is authoritative while present; update it before its
        // derived config cache so a crash cannot resurrect the old lifecycle
        // state from the pending generation.
        save_pending_sync_state_unlocked(app_dir, &pending)?;
        save_sync_config_unlocked(app_dir, &config)?;
        return Ok(Some(config));
    }
    let Some(mut config) = load_sync_config_unlocked(app_dir)? else {
        return Ok(None);
    };

    update(&mut config);
    save_sync_config_unlocked(app_dir, &config)?;
    Ok(Some(config))
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| format!("State path '{}' has no parent", path.display()))?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    temp.write_all(bytes).map_err(|e| e.to_string())?;
    temp.as_file().sync_all().map_err(|e| e.to_string())?;
    // NamedTempFile's overwrite persist uses MoveFileExW with
    // MOVEFILE_REPLACE_EXISTING on Windows and rename(2) on Unix, so the
    // second and subsequent state generations are as atomic as the first.
    temp.persist(path).map_err(|e| e.error.to_string())?;
    if let Ok(dir) = File::open(parent) {
        let _ = dir.sync_all();
    }
    Ok(())
}

fn save_compressed_json<T: Serialize>(path: PathBuf, value: &T) -> Result<(), String> {
    let canonical_json = serde_json::to_string(value).map_err(|e| e.to_string())?;
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(canonical_json.as_bytes())
        .map_err(|e| e.to_string())?;
    let gzipped_bytes = encoder.finish().map_err(|e| e.to_string())?;
    atomic_write(&path, &gzipped_bytes)
}

fn load_compressed_json<T: DeserializeOwned>(path: PathBuf) -> Result<Option<T>, String> {
    if !path.exists() {
        return Ok(None);
    }

    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let mut decoder = GzDecoder::new(bytes.as_slice());
    let mut json = String::new();
    decoder
        .read_to_string(&mut json)
        .map_err(|e| e.to_string())?;
    serde_json::from_str(&json)
        .map(Some)
        .map_err(|e| e.to_string())
}

pub fn save_base_snapshot(app_dir: &Path, snapshot: &SyncSnapshot) -> Result<(), String> {
    let _state_guard = lock_sync_state_files();
    save_base_snapshot_unlocked(app_dir, snapshot)
}

fn save_base_snapshot_unlocked(app_dir: &Path, snapshot: &SyncSnapshot) -> Result<(), String> {
    ensure_sync_dir(app_dir)?;
    save_compressed_json(base_snapshot_path(app_dir), snapshot)
}

pub fn load_base_snapshot(app_dir: &Path) -> Result<Option<SyncSnapshot>, String> {
    let _state_guard = lock_sync_state_files();
    load_base_snapshot_unlocked(app_dir)
}

fn load_base_snapshot_unlocked(app_dir: &Path) -> Result<Option<SyncSnapshot>, String> {
    load_compressed_json(base_snapshot_path(app_dir))
}

pub fn save_pending_merged_snapshot(app_dir: &Path, snapshot: &SyncSnapshot) -> Result<(), String> {
    let _state_guard = lock_sync_state_files();
    save_pending_merged_snapshot_unlocked(app_dir, snapshot)
}

fn save_pending_merged_snapshot_unlocked(
    app_dir: &Path,
    snapshot: &SyncSnapshot,
) -> Result<(), String> {
    ensure_sync_dir(app_dir)?;
    save_compressed_json(pending_merged_snapshot_path(app_dir), snapshot)
}

pub fn load_pending_merged_snapshot(app_dir: &Path) -> Result<Option<SyncSnapshot>, String> {
    let _state_guard = lock_sync_state_files();
    load_pending_merged_snapshot_unlocked(app_dir)
}

fn load_pending_merged_snapshot_unlocked(app_dir: &Path) -> Result<Option<SyncSnapshot>, String> {
    if let Some(pending) = load_pending_sync_state_unlocked(app_dir)? {
        return Ok(Some(pending.merged_snapshot));
    }
    load_compressed_json(pending_merged_snapshot_path(app_dir))
}

pub fn clear_pending_merged_snapshot(app_dir: &Path) -> Result<(), String> {
    let _state_guard = lock_sync_state_files();
    clear_pending_merged_snapshot_unlocked(app_dir)
}

fn clear_pending_merged_snapshot_unlocked(app_dir: &Path) -> Result<(), String> {
    remove_file_if_exists_unlocked(&pending_merged_snapshot_path(app_dir))
}

pub fn save_pending_conflicts(app_dir: &Path, conflicts: &[SyncConflict]) -> Result<(), String> {
    let _state_guard = lock_sync_state_files();
    save_pending_conflicts_unlocked(app_dir, conflicts)
}

fn save_pending_conflicts_unlocked(
    app_dir: &Path,
    conflicts: &[SyncConflict],
) -> Result<(), String> {
    ensure_sync_dir(app_dir)?;
    let raw = serde_json::to_string_pretty(conflicts).map_err(|e| e.to_string())?;
    atomic_write(&pending_conflicts_path(app_dir), raw.as_bytes())
}

pub fn load_pending_conflicts(app_dir: &Path) -> Result<Vec<SyncConflict>, String> {
    let _state_guard = lock_sync_state_files();
    load_pending_conflicts_unlocked(app_dir)
}

fn load_pending_conflicts_unlocked(app_dir: &Path) -> Result<Vec<SyncConflict>, String> {
    if let Some(pending) = load_pending_sync_state_unlocked(app_dir)? {
        return Ok(pending.conflicts);
    }
    let path = pending_conflicts_path(app_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn save_pending_sync_state(app_dir: &Path, state: &PendingSyncState) -> Result<(), String> {
    let _state_guard = lock_sync_state_files();
    save_pending_sync_state_unlocked(app_dir, state)
}

fn save_pending_sync_state_unlocked(
    app_dir: &Path,
    state: &PendingSyncState,
) -> Result<(), String> {
    ensure_sync_dir(app_dir)?;
    save_compressed_json(pending_sync_state_path(app_dir), state)
}

pub fn load_pending_sync_state(app_dir: &Path) -> Result<Option<PendingSyncState>, String> {
    let _state_guard = lock_sync_state_files();
    load_pending_sync_state_unlocked(app_dir)
}

fn load_pending_sync_state_unlocked(app_dir: &Path) -> Result<Option<PendingSyncState>, String> {
    let state: Option<PendingSyncState> = load_compressed_json(pending_sync_state_path(app_dir))?;
    if let Some(state) = &state {
        if state.version != PENDING_SYNC_STATE_VERSION {
            return Err(format!(
                "Unsupported pending sync state version {} (expected {})",
                state.version, PENDING_SYNC_STATE_VERSION
            ));
        }
    }
    Ok(state)
}

pub fn clear_pending_sync_state(app_dir: &Path) -> Result<(), String> {
    let _state_guard = lock_sync_state_files();
    clear_pending_sync_state_unlocked(app_dir)
}

fn clear_pending_sync_state_unlocked(app_dir: &Path) -> Result<(), String> {
    remove_file_if_exists_unlocked(&pending_sync_state_path(app_dir))
}

pub fn has_pending_sync_state(app_dir: &Path) -> bool {
    let _state_guard = lock_sync_state_files();
    pending_sync_state_path(app_dir).exists()
}

pub fn save_completed_resolution(
    app_dir: &Path,
    receipt: &CompletedResolution,
) -> Result<(), String> {
    let _state_guard = lock_sync_state_files();
    save_completed_resolution_unlocked(app_dir, receipt)
}

fn save_completed_resolution_unlocked(
    app_dir: &Path,
    receipt: &CompletedResolution,
) -> Result<(), String> {
    ensure_sync_dir(app_dir)?;
    let raw = serde_json::to_vec(receipt).map_err(|e| e.to_string())?;
    atomic_write(&completed_resolution_path(app_dir), &raw)
}

pub fn load_completed_resolution(app_dir: &Path) -> Result<Option<CompletedResolution>, String> {
    let _state_guard = lock_sync_state_files();
    load_completed_resolution_unlocked(app_dir)
}

fn load_completed_resolution_unlocked(
    app_dir: &Path,
) -> Result<Option<CompletedResolution>, String> {
    let path = completed_resolution_path(app_dir);
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read(path).map_err(|e| e.to_string())?;
    serde_json::from_slice(&raw)
        .map(Some)
        .map_err(|e| e.to_string())
}

pub fn clear_completed_resolution(app_dir: &Path) -> Result<(), String> {
    let _state_guard = lock_sync_state_files();
    clear_completed_resolution_unlocked(app_dir)
}

fn clear_completed_resolution_unlocked(app_dir: &Path) -> Result<(), String> {
    remove_file_if_exists_unlocked(&completed_resolution_path(app_dir))
}

pub fn clear_pending_conflicts(app_dir: &Path) -> Result<(), String> {
    let _state_guard = lock_sync_state_files();
    clear_pending_conflicts_unlocked(app_dir)
}

fn clear_pending_conflicts_unlocked(app_dir: &Path) -> Result<(), String> {
    remove_file_if_exists_unlocked(&pending_conflicts_path(app_dir))
}

fn remove_file_if_exists_unlocked(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn pending_conflict_count(app_dir: &Path) -> Result<usize, String> {
    let _state_guard = lock_sync_state_files();
    Ok(load_pending_conflicts_unlocked(app_dir)?.len())
}

pub fn mark_sync_dirty_if_configured(app_dir: &Path) -> Result<bool, String> {
    let updated = update_sync_config(app_dir, |config| {
        if config.last_sync_status != SyncLifecycleStatus::ConflictPending {
            config.last_sync_status = SyncLifecycleStatus::Dirty;
        }
    })?;
    Ok(updated.is_some())
}

#[derive(Debug)]
pub struct SyncLockGuard {
    // The operating system owns the lifetime of this advisory lock. Keeping
    // the file handle alive holds the lock, and closing it (including after a
    // crash) releases the lock automatically. The lock file itself is
    // intentionally persistent so no caller can unlink a locked inode and
    // create a second, independently lockable file at the same path.
    _file: File,
}

pub fn acquire_sync_lock(app_dir: &Path) -> Result<SyncLockGuard, String> {
    ensure_sync_dir(app_dir)?;
    let path = sync_lock_path(app_dir);
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(path)
        .map_err(|e| e.to_string())?;

    match file.try_lock() {
        Ok(()) => {}
        Err(std::fs::TryLockError::WouldBlock) => {
            return Err(SYNC_OPERATION_IN_PROGRESS_ERROR.to_string());
        }
        Err(std::fs::TryLockError::Error(err)) => return Err(err.to_string()),
    }

    // Metadata is diagnostic only; ownership is determined exclusively by the
    // advisory lock, never by age or PID.
    file.set_len(0).map_err(|e| e.to_string())?;
    file.rewind().map_err(|e| e.to_string())?;
    file.write_all(format!("pid={}\n", std::process::id()).as_bytes())
        .map_err(|e| e.to_string())?;
    file.sync_data().map_err(|e| e.to_string())?;

    Ok(SyncLockGuard { _file: file })
}

pub fn clear_sync_runtime_files(app_dir: &Path) -> Result<(), String> {
    let _state_guard = lock_sync_state_files();
    for path in [
        sync_config_path(app_dir),
        base_snapshot_path(app_dir),
        pending_conflicts_path(app_dir),
        pending_merged_snapshot_path(app_dir),
        pending_sync_state_path(app_dir),
        completed_resolution_path(app_dir),
    ] {
        remove_file_if_exists_unlocked(&path)?;
    }

    let dir = sync_dir(app_dir);
    if dir.exists()
        && fs::read_dir(&dir)
            .map_err(|e| e.to_string())?
            .next()
            .is_none()
    {
        fs::remove_dir(&dir).map_err(|e| e.to_string())?;
    }

    Ok(())
}

pub fn get_sync_status(
    app_dir: &Path,
    google_authenticated: bool,
    google_account_email: Option<String>,
) -> Result<SyncStatus, String> {
    let (config, conflict_count) = {
        let _state_guard = lock_sync_state_files();
        (
            load_sync_config_unlocked(app_dir)?,
            load_pending_conflicts_unlocked(app_dir)?.len(),
        )
    };
    let backup_size_bytes = calculate_backup_size(app_dir);

    if let Some(config) = config {
        return Ok(SyncStatus {
            state: if conflict_count > 0 {
                SyncConnectionState::ConflictPending
            } else {
                map_lifecycle_status(config.last_sync_status)
            },
            google_authenticated,
            sync_profile_id: Some(config.sync_profile_id),
            profile_name: Some(config.profile_name),
            google_account_email: config.google_account_email.or(google_account_email),
            last_sync_at: config.last_sync_at,
            device_name: Some(config.device_name),
            conflict_count,
            backup_size_bytes,
        });
    }

    Ok(SyncStatus {
        state: SyncConnectionState::Disconnected,
        google_authenticated,
        sync_profile_id: None,
        profile_name: None,
        google_account_email,
        last_sync_at: None,
        device_name: None,
        conflict_count,
        backup_size_bytes,
    })
}

pub fn calculate_backup_size(app_dir: &Path) -> u64 {
    let dir = sync_dir(app_dir);
    if !dir.exists() {
        return 0;
    }

    walkdir::WalkDir::new(dir)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| {
            e.file_type().is_file()
                && e.file_name()
                    .to_string_lossy()
                    .starts_with("pre_sync_backup_")
                && e.file_name().to_string_lossy().ends_with(".zip")
        })
        .map(|e| e.metadata().map(|m| m.len()).unwrap_or(0))
        .sum()
}

pub fn clear_sync_backups(app_dir: &Path) -> Result<(), String> {
    let dir = sync_dir(app_dir);
    if !dir.exists() {
        return Ok(());
    }

    for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.is_file() {
            let name = path.file_name().unwrap_or_default().to_string_lossy();
            if name.starts_with("pre_sync_backup_") && name.ends_with(".zip") {
                fs::remove_file(path).map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(())
}

fn map_lifecycle_status(status: SyncLifecycleStatus) -> SyncConnectionState {
    match status {
        SyncLifecycleStatus::Clean => SyncConnectionState::ConnectedClean,
        SyncLifecycleStatus::Dirty => SyncConnectionState::Dirty,
        SyncLifecycleStatus::Syncing => SyncConnectionState::Syncing,
        SyncLifecycleStatus::ConflictPending => SyncConnectionState::ConflictPending,
        SyncLifecycleStatus::Error => SyncConnectionState::Error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync_snapshot;
    use std::sync::{mpsc, Arc};
    use std::thread;
    use std::time::Duration;
    use tempfile::TempDir;

    fn concurrency_test_snapshot(snapshot_id: &str) -> SyncSnapshot {
        SyncSnapshot {
            sync_protocol_version: 1,
            db_schema_version: 6,
            snapshot_id: snapshot_id.to_string(),
            created_at: "2026-07-21T00:00:00Z".to_string(),
            created_by_device_id: "dev_1".to_string(),
            profile: sync_snapshot::SnapshotProfile {
                profile_id: "prof_1".to_string(),
                profile_name: "Morg".to_string(),
                updated_at: "2026-07-21T00:00:00Z".to_string(),
            },
            library: Default::default(),
            settings: Default::default(),
            profile_picture: None,
            tombstones: Vec::new(),
        }
    }

    fn concurrency_test_pending_state() -> PendingSyncState {
        let snapshot = concurrency_test_snapshot("snap_pending_race");
        PendingSyncState {
            version: PENDING_SYNC_STATE_VERSION,
            conflicts: Vec::new(),
            conflict_tokens: Vec::new(),
            local_baseline: snapshot.clone(),
            merged_snapshot: snapshot.clone(),
            remote_base_snapshot: snapshot,
            config: SyncConfig {
                sync_profile_id: "prof_1".to_string(),
                profile_name: "Morg".to_string(),
                google_account_email: None,
                remote_manifest_name: "manifest".to_string(),
                last_confirmed_snapshot_id: Some("snap_pending_race".to_string()),
                last_sync_at: None,
                last_sync_status: SyncLifecycleStatus::ConflictPending,
                device_name: "Desk".to_string(),
            },
            phase: PendingSyncPhase::AwaitingResolution,
        }
    }

    #[test]
    fn device_id_is_stable_once_created() {
        let temp_dir = TempDir::new().unwrap();

        let first = get_or_create_device_id(temp_dir.path()).unwrap();
        let second = get_or_create_device_id(temp_dir.path()).unwrap();

        assert_eq!(first, second);
        assert!(first.starts_with("dev_"));
    }

    #[test]
    fn state_files_can_be_atomically_replaced() {
        let temp_dir = TempDir::new().unwrap();
        let mut config = SyncConfig {
            sync_profile_id: "prof_1".to_string(),
            profile_name: "First".to_string(),
            google_account_email: None,
            remote_manifest_name: "manifest".to_string(),
            last_confirmed_snapshot_id: None,
            last_sync_at: None,
            last_sync_status: SyncLifecycleStatus::Dirty,
            device_name: "Desk".to_string(),
        };
        save_sync_config(temp_dir.path(), &config).unwrap();
        config.profile_name = "Second".to_string();
        config.last_sync_status = SyncLifecycleStatus::Clean;
        save_sync_config(temp_dir.path(), &config).unwrap();

        assert_eq!(load_sync_config(temp_dir.path()).unwrap(), Some(config));
    }

    #[test]
    fn clear_sync_runtime_files_removes_config_and_pending_conflicts() {
        let temp_dir = TempDir::new().unwrap();
        ensure_sync_dir(temp_dir.path()).unwrap();
        fs::write(sync_config_path(temp_dir.path()), "{}").unwrap();
        fs::write(base_snapshot_path(temp_dir.path()), "snapshot").unwrap();
        fs::write(pending_conflicts_path(temp_dir.path()), "[]").unwrap();
        fs::write(pending_merged_snapshot_path(temp_dir.path()), "snapshot").unwrap();
        fs::write(pending_sync_state_path(temp_dir.path()), "journal").unwrap();
        fs::write(sync_device_id_path(temp_dir.path()), "dev_keep\n").unwrap();

        clear_sync_runtime_files(temp_dir.path()).unwrap();

        assert!(!sync_config_path(temp_dir.path()).exists());
        assert!(!base_snapshot_path(temp_dir.path()).exists());
        assert!(!pending_conflicts_path(temp_dir.path()).exists());
        assert!(!pending_merged_snapshot_path(temp_dir.path()).exists());
        assert!(!pending_sync_state_path(temp_dir.path()).exists());
        assert!(sync_device_id_path(temp_dir.path()).exists());
    }

    #[test]
    fn base_snapshot_round_trips() {
        let temp_dir = TempDir::new().unwrap();
        let snapshot = SyncSnapshot {
            sync_protocol_version: 1,
            db_schema_version: 2,
            snapshot_id: "snap_1".to_string(),
            created_at: "2026-04-02T00:00:00Z".to_string(),
            created_by_device_id: "dev_1".to_string(),
            profile: sync_snapshot::SnapshotProfile {
                profile_id: "prof_1".to_string(),
                profile_name: "Morg".to_string(),
                updated_at: "2026-04-02T00:00:00Z".to_string(),
            },
            library: Default::default(),
            settings: Default::default(),
            profile_picture: None,
            tombstones: Vec::new(),
        };

        save_base_snapshot(temp_dir.path(), &snapshot).unwrap();
        let loaded = load_base_snapshot(temp_dir.path()).unwrap().unwrap();

        assert_eq!(loaded, snapshot);
    }

    #[test]
    fn pending_merged_snapshot_round_trips_and_clears() {
        let temp_dir = TempDir::new().unwrap();
        let snapshot = SyncSnapshot {
            sync_protocol_version: 1,
            db_schema_version: 6,
            snapshot_id: "snap_pending".to_string(),
            created_at: "2026-07-21T00:00:00Z".to_string(),
            created_by_device_id: "dev_1".to_string(),
            profile: sync_snapshot::SnapshotProfile {
                profile_id: "prof_1".to_string(),
                profile_name: "Morg".to_string(),
                updated_at: "2026-07-21T00:00:00Z".to_string(),
            },
            library: Default::default(),
            settings: Default::default(),
            profile_picture: None,
            tombstones: Vec::new(),
        };

        save_pending_merged_snapshot(temp_dir.path(), &snapshot).unwrap();
        assert_eq!(
            load_pending_merged_snapshot(temp_dir.path()).unwrap(),
            Some(snapshot)
        );

        clear_pending_merged_snapshot(temp_dir.path()).unwrap();
        assert!(load_pending_merged_snapshot(temp_dir.path())
            .unwrap()
            .is_none());
    }

    #[test]
    fn pending_conflicts_round_trip() {
        let temp_dir = TempDir::new().unwrap();
        let conflicts = vec![SyncConflict::MediaFieldConflict {
            media_uid: "uid_1".to_string(),
            field_name: "title".to_string(),
            base_value: Some("Base".to_string()),
            local_value: Some("Local".to_string()),
            remote_value: Some("Remote".to_string()),
        }];

        save_pending_conflicts(temp_dir.path(), &conflicts).unwrap();
        assert_eq!(load_pending_conflicts(temp_dir.path()).unwrap(), conflicts);
        assert_eq!(pending_conflict_count(temp_dir.path()).unwrap(), 1);

        clear_pending_conflicts(temp_dir.path()).unwrap();
        assert!(load_pending_conflicts(temp_dir.path()).unwrap().is_empty());
    }

    #[test]
    fn pending_sync_journal_round_trips_as_the_authoritative_generation() {
        let temp_dir = TempDir::new().unwrap();
        let snapshot = SyncSnapshot {
            sync_protocol_version: 1,
            db_schema_version: 6,
            snapshot_id: "snap_pending_generation".to_string(),
            created_at: "2026-07-21T00:00:00Z".to_string(),
            created_by_device_id: "dev_1".to_string(),
            profile: sync_snapshot::SnapshotProfile {
                profile_id: "prof_1".to_string(),
                profile_name: "Morg".to_string(),
                updated_at: "2026-07-21T00:00:00Z".to_string(),
            },
            library: Default::default(),
            settings: Default::default(),
            profile_picture: None,
            tombstones: Vec::new(),
        };
        let journal_conflict = SyncConflict::MediaFieldConflict {
            media_uid: "uid_journal".to_string(),
            field_name: "title".to_string(),
            base_value: Some("Base".to_string()),
            local_value: Some("Local".to_string()),
            remote_value: Some("Remote".to_string()),
        };
        let stale_legacy_conflict = SyncConflict::MediaFieldConflict {
            media_uid: "uid_stale".to_string(),
            field_name: "title".to_string(),
            base_value: None,
            local_value: Some("Stale".to_string()),
            remote_value: Some("Legacy".to_string()),
        };
        save_pending_conflicts(temp_dir.path(), &[stale_legacy_conflict]).unwrap();

        let stale_config = SyncConfig {
            sync_profile_id: "prof_stale".to_string(),
            profile_name: "Stale".to_string(),
            google_account_email: None,
            remote_manifest_name: "stale-manifest".to_string(),
            last_confirmed_snapshot_id: None,
            last_sync_at: None,
            last_sync_status: SyncLifecycleStatus::Clean,
            device_name: "Old desk".to_string(),
        };
        save_sync_config(temp_dir.path(), &stale_config).unwrap();

        let state = PendingSyncState {
            version: PENDING_SYNC_STATE_VERSION,
            conflicts: vec![journal_conflict.clone()],
            conflict_tokens: vec!["conflict_test".to_string()],
            local_baseline: snapshot.clone(),
            merged_snapshot: snapshot.clone(),
            remote_base_snapshot: snapshot,
            config: SyncConfig {
                sync_profile_id: "prof_1".to_string(),
                profile_name: "Morg".to_string(),
                google_account_email: None,
                remote_manifest_name: "manifest".to_string(),
                last_confirmed_snapshot_id: Some("snap_pending_generation".to_string()),
                last_sync_at: Some("2026-07-21T00:00:00Z".to_string()),
                last_sync_status: SyncLifecycleStatus::ConflictPending,
                device_name: "Desk".to_string(),
            },
            phase: PendingSyncPhase::AwaitingResolution,
        };
        save_pending_sync_state(temp_dir.path(), &state).unwrap();

        assert_eq!(
            load_pending_sync_state(temp_dir.path()).unwrap(),
            Some(state.clone())
        );
        assert_eq!(
            load_pending_conflicts(temp_dir.path()).unwrap(),
            vec![journal_conflict]
        );
        assert_eq!(pending_conflict_count(temp_dir.path()).unwrap(), 1);
        assert_eq!(
            load_sync_config(temp_dir.path()).unwrap(),
            Some(state.config)
        );
    }

    #[test]
    fn dirty_config_update_cannot_overwrite_a_newer_pending_phase() {
        let temp_dir = TempDir::new().unwrap();
        let initial = concurrency_test_pending_state();
        save_pending_sync_state(temp_dir.path(), &initial).unwrap();

        let app_dir = Arc::new(temp_dir.path().to_path_buf());
        let (update_entered_tx, update_entered_rx) = mpsc::channel();
        let (release_update_tx, release_update_rx) = mpsc::channel();
        let update_dir = Arc::clone(&app_dir);
        let updater = thread::spawn(move || {
            update_sync_config(update_dir.as_path(), |config| {
                update_entered_tx.send(()).unwrap();
                release_update_rx.recv().unwrap();
                config.last_sync_status = SyncLifecycleStatus::Dirty;
            })
            .unwrap()
        });
        update_entered_rx.recv().unwrap();

        let mut advanced = initial;
        advanced.config.last_sync_status = SyncLifecycleStatus::Syncing;
        advanced.phase = PendingSyncPhase::ForcePublishingLocal {
            current_remote_generation: 42,
            synced_at: "2026-07-21T00:00:01Z".to_string(),
        };
        let expected = advanced.clone();
        let save_dir = Arc::clone(&app_dir);
        let (save_started_tx, save_started_rx) = mpsc::channel();
        let (save_done_tx, save_done_rx) = mpsc::channel();
        let saver = thread::spawn(move || {
            save_started_tx.send(()).unwrap();
            let result = save_pending_sync_state(save_dir.as_path(), &advanced);
            save_done_tx.send(()).unwrap();
            result
        });
        save_started_rx.recv().unwrap();

        let save_was_blocked = save_done_rx
            .recv_timeout(Duration::from_millis(100))
            .is_err();
        release_update_tx.send(()).unwrap();
        updater.join().unwrap();
        saver.join().unwrap().unwrap();

        assert!(
            save_was_blocked,
            "the phase save must wait for the config read-modify-write"
        );
        assert_eq!(
            load_pending_sync_state(app_dir.as_path()).unwrap(),
            Some(expected.clone())
        );
        assert_eq!(
            load_sync_config(app_dir.as_path()).unwrap(),
            Some(expected.config)
        );
    }

    #[test]
    fn runtime_clear_cannot_be_undone_by_an_in_flight_config_update() {
        let temp_dir = TempDir::new().unwrap();
        let initial = concurrency_test_pending_state();
        save_pending_sync_state(temp_dir.path(), &initial).unwrap();
        save_sync_config(temp_dir.path(), &initial.config).unwrap();

        let app_dir = Arc::new(temp_dir.path().to_path_buf());
        let (update_entered_tx, update_entered_rx) = mpsc::channel();
        let (release_update_tx, release_update_rx) = mpsc::channel();
        let update_dir = Arc::clone(&app_dir);
        let updater = thread::spawn(move || {
            update_sync_config(update_dir.as_path(), |config| {
                update_entered_tx.send(()).unwrap();
                release_update_rx.recv().unwrap();
                config.last_sync_status = SyncLifecycleStatus::Dirty;
            })
            .unwrap()
        });
        update_entered_rx.recv().unwrap();

        let clear_dir = Arc::clone(&app_dir);
        let (clear_started_tx, clear_started_rx) = mpsc::channel();
        let (clear_done_tx, clear_done_rx) = mpsc::channel();
        let clearer = thread::spawn(move || {
            clear_started_tx.send(()).unwrap();
            let result = clear_sync_runtime_files(clear_dir.as_path());
            clear_done_tx.send(()).unwrap();
            result
        });
        clear_started_rx.recv().unwrap();

        let clear_was_blocked = clear_done_rx
            .recv_timeout(Duration::from_millis(100))
            .is_err();
        release_update_tx.send(()).unwrap();
        updater.join().unwrap();
        clearer.join().unwrap().unwrap();

        assert!(
            clear_was_blocked,
            "the runtime clear must wait for the config read-modify-write"
        );
        assert_eq!(load_sync_config(app_dir.as_path()).unwrap(), None);
        assert_eq!(load_pending_sync_state(app_dir.as_path()).unwrap(), None);
        assert!(!sync_config_path(app_dir.as_path()).exists());
        assert!(!pending_sync_state_path(app_dir.as_path()).exists());
    }

    #[test]
    fn sync_lock_prevents_parallel_syncs() {
        let temp_dir = TempDir::new().unwrap();
        let _guard = acquire_sync_lock(temp_dir.path()).unwrap();
        let err = acquire_sync_lock(temp_dir.path()).unwrap_err();
        assert_eq!(err, SYNC_OPERATION_IN_PROGRESS_ERROR);
    }

    #[test]
    fn sync_lock_release_allows_reacquire_without_deleting_lock_file() {
        let temp_dir = TempDir::new().unwrap();
        let guard = acquire_sync_lock(temp_dir.path()).unwrap();
        drop(guard);

        assert!(sync_lock_path(temp_dir.path()).exists());
        let _next_guard = acquire_sync_lock(temp_dir.path()).unwrap();
    }

    #[test]
    fn sync_lock_reuses_an_unlocked_file_regardless_of_stale_metadata() {
        let temp_dir = TempDir::new().unwrap();
        ensure_sync_dir(temp_dir.path()).unwrap();
        fs::write(
            sync_lock_path(temp_dir.path()),
            "pid=123\ncreated_at_unix=1\n",
        )
        .unwrap();

        let guard = acquire_sync_lock(temp_dir.path()).unwrap();
        assert!(sync_lock_path(temp_dir.path()).exists());
        drop(guard);
        let contents = fs::read_to_string(sync_lock_path(temp_dir.path())).unwrap();
        assert_eq!(contents, format!("pid={}\n", std::process::id()));
    }

    #[test]
    fn calculate_backup_size_sums_zip_files() {
        let temp_dir = TempDir::new().unwrap();
        let app_dir = temp_dir.path();
        let sync_dir = sync_dir(app_dir);
        fs::create_dir_all(&sync_dir).unwrap();

        fs::write(sync_dir.join("pre_sync_backup_1.zip"), "abc").unwrap();
        fs::write(sync_dir.join("pre_sync_backup_2.zip"), "defgh").unwrap();
        fs::write(sync_dir.join("other.txt"), "ignored").unwrap();

        assert_eq!(calculate_backup_size(app_dir), 8);
    }

    #[test]
    fn clear_sync_backups_removes_only_backups() {
        let temp_dir = TempDir::new().unwrap();
        let app_dir = temp_dir.path();
        let sync_dir = sync_dir(app_dir);
        fs::create_dir_all(&sync_dir).unwrap();

        fs::write(sync_dir.join("pre_sync_backup_1.zip"), "abc").unwrap();
        fs::write(sync_dir.join("pre_sync_backup_2.zip"), "defgh").unwrap();
        fs::write(sync_dir.join("other.txt"), "stay").unwrap();

        clear_sync_backups(app_dir).unwrap();

        assert!(sync_dir.join("other.txt").exists());
        assert!(!sync_dir.join("pre_sync_backup_1.zip").exists());
        assert!(!sync_dir.join("pre_sync_backup_2.zip").exists());
    }
}
