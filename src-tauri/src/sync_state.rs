use std::fs;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::sync_merge::SyncConflict;
use crate::sync_snapshot::{self, SyncSnapshot};

const SYNC_DIR_NAME: &str = "sync";
const SYNC_CONFIG_FILE: &str = "sync_config.json";
const SYNC_DEVICE_ID_FILE: &str = "sync_device_id.txt";
const BASE_SNAPSHOT_FILE: &str = "base_snapshot.json.gz";
const PENDING_CONFLICTS_FILE: &str = "pending_conflicts.json";
const SYNC_LOCK_FILE: &str = "sync.lock";
const SYNC_LOCK_STALE_SECS: u64 = 180;

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

pub fn sync_lock_path(app_dir: &Path) -> PathBuf {
    sync_dir(app_dir).join(SYNC_LOCK_FILE)
}

pub fn ensure_sync_dir(app_dir: &Path) -> Result<PathBuf, String> {
    let dir = sync_dir(app_dir);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

pub fn get_or_create_device_id(app_dir: &Path) -> Result<String, String> {
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
    fs::write(&path, format!("{device_id}\n")).map_err(|e| e.to_string())?;
    Ok(device_id)
}

pub fn load_sync_config(app_dir: &Path) -> Result<Option<SyncConfig>, String> {
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
    ensure_sync_dir(app_dir)?;
    let raw = serde_json::to_string_pretty(config).map_err(|e| e.to_string())?;
    fs::write(sync_config_path(app_dir), raw).map_err(|e| e.to_string())
}

pub fn update_sync_config<F>(app_dir: &Path, update: F) -> Result<Option<SyncConfig>, String>
where
    F: FnOnce(&mut SyncConfig),
{
    let Some(mut config) = load_sync_config(app_dir)? else {
        return Ok(None);
    };

    update(&mut config);
    save_sync_config(app_dir, &config)?;
    Ok(Some(config))
}

pub fn save_base_snapshot(app_dir: &Path, snapshot: &SyncSnapshot) -> Result<(), String> {
    ensure_sync_dir(app_dir)?;
    let canonical_json = sync_snapshot::snapshot_to_canonical_json(snapshot)?;
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(canonical_json.as_bytes())
        .map_err(|e| e.to_string())?;
    let gzipped_bytes = encoder.finish().map_err(|e| e.to_string())?;
    fs::write(base_snapshot_path(app_dir), gzipped_bytes).map_err(|e| e.to_string())
}

pub fn load_base_snapshot(app_dir: &Path) -> Result<Option<SyncSnapshot>, String> {
    let path = base_snapshot_path(app_dir);
    if !path.exists() {
        return Ok(None);
    }

    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let mut decoder = GzDecoder::new(bytes.as_slice());
    let mut json = String::new();
    decoder
        .read_to_string(&mut json)
        .map_err(|e| e.to_string())?;
    sync_snapshot::parse_snapshot_json(&json).map(Some)
}

pub fn save_pending_conflicts(app_dir: &Path, conflicts: &[SyncConflict]) -> Result<(), String> {
    ensure_sync_dir(app_dir)?;
    let raw = serde_json::to_string_pretty(conflicts).map_err(|e| e.to_string())?;
    fs::write(pending_conflicts_path(app_dir), raw).map_err(|e| e.to_string())
}

pub fn load_pending_conflicts(app_dir: &Path) -> Result<Vec<SyncConflict>, String> {
    let path = pending_conflicts_path(app_dir);
    if !path.exists() {
        return Ok(Vec::new());
    }

    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| e.to_string())
}

pub fn clear_pending_conflicts(app_dir: &Path) -> Result<(), String> {
    let path = pending_conflicts_path(app_dir);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn pending_conflict_count(app_dir: &Path) -> Result<usize, String> {
    Ok(load_pending_conflicts(app_dir)?.len())
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
    path: PathBuf,
}

impl Drop for SyncLockGuard {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

pub fn acquire_sync_lock(app_dir: &Path) -> Result<SyncLockGuard, String> {
    ensure_sync_dir(app_dir)?;
    let path = sync_lock_path(app_dir);
    loop {
        match OpenOptions::new().create_new(true).write(true).open(&path) {
            Ok(mut file) => {
                file.write_all(sync_lock_contents()?.as_bytes())
                    .map_err(|e| e.to_string())?;
                return Ok(SyncLockGuard { path });
            }
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => {
                if reclaim_stale_sync_lock(&path)? {
                    continue;
                }
                return Err("Another sync operation is already in progress".to_string());
            }
            Err(err) => return Err(err.to_string()),
        }
    }
}

fn sync_lock_contents() -> Result<String, String> {
    Ok(format!(
        "pid={}\ncreated_at_unix={}\n",
        std::process::id(),
        current_unix_timestamp_secs()?
    ))
}

fn reclaim_stale_sync_lock(path: &Path) -> Result<bool, String> {
    let Ok(raw) = fs::read_to_string(path) else {
        return Ok(true);
    };

    let Some(created_at_unix) = parse_sync_lock_created_at_unix(&raw) else {
        fs::remove_file(path).map_err(|e| e.to_string())?;
        return Ok(true);
    };

    let now = current_unix_timestamp_secs()?;
    if now.saturating_sub(created_at_unix) < SYNC_LOCK_STALE_SECS {
        return Ok(false);
    }

    fs::remove_file(path).map_err(|e| e.to_string())?;
    Ok(true)
}

fn parse_sync_lock_created_at_unix(raw: &str) -> Option<u64> {
    raw.lines()
        .find_map(|line| line.strip_prefix("created_at_unix="))
        .and_then(|value| value.trim().parse::<u64>().ok())
}

fn current_unix_timestamp_secs() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .map_err(|e| e.to_string())
}

pub fn clear_sync_runtime_files(app_dir: &Path) -> Result<(), String> {
    for path in [
        sync_config_path(app_dir),
        base_snapshot_path(app_dir),
        pending_conflicts_path(app_dir),
    ] {
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
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
    let config = load_sync_config(app_dir)?;
    let conflict_count = pending_conflict_count(app_dir)?;
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
                && e.file_name().to_string_lossy().starts_with("pre_sync_backup_")
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
    use tempfile::TempDir;

    #[test]
    fn device_id_is_stable_once_created() {
        let temp_dir = TempDir::new().unwrap();

        let first = get_or_create_device_id(temp_dir.path()).unwrap();
        let second = get_or_create_device_id(temp_dir.path()).unwrap();

        assert_eq!(first, second);
        assert!(first.starts_with("dev_"));
    }

    #[test]
    fn clear_sync_runtime_files_removes_config_and_pending_conflicts() {
        let temp_dir = TempDir::new().unwrap();
        ensure_sync_dir(temp_dir.path()).unwrap();
        fs::write(sync_config_path(temp_dir.path()), "{}").unwrap();
        fs::write(base_snapshot_path(temp_dir.path()), "snapshot").unwrap();
        fs::write(pending_conflicts_path(temp_dir.path()), "[]").unwrap();
        fs::write(sync_device_id_path(temp_dir.path()), "dev_keep\n").unwrap();

        clear_sync_runtime_files(temp_dir.path()).unwrap();

        assert!(!sync_config_path(temp_dir.path()).exists());
        assert!(!base_snapshot_path(temp_dir.path()).exists());
        assert!(!pending_conflicts_path(temp_dir.path()).exists());
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
            theme_packs: Some(Default::default()),
            profile_picture: None,
            tombstones: Vec::new(),
        };

        save_base_snapshot(temp_dir.path(), &snapshot).unwrap();
        let loaded = load_base_snapshot(temp_dir.path()).unwrap().unwrap();

        assert_eq!(loaded, snapshot);
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
    fn sync_lock_prevents_parallel_syncs() {
        let temp_dir = TempDir::new().unwrap();
        let _guard = acquire_sync_lock(temp_dir.path()).unwrap();
        let err = acquire_sync_lock(temp_dir.path()).unwrap_err();
        assert!(err.contains("already in progress"));
    }

    #[test]
    fn acquire_sync_lock_reclaims_legacy_lock_file_without_timestamp() {
        let temp_dir = TempDir::new().unwrap();
        ensure_sync_dir(temp_dir.path()).unwrap();
        fs::write(sync_lock_path(temp_dir.path()), "pid=123\n").unwrap();

        let _guard = acquire_sync_lock(temp_dir.path()).unwrap();

        assert!(sync_lock_path(temp_dir.path()).exists());
    }

    #[test]
    fn acquire_sync_lock_reclaims_stale_lock_file() {
        let temp_dir = TempDir::new().unwrap();
        ensure_sync_dir(temp_dir.path()).unwrap();
        let stale_created_at = current_unix_timestamp_secs().unwrap() - (SYNC_LOCK_STALE_SECS + 1);
        fs::write(
            sync_lock_path(temp_dir.path()),
            format!("pid=123\ncreated_at_unix={stale_created_at}\n"),
        )
        .unwrap();

        let _guard = acquire_sync_lock(temp_dir.path()).unwrap();
        assert!(sync_lock_path(temp_dir.path()).exists());
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
