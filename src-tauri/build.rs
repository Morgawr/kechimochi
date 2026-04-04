use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const DESKTOP_CLIENT_ID_ENV: &str = "KECHIMOCHI_GOOGLE_CLIENT_ID";
const DESKTOP_CLIENT_SECRET_ENV: &str = "KECHIMOCHI_GOOGLE_CLIENT_SECRET";
const ANDROID_CLIENT_ID_ENV: &str = "KECHIMOCHI_GOOGLE_ANDROID_CLIENT_ID";
const BUNDLED_CLIENT_ID_ENV: &str = "KECHIMOCHI_BUNDLED_GOOGLE_CLIENT_ID";
const BUNDLED_CLIENT_SECRET_ENV: &str = "KECHIMOCHI_BUNDLED_GOOGLE_CLIENT_SECRET";

fn main() {
    let manifest_dir =
        PathBuf::from(env::var("CARGO_MANIFEST_DIR").expect("missing CARGO_MANIFEST_DIR"));
    let workspace_root = manifest_dir
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_else(|| manifest_dir.clone());
    let local_env_paths = [
        workspace_root.join(".env.local"),
        manifest_dir.join(".env.local"),
    ];

    for key in [
        DESKTOP_CLIENT_ID_ENV,
        DESKTOP_CLIENT_SECRET_ENV,
        ANDROID_CLIENT_ID_ENV,
    ] {
        println!("cargo:rerun-if-env-changed={key}");
    }
    for path in &local_env_paths {
        println!("cargo:rerun-if-changed={}", path.display());
    }

    let source_client_id_env = if env::var("CARGO_CFG_TARGET_OS").ok().as_deref() == Some("android") {
        ANDROID_CLIENT_ID_ENV
    } else {
        DESKTOP_CLIENT_ID_ENV
    };

    for (source_key, bundled_key) in [(source_client_id_env, BUNDLED_CLIENT_ID_ENV)] {
        if let Some(value) = resolve_env_value(&local_env_paths, source_key) {
            println!("cargo:rustc-env={bundled_key}={value}");
        }
    }

    if source_client_id_env != ANDROID_CLIENT_ID_ENV {
        if let Some(value) = resolve_env_value(&local_env_paths, DESKTOP_CLIENT_SECRET_ENV) {
        println!("cargo:rustc-env={BUNDLED_CLIENT_SECRET_ENV}={value}");
        }
    }

    tauri_build::build()
}

fn resolve_env_value(local_env_paths: &[PathBuf], key: &str) -> Option<String> {
    env::var(key)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| local_env_paths.iter().find_map(|path| read_env_value(path, key)))
}

fn read_env_value(path: &Path, key: &str) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let candidate = trimmed.strip_prefix("export ").unwrap_or(trimmed);
        let (candidate_key, candidate_value) = candidate.split_once('=')?;
        if candidate_key.trim() != key {
            continue;
        }

        let value = candidate_value.trim();
        if value.is_empty() {
            return None;
        }

        return Some(unquote_env_value(value));
    }

    None
}

fn unquote_env_value(value: &str) -> String {
    if value.len() >= 2 {
        let first = value.as_bytes()[0];
        let last = value.as_bytes()[value.len() - 1];
        if (first == b'"' && last == b'"') || (first == b'\'' && last == b'\'') {
            return value[1..value.len() - 1].to_string();
        }
    }

    value.to_string()
}
