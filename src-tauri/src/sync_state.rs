use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use uuid::Uuid;

const SYNC_DIR_NAME: &str = "sync";
const SYNC_CONFIG_FILE: &str = "sync_config.json";
const SYNC_DEVICE_ID_FILE: &str = "sync_device_id.txt";
const BASE_SNAPSHOT_FILE: &str = "base_snapshot.json.gz";
const PENDING_CONFLICTS_FILE: &str = "pending_conflicts.json";

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
    pub conflict_count: usize,
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
    let conflict_count = load_pending_conflict_count(app_dir)?;

    if let Some(config) = config {
        return Ok(SyncStatus {
            state: map_lifecycle_status(config.last_sync_status),
            google_authenticated,
            sync_profile_id: Some(config.sync_profile_id),
            profile_name: Some(config.profile_name),
            google_account_email: config.google_account_email.or(google_account_email),
            last_sync_at: config.last_sync_at,
            conflict_count,
        });
    }

    Ok(SyncStatus {
        state: SyncConnectionState::Disconnected,
        google_authenticated,
        sync_profile_id: None,
        profile_name: None,
        google_account_email,
        last_sync_at: None,
        conflict_count,
    })
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

fn load_pending_conflict_count(app_dir: &Path) -> Result<usize, String> {
    let path = pending_conflicts_path(app_dir);
    if !path.exists() {
        return Ok(0);
    }

    let raw = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let value = serde_json::from_str::<serde_json::Value>(&raw).map_err(|e| e.to_string())?;
    Ok(value.as_array().map(|items| items.len()).unwrap_or(0))
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
}
