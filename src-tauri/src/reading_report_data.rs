//! Bounded, read-only aggregate for the Dashboard Reading Report.
//!
//! Returns one pre-aggregated row per qualifying work instead of shipping every log and every
//! media row to JS. TS keeps every modelling decision except the immersion rule and the window predicate.

use rusqlite::{named_params, Connection, Result};

use crate::dashboard_data::parse_iso_date;
use crate::models::{MediaReadingAggregate, ReadingReportInputsRequest, ReadingReportInputsResponse};
use crate::read_performance::{Measured, Timings};

const MAX_CONTENT_TYPES: usize = 20;

pub fn validate_reading_report_request(
    request: &ReadingReportInputsRequest,
) -> std::result::Result<(), String> {
    let cutoff = parse_iso_date(&request.cutoff, "cutoff")?;
    let today = parse_iso_date(&request.today, "today")?;
    if today < cutoff {
        return Err("today must not be earlier than cutoff".to_string());
    }
    if request.content_types.is_empty() {
        return Err("content_types must not be empty".to_string());
    }
    if request.content_types.len() > MAX_CONTENT_TYPES {
        return Err(format!(
            "content_types is limited to {MAX_CONTENT_TYPES} entries"
        ));
    }
    Ok(())
}

const READING_REPORT_WINDOW_PREDICATE: &str =
    "(a.date_precision != 'year' AND a.date >= :cutoff AND a.effective_end <= :today)";

pub fn get_reading_report_inputs(
    conn: &Connection,
    request: &ReadingReportInputsRequest,
) -> Result<Measured<ReadingReportInputsResponse>> {
    let mut timings = Timings::default();
    let content_types_json =
        serde_json::to_string(&request.content_types).expect("content types serialize");
    let window = READING_REPORT_WINDOW_PREDICATE;
    let query = format!(
        "SELECT m.id, m.content_type, COALESCE(m.tracking_status, 'Untracked'), COALESCE(m.extra_data, '{{}}'),
            SUM(CASE WHEN a.duration_minutes > 0 THEN a.duration_minutes ELSE 0 END),
            MAX(a.duration_minutes > 0 AND a.characters > 0),
            MAX(a.duration_minutes <= 0 AND a.characters > 0),
            SUM(CASE WHEN {window} AND a.duration_minutes > 0 AND a.characters > 0 THEN a.characters ELSE 0 END),
            SUM(CASE WHEN {window} AND a.duration_minutes > 0 AND a.characters > 0 THEN a.duration_minutes ELSE 0 END),
            SUM(CASE WHEN {window} AND a.duration_minutes > 0 THEN a.duration_minutes ELSE 0 END),
            SUM(CASE WHEN {window} AND a.duration_minutes <= 0 AND a.characters > 0 THEN a.characters ELSE 0 END)
         FROM shared.media m JOIN main.activity_logs a ON a.media_id = m.id
         WHERE m.content_type IN (SELECT value FROM json_each(:content_types))
           AND EXISTS (SELECT 1 FROM main.activity_logs w WHERE w.media_id = m.id AND w.date >= :cutoff AND w.date <= :today)
           AND (COALESCE(NULLIF(a.activity_type, ''), m.default_activity_type) = 'Reading'
                OR (COALESCE(NULLIF(a.activity_type, ''), m.default_activity_type) = 'Playing'
                    AND m.content_type = 'Visual Novel'))
         GROUP BY m.id
         HAVING MAX({window} AND (a.duration_minutes > 0 OR a.characters > 0)) = 1"
    );

    let aggregates = timings.query(|| {
        let mut statement = conn.prepare(&query)?;
        let rows = statement.query_map(
            named_params! {
                ":cutoff": request.cutoff,
                ":today": request.today,
                ":content_types": content_types_json,
            },
            |row| {
                Ok(MediaReadingAggregate {
                    media_id: row.get(0)?,
                    content_type: row.get(1)?,
                    tracking_status: row.get(2)?,
                    extra_data: row.get(3)?,
                    immersion_minutes: row.get(4)?,
                    has_dual: row.get(5)?,
                    has_characters_only: row.get(6)?,
                    window_dual_characters: row.get(7)?,
                    window_dual_minutes: row.get(8)?,
                    window_timed_minutes: row.get(9)?,
                    window_characters_only_characters: row.get(10)?,
                })
            },
        )?;
        rows.collect::<Result<Vec<_>>>()
    })?;

    Ok(timings.finish(ReadingReportInputsResponse { aggregates }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::{self, DatePrecision};
    use crate::models::Media;
    use rusqlite::params;
    use std::collections::HashMap;

    fn test_connection() -> (tempfile::TempDir, Connection) {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("reading-report-test")).unwrap();
        (directory, conn)
    }

    #[test]
    fn validation_rejects_bad_cutoff_and_today() {
        let request = ReadingReportInputsRequest {
            cutoff: "not-a-date".to_string(),
            today: "2026-06-30".to_string(),
            content_types: vec!["Novel".to_string()],
        };
        assert!(validate_reading_report_request(&request).is_err());
    }

    #[test]
    fn validation_rejects_today_before_cutoff() {
        let request = ReadingReportInputsRequest {
            cutoff: "2026-06-30".to_string(),
            today: "2026-01-01".to_string(),
            content_types: vec!["Novel".to_string()],
        };
        assert!(validate_reading_report_request(&request).is_err());
    }

    #[test]
    fn validation_rejects_empty_content_types() {
        let request = ReadingReportInputsRequest {
            cutoff: "2026-01-01".to_string(),
            today: "2026-06-30".to_string(),
            content_types: vec![],
        };
        assert!(validate_reading_report_request(&request).is_err());
    }

    #[test]
    fn validation_rejects_more_content_types_than_the_cap() {
        let request = ReadingReportInputsRequest {
            cutoff: "2026-01-01".to_string(),
            today: "2026-06-30".to_string(),
            content_types: (0..=MAX_CONTENT_TYPES).map(|n| n.to_string()).collect(),
        };
        assert!(validate_reading_report_request(&request).is_err());
    }

    #[test]
    fn validation_accepts_a_well_formed_request() {
        let request = ReadingReportInputsRequest {
            cutoff: "2026-01-01".to_string(),
            today: "2026-06-30".to_string(),
            content_types: vec!["Novel".to_string(), "Manga".to_string()],
        };
        assert!(validate_reading_report_request(&request).is_ok());
    }

    #[test]
    fn an_empty_database_returns_no_rows() {
        let (_directory, conn) = test_connection();
        let response = get_reading_report_inputs(
            &conn,
            &ReadingReportInputsRequest {
                cutoff: "2026-01-01".to_string(),
                today: "2026-06-30".to_string(),
                content_types: vec!["Novel".to_string(), "Manga".to_string()],
            },
        )
        .unwrap()
        .value;
        assert!(response.aggregates.is_empty());
    }

    #[test]
    fn a_work_whose_only_in_window_evidence_is_year_scoped_does_not_qualify() {
        let (_directory, conn) = test_connection();
        let media_id = db::add_media_with_id(
            &conn,
            &Media {
                id: None,
                uid: None,
                title: "Year Only Evidence".to_string(),
                variant: String::new(),
                default_activity_type: "Reading".to_string(),
                status: "Active".to_string(),
                language: "Japanese".to_string(),
                description: String::new(),
                cover_image: String::new(),
                extra_data: "{}".to_string(),
                content_type: "Manga".to_string(),
                tracking_status: "Ongoing".to_string(),
            },
        )
        .unwrap();
        db::add_log(
            &conn,
            &crate::models::ActivityLog {
                id: None,
                media_id,
                duration_minutes: 500,
                characters: 20000,
                date: "2024-01-01".to_string(),
                date_precision: DatePrecision::Year,
                activity_type: "Reading".to_string(),
                notes: String::new(),
            },
        )
        .unwrap();

        let response = get_reading_report_inputs(
            &conn,
            &ReadingReportInputsRequest {
                cutoff: "2024-01-01".to_string(),
                today: "2024-12-31".to_string(),
                content_types: vec!["Manga".to_string()],
            },
        )
        .unwrap()
        .value;
        assert!(response.aggregates.is_empty());
    }

    // --- Cross-language parity fixture (`tests/fixtures/reading_report_parity.json`) ---
    // The TS side runs `summarizeMediaReading` over the same logs/media
    // (`tests/stats/reading_report_parity.test.ts`); both must reproduce the same integer
    // aggregate columns for the query's exact SQL shape.

    #[derive(serde::Deserialize)]
    struct FixtureWindow {
        cutoff: String,
        today: String,
    }

    #[derive(serde::Deserialize)]
    struct FixtureMedia {
        id: i64,
        title: String,
        content_type: String,
        tracking_status: String,
        extra_data: String,
        default_activity_type: String,
    }

    #[derive(serde::Deserialize)]
    struct FixtureLog {
        media_id: i64,
        activity_type: String,
        duration_minutes: i64,
        characters: i64,
        date: String,
        date_precision: String,
    }

    #[derive(serde::Deserialize)]
    struct FixtureExpectedAggregate {
        media_id: i64,
        content_type: String,
        tracking_status: String,
        extra_data: String,
        immersion_minutes: i64,
        has_dual: bool,
        has_characters_only: bool,
        window_dual_characters: i64,
        window_dual_minutes: i64,
        window_timed_minutes: i64,
        window_characters_only_characters: i64,
    }

    #[derive(serde::Deserialize)]
    struct Fixture {
        window: FixtureWindow,
        media: Vec<FixtureMedia>,
        logs: Vec<FixtureLog>,
        expected_aggregates: Vec<FixtureExpectedAggregate>,
    }

    const PARITY_FIXTURE_JSON: &str =
        include_str!("../../tests/fixtures/reading_report_parity.json");

    fn parse_date_precision(value: &str) -> DatePrecision {
        match value {
            "day" => DatePrecision::Day,
            "month" => DatePrecision::Month,
            "year" => DatePrecision::Year,
            other => panic!("unknown date_precision in fixture: {other}"),
        }
    }

    fn insert_log_bypassing_validation(
        conn: &Connection,
        media_id: i64,
        log: &FixtureLog,
        anchor: &str,
    ) {
        conn.execute(
            "INSERT INTO main.activity_logs (uid, media_id, duration_minutes, characters, date, date_precision, activity_type, notes)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                uuid::Uuid::new_v4().to_string(),
                media_id,
                log.duration_minutes,
                log.characters,
                anchor,
                log.date_precision,
                log.activity_type,
                "",
            ],
        )
        .unwrap();
    }

    #[test]
    fn matches_the_ts_twin_on_the_cross_language_parity_fixture() {
        let (_directory, conn) = test_connection();
        let fixture: Fixture = serde_json::from_str(PARITY_FIXTURE_JSON).unwrap();

        let mut media_id_by_fixture_id: HashMap<i64, i64> = HashMap::new();
        for media in &fixture.media {
            let media_id = db::add_media_with_id(
                &conn,
                &Media {
                    id: None,
                    uid: None,
                    title: media.title.clone(),
                    variant: String::new(),
                    default_activity_type: media.default_activity_type.clone(),
                    status: "Active".to_string(),
                    language: "Japanese".to_string(),
                    description: String::new(),
                    cover_image: String::new(),
                    extra_data: media.extra_data.clone(),
                    content_type: media.content_type.clone(),
                    tracking_status: media.tracking_status.clone(),
                },
            )
            .unwrap();
            media_id_by_fixture_id.insert(media.id, media_id);
        }

        for log in &fixture.logs {
            let media_id = media_id_by_fixture_id[&log.media_id];
            let has_no_evidence = log.duration_minutes <= 0 && log.characters <= 0;
            if log.activity_type.is_empty() || has_no_evidence {
                insert_log_bypassing_validation(&conn, media_id, log, &log.date);
                continue;
            }
            db::add_log(
                &conn,
                &crate::models::ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: log.duration_minutes,
                    characters: log.characters,
                    date: log.date.clone(),
                    date_precision: parse_date_precision(&log.date_precision),
                    activity_type: log.activity_type.clone(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }

        let response = get_reading_report_inputs(
            &conn,
            &ReadingReportInputsRequest {
                cutoff: fixture.window.cutoff.clone(),
                today: fixture.window.today.clone(),
                content_types: vec![
                    "Novel".to_string(),
                    "WebNovel".to_string(),
                    "NonFiction".to_string(),
                    "Visual Novel".to_string(),
                    "Manga".to_string(),
                ],
            },
        )
        .unwrap()
        .value;

        let fixture_id_by_media_id: HashMap<i64, i64> = media_id_by_fixture_id
            .iter()
            .map(|(fixture_id, media_id)| (*media_id, *fixture_id))
            .collect();

        assert_eq!(
            response.aggregates.len(),
            fixture.expected_aggregates.len(),
            "qualifying row count must match the fixture exactly"
        );

        for actual in &response.aggregates {
            let fixture_id = fixture_id_by_media_id[&actual.media_id];
            let expected = fixture
                .expected_aggregates
                .iter()
                .find(|row| row.media_id == fixture_id)
                .unwrap_or_else(|| panic!("media {fixture_id} unexpectedly qualified"));

            assert_eq!(actual.content_type, expected.content_type);
            assert_eq!(actual.tracking_status, expected.tracking_status);
            assert_eq!(actual.extra_data, expected.extra_data);
            assert_eq!(actual.immersion_minutes, expected.immersion_minutes);
            assert_eq!(actual.has_dual, expected.has_dual);
            assert_eq!(actual.has_characters_only, expected.has_characters_only);
            assert_eq!(actual.window_dual_characters, expected.window_dual_characters);
            assert_eq!(actual.window_dual_minutes, expected.window_dual_minutes);
            assert_eq!(actual.window_timed_minutes, expected.window_timed_minutes);
            assert_eq!(
                actual.window_characters_only_characters,
                expected.window_characters_only_characters
            );
        }
    }
}
