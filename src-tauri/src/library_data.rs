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
             WHERE key IN ('grid_hide_archived', 'library_layout_mode', 'library_grid_zoom')",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<HashMap<_, _>>>()
    })?;

    Ok(timings.aggregate(|| {
        let hide_archived = values
            .get("grid_hide_archived")
            .is_some_and(|value| value == "true");
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
            hide_archived,
            preferred_layout,
            grid_zoom,
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
                        COALESCE(SUM(duration_minutes), 0) AS total_minutes
                 FROM main.activity_logs
                 GROUP BY media_id
             )
             SELECT m.id, m.uid, m.title, m.default_activity_type, m.status,
                    m.language, m.description, m.cover_image, m.extra_data,
                    m.content_type, m.tracking_status, m.variant,
                    totals.first_activity_date, totals.last_activity_date,
                    COALESCE(totals.total_minutes, 0)
             FROM shared.media m
             LEFT JOIN activity_totals totals ON totals.media_id = m.id
             ORDER BY
                CASE
                    WHEN m.status != 'Archived' AND m.tracking_status = 'Ongoing' THEN 0
                    WHEN m.status != 'Archived' THEN 1
                    ELSE 2
                END,
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
        for (date, minutes) in [("2026-02-03", 20), ("2026-01-01", 10)] {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: minutes,
                    characters: 0,
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
        assert_eq!(snapshot.metrics[0].total_minutes, 30);
        assert!(!serde_json::to_string(&snapshot.metrics)
            .unwrap()
            .contains("large notes"));
    }
}
