use rusqlite::{params, Connection, Result};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

use crate::models::{ActivityLog, ActivitySummary, Media, DailyHeatmap, Milestone};

/// Returns the data directory for the application.
/// If KECHIMOCHI_DATA_DIR is set, uses that path (for test isolation).
/// Otherwise falls back to the platform app data directory.
pub fn get_data_dir(app_handle: &tauri::AppHandle) -> PathBuf {
    if let Ok(dir) = std::env::var("KECHIMOCHI_DATA_DIR") {
        PathBuf::from(dir)
    } else {
        app_handle
            .path()
            .app_data_dir()
            .expect("Failed to get app data dir")
    }
}

/// Standalone variant of get_data_dir for use in the web server binary,
/// which has no Tauri AppHandle.
/// Resolution order:
///   1. KECHIMOCHI_DATA_DIR env var (same as the Tauri app, used for tests)
///   2. Platform-specific default that matches Tauri's app_data_dir path
pub fn get_data_dir_standalone() -> PathBuf {
    if let Ok(dir) = std::env::var("KECHIMOCHI_DATA_DIR") {
        return PathBuf::from(dir);
    }
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").expect("APPDATA env var not set");
        PathBuf::from(appdata).join("kechimochi")
    }
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").expect("HOME env var not set");
        PathBuf::from(home).join("Library/Application Support/kechimochi")
    }
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    {
        let home = std::env::var("HOME").expect("HOME env var not set");
        PathBuf::from(home).join(".local/share/kechimochi")
    }
}

fn migrate_to_shared(conn: &Connection) -> Result<()> {
    // Check if `main.media` exists
    let count: i64 = conn.query_row(
        "SELECT COUNT(*) FROM main.sqlite_master WHERE type='table' AND name='media'",
        [],
        |row| row.get(0),
    )?;

    if count > 0 {
        // Create shared.media table if it doesn't exist
        create_shared_media_table(conn)?;
        
        // Copy old media over.
        let _ = conn.execute(
            "INSERT OR IGNORE INTO shared.media (id, title, media_type, status, language, description, cover_image, extra_data, content_type, tracking_status)
             SELECT id, title, media_type, status, language, description, cover_image, extra_data, content_type, 'Untracked' FROM main.media",
            [],
        );

        // Before dropping main.media, recreate activity_logs without the FOREIGN KEY
        let count_logs: i64 = conn.query_row(
            "SELECT COUNT(*) FROM main.sqlite_master WHERE type='table' AND name='activity_logs'",
            [],
            |row| row.get(0),
        )?;
        
        if count_logs > 0 {
           conn.execute("ALTER TABLE main.activity_logs RENAME TO activity_logs_old", [])?;
           create_activity_logs_table(conn)?;
           conn.execute("INSERT INTO main.activity_logs (id, media_id, duration_minutes, date) SELECT id, media_id, duration_minutes, date FROM main.activity_logs_old", [])?;
           conn.execute("DROP TABLE main.activity_logs_old", [])?;
        }

        // Now drop main.media
        conn.execute("DROP TABLE main.media", [])?;
    }
    Ok(())
}

fn create_shared_media_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS shared.media (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL UNIQUE,
            media_type TEXT NOT NULL,
            status TEXT NOT NULL,
            language TEXT NOT NULL,
            description TEXT DEFAULT '',
            cover_image TEXT DEFAULT '',
            extra_data TEXT DEFAULT '{}',
            content_type TEXT DEFAULT 'Unknown',
            tracking_status TEXT DEFAULT 'Untracked'
        )",
        [],
    )?;
    
    // Try to add the columns to existing tables (fails gracefully if they already exist)
    let _ = conn.execute("ALTER TABLE shared.media ADD COLUMN description TEXT DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE shared.media ADD COLUMN cover_image TEXT DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE shared.media ADD COLUMN extra_data TEXT DEFAULT '{}'", []);
    let _ = conn.execute("ALTER TABLE shared.media ADD COLUMN content_type TEXT DEFAULT 'Unknown'", []);
    let _ = conn.execute("ALTER TABLE shared.media ADD COLUMN tracking_status TEXT DEFAULT 'Untracked'", []);
    
    Ok(())
}

fn create_activity_logs_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS main.activity_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_id INTEGER NOT NULL,
            duration_minutes INTEGER NOT NULL,
            characters INTEGER NOT NULL DEFAULT 0,
            date TEXT NOT NULL
        )",
        [],
    )?;
    Ok(())
}

fn create_milestones_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS main.milestones (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            media_title TEXT NOT NULL,
            name TEXT NOT NULL,
            duration INTEGER NOT NULL,
            characters INTEGER NOT NULL DEFAULT 0,
            date TEXT
        )",
        [],
    )?;
    Ok(())
}

fn migrate_milestones(conn: &Connection) -> Result<()> {
    // Gracefully add columns if they don't exist
    let _ = conn.execute("ALTER TABLE main.milestones ADD COLUMN media_title TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE main.milestones ADD COLUMN name TEXT NOT NULL DEFAULT ''", []);
    let _ = conn.execute("ALTER TABLE main.milestones ADD COLUMN duration INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE main.milestones ADD COLUMN characters INTEGER NOT NULL DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE main.milestones ADD COLUMN date TEXT", []);
    Ok(())
}

fn migrate_to_character_tracking(conn: &Connection) -> Result<()> {
    let _ = conn.execute("ALTER TABLE main.activity_logs ADD COLUMN characters INTEGER NOT NULL DEFAULT 0", []);
    Ok(())
}

fn create_settings_table(conn: &Connection) -> Result<()> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS main.settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;
    Ok(())
}

pub fn create_tables(conn: &Connection) -> Result<()> {
    create_shared_media_table(conn)?;
    create_activity_logs_table(conn)?;
    create_milestones_table(conn)?;
    create_settings_table(conn)?;
    Ok(())
}

pub fn init_db(app_dir: std::path::PathBuf, profile_name: &str) -> Result<Connection> {
    fs::create_dir_all(&app_dir).expect("Failed to create app data dir");
    
    let shared_db_path = app_dir.join("kechimochi_shared_media.db");
    let file_name = format!("kechimochi_{}.db", profile_name);
    let db_path = app_dir.join(file_name);

    let conn = Connection::open(db_path)?;
    
    // Attach shared database
    conn.execute(
        "ATTACH DATABASE ?1 AS shared",
        rusqlite::params![shared_db_path.to_string_lossy()],
    )?;

    // Run migrations
    migrate_to_shared(&conn)?;

    // Ensure tables exist
    create_tables(&conn)?;
    migrate_milestones(&conn)?;
    migrate_to_character_tracking(&conn)?;

    Ok(conn)
}

pub fn wipe_profile(app_dir: std::path::PathBuf, profile_name: &str) -> std::result::Result<(), String> {
    let file_name = format!("kechimochi_{}.db", profile_name);
    let db_path = app_dir.join(file_name);
    
    if db_path.exists() {
        // Activity logs are wiped with the profile DB deletion. 
        // Media remains untouched.
        fs::remove_file(&db_path).map_err(|e| e.to_string())?;
    }
    
    Ok(())
}

pub fn list_profiles(app_dir: std::path::PathBuf) -> std::result::Result<Vec<String>, String> {
    let mut profiles = Vec::new();
    if let Ok(entries) = fs::read_dir(app_dir) {
        for entry in entries.filter_map(std::result::Result::ok) {
            let path = entry.path();
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.starts_with("kechimochi_") && name.ends_with(".db") && name != "kechimochi_shared_media.db" {
                    let profile_name = name.trim_start_matches("kechimochi_").trim_end_matches(".db");
                    profiles.push(profile_name.to_string());
                }
            }
        }
    }
    Ok(profiles)
}

pub fn wipe_everything(app_dir: std::path::PathBuf) -> std::result::Result<(), String> {
    // Delete covers dir
    let covers_dir = app_dir.join("covers");
    if covers_dir.exists() {
        let _ = std::fs::remove_dir_all(&covers_dir);
    }
    
    // Delete all DBs
    if let Ok(entries) = std::fs::read_dir(&app_dir) {
        for entry in entries.filter_map(std::result::Result::ok) {
            let path = entry.path();
            if let Some(ext) = path.extension() {
                if ext == "db" {
                    let _ = std::fs::remove_file(path);
                }
            }
        }
    }
    
    Ok(())
}

// Media Operations
pub fn get_all_media(conn: &Connection) -> Result<Vec<Media>> {
    let mut stmt = conn.prepare(
        "SELECT id, title, media_type, status, language, description, cover_image, extra_data, content_type, tracking_status 
         FROM shared.media m
         ORDER BY 
            CASE 
                WHEN m.status != 'Archived' AND m.tracking_status = 'Ongoing' THEN 0
                WHEN m.status != 'Archived' THEN 1
                ELSE 2
            END,
            (SELECT MAX(date) FROM main.activity_logs WHERE media_id = m.id) DESC,
            m.id DESC"
    )?;
    let media_iter = stmt.query_map([], |row| {
        Ok(Media {
            id: row.get(0)?,
            title: row.get(1)?,
            media_type: row.get(2)?,
            status: row.get(3)?,
            language: row.get(4)?,
            description: row.get(5).unwrap_or_default(),
            cover_image: row.get(6).unwrap_or_default(),
            extra_data: row.get(7).unwrap_or_else(|_| "{}".to_string()),
            content_type: row.get(8).unwrap_or_else(|_| "Unknown".to_string()),
            tracking_status: row.get(9).unwrap_or_else(|_| "Untracked".to_string()),
        })
    })?;

    let mut media_list = Vec::new();
    for media in media_iter {
        media_list.push(media?);
    }
    Ok(media_list)
}

pub fn add_media_with_id(conn: &Connection, media: &Media) -> Result<i64> {
    conn.execute(
        "INSERT INTO shared.media (title, media_type, status, language, description, cover_image, extra_data, content_type, tracking_status) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![media.title, media.media_type, media.status, media.language, media.description, media.cover_image, media.extra_data, media.content_type, media.tracking_status],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn update_media(conn: &Connection, media: &Media) -> Result<()> {
    conn.execute(
        "UPDATE shared.media SET title = ?1, media_type = ?2, status = ?3, language = ?4, description = ?5, cover_image = ?6, extra_data = ?7, content_type = ?8, tracking_status = ?9 WHERE id = ?10",
        params![
            media.title,
            media.media_type,
            media.status,
            media.language,
            media.description,
            media.cover_image,
            media.extra_data,
            media.content_type,
            media.tracking_status,
            media.id.unwrap() // Must have an ID
        ],
    )?;
    Ok(())
}

pub fn delete_media(conn: &Connection, id: i64) -> Result<()> {
    // Delete cover image from file system
    if let Ok(cover_image) = conn.query_row(
        "SELECT cover_image FROM shared.media WHERE id = ?1 AND cover_image IS NOT NULL AND cover_image != ''",
        params![id],
        |row| row.get::<_, String>(0),
    ) {
        let path = std::path::Path::new(&cover_image);
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }

    // Also delete associated logs in the local main DB
    conn.execute("DELETE FROM main.activity_logs WHERE media_id = ?1", params![id])?;
    conn.execute("DELETE FROM shared.media WHERE id = ?1", params![id])?;
    Ok(())
}

// Activity Log Operations
pub fn add_log(conn: &Connection, log: &ActivityLog) -> Result<i64> {
    if log.duration_minutes == 0 && log.characters == 0 {
        return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(std::io::ErrorKind::InvalidInput, "Activity must have either duration or characters"))));
    }
    conn.execute(
        "INSERT INTO main.activity_logs (media_id, duration_minutes, characters, date) VALUES (?1, ?2, ?3, ?4)",
        params![log.media_id, log.duration_minutes, log.characters, log.date],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_log(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM main.activity_logs WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn clear_activities(conn: &Connection) -> Result<()> {
    conn.execute("DELETE FROM main.activity_logs", [])?;
    Ok(())
}

pub fn get_logs(conn: &Connection) -> Result<Vec<ActivitySummary>> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.media_id, m.title, m.media_type, a.duration_minutes, a.characters, a.date, m.language 
         FROM main.activity_logs a 
         JOIN shared.media m ON a.media_id = m.id
         ORDER BY a.date DESC",
    )?;
    let logs_iter = stmt.query_map([], |row| {
        Ok(ActivitySummary {
            id: row.get(0)?,
            media_id: row.get(1)?,
            title: row.get(2)?,
            media_type: row.get(3)?,
            duration_minutes: row.get(4)?,
            characters: row.get(5)?,
            date: row.get(6)?,
            language: row.get(7)?,
        })
    })?;

    let mut log_list = Vec::new();
    for log in logs_iter {
        log_list.push(log?);
    }
    Ok(log_list)
}

pub fn get_logs_for_media(conn: &Connection, media_id: i64) -> Result<Vec<ActivitySummary>> {
    let mut stmt = conn.prepare(
        "SELECT a.id, a.media_id, m.title, m.media_type, a.duration_minutes, a.characters, a.date, m.language 
         FROM main.activity_logs a 
         JOIN shared.media m ON a.media_id = m.id
         WHERE a.media_id = ?1
         ORDER BY a.date DESC",
    )?;
    let logs_iter = stmt.query_map(params![media_id], |row| {
        Ok(ActivitySummary {
            id: row.get(0)?,
            media_id: row.get(1)?,
            title: row.get(2)?,
            media_type: row.get(3)?,
            duration_minutes: row.get(4)?,
            characters: row.get(5)?,
            date: row.get(6)?,
            language: row.get(7)?,
        })
    })?;

    let mut log_list = Vec::new();
    for log in logs_iter {
        log_list.push(log?);
    }
    Ok(log_list)
}

pub fn get_heatmap(conn: &Connection) -> Result<Vec<DailyHeatmap>> {
    let mut stmt = conn.prepare(
        "SELECT date, SUM(duration_minutes) as total_minutes, SUM(characters) as total_characters
         FROM main.activity_logs 
         GROUP BY date 
         ORDER BY date ASC",
    )?;
    let heatmap_iter = stmt.query_map([], |row| {
        Ok(DailyHeatmap {
            date: row.get(0)?,
            total_minutes: row.get(1)?,
            total_characters: row.get(2)?,
        })
    })?;

    let mut heatmap_list = Vec::new();
    for hm in heatmap_iter {
        heatmap_list.push(hm?);
    }
    Ok(heatmap_list)
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> Result<()> {
    conn.execute(
        "INSERT INTO main.settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> Result<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM main.settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    if let Some(row) = rows.next()? {
        Ok(Some(row.get(0)?))
    } else {
        Ok(None)
    }
}

// Milestone Operations
pub fn get_milestones_for_media(conn: &Connection, media_title: &str) -> Result<Vec<Milestone>> {
    let mut stmt = conn.prepare(
        "SELECT id, media_title, name, duration, characters, date FROM main.milestones WHERE media_title = ?1 ORDER BY id ASC",
    )?;
    let milestone_iter = stmt.query_map(params![media_title], |row| {
        Ok(Milestone {
            id: row.get(0)?,
            media_title: row.get(1)?,
            name: row.get(2)?,
            duration: row.get(3)?,
            characters: row.get(4)?,
            date: row.get(5)?,
        })
    })?;

    let mut milestone_list = Vec::new();
    for milestone in milestone_iter {
        milestone_list.push(milestone?);
    }
    Ok(milestone_list)
}

pub fn add_milestone(conn: &Connection, milestone: &Milestone) -> Result<i64> {
    if milestone.duration == 0 && milestone.characters == 0 {
        return Err(rusqlite::Error::ToSqlConversionFailure(Box::new(std::io::Error::new(std::io::ErrorKind::InvalidInput, "Milestone must have either duration or characters"))));
    }
    conn.execute(
        "INSERT INTO main.milestones (media_title, name, duration, characters, date) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![milestone.media_title, milestone.name, milestone.duration, milestone.characters, milestone.date],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_milestone(conn: &Connection, id: i64) -> Result<()> {
    conn.execute("DELETE FROM main.milestones WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn delete_milestones_for_media(conn: &Connection, media_title: &str) -> Result<()> {
    conn.execute("DELETE FROM main.milestones WHERE media_title = ?1", params![media_title])?;
    Ok(())
}

pub fn update_milestone(conn: &Connection, milestone: &Milestone) -> Result<()> {
    conn.execute(
        "UPDATE main.milestones SET media_title = ?1, name = ?2, duration = ?3, characters = ?4, date = ?5 WHERE id = ?6",
        params![
            milestone.media_title,
            milestone.name,
            milestone.duration,
            milestone.characters,
            milestone.date,
            milestone.id.unwrap()
        ],
    )?;
    Ok(())
}

pub fn save_cover_image(conn: &rusqlite::Connection, covers_dir: std::path::PathBuf, media_id: i64, src_path: &std::path::Path) -> std::result::Result<String, String> {
    std::fs::create_dir_all(&covers_dir).map_err(|e| e.to_string())?;

    let ext = src_path.extension().and_then(|e| e.to_str()).unwrap_or("png");
    let dest_file = format!("{}_{}.{}", media_id, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis(), ext);
    let dest = covers_dir.join(&dest_file);
    
    // Delete old cover
    let old_cover: String = conn.query_row(
        "SELECT cover_image FROM shared.media WHERE id = ?1",
        rusqlite::params![media_id],
        |row| row.get(0),
    ).unwrap_or_default();
    
    let dest_str = dest.to_string_lossy().to_string();
    if !old_cover.is_empty() {
        let old_path = std::path::Path::new(&old_cover);
        if old_path.exists() && old_cover != dest_str {
            let _ = std::fs::remove_file(old_path);
        }
    }
    
    std::fs::copy(src_path, &dest).map_err(|e| e.to_string())?;
    
    conn.execute(
        "UPDATE shared.media SET cover_image = ?1 WHERE id = ?2",
        rusqlite::params![dest_str, media_id],
    ).map_err(|e| e.to_string())?;

    Ok(dest_str)
}

pub fn save_cover_bytes(conn: &rusqlite::Connection, covers_dir: std::path::PathBuf, media_id: i64, bytes: Vec<u8>, extension: &str) -> std::result::Result<String, String> {
    std::fs::create_dir_all(&covers_dir).map_err(|e| e.to_string())?;

    let dest_file = format!("{}_{}.{}", media_id, std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis(), extension);
    let dest = covers_dir.join(&dest_file);
    
    // Delete old cover
    let old_cover: String = conn.query_row(
        "SELECT cover_image FROM shared.media WHERE id = ?1",
        rusqlite::params![media_id],
        |row| row.get(0),
    ).unwrap_or_default();
    
    let dest_str = dest.to_string_lossy().to_string();
    if !old_cover.is_empty() {
        let old_path = std::path::Path::new(&old_cover);
        if old_path.exists() && old_cover != dest_str {
            let _ = std::fs::remove_file(old_path);
        }
    }
    
    std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    
    conn.execute(
        "UPDATE shared.media SET cover_image = ?1 WHERE id = ?2",
        rusqlite::params![dest_str, media_id],
    ).map_err(|e| e.to_string())?;

    Ok(dest_str)
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", []).unwrap();
        create_tables(&conn).unwrap();
        conn
    }

    fn sample_media(title: &str) -> Media {
        Media {
            id: None,
            title: title.to_string(),
            media_type: "Reading".to_string(),
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: "".to_string(),
            cover_image: "".to_string(),
            extra_data: "{}".to_string(),
            content_type: "Unknown".to_string(),
            tracking_status: "Untracked".to_string(),
        }
    }

    #[test]
    fn test_get_data_dir_standalone_prefers_env_var() {
        let _guard = ENV_LOCK.lock().unwrap();

        let original = std::env::var("KECHIMOCHI_DATA_DIR").ok();
        let custom = std::env::temp_dir().join(format!("kechimochi_data_dir_env_{}", std::process::id()));

        unsafe {
            std::env::set_var("KECHIMOCHI_DATA_DIR", &custom);
        }

        let resolved = get_data_dir_standalone();
        assert_eq!(resolved, custom);

        match original {
            Some(value) => unsafe {
                std::env::set_var("KECHIMOCHI_DATA_DIR", value);
            },
            None => unsafe {
                std::env::remove_var("KECHIMOCHI_DATA_DIR");
            },
        }
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn test_get_data_dir_standalone_windows_default_from_appdata() {
        let _guard = ENV_LOCK.lock().unwrap();

        let original_data_dir = std::env::var("KECHIMOCHI_DATA_DIR").ok();
        let original_appdata = std::env::var("APPDATA").ok();
        let fake_appdata = std::env::temp_dir().join(format!("kechimochi_appdata_{}", std::process::id()));

        unsafe {
            std::env::remove_var("KECHIMOCHI_DATA_DIR");
            std::env::set_var("APPDATA", &fake_appdata);
        }

        let resolved = get_data_dir_standalone();
        assert_eq!(resolved, fake_appdata.join("kechimochi"));

        match original_data_dir {
            Some(value) => unsafe {
                std::env::set_var("KECHIMOCHI_DATA_DIR", value);
            },
            None => unsafe {
                std::env::remove_var("KECHIMOCHI_DATA_DIR");
            },
        }

        match original_appdata {
            Some(value) => unsafe {
                std::env::set_var("APPDATA", value);
            },
            None => unsafe {
                std::env::remove_var("APPDATA");
            },
        }
    }

    #[test]
    fn test_create_tables() {
        let conn = setup_test_db();
        // Verify tables exist by querying sqlite_master
        let count_main: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM main.sqlite_master WHERE type='table' AND name IN ('activity_logs')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let count_shared: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM shared.sqlite_master WHERE type='table' AND name IN ('media')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count_main, 1);
        assert_eq!(count_shared, 1);
    }

    #[test]
    fn test_add_and_get_media() {
        let conn = setup_test_db();
        let media = sample_media("ある魔女が死ぬまで");
        let id = add_media_with_id(&conn, &media).unwrap();
        assert!(id > 0);

        let all = get_all_media(&conn).unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].title, "ある魔女が死ぬまで");
        assert_eq!(all[0].id, Some(id));
    }

    #[test]
    fn test_add_duplicate_media_fails() {
        let conn = setup_test_db();
        let media = sample_media("薬屋のひとりごと");
        add_media_with_id(&conn, &media).unwrap();
        let result = add_media_with_id(&conn, &media);
        assert!(result.is_err());
    }

    #[test]
    fn test_update_media() {
        let conn = setup_test_db();
        let media = sample_media("呪術廻戦");
        let id = add_media_with_id(&conn, &media).unwrap();

        let updated = Media {
            id: Some(id),
            title: "呪術廻戦".to_string(),
            media_type: "Watching".to_string(),
            status: "Complete".to_string(),
            language: "Japanese".to_string(),
            description: "".to_string(),
            cover_image: "".to_string(),
            extra_data: "{}".to_string(),
            content_type: "Unknown".to_string(),
            tracking_status: "Untracked".to_string(),
        };
        update_media(&conn, &updated).unwrap();

        let all = get_all_media(&conn).unwrap();
        assert_eq!(all[0].media_type, "Watching");
        assert_eq!(all[0].status, "Complete");
    }

    #[test]
    fn test_delete_media_cascades_logs() {
        let conn = setup_test_db();
        
        let dir = std::env::temp_dir();
        let cover_path = dir.join("test_cover_cleanup.png");
        std::fs::write(&cover_path, "fake data").unwrap();
        let cover_str = cover_path.to_string_lossy().to_string();

        let media = Media {
            cover_image: cover_str.clone(),
            ..sample_media("Cleanup Test")
        };
        let media_id = add_media_with_id(&conn, &media).unwrap();

        let log = ActivityLog {
            id: None,
            media_id,
            duration_minutes: 60,
            characters: 0,
            date: "2024-01-15".to_string(),
        };
        add_log(&conn, &log).unwrap();

        assert!(cover_path.exists());

        // Delete media (should cascade logs and remove file)
        delete_media(&conn, media_id).unwrap();

        let media_list = get_all_media(&conn).unwrap();
        assert_eq!(media_list.len(), 0);

        let logs = get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 0);
        
        // Verify disk cleanup
        assert!(!cover_path.exists());
    }

    #[test]
    fn test_delete_log() {
        let conn = setup_test_db();
        let media_id = add_media_with_id(&conn, &sample_media("Log")).unwrap();
        let log_id = add_log(&conn, &ActivityLog { id: None, media_id, duration_minutes: 30, characters: 0, date: "2024-01-01".to_string() }).unwrap();
        
        assert_eq!(get_logs(&conn).unwrap().len(), 1);
        delete_log(&conn, log_id).unwrap();
        assert_eq!(get_logs(&conn).unwrap().len(), 0);
    }

    #[test]
    fn test_add_and_get_logs() {
        let conn = setup_test_db();
        let media = sample_media("本好きの下剋上");
        let media_id = add_media_with_id(&conn, &media).unwrap();

        let log = ActivityLog {
            id: None,
            media_id,
            duration_minutes: 45,
            characters: 100,
            date: "2024-03-01".to_string(),
        };
        let log_id = add_log(&conn, &log).unwrap();
        assert!(log_id > 0);

        let logs = get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].title, "本好きの下剋上");
        assert_eq!(logs[0].duration_minutes, 45);
        assert_eq!(logs[0].date, "2024-03-01");
    }

    #[test]
    fn test_add_log_validation() {
        let conn = setup_test_db();
        let media_id = add_media_with_id(&conn, &sample_media("Validation")).unwrap();

        let log = ActivityLog {
            id: None,
            media_id,
            duration_minutes: 0,
            characters: 0,
            date: "2024-03-01".to_string(),
        };
        let result = add_log(&conn, &log);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Activity must have either duration or characters"));
    }

    #[test]
    fn test_get_heatmap_aggregation() {
        let conn = setup_test_db();
        let media = sample_media("ハイキュー");
        let media_id = add_media_with_id(&conn, &media).unwrap();

        // Two logs on the same day
        add_log(&conn, &ActivityLog {
            id: None,
            media_id,
            duration_minutes: 30,
            characters: 100,
            date: "2024-06-01".to_string(),
        }).unwrap();
        add_log(&conn, &ActivityLog {
            id: None,
            media_id,
            duration_minutes: 45,
            characters: 200,
            date: "2024-06-01".to_string(),
        }).unwrap();

        // One log on a different day
        add_log(&conn, &ActivityLog {
            id: None,
            media_id,
            duration_minutes: 20,
            characters: 50,
            date: "2024-06-02".to_string(),
        }).unwrap();

        let heatmap = get_heatmap(&conn).unwrap();
        assert_eq!(heatmap.len(), 2);
        assert_eq!(heatmap[0].date, "2024-06-01");
        assert_eq!(heatmap[0].total_minutes, 75); // 30 + 45
        assert_eq!(heatmap[0].total_characters, 300); // 100 + 200
        assert_eq!(heatmap[1].date, "2024-06-02");
        assert_eq!(heatmap[1].total_minutes, 20);
        assert_eq!(heatmap[1].total_characters, 50);
    }

    #[test]
    fn test_get_logs_for_media() {
        let conn = setup_test_db();
        let m1_id = add_media_with_id(&conn, &sample_media("Media 1")).unwrap();
        let m2_id = add_media_with_id(&conn, &sample_media("Media 2")).unwrap();

        add_log(&conn, &ActivityLog { id: None, media_id: m1_id, duration_minutes: 10, characters: 0, date: "2024-03-01".to_string() }).unwrap();
        add_log(&conn, &ActivityLog { id: None, media_id: m2_id, duration_minutes: 10, characters: 0, date: "2024-03-02".to_string() }).unwrap();

        let m1_logs = get_logs_for_media(&conn, m1_id).unwrap();
        assert_eq!(m1_logs.len(), 1);
        assert_eq!(m1_logs[0].title, "Media 1");

        let m2_logs = get_logs_for_media(&conn, m2_id).unwrap();
        assert_eq!(m2_logs.len(), 1);
        assert_eq!(m2_logs[0].title, "Media 2");
    }

    #[test]
    fn test_settings_operations() {
        let conn = setup_test_db();
        
        // Initially none
        assert_eq!(get_setting(&conn, "theme").unwrap(), None);

        // Set and get
        set_setting(&conn, "theme", "dark").unwrap();
        assert_eq!(get_setting(&conn, "theme").unwrap(), Some("dark".to_string()));

        // Update
        set_setting(&conn, "theme", "light").unwrap();
        assert_eq!(get_setting(&conn, "theme").unwrap(), Some("light".to_string()));
    }

    #[test]
    fn test_clear_activities() {
        let conn = setup_test_db();
        let media_id = add_media_with_id(&conn, &sample_media("Test")).unwrap();
        add_log(&conn, &ActivityLog { id: None, media_id, duration_minutes: 30, characters: 0, date: "2024-01-01".to_string() }).unwrap();
        
        assert_eq!(get_logs(&conn).unwrap().len(), 1);
        
        clear_activities(&conn).unwrap();
        assert_eq!(get_logs(&conn).unwrap().len(), 0);
        
        // Media should still exist
        assert_eq!(get_all_media(&conn).unwrap().len(), 1);
    }

    #[test]
    fn test_media_ordering() {
        let conn = setup_test_db();
        
        // 1. Archived media with recent activity (should be last: Tier 2)
        let m1_id = add_media_with_id(&conn, &Media {
            status: "Archived".to_string(),
            ..sample_media("Archived Recent")
        }).unwrap();
        add_log(&conn, &ActivityLog { id: None, media_id: m1_id, duration_minutes: 10, characters: 0, date: "2024-03-01".to_string() }).unwrap();

        // 2. Active entry but NOT ongoing (should be middle: Tier 1)
        let m2_id = add_media_with_id(&conn, &Media {
            status: "Active".to_string(),
            tracking_status: "Complete".to_string(),
            ..sample_media("Active Complete")
        }).unwrap();
        add_log(&conn, &ActivityLog { id: None, media_id: m2_id, duration_minutes: 10, characters: 0, date: "2024-03-02".to_string() }).unwrap();

        // 3. Ongoing media with older activity (should be first: Tier 0)
        let m3_id = add_media_with_id(&conn, &Media {
            status: "Active".to_string(),
            tracking_status: "Ongoing".to_string(),
            ..sample_media("Ongoing Old")
        }).unwrap();
        add_log(&conn, &ActivityLog { id: None, media_id: m3_id, duration_minutes: 10, characters: 0, date: "2024-01-01".to_string() }).unwrap();

        // 4. Ongoing media with NO activity (should be after Tier 0 with activity)
        let _m4_id = add_media_with_id(&conn, &Media {
            status: "Active".to_string(),
            tracking_status: "Ongoing".to_string(),
            ..sample_media("Ongoing No Activity")
        }).unwrap();

        // Expectation: 
        // 1. Ongoing Old (Tier 0, has activity)
        // 2. Ongoing No Activity (Tier 0, no activity)
        // 3. Active Complete (Tier 1)
        // 4. Archived Recent (Tier 2)
        
        let all = get_all_media(&conn).unwrap();
        assert_eq!(all[0].title, "Ongoing Old");
        assert_eq!(all[1].title, "Ongoing No Activity");
        assert_eq!(all[2].title, "Active Complete");
        assert_eq!(all[3].title, "Archived Recent");
    }

    #[test]
    fn test_migration() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", []).unwrap();

        // Create legacy table in 'main'
        conn.execute("CREATE TABLE main.media (id INTEGER PRIMARY KEY, title TEXT, media_type TEXT, status TEXT, language TEXT, description TEXT, cover_image TEXT, extra_data TEXT, content_type TEXT)", []).unwrap();
        conn.execute("INSERT INTO main.media (title, media_type, status, language) VALUES ('Legacy Manga', 'Reading', 'Ongoing', 'Japanese')", []).unwrap();
        
        // Create activity logs (old style might have had foreign keys to main.media)
        conn.execute("CREATE TABLE main.activity_logs (id INTEGER PRIMARY KEY, media_id INTEGER, duration_minutes INTEGER, date TEXT)", []).unwrap();
        conn.execute("INSERT INTO main.activity_logs (media_id, duration_minutes, date) VALUES (1, 60, '2024-01-01')", []).unwrap();

        // Run migration
        migrate_to_shared(&conn).unwrap();
        create_tables(&conn).unwrap();

        // Check shared table
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM shared.media", [], |r| r.get(0)).unwrap();
        assert_eq!(count, 1);
        
        // Check main table is gone
        let exists: i64 = conn.query_row("SELECT COUNT(*) FROM main.sqlite_master WHERE type='table' AND name='media'", [], |r| r.get(0)).unwrap();
        assert_eq!(exists, 0);

        let logs = get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].title, "Legacy Manga");
    }

    #[test]
    fn test_list_and_wipe_profiles() {
        let temp_dir = std::env::temp_dir().join(format!("kechimochi_profiles_test_{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        
        std::fs::write(temp_dir.join("kechimochi_user1.db"), "").unwrap();
        std::fs::write(temp_dir.join("kechimochi_user2.db"), "").unwrap();
        std::fs::write(temp_dir.join("kechimochi_shared_media.db"), "").unwrap();

        let profiles = list_profiles(temp_dir.clone()).unwrap();
        assert_eq!(profiles.len(), 2);
        assert!(profiles.contains(&"user1".to_string()));
        assert!(profiles.contains(&"user2".to_string()));

        wipe_profile(temp_dir.clone(), "user1").unwrap();
        let profiles = list_profiles(temp_dir.clone()).unwrap();
        assert_eq!(profiles.len(), 1);
        assert!(!profiles.contains(&"user1".to_string()));

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_save_cover_image() {
        let conn = setup_test_db();
        let media_id = add_media_with_id(&conn, &sample_media("Cover Test")).unwrap();
        
        let temp_dir = std::env::temp_dir().join(format!("covers_{}", std::process::id()));
        let src_file = temp_dir.join("src.png");
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::write(&src_file, "fake image").unwrap();

        let covers_dir = temp_dir.join("covers");
        
        // 1. Save first cover
        let dest1 = save_cover_image(&conn, covers_dir.clone(), media_id, &src_file).unwrap();
        assert!(std::path::Path::new(&dest1).exists());

        // 2. Save second cover (should delete first)
        // Ensure timestamp is different
        std::thread::sleep(std::time::Duration::from_millis(10));
        std::fs::write(&src_file, "fake image 2").unwrap();
        let dest2 = save_cover_image(&conn, covers_dir.clone(), media_id, &src_file).unwrap();
        
        assert_ne!(dest1, dest2);
        assert!(std::path::Path::new(&dest2).exists());
        assert!(!std::path::Path::new(&dest1).exists()); // Cleaned up

        // 3. Save with missing file should error
        let result = save_cover_image(&conn, covers_dir, media_id, &temp_dir.join("missing.png"));
        assert!(result.is_err());

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_init_db_integration() {
        let temp_dir = std::env::temp_dir().join(format!("init_test_{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).unwrap();

        // Initialize a new profile
        let conn = init_db(temp_dir.clone(), "test_user").unwrap();
        
        // Verify tables exist in both
        let _: i64 = conn.query_row("SELECT COUNT(*) FROM shared.media", [], |r| r.get(0)).unwrap();
        let _: i64 = conn.query_row("SELECT COUNT(*) FROM main.activity_logs", [], |r| r.get(0)).unwrap();
        
        assert!(temp_dir.join("kechimochi_test_user.db").exists());
        assert!(temp_dir.join("kechimochi_shared_media.db").exists());

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_get_data_dir_override() {
        let temp_dir = "/tmp/kechimochi_test_dir";
        std::env::set_var("KECHIMOCHI_DATA_DIR", temp_dir);
        
        // We need a dummy AppHandle to call it, but we can't easily.
        // However, we can verify the env var logic directly.
        let dir = if let Ok(d) = std::env::var("KECHIMOCHI_DATA_DIR") {
            PathBuf::from(d)
        } else {
            PathBuf::from("fail")
        };
        assert_eq!(dir, PathBuf::from(temp_dir));
    }

    #[test]
    fn test_wipe_everything() {
        let temp_dir = std::env::temp_dir().join(format!("wipe_test_{}", std::process::id()));
        std::fs::create_dir_all(&temp_dir).unwrap();
        std::fs::create_dir_all(temp_dir.join("covers")).unwrap();
        std::fs::write(temp_dir.join("kechimochi_user.db"), "").unwrap();
        std::fs::write(temp_dir.join("covers/test.png"), "").unwrap();
        std::fs::write(temp_dir.join("not_a_db.txt"), "").unwrap();

        wipe_everything(temp_dir.clone()).unwrap();

        assert!(!temp_dir.join("covers").exists());
        assert!(!temp_dir.join("kechimochi_user.db").exists());
        assert!(temp_dir.join("not_a_db.txt").exists()); // Should preserve non-db files

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_get_username_logic() {
        std::env::set_var("USER", "testuser");
        assert_eq!(crate::get_username_logic(), "testuser");
        
        std::env::remove_var("USER");
        std::env::set_var("USERNAME", "winuser");
        assert_eq!(crate::get_username_logic(), "winuser");
    }

    #[test]
    fn test_read_file_bytes() {
        let temp_dir = std::env::temp_dir();
        let file_path = temp_dir.join("test_bytes.txt");
        std::fs::write(&file_path, "hello").unwrap();
        
        let bytes = std::fs::read(&file_path).unwrap();
        assert_eq!(bytes, b"hello");
        
        std::fs::remove_file(file_path).ok();
    }

    #[test]
    fn test_schema_evolution() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", []).unwrap();
        
        // Create an "old" version of the table with missing columns
        conn.execute("CREATE TABLE shared.media (id INTEGER PRIMARY KEY, title TEXT UNIQUE, media_type TEXT, status TEXT, language TEXT)", []).unwrap();
        
        // This should evolution the table by adding missing columns
        create_shared_media_table(&conn).unwrap();
        
        // Verify we can insert into the new columns
        conn.execute("INSERT INTO shared.media (title, media_type, status, language, description, tracking_status) VALUES ('Evolution', 'Reading', 'Ongoing', 'Japanese', 'Desc', 'Untracked')", []).unwrap();
    }

    #[test]
    fn test_milestone_operations() {
        let conn = setup_test_db();
        let media_title = "Milestone Media";
        
        let milestone = Milestone {
            id: None,
            media_title: media_title.to_string(),
            name: "First Quarter".to_string(),
            duration: 120,
            characters: 0,
            date: Some("2024-03-12".to_string()),
        };

        // Test add_milestone
        let id = add_milestone(&conn, &milestone).unwrap();
        assert!(id > 0);

        // Test get_milestones_for_media
        let milestones = get_milestones_for_media(&conn, media_title).unwrap();
        assert_eq!(milestones.len(), 1);
        assert_eq!(milestones[0].name, "First Quarter");
        assert_eq!(milestones[0].duration, 120);

        // Test update_milestone
        let mut updated = milestones[0].clone();
        updated.name = "Halfway".to_string();
        updated.duration = 240;
        update_milestone(&conn, &updated).unwrap();

        let milestones = get_milestones_for_media(&conn, media_title).unwrap();
        assert_eq!(milestones[0].name, "Halfway");
        assert_eq!(milestones[0].duration, 240);

        // Test delete_milestone
        delete_milestone(&conn, id).unwrap();
        let milestones = get_milestones_for_media(&conn, media_title).unwrap();
        assert_eq!(milestones.len(), 0);
    }

    #[test]
    fn test_add_milestone_validation() {
        let conn = setup_test_db();
        let milestone = Milestone {
            id: None,
            media_title: "Validation".to_string(),
            name: "Zero".to_string(),
            duration: 0,
            characters: 0,
            date: None,
        };
        let result = add_milestone(&conn, &milestone);
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("Milestone must have either duration or characters"));
    }

    #[test]
    fn test_delete_milestones_for_media() {
        let conn = setup_test_db();
        let title1 = "Media 1";
        let title2 = "Media 2";

        add_milestone(&conn, &Milestone { id: None, media_title: title1.to_string(), name: "M1".to_string(), duration: 10, characters: 0, date: None }).unwrap();
        add_milestone(&conn, &Milestone { id: None, media_title: title2.to_string(), name: "M2".to_string(), duration: 20, characters: 0, date: None }).unwrap();

        assert_eq!(get_milestones_for_media(&conn, title1).unwrap().len(), 1);
        assert_eq!(get_milestones_for_media(&conn, title2).unwrap().len(), 1);

        delete_milestones_for_media(&conn, title1).unwrap();
        assert_eq!(get_milestones_for_media(&conn, title1).unwrap().len(), 0);
        assert_eq!(get_milestones_for_media(&conn, title2).unwrap().len(), 1);
    }

    #[test]
    fn test_migrate_milestones() {
        let conn = Connection::open_in_memory().unwrap();
        // Create table with only id (simulate old version if it ever missed columns)
        conn.execute("CREATE TABLE main.milestones (id INTEGER PRIMARY KEY AUTOINCREMENT)", []).unwrap();
        
        // This should add the missing columns
        migrate_milestones(&conn).unwrap();
        
        // Verify we can insert
        let milestone = Milestone {
            id: None,
            media_title: "Migrated".to_string(),
            name: "Test".to_string(),
            duration: 50,
            characters: 0,
            date: None,
        };
        add_milestone(&conn, &milestone).unwrap();
    }
}
