//! Bounded timeline pages backed by aggregate SQL reads.
//!
//! The legacy timeline path materialized every activity log (including notes)
//! before reducing them to one or two lifecycle events per title. This module
//! reads only grouped totals and dominant activity-type rows inside a single
//! transaction, then filters and pages the compact event set.

use std::collections::{BTreeSet, HashMap, HashSet};

use rusqlite::{Connection, Result};

use crate::models::{
    TimelineBucket, TimelineBucketGranularity, TimelineBucketHighlight, TimelineBucketPage,
    TimelineBucketRequest, TimelineEvent, TimelineEventKind, TimelinePage, TimelinePageRequest,
    TimelineSummary,
};
use crate::read_performance::{Measured, Timings};

pub const MAX_TIMELINE_PAGE_SIZE: i64 = 100;
const MAX_TIMELINE_OFFSET: i64 = 1_000_000;
const MAX_TIMELINE_SEARCH_CHARS: usize = 200;
/// Cover-strip capacity per bucket, derived from the CSS that lays the strip out
const MAX_MONTH_BUCKET_HIGHLIGHTS: usize = 14;
const MAX_YEAR_BUCKET_HIGHLIGHTS: usize = 28;
const MAX_TIMELINE_BUCKETS: usize = 600;

#[derive(Clone)]
struct TimelineMediaContext {
    media_id: i64,
    media_title: String,
    media_variant: String,
    cover_image: String,
    activity_type: String,
    content_type: String,
    tracking_status: String,
    first_date: String,
    last_date: String,
    total_minutes: i64,
    total_characters: i64,
    same_day_terminal: bool,
}

struct TimelineBucketMediaCover {
    media_title: String,
    media_variant: String,
    cover_image: String,
}

struct TimelineMediaRow {
    media_id: i64,
    media_title: String,
    media_variant: String,
    cover_image: String,
    fallback_activity_type: String,
    content_type: String,
    tracking_status: String,
    first_date: Option<String>,
    last_date: Option<String>,
    total_minutes: i64,
    total_characters: i64,
}

pub fn validate_page_request(request: &TimelinePageRequest) -> std::result::Result<(), String> {
    if request.offset < 0 || request.offset > MAX_TIMELINE_OFFSET {
        return Err(format!(
            "timeline offset must be between 0 and {MAX_TIMELINE_OFFSET}"
        ));
    }
    if !(1..=MAX_TIMELINE_PAGE_SIZE).contains(&request.limit) {
        return Err(format!(
            "timeline limit must be between 1 and {MAX_TIMELINE_PAGE_SIZE}"
        ));
    }
    if request
        .year
        .is_some_and(|year| !(1..=9_999).contains(&year))
    {
        return Err("timeline year must be between 1 and 9999".to_string());
    }
    if request.search_query.chars().count() > MAX_TIMELINE_SEARCH_CHARS {
        return Err(format!(
            "timeline search is limited to {MAX_TIMELINE_SEARCH_CHARS} characters"
        ));
    }
    Ok(())
}

pub fn validate_bucket_request(
    request: &TimelineBucketRequest,
) -> std::result::Result<(), String> {
    if request.search_query.chars().count() > MAX_TIMELINE_SEARCH_CHARS {
        return Err(format!(
            "timeline search is limited to {MAX_TIMELINE_SEARCH_CHARS} characters"
        ));
    }
    Ok(())
}

pub fn get_timeline_page(
    conn: &Connection,
    request: &TimelinePageRequest,
) -> Result<Measured<TimelinePage>> {
    let mut timings = Timings::default();
    let transaction = timings.query(|| conn.unchecked_transaction())?;
    let (all_events, _contexts) = query_timeline_events(&transaction, &mut timings)?;

    let page = timings.aggregate(|| build_page(all_events, request));
    timings.query(|| transaction.commit())?;
    Ok(timings.finish(page))
}

pub fn get_timeline_buckets(
    conn: &Connection,
    request: &TimelineBucketRequest,
) -> Result<Measured<TimelineBucketPage>> {
    let mut timings = Timings::default();
    let transaction = timings.query(|| conn.unchecked_transaction())?;
    let (all_events, contexts) = query_timeline_events(&transaction, &mut timings)?;
    let bucket_totals =
        query_media_bucket_totals(&transaction, &mut timings, &request.granularity)?;
    let page =
        timings.aggregate(|| build_bucket_page(all_events, contexts, bucket_totals, request));
    timings.query(|| transaction.commit())?;
    Ok(timings.finish(page))
}

/// Compatibility entrypoint for the public `/timeline` API and existing tests.
/// It uses the same aggregate query but intentionally does not page the result.
pub fn get_all_timeline_events(conn: &Connection) -> Result<Vec<TimelineEvent>> {
    let mut timings = Timings::default();
    let transaction = timings.query(|| conn.unchecked_transaction())?;
    let (events, _contexts) = query_timeline_events(&transaction, &mut timings)?;
    timings.query(|| transaction.commit())?;
    Ok(events)
}

fn query_timeline_events(
    conn: &Connection,
    timings: &mut Timings,
) -> Result<(Vec<TimelineEvent>, HashMap<i64, TimelineMediaContext>)> {
    let media_rows = query_media_rows(conn, timings)?;
    let dominant_activity_types = query_dominant_activity_types(conn, timings)?;

    let mut contexts = HashMap::<i64, TimelineMediaContext>::new();
    let mut events = Vec::new();

    timings.aggregate(|| {
        for row in media_rows {
            let has_logs = row.first_date.is_some() && row.last_date.is_some();
            let first_date = row.first_date.unwrap_or_default();
            let last_date = row.last_date.unwrap_or_default();
            let terminal_event = terminal_kind(&row.tracking_status);
            let same_day_terminal = has_logs && terminal_event.is_some() && first_date == last_date;
            let context = TimelineMediaContext {
                media_id: row.media_id,
                media_title: row.media_title,
                media_variant: row.media_variant,
                cover_image: row.cover_image,
                activity_type: dominant_activity_types
                    .get(&row.media_id)
                    .cloned()
                    .unwrap_or(row.fallback_activity_type),
                content_type: row.content_type,
                tracking_status: row.tracking_status,
                first_date: first_date.clone(),
                last_date: last_date.clone(),
                total_minutes: row.total_minutes,
                total_characters: row.total_characters,
                same_day_terminal,
            };
            contexts.insert(row.media_id, context.clone());

            if !has_logs {
                continue;
            }

            if let Some(kind) = terminal_event {
                events.push(build_timeline_event(
                    &context, kind, last_date, None, None, 0, 0,
                ));
                if !same_day_terminal {
                    events.push(build_timeline_event(
                        &context,
                        TimelineEventKind::Started,
                        first_date,
                        None,
                        None,
                        0,
                        0,
                    ));
                }
            } else {
                events.push(build_timeline_event(
                    &context,
                    TimelineEventKind::Started,
                    first_date,
                    None,
                    None,
                    0,
                    0,
                ));
            }
        }
    });

    let milestone_rows = timings.query(|| {
        let mut statement = conn.prepare(
            "SELECT milestone.id, milestone.name, milestone.duration,
                    milestone.characters, milestone.date, media.id
             FROM main.milestones milestone
             JOIN shared.media media ON media.uid = milestone.media_uid
             WHERE milestone.date IS NOT NULL",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, Option<i64>>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>>>()
    })?;

    timings.aggregate(|| {
        for (milestone_id, name, duration, characters, date, media_id) in milestone_rows {
            let Some(context) = contexts.get(&media_id) else {
                continue;
            };
            events.push(build_timeline_event(
                context,
                TimelineEventKind::Milestone,
                date,
                Some(name),
                milestone_id,
                duration,
                characters,
            ));
        }

        events.sort_by(|left, right| {
            right
                .date
                .cmp(&left.date)
                .then_with(|| timeline_sort_rank(left).cmp(&timeline_sort_rank(right)))
                .then_with(|| left.media_title.cmp(&right.media_title))
                .then_with(|| left.media_id.cmp(&right.media_id))
                .then_with(|| right.milestone_id.cmp(&left.milestone_id))
        });
    });

    Ok((events, contexts))
}

fn query_media_rows(conn: &Connection, timings: &mut Timings) -> Result<Vec<TimelineMediaRow>> {
    timings.query(|| {
        let mut statement = conn.prepare(
            "SELECT media.id, media.title, media.variant, media.cover_image,
                    media.default_activity_type, media.content_type,
                    media.tracking_status,
                    MIN(CASE WHEN log.date_precision = 'day' THEN log.date END),
                    MAX(CASE WHEN log.date_precision = 'day' THEN log.date END),
                    COALESCE(SUM(log.duration_minutes), 0),
                    COALESCE(SUM(log.characters), 0)
             FROM shared.media media
             LEFT JOIN main.activity_logs log ON log.media_id = media.id
             GROUP BY media.id, media.title, media.variant, media.cover_image,
                      media.default_activity_type, media.content_type,
                      media.tracking_status",
        )?;
        let rows = statement.query_map([], |row| {
            Ok(TimelineMediaRow {
                media_id: row.get(0)?,
                media_title: row.get(1)?,
                media_variant: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                cover_image: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                fallback_activity_type: row.get(4)?,
                content_type: row
                    .get::<_, Option<String>>(5)?
                    .unwrap_or_else(|| "Unknown".to_string()),
                tracking_status: row
                    .get::<_, Option<String>>(6)?
                    .unwrap_or_else(|| "Untracked".to_string()),
                first_date: row.get(7)?,
                last_date: row.get(8)?,
                total_minutes: row.get(9)?,
                total_characters: row.get(10)?,
            })
        })?;
        rows.collect::<Result<Vec<_>>>()
    })
}

fn query_dominant_activity_types(
    conn: &Connection,
    timings: &mut Timings,
) -> Result<HashMap<i64, String>> {
    let query =
        "WITH activity_counts AS (
             SELECT media_id, activity_type, COUNT(*) AS activity_count
             FROM main.activity_logs
             GROUP BY media_id, activity_type
         )
         SELECT counts.media_id, counts.activity_type, counts.activity_count,
                (
                    SELECT recent.effective_end
                    FROM main.activity_logs recent
                    WHERE recent.media_id = counts.media_id
                      AND recent.activity_type = counts.activity_type
                    ORDER BY recent.effective_end DESC, recent.precision_key_length ASC, recent.id DESC
                    LIMIT 1
                ) AS latest_effective_end,
                (
                    SELECT recent.precision_key_length
                    FROM main.activity_logs recent
                    WHERE recent.media_id = counts.media_id
                      AND recent.activity_type = counts.activity_type
                    ORDER BY recent.effective_end DESC, recent.precision_key_length ASC, recent.id DESC
                    LIMIT 1
                ) AS latest_precision_key_length,
                (
                    SELECT recent.id
                    FROM main.activity_logs recent
                    WHERE recent.media_id = counts.media_id
                      AND recent.activity_type = counts.activity_type
                    ORDER BY recent.effective_end DESC, recent.precision_key_length ASC, recent.id DESC
                    LIMIT 1
                ) AS latest_id
         FROM activity_counts counts
         ORDER BY counts.media_id ASC, counts.activity_count DESC,
                  latest_effective_end DESC, latest_precision_key_length ASC,
                  latest_id DESC, counts.activity_type ASC";
    let rows = timings.query(|| {
        let mut statement = conn.prepare(query)?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
        })?;
        rows.collect::<Result<Vec<_>>>()
    })?;

    Ok(timings.aggregate(|| {
        let mut dominant = HashMap::new();
        for (media_id, activity_type) in rows {
            dominant.entry(media_id).or_insert(activity_type);
        }
        dominant
    }))
}

/// One row per (media, month) with logged minutes/characters summed across
/// `activity_logs`. This is intentionally independent of any lifecycle event:
/// a title read across several months logs time in all of them even though it
/// only ever produces one or two timeline events.
fn query_media_bucket_totals(
    conn: &Connection,
    timings: &mut Timings,
    granularity: &TimelineBucketGranularity,
) -> Result<Vec<(i64, String, i64, i64)>> {
    let key_len = i64::try_from(bucket_key_len(granularity)).unwrap_or(7);
    let query =
        "SELECT media_id,
                substr(date, 1, ?1),
                COALESCE(SUM(duration_minutes), 0),
                COALESCE(SUM(characters), 0)
         FROM main.activity_logs
         WHERE date <> '' AND precision_key_length >= ?1
         GROUP BY media_id, substr(date, 1, ?1)";
    timings.query(|| {
        let mut statement = conn.prepare(query)?;
        let rows = statement.query_map([key_len], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, i64>(3)?,
            ))
        })?;
        rows.collect::<Result<Vec<_>>>()
    })
}

fn compute_available_years(
    events: &[TimelineEvent],
    bucket_totals: &[(i64, String, i64, i64)],
) -> Vec<i32> {
    let mut years = events
        .iter()
        .filter_map(|event| event.date.get(0..4)?.parse::<i32>().ok())
        .collect::<BTreeSet<_>>();
    years.extend(
        bucket_totals
            .iter()
            .filter_map(|(_, bucket_key, _, _)| bucket_key.get(0..4)?.parse::<i32>().ok()),
    );
    years.into_iter().rev().collect()
}

fn compute_ambiguous_titles(events: &[TimelineEvent]) -> Vec<String> {
    let mut media_ids_by_title = HashMap::<&str, HashSet<i64>>::new();
    for event in events {
        media_ids_by_title
            .entry(event.media_title.as_str())
            .or_default()
            .insert(event.media_id);
    }
    let mut ambiguous_titles = media_ids_by_title
        .into_iter()
        .filter_map(|(title, media_ids)| (media_ids.len() > 1).then_some(title.to_string()))
        .collect::<Vec<_>>();
    ambiguous_titles.sort();
    ambiguous_titles
}

fn compute_bucket_ambiguous_titles(
    contexts: &HashMap<i64, TimelineMediaContext>,
    search_matched_media: &HashSet<i64>,
) -> Vec<String> {
    let mut media_ids_by_title = HashMap::<&str, HashSet<i64>>::new();
    for context in contexts.values() {
        if search_matched_media.contains(&context.media_id) {
            media_ids_by_title
                .entry(context.media_title.as_str())
                .or_default()
                .insert(context.media_id);
        }
    }
    let mut ambiguous_titles = media_ids_by_title
        .into_iter()
        .filter_map(|(title, media_ids)| (media_ids.len() > 1).then_some(title.to_string()))
        .collect::<Vec<_>>();
    ambiguous_titles.sort();
    ambiguous_titles
}

fn matches_year(event: &TimelineEvent, year: Option<i32>) -> bool {
    match year {
        None => true,
        Some(target) => {
            event
                .date
                .get(0..4)
                .and_then(|value| value.parse::<i32>().ok())
                == Some(target)
        }
    }
}

fn matches_kind(event: &TimelineEvent, kind: Option<&TimelineEventKind>) -> bool {
    match kind {
        None => true,
        Some(target) => &event.kind == target,
    }
}

fn matches_search_fields(
    media_title: &str,
    media_variant: &str,
    activity_type: &str,
    content_type: &str,
    normalized_query: &str,
) -> bool {
    normalized_query.is_empty()
        || media_title.to_lowercase().contains(normalized_query)
        || media_variant.to_lowercase().contains(normalized_query)
        || activity_type.to_lowercase().contains(normalized_query)
        || content_type.to_lowercase().contains(normalized_query)
}

fn matches_search(event: &TimelineEvent, normalized_query: &str) -> bool {
    matches_search_fields(
        &event.media_title,
        &event.media_variant,
        &event.activity_type,
        &event.content_type,
        normalized_query,
    ) || event
        .milestone_name
        .as_deref()
        .unwrap_or_default()
        .to_lowercase()
        .contains(normalized_query)
}

fn context_matches_search(context: &TimelineMediaContext, normalized_query: &str) -> bool {
    matches_search_fields(
        &context.media_title,
        &context.media_variant,
        &context.activity_type,
        &context.content_type,
        normalized_query,
    )
}

fn build_page(events: Vec<TimelineEvent>, request: &TimelinePageRequest) -> TimelinePage {
    let all_event_count = i64::try_from(events.len()).unwrap_or(i64::MAX);
    let available_years = compute_available_years(&events, &[]);
    let ambiguous_titles = compute_ambiguous_titles(&events);
    let normalized_query = request.search_query.trim().to_lowercase();
    let filtered = events
        .into_iter()
        .filter(|event| {
            matches_year(event, request.year)
                && matches_kind(event, request.kind.as_ref())
                && matches_search(event, &normalized_query)
        })
        .collect::<Vec<_>>();

    let summary = summarize(&filtered);
    let total_count = i64::try_from(filtered.len()).unwrap_or(i64::MAX);
    let start = usize::try_from(request.offset)
        .unwrap_or(usize::MAX)
        .min(filtered.len());
    let page_size = usize::try_from(request.limit).unwrap_or_default();
    let end = start.saturating_add(page_size).min(filtered.len());
    let page_events = filtered[start..end].to_vec();

    TimelinePage {
        request_id: request.request_id,
        offset: request.offset,
        limit: request.limit,
        total_count,
        all_event_count,
        has_more: end < filtered.len(),
        available_years,
        ambiguous_titles,
        summary,
        events: page_events,
    }
}

fn max_bucket_highlights(granularity: &TimelineBucketGranularity) -> usize {
    match granularity {
        TimelineBucketGranularity::Month => MAX_MONTH_BUCKET_HIGHLIGHTS,
        TimelineBucketGranularity::Year => MAX_YEAR_BUCKET_HIGHLIGHTS,
    }
}

fn bucket_key_len(granularity: &TimelineBucketGranularity) -> usize {
    match granularity {
        TimelineBucketGranularity::Month => 7,
        TimelineBucketGranularity::Year => 4,
    }
}

fn bucket_start_date(key: &str, granularity: &TimelineBucketGranularity) -> String {
    match granularity {
        TimelineBucketGranularity::Month => format!("{key}-01"),
        TimelineBucketGranularity::Year => format!("{key}-01-01"),
    }
}

/// Orders a bucket's covers by how much of that period the user actually spent on each title.
/// Minutes and characters are each normalised against the bucket's own maximum, so a
/// time-tracked title and a character-tracked one stay comparable without inventing a
/// characters-per-minute exchange rate. Equal scores keep their incoming order.
fn sort_media_by_immersion(
    media_ids: &mut [i64],
    media_totals: Option<&HashMap<i64, (i64, i64)>>,
) {
    let Some(media_totals) = media_totals else {
        return;
    };
    let (max_minutes, max_characters) = media_totals.values().fold(
        (0i64, 0i64),
        |(max_minutes, max_characters), (minutes, characters)| {
            (max_minutes.max(*minutes), max_characters.max(*characters))
        },
    );
    let immersion_score = |media_id: i64| -> f64 {
        let (minutes, characters) = media_totals.get(&media_id).copied().unwrap_or((0, 0));
        let minutes_share = if max_minutes > 0 {
            minutes as f64 / max_minutes as f64
        } else {
            0.0
        };
        let characters_share = if max_characters > 0 {
            characters as f64 / max_characters as f64
        } else {
            0.0
        };
        minutes_share + characters_share
    };

    let mut decorated = media_ids
        .iter()
        .enumerate()
        .map(|(index, &media_id)| (immersion_score(media_id), index, media_id))
        .collect::<Vec<_>>();
    decorated.sort_unstable_by(|left, right| {
        right
            .0
            .total_cmp(&left.0)
            .then_with(|| left.1.cmp(&right.1))
    });
    for (slot, (_, _, media_id)) in media_ids.iter_mut().zip(decorated) {
        *slot = media_id;
    }
}

fn build_bucket_page(
    events: Vec<TimelineEvent>,
    contexts: HashMap<i64, TimelineMediaContext>,
    bucket_totals: Vec<(i64, String, i64, i64)>,
    request: &TimelineBucketRequest,
) -> TimelineBucketPage {
    let available_years = compute_available_years(&events, &bucket_totals);

    let normalized_query = request.search_query.trim().to_lowercase();
    let search_matched_events = events
        .into_iter()
        .filter(|event| matches_search(event, &normalized_query))
        .collect::<Vec<_>>();
    let mut search_matched_media = search_matched_events
        .iter()
        .map(|event| event.media_id)
        .collect::<HashSet<_>>();
    for context in contexts.values() {
        if context_matches_search(context, &normalized_query) {
            search_matched_media.insert(context.media_id);
        }
    }

    let ambiguous_titles =
        compute_bucket_ambiguous_titles(&contexts, &search_matched_media);

    let mut media_covers = HashMap::<i64, TimelineBucketMediaCover>::new();
    for media_id in &search_matched_media {
        let Some(context) = contexts.get(media_id) else {
            continue;
        };
        if context.cover_image.is_empty() {
            continue;
        }
        media_covers.insert(
            *media_id,
            TimelineBucketMediaCover {
                media_title: context.media_title.clone(),
                media_variant: context.media_variant.clone(),
                cover_image: context.cover_image.clone(),
            },
        );
    }

    let filtered_events = search_matched_events
        .into_iter()
        .filter(|event| matches_year(event, request.year))
        .collect::<Vec<_>>();

    let key_len = bucket_key_len(&request.granularity);

    let mut bucket_keys = BTreeSet::new();
    for event in &filtered_events {
        if let Some(key) = event.date.get(0..key_len) {
            bucket_keys.insert(key.to_string());
        }
    }
    for (media_id, bucket_key, _, _) in &bucket_totals {
        if !search_matched_media.contains(media_id) {
            continue;
        }
        if let Some(key) = bucket_key.get(0..key_len) {
            bucket_keys.insert(key.to_string());
        }
    }
    if let Some(year) = request.year {
        bucket_keys.retain(|key| {
            key.get(0..4).and_then(|value| value.parse::<i32>().ok()) == Some(year)
        });
    }

    let mut bucket_index = HashMap::<String, usize>::with_capacity(bucket_keys.len());
    let mut buckets = Vec::with_capacity(bucket_keys.len());
    for key in bucket_keys {
        bucket_index.insert(key.clone(), buckets.len());
        let start_date = bucket_start_date(&key, &request.granularity);
        buckets.push(TimelineBucket {
            key,
            start_date,
            started_count: 0,
            finished_count: 0,
            paused_count: 0,
            dropped_count: 0,
            milestone_count: 0,
            logged_minutes: 0,
            logged_characters: 0,
            highlights: Vec::new(),
            distinct_media_count: 0,
        });
    }
    let bucket_count = buckets.len();
    let mut bucket_media_totals = (0..bucket_count)
        .map(|_| HashMap::<i64, (i64, i64)>::new())
        .collect::<Vec<_>>();
    let mut bucket_distinct_media = vec![HashSet::<i64>::new(); bucket_count];
    let mut bucket_highlight_seen = vec![HashSet::<i64>::new(); bucket_count];
    let mut bucket_highlight_candidates = vec![Vec::<i64>::new(); bucket_count];
    let mut bucket_eligible_media = HashSet::<i64>::new();

    for (media_id, bucket_key, minutes, characters) in &bucket_totals {
        if !search_matched_media.contains(media_id) {
            continue;
        }
        let Some(key) = bucket_key.get(0..key_len) else {
            continue;
        };
        let Some(&index) = bucket_index.get(key) else {
            continue;
        };
        bucket_eligible_media.insert(*media_id);
        let bucket = &mut buckets[index];
        bucket.logged_minutes += minutes;
        bucket.logged_characters += characters;
        let media_total = bucket_media_totals[index]
            .entry(*media_id)
            .or_insert((0, 0));
        media_total.0 += minutes;
        media_total.1 += characters;
    }

    let summary = summarize_bucket_page(&filtered_events, &contexts, &bucket_eligible_media);

    for event in &filtered_events {
        let Some(key) = event.date.get(0..key_len) else {
            continue;
        };
        let Some(&index) = bucket_index.get(key) else {
            continue;
        };

        match event.kind {
            TimelineEventKind::Started => buckets[index].started_count += 1,
            TimelineEventKind::Finished => buckets[index].finished_count += 1,
            TimelineEventKind::Paused => buckets[index].paused_count += 1,
            TimelineEventKind::Dropped => buckets[index].dropped_count += 1,
            TimelineEventKind::Milestone => buckets[index].milestone_count += 1,
        }

        bucket_distinct_media[index].insert(event.media_id);

        if matches!(
            event.kind,
            TimelineEventKind::Started | TimelineEventKind::Finished
        ) && media_covers.contains_key(&event.media_id)
            && bucket_highlight_seen[index].insert(event.media_id)
        {
            bucket_highlight_candidates[index].push(event.media_id);
        }
    }

    for index in 0..bucket_count {
        bucket_distinct_media[index].extend(bucket_media_totals[index].keys().copied());
        let mut logged_only_media = bucket_media_totals[index]
            .keys()
            .copied()
            .filter(|media_id| {
                media_covers.contains_key(media_id)
                    && !bucket_highlight_seen[index].contains(media_id)
            })
            .collect::<Vec<_>>();
        logged_only_media.sort_unstable();
        for media_id in logged_only_media {
            bucket_highlight_seen[index].insert(media_id);
            bucket_highlight_candidates[index].push(media_id);
        }
    }

    for index in 0..bucket_count {
        let mut candidates = std::mem::take(&mut bucket_highlight_candidates[index]);
        if !candidates.is_empty() {
            sort_media_by_immersion(&mut candidates, Some(&bucket_media_totals[index]));
            candidates.truncate(max_bucket_highlights(&request.granularity));
            buckets[index].highlights = candidates
                .into_iter()
                .filter_map(|media_id| {
                    media_covers
                        .get(&media_id)
                        .map(|cover| TimelineBucketHighlight {
                            media_id,
                            media_title: cover.media_title.clone(),
                            media_variant: cover.media_variant.clone(),
                            cover_image: cover.cover_image.clone(),
                        })
                })
                .collect();
        }
        let distinct = bucket_distinct_media[index].len();
        buckets[index].distinct_media_count = i64::try_from(distinct).unwrap_or(i64::MAX);
    }

    buckets.sort_by(|left, right| right.key.cmp(&left.key));
    buckets.truncate(MAX_TIMELINE_BUCKETS);

    TimelineBucketPage {
        request_id: request.request_id,
        granularity: request.granularity.clone(),
        available_years,
        ambiguous_titles,
        summary,
        buckets,
    }
}

fn summarize(events: &[TimelineEvent]) -> TimelineSummary {
    let mut media_totals = HashMap::<i64, (i64, i64)>::new();
    let mut completed_titles = HashSet::new();
    for event in events {
        media_totals
            .entry(event.media_id)
            .or_insert((event.total_minutes, event.total_characters));
        if event.kind == TimelineEventKind::Finished {
            completed_titles.insert(event.media_id);
        }
    }

    TimelineSummary {
        total_minutes: media_totals.values().map(|value| value.0).sum(),
        completed_titles: i64::try_from(completed_titles.len()).unwrap_or(i64::MAX),
        total_characters: media_totals.values().map(|value| value.1).sum(),
        filtered_media_count: i64::try_from(media_totals.len()).unwrap_or(i64::MAX),
    }
}

fn summarize_bucket_page(
    filtered_events: &[TimelineEvent],
    contexts: &HashMap<i64, TimelineMediaContext>,
    bucket_eligible_media: &HashSet<i64>,
) -> TimelineSummary {
    let mut media_totals = HashMap::<i64, (i64, i64)>::new();
    let mut completed_titles = HashSet::new();
    for event in filtered_events {
        media_totals
            .entry(event.media_id)
            .or_insert((event.total_minutes, event.total_characters));
        if event.kind == TimelineEventKind::Finished {
            completed_titles.insert(event.media_id);
        }
    }
    for media_id in bucket_eligible_media {
        if media_totals.contains_key(media_id) {
            continue;
        }
        if let Some(context) = contexts.get(media_id) {
            media_totals.insert(*media_id, (context.total_minutes, context.total_characters));
        }
    }

    TimelineSummary {
        total_minutes: media_totals.values().map(|value| value.0).sum(),
        completed_titles: i64::try_from(completed_titles.len()).unwrap_or(i64::MAX),
        total_characters: media_totals.values().map(|value| value.1).sum(),
        filtered_media_count: i64::try_from(media_totals.len()).unwrap_or(i64::MAX),
    }
}

fn terminal_kind(tracking_status: &str) -> Option<TimelineEventKind> {
    match tracking_status {
        "Complete" => Some(TimelineEventKind::Finished),
        "Paused" => Some(TimelineEventKind::Paused),
        "Dropped" => Some(TimelineEventKind::Dropped),
        _ => None,
    }
}

fn timeline_sort_rank(event: &TimelineEvent) -> u8 {
    let is_terminal = terminal_kind(&event.tracking_status).is_some();
    match event.kind {
        TimelineEventKind::Milestone if !is_terminal => 0,
        TimelineEventKind::Started => 1,
        TimelineEventKind::Finished | TimelineEventKind::Paused | TimelineEventKind::Dropped
            if event.same_day_terminal =>
        {
            2
        }
        TimelineEventKind::Finished | TimelineEventKind::Paused | TimelineEventKind::Dropped => 3,
        TimelineEventKind::Milestone => 4,
    }
}

fn build_timeline_event(
    context: &TimelineMediaContext,
    kind: TimelineEventKind,
    date: String,
    milestone_name: Option<String>,
    milestone_id: Option<i64>,
    milestone_minutes: i64,
    milestone_characters: i64,
) -> TimelineEvent {
    TimelineEvent {
        kind,
        date,
        media_id: context.media_id,
        media_title: context.media_title.clone(),
        media_variant: context.media_variant.clone(),
        cover_image: context.cover_image.clone(),
        activity_type: context.activity_type.clone(),
        content_type: context.content_type.clone(),
        tracking_status: context.tracking_status.clone(),
        milestone_name,
        milestone_id,
        first_date: context.first_date.clone(),
        last_date: context.last_date.clone(),
        total_minutes: context.total_minutes,
        total_characters: context.total_characters,
        milestone_minutes,
        milestone_characters,
        same_day_terminal: context.same_day_terminal,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        db,
        models::{ActivityLog, Media, Milestone},
    };

    fn media(title: &str, tracking_status: &str) -> Media {
        Media {
            id: None,
            uid: None,
            title: title.to_string(),
            variant: String::new(),
            default_activity_type: "Reading".to_string(),
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: "description must not be read for timeline".to_string(),
            cover_image: String::new(),
            extra_data: "{\"large\":true}".to_string(),
            content_type: "Novel".to_string(),
            tracking_status: tracking_status.to_string(),
        }
    }

    #[test]
    fn validates_page_bounds() {
        let request = TimelinePageRequest {
            request_id: 1,
            year: None,
            kind: None,
            search_query: String::new(),
            offset: 0,
            limit: MAX_TIMELINE_PAGE_SIZE,
        };
        assert!(validate_page_request(&request).is_ok());
        assert!(validate_page_request(&TimelinePageRequest {
            limit: MAX_TIMELINE_PAGE_SIZE + 1,
            ..request.clone()
        })
        .is_err());
        assert!(validate_page_request(&TimelinePageRequest {
            offset: -1,
            ..request
        })
        .is_err());
    }

    #[test]
    fn pages_compact_events_and_echoes_request_identity() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("timeline-test")).unwrap();
        let completed_id = db::add_media_with_id(&conn, &media("Completed", "Complete")).unwrap();
        let ongoing_id = db::add_media_with_id(&conn, &media("Ongoing", "Ongoing")).unwrap();
        for (media_id, date, minutes) in [
            (completed_id, "2025-01-01", 30),
            (completed_id, "2026-01-02", 60),
            (ongoing_id, "2026-02-03", 15),
        ] {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: minutes,
                    characters: 0,
                    date: date.to_string(),
                    date_precision: db::DatePrecision::Day,
                    activity_type: "Reading".to_string(),
                    notes: "large notes must not be returned".to_string(),
                },
            )
            .unwrap();
        }
        let completed_media = db::get_all_media(&conn)
            .unwrap()
            .into_iter()
            .find(|item| item.id == Some(completed_id))
            .unwrap();
        db::add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: completed_media.uid,
                media_title: String::new(),
                name: "Halfway".to_string(),
                duration: 45,
                characters: 0,
                date: Some("2026-01-15".to_string()),
            },
        )
        .unwrap();

        let page = get_timeline_page(
            &conn,
            &TimelinePageRequest {
                request_id: 44,
                year: Some(2026),
                kind: None,
                search_query: "completed".to_string(),
                offset: 0,
                limit: 2,
                },
        )
        .unwrap()
        .value;

        assert_eq!(page.request_id, 44);
        assert_eq!(page.total_count, 2);
        assert_eq!(page.all_event_count, 4);
        assert_eq!(page.events.len(), 2);
        assert!(!page.has_more);
        assert_eq!(page.available_years, vec![2026, 2025]);
        assert_eq!(page.summary.total_minutes, 90);
        assert_eq!(page.summary.completed_titles, 1);
        assert_eq!(page.summary.filtered_media_count, 1);
        let json = serde_json::to_string(&page).unwrap();
        assert!(!json.contains("large notes"));
        assert!(!json.contains("description must not"));
    }

    #[test]
    fn filtered_media_count_reflects_the_kind_filter_not_just_finished_titles() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("timeline-kind-filter")).unwrap();
        let paused_id = db::add_media_with_id(&conn, &media("Paused Title", "Paused")).unwrap();
        let dropped_id = db::add_media_with_id(&conn, &media("Dropped Title", "Dropped")).unwrap();
        for (media_id, date) in [(paused_id, "2026-01-01"), (dropped_id, "2026-01-05")] {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: 20,
                    characters: 0,
                    date: date.to_string(),
                    date_precision: db::DatePrecision::Day,
                    activity_type: "Reading".to_string(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }

        let page = get_timeline_page(
            &conn,
            &TimelinePageRequest {
                request_id: 1,
                year: None,
                kind: Some(TimelineEventKind::Paused),
                search_query: String::new(),
                offset: 0,
                limit: MAX_TIMELINE_PAGE_SIZE,
                },
        )
        .unwrap()
        .value;

        assert_eq!(page.summary.completed_titles, 0);
        assert_eq!(page.summary.filtered_media_count, 1);
    }

    #[test]
    fn dominant_activity_ties_use_the_newest_log_by_date_then_id() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("timeline-tie-test")).unwrap();
        let media_id = db::add_media_with_id(&conn, &media("Mixed", "Ongoing")).unwrap();

        // Both activity types have the same count and latest date. The
        // Watching log on that date has the newer id, even though Reading has
        // the largest id overall because an older log was inserted last.
        for (date, activity_type) in [
            ("2026-02-01", "Reading"),
            ("2026-01-01", "Watching"),
            ("2026-02-01", "Watching"),
            ("2026-01-01", "Reading"),
        ] {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: 10,
                    characters: 0,
                    date: date.to_string(),
                    date_precision: db::DatePrecision::Day,
                    activity_type: activity_type.to_string(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }

        let events = get_all_timeline_events(&conn).unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].activity_type, "Watching");
    }

    fn media_with_cover(title: &str, tracking_status: &str, cover_image: &str) -> Media {
        Media {
            cover_image: cover_image.to_string(),
            ..media(title, tracking_status)
        }
    }

    fn bucket_request(
        granularity: TimelineBucketGranularity,
        year: Option<i32>,
        search_query: &str,
    ) -> TimelineBucketRequest {
        TimelineBucketRequest {
            request_id: 1,
            granularity,
            year,
            search_query: search_query.to_string(),
        }
    }

    #[test]
    fn folds_month_and_year_buckets_and_year_equals_sum_of_months() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("bucket-fold")).unwrap();
        let media_id = db::add_media_with_id(&conn, &media("Novel", "Complete")).unwrap();
        for (date, minutes, characters) in
            [("2026-01-05", 20, 100), ("2026-02-10", 10, 50)]
        {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: minutes,
                    characters,
                    date: date.to_string(),
                    date_precision: db::DatePrecision::Day,
                    activity_type: "Reading".to_string(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }

        let months = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Month, None, ""),
        )
        .unwrap()
        .value;
        assert_eq!(months.buckets.len(), 2);
        assert_eq!(months.buckets[0].key, "2026-02");
        assert_eq!(months.buckets[0].finished_count, 1);
        assert_eq!(months.buckets[0].logged_minutes, 10);
        assert_eq!(months.buckets[0].logged_characters, 50);
        assert_eq!(months.buckets[1].key, "2026-01");
        assert_eq!(months.buckets[1].started_count, 1);
        assert_eq!(months.buckets[1].logged_minutes, 20);
        assert_eq!(months.buckets[1].logged_characters, 100);

        let years = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Year, None, ""),
        )
        .unwrap()
        .value;
        assert_eq!(years.buckets.len(), 1);
        let year_bucket = &years.buckets[0];
        assert_eq!(year_bucket.key, "2026");
        assert_eq!(year_bucket.started_count, 1);
        assert_eq!(year_bucket.finished_count, 1);
        assert_eq!(
            year_bucket.logged_minutes,
            months.buckets[0].logged_minutes + months.buckets[1].logged_minutes
        );
        assert_eq!(
            year_bucket.logged_characters,
            months.buckets[0].logged_characters + months.buckets[1].logged_characters
        );
    }

    #[test]
    fn search_filter_narrows_pips_and_logged_minutes_consistently() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("bucket-search")).unwrap();
        let kept_id = db::add_media_with_id(&conn, &media("Keep Me", "Ongoing")).unwrap();
        let dropped_id = db::add_media_with_id(&conn, &media("Filtered Out", "Ongoing")).unwrap();
        for (media_id, date, minutes) in
            [(kept_id, "2026-01-05", 20), (dropped_id, "2026-01-06", 15)]
        {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: minutes,
                    characters: 0,
                    date: date.to_string(),
                    date_precision: db::DatePrecision::Day,
                    activity_type: "Reading".to_string(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }

        let buckets = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Month, None, "Keep"),
        )
        .unwrap()
        .value;
        assert_eq!(buckets.buckets.len(), 1);
        let bucket = &buckets.buckets[0];
        assert_eq!(bucket.key, "2026-01");
        assert_eq!(bucket.started_count, 1);
        assert_eq!(bucket.logged_minutes, 20);
    }

    #[test]
    fn time_only_bucket_appears_without_a_lifecycle_event() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("bucket-time-only")).unwrap();
        let media_id = db::add_media_with_id(&conn, &media("Long Read", "Ongoing")).unwrap();
        for (date, minutes) in [("2023-12-05", 5), ("2024-03-10", 25)] {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: minutes,
                    characters: 0,
                    date: date.to_string(),
                    date_precision: db::DatePrecision::Day,
                    activity_type: "Reading".to_string(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }

        let buckets = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Month, None, ""),
        )
        .unwrap()
        .value;
        assert_eq!(buckets.buckets.len(), 2);
        let march = buckets
            .buckets
            .iter()
            .find(|bucket| bucket.key == "2024-03")
            .unwrap();
        assert_eq!(march.started_count, 0);
        assert_eq!(march.logged_minutes, 25);
    }

    #[test]
    fn year_filter_clips_bucket_keys_not_the_media_set() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("bucket-year-clip")).unwrap();
        let media_id = db::add_media_with_id(&conn, &media("Long Read", "Ongoing")).unwrap();
        for (date, minutes) in [("2023-12-05", 5), ("2024-03-10", 25)] {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: minutes,
                    characters: 0,
                    date: date.to_string(),
                    date_precision: db::DatePrecision::Day,
                    activity_type: "Reading".to_string(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }

        let buckets = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Month, Some(2024), ""),
        )
        .unwrap()
        .value;

        assert_eq!(buckets.buckets.len(), 1);
        let march = &buckets.buckets[0];
        assert_eq!(march.key, "2024-03");
        assert_eq!(march.started_count, 0);
        assert_eq!(march.logged_minutes, 25);
    }

    #[test]
    fn highlights_are_capped_and_report_the_full_distinct_count() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("bucket-highlights")).unwrap();
        let media_count = MAX_YEAR_BUCKET_HIGHLIGHTS + 2;
        for index in 1..=media_count {
            let title = format!("Title {index}");
            let cover = format!("cover-{index}.png");
            let media_id =
                db::add_media_with_id(&conn, &media_with_cover(&title, "Ongoing", &cover))
                    .unwrap();
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: 5,
                    characters: 0,
                    date: format!("2026-05-{index:02}"),
                    date_precision: db::DatePrecision::Day,
                    activity_type: "Reading".to_string(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }

        let buckets = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Month, None, ""),
        )
        .unwrap()
        .value;
        assert_eq!(buckets.buckets.len(), 1);
        let bucket = &buckets.buckets[0];
        assert_eq!(bucket.started_count, i64::try_from(media_count).unwrap());
        assert_eq!(bucket.highlights.len(), MAX_MONTH_BUCKET_HIGHLIGHTS);
        assert_eq!(
            bucket.distinct_media_count,
            i64::try_from(media_count).unwrap()
        );

        let years = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Year, None, ""),
        )
        .unwrap()
        .value;
        assert_eq!(years.buckets.len(), 1);
        let year = &years.buckets[0];
        assert_eq!(year.highlights.len(), MAX_YEAR_BUCKET_HIGHLIGHTS);
        assert_eq!(
            year.distinct_media_count,
            i64::try_from(media_count).unwrap()
        );
    }

    fn seed_logged_media(conn: &Connection, title: &str, date: &str, minutes: i64, characters: i64) {
        let cover = format!("{title}.png");
        let media_id =
            db::add_media_with_id(conn, &media_with_cover(title, "Ongoing", &cover)).unwrap();
        db::add_log(
            conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: minutes,
                characters,
                date: date.to_string(),
                date_precision: db::DatePrecision::Day,
                activity_type: "Reading".to_string(),
                notes: String::new(),
            },
        )
        .unwrap();
    }

    #[test]
    fn highlights_lead_with_the_most_logged_title_rather_than_the_newest() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("bucket-immersion")).unwrap();
        seed_logged_media(&conn, "Deep", "2026-05-01", 600, 0);
        seed_logged_media(&conn, "Glance", "2026-05-20", 10, 0);

        let buckets = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Month, None, ""),
        )
        .unwrap()
        .value;
        let titles = buckets.buckets[0]
            .highlights
            .iter()
            .map(|highlight| highlight.media_title.as_str())
            .collect::<Vec<_>>();
        assert_eq!(titles, vec!["Deep", "Glance"]);
    }

    #[test]
    fn highlights_include_a_title_with_logged_time_but_no_event_in_the_bucket() {
        let directory = tempfile::tempdir().unwrap();
        let conn =
            db::init_db(directory.path().to_path_buf(), Some("bucket-logged-only")).unwrap();
        let media_id =
            db::add_media_with_id(&conn, &media_with_cover("Serial", "Ongoing", "serial.png"))
                .unwrap();
        for (date, minutes) in [("2025-12-05", 60), ("2026-03-10", 120)] {
            db::add_log(
                &conn,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: minutes,
                    characters: 0,
                    date: date.to_string(),
                    date_precision: db::DatePrecision::Day,
                    activity_type: "Reading".to_string(),
                    notes: String::new(),
                },
            )
            .unwrap();
        }

        let buckets = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Month, None, ""),
        )
        .unwrap()
        .value;
        let march = buckets
            .buckets
            .iter()
            .find(|bucket| bucket.key == "2026-03")
            .expect("a bucket exists for the month with logged time");
        assert_eq!(march.started_count, 0);
        assert_eq!(march.logged_minutes, 120);
        assert_eq!(
            march
                .highlights
                .iter()
                .map(|highlight| highlight.media_title.as_str())
                .collect::<Vec<_>>(),
            vec!["Serial"]
        );
        assert_eq!(march.distinct_media_count, 1);
    }

    #[test]
    fn highlights_rank_a_character_tracked_title_above_a_barely_read_one() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("bucket-immersion-mix")).unwrap();
        seed_logged_media(&conn, "Hours", "2026-05-01", 1000, 0);
        seed_logged_media(&conn, "Glance", "2026-05-10", 50, 0);
        seed_logged_media(&conn, "Characters", "2026-05-20", 0, 90_000);

        let buckets = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Month, None, ""),
        )
        .unwrap()
        .value;
        let titles = buckets.buckets[0]
            .highlights
            .iter()
            .map(|highlight| highlight.media_title.as_str())
            .collect::<Vec<_>>();
        assert_eq!(titles.last(), Some(&"Glance"));
        assert!(titles.contains(&"Characters"));
    }

    #[test]
    fn milestones_roll_into_the_bucket_count() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("bucket-milestones")).unwrap();
        let media_id = db::add_media_with_id(&conn, &media("Milestone Media", "Ongoing")).unwrap();
        let media_uid = db::get_all_media(&conn)
            .unwrap()
            .into_iter()
            .find(|item| item.id == Some(media_id))
            .unwrap()
            .uid;
        for index in 1..=5 {
            db::add_milestone(
                &conn,
                &Milestone {
                    id: None,
                    media_uid: media_uid.clone(),
                    media_title: String::new(),
                    name: format!("Checkpoint {index}"),
                    duration: 10,
                    characters: 0,
                    date: Some(format!("2026-06-{index:02}")),
                },
            )
            .unwrap();
        }

        let buckets = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Month, None, ""),
        )
        .unwrap()
        .value;
        assert_eq!(buckets.buckets.len(), 1);
        let bucket = &buckets.buckets[0];
        assert_eq!(bucket.milestone_count, 5);
    }

    #[test]
    fn empty_database_returns_empty_buckets() {
        let directory = tempfile::tempdir().unwrap();
        let conn = db::init_db(directory.path().to_path_buf(), Some("bucket-empty")).unwrap();

        let buckets = get_timeline_buckets(
            &conn,
            &bucket_request(TimelineBucketGranularity::Month, None, ""),
        )
        .unwrap()
        .value;

        assert!(buckets.buckets.is_empty());
        assert!(buckets.available_years.is_empty());
        assert!(buckets.ambiguous_titles.is_empty());
        assert_eq!(buckets.summary.total_minutes, 0);
        assert_eq!(buckets.summary.completed_titles, 0);
        assert_eq!(buckets.summary.total_characters, 0);
    }
}
