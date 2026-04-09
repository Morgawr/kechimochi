use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};

use image::ImageFormat;
use rusqlite::Connection;
use sha2::{Digest, Sha256};

use crate::db;
use crate::sync_snapshot::{self, SyncSnapshot};

pub trait CoverBlobStore {
    fn blob_exists(&self, sha256: &str) -> Result<bool, String>;
    fn upload_blob(&mut self, sha256: &str, bytes: &[u8]) -> Result<(), String>;
    fn download_blob(&self, sha256: &str) -> Result<Option<Vec<u8>>, String>;
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CoverBlobUploadOutcome {
    pub uploaded_hashes: Vec<String>,
    pub reused_hashes: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CoverBlobMaterializationOutcome {
    pub downloaded_hashes: Vec<String>,
    pub reused_local_hashes: Vec<String>,
    pub updated_media_uids: Vec<String>,
}

pub fn upload_missing_cover_blobs(
    conn: &Connection,
    snapshot: &SyncSnapshot,
    store: &mut impl CoverBlobStore,
) -> Result<CoverBlobUploadOutcome, String> {
    let local_blobs = build_local_cover_hash_cache(conn)?;
    let mut uploaded_hashes = Vec::new();
    let mut reused_hashes = Vec::new();

    for hash in required_cover_hashes(snapshot) {
        let path = local_blobs
            .get(&hash)
            .ok_or_else(|| format!("Local cover blob '{hash}' is missing"))?;
        let bytes = fs::read(path)
            .map_err(|e| format!("Failed to read local cover blob '{hash}' from '{path}': {e}"))?;
        validate_cover_blob_bytes(&hash, &bytes)?;

        if store.blob_exists(&hash)? {
            reused_hashes.push(hash);
        } else {
            store.upload_blob(&hash, &bytes)?;
            uploaded_hashes.push(hash);
        }
    }

    Ok(CoverBlobUploadOutcome {
        uploaded_hashes,
        reused_hashes,
    })
}

pub fn materialize_snapshot_cover_blobs(
    conn: &Connection,
    covers_dir: &Path,
    snapshot: &SyncSnapshot,
    store: &impl CoverBlobStore,
) -> Result<CoverBlobMaterializationOutcome, String> {
    let media_by_uid = db::get_all_media(conn)
        .map_err(|e| e.to_string())?
        .into_iter()
        .filter_map(|media| media.uid.clone().map(|uid| (uid, media)))
        .collect::<BTreeMap<_, _>>();
    let mut local_blobs = build_local_cover_hash_cache(conn)?;
    let mut downloaded_hashes = BTreeSet::new();
    let mut reused_local_hashes = BTreeSet::new();
    let mut updated_media_uids = BTreeSet::new();

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

        let target_path = if let Some(existing_path) = local_blobs.get(expected_hash) {
            reused_local_hashes.insert(expected_hash.clone());
            existing_path.clone()
        } else {
            let bytes = store
                .download_blob(expected_hash)?
                .ok_or_else(|| format!("Missing cover blob '{expected_hash}' on remote store"))?;
            validate_cover_blob_bytes(expected_hash, &bytes)?;

            let materialized_path = materialize_cover_blob(covers_dir, expected_hash, &bytes)?;
            let materialized_path = materialized_path.to_string_lossy().to_string();
            local_blobs.insert(expected_hash.clone(), materialized_path.clone());
            downloaded_hashes.insert(expected_hash.clone());
            materialized_path
        };

        if media.cover_image != target_path {
            db::update_media_cover_image_by_uid(conn, uid, &target_path)?;
            updated_media_uids.insert(uid.clone());
        }
    }

    Ok(CoverBlobMaterializationOutcome {
        downloaded_hashes: downloaded_hashes.into_iter().collect(),
        reused_local_hashes: reused_local_hashes.into_iter().collect(),
        updated_media_uids: updated_media_uids.into_iter().collect(),
    })
}

pub fn apply_snapshot_and_materialize_cover_blobs(
    conn: &Connection,
    covers_dir: &Path,
    snapshot: &SyncSnapshot,
    store: &impl CoverBlobStore,
) -> Result<CoverBlobMaterializationOutcome, String> {
    sync_snapshot::apply_snapshot(conn, snapshot)?;
    materialize_snapshot_cover_blobs(conn, covers_dir, snapshot, store)
}

fn required_cover_hashes(snapshot: &SyncSnapshot) -> BTreeSet<String> {
    snapshot
        .library
        .values()
        .filter_map(|aggregate| aggregate.cover_blob_sha256.clone())
        .collect()
}

fn build_local_cover_hash_cache(conn: &Connection) -> Result<BTreeMap<String, String>, String> {
    let mut cache = BTreeMap::new();
    for media in db::get_all_media(conn).map_err(|e| e.to_string())? {
        let path = Path::new(&media.cover_image);
        let Some(hash) = sync_snapshot::compute_cover_blob_sha256_from_path(path)? else {
            continue;
        };
        cache.entry(hash).or_insert(media.cover_image);
    }
    Ok(cache)
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

    let extension = extension_for_cover_blob(bytes);
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

fn extension_for_cover_blob(bytes: &[u8]) -> &'static str {
    match image::guess_format(bytes) {
        Ok(ImageFormat::Png) => "png",
        Ok(ImageFormat::Jpeg) => "jpg",
        Ok(ImageFormat::WebP) => "webp",
        _ => "img",
    }
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
    use crate::models::Media;
    use crate::sync_snapshot::{build_snapshot, SnapshotBuildOptions};
    use image::{DynamicImage, ImageBuffer, ImageFormat, Rgb};
    use rusqlite::Connection;
    use std::cell::RefCell;
    use std::io::Cursor;
    use tempfile::TempDir;

    #[derive(Default)]
    struct MemoryBlobStore {
        blobs: BTreeMap<String, Vec<u8>>,
        uploaded_hashes: Vec<String>,
        downloaded_hashes: RefCell<Vec<String>>,
    }

    impl CoverBlobStore for MemoryBlobStore {
        fn blob_exists(&self, sha256: &str) -> Result<bool, String> {
            Ok(self.blobs.contains_key(sha256))
        }

        fn upload_blob(&mut self, sha256: &str, bytes: &[u8]) -> Result<(), String> {
            self.uploaded_hashes.push(sha256.to_string());
            self.blobs.insert(sha256.to_string(), bytes.to_vec());
            Ok(())
        }

        fn download_blob(&self, sha256: &str) -> Result<Option<Vec<u8>>, String> {
            self.downloaded_hashes.borrow_mut().push(sha256.to_string());
            Ok(self.blobs.get(sha256).cloned())
        }
    }

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", [])
            .unwrap();
        db::create_tables(&conn).unwrap();
        conn
    }

    fn encode_png_bytes() -> Vec<u8> {
        let image = DynamicImage::ImageRgb8(ImageBuffer::from_pixel(8, 8, Rgb([255, 0, 0])));
        let mut cursor = Cursor::new(Vec::new());
        image.write_to(&mut cursor, ImageFormat::Png).unwrap();
        cursor.into_inner()
    }

    fn insert_media_with_cover(
        conn: &Connection,
        uid: &str,
        title: &str,
        cover_path: &Path,
    ) -> i64 {
        db::add_media_with_id(
            conn,
            &Media {
                id: None,
                uid: Some(uid.to_string()),
                title: title.to_string(),
                media_type: "Reading".to_string(),
                status: "Active".to_string(),
                language: "Japanese".to_string(),
                description: String::new(),
                cover_image: cover_path.to_string_lossy().to_string(),
                extra_data: "{}".to_string(),
                content_type: "Novel".to_string(),
                tracking_status: "Ongoing".to_string(),
            },
        )
        .unwrap()
    }

    fn build_test_snapshot(conn: &Connection) -> SyncSnapshot {
        build_snapshot(
            conn,
            SnapshotBuildOptions {
                app_dir: None,
                snapshot_id: "snap_1",
                created_at: "2026-04-02T00:00:00Z",
                created_by_device_id: "dev_local",
                profile_id: "prof_1",
                base_snapshot: None,
                tombstones: &[],
            },
        )
        .unwrap()
    }

    #[test]
    fn test_upload_missing_cover_blob_deduplicates_shared_hashes() {
        let conn = setup_test_db();
        let temp_dir = TempDir::new().unwrap();
        let cover_bytes = encode_png_bytes();
        let cover_one = temp_dir.path().join("cover_one.png");
        let cover_two = temp_dir.path().join("cover_two.png");
        fs::write(&cover_one, &cover_bytes).unwrap();
        fs::write(&cover_two, &cover_bytes).unwrap();

        insert_media_with_cover(&conn, "uid-1", "One", &cover_one);
        insert_media_with_cover(&conn, "uid-2", "Two", &cover_two);

        let snapshot = build_test_snapshot(&conn);
        let expected_hash = snapshot.library["uid-1"].cover_blob_sha256.clone().unwrap();
        assert_eq!(
            snapshot.library["uid-2"].cover_blob_sha256.as_deref(),
            Some(expected_hash.as_str())
        );

        let mut store = MemoryBlobStore::default();
        let outcome = upload_missing_cover_blobs(&conn, &snapshot, &mut store).unwrap();

        assert_eq!(outcome.uploaded_hashes, vec![expected_hash.clone()]);
        assert!(outcome.reused_hashes.is_empty());
        assert_eq!(store.uploaded_hashes, vec![expected_hash.clone()]);
        assert_eq!(store.blobs[&expected_hash], cover_bytes);
    }

    #[test]
    fn test_upload_reuses_existing_cover_blob() {
        let conn = setup_test_db();
        let temp_dir = TempDir::new().unwrap();
        let cover_bytes = encode_png_bytes();
        let cover_path = temp_dir.path().join("cover.png");
        fs::write(&cover_path, &cover_bytes).unwrap();

        insert_media_with_cover(&conn, "uid-1", "One", &cover_path);

        let snapshot = build_test_snapshot(&conn);
        let expected_hash = snapshot.library["uid-1"].cover_blob_sha256.clone().unwrap();

        let mut store = MemoryBlobStore::default();
        store
            .blobs
            .insert(expected_hash.clone(), cover_bytes.clone());

        let outcome = upload_missing_cover_blobs(&conn, &snapshot, &mut store).unwrap();

        assert!(outcome.uploaded_hashes.is_empty());
        assert_eq!(outcome.reused_hashes, vec![expected_hash]);
        assert!(store.uploaded_hashes.is_empty());
    }

    #[test]
    fn test_materialize_missing_local_blob_downloads_and_updates_cover_path() {
        let source_conn = setup_test_db();
        let source_dir = TempDir::new().unwrap();
        let cover_bytes = encode_png_bytes();
        let source_cover = source_dir.path().join("source.png");
        fs::write(&source_cover, &cover_bytes).unwrap();
        insert_media_with_cover(&source_conn, "uid-1", "One", &source_cover);

        let snapshot = build_test_snapshot(&source_conn);
        let expected_hash = snapshot.library["uid-1"].cover_blob_sha256.clone().unwrap();

        let mut store = MemoryBlobStore::default();
        store
            .blobs
            .insert(expected_hash.clone(), cover_bytes.clone());

        let dest_conn = setup_test_db();
        let dest_dir = TempDir::new().unwrap();
        sync_snapshot::apply_snapshot(&dest_conn, &snapshot).unwrap();

        let outcome =
            materialize_snapshot_cover_blobs(&dest_conn, dest_dir.path(), &snapshot, &store)
                .unwrap();

        let media = db::get_all_media(&dest_conn).unwrap().remove(0);
        assert_eq!(outcome.downloaded_hashes, vec![expected_hash.clone()]);
        assert!(outcome.reused_local_hashes.is_empty());
        assert_eq!(outcome.updated_media_uids, vec!["uid-1".to_string()]);
        assert!(media
            .cover_image
            .starts_with(dest_dir.path().to_string_lossy().as_ref()));
        assert_eq!(
            sync_snapshot::compute_cover_blob_sha256_from_path(Path::new(&media.cover_image))
                .unwrap()
                .as_deref(),
            Some(expected_hash.as_str())
        );
        assert_eq!(
            store.downloaded_hashes.borrow().as_slice(),
            &[expected_hash]
        );
    }

    #[test]
    fn test_materialize_download_replaces_mismatched_local_cover_path() {
        let source_conn = setup_test_db();
        let source_dir = TempDir::new().unwrap();
        let cover_bytes = encode_png_bytes();
        let source_cover = source_dir.path().join("source.png");
        fs::write(&source_cover, &cover_bytes).unwrap();
        insert_media_with_cover(&source_conn, "uid-1", "One", &source_cover);

        let snapshot = build_test_snapshot(&source_conn);
        let expected_hash = snapshot.library["uid-1"].cover_blob_sha256.clone().unwrap();

        let dest_conn = setup_test_db();
        let dest_dir = TempDir::new().unwrap();
        sync_snapshot::apply_snapshot(&dest_conn, &snapshot).unwrap();

        let wrong_cover = dest_dir.path().join("wrong.png");
        fs::write(&wrong_cover, b"wrong-cover").unwrap();
        db::update_media_cover_image_by_uid(
            &dest_conn,
            "uid-1",
            wrong_cover.to_string_lossy().as_ref(),
        )
        .unwrap();

        let mut store = MemoryBlobStore::default();
        store.blobs.insert(expected_hash, cover_bytes);

        materialize_snapshot_cover_blobs(&dest_conn, dest_dir.path(), &snapshot, &store).unwrap();

        let media = db::get_all_media(&dest_conn).unwrap().remove(0);
        assert!(media.cover_image.contains("sync_blob_"));
        assert!(!wrong_cover.exists());
    }

    #[test]
    fn test_materialize_corrupted_blob_returns_error() {
        let source_conn = setup_test_db();
        let source_dir = TempDir::new().unwrap();
        let cover_bytes = encode_png_bytes();
        let source_cover = source_dir.path().join("source.png");
        fs::write(&source_cover, &cover_bytes).unwrap();
        insert_media_with_cover(&source_conn, "uid-1", "One", &source_cover);

        let snapshot = build_test_snapshot(&source_conn);
        let expected_hash = snapshot.library["uid-1"].cover_blob_sha256.clone().unwrap();

        let dest_conn = setup_test_db();
        let dest_dir = TempDir::new().unwrap();
        sync_snapshot::apply_snapshot(&dest_conn, &snapshot).unwrap();

        let mut store = MemoryBlobStore::default();
        store
            .blobs
            .insert(expected_hash.clone(), b"corrupted".to_vec());

        let err = materialize_snapshot_cover_blobs(&dest_conn, dest_dir.path(), &snapshot, &store)
            .unwrap_err();

        assert!(err.contains("corrupted"));
        let media = db::get_all_media(&dest_conn).unwrap().remove(0);
        assert!(media.cover_image.is_empty());
    }
}
