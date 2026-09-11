//! Bounded, read-only dashboard queries.
//!
//! Every public read opens a SQLite transaction so the multiple result sections
//! come from one database snapshot. The module owns no cache or process-global
//! data; switching the active database therefore cannot blend dashboard data
//! between profiles or between the desktop and web runtimes.

use chrono::{Datelike, Days, NaiveDate};
use rusqlite::{params, Connection, Result};
use std::collections::{HashMap, HashSet};

use crate::db::DatePrecision;
use crate::models::{
    DailyHeatmap, DashboardActivityTotals, DashboardBucket, DashboardBucketTotals,
    DashboardChartPoint, DashboardGroupBy, DashboardHeatmapYearRequest,
    DashboardHeatmapYearResponse, DashboardHighlight, DashboardHighlightKind, DashboardMedia,
    DashboardNamedTotals, DashboardRangeRequest, DashboardRangeResponse, DashboardRecentLog,
    DashboardRecentLogsRequest, DashboardRecentPage, DashboardSettings, DashboardSnapshot,
    DashboardSnapshotRequest, DashboardSummary, DashboardWeekdayDistribution,
    DashboardWeekdayStats,
};
use crate::read_performance::{Measured, Timings};

fn reduced_activity_date(anchor: &str, precision_key_length: i64) -> String {
    let length = usize::try_from(precision_key_length)
        .unwrap_or(0)
        .min(anchor.len());
    anchor[0..length].to_string()
}

pub const MAX_RECENT_LOG_PAGE_SIZE: i64 = 50;
const QUICK_LOG_LIMIT: i64 = 6;
const TOP_GROUPS_PER_METRIC: usize = 12;
const MAX_DAY_BUCKETS: i64 = 62;
const MAX_MONTH_BUCKET_DAYS: i64 = 731;
const MAX_YEAR_BUCKETS: i32 = 1_000;
const WEEKDAY_DISTRIBUTION_DAYS: u64 = 183;

pub fn validate_snapshot_request(
    request: &DashboardSnapshotRequest,
) -> std::result::Result<(), String> {
    parse_iso_date(&request.today, "today")?;
    validate_year(request.heatmap_year)?;
    validate_recent_page(request.recent_offset, request.recent_limit)
}

pub fn validate_range_request(request: &DashboardRangeRequest) -> std::result::Result<(), String> {
    let start = parse_iso_date(&request.start_date, "start_date")?;
    let end = parse_iso_date(&request.end_date, "end_date")?;
    if end < start {
        return Err("end_date must not be earlier than start_date".to_string());
    }

    let inclusive_days = end.signed_duration_since(start).num_days() + 1;
    match request.bucket {
        DashboardBucket::Day if inclusive_days > MAX_DAY_BUCKETS => Err(format!(
            "day-bucket dashboard ranges are limited to {MAX_DAY_BUCKETS} days"
        )),
        DashboardBucket::Month if inclusive_days > MAX_MONTH_BUCKET_DAYS => {
            Err("month-bucket dashboard ranges are limited to two years".to_string())
        }
        DashboardBucket::Year if end.year().saturating_sub(start.year()) + 1 > MAX_YEAR_BUCKETS => {
            Err(format!(
                "year-bucket dashboard ranges are limited to {MAX_YEAR_BUCKETS} years"
            ))
        }
        _ => Ok(()),
    }
}

pub fn validate_heatmap_request(
    request: &DashboardHeatmapYearRequest,
) -> std::result::Result<(), String> {
    validate_year(request.year)
}

pub fn validate_recent_request(
    request: &DashboardRecentLogsRequest,
) -> std::result::Result<(), String> {
    validate_recent_page(request.offset, request.limit)
}

fn validate_recent_page(offset: i64, limit: i64) -> std::result::Result<(), String> {
    if offset < 0 {
        return Err("recent log offset must be non-negative".to_string());
    }
    if !(1..=MAX_RECENT_LOG_PAGE_SIZE).contains(&limit) {
        return Err(format!(
            "recent log limit must be between 1 and {MAX_RECENT_LOG_PAGE_SIZE}"
        ));
    }
    Ok(())
}

fn validate_year(year: i32) -> std::result::Result<(), String> {
    if !(1..=9_999).contains(&year) {
        return Err("year must be between 1 and 9999".to_string());
    }
    Ok(())
}

fn parse_iso_date(value: &str, field: &str) -> std::result::Result<NaiveDate, String> {
    NaiveDate::parse_from_str(value, "%Y-%m-%d")
        .map_err(|_| format!("{field} must be a valid YYYY-MM-DD date"))
}

pub fn get_dashboard_snapshot(
    conn: &Connection,
    request: &DashboardSnapshotRequest,
) -> Result<Measured<DashboardSnapshot>> {
    let mut timings = Timings::default();
    let transaction = timings.query(|| conn.unchecked_transaction())?;

    let settings = query_dashboard_settings(&transaction, &mut timings)?;
    let summary = query_summary(&transaction, &request.today, &mut timings)?;
    let quick_log_media = query_quick_log_media(&transaction, &mut timings)?;
    let recent_logs = query_recent_logs(
        &transaction,
        request.request_id,
        request.recent_offset,
        request.recent_limit,
        &mut timings,
    )?;
    let heatmap = query_heatmap_year(
        &transaction,
        request.request_id,
        request.heatmap_year,
        &mut timings,
    )?;

    let today = NaiveDate::parse_from_str(&request.today, "%Y-%m-%d")
        .expect("validated dashboard snapshot date");
    let weekday_distribution = query_weekday_distribution(&transaction, today, &mut timings)?;

    timings.query(|| transaction.commit())?;
    Ok(timings.finish(DashboardSnapshot {
        request_id: request.request_id,
        settings,
        summary,
        quick_log_media,
        recent_logs,
        heatmap,
        weekday_distribution,
    }))
}

fn query_weekday_distribution(
    conn: &Connection,
    end: NaiveDate,
    timings: &mut Timings,
) -> Result<DashboardWeekdayDistribution> {
    let start = end
        .checked_sub_days(Days::new(WEEKDAY_DISTRIBUTION_DAYS - 1))
        .expect("valid weekday distribution start");
    let start_date = start.format("%Y-%m-%d").to_string();
    let end_date = end.format("%Y-%m-%d").to_string();
    let totals_by_date = timings.query(|| {
        let mut statement = conn.prepare(
            "SELECT a.date,
                    COALESCE(SUM(a.duration_minutes), 0),
                    COALESCE(SUM(a.characters), 0)
             FROM main.activity_logs a
             WHERE a.date >= ?1 AND a.date <= ?2 AND date(a.date) IS NOT NULL
               AND a.date_precision = 'day'
             GROUP BY a.date",
        )?;
        let rows = statement.query_map(params![start_date, end_date], |row| {
            Ok((
                row.get::<_, String>(0)?,
                (row.get::<_, i64>(1)?, row.get::<_, i64>(2)?),
            ))
        })?;
        rows.collect::<Result<HashMap<_, _>>>()
    })?;

    Ok(timings.aggregate(|| {
        let mut minute_samples: [Vec<i64>; 7] = std::array::from_fn(|_| Vec::new());
        let mut character_samples: [Vec<i64>; 7] = std::array::from_fn(|_| Vec::new());
        for offset in 0..WEEKDAY_DISTRIBUTION_DAYS {
            let date = start
                .checked_add_days(Days::new(offset))
                .expect("valid weekday distribution date");
            let weekday = date.weekday().num_days_from_sunday() as usize;
            let key = date.format("%Y-%m-%d").to_string();
            let (minutes, characters) = totals_by_date.get(&key).copied().unwrap_or_default();
            minute_samples[weekday].push(minutes);
            character_samples[weekday].push(characters);
        }

        let days = minute_samples
            .into_iter()
            .zip(character_samples)
            .enumerate()
            .map(|(weekday, (mut minutes, mut characters))| {
                let sample_days = minutes.len();
                let (average_minutes, median_minutes) = average_and_median(&mut minutes);
                let (average_characters, median_characters) = average_and_median(&mut characters);
                DashboardWeekdayStats {
                    weekday: weekday as u32,
                    average_minutes,
                    median_minutes,
                    average_characters,
                    median_characters,
                    sample_days: sample_days as i64,
                }
            })
            .collect();

        DashboardWeekdayDistribution {
            start_date,
            end_date,
            days,
        }
    }))
}

fn average_and_median(values: &mut [i64]) -> (f64, f64) {
    values.sort_unstable();
    let total: i64 = values.iter().sum();
    let median = if values.len().is_multiple_of(2) {
        (values[values.len() / 2 - 1] + values[values.len() / 2]) as f64 / 2.0
    } else {
        values[values.len() / 2] as f64
    };
    (total as f64 / values.len() as f64, median)
}

pub fn get_dashboard_range(
    conn: &Connection,
    request: &DashboardRangeRequest,
) -> Result<Measured<DashboardRangeResponse>> {
    let mut timings = Timings::default();
    let transaction = timings.query(|| conn.unchecked_transaction())?;
    let value = query_range(&transaction, request, &mut timings)?;
    timings.query(|| transaction.commit())?;
    Ok(timings.finish(value))
}

pub fn get_dashboard_heatmap_year(
    conn: &Connection,
    request: &DashboardHeatmapYearRequest,
) -> Result<Measured<DashboardHeatmapYearResponse>> {
    let mut timings = Timings::default();
    let transaction = timings.query(|| conn.unchecked_transaction())?;
    let value = query_heatmap_year(&transaction, request.request_id, request.year, &mut timings)?;
    timings.query(|| transaction.commit())?;
    Ok(timings.finish(value))
}

pub fn get_dashboard_recent_logs(
    conn: &Connection,
    request: &DashboardRecentLogsRequest,
) -> Result<Measured<DashboardRecentPage>> {
    let mut timings = Timings::default();
    let transaction = timings.query(|| conn.unchecked_transaction())?;
    let value = query_recent_logs(
        &transaction,
        request.request_id,
        request.offset,
        request.limit,
        &mut timings,
    )?;
    timings.query(|| transaction.commit())?;
    Ok(timings.finish(value))
}

fn query_dashboard_settings(conn: &Connection, timings: &mut Timings) -> Result<DashboardSettings> {
    let values = timings.query(|| {
        let mut statement = conn.prepare(
            "SELECT key, value
             FROM main.settings
             WHERE key IN ('dashboard_chart_type', 'dashboard_group_by', 'week_start_day',
                           'dashboard_time_range_days', 'dashboard_metric')",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<HashMap<_, _>>>()
    })?;

    Ok(timings.aggregate(|| {
        let chart_type = match values.get("dashboard_chart_type").map(String::as_str) {
            Some("line") => "line",
            _ => "bar",
        }
        .to_string();
        let raw_group_by = values
            .get("dashboard_group_by")
            .map(String::as_str)
            .unwrap_or("activity_type");
        let migrate_legacy_group_by = raw_group_by == "media_type";
        let group_by = if raw_group_by == "log_name" {
            DashboardGroupBy::LogName
        } else {
            DashboardGroupBy::ActivityType
        };
        let week_start_day = values
            .get("week_start_day")
            .and_then(|value| value.parse::<i64>().ok())
            .filter(|value| (0..=6).contains(value))
            .unwrap_or(1);
        let time_range_days = values
            .get("dashboard_time_range_days")
            .and_then(|value| value.parse::<i64>().ok())
            .filter(|value| [0, 7, 30, 365].contains(value))
            .unwrap_or(7);
        let metric = match values.get("dashboard_metric").map(String::as_str) {
            Some("characters") => "characters",
            _ => "minutes",
        }
        .to_string();

        DashboardSettings {
            chart_type,
            group_by,
            week_start_day,
            migrate_legacy_group_by,
            time_range_days,
            metric,
        }
    }))
}

struct DashboardDateExtreme {
    sort_key: String,
    precision_key_length: i64,
    anchor: String,
}

impl DashboardDateExtreme {
    fn is_outranked_as_earliest_by(&self, sort_key: &str, precision_key_length: i64) -> bool {
        sort_key < self.sort_key.as_str()
            || (sort_key == self.sort_key && precision_key_length < self.precision_key_length)
    }

    fn is_outranked_as_latest_by(&self, sort_key: &str, precision_key_length: i64) -> bool {
        sort_key > self.sort_key.as_str()
            || (sort_key == self.sort_key && precision_key_length < self.precision_key_length)
    }
}

fn query_summary(
    conn: &Connection,
    today: &str,
    timings: &mut Timings,
) -> Result<DashboardSummary> {
    let total_media = timings
        .query(|| conn.query_row("SELECT COUNT(*) FROM shared.media", [], |row| row.get(0)))?;
    // One grouped pass supplies counts, totals, activity breakdowns, and streak
    // dates. This replaces three independent lifetime scans from the old
    // dashboard startup path.
    let query =
        "SELECT date, effective_end, precision_key_length,
                activity_type,
                COUNT(*),
                COALESCE(SUM(duration_minutes), 0),
                COALESCE(SUM(characters), 0)
         FROM main.activity_logs
         GROUP BY date, effective_end, precision_key_length, activity_type
         ORDER BY date ASC";
    let grouped_rows = timings.query(|| {
        let mut statement = conn.prepare(query)?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, i64>(5)?,
                row.get::<_, i64>(6)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>>>()
    })?;

    Ok(timings.aggregate(|| {
        let today = NaiveDate::parse_from_str(today, "%Y-%m-%d").expect("validated today");
        let mut dates = HashSet::new();
        let mut activity_totals = HashMap::<String, (i64, i64, i64, i64)>::new();
        let mut total_logs = 0_i64;
        let mut total_minutes = 0_i64;
        let mut total_characters = 0_i64;
        let mut day_scoped_total_minutes = 0_i64;
        let mut day_scoped_total_characters = 0_i64;
        let mut first_extreme: Option<DashboardDateExtreme> = None;
        let mut last_extreme: Option<DashboardDateExtreme> = None;

        for (anchor, effective_end, precision_key_length, activity_type, sessions, minutes, characters) in
            grouped_rows
        {
            total_logs += sessions;
            total_minutes += minutes;
            total_characters += characters;
            let is_day = precision_key_length == 10;
            if is_day {
                if let Ok(date) = NaiveDate::parse_from_str(&anchor, "%Y-%m-%d") {
                    dates.insert(date);
                }
                day_scoped_total_minutes += minutes;
                day_scoped_total_characters += characters;
            }

            if first_extreme.as_ref().is_none_or(|current| {
                current.is_outranked_as_earliest_by(&anchor, precision_key_length)
            }) {
                first_extreme = Some(DashboardDateExtreme {
                    sort_key: anchor.clone(),
                    precision_key_length,
                    anchor: anchor.clone(),
                });
            }
            if last_extreme.as_ref().is_none_or(|current| {
                current.is_outranked_as_latest_by(&effective_end, precision_key_length)
            }) {
                last_extreme = Some(DashboardDateExtreme {
                    sort_key: effective_end,
                    precision_key_length,
                    anchor: anchor.clone(),
                });
            }

            let label = normalized_label(activity_type, "Unknown");
            let total = activity_totals.entry(label).or_default();
            total.0 += minutes;
            total.1 += characters;
            if is_day {
                total.2 += minutes;
                total.3 += characters;
            }
        }
        let mut dates = dates.into_iter().collect::<Vec<_>>();
        dates.sort_unstable();
        let (max_streak, current_streak) = calculate_streaks(&dates, today);
        let logged_days = dates.len() as i64;
        let first_activity_date = first_extreme
            .map(|extreme| reduced_activity_date(&extreme.anchor, extreme.precision_key_length));
        let last_activity_date = last_extreme
            .map(|extreme| reduced_activity_date(&extreme.anchor, extreme.precision_key_length));
        let raw_activity_totals = activity_totals
            .into_iter()
            .map(|(label, total)| DashboardActivityTotals {
                totals: DashboardNamedTotals {
                    key: format!("activity:{label}"),
                    label,
                    total_minutes: total.0,
                    total_characters: total.1,
                },
                day_scoped_total_minutes: total.2,
                day_scoped_total_characters: total.3,
            })
            .collect();

        DashboardSummary {
            total_logs,
            total_media,
            logged_days,
            first_activity_date,
            last_activity_date,
            max_streak,
            current_streak,
            total_minutes,
            total_characters,
            day_scoped_total_minutes,
            day_scoped_total_characters,
            activity_totals: fold_activity_totals(
                raw_activity_totals,
                TOP_GROUPS_PER_METRIC,
                "Other activity types",
            ),
        }
    }))
}

fn calculate_streaks(dates: &[NaiveDate], today: NaiveDate) -> (i64, i64) {
    if dates.is_empty() {
        return (0, 0);
    }

    let mut max_streak = 1_i64;
    let mut running = 1_i64;
    for pair in dates.windows(2) {
        if pair[1].signed_duration_since(pair[0]).num_days() == 1 {
            running += 1;
            max_streak = max_streak.max(running);
        } else {
            running = 1;
        }
    }

    let last = *dates.last().expect("non-empty dates");
    let days_since_last = today.signed_duration_since(last).num_days();
    let current_streak = if (0..=1).contains(&days_since_last) {
        let mut streak = 1_i64;
        for pair in dates.windows(2).rev() {
            if pair[1].signed_duration_since(pair[0]).num_days() == 1 {
                streak += 1;
            } else {
                break;
            }
        }
        streak
    } else {
        0
    };
    (max_streak, current_streak)
}

fn query_quick_log_media(conn: &Connection, timings: &mut Timings) -> Result<Vec<DashboardMedia>> {
    let query =
        "SELECT m.id, m.title, m.variant, m.default_activity_type, m.status,
                m.cover_image, m.content_type, m.tracking_status,
                (
                    SELECT recent.effective_end
                    FROM main.activity_logs recent
                    WHERE recent.media_id = m.id
                    ORDER BY recent.effective_end DESC, recent.precision_key_length ASC, recent.id DESC
                    LIMIT 1
                ) AS latest_effective_end,
                (
                    SELECT recent.precision_key_length
                    FROM main.activity_logs recent
                    WHERE recent.media_id = m.id
                    ORDER BY recent.effective_end DESC, recent.precision_key_length ASC, recent.id DESC
                    LIMIT 1
                ) AS latest_precision_key_length,
                (
                    SELECT recent.id
                    FROM main.activity_logs recent
                    WHERE recent.media_id = m.id
                    ORDER BY recent.effective_end DESC, recent.precision_key_length ASC, recent.id DESC
                    LIMIT 1
                ) AS latest_id
         FROM shared.media m
         WHERE m.status != 'Archived'
         ORDER BY
            CASE WHEN m.tracking_status = 'Complete' THEN 1 ELSE 0 END ASC,
            latest_effective_end DESC,
            latest_precision_key_length ASC,
            latest_id DESC,
            m.title ASC,
            m.id ASC
         LIMIT ?1";
    timings.query(|| {
        let mut statement = conn.prepare(query)?;
        let rows = statement.query_map(params![QUICK_LOG_LIMIT], map_dashboard_media)?;
        rows.collect::<Result<Vec<_>>>()
    })
}

fn map_dashboard_media(row: &rusqlite::Row<'_>) -> Result<DashboardMedia> {
    Ok(DashboardMedia {
        id: row.get(0)?,
        title: row.get(1)?,
        variant: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
        default_activity_type: row.get(3)?,
        status: row.get(4)?,
        cover_image: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
        content_type: row
            .get::<_, Option<String>>(6)?
            .unwrap_or_else(|| "Unknown".to_string()),
        tracking_status: row
            .get::<_, Option<String>>(7)?
            .unwrap_or_else(|| "Untracked".to_string()),
    })
}

fn query_recent_logs(
    conn: &Connection,
    request_id: u64,
    offset: i64,
    limit: i64,
    timings: &mut Timings,
) -> Result<DashboardRecentPage> {
    let total_count = timings.query(|| {
        conn.query_row("SELECT COUNT(*) FROM main.activity_logs", [], |row| {
            row.get(0)
        })
    })?;
    let query =
        "SELECT a.id, a.media_id, m.title, m.variant, a.activity_type,
                a.duration_minutes, a.characters, a.date, a.date_precision, m.language, a.notes
         FROM main.activity_logs a
         JOIN shared.media m ON m.id = a.media_id
         ORDER BY a.effective_end DESC, a.precision_key_length ASC, a.id DESC
         LIMIT ?1 OFFSET ?2";
    let items = timings.query(|| {
        let mut statement = conn.prepare(query)?;
        let rows = statement.query_map(params![limit, offset], |row| {
            Ok(DashboardRecentLog {
                id: row.get(0)?,
                media_id: row.get(1)?,
                title: row.get(2)?,
                variant: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                activity_type: row.get(4)?,
                duration_minutes: row.get(5)?,
                characters: row.get(6)?,
                date: row.get(7)?,
                date_precision: row.get(8)?,
                language: row.get(9)?,
                notes: row.get(10)?,
            })
        })?;
        rows.collect::<Result<Vec<_>>>()
    })?;

    Ok(DashboardRecentPage {
        request_id,
        offset,
        limit,
        total_count,
        items,
    })
}

fn query_heatmap_year(
    conn: &Connection,
    request_id: u64,
    year: i32,
    timings: &mut Timings,
) -> Result<DashboardHeatmapYearResponse> {
    let start_date = format!("{year:04}-01-01");
    let end_exclusive = if year == 9_999 {
        "9999-12-32".to_string()
    } else {
        format!("{:04}-01-01", year + 1)
    };
    let days = timings.query(|| {
        let mut statement = conn.prepare(
            "SELECT date,
                    COALESCE(SUM(duration_minutes), 0),
                    COALESCE(SUM(characters), 0)
             FROM main.activity_logs
             WHERE date >= ?1 AND date < ?2 AND date(date) IS NOT NULL
               AND date_precision = 'day'
             GROUP BY date
             ORDER BY date ASC",
        )?;
        let rows = statement.query_map(params![start_date, end_exclusive], |row| {
            Ok(DailyHeatmap {
                date: row.get(0)?,
                total_minutes: row.get(1)?,
                total_characters: row.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>>>()
    })?;

    Ok(DashboardHeatmapYearResponse {
        request_id,
        year,
        days,
    })
}

#[derive(Debug)]
struct RawChartPoint {
    bucket: Option<String>,
    group_key: String,
    title: String,
    variant: String,
    total_minutes: i64,
    total_characters: i64,
}

fn query_range(
    conn: &Connection,
    request: &DashboardRangeRequest,
    timings: &mut Timings,
) -> Result<DashboardRangeResponse> {
    let (bucket_length, bucket_suffix) = match request.bucket {
        DashboardBucket::Day => (10, ""),
        DashboardBucket::Month => (7, "-01"),
        DashboardBucket::Year => (4, "-01-01"),
    };
    let bucket_expression = format!(
        "CASE WHEN a.precision_key_length >= {bucket_length}
              THEN substr(a.date, 1, {bucket_length}) || '{bucket_suffix}'
              ELSE NULL END"
    );
    let (group_key_expression, group_by_expression) = match request.group_by {
        DashboardGroupBy::ActivityType => ("'activity:' || a.activity_type", "a.activity_type, ''"),
        DashboardGroupBy::LogName => ("'media:' || CAST(a.media_id AS TEXT)", "m.title, m.variant"),
    };
    let series_sql = format!(
        "SELECT {bucket_expression}, {group_key_expression}, {group_by_expression},
                COALESCE(SUM(a.duration_minutes), 0),
                COALESCE(SUM(a.characters), 0)
         FROM main.activity_logs a
         JOIN shared.media m ON m.id = a.media_id
         WHERE a.date >= ?1 AND a.date <= ?2 AND date(a.date) IS NOT NULL
           AND a.effective_end <= ?2
         GROUP BY {bucket_expression}, {group_key_expression}, {group_by_expression}
         ORDER BY {bucket_expression} ASC, {group_key_expression} ASC"
    );
    let raw_series = timings.query(|| {
        let mut statement = conn.prepare(&series_sql)?;
        let rows = statement.query_map(params![request.start_date, request.end_date], |row| {
            Ok(RawChartPoint {
                bucket: row.get(0)?,
                group_key: row.get(1)?,
                title: row.get(2)?,
                variant: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                total_minutes: row.get(4)?,
                total_characters: row.get(5)?,
            })
        })?;
        rows.collect::<Result<Vec<_>>>()
    })?;

    let raw_categories = timings.query(|| {
        let mut statement = conn.prepare(
            "SELECT COALESCE(
                        NULLIF(TRIM(m.content_type), ''),
                        NULLIF(TRIM(m.default_activity_type), ''),
                        NULLIF(TRIM(a.activity_type), ''),
                        'Unknown'
                    ) AS category,
                    COALESCE(SUM(a.duration_minutes), 0),
                    COALESCE(SUM(a.characters), 0)
             FROM main.activity_logs a
             JOIN shared.media m ON m.id = a.media_id
             WHERE a.date >= ?1 AND a.date <= ?2 AND date(a.date) IS NOT NULL
               AND a.effective_end <= ?2
             GROUP BY category",
        )?;
        let rows = statement.query_map(params![request.start_date, request.end_date], |row| {
            let label: String = row.get(0)?;
            Ok(DashboardNamedTotals {
                key: format!("category:{label}"),
                label,
                total_minutes: row.get(1)?,
                total_characters: row.get(2)?,
            })
        })?;
        rows.collect::<Result<Vec<_>>>()
    })?;

    let raw_highlight_rows =
        query_highlight_rows(conn, &request.start_date, &request.end_date, timings)?;

    Ok(timings.aggregate(|| {
        let (series, bucket_totals) = aggregate_chart_series(raw_series, request.group_by);
        DashboardRangeResponse {
            request_id: request.request_id,
            start_date: request.start_date.clone(),
            end_date: request.end_date.clone(),
            bucket: request.bucket,
            group_by: request.group_by,
            series,
            bucket_totals,
            category_totals: fold_named_totals(
                raw_categories,
                TOP_GROUPS_PER_METRIC,
                "Other categories",
            ),
            highlights: build_highlights(raw_highlight_rows),
        }
    }))
}

fn aggregate_chart_series(
    raw_series: Vec<RawChartPoint>,
    group_by: DashboardGroupBy,
) -> (Vec<DashboardChartPoint>, Vec<DashboardBucketTotals>) {
    let mut group_totals = HashMap::<String, (i64, i64)>::new();
    let mut bucket_totals = HashMap::<Option<String>, (i64, i64)>::new();
    let mut title_keys = HashMap::<String, HashSet<String>>::new();

    for point in &raw_series {
        let group = group_totals.entry(point.group_key.clone()).or_default();
        group.0 += point.total_minutes;
        group.1 += point.total_characters;
        let bucket = bucket_totals.entry(point.bucket.clone()).or_default();
        bucket.0 += point.total_minutes;
        bucket.1 += point.total_characters;
        if group_by == DashboardGroupBy::LogName {
            title_keys
                .entry(point.title.clone())
                .or_default()
                .insert(point.group_key.clone());
        }
    }

    let selected_keys = select_top_keys(&group_totals, TOP_GROUPS_PER_METRIC);
    let mut output = Vec::new();
    let mut other_by_bucket = HashMap::<Option<String>, (i64, i64)>::new();
    for point in raw_series {
        if selected_keys.contains(&point.group_key) {
            let group_label = if group_by == DashboardGroupBy::LogName
                && title_keys.get(&point.title).map_or(0, HashSet::len) > 1
            {
                format!(
                    "{} — {}",
                    point.title,
                    if point.variant.trim().is_empty() {
                        "(no variant)"
                    } else {
                        point.variant.trim()
                    }
                )
            } else {
                normalized_label(point.title, "Unknown")
            };
            output.push(DashboardChartPoint {
                bucket: point.bucket,
                group_key: point.group_key,
                group_label,
                total_minutes: point.total_minutes,
                total_characters: point.total_characters,
            });
        } else {
            let other = other_by_bucket.entry(point.bucket).or_default();
            other.0 += point.total_minutes;
            other.1 += point.total_characters;
        }
    }
    output.extend(
        other_by_bucket
            .into_iter()
            .map(|(bucket, totals)| DashboardChartPoint {
                bucket,
                group_key: "dashboard:other".to_string(),
                group_label: "Other".to_string(),
                total_minutes: totals.0,
                total_characters: totals.1,
            }),
    );
    output.sort_by(|left, right| {
        left.bucket
            .cmp(&right.bucket)
            .then_with(|| left.group_key.cmp(&right.group_key))
    });

    let mut buckets = bucket_totals
        .into_iter()
        .map(|(bucket, totals)| DashboardBucketTotals {
            bucket,
            total_minutes: totals.0,
            total_characters: totals.1,
        })
        .collect::<Vec<_>>();
    buckets.sort_by(|left, right| left.bucket.cmp(&right.bucket));
    (output, buckets)
}

fn select_top_keys(
    totals: &HashMap<String, (i64, i64)>,
    limit_per_metric: usize,
) -> HashSet<String> {
    let mut by_minutes = totals.iter().collect::<Vec<_>>();
    by_minutes.sort_by(|(left_key, left), (right_key, right)| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| right.1.cmp(&left.1))
            .then_with(|| left_key.cmp(right_key))
    });
    let mut by_characters = totals.iter().collect::<Vec<_>>();
    by_characters.sort_by(|(left_key, left), (right_key, right)| {
        right
            .1
            .cmp(&left.1)
            .then_with(|| right.0.cmp(&left.0))
            .then_with(|| left_key.cmp(right_key))
    });

    by_minutes
        .into_iter()
        .take(limit_per_metric)
        .chain(by_characters.into_iter().take(limit_per_metric))
        .map(|(key, _)| key.clone())
        .collect()
}

fn fold_named_totals(
    rows: Vec<DashboardNamedTotals>,
    limit_per_metric: usize,
    other_label: &str,
) -> Vec<DashboardNamedTotals> {
    let totals = rows
        .iter()
        .map(|row| (row.key.clone(), (row.total_minutes, row.total_characters)))
        .collect::<HashMap<_, _>>();
    let selected = select_top_keys(&totals, limit_per_metric);
    let mut output = Vec::new();
    let mut other = (0_i64, 0_i64);
    for row in rows {
        if selected.contains(&row.key) {
            output.push(row);
        } else {
            other.0 += row.total_minutes;
            other.1 += row.total_characters;
        }
    }
    if other.0 != 0 || other.1 != 0 {
        output.push(DashboardNamedTotals {
            key: "dashboard:other".to_string(),
            label: other_label.to_string(),
            total_minutes: other.0,
            total_characters: other.1,
        });
    }
    output.sort_by(|left, right| {
        right
            .total_minutes
            .cmp(&left.total_minutes)
            .then_with(|| right.total_characters.cmp(&left.total_characters))
            .then_with(|| left.key.cmp(&right.key))
    });
    output
}

fn fold_activity_totals(
    rows: Vec<DashboardActivityTotals>,
    limit_per_metric: usize,
    other_label: &str,
) -> Vec<DashboardActivityTotals> {
    let totals = rows
        .iter()
        .map(|row| {
            (
                row.totals.key.clone(),
                (row.totals.total_minutes, row.totals.total_characters),
            )
        })
        .collect::<HashMap<_, _>>();
    let selected = select_top_keys(&totals, limit_per_metric);
    let mut output = Vec::new();
    let mut other = (0_i64, 0_i64, 0_i64, 0_i64);
    for row in rows {
        if selected.contains(&row.totals.key) {
            output.push(row);
        } else {
            other.0 += row.totals.total_minutes;
            other.1 += row.totals.total_characters;
            other.2 += row.day_scoped_total_minutes;
            other.3 += row.day_scoped_total_characters;
        }
    }
    if other.0 != 0 || other.1 != 0 || other.2 != 0 || other.3 != 0 {
        output.push(DashboardActivityTotals {
            totals: DashboardNamedTotals {
                key: "dashboard:other".to_string(),
                label: other_label.to_string(),
                total_minutes: other.0,
                total_characters: other.1,
            },
            day_scoped_total_minutes: other.2,
            day_scoped_total_characters: other.3,
        });
    }
    output.sort_by(|left, right| {
        right
            .totals
            .total_minutes
            .cmp(&left.totals.total_minutes)
            .then_with(|| {
                right
                    .totals
                    .total_characters
                    .cmp(&left.totals.total_characters)
            })
            .then_with(|| left.totals.key.cmp(&right.totals.key))
    });
    output
}

#[derive(Debug)]
struct HighlightDayRow {
    media: DashboardMedia,
    date: String,
    date_precision: DatePrecision,
    total_minutes: i64,
    total_characters: i64,
    sessions: i64,
}

fn query_highlight_rows(
    conn: &Connection,
    start_date: &str,
    end_date: &str,
    timings: &mut Timings,
) -> Result<Vec<HighlightDayRow>> {
    let query =
        "SELECT m.id, m.title, m.variant, m.default_activity_type, m.status,
                m.cover_image, m.content_type, m.tracking_status,
                a.date, a.date_precision,
                COALESCE(SUM(a.duration_minutes), 0),
                COALESCE(SUM(a.characters), 0),
                COUNT(*)
         FROM main.activity_logs a
         JOIN shared.media m ON m.id = a.media_id
         WHERE a.date >= ?1 AND a.date <= ?2 AND date(a.date) IS NOT NULL
           AND a.effective_end <= ?2
         GROUP BY m.id, a.date, a.date_precision
         ORDER BY m.id ASC, a.date ASC";
    timings.query(|| {
        let mut statement = conn.prepare(query)?;
        let rows = statement.query_map(params![start_date, end_date], |row| {
            Ok(HighlightDayRow {
                media: map_dashboard_media(row)?,
                date: row.get(8)?,
                date_precision: row.get(9)?,
                total_minutes: row.get(10)?,
                total_characters: row.get(11)?,
                sessions: row.get(12)?,
            })
        })?;
        rows.collect::<Result<Vec<_>>>()
    })
}

#[derive(Debug)]
struct MediaHighlightAggregate {
    media: DashboardMedia,
    total_minutes: i64,
    total_characters: i64,
    sessions: i64,
    dates: Vec<NaiveDate>,
}

fn build_highlights(rows: Vec<HighlightDayRow>) -> Vec<DashboardHighlight> {
    let mut media_totals = HashMap::<i64, MediaHighlightAggregate>::new();
    let mut day_totals = HashMap::<String, (i64, i64)>::new();
    for row in rows {
        let media = media_totals
            .entry(row.media.id)
            .or_insert_with(|| MediaHighlightAggregate {
                media: row.media.clone(),
                total_minutes: 0,
                total_characters: 0,
                sessions: 0,
                dates: Vec::new(),
            });
        media.total_minutes += row.total_minutes;
        media.total_characters += row.total_characters;
        media.sessions += row.sessions;
        if row.date_precision == DatePrecision::Day {
            if let Ok(date) = NaiveDate::parse_from_str(&row.date, "%Y-%m-%d") {
                media.dates.push(date);
            }
            let day = day_totals.entry(row.date).or_default();
            day.0 += row.total_minutes;
            day.1 += row.total_characters;
        }
    }

    let mut media = media_totals.into_values().collect::<Vec<_>>();
    for aggregate in &mut media {
        aggregate.dates.sort_unstable();
        aggregate.dates.dedup();
    }
    let most_time = media.iter().max_by(|left, right| {
        left.total_minutes
            .cmp(&right.total_minutes)
            .then_with(|| left.total_characters.cmp(&right.total_characters))
            .then_with(|| right.media.id.cmp(&left.media.id))
    });
    let most_characters = media.iter().max_by(|left, right| {
        left.total_characters
            .cmp(&right.total_characters)
            .then_with(|| left.total_minutes.cmp(&right.total_minutes))
            .then_with(|| right.media.id.cmp(&left.media.id))
    });
    let most_sessions = media.iter().max_by(|left, right| {
        left.sessions
            .cmp(&right.sessions)
            .then_with(|| left.total_minutes.cmp(&right.total_minutes))
            .then_with(|| right.media.id.cmp(&left.media.id))
    });
    let biggest_day = day_totals
        .iter()
        .max_by(|(left_date, left), (right_date, right)| {
            left.0
                .cmp(&right.0)
                .then_with(|| left.1.cmp(&right.1))
                .then_with(|| right_date.cmp(left_date))
        });

    let biggest_streak = media
        .iter()
        .map(|aggregate| (aggregate, longest_streak(&aggregate.dates)))
        .max_by(|(left, left_streak), (right, right_streak)| {
            left_streak
                .cmp(right_streak)
                .then_with(|| left.total_minutes.cmp(&right.total_minutes))
                .then_with(|| right.media.id.cmp(&left.media.id))
        });

    let mut highlights = Vec::new();
    if let Some(entry) = most_time.filter(|entry| entry.total_minutes > 0) {
        highlights.push(media_highlight(DashboardHighlightKind::MostTime, entry, 0));
    }
    if let Some(entry) = most_characters.filter(|entry| entry.total_characters > 0) {
        highlights.push(media_highlight(
            DashboardHighlightKind::MostCharacters,
            entry,
            0,
        ));
    }
    if let Some(entry) = most_sessions.filter(|entry| entry.sessions > 0) {
        highlights.push(media_highlight(
            DashboardHighlightKind::MostSessions,
            entry,
            0,
        ));
    }
    if let Some((date, totals)) = biggest_day.filter(|(_, totals)| totals.0 > 0) {
        highlights.push(DashboardHighlight {
            kind: DashboardHighlightKind::BiggestDay,
            media: None,
            date: Some(date.clone()),
            total_minutes: totals.0,
            total_characters: totals.1,
            sessions: 0,
            streak_days: 0,
        });
    }
    if let Some((entry, streak)) = biggest_streak.filter(|(_, streak)| *streak > 0) {
        highlights.push(media_highlight(
            DashboardHighlightKind::BiggestStreak,
            entry,
            streak,
        ));
    }
    highlights
}

fn media_highlight(
    kind: DashboardHighlightKind,
    aggregate: &MediaHighlightAggregate,
    streak_days: i64,
) -> DashboardHighlight {
    DashboardHighlight {
        kind,
        media: Some(aggregate.media.clone()),
        date: None,
        total_minutes: aggregate.total_minutes,
        total_characters: aggregate.total_characters,
        sessions: aggregate.sessions,
        streak_days,
    }
}

fn longest_streak(dates: &[NaiveDate]) -> i64 {
    if dates.is_empty() {
        return 0;
    }
    let mut best = 1_i64;
    let mut current = 1_i64;
    for pair in dates.windows(2) {
        if pair[1].signed_duration_since(pair[0]).num_days() == 1 {
            current += 1;
            best = best.max(current);
        } else {
            current = 1;
        }
    }
    best
}

fn normalized_label(value: String, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        db,
        models::{ActivityLog, Media},
    };

    fn media(title: &str, variant: &str) -> Media {
        Media {
            id: None,
            uid: None,
            title: title.to_string(),
            variant: variant.to_string(),
            default_activity_type: "Reading".to_string(),
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: "large description that must not enter dashboard data".to_string(),
            cover_image: String::new(),
            extra_data: "{\"private\":true}".to_string(),
            content_type: "Novel".to_string(),
            tracking_status: "Ongoing".to_string(),
        }
    }

    fn test_connection() -> (tempfile::TempDir, Connection) {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("dashboard-test")).unwrap();
        (directory, conn)
    }

    #[test]
    fn validates_bounded_requests() {
        assert!(validate_recent_page(0, MAX_RECENT_LOG_PAGE_SIZE).is_ok());
        assert!(validate_recent_page(0, MAX_RECENT_LOG_PAGE_SIZE + 1).is_err());
        assert!(validate_range_request(&DashboardRangeRequest {
            request_id: 1,
            start_date: "2026-01-01".to_string(),
            end_date: "2026-04-01".to_string(),
            bucket: DashboardBucket::Day,
            group_by: DashboardGroupBy::ActivityType,
        })
        .is_err());
        assert!(validate_range_request(&DashboardRangeRequest {
            request_id: 1,
            start_date: "not-a-date".to_string(),
            end_date: "2026-04-01".to_string(),
            bucket: DashboardBucket::Month,
            group_by: DashboardGroupBy::ActivityType,
        })
        .is_err());
    }

    #[test]
    fn snapshot_is_bounded_and_excludes_large_media_fields() {
        let (_directory, conn) = test_connection();
        let media_id = db::add_media_with_id(&conn, &media("A", "Edition")).unwrap();
        for day in 1..=60 {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: day,
                    characters: day * 100,
                    date: format!("2026-06-{:02}", ((day - 1) % 30) + 1),
                    date_precision: DatePrecision::Day,
                    activity_type: "Reading".to_string(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }

        let request = DashboardSnapshotRequest {
            request_id: 42,
            today: "2026-06-10".to_string(),
            heatmap_year: 2026,
            recent_offset: 0,
            recent_limit: 15,
        };
        let snapshot = get_dashboard_snapshot(&conn, &request).unwrap().value;

        assert_eq!(snapshot.request_id, 42);
        assert_eq!(snapshot.summary.total_logs, 60);
        assert_eq!(snapshot.recent_logs.items.len(), 15);
        assert!(snapshot.heatmap.days.len() <= 366);
        let json = serde_json::to_string(&snapshot).unwrap();
        assert!(!json.contains("large description"));
        assert!(!json.contains("private"));
    }

    #[test]
    fn snapshot_weekday_distribution_includes_zero_days_in_a_bounded_six_month_window() {
        let (_directory, conn) = test_connection();
        let media_id = db::add_media_with_id(&conn, &media("A", "")).unwrap();
        for (date, duration_minutes, characters) in [
            ("2026-01-20", 900, 900_000),
            ("2026-07-13", 60, 10_000),
            ("2026-07-20", 120, 30_000),
            ("2026-07-23", 800, 800_000),
        ] {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes,
                    characters,
                    date: date.to_string(),
                    date_precision: DatePrecision::Day,
                    activity_type: "Reading".to_string(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }

        let snapshot = get_dashboard_snapshot(
            &conn,
            &DashboardSnapshotRequest {
                request_id: 43,
                today: "2026-07-22".to_string(),
                heatmap_year: 2026,
                recent_offset: 0,
                recent_limit: 15,
            },
        )
        .unwrap()
        .value;

        let distribution = snapshot.weekday_distribution;
        assert_eq!(distribution.start_date, "2026-01-21");
        assert_eq!(distribution.end_date, "2026-07-22");
        assert_eq!(distribution.days.len(), 7);
        assert_eq!(
            distribution
                .days
                .iter()
                .map(|day| day.sample_days)
                .sum::<i64>(),
            WEEKDAY_DISTRIBUTION_DAYS as i64,
        );
        let monday = distribution
            .days
            .iter()
            .find(|day| day.weekday == 1)
            .unwrap();
        assert_eq!(monday.median_minutes, 0.0);
        assert!((monday.average_minutes - 180.0 / monday.sample_days as f64).abs() < f64::EPSILON);
        assert_eq!(monday.median_characters, 0.0);
        assert!(
            (monday.average_characters - 40_000.0 / monday.sample_days as f64).abs() < f64::EPSILON
        );
    }

    #[test]
    fn recent_pages_are_stable_and_echo_request_ids() {
        let (_directory, conn) = test_connection();
        let media_id = db::add_media_with_id(&conn, &media("A", "")).unwrap();
        for day in 1..=20 {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: day,
                    characters: 0,
                    date: format!("2026-06-{day:02}"),
                    date_precision: DatePrecision::Day,
                    activity_type: "Reading".to_string(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }

        let page = get_dashboard_recent_logs(
            &conn,
            &DashboardRecentLogsRequest {
                request_id: 91,
                offset: 15,
                limit: 15,
            },
        )
        .unwrap()
        .value;
        assert_eq!(page.request_id, 91);
        assert_eq!(page.total_count, 20);
        assert_eq!(page.items.len(), 5);
        assert_eq!(page.items[0].date, "2026-06-05");
    }

    #[test]
    fn range_uses_historical_activity_type_and_current_media_category() {
        let (_directory, conn) = test_connection();
        let mut item = media("A", "");
        let media_id = db::add_media_with_id(&conn, &item).unwrap();
        db::add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 30,
                characters: 100,
                date: "2026-06-10".to_string(),
                date_precision: DatePrecision::Day,
                activity_type: "Watching".to_string(),
                notes: String::new(),
            },
        )
        .unwrap();
        item.id = Some(media_id);
        item.default_activity_type = "Playing".to_string();
        item.content_type = "Game".to_string();
        db::update_media(&conn, &item).unwrap();

        let range = get_dashboard_range(
            &conn,
            &DashboardRangeRequest {
                request_id: 7,
                start_date: "2026-06-08".to_string(),
                end_date: "2026-06-14".to_string(),
                bucket: DashboardBucket::Day,
                group_by: DashboardGroupBy::ActivityType,
            },
        )
        .unwrap()
        .value;

        assert_eq!(range.series[0].group_label, "Watching");
        assert_eq!(range.category_totals[0].label, "Game");
    }

    #[test]
    fn dashboard_settings_fall_back_to_defaults_for_missing_keys() {
        let (_directory, conn) = test_connection();
        let mut timings = Timings::default();
        let settings = query_dashboard_settings(&conn, &mut timings).unwrap();

        assert_eq!(settings.time_range_days, 7);
        assert_eq!(settings.metric, "minutes");
    }

    #[test]
    fn dashboard_settings_fall_back_for_an_out_of_set_time_range_and_a_garbage_metric() {
        let (_directory, conn) = test_connection();
        db::set_setting(&conn, "dashboard_time_range_days", "14").unwrap();
        db::set_setting(&conn, "dashboard_metric", "duration").unwrap();
        let mut timings = Timings::default();
        let settings = query_dashboard_settings(&conn, &mut timings).unwrap();

        assert_eq!(settings.time_range_days, 7);
        assert_eq!(settings.metric, "minutes");
    }

    #[test]
    fn dashboard_settings_return_a_validly_stored_time_range_and_metric() {
        let (_directory, conn) = test_connection();
        db::set_setting(&conn, "dashboard_time_range_days", "30").unwrap();
        db::set_setting(&conn, "dashboard_metric", "characters").unwrap();
        let mut timings = Timings::default();
        let settings = query_dashboard_settings(&conn, &mut timings).unwrap();

        assert_eq!(settings.time_range_days, 30);
        assert_eq!(settings.metric, "characters");
    }
}
