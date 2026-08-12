use serde::{Deserialize, Serialize};

/// Represents a study category (e.g., "Japanese", "Spanish", "Piano", "Python")
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StudyCategory {
    pub id: Option<i64>,
    pub name: String,                    // "Japanese", "Spanish", "Music", etc.
    pub icon: String,                    // emoji or icon identifier
    pub color: String,                   // hex color code
    pub description: String,
    pub created_at: Option<String>,
}

/// Represents a study item (replaces Media)
/// Can be any type of learning content: books, courses, media, exercises, etc.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct StudyItem {
    pub id: Option<i64>,
    pub category_id: i64,                // Foreign key to StudyCategory
    #[serde(default)]
    pub uid: Option<String>,
    pub title: String,
    #[serde(default)]
    pub variant: String,
    pub default_activity_type: String, // "Reading", "Studying", "Watching", "Playing", "Practicing", etc.
    pub status: String,                // "Active", "Paused", "Complete", "Dropped", "Planned"
    pub description: String,
    pub cover_image: String,
    pub extra_data: String,
    pub content_type: String,          // "Visual Novel", "Anime", "Book", "Song", "Course", etc.
    pub tracking_status: String,       // "Ongoing", "Complete", "Paused", "Dropped", "Not Started", "Untracked"
}

/// Legacy Media struct for backwards compatibility
/// Maps to StudyItem with implicit category
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Media {
    pub id: Option<i64>,
    #[serde(default)]
    pub uid: Option<String>,
    pub title: String,
    #[serde(default)]
    pub variant: String,
    pub default_activity_type: String,
    pub status: String,
    pub language: String,              // Now used as category identifier
    pub description: String,
    pub cover_image: String,
    pub extra_data: String,
    pub content_type: String,
    pub tracking_status: String,
}

impl From<StudyItem> for Media {
    fn from(item: StudyItem) -> Self {
        Media {
            id: item.id,
            uid: item.uid,
            title: item.title,
            variant: item.variant,
            default_activity_type: item.default_activity_type,
            status: item.status,
            language: format!("category_{}", item.category_id),
            description: item.description,
            cover_image: item.cover_image,
            extra_data: item.extra_data,
            content_type: item.content_type,
            tracking_status: item.tracking_status,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActivityLog {
    pub id: Option<i64>,
    pub study_item_id: i64,            // Foreign key to StudyItem
    pub category_id: i64,              // Denormalized for easier querying
    pub duration_minutes: i64,
    pub characters: i64,
    pub date: String,                 // YYYY-MM-DD
    #[serde(default)]
    pub activity_type: String,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActivitySummary {
    pub id: Option<i64>,
    pub study_item_id: i64,
    pub category_id: i64,
    pub title: String,
    pub category_name: String,
    pub activity_type: String,
    pub duration_minutes: i64,
    pub characters: i64,
    pub date: String,
    pub notes: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HttpStudyCategory {
    pub id: Option<i64>,
    pub name: String,
    pub icon: String,
    pub color: String,
    pub description: String,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct HttpStudyItem {
    pub id: Option<i64>,
    pub category_id: i64,
    #[serde(default)]
    pub uid: Option<String>,
    pub title: String,
    #[serde(default)]
    pub variant: String,
    #[serde(default)]
    pub default_activity_type: Option<String>,
    #[serde(default, skip_serializing)]
    pub media_type: Option<String>,    // legacy
    pub status: String,
    pub description: String,
    pub cover_image: String,
    pub extra_data: String,
    pub content_type: String,
    pub tracking_status: String,
}

impl TryFrom<HttpStudyItem> for StudyItem {
    type Error = String;

    fn try_from(value: HttpStudyItem) -> Result<Self, Self::Error> {
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

        Ok(StudyItem {
            id: value.id,
            category_id: value.category_id,
            uid: value.uid,
            title: value.title,
            variant: value.variant,
            default_activity_type,
            status: value.status,
            description: value.description,
            cover_image: value.cover_image,
            extra_data: value.extra_data,
            content_type: value.content_type,
            tracking_status: value.tracking_status,
        })
    }
}

impl From<StudyItem> for HttpStudyItem {
    fn from(value: StudyItem) -> Self {
        Self {
            id: value.id,
            category_id: value.category_id,
            uid: value.uid,
            title: value.title,
            variant: value.variant,
            default_activity_type: Some(value.default_activity_type),
            media_type: None,
            status: value.status,
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
    pub study_item_id: i64,
    pub category_id: i64,
    pub title: String,
    pub category_name: String,
    pub activity_type: String,
    pub duration_minutes: i64,
    pub characters: i64,
    pub date: String,
    pub notes: String,
}

impl From<ActivitySummary> for HttpActivitySummary {
    fn from(value: ActivitySummary) -> Self {
        Self {
            id: value.id,
            study_item_id: value.study_item_id,
            category_id: value.category_id,
            title: value.title,
            category_name: value.category_name,
            activity_type: value.activity_type,
            duration_minutes: value.duration_minutes,
            characters: value.characters,
            date: value.date,
            notes: value.notes,
        }
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyHeatmap {
    pub date: String,
    pub total_minutes: i64,
    pub total_characters: i64,
    pub category_id: Option<i64>, // Allow filtering by category
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
    StudyCategory,  // Changed from LogName
    ItemName,       // New: group by individual study item
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardSnapshotRequest {
    pub request_id: u64,
    pub today: String,
    pub heatmap_year: i32,
    pub recent_offset: i64,
    pub recent_limit: i64,
    pub category_id: Option<i64>, // Filter by category
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardRangeRequest {
    pub request_id: u64,
    pub start_date: String,
    pub end_date: String,
    pub bucket: DashboardBucket,
    pub group_by: DashboardGroupBy,
    pub category_id: Option<i64>, // Filter by category
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardHeatmapYearRequest {
    pub request_id: u64,
    pub year: i32,
    pub category_id: Option<i64>, // Filter by category
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardRecentLogsRequest {
    pub request_id: u64,
    pub offset: i64,
    pub limit: i64,
    pub category_id: Option<i64>, // Filter by category
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardStudyItem {
    pub id: i64,
    pub category_id: i64,
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
    pub total_items: i64,
    pub total_categories: i64,
    pub logged_days: i64,
    pub first_activity_date: Option<String>,
    pub last_activity_date: Option<String>,
    pub max_streak: i64,
    pub current_streak: i64,
    pub total_minutes: i64,
    pub total_characters: i64,
    pub activity_totals: Vec<DashboardNamedTotals>,
    pub category_totals: Vec<DashboardNamedTotals>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardRecentLog {
    pub id: i64,
    pub study_item_id: i64,
    pub category_id: i64,
    pub title: String,
    pub variant: String,
    pub category_name: String,
    pub activity_type: String,
    pub duration_minutes: i64,
    pub characters: i64,
    pub date: String,
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
    pub bucket: String,
    pub group_key: String,
    pub group_label: String,
    pub total_minutes: i64,
    pub total_characters: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardBucketTotals {
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
    pub item: Option<DashboardStudyItem>,
    pub category: Option<StudyCategory>,
    pub date: Option<String>,
    pub total_minutes: i64,
    pub total_characters: i64,
    pub sessions: i64,
    pub streak_days: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq)]
pub struct DashboardWeekdayStats {
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
    pub selected_category_id: Option<i64>, // For filtering
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DashboardSnapshot {
    pub request_id: u64,
    pub settings: DashboardSettings,
    pub summary: DashboardSummary,
    pub quick_log_items: Vec<DashboardStudyItem>,
    pub recent_logs: DashboardRecentPage,
    pub heatmap: DashboardHeatmapYearResponse,
    pub range: DashboardRangeResponse,
    pub weekday_distribution: DashboardWeekdayDistribution,
    pub categories: Vec<StudyCategory>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LibrarySnapshotRequest {
    pub request_id: u64,
    pub category_id: Option<i64>, // Filter by category
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct LibrarySettings {
    pub hide_archived: bool,
    pub preferred_layout: String,
    pub grid_zoom: i64,
    pub group_by_type: bool,
    pub keep_ongoing_first: bool,
    pub keep_archived_last: bool,
    pub sort_stages: String,
    pub selected_category_id: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct LibraryActivityMetrics {
    pub study_item_id: i64,
    pub first_activity_date: Option<String>,
    pub last_activity_date: Option<String>,
    pub total_minutes: Option<i64>,
    pub total_characters: Option<i64>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LibrarySnapshot {
    pub request_id: u64,
    pub settings: LibrarySettings,
    pub categories: Vec<StudyCategory>,
    pub items: Vec<StudyItem>,
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
    pub category_id: Option<i64>, // Filter by category
    #[serde(default)]
    pub search_query: String,
    pub offset: i64,
    pub limit: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct TimelineSummary {
    pub total_minutes: i64,
    pub completed_items: i64,
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
    pub ambiguous_items: Vec<String>,
    pub summary: TimelineSummary,
    pub events: Vec<TimelineEvent>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    pub kind: TimelineEventKind,
    pub date: String,
    pub study_item_id: i64,
    pub category_id: i64,
    pub item_title: String,
    pub item_variant: String,
    pub category_name: String,
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
    pub study_item_uid: Option<String>,
    pub category_id: i64,
    #[serde(default)]
    pub study_item_title: String,
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

    #[test]
    fn study_category_creation() {
        let category = StudyCategory {
            id: Some(1),
            name: "Japanese".to_string(),
            icon: "🇯🇵".to_string(),
            color: "#FF1493".to_string(),
            description: "Japanese language learning".to_string(),
            created_at: None,
        };
        assert_eq!(category.name, "Japanese");
    }

    #[test]
    fn study_item_creation() {
        let item = StudyItem {
            id: Some(1),
            category_id: 1,
            uid: None,
            title: "Manga Title".to_string(),
            variant: String::new(),
            default_activity_type: "Reading".to_string(),
            status: "Active".to_string(),
            description: String::new(),
            cover_image: String::new(),
            extra_data: "{}".to_string(),
            content_type: "Manga".to_string(),
            tracking_status: "Ongoing".to_string(),
        };
        assert_eq!(item.category_id, 1);
        assert_eq!(item.content_type, "Manga");
    }
}
