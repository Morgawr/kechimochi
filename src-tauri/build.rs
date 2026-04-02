use std::env;
use std::fs;
use std::path::{Path, PathBuf};

const CLIENT_ID_ENV: &str = "KECHIMOCHI_GOOGLE_CLIENT_ID";
const CLIENT_SECRET_ENV: &str = "KECHIMOCHI_GOOGLE_CLIENT_SECRET";
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

    println!("cargo:rerun-if-env-changed={CLIENT_ID_ENV}");
    println!("cargo:rerun-if-env-changed={CLIENT_SECRET_ENV}");
    for path in &local_env_paths {
        println!("cargo:rerun-if-changed={}", path.display());
    }

    for (source_key, bundled_key) in [
        (CLIENT_ID_ENV, BUNDLED_CLIENT_ID_ENV),
        (CLIENT_SECRET_ENV, BUNDLED_CLIENT_SECRET_ENV),
    ] {
        if let Some(value) = env::var(source_key)
            .ok()
            .filter(|value| !value.trim().is_empty())
            .or_else(|| {
                local_env_paths
                    .iter()
                    .find_map(|path| read_env_value(path, source_key))
            })
        {
            println!("cargo:rustc-env={bundled_key}={value}");
        }
    }

    tauri_build::build()
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
