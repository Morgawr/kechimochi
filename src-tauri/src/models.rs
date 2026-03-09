use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct Media {
    pub id: Option<i64>,
    pub title: String,
    pub media_type: String, // "Reading", "Watching", "Playing", "None", "Listening"
    pub status: String,     // "Active", "Paused", "Completed", "Dropped", "Planned"
    pub language: String,
    pub description: String,
    pub cover_image: String,
    pub extra_data: String,
    pub content_type: String, // "Visual Novel", "Anime", etc., or "Unknown"
    pub tracking_status: String, // "Ongoing", "Complete", "Paused", "Dropped", "Not Started", "Untracked"
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActivityLog {
    pub id: Option<i64>,
    pub media_id: i64,
    pub duration_minutes: i64,
    pub date: String, // YYYY-MM-DD
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ActivitySummary {
    pub id: Option<i64>,
    pub media_id: i64,
    pub title: String,
    pub media_type: String,
    pub duration_minutes: i64,
    pub date: String,
    pub language: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DailyHeatmap {
    pub date: String,
    pub total_minutes: i64,
}
