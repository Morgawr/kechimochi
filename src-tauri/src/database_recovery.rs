use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs;
use std::path::{Path, PathBuf};

use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::backup;
use crate::db;
use crate::models::Media;

const RECOVERY_BACKUP_DIR: &str = "recovery_backups";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DatabaseRecoveryPlan {
    pub session_token: String,
    pub issues: Vec<DatabaseRecoveryIssue>,
    pub media: Vec<RecoveryMediaOption>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseRecoveryIssue {
    OrphanedMilestoneGroups { groups: Vec<OrphanedMilestoneGroup> },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct OrphanedMilestoneGroup {
    pub group_token: String,
    pub media_title: String,
    pub milestones: Vec<RecoveryMilestone>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecoveryMilestone {
    pub id: i64,
    pub name: String,
    pub duration: i64,
    pub characters: i64,
    pub date: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RecoveryMediaOption {
    pub uid: String,
    pub title: String,
    pub variant: String,
    pub status: String,
    pub tracking_status: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ApplyDatabaseRecoveryRequest {
    pub session_token: String,
    pub resolutions: Vec<DatabaseRecoveryResolution>,
    #[serde(default)]
    pub local_storage: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseRecoveryResolution {
    AttachMilestoneGroup {
        group_token: String,
        media_uid: String,
    },
    CreateMediaForMilestoneGroup {
        group_token: String,
        #[serde(default)]
        variant: String,
    },
    DiscardMilestoneGroup {
        group_token: String,
    },
}

impl DatabaseRecoveryResolution {
    fn group_token(&self) -> &str {
        match self {
            Self::AttachMilestoneGroup { group_token, .. }
            | Self::CreateMediaForMilestoneGroup { group_token, .. }
            | Self::DiscardMilestoneGroup { group_token } => group_token,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DatabaseRecoveryResult {
    pub safety_backup_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub local_storage: Option<String>,
}

pub enum DatabaseOpenOutcome {
    Ready(Connection),
    RecoveryRequired(DatabaseRecoveryPlan),
}

#[derive(Debug, Clone)]
pub enum DatabaseRecoveryTarget {
    ActiveDatabase,
    StagedFullBackup {
        staging_dir: PathBuf,
        local_storage: String,
    },
}

#[derive(Debug, Clone)]
pub struct DatabaseRecoverySession {
    pub plan: DatabaseRecoveryPlan,
    pub target: DatabaseRecoveryTarget,
}

impl DatabaseRecoverySession {
    pub fn active_database(plan: DatabaseRecoveryPlan) -> Self {
        Self {
            plan,
            target: DatabaseRecoveryTarget::ActiveDatabase,
        }
    }
}

pub struct AppliedDatabaseRecovery {
    pub connection: Connection,
    pub result: DatabaseRecoveryResult,
}

#[derive(Debug)]
struct BrokenMilestoneRow {
    id: i64,
    media_title: String,
    name: String,
    duration: i64,
    characters: i64,
    date: Option<String>,
}

pub fn open_database(
    app_dir: PathBuf,
    fallback_username: Option<&str>,
) -> Result<DatabaseOpenOutcome, String> {
    match db::init_db(app_dir.clone(), fallback_username) {
        Ok(connection) => Ok(DatabaseOpenOutcome::Ready(connection)),
        Err(error) => match analyze_database(&app_dir) {
            Ok(Some(plan)) => Ok(DatabaseOpenOutcome::RecoveryRequired(plan)),
            Ok(None) | Err(_) => Err(error.to_string()),
        },
    }
}

fn open_recovery_connection(app_dir: &Path) -> Result<Connection, String> {
    let user_db = app_dir.join("kechimochi_user.db");
    let shared_db = app_dir.join("kechimochi_shared_media.db");
    if !user_db.exists() || !shared_db.exists() {
        return Err("The database bundle is incomplete and cannot be recovered.".to_string());
    }

    let connection =
        Connection::open(&user_db).map_err(|error| format!("Failed to open user DB: {error}"))?;
    connection
        .execute(
            "ATTACH DATABASE ?1 AS shared",
            params![shared_db.to_string_lossy().to_string()],
        )
        .map_err(|error| format!("Failed to attach shared media DB: {error}"))?;
    Ok(connection)
}

fn table_has_column(
    connection: &Connection,
    schema: &str,
    table: &str,
    column: &str,
) -> Result<bool, String> {
    let mut statement = connection
        .prepare(&format!("PRAGMA {schema}.table_info({table})"))
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|error| error.to_string())?;
    for row in rows {
        if row.map_err(|error| error.to_string())? == column {
            return Ok(true);
        }
    }
    Ok(false)
}

fn recovery_group_token(media_title: &str, milestones: &[BrokenMilestoneRow]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(media_title.as_bytes());
    for milestone in milestones {
        hasher.update(milestone.id.to_le_bytes());
        hasher.update(milestone.name.as_bytes());
        hasher.update(milestone.duration.to_le_bytes());
        hasher.update(milestone.characters.to_le_bytes());
        hasher.update(milestone.date.as_deref().unwrap_or_default().as_bytes());
    }
    format!("{:x}", hasher.finalize())
}

fn read_broken_milestone_groups(
    connection: &Connection,
) -> Result<Vec<OrphanedMilestoneGroup>, String> {
    if !table_has_column(connection, "main", "milestones", "media_uid")?
        || !table_has_column(connection, "main", "milestones", "media_title")?
        || !table_has_column(connection, "shared", "media", "uid")?
    {
        return Ok(Vec::new());
    }

    let mut statement = connection
        .prepare(
            "SELECT ms.id, ms.media_title, ms.name, ms.duration, ms.characters, ms.date
             FROM main.milestones ms
             LEFT JOIN shared.media media ON media.uid = ms.media_uid
             WHERE TRIM(COALESCE(ms.media_uid, '')) = '' OR media.uid IS NULL
             ORDER BY ms.media_title ASC, ms.id ASC",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(BrokenMilestoneRow {
                id: row.get(0)?,
                media_title: row.get(1)?,
                name: row.get(2)?,
                duration: row.get(3)?,
                characters: row.get(4)?,
                date: row.get(5)?,
            })
        })
        .map_err(|error| error.to_string())?;

    let mut grouped = BTreeMap::<String, Vec<BrokenMilestoneRow>>::new();
    for row in rows {
        let row = row.map_err(|error| error.to_string())?;
        grouped
            .entry(row.media_title.clone())
            .or_default()
            .push(row);
    }

    let mut recovery_groups = Vec::new();
    for (media_title, milestones) in grouped {
        let exact_matches: i64 = connection
            .query_row(
                "SELECT COUNT(*) FROM shared.media WHERE title = ?1",
                params![media_title],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if exact_matches == 1 {
            continue;
        }

        recovery_groups.push(OrphanedMilestoneGroup {
            group_token: recovery_group_token(&media_title, &milestones),
            media_title,
            milestones: milestones
                .into_iter()
                .map(|milestone| RecoveryMilestone {
                    id: milestone.id,
                    name: milestone.name,
                    duration: milestone.duration,
                    characters: milestone.characters,
                    date: milestone.date,
                })
                .collect(),
        });
    }
    Ok(recovery_groups)
}

fn read_recovery_media(connection: &Connection) -> Result<Vec<RecoveryMediaOption>, String> {
    let variant_expression = if table_has_column(connection, "shared", "media", "variant")? {
        "COALESCE(variant, '')"
    } else {
        "''"
    };
    let tracking_expression = if table_has_column(connection, "shared", "media", "tracking_status")?
    {
        "COALESCE(tracking_status, '')"
    } else {
        "''"
    };
    let sql = format!(
        "SELECT uid, title, {variant_expression}, status, {tracking_expression}
         FROM shared.media
         ORDER BY title COLLATE NOCASE ASC, {variant_expression} COLLATE NOCASE ASC, id ASC"
    );
    let mut statement = connection
        .prepare(&sql)
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(RecoveryMediaOption {
                uid: row.get(0)?,
                title: row.get(1)?,
                variant: row.get(2)?,
                status: row.get(3)?,
                tracking_status: row.get(4)?,
            })
        })
        .map_err(|error| error.to_string())?;

    let mut media = Vec::new();
    for row in rows {
        media.push(row.map_err(|error| error.to_string())?);
    }
    Ok(media)
}

pub fn analyze_database(app_dir: &Path) -> Result<Option<DatabaseRecoveryPlan>, String> {
    let connection = open_recovery_connection(app_dir)?;
    let schema_version =
        db::get_bundle_schema_version(&connection).map_err(|error| error.to_string())?;
    if schema_version > db::CURRENT_SCHEMA_VERSION {
        return Ok(None);
    }
    let groups = read_broken_milestone_groups(&connection)?;
    if groups.is_empty() {
        return Ok(None);
    }

    Ok(Some(DatabaseRecoveryPlan {
        session_token: Uuid::new_v4().to_string(),
        issues: vec![DatabaseRecoveryIssue::OrphanedMilestoneGroups { groups }],
        media: read_recovery_media(&connection)?,
    }))
}

fn milestone_groups(plan: &DatabaseRecoveryPlan) -> impl Iterator<Item = &OrphanedMilestoneGroup> {
    plan.issues.iter().flat_map(|issue| match issue {
        DatabaseRecoveryIssue::OrphanedMilestoneGroups { groups } => groups.iter(),
    })
}

fn create_safety_backup(
    app_dir: &Path,
    connection: &Connection,
    local_storage: &str,
) -> Result<String, String> {
    let backup_dir = app_dir.join(RECOVERY_BACKUP_DIR);
    fs::create_dir_all(&backup_dir).map_err(|error| error.to_string())?;
    let backup_name = format!(
        "pre_recovery_backup_{}_{}.zip",
        Utc::now().format("%Y%m%dT%H%M%SZ"),
        Uuid::new_v4().simple()
    );
    let backup_path = backup_dir.join(backup_name);
    backup::export_full_backup_internal(
        app_dir,
        connection,
        &backup_path.to_string_lossy(),
        local_storage,
        env!("CARGO_PKG_VERSION"),
    )?;
    Ok(backup_path.to_string_lossy().to_string())
}

fn apply_exact_title_repairs(connection: &Connection) -> Result<(), String> {
    connection
        .execute(
            "UPDATE main.milestones
             SET media_uid = (
                     SELECT media.uid FROM shared.media media
                     WHERE media.title = main.milestones.media_title
                 ),
                 media_title = (
                     SELECT media.title FROM shared.media media
                     WHERE media.title = main.milestones.media_title
                 )
             WHERE (
                 TRIM(COALESCE(media_uid, '')) = ''
                 OR NOT EXISTS (
                     SELECT 1 FROM shared.media current_media
                     WHERE current_media.uid = main.milestones.media_uid
                 )
             )
             AND 1 = (
                 SELECT COUNT(*) FROM shared.media title_match
                 WHERE title_match.title = main.milestones.media_title
             )",
            [],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

fn update_group_milestones(
    connection: &Connection,
    group: &OrphanedMilestoneGroup,
    media_uid: &str,
    media_title: &str,
) -> Result<(), String> {
    for milestone in &group.milestones {
        let changed = connection
            .execute(
                "UPDATE main.milestones
                 SET media_uid = ?1, media_title = ?2
                 WHERE id = ?3
                   AND (
                       TRIM(COALESCE(media_uid, '')) = ''
                       OR NOT EXISTS (
                           SELECT 1 FROM shared.media current_media
                           WHERE current_media.uid = main.milestones.media_uid
                       )
                   )",
                params![media_uid, media_title, milestone.id],
            )
            .map_err(|error| error.to_string())?;
        if changed != 1 {
            return Err(format!(
                "Milestone {} changed after the recovery screen was opened. Reload recovery and try again.",
                milestone.id
            ));
        }
    }
    Ok(())
}

fn apply_resolution(
    connection: &Connection,
    group: &OrphanedMilestoneGroup,
    resolution: &DatabaseRecoveryResolution,
) -> Result<(), String> {
    match resolution {
        DatabaseRecoveryResolution::AttachMilestoneGroup { media_uid, .. } => {
            let title = connection
                .query_row(
                    "SELECT title FROM shared.media WHERE uid = ?1",
                    params![media_uid],
                    |row| row.get::<_, String>(0),
                )
                .optional()
                .map_err(|error| error.to_string())?
                .ok_or_else(|| {
                    "The selected media entry no longer exists. Choose another entry.".to_string()
                })?;
            update_group_milestones(connection, group, media_uid, &title)
        }
        DatabaseRecoveryResolution::CreateMediaForMilestoneGroup { variant, .. } => {
            let media = Media {
                id: None,
                uid: None,
                title: group.media_title.clone(),
                variant: variant.trim().to_string(),
                default_activity_type: "Reading".to_string(),
                status: "Active".to_string(),
                language: "Japanese".to_string(),
                description: String::new(),
                cover_image: String::new(),
                extra_data: "{}".to_string(),
                content_type: "Unknown".to_string(),
                tracking_status: "Ongoing".to_string(),
            };
            let media_id =
                db::add_media_with_id(connection, &media).map_err(|error| error.to_string())?;
            let media_uid = connection
                .query_row(
                    "SELECT uid FROM shared.media WHERE id = ?1",
                    params![media_id],
                    |row| row.get::<_, String>(0),
                )
                .map_err(|error| error.to_string())?;
            update_group_milestones(connection, group, &media_uid, &group.media_title)
        }
        DatabaseRecoveryResolution::DiscardMilestoneGroup { .. } => {
            for milestone in &group.milestones {
                let changed = connection
                    .execute(
                        "DELETE FROM main.milestones
                         WHERE id = ?1
                           AND (
                               TRIM(COALESCE(media_uid, '')) = ''
                               OR NOT EXISTS (
                                   SELECT 1 FROM shared.media current_media
                                   WHERE current_media.uid = main.milestones.media_uid
                               )
                           )",
                        params![milestone.id],
                    )
                    .map_err(|error| error.to_string())?;
                if changed != 1 {
                    return Err(format!(
                        "Milestone {} changed after the recovery screen was opened. Reload recovery and try again.",
                        milestone.id
                    ));
                }
            }
            Ok(())
        }
    }
}

pub fn apply_database_recovery(
    app_dir: &Path,
    expected_plan: &DatabaseRecoveryPlan,
    request: ApplyDatabaseRecoveryRequest,
) -> Result<AppliedDatabaseRecovery, String> {
    if request.session_token != expected_plan.session_token {
        return Err("This database recovery session is stale. Reload and try again.".to_string());
    }

    let current_plan = analyze_database(app_dir)?
        .ok_or_else(|| "The database no longer requires recovery.".to_string())?;
    let expected_groups = milestone_groups(expected_plan)
        .map(|group| group.group_token.clone())
        .collect::<BTreeSet<_>>();
    let current_groups = milestone_groups(&current_plan)
        .map(|group| group.group_token.clone())
        .collect::<BTreeSet<_>>();
    if expected_groups != current_groups {
        return Err(
            "The database changed after the recovery screen was opened. Reload and try again."
                .to_string(),
        );
    }

    let mut resolutions = HashMap::new();
    for resolution in request.resolutions {
        let token = resolution.group_token().to_string();
        if resolutions.insert(token.clone(), resolution).is_some() {
            return Err(format!(
                "More than one recovery action was supplied for group {token}."
            ));
        }
    }
    if resolutions.keys().cloned().collect::<BTreeSet<_>>() != current_groups {
        return Err("Choose one recovery action for every database issue.".to_string());
    }

    let connection = open_recovery_connection(app_dir)?;
    let safety_backup_path = create_safety_backup(app_dir, &connection, &request.local_storage)?;

    connection
        .execute_batch("BEGIN IMMEDIATE")
        .map_err(|error| error.to_string())?;
    let apply_result = (|| {
        apply_exact_title_repairs(&connection)?;
        for group in milestone_groups(&current_plan) {
            let resolution = resolutions
                .get(&group.group_token)
                .ok_or_else(|| "Missing recovery resolution.".to_string())?;
            apply_resolution(&connection, group, resolution)?;
        }
        Ok::<(), String>(())
    })();
    match apply_result {
        Ok(()) => connection
            .execute_batch("COMMIT")
            .map_err(|error| error.to_string())?,
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            return Err(format!(
                "{error} No recovery changes were saved. Safety backup: {safety_backup_path}"
            ));
        }
    }
    drop(connection);

    let connection = db::init_db(app_dir.to_path_buf(), None).map_err(|error| {
        format!(
            "Recovery choices were saved, but database initialization still failed: {error}. Safety backup: {safety_backup_path}"
        )
    })?;
    Ok(AppliedDatabaseRecovery {
        connection,
        result: DatabaseRecoveryResult {
            safety_backup_path,
            local_storage: None,
        },
    })
}

pub fn preserve_safety_backup(
    app_dir: &Path,
    recovery_result: &mut DatabaseRecoveryResult,
) -> Result<(), String> {
    let source = Path::new(&recovery_result.safety_backup_path);
    let destination_dir = app_dir.join(RECOVERY_BACKUP_DIR);
    fs::create_dir_all(&destination_dir).map_err(|error| {
        format!(
            "Failed to create recovery backup directory {}: {error}",
            destination_dir.display()
        )
    })?;
    let file_name = source
        .file_name()
        .ok_or_else(|| "Recovery backup path has no file name.".to_string())?;
    let destination = destination_dir.join(file_name);
    fs::copy(source, &destination).map_err(|error| {
        format!(
            "Failed to preserve recovery backup at {}: {error}",
            destination.display()
        )
    })?;
    recovery_result.safety_backup_path = destination.to_string_lossy().to_string();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Milestone;
    use tempfile::TempDir;

    fn sample_media(title: &str, variant: &str) -> Media {
        Media {
            id: None,
            uid: None,
            title: title.to_string(),
            variant: variant.to_string(),
            default_activity_type: "Reading".to_string(),
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: String::new(),
            cover_image: String::new(),
            extra_data: "{}".to_string(),
            content_type: "Novel".to_string(),
            tracking_status: "Ongoing".to_string(),
        }
    }

    fn create_broken_database(
        directory: &TempDir,
        current_title: &str,
        legacy_title: &str,
    ) -> String {
        let connection = db::init_db(directory.path().to_path_buf(), None).unwrap();
        let media_id =
            db::add_media_with_id(&connection, &sample_media(current_title, "")).unwrap();
        let media_uid = connection
            .query_row(
                "SELECT uid FROM shared.media WHERE id = ?1",
                params![media_id],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        db::add_milestone(
            &connection,
            &Milestone {
                id: None,
                media_uid: Some(media_uid.clone()),
                media_title: current_title.to_string(),
                name: "Chapter 1".to_string(),
                duration: 30,
                characters: 1200,
                date: Some("2026-01-02".to_string()),
            },
        )
        .unwrap();
        connection
            .execute(
                "UPDATE main.milestones SET media_uid = 'missing-uid', media_title = ?1",
                params![legacy_title],
            )
            .unwrap();
        connection
            .execute_batch("PRAGMA main.user_version = 5; PRAGMA shared.user_version = 5;")
            .unwrap();
        drop(connection);
        media_uid
    }

    fn only_group(plan: &DatabaseRecoveryPlan) -> &OrphanedMilestoneGroup {
        match &plan.issues[0] {
            DatabaseRecoveryIssue::OrphanedMilestoneGroups { groups } => {
                assert_eq!(groups.len(), 1);
                &groups[0]
            }
        }
    }

    #[test]
    fn exact_title_link_is_repaired_without_user_recovery() {
        let directory = TempDir::new().unwrap();
        let expected_uid = create_broken_database(&directory, "Same Title", "Same Title");

        let outcome = open_database(directory.path().to_path_buf(), None).unwrap();
        let DatabaseOpenOutcome::Ready(connection) = outcome else {
            panic!("exact title repair should not require user recovery");
        };
        let stored_uid = connection
            .query_row("SELECT media_uid FROM main.milestones", [], |row| {
                row.get::<_, String>(0)
            })
            .unwrap();
        assert_eq!(stored_uid, expected_uid);
        assert_eq!(db::get_bundle_schema_version(&connection).unwrap(), 6);
    }

    #[test]
    fn future_schema_is_never_treated_as_recoverable() {
        let directory = TempDir::new().unwrap();
        create_broken_database(&directory, "Renamed Title", "Old Title");
        let connection = open_recovery_connection(directory.path()).unwrap();
        connection
            .execute_batch("PRAGMA main.user_version = 999; PRAGMA shared.user_version = 999;")
            .unwrap();
        drop(connection);

        let error = match open_database(directory.path().to_path_buf(), None) {
            Ok(_) => panic!("future schema must remain blocked"),
            Err(error) => error,
        };
        assert!(error.contains("newer than this app supports"));
    }

    #[test]
    fn unresolved_group_exposes_milestones_and_variant_aware_media_options() {
        let directory = TempDir::new().unwrap();
        create_broken_database(&directory, "Renamed Title", "Old Title");
        let connection = open_recovery_connection(directory.path()).unwrap();
        db::add_media_with_id(&connection, &sample_media("Another", "Manga")).unwrap();
        drop(connection);

        let outcome = open_database(directory.path().to_path_buf(), None).unwrap();
        let DatabaseOpenOutcome::RecoveryRequired(plan) = outcome else {
            panic!("broken title should require recovery");
        };
        let group = only_group(&plan);
        assert_eq!(group.media_title, "Old Title");
        assert_eq!(group.milestones[0].name, "Chapter 1");
        assert!(plan
            .media
            .iter()
            .any(|media| media.title == "Another" && media.variant == "Manga"));

        let connection = open_recovery_connection(directory.path()).unwrap();
        assert_eq!(db::get_bundle_schema_version(&connection).unwrap(), 5);
    }

    #[test]
    fn attaching_a_group_repairs_and_finishes_schema_six_without_a_version_bump() {
        let directory = TempDir::new().unwrap();
        let expected_uid = create_broken_database(&directory, "Renamed Title", "Old Title");
        let DatabaseOpenOutcome::RecoveryRequired(plan) =
            open_database(directory.path().to_path_buf(), None).unwrap()
        else {
            panic!("broken title should require recovery");
        };
        let group_token = only_group(&plan).group_token.clone();

        let applied = apply_database_recovery(
            directory.path(),
            &plan,
            ApplyDatabaseRecoveryRequest {
                session_token: plan.session_token.clone(),
                resolutions: vec![DatabaseRecoveryResolution::AttachMilestoneGroup {
                    group_token,
                    media_uid: expected_uid.clone(),
                }],
                local_storage: "{\"theme\":\"dark\"}".to_string(),
            },
        )
        .unwrap();

        assert_eq!(
            db::get_bundle_schema_version(&applied.connection).unwrap(),
            6
        );
        let repaired: (String, String) = applied
            .connection
            .query_row(
                "SELECT media_uid, media_title FROM main.milestones",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(repaired, (expected_uid, "Renamed Title".to_string()));
        assert!(Path::new(&applied.result.safety_backup_path).exists());
    }

    #[test]
    fn create_and_discard_actions_apply_to_whole_groups() {
        let create_directory = TempDir::new().unwrap();
        create_broken_database(&create_directory, "Renamed Title", "Old Title");
        let DatabaseOpenOutcome::RecoveryRequired(create_plan) =
            open_database(create_directory.path().to_path_buf(), None).unwrap()
        else {
            panic!("broken title should require recovery");
        };
        let create_token = only_group(&create_plan).group_token.clone();
        let created = apply_database_recovery(
            create_directory.path(),
            &create_plan,
            ApplyDatabaseRecoveryRequest {
                session_token: create_plan.session_token.clone(),
                resolutions: vec![DatabaseRecoveryResolution::CreateMediaForMilestoneGroup {
                    group_token: create_token,
                    variant: "Recovered".to_string(),
                }],
                local_storage: "{}".to_string(),
            },
        )
        .unwrap();
        let created_parent: (String, String) = created
            .connection
            .query_row(
                "SELECT media.title, media.variant
                 FROM main.milestones milestone
                 JOIN shared.media media ON media.uid = milestone.media_uid",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(
            created_parent,
            ("Old Title".to_string(), "Recovered".to_string())
        );

        let discard_directory = TempDir::new().unwrap();
        create_broken_database(&discard_directory, "Renamed Title", "Old Title");
        let DatabaseOpenOutcome::RecoveryRequired(discard_plan) =
            open_database(discard_directory.path().to_path_buf(), None).unwrap()
        else {
            panic!("broken title should require recovery");
        };
        let discard_token = only_group(&discard_plan).group_token.clone();
        let discarded = apply_database_recovery(
            discard_directory.path(),
            &discard_plan,
            ApplyDatabaseRecoveryRequest {
                session_token: discard_plan.session_token.clone(),
                resolutions: vec![DatabaseRecoveryResolution::DiscardMilestoneGroup {
                    group_token: discard_token,
                }],
                local_storage: "{}".to_string(),
            },
        )
        .unwrap();
        let milestone_count: i64 = discarded
            .connection
            .query_row("SELECT COUNT(*) FROM main.milestones", [], |row| row.get(0))
            .unwrap();
        assert_eq!(milestone_count, 0);
        assert_eq!(
            db::get_bundle_schema_version(&discarded.connection).unwrap(),
            6
        );
    }
}
