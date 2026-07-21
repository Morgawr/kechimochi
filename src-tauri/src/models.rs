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
    #[serde(default)]
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
            default_activity_type: Some(value.default_activity_type.clone()),
            media_type: Some(value.default_activity_type),
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
    pub media_type: String,
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
            activity_type: value.activity_type.clone(),
            media_type: value.activity_type,
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
    fn http_responses_emit_canonical_and_legacy_activity_type_fields() {
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
        assert_eq!(media_json["media_type"], "Reading");

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
        assert_eq!(summary_json["media_type"], "Watching");
    }
}
