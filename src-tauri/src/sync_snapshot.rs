use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use rayon::prelude::*;
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write as _;
use std::path::Path;
use std::sync::atomic::{AtomicUsize, Ordering};

use crate::db;
use crate::models::{ActivityLog, Media, Milestone, ProfilePicture};

pub const SYNC_PROTOCOL_VERSION: i64 = 1;

const PROFILE_NAME_SETTING_KEY: &str = "profile_name";
const DEFAULT_PROFILE_NAME: &str = "default";
const SNAPSHOT_PROGRESS_BATCH_SIZE: usize = 5;
const SYNCABLE_SETTING_KEYS: &[&str] = &[
    "theme",
    "profile_name",
    "grid_hide_archived",
    "library_layout_mode",
    "dashboard_chart_type",
    "dashboard_group_by",
];
#[derive(Debug, Clone)]
pub struct SnapshotBuildOptions<'a> {
    pub app_dir: Option<&'a Path>,
    pub snapshot_id: &'a str,
    pub created_at: &'a str,
    pub created_by_device_id: &'a str,
    pub profile_id: &'a str,
    pub base_snapshot: Option<&'a SyncSnapshot>,
    pub tombstones: &'a [SnapshotTombstone],
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SyncSnapshot {
    pub sync_protocol_version: i64,
    pub db_schema_version: i64,
    pub snapshot_id: String,
    pub created_at: String,
    pub created_by_device_id: String,
    pub profile: SnapshotProfile,
    pub library: BTreeMap<String, SnapshotMediaAggregate>,
    pub settings: BTreeMap<String, SnapshotSettingValue>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub theme_packs: Option<BTreeMap<String, SnapshotThemePack>>,
    pub profile_picture: Option<SnapshotProfilePicture>,
    pub tombstones: Vec<SnapshotTombstone>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SnapshotThemePack {
    pub content: String,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub assets: BTreeMap<String, String>,
    pub updated_at: String,
    pub updated_by_device_id: String,
}

#[derive(Debug, Clone)]
struct SyncableThemePack {
    content: String,
    assets: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SnapshotProfile {
    pub profile_id: String,
    pub profile_name: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SnapshotMediaAggregate {
    pub uid: String,
    pub title: String,
    pub media_type: String,
    pub status: String,
    pub language: String,
    pub description: String,
    pub content_type: String,
    pub tracking_status: String,
    pub extra_data: String,
    pub cover_blob_sha256: Option<String>,
    pub updated_at: String,
    pub updated_by_device_id: String,
    pub activities: Vec<SnapshotActivity>,
    pub milestones: Vec<SnapshotMilestone>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct SnapshotActivity {
    pub date: String,
    pub activity_type: String,
    pub duration_minutes: i64,
    pub characters: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct SnapshotMilestone {
    pub name: String,
    pub duration: i64,
    pub characters: i64,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SnapshotSettingValue {
    pub value: String,
    pub updated_at: String,
    pub updated_by_device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SnapshotProfilePicture {
    pub mime_type: String,
    pub base64_data: String,
    pub byte_size: i64,
    pub width: i64,
    pub height: i64,
    pub updated_at: String,
    pub updated_by_device_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
pub struct SnapshotTombstone {
    pub media_uid: String,
    pub deleted_at: String,
    pub deleted_by_device_id: String,
}

#[derive(Debug, Clone)]
struct SettingRow {
    key: String,
    value: String,
    updated_at: String,
}

#[derive(Debug, Deserialize)]
struct ThemePackIdentity {
    id: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SnapshotBuildProgress {
    pub processed_media: usize,
    pub total_media: usize,
}

pub fn build_snapshot(
    conn: &Connection,
    options: SnapshotBuildOptions<'_>,
) -> Result<SyncSnapshot, String> {
    build_snapshot_with_progress(conn, options, |_| {})
}

pub fn build_snapshot_with_progress<P>(
    conn: &Connection,
    options: SnapshotBuildOptions<'_>,
    progress: P,
) -> Result<SyncSnapshot, String>
where
    P: Fn(SnapshotBuildProgress) + Send + Sync,
{
    let media_list = db::get_all_media(conn).map_err(|e| e.to_string())?;
    let all_logs = db::get_logs(conn).map_err(|e| e.to_string())?;
    let all_milestones = db::get_all_milestones(conn).map_err(|e| e.to_string())?;
    let profile_picture = db::get_profile_picture(conn).map_err(|e| e.to_string())?;
    let syncable_settings = load_syncable_settings(conn)?;

    let total_media = media_list.len();
    let managed_theme_packs = load_syncable_theme_packs(options.app_dir)?;
    if total_media > 0 {
        progress(SnapshotBuildProgress {
            processed_media: 0,
            total_media,
        });
    }

    let processed_media = AtomicUsize::new(0);
    let media_rows = media_list
        .into_par_iter()
        .map(|media| {
            let cover_blob_sha256 =
                compute_cover_blob_sha256_from_path(Path::new(&media.cover_image))?;
            let current = processed_media.fetch_add(1, Ordering::Relaxed) + 1;
            if total_media <= SNAPSHOT_PROGRESS_BATCH_SIZE
                || current == total_media
                || current.is_multiple_of(SNAPSHOT_PROGRESS_BATCH_SIZE)
            {
                progress(SnapshotBuildProgress {
                    processed_media: current,
                    total_media,
                });
            }
            Ok::<_, String>((media, cover_blob_sha256))
        })
        .collect::<Vec<_>>();

    let mut library = BTreeMap::new();
    let mut media_uid_by_id = HashMap::new();
    let mut media_uid_by_title = HashMap::new();

    for media_row in media_rows {
        let (media, cover_blob_sha256) = media_row?;
        let Some(media_id) = media.id else {
            return Err("Media row missing local id".to_string());
        };
        let Some(media_uid) = media.uid.clone() else {
            return Err(format!("Media '{}' is missing a sync uid", media.title));
        };

        let aggregate = SnapshotMediaAggregate {
            uid: media_uid.clone(),
            title: media.title.clone(),
            media_type: media.media_type,
            status: media.status,
            language: media.language,
            description: media.description,
            content_type: media.content_type,
            tracking_status: media.tracking_status,
            extra_data: normalize_extra_data(&media.extra_data),
            cover_blob_sha256,
            updated_at: String::new(),
            updated_by_device_id: String::new(),
            activities: Vec::new(),
            milestones: Vec::new(),
        };

        media_uid_by_id.insert(media_id, media_uid.clone());
        media_uid_by_title.insert(media.title, media_uid.clone());
        library.insert(media_uid, aggregate);
    }

    for log in all_logs {
        let Some(media_uid) = media_uid_by_id.get(&log.media_id).cloned() else {
            continue;
        };
        if let Some(entry) = library.get_mut(&media_uid) {
            entry.activities.push(SnapshotActivity {
                date: log.date,
                activity_type: log.media_type,
                duration_minutes: log.duration_minutes,
                characters: log.characters,
            });
        }
    }

    for milestone in all_milestones {
        let media_uid = milestone
            .media_uid
            .clone()
            .or_else(|| media_uid_by_title.get(&milestone.media_title).cloned());
        let Some(media_uid) = media_uid else {
            continue;
        };
        if let Some(entry) = library.get_mut(&media_uid) {
            entry.milestones.push(SnapshotMilestone {
                name: milestone.name,
                duration: milestone.duration,
                characters: milestone.characters,
                date: milestone.date,
            });
        }
    }

    for (uid, entry) in &mut library {
        entry.activities.sort_by(activity_sort_key);
        entry.milestones.sort_by(milestone_sort_key);

        if let Some(base_entry) = options
            .base_snapshot
            .and_then(|snapshot| snapshot.library.get(uid))
            .filter(|base| media_content_eq(entry, base))
        {
            entry.updated_at = base_entry.updated_at.clone();
            entry.updated_by_device_id = base_entry.updated_by_device_id.clone();
        } else {
            entry.updated_at = options.created_at.to_string();
            entry.updated_by_device_id = options.created_by_device_id.to_string();
        }
    }

    let (profile_name, profile_updated_at) =
        profile_from_settings(&syncable_settings, options.created_at);
    let mut settings = BTreeMap::new();
    for row in syncable_settings {
        if row.key == PROFILE_NAME_SETTING_KEY {
            continue;
        }

        let updated_by_device_id = options
            .base_snapshot
            .and_then(|snapshot| snapshot.settings.get(&row.key))
            .filter(|base| base.value == row.value && base.updated_at == row.updated_at)
            .map(|base| base.updated_by_device_id.clone())
            .unwrap_or_else(|| options.created_by_device_id.to_string());

        settings.insert(
            row.key,
            SnapshotSettingValue {
                value: row.value,
                updated_at: row.updated_at,
                updated_by_device_id,
            },
        );
    }

    let mut theme_packs = BTreeMap::new();
    for (theme_id, syncable_theme_pack) in managed_theme_packs {
        let base_theme_pack = options
            .base_snapshot
            .and_then(|snapshot| snapshot.theme_packs.as_ref())
            .and_then(|packs| packs.get(&theme_id));
        let unchanged_from_base = base_theme_pack
            .is_some_and(|base| {
                base.content == syncable_theme_pack.content && base.assets == syncable_theme_pack.assets
            });

        theme_packs.insert(
            theme_id,
            SnapshotThemePack {
                content: syncable_theme_pack.content,
                assets: syncable_theme_pack.assets,
                updated_at: if unchanged_from_base {
                    base_theme_pack
                        .map(|base| base.updated_at.clone())
                        .unwrap_or_else(|| options.created_at.to_string())
                } else {
                    options.created_at.to_string()
                },
                updated_by_device_id: if unchanged_from_base {
                    base_theme_pack
                        .map(|base| base.updated_by_device_id.clone())
                        .unwrap_or_else(|| options.created_by_device_id.to_string())
                } else {
                    options.created_by_device_id.to_string()
                },
            },
        );
    }

    let profile_picture = profile_picture.map(|picture| {
        let updated_by_device_id = options
            .base_snapshot
            .and_then(|snapshot| snapshot.profile_picture.as_ref())
            .filter(|base| profile_picture_eq(base, &picture))
            .map(|base| base.updated_by_device_id.clone())
            .unwrap_or_else(|| options.created_by_device_id.to_string());

        SnapshotProfilePicture {
            mime_type: picture.mime_type,
            base64_data: picture.base64_data,
            byte_size: picture.byte_size,
            width: picture.width,
            height: picture.height,
            updated_at: picture.updated_at,
            updated_by_device_id,
        }
    });

    let mut tombstones = options.tombstones.to_vec();
    tombstones.sort();

    Ok(SyncSnapshot {
        sync_protocol_version: SYNC_PROTOCOL_VERSION,
        db_schema_version: db::CURRENT_SCHEMA_VERSION,
        snapshot_id: options.snapshot_id.to_string(),
        created_at: options.created_at.to_string(),
        created_by_device_id: options.created_by_device_id.to_string(),
        profile: SnapshotProfile {
            profile_id: options.profile_id.to_string(),
            profile_name,
            updated_at: profile_updated_at,
        },
        library,
        settings,
        theme_packs: Some(theme_packs),
        profile_picture,
        tombstones,
    })
}

pub fn snapshot_to_canonical_json(snapshot: &SyncSnapshot) -> Result<String, String> {
    serde_json::to_string(snapshot).map_err(|e| e.to_string())
}

pub fn parse_snapshot_json(json: &str) -> Result<SyncSnapshot, String> {
    serde_json::from_str(json).map_err(|e| e.to_string())
}

pub fn apply_snapshot(conn: &Connection, snapshot: &SyncSnapshot) -> Result<(), String> {
    let cover_cache = build_existing_cover_cache(conn)?;
    conn.execute_batch("BEGIN IMMEDIATE")
        .map_err(|e| e.to_string())?;

    let result = apply_snapshot_inner(conn, snapshot, &cover_cache);
    match result {
        Ok(()) => conn.execute_batch("COMMIT").map_err(|e| e.to_string()),
        Err(err) => {
            let _ = conn.execute_batch("ROLLBACK");
            Err(err)
        }
    }
}

pub fn apply_snapshot_theme_packs(app_dir: &Path, snapshot: &SyncSnapshot) -> Result<(), String> {
    let Some(theme_packs) = snapshot.theme_packs.as_ref() else {
        return Ok(());
    };

    let themes_dir = crate::theme_packs_dir(app_dir);
    if themes_dir.exists() {
        std::fs::remove_dir_all(&themes_dir)
            .map_err(|e| format!("Failed to clear managed theme packs: {e}"))?;
    }

    if theme_packs.is_empty() {
        return Ok(());
    }

    for (theme_id, theme_pack) in theme_packs {
        let asset_files = theme_pack
            .assets
            .iter()
            .map(|(asset_path, encoded_bytes)| {
                let decoded = BASE64_STANDARD
                    .decode(encoded_bytes)
                    .map_err(|e| format!("Failed to decode synced theme asset {asset_path}: {e}"))?;
                Ok((Path::new(asset_path).to_path_buf(), decoded))
            })
            .collect::<Result<Vec<_>, String>>()?;

        crate::save_theme_pack_bundle_logic(&themes_dir, theme_id, &theme_pack.content, &asset_files)?;
    }

    Ok(())
}

pub fn compute_cover_blob_sha256_from_path(path: &Path) -> Result<Option<String>, String> {
    if path.as_os_str().is_empty() || !path.exists() || !path.is_file() {
        return Ok(None);
    }

    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    Ok(Some(compute_sha256_hex(&bytes)))
}

fn apply_snapshot_inner(
    conn: &Connection,
    snapshot: &SyncSnapshot,
    cover_cache: &HashMap<String, String>,
) -> Result<(), String> {
    conn.execute("DELETE FROM main.activity_logs", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM main.milestones", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM shared.media", [])
        .map_err(|e| e.to_string())?;

    for key in SYNCABLE_SETTING_KEYS {
        conn.execute("DELETE FROM main.settings WHERE key = ?1", params![key])
            .map_err(|e| e.to_string())?;
    }

    upsert_setting_with_updated_at(
        conn,
        PROFILE_NAME_SETTING_KEY,
        &snapshot.profile.profile_name,
        &snapshot.profile.updated_at,
    )?;

    for (key, value) in &snapshot.settings {
        upsert_setting_with_updated_at(conn, key, &value.value, &value.updated_at)?;
    }

    match &snapshot.profile_picture {
        Some(profile_picture) => db::upsert_profile_picture(
            conn,
            &ProfilePicture {
                mime_type: profile_picture.mime_type.clone(),
                base64_data: profile_picture.base64_data.clone(),
                byte_size: profile_picture.byte_size,
                width: profile_picture.width,
                height: profile_picture.height,
                updated_at: profile_picture.updated_at.clone(),
            },
        )
        .map_err(|e| e.to_string())?,
        None => db::delete_profile_picture(conn).map_err(|e| e.to_string())?,
    }

    for (uid, aggregate) in &snapshot.library {
        if uid != &aggregate.uid {
            return Err(format!(
                "Snapshot library key '{}' does not match aggregate uid '{}'",
                uid, aggregate.uid
            ));
        }

        let cover_image = aggregate
            .cover_blob_sha256
            .as_ref()
            .and_then(|hash| cover_cache.get(hash))
            .cloned()
            .unwrap_or_default();

        let media_id = db::add_media_with_id(
            conn,
            &Media {
                id: None,
                uid: Some(aggregate.uid.clone()),
                title: aggregate.title.clone(),
                media_type: aggregate.media_type.clone(),
                status: aggregate.status.clone(),
                language: aggregate.language.clone(),
                description: aggregate.description.clone(),
                cover_image,
                extra_data: aggregate.extra_data.clone(),
                content_type: aggregate.content_type.clone(),
                tracking_status: aggregate.tracking_status.clone(),
            },
        )
        .map_err(|e| e.to_string())?;

        for activity in &aggregate.activities {
            db::add_log(
                conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: activity.duration_minutes,
                    characters: activity.characters,
                    date: activity.date.clone(),
                    activity_type: activity.activity_type.clone(),
                },
            )
            .map_err(|e| e.to_string())?;
        }

        for milestone in &aggregate.milestones {
            db::add_milestone(
                conn,
                &Milestone {
                    id: None,
                    media_uid: Some(aggregate.uid.clone()),
                    media_title: aggregate.title.clone(),
                    name: milestone.name.clone(),
                    duration: milestone.duration,
                    characters: milestone.characters,
                    date: milestone.date.clone(),
                },
            )
            .map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

fn load_syncable_theme_packs(app_dir: Option<&Path>) -> Result<BTreeMap<String, SyncableThemePack>, String> {
    let Some(app_dir) = app_dir else {
        return Ok(BTreeMap::new());
    };

    let mut theme_packs = BTreeMap::new();
    for content in crate::list_theme_pack_contents_logic(&crate::theme_packs_dir(app_dir))? {
        let Some(theme_id) = parse_theme_pack_id(&content) else {
            eprintln!("[kechimochi] Skipping invalid managed theme pack during sync snapshot build");
            continue;
        };
        let assets = crate::read_theme_pack_asset_bytes_logic(&crate::theme_packs_dir(app_dir), &theme_id)?
            .into_iter()
            .map(|(asset_path, bytes)| (asset_path, BASE64_STANDARD.encode(bytes)))
            .collect::<BTreeMap<_, _>>();
        theme_packs.insert(theme_id, SyncableThemePack { content, assets });
    }

    Ok(theme_packs)
}

fn parse_theme_pack_id(content: &str) -> Option<String> {
    serde_json::from_str::<ThemePackIdentity>(content)
        .ok()
        .map(|theme| theme.id.trim().to_string())
        .filter(|theme_id| !theme_id.is_empty())
}

fn load_syncable_settings(conn: &Connection) -> Result<Vec<SettingRow>, String> {
    let syncable_keys: HashSet<&str> = SYNCABLE_SETTING_KEYS.iter().copied().collect();
    let mut stmt = conn
        .prepare("SELECT key, value, updated_at FROM main.settings ORDER BY key ASC")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(SettingRow {
                key: row.get(0)?,
                value: row.get(1)?,
                updated_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut settings = Vec::new();
    for row in rows {
        let row = row.map_err(|e| e.to_string())?;
        if syncable_keys.contains(row.key.as_str()) {
            settings.push(row);
        }
    }
    settings.sort_by(|left, right| left.key.cmp(&right.key));
    Ok(settings)
}

fn profile_from_settings(settings: &[SettingRow], fallback_updated_at: &str) -> (String, String) {
    settings
        .iter()
        .find(|row| row.key == PROFILE_NAME_SETTING_KEY)
        .map(|row| (row.value.clone(), row.updated_at.clone()))
        .unwrap_or_else(|| {
            (
                DEFAULT_PROFILE_NAME.to_string(),
                fallback_updated_at.to_string(),
            )
        })
}

fn normalize_extra_data(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "{}".to_string();
    }

    match serde_json::from_str::<serde_json::Value>(trimmed) {
        Ok(value) => {
            serde_json::to_string(&sort_json_value(value)).unwrap_or_else(|_| trimmed.to_string())
        }
        Err(_) => trimmed.to_string(),
    }
}

fn sort_json_value(value: serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Array(values) => {
            serde_json::Value::Array(values.into_iter().map(sort_json_value).collect())
        }
        serde_json::Value::Object(map) => {
            let mut sorted = serde_json::Map::new();
            let ordered: BTreeMap<_, _> = map.into_iter().collect();
            for (key, value) in ordered {
                sorted.insert(key, sort_json_value(value));
            }
            serde_json::Value::Object(sorted)
        }
        other => other,
    }
}

fn compute_sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        let _ = write!(&mut output, "{:02x}", byte);
    }
    output
}

fn activity_sort_key(left: &SnapshotActivity, right: &SnapshotActivity) -> std::cmp::Ordering {
    left.date
        .cmp(&right.date)
        .then_with(|| left.activity_type.cmp(&right.activity_type))
        .then_with(|| left.duration_minutes.cmp(&right.duration_minutes))
        .then_with(|| left.characters.cmp(&right.characters))
}

fn milestone_sort_key(left: &SnapshotMilestone, right: &SnapshotMilestone) -> std::cmp::Ordering {
    left.date
        .cmp(&right.date)
        .then_with(|| left.name.cmp(&right.name))
        .then_with(|| left.duration.cmp(&right.duration))
        .then_with(|| left.characters.cmp(&right.characters))
}

fn media_content_eq(left: &SnapshotMediaAggregate, right: &SnapshotMediaAggregate) -> bool {
    left.uid == right.uid
        && left.title == right.title
        && left.media_type == right.media_type
        && left.status == right.status
        && left.language == right.language
        && left.description == right.description
        && left.content_type == right.content_type
        && left.tracking_status == right.tracking_status
        && left.extra_data == right.extra_data
        && left.cover_blob_sha256 == right.cover_blob_sha256
        && left.activities == right.activities
        && left.milestones == right.milestones
}

fn profile_picture_eq(left: &SnapshotProfilePicture, right: &ProfilePicture) -> bool {
    left.mime_type == right.mime_type
        && left.base64_data == right.base64_data
        && left.byte_size == right.byte_size
        && left.width == right.width
        && left.height == right.height
        && left.updated_at == right.updated_at
}

fn build_existing_cover_cache(conn: &Connection) -> Result<HashMap<String, String>, String> {
    let mut cache = HashMap::new();
    for media in db::get_all_media(conn).map_err(|e| e.to_string())? {
        let path = Path::new(&media.cover_image);
        let Some(hash) = compute_cover_blob_sha256_from_path(path)? else {
            continue;
        };
        cache.entry(hash).or_insert(media.cover_image);
    }
    Ok(cache)
}

fn upsert_setting_with_updated_at(
    conn: &Connection,
    key: &str,
    value: &str,
    updated_at: &str,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO main.settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at",
        params![key, value, updated_at],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use rusqlite::Connection;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", [])
            .unwrap();
        db::create_tables(&conn).unwrap();
        conn
    }

    fn sample_media(title: &str, cover_image: String, extra_data: &str) -> Media {
        Media {
            id: None,
            uid: None,
            title: title.to_string(),
            media_type: "Reading".to_string(),
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: "Desc".to_string(),
            cover_image,
            extra_data: extra_data.to_string(),
            content_type: "Novel".to_string(),
            tracking_status: "Ongoing".to_string(),
        }
    }

    fn unique_temp_dir(prefix: &str) -> std::path::PathBuf {
        let ts = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("{}_{}_{}", prefix, std::process::id(), ts))
    }

    fn set_setting_value(conn: &Connection, key: &str, value: &str, updated_at: &str) {
        conn.execute(
            "INSERT INTO main.settings (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
            params![key, value, updated_at],
        )
        .unwrap();
    }

    fn build_fixture_snapshot(conn: &Connection) -> SyncSnapshot {
        build_snapshot(
            conn,
            SnapshotBuildOptions {
                app_dir: None,
                snapshot_id: "snap_test",
                created_at: "2026-04-02T12:34:56Z",
                created_by_device_id: "dev_fixture",
                profile_id: "prof_fixture",
                base_snapshot: None,
                tombstones: &[SnapshotTombstone {
                    media_uid: "deleted-uid".to_string(),
                    deleted_at: "2026-04-01T00:00:00Z".to_string(),
                    deleted_by_device_id: "dev_fixture".to_string(),
                }],
            },
        )
        .unwrap()
    }

    #[test]
    fn test_build_snapshot_is_canonical_and_excludes_local_paths() {
        let conn = setup_test_db();
        let temp_dir = unique_temp_dir("snapshot_serializer");
        std::fs::create_dir_all(&temp_dir).unwrap();
        let cover_path = temp_dir.join("cover.png");
        std::fs::write(&cover_path, b"snapshot-cover").unwrap();

        let media_id = db::add_media_with_id(
            &conn,
            &sample_media(
                "Serializer Test",
                cover_path.to_string_lossy().to_string(),
                "{ \"z\": 2, \"a\": { \"d\": 4, \"c\": 3 } }",
            ),
        )
        .unwrap();

        db::add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 45,
                characters: 200,
                date: "2026-04-02".to_string(),
                activity_type: "Reading".to_string(),
            },
        )
        .unwrap();
        db::add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 30,
                characters: 100,
                date: "2026-04-01".to_string(),
                activity_type: "Reading".to_string(),
            },
        )
        .unwrap();
        db::add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: None,
                media_title: "Serializer Test".to_string(),
                name: "B Milestone".to_string(),
                duration: 90,
                characters: 0,
                date: Some("2026-04-03".to_string()),
            },
        )
        .unwrap();
        db::add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: None,
                media_title: "Serializer Test".to_string(),
                name: "A Milestone".to_string(),
                duration: 30,
                characters: 0,
                date: Some("2026-04-01".to_string()),
            },
        )
        .unwrap();

        set_setting_value(&conn, "theme", "molokai", "2026-04-01T10:00:00Z");
        set_setting_value(&conn, "profile_name", "Morg", "2026-04-01T09:00:00Z");
        set_setting_value(
            &conn,
            "updates_auto_check_enabled",
            "false",
            "2026-04-01T08:00:00Z",
        );
        db::upsert_profile_picture(
            &conn,
            &ProfilePicture {
                mime_type: "image/png".to_string(),
                base64_data: "YWJj".to_string(),
                byte_size: 3,
                width: 32,
                height: 32,
                updated_at: "2026-03-31T08:00:00Z".to_string(),
            },
        )
        .unwrap();

        let snapshot = build_fixture_snapshot(&conn);
        let json = snapshot_to_canonical_json(&snapshot).unwrap();

        assert_eq!(snapshot.sync_protocol_version, SYNC_PROTOCOL_VERSION);
        assert_eq!(snapshot.profile.profile_name, "Morg");
        assert!(!snapshot.settings.contains_key("profile_name"));
        assert!(snapshot.settings.contains_key("theme"));
        assert!(!snapshot.settings.contains_key("updates_auto_check_enabled"));
        assert_eq!(snapshot.tombstones.len(), 1);

        let media = snapshot.library.values().next().unwrap();
        assert_eq!(media.extra_data, "{\"a\":{\"c\":3,\"d\":4},\"z\":2}");
        assert_eq!(media.activities[0].date, "2026-04-01");
        assert_eq!(media.activities[1].date, "2026-04-02");
        assert_eq!(media.milestones[0].name, "A Milestone");
        assert_eq!(media.milestones[1].name, "B Milestone");
        assert_eq!(
            media.cover_blob_sha256.as_deref(),
            Some(compute_sha256_hex(b"snapshot-cover").as_str())
        );
        assert_eq!(media.updated_at, "2026-04-02T12:34:56Z");
        assert_eq!(media.updated_by_device_id, "dev_fixture");

        assert!(!json.contains(&cover_path.to_string_lossy().to_string()));
        assert!(!json.contains("\"id\":"));

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_apply_snapshot_round_trips_logical_state() {
        let conn = setup_test_db();
        let temp_dir = unique_temp_dir("snapshot_roundtrip");
        std::fs::create_dir_all(&temp_dir).unwrap();
        let cover_path = temp_dir.join("cover.png");
        std::fs::write(&cover_path, b"roundtrip-cover").unwrap();

        let media_id = db::add_media_with_id(
            &conn,
            &sample_media(
                "Roundtrip Title",
                cover_path.to_string_lossy().to_string(),
                "{\"b\":2,\"a\":1}",
            ),
        )
        .unwrap();
        db::add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 60,
                characters: 0,
                date: "2026-04-02".to_string(),
                activity_type: "Reading".to_string(),
            },
        )
        .unwrap();
        db::add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: None,
                media_title: "Roundtrip Title".to_string(),
                name: "Checkpoint".to_string(),
                duration: 60,
                characters: 0,
                date: Some("2026-04-02".to_string()),
            },
        )
        .unwrap();
        set_setting_value(&conn, "theme", "deep-blue", "2026-04-01T10:00:00Z");
        set_setting_value(&conn, "profile_name", "Sync User", "2026-04-01T09:00:00Z");
        set_setting_value(
            &conn,
            "updates_auto_check_enabled",
            "false",
            "2026-04-01T08:00:00Z",
        );
        db::upsert_profile_picture(
            &conn,
            &ProfilePicture {
                mime_type: "image/png".to_string(),
                base64_data: "cGlj".to_string(),
                byte_size: 3,
                width: 48,
                height: 48,
                updated_at: "2026-04-01T07:00:00Z".to_string(),
            },
        )
        .unwrap();

        let snapshot = build_snapshot(
            &conn,
            SnapshotBuildOptions {
                app_dir: None,
                snapshot_id: "snap_roundtrip",
                created_at: "2026-04-02T12:34:56Z",
                created_by_device_id: "dev_roundtrip",
                profile_id: "prof_roundtrip",
                base_snapshot: None,
                tombstones: &[],
            },
        )
        .unwrap();
        let json = snapshot_to_canonical_json(&snapshot).unwrap();
        let parsed = parse_snapshot_json(&json).unwrap();

        apply_snapshot(&conn, &parsed).unwrap();

        assert_eq!(
            conn.query_row(
                "SELECT value FROM main.settings WHERE key = 'updates_auto_check_enabled'",
                [],
                |row| row.get::<_, String>(0)
            )
            .unwrap(),
            "false"
        );

        let rebuilt = build_snapshot(
            &conn,
            SnapshotBuildOptions {
                app_dir: None,
                snapshot_id: "snap_roundtrip",
                created_at: "2026-04-02T12:34:56Z",
                created_by_device_id: "dev_roundtrip",
                profile_id: "prof_roundtrip",
                base_snapshot: None,
                tombstones: &[],
            },
        )
        .unwrap();

        assert_eq!(rebuilt, parsed);
        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_build_snapshot_preserves_base_metadata_for_unchanged_media() {
        let conn = setup_test_db();
        let media_id = db::add_media_with_id(
            &conn,
            &sample_media("Metadata Media", String::new(), "{\"b\":2,\"a\":1}"),
        )
        .unwrap();
        db::add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 20,
                characters: 0,
                date: "2026-04-01".to_string(),
                activity_type: "Reading".to_string(),
            },
        )
        .unwrap();
        set_setting_value(&conn, "profile_name", "Meta User", "2026-04-01T09:00:00Z");

        let base_snapshot = build_snapshot(
            &conn,
            SnapshotBuildOptions {
                app_dir: None,
                snapshot_id: "snap_base",
                created_at: "2026-04-02T00:00:00Z",
                created_by_device_id: "dev_base",
                profile_id: "prof_meta",
                base_snapshot: None,
                tombstones: &[],
            },
        )
        .unwrap();

        let rebuilt = build_snapshot(
            &conn,
            SnapshotBuildOptions {
                app_dir: None,
                snapshot_id: "snap_next",
                created_at: "2026-04-03T00:00:00Z",
                created_by_device_id: "dev_next",
                profile_id: "prof_meta",
                base_snapshot: Some(&base_snapshot),
                tombstones: &[],
            },
        )
        .unwrap();

        let base_media = base_snapshot.library.values().next().unwrap();
        let rebuilt_media = rebuilt.library.values().next().unwrap();
        assert_eq!(rebuilt_media.updated_at, base_media.updated_at);
        assert_eq!(
            rebuilt_media.updated_by_device_id,
            base_media.updated_by_device_id
        );
    }

    #[test]
    fn test_snapshot_syncs_managed_theme_packs() {
        let conn = setup_test_db();
        let source_dir = unique_temp_dir("snapshot_theme_source");
        let target_dir = unique_temp_dir("snapshot_theme_target");
        std::fs::create_dir_all(&source_dir).unwrap();
        std::fs::create_dir_all(&target_dir).unwrap();

        let content = r#"{"version":1,"id":"custom:aurora-sync","name":"Aurora Sync","variables":{},"background":{"type":"image","src":"assets/bg.webp"}}"#;
        crate::save_theme_pack_bundle_logic(
            &crate::theme_packs_dir(&source_dir),
            "custom:aurora-sync",
            content,
            &[(std::path::PathBuf::from("assets/bg.webp"), b"aurora-bytes".to_vec())],
        )
        .unwrap();

        let snapshot = build_snapshot(
            &conn,
            SnapshotBuildOptions {
                app_dir: Some(source_dir.as_path()),
                snapshot_id: "snap_themes",
                created_at: "2026-04-02T12:34:56Z",
                created_by_device_id: "dev_theme",
                profile_id: "prof_themes",
                base_snapshot: None,
                tombstones: &[],
            },
        )
        .unwrap();

        let theme_packs = snapshot.theme_packs.as_ref().unwrap();
        assert_eq!(theme_packs["custom:aurora-sync"].content, content);
        assert_eq!(
            theme_packs["custom:aurora-sync"].assets,
            BTreeMap::from([(
                "assets/bg.webp".to_string(),
                base64::engine::general_purpose::STANDARD.encode(b"aurora-bytes"),
            )])
        );
        assert_eq!(theme_packs["custom:aurora-sync"].updated_at, "2026-04-02T12:34:56Z");
        assert_eq!(theme_packs["custom:aurora-sync"].updated_by_device_id, "dev_theme");

        crate::save_theme_pack_logic(
            &crate::theme_packs_dir(&target_dir),
            "custom:stale-theme",
            r#"{"version":1,"id":"custom:stale-theme","name":"Stale","variables":{}}"#,
            None,
        )
        .unwrap();
        apply_snapshot_theme_packs(target_dir.as_path(), &snapshot).unwrap();

        assert_eq!(
            crate::read_theme_pack_logic(&crate::theme_packs_dir(&target_dir), "custom:aurora-sync").unwrap(),
            Some(content.to_string())
        );
        assert_eq!(
            crate::read_theme_pack_asset_bytes_logic(&crate::theme_packs_dir(&target_dir), "custom:aurora-sync").unwrap(),
            vec![("assets/bg.webp".to_string(), b"aurora-bytes".to_vec())]
        );
        assert_eq!(
            crate::read_theme_pack_logic(&crate::theme_packs_dir(&target_dir), "custom:stale-theme").unwrap(),
            None
        );

        std::fs::remove_dir_all(source_dir).ok();
        std::fs::remove_dir_all(target_dir).ok();
    }
}
