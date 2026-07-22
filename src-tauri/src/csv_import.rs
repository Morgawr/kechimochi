use chrono::NaiveDate;
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::Read;
use std::path::Path;

use crate::db;
use crate::models::{ActivityLog, Media, Milestone};
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};

#[derive(Debug, Deserialize)]
struct CsvRow {
    #[serde(rename = "Date")]
    date: String,
    #[serde(rename = "Log Name")]
    log_name: String,
    #[serde(rename = "Default Activity Type", default)]
    default_activity_type: Option<String>,
    #[serde(rename = "Media Type", default)]
    legacy_media_type: Option<String>,
    #[serde(rename = "Duration")]
    duration: i64,
    #[serde(rename = "Language")]
    language: String,
    #[serde(rename = "Characters")]
    characters: Option<i64>,
    #[serde(rename = "Activity Type", default)]
    activity_type: Option<String>,
    #[serde(rename = "Notes", default)]
    notes: Option<String>,
    #[serde(rename = "Media Variant", default)]
    media_variant: String,
}

impl CsvRow {
    const HEADERS: [&str; 10] = [
        "Date",
        "Log Name",
        "Default Activity Type",
        "Media Type",
        "Duration",
        "Language",
        "Characters",
        "Activity Type",
        "Notes",
        "Media Variant",
    ];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActivityCsvRow {
    #[serde(rename = "Date")]
    pub date: String,
    #[serde(rename = "Log Name")]
    pub log_name: String,
    #[serde(rename = "Default Activity Type")]
    pub default_activity_type: String,
    #[serde(rename = "Duration")]
    pub duration: i64,
    #[serde(rename = "Language")]
    pub language: String,
    #[serde(rename = "Characters")]
    pub characters: i64,
    #[serde(rename = "Activity Type")]
    pub activity_type: String,
    #[serde(rename = "Notes")]
    pub notes: String,
    #[serde(rename = "Media Variant")]
    pub media_variant: String,
}

impl ActivityCsvRow {
    const HEADERS: [&str; 9] = [
        "Date",
        "Log Name",
        "Default Activity Type",
        "Duration",
        "Language",
        "Characters",
        "Activity Type",
        "Notes",
        "Media Variant",
    ];
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub struct ActivityCsvContent {
    pub log_name: String,
    pub media_variant: String,
    pub date: String,
    pub duration: i64,
    pub characters: i64,
    pub activity_type: String,
    pub notes: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActivityCsvGroup {
    pub content: ActivityCsvContent,
    pub incoming_count: usize,
    pub existing_count: usize,
    pub media_exists: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActivityCsvAnalysis {
    pub rows: Vec<ActivityCsvRow>,
    pub groups: Vec<ActivityCsvGroup>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ActivityCsvConflictAction {
    SkipPossibleOverlaps,
    ImportAll,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActivityCsvConflictResolution {
    pub content: ActivityCsvContent,
    pub action: ActivityCsvConflictAction,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActivityCsvImportRequest {
    pub rows: Vec<ActivityCsvRow>,
    pub analyzed_groups: Vec<ActivityCsvGroup>,
    pub resolutions: Vec<ActivityCsvConflictResolution>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
pub struct ActivityCsvImportResult {
    pub imported_count: usize,
    pub skipped_count: usize,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MilestoneCsvRow {
    #[serde(rename = "Media Title")]
    pub media_title: String,
    #[serde(rename = "Name")]
    pub name: String,
    #[serde(rename = "Duration")]
    pub duration: i64,
    #[serde(rename = "Characters")]
    pub characters: i64,
    #[serde(rename = "Date")]
    pub date: Option<String>,
    #[serde(rename = "Media Variant", default)]
    pub media_variant: String,
}

impl MilestoneCsvRow {
    const HEADERS: [&str; 6] = [
        "Media Title",
        "Name",
        "Duration",
        "Characters",
        "Date",
        "Media Variant",
    ];
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(deny_unknown_fields)]
pub struct MediaCsvRow {
    #[serde(rename = "Title")]
    pub title: String,
    #[serde(
        rename = "Default Activity Type",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub default_activity_type: Option<String>,
    #[serde(
        rename = "Media Type",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub legacy_media_type: Option<String>,
    #[serde(rename = "Status")]
    pub status: String,
    #[serde(rename = "Language")]
    pub language: String,
    #[serde(rename = "Description", default)]
    pub description: String,
    #[serde(rename = "Content Type")]
    pub content_type: String,
    #[serde(rename = "Extra Data")]
    pub extra_data: String,
    #[serde(rename = "Cover Image (Base64)")]
    pub cover_image_b64: String,
    #[serde(rename = "Variant", default)]
    pub variant: String,
}

#[derive(Debug, Serialize)]
struct MediaCsvExportRow {
    #[serde(rename = "Title")]
    title: String,
    #[serde(rename = "Default Activity Type")]
    default_activity_type: String,
    #[serde(rename = "Status")]
    status: String,
    #[serde(rename = "Language")]
    language: String,
    #[serde(rename = "Description")]
    description: String,
    #[serde(rename = "Content Type")]
    content_type: String,
    #[serde(rename = "Extra Data")]
    extra_data: String,
    #[serde(rename = "Cover Image (Base64)")]
    cover_image_b64: String,
    #[serde(rename = "Variant")]
    variant: String,
}

impl MediaCsvExportRow {
    const HEADERS: [&str; 9] = [
        "Title",
        "Default Activity Type",
        "Status",
        "Language",
        "Description",
        "Content Type",
        "Extra Data",
        "Cover Image (Base64)",
        "Variant",
    ];
}

impl MediaCsvRow {
    const HEADERS: [&str; 10] = [
        "Title",
        "Default Activity Type",
        "Media Type",
        "Status",
        "Language",
        "Description",
        "Content Type",
        "Extra Data",
        "Cover Image (Base64)",
        "Variant",
    ];
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct CsvMediaKey {
    title: String,
    variant: String,
}

impl CsvMediaKey {
    fn new(title: &str, variant: &str) -> Result<Self, String> {
        if title.trim().is_empty() {
            return Err("Media title cannot be blank".to_string());
        }
        Ok(Self {
            title: title.to_string(),
            variant: variant.trim().to_string(),
        })
    }

    fn description(&self) -> String {
        format!(
            "title '{}' and variant {}",
            self.title,
            display_variant(&self.variant)
        )
    }
}

#[derive(Debug)]
struct MediaCatalog {
    by_title: HashMap<String, Vec<Media>>,
}

impl MediaCatalog {
    fn load(conn: &Connection) -> Result<Self, String> {
        let mut by_title: HashMap<String, Vec<Media>> = HashMap::new();
        for media in db::get_all_media(conn).map_err(|e| e.to_string())? {
            by_title.entry(media.title.clone()).or_default().push(media);
        }
        Ok(Self { by_title })
    }

    fn resolve(
        &self,
        title: &str,
        variant: Option<&str>,
        context: &str,
        variant_header: &str,
    ) -> Result<Option<&Media>, String> {
        let matches = self.by_title.get(title).map(Vec::as_slice).unwrap_or(&[]);
        if let Some(variant) = variant {
            let normalized_variant = variant.trim();
            let exact = matches
                .iter()
                .filter(|media| media.variant == normalized_variant)
                .collect::<Vec<_>>();
            return match exact.as_slice() {
                [] => Ok(None),
                [media] => Ok(Some(*media)),
                _ => Err(format!(
                    "{context} matches multiple media entries with title '{}' and variant {}",
                    title,
                    display_variant(normalized_variant)
                )),
            };
        }

        match matches {
            [] => Ok(None),
            [media] => Ok(Some(media)),
            _ => {
                let mut variants = matches
                    .iter()
                    .map(|media| display_variant(&media.variant))
                    .collect::<Vec<_>>();
                variants.sort();
                variants.dedup();
                Err(format!(
                    "Ambiguous {context}: title '{}' matches multiple media variants: {}. Add the '{}' column and choose the intended variant.",
                    title,
                    variants.join(", "),
                    variant_header
                ))
            }
        }
    }
}

fn display_variant(variant: &str) -> String {
    if variant.is_empty() {
        "'(blank)'".to_string()
    } else {
        format!("'{variant}'")
    }
}

/// Classifies errors returned by CSV import/analyze/apply operations at the HTTP
/// boundary. Parsing, header, identity-resolution, and row-validation failures
/// are caused by the submitted payload; filesystem and database failures remain
/// internal errors.
pub fn is_client_input_error_message(message: &str) -> bool {
    let lowercase = message.to_ascii_lowercase();
    message.contains("CSV")
        || lowercase.contains("media import request")
        || message.contains("Media title cannot be blank")
        || message.contains("Default activity type cannot be blank")
        || message.contains("Activity must have either duration or characters")
        || message.contains("Milestone must have either duration or characters")
}

fn validate_csv_headers(
    headers: &csv::StringRecord,
    allowed: &[&str],
    context: &str,
) -> Result<(), String> {
    let mut seen = HashSet::new();
    for header in headers {
        if !seen.insert(header) {
            return Err(format!("Duplicate '{header}' column in {context}"));
        }
        if !allowed.contains(&header) {
            return Err(format!(
                "Unsupported '{header}' column in {context}. Internal IDs, UIDs, UUIDs, and other opaque identity columns are not accepted."
            ));
        }
    }
    Ok(())
}

fn has_header(headers: &csv::StringRecord, expected: &str) -> bool {
    headers.iter().any(|header| header == expected)
}

fn require_csv_headers(
    headers: &csv::StringRecord,
    required: &[&str],
    context: &str,
) -> Result<(), String> {
    for required_header in required {
        if !has_header(headers, required_header) {
            return Err(format!(
                "Missing required '{required_header}' column in {context}"
            ));
        }
    }
    Ok(())
}

fn require_activity_type_header(headers: &csv::StringRecord, context: &str) -> Result<(), String> {
    if has_header(headers, "Default Activity Type") || has_header(headers, "Media Type") {
        Ok(())
    } else {
        Err(format!(
            "Missing required 'Default Activity Type' (or legacy 'Media Type') column in {context}"
        ))
    }
}

fn resolve_default_activity_type(
    canonical: Option<&str>,
    legacy: Option<&str>,
    context: &str,
) -> Result<String, String> {
    let canonical = canonical.map(str::trim).filter(|value| !value.is_empty());
    let legacy = legacy.map(str::trim).filter(|value| !value.is_empty());

    match (canonical, legacy) {
        (Some(canonical), Some(legacy)) if canonical != legacy => Err(format!(
            "Conflicting Default Activity Type ('{canonical}') and Media Type ('{legacy}') in {context}"
        )),
        (Some(canonical), _) => Ok(canonical.to_string()),
        (_, Some(legacy)) => Ok(legacy.to_string()),
        (None, None) => Err(format!(
            "Missing Default Activity Type (or legacy Media Type) in {context}"
        )),
    }
}

impl MediaCsvRow {
    fn normalize_default_activity_type(mut self, context: &str) -> Result<Self, String> {
        let resolved = resolve_default_activity_type(
            self.default_activity_type.as_deref(),
            self.legacy_media_type.as_deref(),
            context,
        )?;
        self.default_activity_type = Some(resolved);
        self.legacy_media_type = None;
        Ok(self)
    }

    fn resolved_default_activity_type(&self) -> Result<&str, String> {
        self.default_activity_type.as_deref().ok_or_else(|| {
            format!(
                "Media CSV row '{}' was not normalized before use",
                self.title
            )
        })
    }
}

#[derive(Debug, Serialize)]
pub struct MediaConflict {
    pub incoming: MediaCsvRow,
    pub existing: Option<ExistingMediaCsvMatch>,
}

/// Human-readable context for the media-import confirmation UI. Keep this
/// deliberately separate from `Media`: IDs and UIDs must not cross the CSV
/// import boundary, even in the analysis response surrounding parsed rows.
#[derive(Debug, Serialize)]
pub struct ExistingMediaCsvMatch {
    pub title: String,
    pub variant: String,
    pub status: String,
}

impl From<&Media> for ExistingMediaCsvMatch {
    fn from(media: &Media) -> Self {
        Self {
            title: media.title.clone(),
            variant: media.variant.clone(),
            status: media.status.clone(),
        }
    }
}

pub fn import_csv(conn: &mut Connection, file_path: &str) -> Result<usize, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err("File not found".into());
    }

    let file = File::open(path).map_err(|e| e.to_string())?;
    import_csv_from_reader(conn, file)
}

pub fn import_csv_from_reader<R: Read>(conn: &mut Connection, reader: R) -> Result<usize, String> {
    let rows = parse_activity_csv_rows(conn, reader)?;
    let analysis = analyze_activity_rows(conn, rows)?;
    if analysis.groups.iter().any(|group| group.existing_count > 0) {
        return Err(
            "Activity CSV contains possible duplicate activities. Analyze the CSV and explicitly resolve every conflict before importing."
                .to_string(),
        );
    }
    let result = apply_activity_import(
        conn,
        ActivityCsvImportRequest {
            rows: analysis.rows,
            analyzed_groups: analysis.groups,
            resolutions: Vec::new(),
        },
    )?;
    Ok(result.imported_count)
}

pub fn analyze_activity_csv(
    conn: &Connection,
    file_path: &str,
) -> Result<ActivityCsvAnalysis, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err("File not found".into());
    }
    let file = File::open(path).map_err(|e| e.to_string())?;
    analyze_activity_csv_from_reader(conn, file)
}

pub fn analyze_activity_csv_from_reader<R: Read>(
    conn: &Connection,
    reader: R,
) -> Result<ActivityCsvAnalysis, String> {
    let rows = parse_activity_csv_rows(conn, reader)?;
    analyze_activity_rows(conn, rows)
}

fn parse_activity_csv_rows<R: Read>(
    conn: &Connection,
    reader: R,
) -> Result<Vec<ActivityCsvRow>, String> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(reader);

    let headers = rdr.headers().map_err(|e| e.to_string())?.clone();
    validate_csv_headers(&headers, &CsvRow::HEADERS, "activity CSV")?;
    require_csv_headers(
        &headers,
        &["Date", "Log Name", "Duration", "Language"],
        "activity CSV",
    )?;
    require_activity_type_header(&headers, "activity CSV")?;
    let has_variant = has_header(&headers, "Media Variant");
    let catalog = MediaCatalog::load(conn)?;
    let mut rows = Vec::new();
    let mut new_media_defaults: HashMap<CsvMediaKey, (String, usize)> = HashMap::new();

    for (index, result) in rdr.deserialize::<CsvRow>().enumerate() {
        let record: CsvRow =
            result.map_err(|e| format!("Failed to parse activity CSV row {}: {e}", index + 2))?;
        let row_number = index + 2;
        let default_activity_type = resolve_default_activity_type(
            record.default_activity_type.as_deref(),
            record.legacy_media_type.as_deref(),
            &format!("activity CSV row {row_number}"),
        )?;
        let formatted_date = normalize_activity_date(&record.date, row_number)?;
        let characters = record.characters.unwrap_or(0);
        db::validate_activity_metrics(record.duration, characters)
            .map_err(|error| format!("Invalid activity CSV row {row_number}: {error}"))?;
        let requested_variant = has_variant.then_some(record.media_variant.as_str());
        let existing = catalog.resolve(
            &record.log_name,
            requested_variant,
            &format!("activity CSV row {row_number}"),
            "Media Variant",
        )?;
        let key = CsvMediaKey::new(
            &record.log_name,
            existing
                .map(|media| media.variant.as_str())
                .or(requested_variant)
                .unwrap_or(""),
        )
        .map_err(|e| format!("{e} on activity CSV row {row_number}"))?;

        if existing.is_none() {
            if let Some((first_default, first_row)) = new_media_defaults.get(&key) {
                if first_default != &default_activity_type {
                    return Err(format!(
                        "Conflicting Default Activity Type values for new media with {}: '{}' on activity CSV row {} and '{}' on row {}. Per-log Activity Type values may differ, but a new media entry must have one default.",
                        key.description(),
                        first_default,
                        first_row,
                        default_activity_type,
                        row_number
                    ));
                }
            } else {
                new_media_defaults.insert(key.clone(), (default_activity_type.clone(), row_number));
            }
        }

        let activity_type = record
            .activity_type
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| default_activity_type.clone());
        rows.push(ActivityCsvRow {
            date: formatted_date,
            log_name: key.title,
            default_activity_type,
            duration: record.duration,
            language: record.language,
            characters,
            activity_type,
            notes: record.notes.unwrap_or_default(),
            media_variant: key.variant,
        });
    }

    Ok(rows)
}

#[derive(Debug)]
struct PreparedActivityCsvRow {
    row: ActivityCsvRow,
    media_key: CsvMediaKey,
    existing_media_id: Option<i64>,
    content: ActivityCsvContent,
}

fn prepare_activity_rows(
    conn: &Connection,
    rows: Vec<ActivityCsvRow>,
) -> Result<Vec<PreparedActivityCsvRow>, String> {
    let catalog = MediaCatalog::load(conn)?;
    let mut prepared = Vec::with_capacity(rows.len());
    let mut new_media_defaults: HashMap<CsvMediaKey, (String, usize)> = HashMap::new();
    let mut new_media_languages: HashMap<CsvMediaKey, (String, usize)> = HashMap::new();

    for (index, row) in rows.into_iter().enumerate() {
        let row_number = index + 2;
        let default_activity_type = resolve_default_activity_type(
            Some(&row.default_activity_type),
            None,
            &format!("activity CSV row {row_number}"),
        )?;
        let date = normalize_activity_date(&row.date, row_number)?;
        db::validate_activity_metrics(row.duration, row.characters)
            .map_err(|error| format!("Invalid activity CSV row {row_number}: {error}"))?;
        let existing = catalog.resolve(
            &row.log_name,
            Some(&row.media_variant),
            &format!("activity CSV row {row_number}"),
            "Media Variant",
        )?;
        let media_key = CsvMediaKey::new(
            &row.log_name,
            existing
                .map(|media| media.variant.as_str())
                .unwrap_or(&row.media_variant),
        )
        .map_err(|error| format!("{error} on activity CSV row {row_number}"))?;

        if existing.is_none() {
            if let Some((first_default, first_row)) = new_media_defaults.get(&media_key) {
                if first_default != &default_activity_type {
                    return Err(format!(
                        "Conflicting Default Activity Type values for new media with {}: '{}' on activity CSV row {} and '{}' on row {}. Per-log Activity Type values may differ, but a new media entry must have one default.",
                        media_key.description(),
                        first_default,
                        first_row,
                        default_activity_type,
                        row_number
                    ));
                }
            } else {
                new_media_defaults.insert(
                    media_key.clone(),
                    (default_activity_type.clone(), row_number),
                );
            }
            if let Some((first_language, first_row)) = new_media_languages.get(&media_key) {
                if first_language != &row.language {
                    return Err(format!(
                        "Conflicting Language values for new media with {}: '{}' on activity CSV row {} and '{}' on row {}. A new media entry must have one language.",
                        media_key.description(),
                        first_language,
                        first_row,
                        row.language,
                        row_number
                    ));
                }
            } else {
                new_media_languages.insert(media_key.clone(), (row.language.clone(), row_number));
            }
        }

        let activity_type = row.activity_type.trim();
        let activity_type = if activity_type.is_empty() {
            default_activity_type.clone()
        } else {
            activity_type.to_string()
        };
        let normalized_row = ActivityCsvRow {
            date: date.clone(),
            log_name: media_key.title.clone(),
            default_activity_type,
            duration: row.duration,
            language: row.language,
            characters: row.characters,
            activity_type: activity_type.clone(),
            notes: row.notes,
            media_variant: media_key.variant.clone(),
        };
        let content = ActivityCsvContent {
            log_name: media_key.title.clone(),
            media_variant: media_key.variant.clone(),
            date,
            duration: normalized_row.duration,
            characters: normalized_row.characters,
            activity_type,
            notes: normalized_row.notes.clone(),
        };
        prepared.push(PreparedActivityCsvRow {
            row: normalized_row,
            media_key,
            existing_media_id: existing.and_then(|media| media.id),
            content,
        });
    }

    Ok(prepared)
}

fn existing_activity_counts(
    conn: &Connection,
) -> Result<HashMap<ActivityCsvContent, usize>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT m.title, m.variant, a.date, a.duration_minutes, a.characters,
                    a.activity_type, a.notes
             FROM main.activity_logs a
             JOIN shared.media m ON m.id = a.media_id",
        )
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok(ActivityCsvContent {
                log_name: row.get(0)?,
                media_variant: row.get(1)?,
                date: row.get(2)?,
                duration: row.get(3)?,
                characters: row.get(4)?,
                activity_type: row.get(5)?,
                notes: row.get(6)?,
            })
        })
        .map_err(|error| error.to_string())?;
    let mut counts = HashMap::new();
    for row in rows {
        *counts
            .entry(row.map_err(|error| error.to_string())?)
            .or_insert(0) += 1;
    }
    Ok(counts)
}

fn build_activity_groups(
    conn: &Connection,
    prepared: &[PreparedActivityCsvRow],
) -> Result<Vec<ActivityCsvGroup>, String> {
    let existing = existing_activity_counts(conn)?;
    let mut incoming = HashMap::new();
    let mut media_exists = HashMap::new();
    let mut ordered_contents = Vec::new();
    for row in prepared {
        if !incoming.contains_key(&row.content) {
            ordered_contents.push(row.content.clone());
            media_exists.insert(row.content.clone(), row.existing_media_id.is_some());
        }
        *incoming.entry(row.content.clone()).or_insert(0) += 1;
    }
    Ok(ordered_contents
        .into_iter()
        .map(|content| ActivityCsvGroup {
            incoming_count: *incoming.get(&content).unwrap_or(&0),
            existing_count: *existing.get(&content).unwrap_or(&0),
            media_exists: *media_exists.get(&content).unwrap_or(&false),
            content,
        })
        .collect())
}

fn analyze_activity_rows(
    conn: &Connection,
    rows: Vec<ActivityCsvRow>,
) -> Result<ActivityCsvAnalysis, String> {
    let prepared = prepare_activity_rows(conn, rows)?;
    let groups = build_activity_groups(conn, &prepared)?;
    Ok(ActivityCsvAnalysis {
        rows: prepared.into_iter().map(|row| row.row).collect(),
        groups,
    })
}

pub fn apply_activity_import(
    conn: &mut Connection,
    request: ActivityCsvImportRequest,
) -> Result<ActivityCsvImportResult, String> {
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    let prepared = prepare_activity_rows(&tx, request.rows)?;
    let current_groups = build_activity_groups(&tx, &prepared)?;
    if current_groups != request.analyzed_groups {
        return Err(
            "Activity CSV data changed after conflict review. Analyze the CSV again before importing."
                .to_string(),
        );
    }

    let conflict_contents = current_groups
        .iter()
        .filter(|group| group.existing_count > 0)
        .map(|group| group.content.clone())
        .collect::<HashSet<_>>();
    let mut resolution_by_content = HashMap::new();
    for resolution in request.resolutions {
        if !conflict_contents.contains(&resolution.content) {
            return Err(
                "Activity CSV import contains a resolution for content that is not a current conflict"
                    .to_string(),
            );
        }
        if resolution_by_content
            .insert(resolution.content, resolution.action)
            .is_some()
        {
            return Err("Activity CSV import contains duplicate conflict resolutions".to_string());
        }
    }
    if resolution_by_content.len() != conflict_contents.len() {
        return Err(
            "Activity CSV import requires an explicit resolution for every possible duplicate"
                .to_string(),
        );
    }

    let mut skip_remaining = HashMap::new();
    for group in &current_groups {
        if group.existing_count == 0 {
            continue;
        }
        let action = resolution_by_content.get(&group.content).ok_or_else(|| {
            "Activity CSV import requires an explicit resolution for every possible duplicate"
                .to_string()
        })?;
        let skip_count = match action {
            ActivityCsvConflictAction::SkipPossibleOverlaps => {
                group.existing_count.min(group.incoming_count)
            }
            ActivityCsvConflictAction::ImportAll => 0,
        };
        skip_remaining.insert(group.content.clone(), skip_count);
    }

    let mut imported_count = 0;
    let mut skipped_count = 0;
    let mut created_media_ids: HashMap<CsvMediaKey, i64> = HashMap::new();

    for prepared_row in prepared {
        if let Some(remaining) = skip_remaining.get_mut(&prepared_row.content) {
            if *remaining > 0 {
                *remaining -= 1;
                skipped_count += 1;
                continue;
            }
        }

        let media_id = if let Some(id) = prepared_row.existing_media_id {
            id
        } else if let Some(id) = created_media_ids.get(&prepared_row.media_key) {
            *id
        } else {
            let new_media = Media {
                id: None,
                uid: None,
                title: prepared_row.media_key.title.clone(),
                variant: prepared_row.media_key.variant.clone(),
                default_activity_type: prepared_row.row.default_activity_type.clone(),
                status: "Complete".into(), // Default to Complete for historical data
                language: prepared_row.row.language.clone(),
                description: "".to_string(),
                cover_image: "".to_string(),
                extra_data: "{}".to_string(),
                content_type: "Unknown".to_string(),
                tracking_status: "Untracked".to_string(),
            };
            let id = db::add_media_with_id(&tx, &new_media).map_err(|e| e.to_string())?;
            created_media_ids.insert(prepared_row.media_key, id);
            id
        };

        let new_log = ActivityLog {
            id: None,
            media_id,
            duration_minutes: prepared_row.row.duration,
            characters: prepared_row.row.characters,
            date: prepared_row.row.date,
            activity_type: prepared_row.row.activity_type,
            notes: prepared_row.row.notes,
        };

        db::add_log(&tx, &new_log).map_err(|e| e.to_string())?;
        imported_count += 1;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(ActivityCsvImportResult {
        imported_count,
        skipped_count,
    })
}

fn normalize_activity_date(value: &str, row_number: usize) -> Result<String, String> {
    let is_slash_format =
        value.len() == 10 && value.chars().nth(4) == Some('/') && value.chars().nth(7) == Some('/');
    let is_dash_format =
        value.len() == 10 && value.chars().nth(4) == Some('-') && value.chars().nth(7) == Some('-');

    if !(is_slash_format || is_dash_format) {
        return Err(format!(
            "Invalid date format on CSV row {}: '{}'. Expected YYYY/MM/DD or YYYY-MM-DD.",
            row_number, value
        ));
    }

    let parse_format = if is_slash_format {
        "%Y/%m/%d"
    } else {
        "%Y-%m-%d"
    };
    let parsed_date = NaiveDate::parse_from_str(value, parse_format).map_err(|_| {
        format!(
            "Invalid date value on CSV row {}: '{}'. Expected YYYY/MM/DD or YYYY-MM-DD.",
            row_number, value
        )
    })?;

    Ok(parsed_date.format("%Y-%m-%d").to_string())
}

pub fn export_media_csv(conn: &Connection, file_path: &str) -> Result<usize, String> {
    let mut wtr = csv::Writer::from_path(file_path).map_err(|e| e.to_string())?;
    let media_list = db::get_all_media(conn).map_err(|e| e.to_string())?;
    let mut count = 0;

    for m in media_list {
        let mut b64 = String::new();
        if !m.cover_image.is_empty() {
            let path = Path::new(&m.cover_image);
            if path.exists() {
                if let Ok(bytes) = std::fs::read(path) {
                    b64 = BASE64.encode(&bytes);
                }
            }
        }

        let row = MediaCsvExportRow {
            title: m.title,
            variant: m.variant,
            default_activity_type: m.default_activity_type,
            status: m.status,
            language: m.language,
            description: m.description,
            content_type: m.content_type,
            extra_data: m.extra_data,
            cover_image_b64: b64,
        };

        wtr.serialize(row).map_err(|e| e.to_string())?;
        count += 1;
    }

    if count == 0 {
        wtr.write_record(MediaCsvExportRow::HEADERS)
            .map_err(|e| e.to_string())?;
    }

    wtr.flush().map_err(|e| e.to_string())?;
    Ok(count)
}

pub fn export_logs_csv(
    conn: &Connection,
    file_path: &str,
    start_date: Option<String>,
    end_date: Option<String>,
) -> Result<usize, String> {
    let mut count = 0;
    let mut wtr = csv::Writer::from_path(file_path).map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare(
            "SELECT a.id, a.date, m.title, m.default_activity_type, a.duration_minutes, m.language,
                    a.characters, a.activity_type,
                    a.notes, m.variant
             FROM main.activity_logs a
             JOIN shared.media m ON a.media_id = m.id
             ORDER BY a.date DESC, a.id DESC",
        )
        .map_err(|e| e.to_string())?;
    let logs = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, i64>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, String>(8)?,
                row.get::<_, String>(9)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for log in logs {
        let (
            date,
            title,
            default_activity_type,
            duration,
            language,
            characters,
            activity_type,
            notes,
            variant,
        ) = log.map_err(|e| e.to_string())?;
        if let Some(start) = &start_date {
            if &date < start {
                continue;
            }
        }
        if let Some(end) = &end_date {
            if &date > end {
                continue;
            }
        }

        wtr.serialize(ActivityCsvRow {
            date,
            log_name: title,
            default_activity_type,
            duration,
            language,
            characters,
            activity_type,
            notes,
            media_variant: variant,
        })
        .map_err(|e| e.to_string())?;

        count += 1;
    }

    // Struct serialization writes headers with the first row. Empty exports still
    // need a valid header-only CSV so they remain importable and self-describing.
    if count == 0 {
        wtr.write_record(ActivityCsvRow::HEADERS)
            .map_err(|e| e.to_string())?;
    }

    wtr.flush().map_err(|e| e.to_string())?;
    Ok(count)
}

pub fn export_milestones_csv(conn: &Connection, file_path: &str) -> Result<usize, String> {
    let unresolved: Option<(String, String)> = conn
        .query_row(
            "SELECT ms.media_title, ms.name
             FROM main.milestones ms
             LEFT JOIN shared.media m ON m.uid = ms.media_uid
             WHERE m.uid IS NULL
             ORDER BY ms.id ASC
             LIMIT 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some((title, name)) = unresolved {
        return Err(format!(
            "Cannot export milestone '{name}' for media '{title}' because it is not linked to an existing media entry"
        ));
    }

    let mut stmt = conn
        .prepare(
            "SELECT ms.id, m.title, ms.name, ms.duration, ms.characters, ms.date, m.variant
         FROM main.milestones ms
         JOIN shared.media m ON m.uid = ms.media_uid
         ORDER BY ms.id ASC",
        )
        .map_err(|e| e.to_string())?;

    let milestone_iter = stmt
        .query_map([], |row| {
            Ok(MilestoneCsvRow {
                media_title: row.get(1)?,
                name: row.get(2)?,
                duration: row.get(3)?,
                characters: row.get(4)?,
                date: row.get(5)?,
                media_variant: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut count = 0;
    let mut wtr = csv::Writer::from_path(file_path).map_err(|e| e.to_string())?;

    for milestone in milestone_iter {
        let m = milestone.map_err(|e| e.to_string())?;
        wtr.serialize(m).map_err(|e| e.to_string())?;
        count += 1;
    }

    if count == 0 {
        wtr.write_record(MilestoneCsvRow::HEADERS)
            .map_err(|e| e.to_string())?;
    }

    wtr.flush().map_err(|e| e.to_string())?;
    Ok(count)
}

pub fn import_milestones_csv(conn: &mut Connection, file_path: &str) -> Result<usize, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err("File not found".into());
    }

    let file = File::open(path).map_err(|e| e.to_string())?;
    import_milestones_csv_from_reader(conn, file)
}

pub fn import_milestones_csv_from_reader<R: Read>(
    conn: &mut Connection,
    reader: R,
) -> Result<usize, String> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(reader);

    let headers = rdr.headers().map_err(|e| e.to_string())?.clone();
    validate_csv_headers(&headers, &MilestoneCsvRow::HEADERS, "milestone CSV")?;
    require_csv_headers(
        &headers,
        &["Media Title", "Name", "Duration", "Characters"],
        "milestone CSV",
    )?;
    let has_variant = has_header(&headers, "Media Variant");
    let catalog = MediaCatalog::load(conn)?;
    let mut milestones = Vec::new();

    for (index, result) in rdr.deserialize::<MilestoneCsvRow>().enumerate() {
        let row_number = index + 2;
        let record =
            result.map_err(|e| format!("Failed to parse milestone CSV row {row_number}: {e}"))?;
        let requested_variant = has_variant.then_some(record.media_variant.as_str());
        let requested_key =
            CsvMediaKey::new(&record.media_title, requested_variant.unwrap_or_default())
                .map_err(|e| format!("{e} on milestone CSV row {row_number}"))?;
        if record.duration == 0 && record.characters == 0 {
            return Err(format!(
                "Milestone CSV row {row_number} must have a non-zero Duration or Characters value"
            ));
        }
        let media = catalog
            .resolve(
                &record.media_title,
                requested_variant,
                &format!("milestone CSV row {row_number}"),
                "Media Variant",
            )?
            .ok_or_else(|| {
                format!(
                    "Milestone CSV row {row_number} cannot be imported because no media entry matches {}. Import or create the media entry first.",
                    requested_key.description()
                )
            })?;
        let media_uid = media
            .uid
            .as_deref()
            .filter(|uid| !uid.trim().is_empty())
            .ok_or_else(|| {
                format!(
                    "Milestone CSV row {row_number} resolved to media '{}' without a valid internal identity",
                    media.title
                )
            })?
            .to_string();

        milestones.push(Milestone {
            id: None,
            media_uid: Some(media_uid),
            media_title: media.title.clone(),
            name: record.name,
            duration: record.duration,
            characters: record.characters,
            date: record.date,
        });
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut imported_count = 0;
    for milestone in milestones {
        db::add_milestone(&tx, &milestone).map_err(|e| e.to_string())?;
        imported_count += 1;
    }

    tx.commit().map_err(|e| e.to_string())?;
    Ok(imported_count)
}

// Parses the CSV and identifies which incoming media exist vs which are new.
// The frontend will then prompt the user and send back a filtered list to actually apply.
pub fn analyze_media_csv(conn: &Connection, file_path: &str) -> Result<Vec<MediaConflict>, String> {
    let path = Path::new(file_path);
    if !path.exists() {
        return Err("File not found".into());
    }

    let file = File::open(path).map_err(|e| e.to_string())?;
    analyze_media_csv_from_reader(conn, file)
}

pub fn analyze_media_csv_from_reader<R: Read>(
    conn: &Connection,
    reader: R,
) -> Result<Vec<MediaConflict>, String> {
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(reader);
    let headers = rdr.headers().map_err(|e| e.to_string())?.clone();
    validate_csv_headers(&headers, &MediaCsvRow::HEADERS, "media CSV")?;
    require_csv_headers(
        &headers,
        &[
            "Title",
            "Status",
            "Language",
            "Content Type",
            "Extra Data",
            "Cover Image (Base64)",
        ],
        "media CSV",
    )?;
    require_activity_type_header(&headers, "media CSV")?;
    let has_variant = has_header(&headers, "Variant");
    let catalog = MediaCatalog::load(conn)?;
    let mut conflicts = Vec::new();
    let mut seen_identities: HashMap<CsvMediaKey, usize> = HashMap::new();

    for (index, result) in rdr.deserialize::<MediaCsvRow>().enumerate() {
        let row_number = index + 2;
        let mut record: MediaCsvRow = result
            .map_err(|e| format!("Failed to parse media CSV row {row_number}: {e}"))?
            .normalize_default_activity_type(&format!("media CSV row {row_number}"))?;
        let requested_variant = has_variant.then_some(record.variant.as_str());
        let existing = catalog
            .resolve(
                &record.title,
                requested_variant,
                &format!("media CSV row {row_number}"),
                "Variant",
            )?
            .cloned();

        // Analysis resolves a legacy title-only row to one exact human-readable
        // title/variant pair before it crosses into the apply API. No internal ID
        // is exposed or accepted at the CSV boundary.
        record.variant = existing
            .as_ref()
            .map(|media| media.variant.clone())
            .or_else(|| requested_variant.map(|variant| variant.trim().to_string()))
            .unwrap_or_default();
        let key = CsvMediaKey::new(&record.title, &record.variant)
            .map_err(|e| format!("{e} on media CSV row {row_number}"))?;
        if let Some(first_row) = seen_identities.insert(key.clone(), row_number) {
            return Err(format!(
                "Media CSV rows {first_row} and {row_number} both target {}. Each media identity may appear only once per import.",
                key.description()
            ));
        }

        conflicts.push(MediaConflict {
            incoming: record,
            existing: existing.as_ref().map(ExistingMediaCsvMatch::from),
        });
    }

    Ok(conflicts)
}

pub fn apply_media_import(
    covers_dir: std::path::PathBuf,
    conn: &mut Connection,
    records: Vec<MediaCsvRow>,
) -> Result<usize, String> {
    struct PreparedMediaImport {
        req: MediaCsvRow,
        key: CsvMediaKey,
        existing_id: Option<i64>,
        old_cover: String,
        cover_bytes: Option<Vec<u8>>,
    }

    // The apply endpoint is intentionally exact-pair-only. Legacy title-only
    // compatibility is resolved by analyze_media_csv, which returns a concrete
    // human-readable variant without exposing an internal identifier.
    let catalog = MediaCatalog::load(conn)?;
    let mut prepared = Vec::with_capacity(records.len());
    let mut seen_identities: HashMap<CsvMediaKey, usize> = HashMap::new();
    for (index, req) in records.into_iter().enumerate() {
        let request_row = index + 1;
        let mut req = req
            .normalize_default_activity_type(&format!("media import request row {request_row}"))?;
        req.variant = req.variant.trim().to_string();
        let key = CsvMediaKey::new(&req.title, &req.variant)
            .map_err(|e| format!("{e} in media import request row {request_row}"))?;
        if let Some(first_row) = seen_identities.insert(key.clone(), request_row) {
            return Err(format!(
                "Media import request rows {first_row} and {request_row} both target {}. Each media identity may appear only once per import.",
                key.description()
            ));
        }
        let existing = catalog.resolve(
            &key.title,
            Some(&key.variant),
            &format!("media import request row {request_row}"),
            "Variant",
        )?;
        let cover_bytes = if req.cover_image_b64.is_empty() {
            None
        } else {
            Some(BASE64.decode(&req.cover_image_b64).map_err(|e| {
                format!(
                    "Invalid Cover Image (Base64) in media import request row {request_row}: {e}"
                )
            })?)
        };
        prepared.push(PreparedMediaImport {
            req,
            key,
            existing_id: existing.and_then(|media| media.id),
            old_cover: existing
                .map(|media| media.cover_image.clone())
                .unwrap_or_default(),
            cover_bytes,
        });
    }

    // All semantic checks, identity resolution, and Base64 decoding have
    // completed before the first database or cover-file write.
    std::fs::create_dir_all(&covers_dir).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let import_stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_nanos();
    let mut created_cover_paths = Vec::new();
    let mut old_cover_paths = Vec::new();

    let apply_result = (|| -> Result<usize, String> {
        for (index, prepared) in prepared.into_iter().enumerate() {
            let default_activity_type = prepared.req.resolved_default_activity_type()?.to_string();
            let final_cover_path = if let Some(bytes) = prepared.cover_bytes {
                let dest = covers_dir.join(format!("import_{import_stamp}_{index}.png"));
                std::fs::write(&dest, bytes).map_err(|e| e.to_string())?;
                created_cover_paths.push(dest.clone());
                dest.to_string_lossy().to_string()
            } else {
                String::new()
            };

            let media = Media {
                id: prepared.existing_id,
                uid: None,
                title: prepared.key.title,
                variant: prepared.key.variant,
                default_activity_type,
                status: prepared.req.status,
                language: prepared.req.language,
                description: prepared.req.description,
                cover_image: final_cover_path,
                extra_data: prepared.req.extra_data,
                content_type: prepared.req.content_type,
                tracking_status: "Untracked".to_string(),
            };
            if media.id.is_some() {
                db::update_media(&tx, &media).map_err(|e| e.to_string())?;
                if !prepared.old_cover.is_empty() && prepared.old_cover != media.cover_image {
                    old_cover_paths.push(prepared.old_cover);
                }
            } else {
                db::add_media_with_id(&tx, &media).map_err(|e| e.to_string())?;
            }
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(seen_identities.len())
    })();

    if apply_result.is_err() {
        for path in created_cover_paths {
            let _ = std::fs::remove_file(path);
        }
        return apply_result;
    }

    for old_cover in old_cover_paths {
        let still_referenced: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM shared.media WHERE cover_image = ?1",
                [&old_cover],
                |row| row.get(0),
            )
            .unwrap_or(1);
        if still_referenced == 0 {
            let _ = std::fs::remove_file(old_cover);
        }
    }

    apply_result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use rusqlite::Connection;
    use std::io::Write;

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("ATTACH DATABASE ':memory:' AS shared", [])
            .unwrap();
        db::create_tables(&conn).unwrap();
        conn
    }

    use std::sync::atomic::{AtomicUsize, Ordering};

    static COUNTER: AtomicUsize = AtomicUsize::new(0);

    fn write_csv(content: &str) -> String {
        let dir = std::env::temp_dir();
        let id = COUNTER.fetch_add(1, Ordering::SeqCst);
        let path = dir.join(format!("kechimochi_test_{}_{}.csv", std::process::id(), id));
        let mut f = File::create(&path).unwrap();
        f.write_all(content.as_bytes()).unwrap();
        path.to_str().unwrap().to_string()
    }

    fn sample_media(title: &str) -> Media {
        Media {
            id: None,
            uid: None,
            title: title.to_string(),
            variant: String::new(),
            default_activity_type: "Reading".to_string(),
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: "".to_string(),
            cover_image: "".to_string(),
            extra_data: "{}".to_string(),
            content_type: "Unknown".to_string(),
            tracking_status: "Untracked".to_string(),
        }
    }

    fn sample_media_csv_row(title: &str, variant: &str) -> MediaCsvRow {
        MediaCsvRow {
            title: title.to_string(),
            default_activity_type: Some("Reading".to_string()),
            legacy_media_type: None,
            status: "Active".to_string(),
            language: "Japanese".to_string(),
            description: String::new(),
            content_type: "Manga".to_string(),
            extra_data: "{}".to_string(),
            cover_image_b64: String::new(),
            variant: variant.to_string(),
        }
    }

    #[test]
    fn media_apply_payload_rejects_identifier_fields_instead_of_ignoring_them() {
        for identifier in [
            "id",
            "uid",
            "uuid",
            "ID",
            "UID",
            "UUID",
            "media_id",
            "mediaId",
            "Media ID",
            "Media UID",
            "activity_id",
            "activityId",
            "milestone_id",
            "milestoneId",
            "sync_uid",
            "profile_id",
            "device_id",
            "snapshot_id",
        ] {
            let mut payload = serde_json::to_value(sample_media_csv_row("No IDs", "Manga"))
                .unwrap()
                .as_object()
                .unwrap()
                .clone();
            payload.insert(identifier.to_string(), serde_json::json!("opaque"));

            let error = serde_json::from_value::<MediaCsvRow>(serde_json::Value::Object(payload))
                .unwrap_err();
            assert!(error.to_string().contains("unknown field"));
        }
    }

    #[test]
    fn all_csv_import_formats_reject_identifier_columns() {
        for identifier in [
            "id",
            "uid",
            "uuid",
            "ID",
            "UID",
            "UUID",
            "media_id",
            "mediaId",
            "Media ID",
            "Media UID",
            "activity_id",
            "activityId",
            "milestone_id",
            "milestoneId",
            "sync_uid",
            "profile_id",
            "device_id",
            "snapshot_id",
        ] {
            let mut conn = setup_test_db();
            let activity_csv = format!(
                "Date,Log Name,Default Activity Type,Duration,Language,{identifier}\n\
                 2026-07-21,No IDs,Reading,30,Japanese,opaque\n"
            );
            let activity_error =
                import_csv_from_reader(&mut conn, activity_csv.as_bytes()).unwrap_err();
            assert!(
                activity_error.contains(&format!("Unsupported '{identifier}' column")),
                "unexpected activity CSV error for {identifier}: {activity_error}"
            );

            let media_csv = format!(
                "Title,Default Activity Type,Status,Language,Description,Content Type,Extra Data,Cover Image (Base64),{identifier}\n\
                 No IDs,Reading,Active,Japanese,,Novel,{{}},,opaque\n"
            );
            let media_error =
                analyze_media_csv_from_reader(&conn, media_csv.as_bytes()).unwrap_err();
            assert!(
                media_error.contains(&format!("Unsupported '{identifier}' column")),
                "unexpected media CSV error for {identifier}: {media_error}"
            );

            let milestone_csv = format!(
                "Media Title,Name,Duration,Characters,{identifier}\n\
                 No IDs,Checkpoint,30,0,opaque\n"
            );
            let milestone_error =
                import_milestones_csv_from_reader(&mut conn, milestone_csv.as_bytes()).unwrap_err();
            assert!(
                milestone_error.contains(&format!("Unsupported '{identifier}' column")),
                "unexpected milestone CSV error for {identifier}: {milestone_error}"
            );
        }
    }

    #[test]
    fn test_import_csv_basic() {
        let mut conn = setup_test_db();
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language,Characters\n\
             2024-01-15,ある魔女が死ぬまで,Reading,45,Japanese,1000\n\
             2024-01-16,呪術廻戦,Watching,25,Japanese,0\n",
        );

        let count = import_csv(&mut conn, &csv_path).unwrap();
        assert_eq!(count, 2);

        let media = db::get_all_media(&conn).unwrap();
        assert_eq!(media.len(), 2);
        assert_eq!(
            media
                .iter()
                .find(|entry| entry.title == "ある魔女が死ぬまで")
                .unwrap()
                .default_activity_type,
            "Reading"
        );

        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 2);

        std::fs::remove_file(csv_path).ok();
    }

    #[test]
    fn test_import_csv_accepts_canonical_default_and_preserves_activity_override() {
        let mut conn = setup_test_db();
        let csv =
            "Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type\n\
                   2024-01-15,Canonical Import,Reading,45,Japanese,1000,Watching\n";

        assert_eq!(
            import_csv_from_reader(&mut conn, csv.as_bytes()).unwrap(),
            1
        );

        let media = db::get_all_media(&conn).unwrap();
        assert_eq!(media[0].default_activity_type, "Reading");
        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs[0].activity_type, "Watching");
    }

    #[test]
    fn test_import_csv_rejects_conflicting_canonical_and_legacy_defaults() {
        let mut conn = setup_test_db();
        let csv = "Date,Log Name,Default Activity Type,Media Type,Duration,Language,Characters,Activity Type\n\
                   2024-01-15,Conflict,Reading,Watching,45,Japanese,1000,Reading\n";

        let error = import_csv_from_reader(&mut conn, csv.as_bytes()).unwrap_err();
        assert!(error.contains("Conflicting Default Activity Type"));
        assert!(db::get_all_media(&conn).unwrap().is_empty());
        assert!(db::get_logs(&conn).unwrap().is_empty());
    }

    #[test]
    fn test_import_csv_deduplicates_media() {
        let mut conn = setup_test_db();
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language\n\
             2024-01-15,FF7,Playing,60,Japanese\n\
             2024-01-16,FF7,Playing,120,Japanese\n",
        );

        let count = import_csv(&mut conn, &csv_path).unwrap();
        assert_eq!(count, 2);

        // Only one media entry despite two rows with same title
        let media = db::get_all_media(&conn).unwrap();
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].title, "FF7");

        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 2);

        std::fs::remove_file(csv_path).ok();
    }

    #[test]
    fn test_activity_import_with_variant_header_uses_exact_pair_including_blank() {
        let mut conn = setup_test_db();
        let mut existing = sample_media("Horimiya");
        existing.variant = "Manga".to_string();
        let existing_id = db::add_media_with_id(&conn, &existing).unwrap();

        let csv = "Date,Log Name,Media Type,Duration,Language,Characters,Activity Type,Notes,Media Variant\n\
                   2024-01-15,Horimiya,Watching,25,Japanese,0,Watching,,\n\
                   2024-01-16,Horimiya,Watching,25,Japanese,0,Watching,,Anime\n";
        assert_eq!(
            import_csv_from_reader(&mut conn, csv.as_bytes()).unwrap(),
            2
        );

        let media = db::get_all_media(&conn).unwrap();
        assert_eq!(media.len(), 3);
        assert_eq!(db::get_logs_for_media(&conn, existing_id).unwrap().len(), 0);
        for variant in ["", "Anime"] {
            let imported = media
                .iter()
                .find(|entry| entry.title == "Horimiya" && entry.variant == variant)
                .unwrap();
            assert_eq!(
                db::get_logs_for_media(&conn, imported.id.unwrap())
                    .unwrap()
                    .len(),
                1
            );
        }
    }

    #[test]
    fn test_activity_import_mixed_variants_create_distinct_media_without_inferring_from_activity_type(
    ) {
        let mut conn = setup_test_db();
        let csv = "Date,Log Name,Media Type,Duration,Language,Characters,Activity Type,Notes,Media Variant\n\
                   2024-01-15,Horimiya,Reading,25,Japanese,0,Reading,,Manga\n\
                   2024-01-16,Horimiya,Reading,25,Japanese,0,Reading,,Manga\n\
                   2024-01-15,Mixed,Reading,25,Japanese,0,Reading,,Manga\n\
                   2024-01-16,Mixed,Reading,25,Japanese,0,Watching,,Anime\n";
        assert_eq!(
            import_csv_from_reader(&mut conn, csv.as_bytes()).unwrap(),
            4
        );

        let media = db::get_all_media(&conn).unwrap();
        assert_eq!(media.len(), 3);
        let mixed = media
            .iter()
            .filter(|entry| entry.title == "Mixed")
            .collect::<Vec<_>>();
        assert_eq!(mixed.len(), 2);
        assert!(mixed.iter().any(|entry| entry.variant == "Manga"));
        assert!(mixed.iter().any(|entry| entry.variant == "Anime"));
        let anime = mixed.iter().find(|entry| entry.variant == "Anime").unwrap();
        let anime_logs = db::get_logs_for_media(&conn, anime.id.unwrap()).unwrap();
        assert_eq!(anime_logs[0].activity_type, "Watching");
        assert_eq!(anime.default_activity_type, "Reading");
    }

    #[test]
    fn test_activity_import_legacy_title_only_uses_one_existing_variant() {
        let mut conn = setup_test_db();
        let mut existing = sample_media("Horimiya");
        existing.variant = "Manga".to_string();
        let existing_id = db::add_media_with_id(&conn, &existing).unwrap();
        let csv =
            "Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type\n\
                   2024-01-15,Horimiya,Reading,25,Japanese,0,Watching\n";

        assert_eq!(
            import_csv_from_reader(&mut conn, csv.as_bytes()).unwrap(),
            1
        );
        assert_eq!(db::get_all_media(&conn).unwrap().len(), 1);
        let logs = db::get_logs_for_media(&conn, existing_id).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].activity_type, "Watching");
    }

    #[test]
    fn test_activity_import_legacy_ambiguity_aborts_before_any_writes() {
        let mut conn = setup_test_db();
        for variant in ["", "Manga"] {
            let mut media = sample_media("Horimiya");
            media.variant = variant.to_string();
            db::add_media_with_id(&conn, &media).unwrap();
        }
        let csv =
            "Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type\n\
                   2024-01-15,Would Be New,Reading,25,Japanese,0,Reading\n\
                   2024-01-16,Horimiya,Reading,25,Japanese,0,Reading\n";

        let error = import_csv_from_reader(&mut conn, csv.as_bytes()).unwrap_err();
        assert!(error.contains("Ambiguous activity CSV row 3"));
        assert!(error.contains("'(blank)'"));
        assert!(error.contains("'Manga'"));
        assert!(error.contains("Media Variant"));
        assert_eq!(db::get_all_media(&conn).unwrap().len(), 2);
        assert!(db::get_logs(&conn).unwrap().is_empty());
    }

    #[test]
    fn test_activity_import_rejects_conflicting_defaults_for_new_pair_but_allows_log_types_to_differ(
    ) {
        let mut conn = setup_test_db();
        let conflicting = "Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type,Media Variant\n\
                           2024-01-15,One Entry,Reading,25,Japanese,0,Reading,Manga\n\
                           2024-01-16,One Entry,Watching,25,Japanese,0,Watching,Manga\n";
        let error = import_csv_from_reader(&mut conn, conflicting.as_bytes()).unwrap_err();
        assert!(error.contains("Conflicting Default Activity Type values"));
        assert!(db::get_all_media(&conn).unwrap().is_empty());
        assert!(db::get_logs(&conn).unwrap().is_empty());

        let valid = "Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type,Media Variant\n\
                     2024-01-15,One Entry,Reading,25,Japanese,0,Reading,Manga\n\
                     2024-01-16,One Entry,Reading,25,Japanese,0,Watching,Manga\n";
        assert_eq!(
            import_csv_from_reader(&mut conn, valid.as_bytes()).unwrap(),
            2
        );
        let media = db::get_all_media(&conn).unwrap();
        assert_eq!(media.len(), 1);
        assert_eq!(media[0].default_activity_type, "Reading");
        let logs = db::get_logs_for_media(&conn, media[0].id.unwrap()).unwrap();
        assert_eq!(
            logs.iter()
                .map(|log| log.activity_type.as_str())
                .collect::<HashSet<_>>(),
            HashSet::from(["Reading", "Watching"])
        );
    }

    #[test]
    fn test_activity_import_does_not_change_existing_default_when_csv_rows_disagree() {
        let mut conn = setup_test_db();
        let mut media = sample_media("Existing");
        media.variant = "Manga".to_string();
        let media_id = db::add_media_with_id(&conn, &media).unwrap();
        let csv = "Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type,Media Variant\n\
                   2024-01-15,Existing,Watching,25,Japanese,0,Watching,Manga\n\
                   2024-01-16,Existing,Listening,25,Japanese,0,Listening,Manga\n";

        assert_eq!(
            import_csv_from_reader(&mut conn, csv.as_bytes()).unwrap(),
            2
        );
        let imported = db::get_all_media(&conn).unwrap();
        assert_eq!(imported[0].default_activity_type, "Reading");
        assert_eq!(db::get_logs_for_media(&conn, media_id).unwrap().len(), 2);
    }

    #[test]
    fn test_activity_import_rejects_identity_columns() {
        let mut conn = setup_test_db();
        let csv = "Date,Log Name,Default Activity Type,Duration,Language,Media UID\n\
                   2024-01-15,No IDs,Reading,25,Japanese,opaque-id\n";
        let error = import_csv_from_reader(&mut conn, csv.as_bytes()).unwrap_err();
        assert!(error.contains("Unsupported 'Media UID' column"));
        assert!(db::get_all_media(&conn).unwrap().is_empty());
    }

    #[test]
    fn test_media_import_updates_exact_pair_and_creates_same_title_blank_variant() {
        let mut conn = setup_test_db();
        let mut existing = sample_media("Horimiya");
        existing.variant = "Manga".to_string();
        let existing_id = db::add_media_with_id(&conn, &existing).unwrap();

        let covers_dir = std::env::temp_dir().join(format!(
            "variant_media_import_{}_{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        apply_media_import(
            covers_dir.clone(),
            &mut conn,
            vec![
                sample_media_csv_row("Horimiya", "Manga"),
                sample_media_csv_row("Horimiya", ""),
                sample_media_csv_row("New Title", "Light Novel"),
            ],
        )
        .unwrap();

        let media = db::get_all_media(&conn).unwrap();
        assert_eq!(media.len(), 3);
        assert_eq!(
            media
                .iter()
                .find(|entry| entry.title == "Horimiya" && entry.variant == "Manga")
                .unwrap()
                .id,
            Some(existing_id)
        );
        assert!(media
            .iter()
            .any(|entry| entry.title == "Horimiya" && entry.variant.is_empty()));
        assert_eq!(
            media
                .iter()
                .find(|entry| entry.title == "New Title")
                .unwrap()
                .variant,
            "Light Novel"
        );
        std::fs::remove_dir_all(covers_dir).ok();
    }

    #[test]
    fn test_apply_media_import_semantic_error_preflights_before_database_or_cover_writes() {
        let mut conn = setup_test_db();
        let covers_dir = std::env::temp_dir().join(format!(
            "media_import_preflight_{}_{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let mut conflicting = sample_media_csv_row("Conflict", "Manga");
        conflicting.legacy_media_type = Some("Watching".to_string());

        let error = apply_media_import(
            covers_dir.clone(),
            &mut conn,
            vec![sample_media_csv_row("Would Be New", "Anime"), conflicting],
        )
        .unwrap_err();
        assert!(error.contains("Conflicting Default Activity Type"));
        assert!(db::get_all_media(&conn).unwrap().is_empty());
        assert!(!covers_dir.exists());
    }

    #[test]
    fn test_import_csv_date_formatting() {
        let mut conn = setup_test_db();
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language\n\
             2024/03/01,本好きの下剋上,Reading,30,Japanese\n",
        );

        let count = import_csv(&mut conn, &csv_path).unwrap();
        assert_eq!(count, 1);

        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs[0].date, "2024-03-01");

        std::fs::remove_file(csv_path).ok();
    }

    #[test]
    fn test_export_media_csv() {
        let conn = setup_test_db();
        let m = Media {
            id: None,
            uid: None,
            title: "Export Test".to_string(),
            variant: "Light Novel".to_string(),
            default_activity_type: "Reading".to_string(),
            status: "Ongoing".to_string(),
            language: "Japanese".to_string(),
            description: "Test Desc".to_string(),
            cover_image: "".to_string(),
            extra_data: "{\"key\":\"val\"}".to_string(),
            content_type: "Novel".to_string(),
            tracking_status: "Untracked".to_string(),
        };
        db::add_media_with_id(&conn, &m).unwrap();

        let dir = std::env::temp_dir();
        let path = dir.join("export_test.csv");
        let path_str = path.to_str().unwrap().to_string();

        let count = export_media_csv(&conn, &path_str).unwrap();
        assert_eq!(count, 1);

        let content = std::fs::read_to_string(&path).unwrap();
        let mut reader = csv::Reader::from_reader(content.as_bytes());
        let headers = reader.headers().unwrap();
        assert_eq!(
            headers.iter().collect::<Vec<_>>(),
            MediaCsvExportRow::HEADERS
        );
        assert!(headers.iter().all(|header| !matches!(
            header.to_ascii_lowercase().as_str(),
            "id" | "uid" | "uuid" | "media id" | "media uid"
        )));
        assert!(content.contains("Export Test"));
        assert!(content.contains("Novel"));
        assert!(content.contains("Light Novel"));
        // CSV escapes double quotes in fields by doubling them
        assert!(
            content.contains("\"{ \"\"key\"\": \"\"val\"\" }\"")
                || content.contains("\"{ \"\"key\"\":\"\"val\"\" }\"")
                || content.contains("key") && content.contains("val")
        );

        std::fs::remove_file(path).ok();
    }

    #[test]
    fn test_analyze_media_csv() {
        let conn = setup_test_db();
        // Add one existing media
        let m = Media {
            id: None,
            uid: None,
            title: "Existing".to_string(),
            variant: "Manga".to_string(),
            default_activity_type: "Reading".to_string(),
            status: "Complete".to_string(),
            language: "Japanese".to_string(),
            description: "".to_string(),
            cover_image: "".to_string(),
            extra_data: "{}".to_string(),
            content_type: "Unknown".to_string(),
            tracking_status: "Untracked".to_string(),
        };
        db::add_media_with_id(&conn, &m).unwrap();

        let csv_path = write_csv(
            "Title,Media Type,Status,Language,Description,Content Type,Extra Data,Cover Image (Base64)\n\
             Existing,Reading,Ongoing,Japanese,,Novel,{}, \n\
             New Media,Watching,Plan to Watch,English,,Anime,{}, \n"
        );

        let conflicts = analyze_media_csv(&conn, &csv_path).unwrap();
        assert_eq!(conflicts.len(), 2);

        // First one should have an existing media
        assert_eq!(conflicts[0].incoming.title, "Existing");
        assert!(conflicts[0].existing.is_some());
        assert_eq!(conflicts[0].existing.as_ref().unwrap().title, "Existing");
        assert_eq!(conflicts[0].incoming.variant, "Manga");
        let analysis_json = serde_json::to_value(&conflicts[0]).unwrap();
        let existing_json = analysis_json["existing"].as_object().unwrap();
        assert!(!existing_json.contains_key("id"));
        assert!(!existing_json.contains_key("uid"));

        // Second one should be new
        assert_eq!(conflicts[1].incoming.title, "New Media");
        assert!(conflicts[1].existing.is_none());

        std::fs::remove_file(csv_path).ok();
    }

    #[test]
    fn test_analyze_media_csv_accepts_canonical_header_and_rejects_alias_conflicts() {
        let conn = setup_test_db();
        let canonical = "Title,Default Activity Type,Status,Language,Description,Content Type,Extra Data,Cover Image (Base64)\n\
                         Canonical,Watching,Active,Japanese,,Anime,{},\n";

        let conflicts = analyze_media_csv_from_reader(&conn, canonical.as_bytes()).unwrap();
        assert_eq!(conflicts.len(), 1);
        assert_eq!(
            conflicts[0].incoming.default_activity_type.as_deref(),
            Some("Watching")
        );
        assert!(conflicts[0].incoming.legacy_media_type.is_none());

        let conflicting = "Title,Default Activity Type,Media Type,Status,Language,Description,Content Type,Extra Data,Cover Image (Base64)\n\
                           Conflict,Watching,Reading,Active,Japanese,,Anime,{},\n";
        let error = analyze_media_csv_from_reader(&conn, conflicting.as_bytes()).unwrap_err();
        assert!(error.contains("Conflicting Default Activity Type"));
    }

    #[test]
    fn test_analyze_media_csv_accepts_optional_description_header_being_absent() {
        let conn = setup_test_db();
        let without_description = "Title,Default Activity Type,Status,Language,Content Type,Extra Data,Cover Image (Base64)\n\
                                   No Description,Reading,Active,Japanese,Novel,{},\n";

        let analyzed =
            analyze_media_csv_from_reader(&conn, without_description.as_bytes()).unwrap();
        assert_eq!(analyzed.len(), 1);
        assert_eq!(analyzed[0].incoming.description, "");
    }

    #[test]
    fn test_analyze_media_csv_variant_header_matches_exact_pair_and_blank() {
        let conn = setup_test_db();
        for variant in ["", "Manga"] {
            let mut media = sample_media("Horimiya");
            media.variant = variant.to_string();
            db::add_media_with_id(&conn, &media).unwrap();
        }
        let csv = "Title,Default Activity Type,Status,Language,Description,Content Type,Extra Data,Cover Image (Base64),Variant\n\
                   Horimiya,Reading,Active,Japanese,,Manga,{},,\n\
                   Horimiya,Reading,Active,Japanese,,Manga,{},,Manga\n\
                   Horimiya,Reading,Active,Japanese,,Anime,{},,Anime\n";

        let conflicts = analyze_media_csv_from_reader(&conn, csv.as_bytes()).unwrap();
        assert_eq!(conflicts.len(), 3);
        assert_eq!(conflicts[0].incoming.variant, "");
        assert_eq!(conflicts[0].existing.as_ref().unwrap().variant, "");
        assert_eq!(conflicts[1].incoming.variant, "Manga");
        assert_eq!(conflicts[1].existing.as_ref().unwrap().variant, "Manga");
        assert_eq!(conflicts[2].incoming.variant, "Anime");
        assert!(conflicts[2].existing.is_none());
    }

    #[test]
    fn test_analyze_media_csv_legacy_ambiguous_title_is_rejected() {
        let conn = setup_test_db();
        for variant in ["Anime", "Manga"] {
            let mut media = sample_media("Horimiya");
            media.variant = variant.to_string();
            db::add_media_with_id(&conn, &media).unwrap();
        }
        let csv = "Title,Default Activity Type,Status,Language,Description,Content Type,Extra Data,Cover Image (Base64)\n\
                   Horimiya,Reading,Active,Japanese,,Manga,{},\n";

        let error = analyze_media_csv_from_reader(&conn, csv.as_bytes()).unwrap_err();
        assert!(error.contains("Ambiguous media CSV row 2"));
        assert!(error.contains("Variant"));
    }

    #[test]
    fn test_analyze_media_csv_rejects_duplicate_exact_identity() {
        let conn = setup_test_db();
        let csv = "Title,Default Activity Type,Status,Language,Description,Content Type,Extra Data,Cover Image (Base64),Variant\n\
                   Duplicate,Reading,Active,Japanese,,Manga,{},,Manga\n\
                   Duplicate,Reading,Archived,Japanese,,Manga,{},,Manga\n";

        let error = analyze_media_csv_from_reader(&conn, csv.as_bytes()).unwrap_err();
        assert!(error.contains("rows 2 and 3"));
        assert!(error.contains("Each media identity may appear only once"));
    }

    #[test]
    fn test_export_logs_csv() {
        let conn = setup_test_db();
        let mut media = sample_media("Log Test");
        media.variant = "Manga".to_string();
        let m_id = db::add_media_with_id(&conn, &media).unwrap();

        db::add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id: m_id,
                duration_minutes: 30,
                characters: 100,
                date: "2024-01-01".to_string(),
                activity_type: "Reading".to_string(),
                notes: String::new(),
            },
        )
        .unwrap();
        db::add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id: m_id,
                duration_minutes: 45,
                characters: 200,
                date: "2024-02-01".to_string(),
                activity_type: "Watching".to_string(),
                notes: String::new(),
            },
        )
        .unwrap();
        db::add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id: m_id,
                duration_minutes: 60,
                characters: 300,
                date: "2024-03-01".to_string(),
                activity_type: "Reading".to_string(),
                notes: String::new(),
            },
        )
        .unwrap();

        let dir = std::env::temp_dir();
        let path = dir.join("export_logs_test.csv");
        let path_str = path.to_str().unwrap().to_string();

        // Test with date filtering
        let count = export_logs_csv(
            &conn,
            &path_str,
            Some("2024-01-15".into()),
            Some("2024-02-15".into()),
        )
        .unwrap();
        assert_eq!(count, 1); // Only 2024-02-01 should match

        let mut reader = csv::Reader::from_path(&path).unwrap();
        assert_eq!(
            reader.headers().unwrap().iter().collect::<Vec<_>>(),
            ActivityCsvRow::HEADERS
        );
        let rows = reader
            .deserialize::<ActivityCsvRow>()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(
            rows,
            vec![ActivityCsvRow {
                date: "2024-02-01".to_string(),
                log_name: "Log Test".to_string(),
                default_activity_type: "Reading".to_string(),
                duration: 45,
                language: "Japanese".to_string(),
                characters: 200,
                activity_type: "Watching".to_string(),
                notes: String::new(),
                media_variant: "Manga".to_string(),
            }]
        );

        let mut imported_conn = setup_test_db();
        assert_eq!(import_csv(&mut imported_conn, &path_str).unwrap(), 1);
        let imported_media = db::get_all_media(&imported_conn).unwrap();
        assert_eq!(imported_media[0].default_activity_type, "Reading");
        let imported_logs = db::get_logs(&imported_conn).unwrap();
        assert_eq!(imported_logs[0].activity_type, "Watching");

        std::fs::remove_file(path).ok();
    }

    #[test]
    fn test_activity_csv_round_trip_keeps_same_title_variants_and_per_log_types() {
        let source = setup_test_db();
        for (variant, activity_type) in [("Anime", "Watching"), ("Manga", "Reading")] {
            let mut media = sample_media("Horimiya");
            media.variant = variant.to_string();
            let media_id = db::add_media_with_id(&source, &media).unwrap();
            db::add_log(
                &source,
                &ActivityLog {
                    id: None,
                    media_id,
                    duration_minutes: 25,
                    characters: 0,
                    date: "2024-01-01".to_string(),
                    activity_type: activity_type.to_string(),
                    notes: variant.to_string(),
                },
            )
            .unwrap();
        }
        let path = std::env::temp_dir().join(format!(
            "activity_pair_roundtrip_{}_{}.csv",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        export_logs_csv(&source, path.to_str().unwrap(), None, None).unwrap();

        let mut destination = setup_test_db();
        assert_eq!(
            import_csv(&mut destination, path.to_str().unwrap()).unwrap(),
            2
        );
        let media = db::get_all_media(&destination).unwrap();
        assert_eq!(media.len(), 2);
        for (variant, activity_type) in [("Anime", "Watching"), ("Manga", "Reading")] {
            let imported = media
                .iter()
                .find(|entry| entry.title == "Horimiya" && entry.variant == variant)
                .unwrap();
            let logs = db::get_logs_for_media(&destination, imported.id.unwrap()).unwrap();
            assert_eq!(logs.len(), 1);
            assert_eq!(logs[0].activity_type, activity_type);
            assert_eq!(logs[0].notes, variant);
        }

        std::fs::remove_file(path).ok();
    }

    #[test]
    fn test_export_logs_csv_empty_database_still_writes_headers() {
        let conn = setup_test_db();
        let dir = std::env::temp_dir();
        let path = dir.join(format!(
            "empty_logs_export_{}_{}.csv",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let path_str = path.to_str().unwrap().to_string();

        let count = export_logs_csv(&conn, &path_str, None, None).unwrap();
        assert_eq!(count, 0);

        let mut reader = csv::Reader::from_path(&path).unwrap();
        let headers = reader.headers().unwrap();
        assert_eq!(headers.iter().collect::<Vec<_>>(), ActivityCsvRow::HEADERS);
        assert_eq!(reader.records().count(), 0);

        std::fs::remove_file(path).ok();
    }

    #[test]
    fn test_all_empty_exports_write_exact_human_readable_header_allowlists() {
        let conn = setup_test_db();
        let base = std::env::temp_dir().join(format!(
            "empty_csv_exports_{}_{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&base).unwrap();
        let media_path = base.join("media.csv");
        let activity_path = base.join("activity.csv");
        let milestone_path = base.join("milestones.csv");

        export_media_csv(&conn, media_path.to_str().unwrap()).unwrap();
        export_logs_csv(&conn, activity_path.to_str().unwrap(), None, None).unwrap();
        export_milestones_csv(&conn, milestone_path.to_str().unwrap()).unwrap();

        for (path, expected) in [
            (media_path, MediaCsvExportRow::HEADERS.as_slice()),
            (activity_path, ActivityCsvRow::HEADERS.as_slice()),
            (milestone_path, MilestoneCsvRow::HEADERS.as_slice()),
        ] {
            let mut reader = csv::Reader::from_path(path).unwrap();
            let headers = reader.headers().unwrap();
            assert_eq!(headers.iter().collect::<Vec<_>>(), expected);
            for header in headers {
                let normalized = header.to_ascii_lowercase();
                assert!(!matches!(
                    normalized.as_str(),
                    "id" | "uid" | "uuid" | "media id" | "media uid"
                ));
            }
        }

        std::fs::remove_dir_all(base).ok();
    }

    #[test]
    fn csv_exports_and_media_analysis_never_serialize_internal_ids() {
        const MEDIA_ID: i64 = 7_654_321_098_765_401;
        const ACTIVITY_ID: i64 = 7_654_321_098_765_402;
        const MILESTONE_ID: i64 = 7_654_321_098_765_403;
        const MEDIA_UID: &str = "11111111-2222-4333-8444-555555555555";

        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO shared.media (
                 id, uid, title, default_activity_type, status, language, description,
                 cover_image, extra_data, content_type, tracking_status, variant
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            rusqlite::params![
                MEDIA_ID,
                MEDIA_UID,
                "Boundary Sentinel",
                "Reading",
                "Active",
                "Japanese",
                "Human-readable description",
                "",
                r#"{"Developer":"Sentinel Studio"}"#,
                "Novel",
                "Ongoing",
                "Collector Edition",
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO main.activity_logs (
                 id, media_id, duration_minutes, characters, date, activity_type, notes
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                ACTIVITY_ID,
                MEDIA_ID,
                31_i64,
                271_i64,
                "2026-07-21",
                "Reading",
                "Human-readable note",
            ],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO main.milestones (
                 id, media_uid, media_title, name, duration, characters, date
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                MILESTONE_ID,
                MEDIA_UID,
                "Boundary Sentinel",
                "Human-readable checkpoint",
                31_i64,
                271_i64,
                "2026-07-21",
            ],
        )
        .unwrap();

        let base = tempfile::tempdir().unwrap();
        let media_path = base.path().join("media.csv");
        let activity_path = base.path().join("activities.csv");
        let milestone_path = base.path().join("milestones.csv");
        export_media_csv(&conn, media_path.to_str().unwrap()).unwrap();
        export_logs_csv(&conn, activity_path.to_str().unwrap(), None, None).unwrap();
        export_milestones_csv(&conn, milestone_path.to_str().unwrap()).unwrap();

        let analysis = analyze_media_csv(&conn, media_path.to_str().unwrap()).unwrap();
        assert_eq!(analysis.len(), 1);
        assert!(analysis[0].existing.is_some());

        let boundary_payloads = [
            ("media CSV", std::fs::read_to_string(&media_path).unwrap()),
            (
                "activity CSV",
                std::fs::read_to_string(&activity_path).unwrap(),
            ),
            (
                "milestone CSV",
                std::fs::read_to_string(&milestone_path).unwrap(),
            ),
            (
                "media analysis response",
                serde_json::to_string(&analysis).unwrap(),
            ),
        ];
        let forbidden_identifiers = [
            MEDIA_ID.to_string(),
            ACTIVITY_ID.to_string(),
            MILESTONE_ID.to_string(),
            MEDIA_UID.to_string(),
        ];
        for (boundary, payload) in boundary_payloads {
            for identifier in &forbidden_identifiers {
                assert!(
                    !payload.contains(identifier),
                    "{boundary} leaked internal identifier {identifier}: {payload}"
                );
            }
        }
    }

    #[test]
    fn test_import_csv_malformed_row_aborts_before_writes() {
        let mut conn = setup_test_db();
        // Row 2 is missing a column (Duration)
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language\n\
             2024-01-15,Good Row,Reading,45,Japanese\n\
             2024-01-16,Bad Row,Reading,MissingCol\n",
        );

        let error = import_csv(&mut conn, &csv_path).unwrap_err();
        assert!(error.contains("Failed to parse activity CSV row 3"));
        assert!(db::get_logs(&conn).unwrap().is_empty());
        assert!(db::get_all_media(&conn).unwrap().is_empty());

        std::fs::remove_file(csv_path).ok();
    }

    #[test]
    fn test_save_cover_bytes() {
        let conn = setup_test_db();
        let media_id = db::add_media_with_id(&conn, &sample_media("Byte Test")).unwrap();
        let temp_dir = std::env::temp_dir().join(format!("byte_covers_{}", std::process::id()));

        let bytes = vec![0, 1, 2, 3];
        let dest =
            db::save_cover_bytes(&conn, temp_dir.clone(), media_id, bytes.clone(), "png").unwrap();

        assert!(std::path::Path::new(&dest).exists());
        assert_eq!(std::fs::read(&dest).unwrap(), bytes);

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_binary_asset_round_trip() {
        let mut conn = setup_test_db();
        let temp_dir = std::env::temp_dir().join(format!("binary_test_{}", std::process::id()));
        let covers_dir = temp_dir.join("covers");
        std::fs::create_dir_all(&covers_dir).unwrap();

        // 1. Create a media with a base64 cover via import
        let fake_image_bytes = vec![255, 216, 255, 224, 0, 16, 74, 70, 73, 70]; // Fake JPEG header
        let b64_img = BASE64.encode(&fake_image_bytes);

        let records = vec![MediaCsvRow {
            title: "Binary Media".to_string(),
            default_activity_type: Some("Watching".to_string()),
            legacy_media_type: None,
            status: "Ongoing".to_string(),
            language: "English".to_string(),
            description: "".to_string(),
            content_type: "Anime".to_string(),
            extra_data: "{}".to_string(),
            cover_image_b64: b64_img,
            variant: "Anime".to_string(),
        }];

        apply_media_import(covers_dir.clone(), &mut conn, records).unwrap();

        // 2. Export it back to CSV
        let export_path = temp_dir.join("export.csv");
        let export_path_str = export_path.to_str().unwrap().to_string();
        export_media_csv(&conn, &export_path_str).unwrap();

        // 3. Verify the exported CSV contains the same base64
        let content = std::fs::read_to_string(&export_path).unwrap();
        assert!(content.contains(&BASE64.encode(&fake_image_bytes)));

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_media_csv_round_trip_preserves_same_title_variants_without_ids() {
        let source = setup_test_db();
        for variant in ["Anime", "Manga"] {
            let mut media = sample_media("Horimiya");
            media.variant = variant.to_string();
            media.content_type = variant.to_string();
            db::add_media_with_id(&source, &media).unwrap();
        }
        let temp_dir = std::env::temp_dir().join(format!(
            "media_pair_roundtrip_{}_{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();
        let csv_path = temp_dir.join("media.csv");
        export_media_csv(&source, csv_path.to_str().unwrap()).unwrap();

        let mut destination = setup_test_db();
        let conflicts = analyze_media_csv(&destination, csv_path.to_str().unwrap()).unwrap();
        assert_eq!(conflicts.len(), 2);
        assert!(conflicts.iter().all(|conflict| conflict.existing.is_none()));
        apply_media_import(
            temp_dir.join("covers"),
            &mut destination,
            conflicts
                .into_iter()
                .map(|conflict| conflict.incoming)
                .collect(),
        )
        .unwrap();

        let imported = db::get_all_media(&destination).unwrap();
        assert_eq!(imported.len(), 2);
        assert!(imported
            .iter()
            .any(|media| media.title == "Horimiya" && media.variant == "Anime"));
        assert!(imported
            .iter()
            .any(|media| media.title == "Horimiya" && media.variant == "Manga"));

        std::fs::remove_dir_all(temp_dir).ok();
    }

    #[test]
    fn test_export_milestones_csv() {
        let conn = setup_test_db();
        let mut media = sample_media("Export M");
        media.variant = "Manga".to_string();
        db::add_media_with_id(&conn, &media).unwrap();
        let media_uid = db::get_all_media(&conn).unwrap()[0].uid.clone().unwrap();
        db::add_milestone(
            &conn,
            &Milestone {
                id: None,
                media_uid: Some(media_uid),
                media_title: "Export M".into(),
                name: "M1".into(),
                duration: 120,
                characters: 500,
                date: Some("2024-03-12".into()),
            },
        )
        .unwrap();

        let dir = std::env::temp_dir();
        let path = dir.join("milestones_export.csv");
        let path_str = path.to_str().unwrap().to_string();

        let count = export_milestones_csv(&conn, &path_str).unwrap();
        assert_eq!(count, 1);

        let content = std::fs::read_to_string(&path).unwrap();
        let mut reader = csv::Reader::from_reader(content.as_bytes());
        assert_eq!(
            reader.headers().unwrap().iter().collect::<Vec<_>>(),
            MilestoneCsvRow::HEADERS
        );
        assert!(content.contains("Export M"));
        assert!(content.contains("M1"));
        assert!(content.contains("120"));
        assert!(content.contains("500"));
        assert!(content.contains("2024-03-12"));
        assert!(content.contains("Media Variant"));
        assert!(content.contains("Manga"));

        std::fs::remove_file(path).ok();
    }

    #[test]
    fn test_milestone_export_error_does_not_expose_internal_identifiers() {
        let conn = setup_test_db();
        conn.execute(
            "INSERT INTO main.milestones (
                 id, media_uid, media_title, name, duration, characters, date
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            rusqlite::params![
                424242_i64,
                "uid-private-value",
                "Missing Media",
                "Broken checkpoint",
                30_i64,
                0_i64,
                "2026-07-21"
            ],
        )
        .unwrap();
        let path =
            std::env::temp_dir().join(format!("milestone_export_error_{}.csv", std::process::id()));

        let error = export_milestones_csv(&conn, path.to_str().unwrap()).unwrap_err();
        assert!(error.contains("Broken checkpoint"));
        assert!(error.contains("Missing Media"));
        assert!(!error.contains("424242"));
        assert!(!error.contains("uid-private-value"));
        std::fs::remove_file(path).ok();
    }

    #[test]
    fn test_import_milestones_csv() {
        let mut conn = setup_test_db();
        db::add_media_with_id(&conn, &sample_media("Imported Media")).unwrap();
        let csv_path = write_csv(
            "Media Title,Name,Duration,Characters,Date\n\
             Imported Media,First Quest,60,100,2024-01-01\n\
             Imported Media,Second Quest,120,200,\n",
        );

        let count = import_milestones_csv(&mut conn, &csv_path).unwrap();
        assert_eq!(count, 2);

        let media_uid = db::get_all_media(&conn).unwrap()[0].uid.clone().unwrap();
        let milestones = db::get_milestones_for_media_uid(&conn, &media_uid).unwrap();
        assert_eq!(milestones.len(), 2);
        assert!(milestones
            .iter()
            .all(|milestone| milestone.media_uid.as_deref() == Some(media_uid.as_str())));
        assert_eq!(milestones[0].name, "First Quest");
        assert_eq!(milestones[0].characters, 100);
        assert_eq!(milestones[1].name, "Second Quest");
        assert_eq!(milestones[1].characters, 200);
        assert_eq!(milestones[1].date, None);

        std::fs::remove_file(csv_path).ok();
    }

    #[test]
    fn test_import_milestones_variant_header_resolves_exact_pair_and_blank() {
        let mut conn = setup_test_db();
        for variant in ["", "Manga"] {
            let mut media = sample_media("Horimiya");
            media.variant = variant.to_string();
            db::add_media_with_id(&conn, &media).unwrap();
        }
        let media = db::get_all_media(&conn).unwrap();
        let blank_uid = media
            .iter()
            .find(|entry| entry.variant.is_empty())
            .unwrap()
            .uid
            .clone()
            .unwrap();
        let manga_uid = media
            .iter()
            .find(|entry| entry.variant == "Manga")
            .unwrap()
            .uid
            .clone()
            .unwrap();
        let csv = "Media Title,Name,Duration,Characters,Date,Media Variant\n\
                   Horimiya,Blank milestone,60,0,2024-01-01,\n\
                   Horimiya,Manga milestone,0,100,2024-01-02,Manga\n";

        assert_eq!(
            import_milestones_csv_from_reader(&mut conn, csv.as_bytes()).unwrap(),
            2
        );
        assert_eq!(
            db::get_milestones_for_media_uid(&conn, &blank_uid).unwrap()[0].name,
            "Blank milestone"
        );
        assert_eq!(
            db::get_milestones_for_media_uid(&conn, &manga_uid).unwrap()[0].name,
            "Manga milestone"
        );
    }

    #[test]
    fn test_milestone_csv_round_trip_relinks_same_title_variants_without_exporting_ids() {
        let source = setup_test_db();
        for (variant, name) in [("Anime", "Episode 12"), ("Manga", "Volume 4")] {
            let mut media = sample_media("Horimiya");
            media.variant = variant.to_string();
            db::add_media_with_id(&source, &media).unwrap();
            let media_uid = db::get_all_media(&source)
                .unwrap()
                .into_iter()
                .find(|entry| entry.title == "Horimiya" && entry.variant == variant)
                .unwrap()
                .uid
                .unwrap();
            db::add_milestone(
                &source,
                &Milestone {
                    id: None,
                    media_uid: Some(media_uid),
                    media_title: "ignored display value".to_string(),
                    name: name.to_string(),
                    duration: 60,
                    characters: 0,
                    date: Some("2024-01-01".to_string()),
                },
            )
            .unwrap();
        }
        let path = std::env::temp_dir().join(format!(
            "milestone_pair_roundtrip_{}_{}.csv",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        export_milestones_csv(&source, path.to_str().unwrap()).unwrap();

        let mut destination = setup_test_db();
        for variant in ["Anime", "Manga"] {
            let mut media = sample_media("Horimiya");
            media.variant = variant.to_string();
            db::add_media_with_id(&destination, &media).unwrap();
        }
        assert_eq!(
            import_milestones_csv(&mut destination, path.to_str().unwrap()).unwrap(),
            2
        );
        let imported_media = db::get_all_media(&destination).unwrap();
        for (variant, name) in [("Anime", "Episode 12"), ("Manga", "Volume 4")] {
            let uid = imported_media
                .iter()
                .find(|entry| entry.title == "Horimiya" && entry.variant == variant)
                .unwrap()
                .uid
                .as_deref()
                .unwrap();
            let milestones = db::get_milestones_for_media_uid(&destination, uid).unwrap();
            assert_eq!(milestones.len(), 1);
            assert_eq!(milestones[0].name, name);
        }

        std::fs::remove_file(path).ok();
    }

    #[test]
    fn test_import_milestones_legacy_ambiguity_and_missing_media_are_atomic_errors() {
        let mut conn = setup_test_db();
        for variant in ["Anime", "Manga"] {
            let mut media = sample_media("Horimiya");
            media.variant = variant.to_string();
            db::add_media_with_id(&conn, &media).unwrap();
        }
        let ambiguous = "Media Title,Name,Duration,Characters,Date\n\
                         Horimiya,Ambiguous,60,0,2024-01-01\n";
        let error = import_milestones_csv_from_reader(&mut conn, ambiguous.as_bytes()).unwrap_err();
        assert!(error.contains("Ambiguous milestone CSV row 2"));
        assert!(db::get_all_milestones(&conn).unwrap().is_empty());

        let missing_after_valid = "Media Title,Name,Duration,Characters,Date,Media Variant\n\
                                   Horimiya,Would import,60,0,2024-01-01,Manga\n\
                                   Missing,Must abort,60,0,2024-01-02,Manga\n";
        let error = import_milestones_csv_from_reader(&mut conn, missing_after_valid.as_bytes())
            .unwrap_err();
        assert!(error.contains("no media entry matches"));
        assert!(error.contains("row 3"));
        assert!(db::get_all_milestones(&conn).unwrap().is_empty());
    }

    #[test]
    fn test_import_activity_backwards_compatibility() {
        let mut conn = setup_test_db();
        // Missing "Characters" column
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language\n\
             2024-01-15,Old Format,Reading,45,Japanese\n",
        );

        let count = import_csv(&mut conn, &csv_path).unwrap();
        assert_eq!(count, 1);

        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs[0].title, "Old Format");
        assert_eq!(logs[0].duration_minutes, 45);
        assert_eq!(logs[0].characters, 0); // Default value

        std::fs::remove_file(csv_path).ok();
    }

    #[test]
    fn test_activity_analysis_uses_full_content_and_preserves_multiplicity() {
        let conn = setup_test_db();
        let media_id = db::add_media_with_id(&conn, &sample_media("Existing")).unwrap();
        db::add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 30,
                characters: 100,
                date: "2026-07-20".to_string(),
                activity_type: "Reading".to_string(),
                notes: "same note".to_string(),
            },
        )
        .unwrap();

        let csv = "Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type,Notes,Media Variant\n\
                   2026-07-20,Existing,Reading,30,Japanese,100,Reading,same note,\n\
                   2026/07/20,Existing,Reading,30,Japanese,100,Reading,same note,\n\
                   2026-07-20,Existing,Reading,30,Japanese,100,Listening,different type,\n";
        let analysis = analyze_activity_csv_from_reader(&conn, csv.as_bytes()).unwrap();

        assert_eq!(analysis.rows.len(), 3);
        assert_eq!(analysis.groups.len(), 2);
        let exact = analysis
            .groups
            .iter()
            .find(|group| group.content.notes == "same note")
            .unwrap();
        assert_eq!(exact.incoming_count, 2);
        assert_eq!(exact.existing_count, 1);
        let different = analysis
            .groups
            .iter()
            .find(|group| group.content.notes == "different type")
            .unwrap();
        assert_eq!(different.incoming_count, 1);
        assert_eq!(different.existing_count, 0);
        let analysis_json = serde_json::to_string(&analysis).unwrap();
        for forbidden_key in ["id", "uid", "uuid"] {
            assert!(!analysis_json.contains(&format!("\"{forbidden_key}\"")));
        }
    }

    #[test]
    fn test_activity_apply_skips_only_possible_overlap_and_never_replaces() {
        let mut conn = setup_test_db();
        let media_id = db::add_media_with_id(&conn, &sample_media("Existing")).unwrap();
        let existing_id = db::add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 30,
                characters: 100,
                date: "2026-07-20".to_string(),
                activity_type: "Reading".to_string(),
                notes: "same note".to_string(),
            },
        )
        .unwrap();
        let csv = "Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type,Notes,Media Variant\n\
                   2026-07-20,Existing,Reading,30,Japanese,100,Reading,same note,\n\
                   2026-07-20,Existing,Reading,30,Japanese,100,Reading,same note,\n";
        let analysis = analyze_activity_csv_from_reader(&conn, csv.as_bytes()).unwrap();
        let conflict = analysis.groups[0].content.clone();
        let result = apply_activity_import(
            &mut conn,
            ActivityCsvImportRequest {
                rows: analysis.rows,
                analyzed_groups: analysis.groups,
                resolutions: vec![ActivityCsvConflictResolution {
                    content: conflict,
                    action: ActivityCsvConflictAction::SkipPossibleOverlaps,
                }],
            },
        )
        .unwrap();

        assert_eq!(result.imported_count, 1);
        assert_eq!(result.skipped_count, 1);
        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 2);
        assert!(logs.iter().any(|log| log.id == Some(existing_id)));
    }

    #[test]
    fn test_activity_apply_rejects_stale_analysis_and_retry_without_writes() {
        let mut conn = setup_test_db();
        let media_id = db::add_media_with_id(&conn, &sample_media("Existing")).unwrap();
        let csv = "Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type,Notes,Media Variant\n\
                   2026-07-20,Existing,Reading,30,Japanese,100,Reading,same note,\n";
        let analysis = analyze_activity_csv_from_reader(&conn, csv.as_bytes()).unwrap();
        assert_eq!(analysis.groups[0].existing_count, 0);

        db::add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 30,
                characters: 100,
                date: "2026-07-20".to_string(),
                activity_type: "Reading".to_string(),
                notes: "same note".to_string(),
            },
        )
        .unwrap();

        let error = apply_activity_import(
            &mut conn,
            ActivityCsvImportRequest {
                rows: analysis.rows,
                analyzed_groups: analysis.groups,
                resolutions: vec![],
            },
        )
        .unwrap_err();
        assert!(error.contains("changed after conflict review"));
        assert_eq!(db::get_logs(&conn).unwrap().len(), 1);
    }

    #[test]
    fn test_activity_apply_can_import_an_exact_match_as_a_separate_occurrence() {
        let mut conn = setup_test_db();
        let media_id = db::add_media_with_id(&conn, &sample_media("Existing")).unwrap();
        db::add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 30,
                characters: 0,
                date: "2026-07-20".to_string(),
                activity_type: "Reading".to_string(),
                notes: String::new(),
            },
        )
        .unwrap();
        let csv = "Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type,Notes,Media Variant\n\
                   2026-07-20,Existing,Reading,30,Japanese,0,Reading,,\n";
        let analysis = analyze_activity_csv_from_reader(&conn, csv.as_bytes()).unwrap();
        let content = analysis.groups[0].content.clone();
        let result = apply_activity_import(
            &mut conn,
            ActivityCsvImportRequest {
                rows: analysis.rows,
                analyzed_groups: analysis.groups,
                resolutions: vec![ActivityCsvConflictResolution {
                    content,
                    action: ActivityCsvConflictAction::ImportAll,
                }],
            },
        )
        .unwrap();
        assert_eq!(result.imported_count, 1);
        assert_eq!(result.skipped_count, 0);
        assert_eq!(db::get_logs(&conn).unwrap().len(), 2);
    }

    #[test]
    fn test_legacy_activity_import_requires_review_for_possible_duplicates() {
        let mut conn = setup_test_db();
        let media_id = db::add_media_with_id(&conn, &sample_media("Existing")).unwrap();
        db::add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 30,
                characters: 0,
                date: "2026-07-20".to_string(),
                activity_type: "Reading".to_string(),
                notes: String::new(),
            },
        )
        .unwrap();
        let csv = "Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type,Notes,Media Variant\n\
                   2026-07-20,Existing,Reading,30,Japanese,0,Reading,,\n";

        let error = import_csv_from_reader(&mut conn, csv.as_bytes()).unwrap_err();

        assert!(error.contains("explicitly resolve every conflict"));
        assert_eq!(db::get_logs(&conn).unwrap().len(), 1);
    }

    #[test]
    fn test_activity_csv_negative_metrics_abort_before_media_or_log_writes() {
        let conn = setup_test_db();
        let csv = "Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type,Notes,Media Variant\n\
                   2026-07-20,Would Be New,Reading,30,Japanese,100,Reading,valid,\n\
                   2026-07-21,Negative,Reading,-1,Japanese,100,Reading,invalid,\n";
        let error = analyze_activity_csv_from_reader(&conn, csv.as_bytes()).unwrap_err();
        assert!(error.contains("Activity duration cannot be negative"));
        assert!(db::get_all_media(&conn).unwrap().is_empty());
        assert!(db::get_logs(&conn).unwrap().is_empty());

        let negative_characters = "Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type,Notes,Media Variant\n\
                                   2026-07-20,Negative Chars,Reading,30,Japanese,-1,Reading,invalid,\n";
        let error =
            analyze_activity_csv_from_reader(&conn, negative_characters.as_bytes()).unwrap_err();
        assert!(error.contains("Activity character count cannot be negative"));
    }

    #[test]
    fn test_activity_csv_rejects_conflicting_languages_for_new_media() {
        let conn = setup_test_db();
        let csv = "Date,Log Name,Default Activity Type,Duration,Language,Characters,Activity Type,Notes,Media Variant\n\
                   2026-07-20,New Media,Reading,30,Japanese,0,Reading,,\n\
                   2026-07-21,New Media,Reading,30,English,0,Reading,,\n";
        let error = analyze_activity_csv_from_reader(&conn, csv.as_bytes()).unwrap_err();
        assert!(error.contains("Conflicting Language values for new media"));
        assert!(db::get_all_media(&conn).unwrap().is_empty());
        assert!(db::get_logs(&conn).unwrap().is_empty());
    }

    #[test]
    fn test_import_csv_rejects_invalid_date_format_and_rolls_back() {
        let mut conn = setup_test_db();
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language\n\
             2024-01-15,Valid Row,Reading,45,Japanese\n\
             01/16/2024,Invalid Row,Reading,30,Japanese\n",
        );

        let result = import_csv(&mut conn, &csv_path);
        assert!(result.is_err());

        let error = result.err().unwrap();
        assert!(error.contains("Invalid date format on CSV row 3"));
        assert!(error.contains("Expected YYYY/MM/DD or YYYY-MM-DD"));

        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 0);

        std::fs::remove_file(csv_path).ok();
    }

    #[test]
    fn test_export_logs_csv_includes_notes_column() {
        let conn = setup_test_db();
        let media_id = db::add_media_with_id(&conn, &sample_media("Notes Export")).unwrap();

        db::add_log(
            &conn,
            &ActivityLog {
                id: None,
                media_id,
                duration_minutes: 30,
                characters: 0,
                date: "2024-07-01".to_string(),
                activity_type: "Reading".to_string(),
                notes: "exported note text".to_string(),
            },
        )
        .unwrap();

        let dir = std::env::temp_dir();
        let path = dir.join(format!(
            "notes_export_{}_{}.csv",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::SeqCst)
        ));
        let path_str = path.to_str().unwrap().to_string();

        let count = export_logs_csv(&conn, &path_str, None, None).unwrap();
        assert_eq!(count, 1);

        let content = std::fs::read_to_string(&path).unwrap();
        assert!(content.contains("Notes"), "Header should include 'Notes'");
        assert!(
            content.contains("exported note text"),
            "Row should contain the note text"
        );

        std::fs::remove_file(path).ok();
    }

    #[test]
    fn test_import_csv_with_notes_column_imports_note() {
        let mut conn = setup_test_db();
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language,Characters,Activity Type,Notes\n\
             2024-08-01,Notes Media,Reading,45,Japanese,1000,Reading,My note here\n",
        );

        let count = import_csv(&mut conn, &csv_path).unwrap();
        assert_eq!(count, 1);

        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].notes, "My note here");

        std::fs::remove_file(csv_path).ok();
    }

    #[test]
    fn test_import_csv_without_notes_column_imports_with_empty_notes() {
        // Old-format CSV without a Notes column should import cleanly with empty notes.
        // Guards the #[serde(rename = "Notes", default)] on CsvRow.notes.
        let mut conn = setup_test_db();
        let csv_path = write_csv(
            "Date,Log Name,Media Type,Duration,Language,Characters,Activity Type\n\
             2024-09-01,Old Format Media,Reading,30,Japanese,500,Reading\n",
        );

        let count = import_csv(&mut conn, &csv_path).unwrap();
        assert_eq!(count, 1);

        let logs = db::get_logs(&conn).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].notes, "");

        std::fs::remove_file(csv_path).ok();
    }
}
