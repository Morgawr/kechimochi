use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Media {
    pub id: Option<i64>,
    #[serde(default)]
    pub uid: Option<String>,
    pub title: String,
    pub media_type: String, // "Reading", "Watching", "Playing", "None", "Listening"
    pub status: String,     // "Active", "Paused", "Complete", "Dropped", "Planned"
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
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ActivitySummary {
    pub id: Option<i64>,
    pub media_id: i64,
    pub title: String,
    pub media_type: String,
    pub duration_minutes: i64,
    pub characters: i64,
    pub date: String,
    pub language: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct DailyHeatmap {
    pub date: String,
    pub total_minutes: i64,
    pub total_characters: i64,
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

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    pub kind: TimelineEventKind,
    pub date: String,
    pub media_id: i64,
    pub media_title: String,
    pub cover_image: String,
    pub activity_type: String,
    pub content_type: String,
    pub tracking_status: String,
    pub milestone_name: Option<String>,
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
