use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Media {
    pub id: Option<i64>,
    #[serde(default)]
    pub uid: Option<String>,
    pub title: String,
    #[serde(default)]
    pub variant: String,
    pub default_activity_type: String, // "Reading", "Watching", "Playing", "None", "Listening"
    pub status: String,                // "Active", "Paused", "Complete", "Dropped", "Planned"
    pub language: String,
    pub description: String,
    pub cover_image: String,
    pub extra_data: String,
    pub content_type: String, // "Visual Novel", "Anime", etc., or "Unknown"
    pub tracking_status: String, // "Ongoing", "Complete", "Paused", "Dropped", "Not Started", "Untracked"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActivityLog {
    pub id: Option<i64>,
    pub media_id: i64,
    pub duration_minutes: i64,
    pub characters: i64,
    pub date: String, // YYYY-MM-DD
    #[serde(default)]
    pub activity_type: String,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActivitySummary {
    pub id: Option<i64>,
    pub media_id: i64,
    pub title: String,
    pub activity_type: String,
    pub duration_minutes: i64,
    pub characters: i64,
    pub date: String,
    pub language: String,
    pub notes: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HttpMedia {
    pub id: Option<i64>,
    #[serde(default)]
    pub uid: Option<String>,
    pub title: String,
    #[serde(default)]
    pub variant: String,
    #[serde(default)]
    pub default_activity_type: Option<String>,
    // Accepted only for backwards-compatible request deserialization. Responses
    // must expose the canonical `default_activity_type` field exclusively.
    #[serde(default, skip_serializing)]
    pub media_type: Option<String>,
    pub status: String,
    pub language: String,
    pub description: String,
    pub cover_image: String,
    pub extra_data: String,
    pub content_type: String,
    pub tracking_status: String,
}

impl TryFrom<HttpMedia> for Media {
    type Error = String;

    fn try_from(value: HttpMedia) -> Result<Self, Self::Error> {
        let canonical = value
            .default_activity_type
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let legacy = value
            .media_type
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let default_activity_type = match (canonical, legacy) {
            (Some(canonical), Some(legacy)) if canonical != legacy => {
                return Err(format!(
                    "Conflicting default_activity_type ('{canonical}') and media_type ('{legacy}')"
                ));
            }
            (Some(canonical), _) => canonical.to_string(),
            (_, Some(legacy)) => legacy.to_string(),
            (None, None) => {
                return Err("Missing default_activity_type (or legacy media_type)".to_string());
            }
        };

        Ok(Media {
            id: value.id,
            uid: value.uid,
            title: value.title,
            variant: value.variant,
            default_activity_type,
            status: value.status,
            language: value.language,
            description: value.description,
            cover_image: value.cover_image,
            extra_data: value.extra_data,
            content_type: value.content_type,
            tracking_status: value.tracking_status,
        })
    }
}

impl From<Media> for HttpMedia {
    fn from(value: Media) -> Self {
        Self {
            id: value.id,
            uid: value.uid,
            title: value.title,
            variant: value.variant,
            default_activity_type: Some(value.default_activity_type),
            media_type: None,
            status: value.status,
            language: value.language,
            description: value.description,
            cover_image: value.cover_image,
            extra_data: value.extra_data,
            content_type: value.content_type,
            tracking_status: value.tracking_status,
        }
    }
}

#[derive(Debug, Serialize, Clone)]
pub struct HttpActivitySummary {
    pub id: Option<i64>,
    pub media_id: i64,
    pub title: String,
    pub activity_type: String,
    pub duration_minutes: i64,
    pub characters: i64,
    pub date: String,
    pub language: String,
    pub notes: String,
}

impl From<ActivitySummary> for HttpActivitySummary {
    fn from(value: ActivitySummary) -> Self {
        Self {
            id: value.id,
            media_id: value.media_id,
            title: value.title,
            activity_type: value.activity_type,
            duration_minutes: value.duration_minutes,
            characters: value.characters,
            date: value.date,
            language: value.language,
            notes: value.notes,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyHeatmap {
    pub date: String,
    pub total_minutes: i64,
    pub total_characters: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DashboardBucket {
    Day,
    Month,
    Year,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DashboardGroupBy {
    ActivityType,
    LogName,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardSnapshotRequest {
    pub request_id: u64,
    pub today: String,
    pub heatmap_year: i32,
    pub recent_offset: i64,
    pub recent_limit: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardRangeRequest {
    pub request_id: u64,
    pub start_date: String,
    pub end_date: String,
    pub bucket: DashboardBucket,
    pub group_by: DashboardGroupBy,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardHeatmapYearRequest {
    pub request_id: u64,
    pub year: i32,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardRecentLogsRequest {
    pub request_id: u64,
    pub offset: i64,
    pub limit: i64,
}

/// The deliberately small media projection used by dashboard cards. Keeping it
/// separate from `Media` prevents descriptions and extra_data from leaking into
/// dashboard payloads or being retained when the active profile changes.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardMedia {
    pub id: i64,
    pub title: String,
    pub variant: String,
    pub default_activity_type: String,
    pub status: String,
    pub cover_image: String,
    pub content_type: String,
    pub tracking_status: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardTotals {
    pub total_minutes: i64,
    pub total_characters: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardNamedTotals {
    pub key: String,
    pub label: String,
    pub total_minutes: i64,
    pub total_characters: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardSummary {
    pub total_logs: i64,
    pub total_media: i64,
    pub logged_days: i64,
    pub first_activity_date: Option<String>,
    pub last_activity_date: Option<String>,
    pub max_streak: i64,
    pub current_streak: i64,
    pub total_minutes: i64,
    pub total_characters: i64,
    pub activity_totals: Vec<DashboardNamedTotals>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardRecentLog {
    pub id: i64,
    pub media_id: i64,
    pub title: String,
    pub variant: String,
    pub activity_type: String,
    pub duration_minutes: i64,
    pub characters: i64,
    pub date: String,
    pub language: String,
    pub notes: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardRecentPage {
    pub request_id: u64,
    pub offset: i64,
    pub limit: i64,
    pub total_count: i64,
    pub items: Vec<DashboardRecentLog>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardChartPoint {
    /// The first ISO date represented by this bucket.
    pub bucket: String,
    pub group_key: String,
    pub group_label: String,
    pub total_minutes: i64,
    pub total_characters: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardBucketTotals {
    /// The first ISO date represented by this bucket.
    pub bucket: String,
    pub total_minutes: i64,
    pub total_characters: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DashboardHighlightKind {
    MostTime,
    MostCharacters,
    MostSessions,
    BiggestDay,
    BiggestStreak,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardHighlight {
    pub kind: DashboardHighlightKind,
    pub media: Option<DashboardMedia>,
    pub date: Option<String>,
    pub total_minutes: i64,
    pub total_characters: i64,
    pub sessions: i64,
    pub streak_days: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct DashboardWeekdayStats {
    /// Sunday is 0 and Saturday is 6, matching SQLite's `%w` convention.
    pub weekday: u32,
    pub average_minutes: f64,
    pub median_minutes: f64,
    pub average_characters: f64,
    pub median_characters: f64,
    pub sample_days: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct DashboardWeekdayDistribution {
    pub start_date: String,
    pub end_date: String,
    pub days: Vec<DashboardWeekdayStats>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardRangeResponse {
    pub request_id: u64,
    pub start_date: String,
    pub end_date: String,
    pub bucket: DashboardBucket,
    pub group_by: DashboardGroupBy,
    pub series: Vec<DashboardChartPoint>,
    pub bucket_totals: Vec<DashboardBucketTotals>,
    pub category_totals: Vec<DashboardNamedTotals>,
    pub highlights: Vec<DashboardHighlight>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardHeatmapYearResponse {
    pub request_id: u64,
    pub year: i32,
    pub days: Vec<DailyHeatmap>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardSettings {
    pub chart_type: String,
    pub group_by: DashboardGroupBy,
    pub week_start_day: i64,
    pub migrate_legacy_group_by: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardSnapshot {
    pub request_id: u64,
    pub settings: DashboardSettings,
    pub summary: DashboardSummary,
    pub quick_log_media: Vec<DashboardMedia>,
    pub recent_logs: DashboardRecentPage,
    pub heatmap: DashboardHeatmapYearResponse,
    pub range: DashboardRangeResponse,
    pub weekday_distribution: DashboardWeekdayDistribution,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LibrarySnapshotRequest {
    pub request_id: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct LibrarySettings {
    pub hide_archived: bool,
    pub preferred_layout: String,
    pub grid_zoom: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct LibraryActivityMetrics {
    pub media_id: i64,
    pub first_activity_date: Option<String>,
    pub last_activity_date: Option<String>,
    pub total_minutes: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LibrarySnapshot {
    pub request_id: u64,
    pub settings: LibrarySettings,
    pub media: Vec<Media>,
    pub metrics: Vec<LibraryActivityMetrics>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TimelineEventKind {
    Started,
    Finished,
    Paused,
    Dropped,
    Milestone,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TimelinePageRequest {
    pub request_id: u64,
    pub year: Option<i32>,
    pub kind: Option<TimelineEventKind>,
    #[serde(default)]
    pub search_query: String,
    pub offset: i64,
    pub limit: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct TimelineSummary {
    pub total_minutes: i64,
    pub completed_titles: i64,
    pub total_characters: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct TimelinePage {
    pub request_id: u64,
    pub offset: i64,
    pub limit: i64,
    pub total_count: i64,
    pub all_event_count: i64,
    pub has_more: bool,
    pub available_years: Vec<i32>,
    pub ambiguous_titles: Vec<String>,
    pub summary: TimelineSummary,
    pub events: Vec<TimelineEvent>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    pub kind: TimelineEventKind,
    pub date: String,
    pub media_id: i64,
    pub media_title: String,
    pub media_variant: String,
    pub cover_image: String,
    pub activity_type: String,
    pub content_type: String,
    pub tracking_status: String,
    pub milestone_name: Option<String>,
    pub milestone_id: Option<i64>,
    pub first_date: String,
    pub last_date: String,
    pub total_minutes: i64,
    pub total_characters: i64,
    pub milestone_minutes: i64,
    pub milestone_characters: i64,
    pub same_day_terminal: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Milestone {
    pub id: Option<i64>,
    #[serde(default)]
    pub media_uid: Option<String>,
    #[serde(default)]
    pub media_title: String,
    pub name: String,
    pub duration: i64,
    pub characters: i64,
    pub date: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProfilePicture {
    pub mime_type: String,
    pub base64_data: String,
    pub byte_size: i64,
    pub width: i64,
    pub height: i64,
    pub updated_at: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn http_media_json() -> serde_json::Value {
        serde_json::json!({
            "id": null,
            "uid": null,
            "title": "Compatibility Test",
            "variant": "",
            "status": "Active",
            "language": "Japanese",
            "description": "",
            "cover_image": "",
            "extra_data": "{}",
            "content_type": "Novel",
            "tracking_status": "Ongoing"
        })
    }

    #[test]
    fn http_media_accepts_legacy_media_type() {
        let mut value = http_media_json();
        value["media_type"] = serde_json::json!("Reading");

        let http_media: HttpMedia = serde_json::from_value(value).unwrap();
        let media = Media::try_from(http_media).unwrap();
        assert_eq!(media.default_activity_type, "Reading");
    }

    #[test]
    fn http_media_rejects_conflicting_default_activity_type_aliases() {
        let mut value = http_media_json();
        value["default_activity_type"] = serde_json::json!("Reading");
        value["media_type"] = serde_json::json!("Watching");

        let http_media: HttpMedia = serde_json::from_value(value).unwrap();
        let error = Media::try_from(http_media).unwrap_err();
        assert!(error.contains("Conflicting default_activity_type"));
    }

    #[test]
    fn http_responses_emit_only_canonical_activity_type_fields() {
        let media = Media {
            id: Some(1),
            uid: None,
            title: "Compatibility Test".to_string(),
            variant: String::new(),
            default_activity_type: "Reading".to_string(),
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: String::new(),
            cover_image: String::new(),
            extra_data: "{}".to_string(),
            content_type: "Novel".to_string(),
            tracking_status: "Ongoing".to_string(),
        };
        let media_json = serde_json::to_value(HttpMedia::from(media)).unwrap();
        assert_eq!(media_json["default_activity_type"], "Reading");
        assert!(media_json.get("media_type").is_none());

        let summary = ActivitySummary {
            id: Some(1),
            media_id: 1,
            title: "Compatibility Test".to_string(),
            activity_type: "Watching".to_string(),
            duration_minutes: 30,
            characters: 0,
            date: "2024-01-01".to_string(),
            language: "Japanese".to_string(),
            notes: String::new(),
        };
        let summary_json = serde_json::to_value(HttpActivitySummary::from(summary)).unwrap();
        assert_eq!(summary_json["activity_type"], "Watching");
        assert!(summary_json.get("media_type").is_none());
    }

    #[test]
    fn milestone_request_can_use_media_uid_without_client_supplied_display_title() {
        let milestone: Milestone = serde_json::from_value(serde_json::json!({
            "id": null,
            "media_uid": "media-uid",
            "name": "Checkpoint",
            "duration": 30,
            "characters": 0,
            "date": null
        }))
        .unwrap();

        assert_eq!(milestone.media_uid.as_deref(), Some("media-uid"));
        assert_eq!(milestone.media_title, "");
    }
}
