//! Atomic library reads that avoid shipping the complete activity history to
//! the frontend merely to render list metrics.

use std::collections::HashMap;

use rusqlite::{Connection, Result};

use crate::models::{
    LibraryActivityMetrics, LibrarySettings, LibrarySnapshot, LibrarySnapshotRequest, Media,
};
use crate::read_performance::{Measured, Timings};

const GRID_ZOOM_MIN: i64 = 70;
const GRID_ZOOM_MAX: i64 = 130;
const GRID_ZOOM_STEP: i64 = 10;
const GRID_ZOOM_DEFAULT: i64 = 100;

pub fn get_library_snapshot(
    conn: &Connection,
    request: &LibrarySnapshotRequest,
) -> Result<Measured<LibrarySnapshot>> {
    let mut timings = Timings::default();
    let transaction = timings.query(|| conn.unchecked_transaction())?;
    let settings = query_library_settings(&transaction, &mut timings)?;
    let (media, metrics) = query_library_media(&transaction, &mut timings)?;
    timings.query(|| transaction.commit())?;

    Ok(timings.finish(LibrarySnapshot {
        request_id: request.request_id,
        settings,
        media,
        metrics,
    }))
}

fn query_library_settings(conn: &Connection, timings: &mut Timings) -> Result<LibrarySettings> {
    let values = timings.query(|| {
        let mut statement = conn.prepare(
            "SELECT key, value
             FROM main.settings
             WHERE key IN ('grid_hide_archived', 'library_layout_mode', 'library_grid_zoom',
                           'library_group_by_type', 'library_keep_ongoing_first',
                           'library_keep_archived_last', 'library_sort_stages')",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<HashMap<_, _>>>()
    })?;

    Ok(timings.aggregate(|| {
        let boolean_setting = |key: &str, default: bool| {
            values.get(key).map_or(default, |value| value == "true")
        };
        let preferred_layout = match values.get("library_layout_mode").map(String::as_str) {
            Some("list") => "list",
            _ => "grid",
        }
        .to_string();
        let raw_zoom = values
            .get("library_grid_zoom")
            .and_then(|value| value.parse::<i64>().ok())
            .unwrap_or(GRID_ZOOM_DEFAULT);
        let stepped_zoom = ((raw_zoom + GRID_ZOOM_STEP / 2) / GRID_ZOOM_STEP) * GRID_ZOOM_STEP;
        let grid_zoom = stepped_zoom.clamp(GRID_ZOOM_MIN, GRID_ZOOM_MAX);

        LibrarySettings {
            hide_archived: boolean_setting("grid_hide_archived", false),
            preferred_layout,
            grid_zoom,
            group_by_type: boolean_setting("library_group_by_type", false),
            keep_ongoing_first: boolean_setting("library_keep_ongoing_first", true),
            keep_archived_last: boolean_setting("library_keep_archived_last", true),
            sort_stages: values
                .get("library_sort_stages")
                .cloned()
                .unwrap_or_else(|| "[]".to_string()),
        }
    }))
}

fn query_library_media(
    conn: &Connection,
    timings: &mut Timings,
) -> Result<(Vec<Media>, Vec<LibraryActivityMetrics>)> {
    let rows = timings.query(|| {
        let mut statement = conn.prepare(
            "WITH activity_totals AS (
                 SELECT media_id,
                        MIN(date) AS first_activity_date,
                        MAX(date) AS last_activity_date,
                        COALESCE(SUM(duration_minutes), 0) AS total_minutes,
                        COALESCE(SUM(characters), 0) AS total_characters
                 FROM main.activity_logs
                 GROUP BY media_id
             )
             SELECT m.id, m.uid, m.title, m.default_activity_type, m.status,
                    m.language, m.description, m.cover_image, m.extra_data,
                    m.content_type, m.tracking_status, m.variant,
                    totals.first_activity_date, totals.last_activity_date,
                    totals.total_minutes, totals.total_characters
             FROM shared.media m
             LEFT JOIN activity_totals totals ON totals.media_id = m.id
             ORDER BY
                totals.last_activity_date DESC,
                m.id DESC",
        )?;
        let mapped = statement.query_map([], |row| {
            let media_id = row.get::<_, i64>(0)?;
            Ok((
                Media {
                    id: Some(media_id),
                    uid: row.get(1)?,
                    title: row.get(2)?,
                    default_activity_type: row.get(3)?,
                    status: row.get(4)?,
                    language: row.get(5)?,
                    description: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                    cover_image: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                    extra_data: row
                        .get::<_, Option<String>>(8)?
                        .unwrap_or_else(|| "{}".to_string()),
                    content_type: row
                        .get::<_, Option<String>>(9)?
                        .unwrap_or_else(|| "Unknown".to_string()),
                    tracking_status: row
                        .get::<_, Option<String>>(10)?
                        .unwrap_or_else(|| "Untracked".to_string()),
                    variant: row.get::<_, Option<String>>(11)?.unwrap_or_default(),
                },
                LibraryActivityMetrics {
                    media_id,
                    first_activity_date: row.get(12)?,
                    last_activity_date: row.get(13)?,
                    total_minutes: row.get(14)?,
                    total_characters: row.get(15)?,
                },
            ))
        })?;
        mapped.collect::<Result<Vec<_>>>()
    })?;

    Ok(timings.aggregate(|| rows.into_iter().unzip()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        db,
        models::{ActivityLog, Media},
    };

    fn media(title: &str) -> Media {
        Media {
            id: None,
            uid: None,
            title: title.to_string(),
            variant: String::new(),
            default_activity_type: "Reading".to_string(),
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: format!("Description for {title}"),
            cover_image: String::new(),
            extra_data: "{}".to_string(),
            content_type: "Novel".to_string(),
            tracking_status: "Ongoing".to_string(),
        }
    }

    #[test]
    fn snapshot_combines_media_metrics_and_settings_atomically() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("library-test")).unwrap();
        let media_id = db::add_media_with_id(&conn, &media("A")).unwrap();
        for (date, minutes, characters) in [("2026-02-03", 20, 1_500), ("2026-01-01", 10, 700)] {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: minutes,
                    characters,
                    date: date.to_string(),
                    activity_type: "Reading".to_string(),
                    notes: "large notes must not enter library metrics".to_string(),
                },
            )
            .unwrap();
        }
        db::set_setting(&conn, "grid_hide_archived", "true").unwrap();
        db::set_setting(&conn, "library_layout_mode", "list").unwrap();
        db::set_setting(&conn, "library_grid_zoom", "123").unwrap();

        let snapshot = get_library_snapshot(&conn, &LibrarySnapshotRequest { request_id: 17 })
            .unwrap()
            .value;

        assert_eq!(snapshot.request_id, 17);
        assert_eq!(snapshot.media.len(), 1);
        assert_eq!(snapshot.settings.preferred_layout, "list");
        assert!(snapshot.settings.hide_archived);
        assert_eq!(snapshot.settings.grid_zoom, 120);
        assert_eq!(
            snapshot.metrics[0].first_activity_date.as_deref(),
            Some("2026-01-01")
        );
        assert_eq!(
            snapshot.metrics[0].last_activity_date.as_deref(),
            Some("2026-02-03")
        );
        assert_eq!(snapshot.metrics[0].total_minutes, Some(30));
        assert_eq!(snapshot.metrics[0].total_characters, Some(2_200));
        assert!(!serde_json::to_string(&snapshot.metrics)
            .unwrap()
            .contains("large notes"));
    }

    fn snapshot_of(conn: &Connection) -> LibrarySnapshot {
        get_library_snapshot(conn, &LibrarySnapshotRequest { request_id: 1 })
            .unwrap()
            .value
    }

    fn log_on(conn: &Connection, media_id: i64, date: &str, minutes: i64, characters: i64) {
        db::add_log(
            conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: minutes,
                characters,
                date: date.to_string(),
                activity_type: "Reading".to_string(),
                notes: String::new(),
            },
        )
        .unwrap();
    }

    #[test]
    fn media_without_logs_reports_no_totals_rather_than_zero() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("library-test")).unwrap();
        let logged_id = db::add_media_with_id(&conn, &media("Logged")).unwrap();
        let never_logged_id = db::add_media_with_id(&conn, &media("Never logged")).unwrap();
        log_on(&conn, logged_id, "2026-01-01", 0, 500);

        let snapshot = snapshot_of(&conn);
        let metrics_for = |media_id: i64| {
            snapshot
                .metrics
                .iter()
                .find(|row| row.media_id == media_id)
                .unwrap()
        };

        let logged = metrics_for(logged_id);
        assert_eq!(logged.total_minutes, Some(0));
        assert_eq!(logged.total_characters, Some(500));
        assert_eq!(logged.first_activity_date.as_deref(), Some("2026-01-01"));

        let never_logged = metrics_for(never_logged_id);
        assert_eq!(never_logged.total_minutes, None);
        assert_eq!(never_logged.total_characters, None);
        assert_eq!(never_logged.first_activity_date, None);
        assert_eq!(never_logged.last_activity_date, None);
    }

    #[test]
    fn media_is_ordered_by_recency_alone() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("library-test")).unwrap();

        let mut archived = media("Archived but recent");
        archived.status = "Archived".to_string();
        archived.tracking_status = "Complete".to_string();
        let archived_id = db::add_media_with_id(&conn, &archived).unwrap();

        let ongoing_id = db::add_media_with_id(&conn, &media("Ongoing but stale")).unwrap();

        log_on(&conn, archived_id, "2026-05-01", 10, 0);
        log_on(&conn, ongoing_id, "2026-01-01", 10, 0);

        let ordered_ids: Vec<i64> = snapshot_of(&conn)
            .media
            .iter()
            .filter_map(|row| row.id)
            .collect();
        assert_eq!(ordered_ids, vec![archived_id, ongoing_id]);
    }

    #[test]
    fn sort_settings_fall_back_to_defaults_when_unset() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("library-test")).unwrap();

        let settings = snapshot_of(&conn).settings;
        assert!(!settings.group_by_type);
        assert!(settings.keep_ongoing_first);
        assert!(settings.keep_archived_last);
        assert_eq!(settings.sort_stages, "[]");
    }

    #[test]
    fn sort_settings_are_read_from_storage() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("library-test")).unwrap();
        let stored_stages = r#"[{"field":{"kind":"builtin","key":"title"},"direction":"asc"}]"#;
        db::set_setting(&conn, "library_group_by_type", "true").unwrap();
        db::set_setting(&conn, "library_keep_ongoing_first", "false").unwrap();
        db::set_setting(&conn, "library_keep_archived_last", "false").unwrap();
        db::set_setting(&conn, "library_sort_stages", stored_stages).unwrap();

        let settings = snapshot_of(&conn).settings;
        assert!(settings.group_by_type);
        assert!(!settings.keep_ongoing_first);
        assert!(!settings.keep_archived_last);
        assert_eq!(settings.sort_stages, stored_stages);
    }
}
