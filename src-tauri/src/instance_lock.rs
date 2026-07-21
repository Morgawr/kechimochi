use chrono::Utc;
use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};

pub const INSTANCE_LOCK_FILE: &str = ".kechimochi.instance.lock";
pub const INSTANCE_OWNER_FILE: &str = ".kechimochi.instance.owner";
const MAX_OWNER_RECORD_BYTES: u64 = 8 * 1024;

#[cfg(debug_assertions)]
const E2E_FORCE_CONTENTION_ENV: &str = "KECHIMOCHI_E2E_FORCE_INSTANCE_LOCK_CONTENTION";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstanceKind {
    Desktop,
    Web,
}

impl fmt::Display for InstanceKind {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Desktop => formatter.write_str("desktop"),
            Self::Web => formatter.write_str("web"),
        }
    }
}

#[derive(Debug)]
pub struct InstanceLockGuard {
    // The OS releases the lock when this handle is closed, including after a
    // crash. The lock file itself intentionally remains on disk so a locked
    // inode cannot be unlinked and replaced by an independently lockable file.
    _file: File,
    owner_path: PathBuf,
}

impl Drop for InstanceLockGuard {
    fn drop(&mut self) {
        // The owner record is separate from the locked file because Windows'
        // LockFileEx prevents other processes from reading locked byte ranges.
        // It is diagnostic only, so a failed cleanup must not affect unlocking.
        let _ = fs::remove_file(&self.owner_path);
    }
}

#[derive(Debug)]
pub struct InstanceLockError {
    message: String,
}

impl fmt::Display for InstanceLockError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for InstanceLockError {}

pub fn instance_lock_path(data_dir: &Path) -> PathBuf {
    data_dir.join(INSTANCE_LOCK_FILE)
}

pub fn instance_owner_path(data_dir: &Path) -> PathBuf {
    data_dir.join(INSTANCE_OWNER_FILE)
}

fn owner_record(kind: InstanceKind) -> String {
    format!(
        "version=1\npid={}\nkind={}\napp_version={}\nstarted_at={}\n",
        std::process::id(),
        kind,
        env!("CARGO_PKG_VERSION"),
        Utc::now().to_rfc3339(),
    )
}

fn write_owner_record(path: &Path, contents: &str) -> io::Result<()> {
    let mut file = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(path)?;
    file.write_all(contents.as_bytes())?;
    file.sync_all()
}

fn read_owner_record(path: &Path) -> io::Result<String> {
    let mut bytes = Vec::new();
    File::open(path)?
        .take(MAX_OWNER_RECORD_BYTES)
        .read_to_end(&mut bytes)?;
    Ok(String::from_utf8_lossy(&bytes).trim().to_string())
}

fn owner_pid(owner: &str) -> Option<&str> {
    owner
        .lines()
        .find_map(|line| line.trim().strip_prefix("pid="))
        .filter(|pid| !pid.is_empty() && pid.chars().all(|character| character.is_ascii_digit()))
}

fn contention_error(lock_path: &Path, owner_path: &Path) -> InstanceLockError {
    let owner = read_owner_record(owner_path)
        .ok()
        .filter(|text| !text.is_empty());
    let pid_suffix = owner
        .as_deref()
        .and_then(owner_pid)
        .map(|pid| format!(" (pid={pid})"))
        .unwrap_or_default();
    let owner_details = owner.unwrap_or_else(|| "Owner information unavailable".to_string());

    InstanceLockError {
        message: format!(
            "Unable to obtain unique lock. Some other process is already running Kechimochi{pid_suffix}.\n\nLock file: {}\n\nLock owner details:\n{owner_details}",
            lock_path.display(),
        ),
    }
}

fn io_error(lock_path: &Path, operation: &str, error: io::Error) -> InstanceLockError {
    InstanceLockError {
        message: format!(
            "Unable to obtain unique lock for {} while {operation}: {error}",
            lock_path.display(),
        ),
    }
}

pub fn acquire_instance_lock(
    data_dir: &Path,
    kind: InstanceKind,
) -> Result<InstanceLockGuard, InstanceLockError> {
    fs::create_dir_all(data_dir)
        .map_err(|error| io_error(data_dir, "creating the data directory", error))?;

    let lock_path = instance_lock_path(data_dir);
    let owner_path = instance_owner_path(data_dir);

    // The real OS-lock behavior is covered by unit tests. This debug-only seam
    // lets desktop and web E2E verify their startup warning without relying on
    // a platform-specific lock-holder helper process.
    #[cfg(debug_assertions)]
    if std::env::var_os(E2E_FORCE_CONTENTION_ENV).is_some() {
        return Err(contention_error(&lock_path, &owner_path));
    }

    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(&lock_path)
        .map_err(|error| io_error(&lock_path, "opening the lock file", error))?;

    match file.try_lock() {
        Ok(()) => {}
        Err(std::fs::TryLockError::WouldBlock) => {
            return Err(contention_error(&lock_path, &owner_path));
        }
        Err(std::fs::TryLockError::Error(error)) => {
            return Err(io_error(&lock_path, "locking the lock file", error));
        }
    }

    let record = owner_record(kind);
    if let Err(error) = write_owner_record(&owner_path, &record) {
        let _ = fs::remove_file(&owner_path);
        return Err(io_error(&lock_path, "writing lock owner details", error));
    }

    Ok(InstanceLockGuard {
        _file: file,
        owner_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn exclusive_lock_reports_the_current_owner_and_recovers_after_drop() {
        let data_dir = TempDir::new().unwrap();
        let first = acquire_instance_lock(data_dir.path(), InstanceKind::Desktop).unwrap();

        let owner = fs::read_to_string(instance_owner_path(data_dir.path())).unwrap();
        assert!(owner.contains(&format!("pid={}", std::process::id())));
        assert!(owner.contains("kind=desktop"));

        let error = acquire_instance_lock(data_dir.path(), InstanceKind::Web)
            .unwrap_err()
            .to_string();
        assert!(error.contains(&format!(
            "Some other process is already running Kechimochi (pid={})",
            std::process::id()
        )));
        assert!(error.contains("kind=desktop"));

        drop(first);
        assert!(!instance_owner_path(data_dir.path()).exists());
        assert!(instance_lock_path(data_dir.path()).exists());

        let second = acquire_instance_lock(data_dir.path(), InstanceKind::Web).unwrap();
        let owner = fs::read_to_string(instance_owner_path(data_dir.path())).unwrap();
        assert!(owner.contains("kind=web"));
        drop(second);
    }

    #[test]
    fn malformed_owner_pid_is_not_interpolated_into_the_summary() {
        let data_dir = TempDir::new().unwrap();
        fs::write(
            instance_owner_path(data_dir.path()),
            "pid=<script>\nkind=unknown\n",
        )
        .unwrap();

        let error = contention_error(
            &instance_lock_path(data_dir.path()),
            &instance_owner_path(data_dir.path()),
        )
        .to_string();

        assert!(!error.contains("running Kechimochi (pid="));
        assert!(error.contains("pid=<script>"));
    }
}
