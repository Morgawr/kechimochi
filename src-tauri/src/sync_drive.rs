use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};
use std::future::Future;
use std::io::{Read, Write};
use std::pin::Pin;
use std::time::Duration;

use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use futures::StreamExt;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use url::Url;

use crate::db;
use crate::sync_auth::{self, GoogleOAuthClientConfig, SecureTokenStore};
use crate::sync_snapshot::{self, SyncSnapshot, SYNC_PROTOCOL_VERSION};

const DEFAULT_DRIVE_API_BASE_URL: &str = "https://www.googleapis.com/drive/v3";
const DEFAULT_DRIVE_UPLOAD_BASE_URL: &str = "https://www.googleapis.com/upload/drive/v3";
const ENV_DRIVE_API_BASE_URL: &str = "KECHIMOCHI_GOOGLE_DRIVE_API_BASE_URL";
const ENV_DRIVE_UPLOAD_BASE_URL: &str = "KECHIMOCHI_GOOGLE_DRIVE_UPLOAD_BASE_URL";
const APP_USER_AGENT: &str = concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION"));
const APP_DATA_FOLDER_NAME: &str = "appDataFolder";
const MANIFEST_FILE_PREFIX: &str = "kechimochi-manifest-";
const SNAPSHOT_FILE_PREFIX: &str = "kechimochi-snapshot-";
const BLOB_FILE_PREFIX: &str = "kechimochi-blob-";
const MANIFEST_FILE_SUFFIX: &str = ".json";
const SNAPSHOT_FILE_SUFFIX: &str = ".json.gz";
const DRIVE_FILE_FIELDS: &str = "nextPageToken,files(id,name,mimeType,size,modifiedTime)";
const LIST_PAGE_SIZE: &str = "100";
const DRIVE_HTTP_CONNECT_TIMEOUT_SECS: u64 = 15;
const DRIVE_HTTP_REQUEST_TIMEOUT_SECS: u64 = 300;
const MAX_DRIVE_JSON_RESPONSE_BYTES: usize = 16 * 1024 * 1024;
const MAX_DRIVE_BINARY_RESPONSE_BYTES: usize = 512 * 1024 * 1024;
const MAX_DRIVE_ERROR_RESPONSE_BYTES: usize = 64 * 1024;
const MAX_SNAPSHOT_JSON_BYTES: usize = 512 * 1024 * 1024;
pub const MAX_SYNC_COVER_BLOB_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct DriveFileMetadata {
    pub id: String,
    pub name: String,
    #[serde(default, rename = "mimeType")]
    pub mime_type: Option<String>,
    #[serde(default)]
    pub size: Option<String>,
    #[serde(default, rename = "modifiedTime")]
    pub modified_time: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct RemoteSyncManifest {
    pub sync_protocol_version: i64,
    pub db_schema_version: i64,
    pub profile_id: String,
    pub profile_name: String,
    pub snapshot_id: String,
    pub snapshot_sha256: String,
    pub remote_generation: i64,
    pub updated_at: String,
    pub last_writer_device_id: String,
}

impl RemoteSyncManifest {
    pub fn new(
        profile_id: &str,
        profile_name: &str,
        snapshot_id: &str,
        snapshot_sha256: &str,
        remote_generation: i64,
        updated_at: &str,
        last_writer_device_id: &str,
    ) -> Self {
        Self {
            sync_protocol_version: SYNC_PROTOCOL_VERSION,
            db_schema_version: db::CURRENT_SCHEMA_VERSION,
            profile_id: profile_id.to_string(),
            profile_name: profile_name.to_string(),
            snapshot_id: snapshot_id.to_string(),
            snapshot_sha256: snapshot_sha256.to_string(),
            remote_generation,
            updated_at: updated_at.to_string(),
            last_writer_device_id: last_writer_device_id.to_string(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemoteManifestFile {
    pub file: DriveFileMetadata,
    pub manifest: RemoteSyncManifest,
    pub etag: Option<String>,
}

fn compare_manifest_candidates(left: &RemoteManifestFile, right: &RemoteManifestFile) -> Ordering {
    left.manifest
        .remote_generation
        .cmp(&right.manifest.remote_generation)
        .then_with(|| left.manifest.updated_at.cmp(&right.manifest.updated_at))
        .then_with(|| left.manifest.snapshot_id.cmp(&right.manifest.snapshot_id))
        .then_with(|| left.file.id.cmp(&right.file.id))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UploadedSnapshot {
    pub file: DriveFileMetadata,
    pub snapshot_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManifestWriteOutcome {
    pub file: DriveFileMetadata,
    pub written_manifest: RemoteSyncManifest,
    pub confirmed_manifest: RemoteSyncManifest,
    pub race_won: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SnapshotArchive {
    pub canonical_json: String,
    pub sha256: String,
    pub gzipped_bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
struct DriveFileListResponse {
    #[serde(default, rename = "nextPageToken")]
    next_page_token: Option<String>,
    #[serde(default)]
    files: Vec<DriveFileMetadata>,
}

#[derive(Debug, Serialize)]
struct DriveUploadMetadata<'a> {
    name: &'a str,
    #[serde(rename = "mimeType")]
    mime_type: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    parents: Option<Vec<&'a str>>,
}

pub type TransportFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send + 'a>>;

pub trait DriveTransport: Clone + Send + Sync + 'static {
    fn request_json<'a>(
        &'a self,
        method: Method,
        url: &'a str,
        access_token: &'a str,
        content_type: Option<String>,
        body: Option<Vec<u8>>,
    ) -> TransportFuture<'a, serde_json::Value>;

    fn request_bytes<'a>(
        &'a self,
        method: Method,
        url: &'a str,
        access_token: &'a str,
        content_type: Option<String>,
        body: Option<Vec<u8>>,
    ) -> TransportFuture<'a, Vec<u8>>;

    fn request_json_with_headers<'a>(
        &'a self,
        method: Method,
        url: &'a str,
        access_token: &'a str,
        content_type: Option<String>,
        body: Option<Vec<u8>>,
        headers: Vec<(String, String)>,
    ) -> TransportFuture<'a, serde_json::Value> {
        if headers.is_empty() {
            self.request_json(method, url, access_token, content_type, body)
        } else {
            Box::pin(async {
                Err("Drive transport does not support conditional request headers".to_string())
            })
        }
    }

    fn request_bytes_with_etag<'a>(
        &'a self,
        method: Method,
        url: &'a str,
        access_token: &'a str,
        content_type: Option<String>,
        body: Option<Vec<u8>>,
        max_response_bytes: usize,
    ) -> TransportFuture<'a, (Vec<u8>, Option<String>)>;
}

#[derive(Debug, Clone)]
pub struct ReqwestDriveTransport {
    http_client: reqwest::Client,
}

impl ReqwestDriveTransport {
    fn new() -> Result<Self, String> {
        let http_client = reqwest::Client::builder()
            .user_agent(APP_USER_AGENT)
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(DRIVE_HTTP_CONNECT_TIMEOUT_SECS))
            .timeout(Duration::from_secs(DRIVE_HTTP_REQUEST_TIMEOUT_SECS))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self { http_client })
    }
}

impl DriveTransport for ReqwestDriveTransport {
    fn request_json<'a>(
        &'a self,
        method: Method,
        url: &'a str,
        access_token: &'a str,
        content_type: Option<String>,
        body: Option<Vec<u8>>,
    ) -> TransportFuture<'a, serde_json::Value> {
        Box::pin(async move {
            let mut request = self
                .http_client
                .request(method, url)
                .bearer_auth(access_token);
            if let Some(content_type) = content_type {
                request = request.header(reqwest::header::CONTENT_TYPE, content_type);
            }
            if let Some(body) = body {
                request = request.body(body);
            }

            let response = request.send().await.map_err(drive_http_error_message)?;
            let response = read_success_response(response).await?;
            let bytes = read_bounded_response(response, MAX_DRIVE_JSON_RESPONSE_BYTES).await?;
            serde_json::from_slice(&bytes).map_err(|error| error.to_string())
        })
    }

    fn request_bytes<'a>(
        &'a self,
        method: Method,
        url: &'a str,
        access_token: &'a str,
        content_type: Option<String>,
        body: Option<Vec<u8>>,
    ) -> TransportFuture<'a, Vec<u8>> {
        Box::pin(async move {
            let mut request = self
                .http_client
                .request(method, url)
                .bearer_auth(access_token);
            if let Some(content_type) = content_type {
                request = request.header(reqwest::header::CONTENT_TYPE, content_type);
            }
            if let Some(body) = body {
                request = request.body(body);
            }

            let response = request.send().await.map_err(drive_http_error_message)?;
            let response = read_success_response(response).await?;
            read_bounded_response(response, MAX_DRIVE_BINARY_RESPONSE_BYTES).await
        })
    }

    fn request_json_with_headers<'a>(
        &'a self,
        method: Method,
        url: &'a str,
        access_token: &'a str,
        content_type: Option<String>,
        body: Option<Vec<u8>>,
        headers: Vec<(String, String)>,
    ) -> TransportFuture<'a, serde_json::Value> {
        Box::pin(async move {
            let mut request = self
                .http_client
                .request(method, url)
                .bearer_auth(access_token);
            if let Some(content_type) = content_type {
                request = request.header(reqwest::header::CONTENT_TYPE, content_type);
            }
            for (name, value) in headers {
                request = request.header(name, value);
            }
            if let Some(body) = body {
                request = request.body(body);
            }

            let response = request.send().await.map_err(drive_http_error_message)?;
            let response = read_success_response(response).await?;
            let bytes = read_bounded_response(response, MAX_DRIVE_JSON_RESPONSE_BYTES).await?;
            serde_json::from_slice(&bytes).map_err(|error| error.to_string())
        })
    }

    fn request_bytes_with_etag<'a>(
        &'a self,
        method: Method,
        url: &'a str,
        access_token: &'a str,
        content_type: Option<String>,
        body: Option<Vec<u8>>,
        max_response_bytes: usize,
    ) -> TransportFuture<'a, (Vec<u8>, Option<String>)> {
        Box::pin(async move {
            let mut request = self
                .http_client
                .request(method, url)
                .bearer_auth(access_token);
            if let Some(content_type) = content_type {
                request = request.header(reqwest::header::CONTENT_TYPE, content_type);
            }
            if let Some(body) = body {
                request = request.body(body);
            }

            let response = request.send().await.map_err(drive_http_error_message)?;
            let response = read_success_response(response).await?;
            let etag = response
                .headers()
                .get(reqwest::header::ETAG)
                .and_then(|value| value.to_str().ok())
                .map(ToString::to_string);
            let bytes = read_bounded_response(response, max_response_bytes).await?;
            Ok((bytes, etag))
        })
    }
}

#[derive(Debug, Clone)]
pub struct GoogleDriveClient<T: DriveTransport = ReqwestDriveTransport> {
    auth_config: GoogleOAuthClientConfig,
    api_base_url: String,
    upload_base_url: String,
    transport: T,
}

pub fn manifest_file_name(profile_id: &str) -> String {
    format!("{MANIFEST_FILE_PREFIX}{profile_id}{MANIFEST_FILE_SUFFIX}")
}

pub fn snapshot_file_name(profile_id: &str, snapshot_id: &str) -> String {
    format!("{SNAPSHOT_FILE_PREFIX}{profile_id}-{snapshot_id}{SNAPSHOT_FILE_SUFFIX}")
}

pub fn blob_file_name(sha256: &str) -> String {
    format!("{BLOB_FILE_PREFIX}{sha256}")
}

pub fn archive_snapshot(snapshot: &SyncSnapshot) -> Result<SnapshotArchive, String> {
    let canonical_json = sync_snapshot::snapshot_to_canonical_json(snapshot)?;
    let sha256 = compute_sha256_hex(canonical_json.as_bytes());

    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder
        .write_all(canonical_json.as_bytes())
        .map_err(|e| e.to_string())?;
    let gzipped_bytes = encoder.finish().map_err(|e| e.to_string())?;

    Ok(SnapshotArchive {
        canonical_json,
        sha256,
        gzipped_bytes,
    })
}

pub fn parse_archived_snapshot(
    gzipped_bytes: &[u8],
    expected_sha256: &str,
) -> Result<SyncSnapshot, String> {
    let json_bytes = decompress_with_limit(gzipped_bytes, MAX_SNAPSHOT_JSON_BYTES)?;

    let actual_sha256 = compute_sha256_hex(&json_bytes);
    if actual_sha256 != expected_sha256 {
        return Err(format!(
            "Remote snapshot checksum mismatch (expected {expected_sha256}, got {actual_sha256})"
        ));
    }

    let json = String::from_utf8(json_bytes)
        .map_err(|e| format!("Remote snapshot is not valid UTF-8 JSON: {e}"))?;
    sync_snapshot::parse_snapshot_json(&json)
}

fn decompress_with_limit(gzipped_bytes: &[u8], limit: usize) -> Result<Vec<u8>, String> {
    let decoder = GzDecoder::new(gzipped_bytes);
    let mut limited = decoder.take(limit as u64 + 1);
    let mut bytes = Vec::new();
    limited
        .read_to_end(&mut bytes)
        .map_err(|e| format!("Failed to decompress snapshot archive: {e}"))?;
    if bytes.len() > limit {
        return Err(format!(
            "Remote snapshot expands beyond the supported {limit} byte limit"
        ));
    }
    Ok(bytes)
}

pub fn validate_remote_manifest_compatibility(manifest: &RemoteSyncManifest) -> Result<(), String> {
    if manifest.sync_protocol_version != SYNC_PROTOCOL_VERSION {
        return Err(format!(
            "Unsupported sync protocol version {} (expected {})",
            manifest.sync_protocol_version, SYNC_PROTOCOL_VERSION
        ));
    }

    if manifest.db_schema_version < 1 {
        return Err(format!(
            "Remote manifest has invalid DB schema version {}",
            manifest.db_schema_version
        ));
    }
    if manifest.db_schema_version > db::CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "Remote manifest requires unsupported DB schema version {} (local supports {})",
            manifest.db_schema_version,
            db::CURRENT_SCHEMA_VERSION
        ));
    }
    if manifest.profile_id.trim().is_empty() {
        return Err("Remote manifest has a blank profile id".to_string());
    }
    if manifest.snapshot_id.trim().is_empty() {
        return Err("Remote manifest has a blank snapshot id".to_string());
    }
    if manifest.remote_generation < 1 {
        return Err(format!(
            "Remote manifest has invalid generation {}",
            manifest.remote_generation
        ));
    }
    if manifest.remote_generation == i64::MAX {
        return Err("Remote manifest generation is exhausted".to_string());
    }

    Ok(())
}

pub fn next_remote_generation(current: i64) -> Result<i64, String> {
    current
        .checked_add(1)
        .filter(|generation| *generation > 0)
        .ok_or_else(|| format!("Remote manifest generation {current} cannot be incremented"))
}

pub fn validate_remote_snapshot_compatibility(snapshot: &SyncSnapshot) -> Result<(), String> {
    if snapshot.sync_protocol_version != SYNC_PROTOCOL_VERSION {
        return Err(format!(
            "Unsupported sync protocol version {} (expected {})",
            snapshot.sync_protocol_version, SYNC_PROTOCOL_VERSION
        ));
    }

    if snapshot.db_schema_version < 1 {
        return Err(format!(
            "Remote snapshot has invalid DB schema version {}",
            snapshot.db_schema_version
        ));
    }
    if snapshot.db_schema_version > db::CURRENT_SCHEMA_VERSION {
        return Err(format!(
            "Remote snapshot requires unsupported DB schema version {} (local supports {})",
            snapshot.db_schema_version,
            db::CURRENT_SCHEMA_VERSION
        ));
    }
    if snapshot.snapshot_id.trim().is_empty() {
        return Err("Remote snapshot has a blank snapshot id".to_string());
    }
    if snapshot.profile.profile_id.trim().is_empty() {
        return Err("Remote snapshot has a blank profile id".to_string());
    }

    let mut identities: BTreeMap<(&str, &str), &str> = BTreeMap::new();
    let mut activity_uids = BTreeSet::new();
    let mut milestone_uids = BTreeSet::new();
    for (uid, media) in &snapshot.library {
        if uid.trim().is_empty() {
            return Err("Remote snapshot contains media with a blank sync UID".to_string());
        }
        if uid != &media.uid {
            return Err(format!(
                "Remote snapshot library key '{uid}' does not match media uid '{}'",
                media.uid
            ));
        }
        if media.title.trim().is_empty() {
            return Err(format!("Remote snapshot media '{uid}' has a blank title"));
        }
        let normalized_variant = media.variant.trim();
        if identities
            .insert((media.title.as_str(), normalized_variant), uid.as_str())
            .is_some()
        {
            let label = if normalized_variant.is_empty() {
                media.title.clone()
            } else {
                format!("{} — {}", media.title, normalized_variant)
            };
            return Err(format!(
                "Remote snapshot contains more than one media entry using '{label}'"
            ));
        }
        if let Some(hash) = media.cover_blob_sha256.as_deref() {
            if hash.len() != 64
                || !hash
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            {
                return Err(format!(
                    "Remote snapshot media '{uid}' has an invalid cover checksum"
                ));
            }
        }
        for activity in &media.activities {
            if activity.uid.trim().is_empty() {
                return Err(format!(
                    "Remote snapshot media '{uid}' contains an activity with a blank sync UID"
                ));
            }
            if !activity_uids.insert(activity.uid.as_str()) {
                return Err(format!(
                    "Remote snapshot contains duplicate activity sync UID '{}'",
                    activity.uid
                ));
            }
        }
        for milestone in &media.milestones {
            if milestone.uid.trim().is_empty() {
                return Err(format!(
                    "Remote snapshot media '{uid}' contains a milestone with a blank sync UID"
                ));
            }
            if !milestone_uids.insert(milestone.uid.as_str()) {
                return Err(format!(
                    "Remote snapshot contains duplicate milestone sync UID '{}'",
                    milestone.uid
                ));
            }
        }
    }
    let mut tombstone_uids = BTreeSet::new();
    for tombstone in &snapshot.tombstones {
        if tombstone.media_uid.trim().is_empty() {
            return Err("Remote snapshot contains a tombstone with a blank media UID".to_string());
        }
        if !tombstone_uids.insert(tombstone.media_uid.as_str()) {
            return Err(format!(
                "Remote snapshot contains duplicate tombstones for media '{}'",
                tombstone.media_uid
            ));
        }
        if snapshot.library.contains_key(&tombstone.media_uid) {
            return Err(format!(
                "Remote snapshot contains both live media and a tombstone for '{}'",
                tombstone.media_uid
            ));
        }
    }

    Ok(())
}

impl GoogleDriveClient<ReqwestDriveTransport> {
    pub fn new(auth_config: GoogleOAuthClientConfig) -> Result<Self, String> {
        let api_base_url = std::env::var(ENV_DRIVE_API_BASE_URL)
            .unwrap_or_else(|_| DEFAULT_DRIVE_API_BASE_URL.to_string());
        let upload_base_url = std::env::var(ENV_DRIVE_UPLOAD_BASE_URL)
            .unwrap_or_else(|_| DEFAULT_DRIVE_UPLOAD_BASE_URL.to_string());
        Self::new_with_base_urls(auth_config, &api_base_url, &upload_base_url)
    }

    pub fn new_with_base_urls(
        auth_config: GoogleOAuthClientConfig,
        api_base_url: &str,
        upload_base_url: &str,
    ) -> Result<Self, String> {
        let transport = ReqwestDriveTransport::new()?;

        Ok(Self {
            auth_config,
            api_base_url: api_base_url.trim_end_matches('/').to_string(),
            upload_base_url: upload_base_url.trim_end_matches('/').to_string(),
            transport,
        })
    }
}

impl<T: DriveTransport> GoogleDriveClient<T> {
    #[cfg(test)]
    pub(crate) fn new_with_transport(
        auth_config: GoogleOAuthClientConfig,
        api_base_url: &str,
        upload_base_url: &str,
        transport: T,
    ) -> Self {
        Self {
            auth_config,
            api_base_url: api_base_url.trim_end_matches('/').to_string(),
            upload_base_url: upload_base_url.trim_end_matches('/').to_string(),
            transport,
        }
    }

    pub async fn list_app_data_files(
        &self,
        token_store: &dyn SecureTokenStore,
        query: Option<&str>,
    ) -> Result<Vec<DriveFileMetadata>, String> {
        let access_token = self.access_token(token_store).await?;
        let mut files = Vec::new();
        let mut next_page_token = None;

        loop {
            let mut url =
                Url::parse(&format!("{}/files", self.api_base_url)).map_err(|e| e.to_string())?;
            {
                let mut pairs = url.query_pairs_mut();
                pairs.append_pair("spaces", APP_DATA_FOLDER_NAME);
                pairs.append_pair("fields", DRIVE_FILE_FIELDS);
                pairs.append_pair("pageSize", LIST_PAGE_SIZE);
                if let Some(query) = query {
                    pairs.append_pair("q", query);
                }
                if let Some(page_token) = next_page_token.as_deref() {
                    pairs.append_pair("pageToken", page_token);
                }
            }

            let page: DriveFileListResponse = serde_json::from_value(
                self.transport
                    .request_json(Method::GET, url.as_str(), &access_token, None, None)
                    .await?,
            )
            .map_err(|e| e.to_string())?;

            files.extend(page.files);
            if let Some(page_token) = page.next_page_token {
                next_page_token = Some(page_token);
            } else {
                break;
            }
        }

        Ok(files)
    }

    pub async fn download_app_data_file_by_id(
        &self,
        token_store: &dyn SecureTokenStore,
        file_id: &str,
    ) -> Result<Vec<u8>, String> {
        self.download_app_data_file_by_id_with_limit(
            token_store,
            file_id,
            MAX_DRIVE_BINARY_RESPONSE_BYTES,
        )
        .await
    }

    pub(crate) async fn download_app_data_file_by_id_with_limit(
        &self,
        token_store: &dyn SecureTokenStore,
        file_id: &str,
        max_response_bytes: usize,
    ) -> Result<Vec<u8>, String> {
        self.download_app_data_file_by_id_with_etag(token_store, file_id, max_response_bytes)
            .await
            .map(|(bytes, _)| bytes)
    }

    async fn download_app_data_file_by_id_with_etag(
        &self,
        token_store: &dyn SecureTokenStore,
        file_id: &str,
        max_response_bytes: usize,
    ) -> Result<(Vec<u8>, Option<String>), String> {
        let access_token = self.access_token(token_store).await?;
        let mut url = Url::parse(&format!("{}/files/{}", self.api_base_url, file_id))
            .map_err(|e| e.to_string())?;
        url.query_pairs_mut().append_pair("alt", "media");

        self.transport
            .request_bytes_with_etag(
                Method::GET,
                url.as_str(),
                &access_token,
                None,
                None,
                max_response_bytes,
            )
            .await
    }

    pub async fn upload_app_data_file(
        &self,
        token_store: &dyn SecureTokenStore,
        file_name: &str,
        mime_type: &str,
        bytes: &[u8],
        existing_file_id: Option<&str>,
        if_match: Option<&str>,
    ) -> Result<DriveFileMetadata, String> {
        let access_token = self.access_token(token_store).await?;
        let url = match existing_file_id {
            Some(file_id) => format!(
                "{}/files/{}?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime",
                self.upload_base_url, file_id
            ),
            None => format!(
                "{}/files?uploadType=multipart&fields=id,name,mimeType,size,modifiedTime",
                self.upload_base_url
            ),
        };

        let metadata = DriveUploadMetadata {
            name: file_name,
            mime_type,
            parents: if existing_file_id.is_some() {
                None
            } else {
                Some(vec![APP_DATA_FOLDER_NAME])
            },
        };
        let (content_type, body) = build_multipart_related_body(&metadata, mime_type, bytes)?;
        let method = if existing_file_id.is_some() {
            Method::PATCH
        } else {
            Method::POST
        };

        let response = if let Some(etag) = if_match {
            self.transport
                .request_json_with_headers(
                    method,
                    &url,
                    &access_token,
                    Some(content_type),
                    Some(body),
                    vec![("If-Match".to_string(), etag.to_string())],
                )
                .await?
        } else {
            self.transport
                .request_json(method, &url, &access_token, Some(content_type), Some(body))
                .await?
        };
        serde_json::from_value(response).map_err(|e| e.to_string())
    }

    pub async fn list_remote_sync_profiles(
        &self,
        token_store: &dyn SecureTokenStore,
    ) -> Result<Vec<RemoteManifestFile>, String> {
        let query = format!(
            "name contains '{}' and trashed = false",
            MANIFEST_FILE_PREFIX
        );
        let files = self.list_app_data_files(token_store, Some(&query)).await?;
        let mut manifests_by_profile = BTreeMap::<String, RemoteManifestFile>::new();

        for file in files {
            let (bytes, etag) = self
                .download_app_data_file_by_id_with_etag(
                    token_store,
                    &file.id,
                    MAX_DRIVE_JSON_RESPONSE_BYTES,
                )
                .await
                .map_err(|e| format!("Failed to download manifest '{}': {e}", file.name))?;
            let manifest = parse_manifest_bytes(&bytes)
                .map_err(|e| format!("Failed to parse manifest '{}': {e}", file.name))?;
            validate_remote_manifest_compatibility(&manifest)
                .map_err(|e| format!("Manifest '{}' is incompatible: {e}", file.name))?;
            if file.name != manifest_file_name(&manifest.profile_id) {
                return Err(format!(
                    "Manifest file '{}' contains profile id '{}', which does not match its name",
                    file.name, manifest.profile_id
                ));
            }
            let candidate = RemoteManifestFile {
                file,
                manifest,
                etag,
            };
            let replace = manifests_by_profile
                .get(&candidate.manifest.profile_id)
                .is_none_or(|current| {
                    compare_manifest_candidates(&candidate, current) == Ordering::Greater
                });
            if replace {
                manifests_by_profile.insert(candidate.manifest.profile_id.clone(), candidate);
            }
        }

        let mut manifests = manifests_by_profile.into_values().collect::<Vec<_>>();
        manifests.sort_by(|left, right| {
            right
                .manifest
                .updated_at
                .cmp(&left.manifest.updated_at)
                .then_with(|| left.manifest.profile_id.cmp(&right.manifest.profile_id))
        });
        Ok(manifests)
    }

    pub async fn read_manifest(
        &self,
        token_store: &dyn SecureTokenStore,
        profile_id: &str,
    ) -> Result<Option<RemoteManifestFile>, String> {
        let file_name = manifest_file_name(profile_id);
        let files = self
            .list_app_data_files_by_name(token_store, &file_name)
            .await?;
        let mut candidates = Vec::with_capacity(files.len());
        for file in files {
            let (bytes, etag) = self
                .download_app_data_file_by_id_with_etag(
                    token_store,
                    &file.id,
                    MAX_DRIVE_JSON_RESPONSE_BYTES,
                )
                .await
                .map_err(|e| format!("Failed to download manifest '{file_name}': {e}"))?;
            let manifest = parse_manifest_bytes(&bytes)
                .map_err(|e| format!("Failed to parse manifest '{file_name}': {e}"))?;
            validate_remote_manifest_compatibility(&manifest)
                .map_err(|e| format!("Manifest '{file_name}' is incompatible: {e}"))?;
            if manifest.profile_id != profile_id {
                return Err(format!(
                    "Manifest file '{file_name}' contains profile id '{}' instead of '{profile_id}'",
                    manifest.profile_id
                ));
            }
            candidates.push(RemoteManifestFile {
                file,
                manifest,
                etag,
            });
        }
        Ok(candidates.into_iter().max_by(compare_manifest_candidates))
    }

    pub async fn upsert_manifest_and_confirm(
        &self,
        token_store: &dyn SecureTokenStore,
        manifest: &RemoteSyncManifest,
    ) -> Result<ManifestWriteOutcome, String> {
        let file_name = manifest_file_name(&manifest.profile_id);
        let existing = self
            .read_manifest(token_store, &manifest.profile_id)
            .await?;
        if let Some(existing) = existing.as_ref() {
            if manifest.remote_generation
                != next_remote_generation(existing.manifest.remote_generation)?
            {
                return Ok(ManifestWriteOutcome {
                    file: existing.file.clone(),
                    written_manifest: manifest.clone(),
                    confirmed_manifest: existing.manifest.clone(),
                    race_won: false,
                });
            }
        } else if manifest.remote_generation != 1 {
            return Err(format!(
                "Cannot create manifest '{file_name}' at generation {}; the first generation must be 1",
                manifest.remote_generation
            ));
        }
        if existing.is_some()
            && existing
                .as_ref()
                .and_then(|remote| remote.etag.as_ref())
                .is_none()
        {
            return Err(format!(
                "Google Drive did not provide an ETag for manifest '{file_name}'; refusing an unsafe overwrite"
            ));
        }

        let bytes = serialize_manifest_bytes(manifest)?;
        let upload = self
            .upload_app_data_file(
                token_store,
                &file_name,
                "application/json",
                &bytes,
                existing.as_ref().map(|remote| remote.file.id.as_str()),
                existing.as_ref().and_then(|remote| remote.etag.as_deref()),
            )
            .await;
        let file = match upload {
            Ok(file) => file,
            Err(error) if is_precondition_failure(&error) => {
                let confirmed = self
                    .read_manifest(token_store, &manifest.profile_id)
                    .await?
                    .ok_or_else(|| {
                        format!("Manifest '{file_name}' disappeared after a write conflict")
                    })?;
                return Ok(ManifestWriteOutcome {
                    file: confirmed.file,
                    written_manifest: manifest.clone(),
                    confirmed_manifest: confirmed.manifest,
                    race_won: false,
                });
            }
            Err(error) => return Err(error),
        };
        let confirmed = self
            .read_manifest(token_store, &manifest.profile_id)
            .await?
            .ok_or_else(|| {
                format!(
                    "Manifest '{}' disappeared immediately after write",
                    manifest_file_name(&manifest.profile_id)
                )
            })?;

        Ok(ManifestWriteOutcome {
            file,
            written_manifest: manifest.clone(),
            race_won: confirmed.manifest.snapshot_id == manifest.snapshot_id
                && confirmed.manifest.remote_generation == manifest.remote_generation,
            confirmed_manifest: confirmed.manifest,
        })
    }

    pub async fn upload_snapshot(
        &self,
        token_store: &dyn SecureTokenStore,
        profile_id: &str,
        snapshot: &SyncSnapshot,
    ) -> Result<UploadedSnapshot, String> {
        let file_name = snapshot_file_name(profile_id, &snapshot.snapshot_id);
        let archive = archive_snapshot(snapshot)?;

        if let Some(file) = self
            .find_canonical_app_data_file_by_name(token_store, &file_name)
            .await?
        {
            let existing_bytes = self
                .download_app_data_file_by_id(token_store, &file.id)
                .await?;
            let _ = parse_archived_snapshot(&existing_bytes, &archive.sha256)?;
            return Ok(UploadedSnapshot {
                file,
                snapshot_sha256: archive.sha256,
            });
        }

        let file = self
            .upload_app_data_file(
                token_store,
                &file_name,
                "application/gzip",
                &archive.gzipped_bytes,
                None,
                None,
            )
            .await?;

        Ok(UploadedSnapshot {
            file,
            snapshot_sha256: archive.sha256,
        })
    }

    pub async fn download_snapshot(
        &self,
        token_store: &dyn SecureTokenStore,
        profile_id: &str,
        snapshot_id: &str,
        expected_sha256: &str,
    ) -> Result<SyncSnapshot, String> {
        let file_name = snapshot_file_name(profile_id, snapshot_id);
        let file = self
            .find_canonical_app_data_file_by_name(token_store, &file_name)
            .await?
            .ok_or_else(|| format!("Remote snapshot '{file_name}' is missing"))?;
        let bytes = self
            .download_app_data_file_by_id(token_store, &file.id)
            .await?;
        let snapshot = parse_archived_snapshot(&bytes, expected_sha256)?;

        if snapshot.snapshot_id != snapshot_id {
            return Err(format!(
                "Remote snapshot '{}' contained snapshot_id '{}' instead of '{}'",
                file_name, snapshot.snapshot_id, snapshot_id
            ));
        }
        if snapshot.profile.profile_id != profile_id {
            return Err(format!(
                "Remote snapshot '{}' belonged to profile '{}' instead of '{}'",
                file_name, snapshot.profile.profile_id, profile_id
            ));
        }

        Ok(snapshot)
    }

    pub async fn blob_exists(
        &self,
        token_store: &dyn SecureTokenStore,
        sha256: &str,
    ) -> Result<bool, String> {
        Ok(self
            .find_canonical_app_data_file_by_name(token_store, &blob_file_name(sha256))
            .await?
            .is_some())
    }

    pub async fn list_blob_hashes(
        &self,
        token_store: &dyn SecureTokenStore,
    ) -> Result<BTreeSet<String>, String> {
        Ok(self
            .list_blob_files(token_store)
            .await?
            .into_keys()
            .collect())
    }

    pub async fn list_blob_files(
        &self,
        token_store: &dyn SecureTokenStore,
    ) -> Result<BTreeMap<String, DriveFileMetadata>, String> {
        let query = format!("name contains '{}' and trashed = false", BLOB_FILE_PREFIX);
        let files = self.list_app_data_files(token_store, Some(&query)).await?;
        Ok(files
            .into_iter()
            .filter_map(|file| {
                let hash = file.name.strip_prefix(BLOB_FILE_PREFIX).map(str::to_string);
                hash.map(|hash| (hash, file))
            })
            .collect())
    }

    pub async fn upload_blob(
        &self,
        token_store: &dyn SecureTokenStore,
        sha256: &str,
        bytes: &[u8],
    ) -> Result<DriveFileMetadata, String> {
        validate_cover_blob_size(bytes)?;
        let actual_sha256 = compute_sha256_hex(bytes);
        if actual_sha256 != sha256 {
            return Err(format!(
                "Blob upload hash mismatch (expected {sha256}, got {actual_sha256})"
            ));
        }

        let file_name = blob_file_name(sha256);
        if let Some(file) = self
            .find_canonical_app_data_file_by_name(token_store, &file_name)
            .await?
        {
            return Ok(file);
        }

        self.upload_blob_known_missing(token_store, sha256, bytes)
            .await
    }

    pub(crate) async fn upload_blob_known_missing(
        &self,
        token_store: &dyn SecureTokenStore,
        sha256: &str,
        bytes: &[u8],
    ) -> Result<DriveFileMetadata, String> {
        validate_cover_blob_size(bytes)?;
        self.upload_app_data_file(
            token_store,
            &blob_file_name(sha256),
            "application/octet-stream",
            bytes,
            None,
            None,
        )
        .await
    }

    pub async fn download_blob(
        &self,
        token_store: &dyn SecureTokenStore,
        sha256: &str,
    ) -> Result<Option<Vec<u8>>, String> {
        let Some(file) = self
            .find_canonical_app_data_file_by_name(token_store, &blob_file_name(sha256))
            .await?
        else {
            return Ok(None);
        };

        let bytes = self
            .download_app_data_file_by_id_with_limit(
                token_store,
                &file.id,
                MAX_SYNC_COVER_BLOB_BYTES,
            )
            .await?;
        Ok(Some(bytes))
    }

    async fn find_canonical_app_data_file_by_name(
        &self,
        token_store: &dyn SecureTokenStore,
        file_name: &str,
    ) -> Result<Option<DriveFileMetadata>, String> {
        Ok(self
            .list_app_data_files_by_name(token_store, file_name)
            .await?
            .into_iter()
            .next())
    }

    async fn list_app_data_files_by_name(
        &self,
        token_store: &dyn SecureTokenStore,
        file_name: &str,
    ) -> Result<Vec<DriveFileMetadata>, String> {
        let escaped_file_name = file_name.replace('\\', "\\\\").replace('\'', "\\'");
        let query = format!("name = '{escaped_file_name}' and trashed = false");
        let mut files = self.list_app_data_files(token_store, Some(&query)).await?;
        files.sort_by(|left, right| left.id.cmp(&right.id));
        Ok(files)
    }

    async fn access_token(&self, token_store: &dyn SecureTokenStore) -> Result<String, String> {
        sync_auth::get_valid_google_access_token(&self.auth_config, token_store).await
    }
}

fn build_multipart_related_body(
    metadata: &DriveUploadMetadata<'_>,
    mime_type: &str,
    bytes: &[u8],
) -> Result<(String, Vec<u8>), String> {
    let boundary = format!("kechimochi-{}", uuid::Uuid::new_v4().simple());
    let metadata_json = serde_json::to_vec(metadata).map_err(|e| e.to_string())?;
    let mut body = Vec::with_capacity(metadata_json.len() + bytes.len() + 256);

    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(b"Content-Type: application/json; charset=UTF-8\r\n\r\n");
    body.extend_from_slice(&metadata_json);
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
    body.extend_from_slice(format!("Content-Type: {mime_type}\r\n\r\n").as_bytes());
    body.extend_from_slice(bytes);
    body.extend_from_slice(b"\r\n");
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());

    Ok((format!("multipart/related; boundary={boundary}"), body))
}

fn drive_http_error_message(error: reqwest::Error) -> String {
    if error.is_timeout() {
        "Google Drive request timed out. Please try again.".to_string()
    } else {
        error.to_string()
    }
}

fn is_precondition_failure(error: &str) -> bool {
    error.contains("412 Precondition Failed")
        || error.to_ascii_lowercase().contains("precondition failed")
}

async fn read_bounded_response(
    response: reqwest::Response,
    limit: usize,
) -> Result<Vec<u8>, String> {
    if let Some(content_length) = response.content_length() {
        if content_length > limit as u64 {
            return Err(format!(
                "Google Drive response is too large ({content_length} bytes; limit is {limit} bytes)"
            ));
        }
    }

    let mut stream = response.bytes_stream();
    let mut bytes = Vec::new();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.map_err(drive_http_error_message)?;
        let new_len = bytes
            .len()
            .checked_add(chunk.len())
            .ok_or_else(|| "Google Drive response size overflowed".to_string())?;
        if new_len > limit {
            return Err(format!(
                "Google Drive response exceeded the {limit} byte limit"
            ));
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

async fn read_success_response(response: reqwest::Response) -> Result<reqwest::Response, String> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }

    let body = read_bounded_response(response, MAX_DRIVE_ERROR_RESPONSE_BYTES)
        .await
        .ok()
        .map(|bytes| String::from_utf8_lossy(&bytes).into_owned())
        .unwrap_or_default();
    if body.trim().is_empty() {
        Err(format!(
            "Google Drive API request failed with status {status}"
        ))
    } else {
        Err(format!(
            "Google Drive API request failed with status {status}: {body}"
        ))
    }
}

fn parse_manifest_bytes(bytes: &[u8]) -> Result<RemoteSyncManifest, String> {
    serde_json::from_slice(bytes).map_err(|e| e.to_string())
}

fn serialize_manifest_bytes(manifest: &RemoteSyncManifest) -> Result<Vec<u8>, String> {
    serde_json::to_vec(manifest).map_err(|e| e.to_string())
}

fn compute_sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut output = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(&mut output, "{byte:02x}");
    }
    output
}

fn validate_cover_blob_size(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() > MAX_SYNC_COVER_BLOB_BYTES {
        Err(format!(
            "Cover blob exceeds the supported {} byte limit",
            MAX_SYNC_COVER_BLOB_BYTES
        ))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::sync::Arc;

    use crate::sync_auth::StoredGoogleTokens;

    #[derive(Debug, Default, Clone)]
    struct MemoryTokenStore {
        tokens: Arc<std::sync::Mutex<Option<StoredGoogleTokens>>>,
    }

    impl SecureTokenStore for MemoryTokenStore {
        fn load_tokens(&self) -> Result<Option<StoredGoogleTokens>, String> {
            Ok(self.tokens.lock().unwrap().clone())
        }

        fn save_tokens(&self, tokens: &StoredGoogleTokens) -> Result<(), String> {
            *self.tokens.lock().unwrap() = Some(tokens.clone());
            Ok(())
        }

        fn clear_tokens(&self) -> Result<(), String> {
            *self.tokens.lock().unwrap() = None;
            Ok(())
        }
    }

    #[derive(Debug, Clone)]
    struct StoredTestFile {
        id: String,
        name: String,
        mime_type: String,
        modified_time: String,
        parents: Vec<String>,
        bytes: Vec<u8>,
    }

    #[derive(Debug, Default)]
    struct TestDriveState {
        next_id: usize,
        next_timestamp: usize,
        files: BTreeMap<String, StoredTestFile>,
        expected_access_token: String,
        overwrite_manifest_after_write: Option<RemoteSyncManifest>,
    }

    #[derive(Debug, Deserialize)]
    struct TestUploadMetadata {
        name: String,
        #[serde(rename = "mimeType")]
        mime_type: String,
        #[serde(default)]
        parents: Vec<String>,
    }

    enum MemoryDriveResponse {
        Json(serde_json::Value),
        Bytes(Vec<u8>),
    }

    #[derive(Clone)]
    struct MemoryDriveTransport {
        state: Arc<std::sync::Mutex<TestDriveState>>,
    }

    impl DriveTransport for MemoryDriveTransport {
        fn request_json<'a>(
            &'a self,
            method: Method,
            url: &'a str,
            access_token: &'a str,
            content_type: Option<String>,
            body: Option<Vec<u8>>,
        ) -> TransportFuture<'a, serde_json::Value> {
            let transport = self.clone();
            let url = url.to_string();
            let access_token = access_token.to_string();
            Box::pin(async move {
                match transport.handle_request(method, &url, &access_token, content_type, body)? {
                    MemoryDriveResponse::Json(value) => Ok(value),
                    MemoryDriveResponse::Bytes(_) => {
                        Err("Expected JSON response but transport returned bytes".to_string())
                    }
                }
            })
        }

        fn request_bytes<'a>(
            &'a self,
            method: Method,
            url: &'a str,
            access_token: &'a str,
            content_type: Option<String>,
            body: Option<Vec<u8>>,
        ) -> TransportFuture<'a, Vec<u8>> {
            let transport = self.clone();
            let url = url.to_string();
            let access_token = access_token.to_string();
            Box::pin(async move {
                match transport.handle_request(method, &url, &access_token, content_type, body)? {
                    MemoryDriveResponse::Bytes(bytes) => Ok(bytes),
                    MemoryDriveResponse::Json(_) => {
                        Err("Expected byte response but transport returned JSON".to_string())
                    }
                }
            })
        }

        fn request_json_with_headers<'a>(
            &'a self,
            method: Method,
            url: &'a str,
            access_token: &'a str,
            content_type: Option<String>,
            body: Option<Vec<u8>>,
            headers: Vec<(String, String)>,
        ) -> TransportFuture<'a, serde_json::Value> {
            let transport = self.clone();
            let url = url.to_string();
            let access_token = access_token.to_string();
            Box::pin(async move {
                transport.check_if_match(&method, &url, &headers)?;
                match transport.handle_request(method, &url, &access_token, content_type, body)? {
                    MemoryDriveResponse::Json(value) => Ok(value),
                    MemoryDriveResponse::Bytes(_) => {
                        Err("Expected JSON response but transport returned bytes".to_string())
                    }
                }
            })
        }

        fn request_bytes_with_etag<'a>(
            &'a self,
            method: Method,
            url: &'a str,
            access_token: &'a str,
            content_type: Option<String>,
            body: Option<Vec<u8>>,
            max_response_bytes: usize,
        ) -> TransportFuture<'a, (Vec<u8>, Option<String>)> {
            let transport = self.clone();
            let url = url.to_string();
            let access_token = access_token.to_string();
            Box::pin(async move {
                let response =
                    transport.handle_request(method, &url, &access_token, content_type, body)?;
                match response {
                    MemoryDriveResponse::Bytes(bytes) => {
                        if bytes.len() > max_response_bytes {
                            return Err(format!(
                                "Test Drive response exceeded the {max_response_bytes} byte limit"
                            ));
                        }
                        let etag = transport.etag_for_file_url(&url);
                        Ok((bytes, etag))
                    }
                    MemoryDriveResponse::Json(_) => {
                        Err("Expected byte response but transport returned JSON".to_string())
                    }
                }
            })
        }
    }

    impl MemoryDriveTransport {
        fn new() -> Self {
            Self {
                state: Arc::new(std::sync::Mutex::new(TestDriveState {
                    next_id: 0,
                    next_timestamp: 0,
                    files: BTreeMap::new(),
                    expected_access_token: "access-token".to_string(),
                    overwrite_manifest_after_write: None,
                })),
            }
        }

        fn handle_request(
            &self,
            method: Method,
            url: &str,
            access_token: &str,
            content_type: Option<String>,
            body: Option<Vec<u8>>,
        ) -> Result<MemoryDriveResponse, String> {
            let url = Url::parse(url).map_err(|e| e.to_string())?;
            let path = url.path();

            self.authorize_request(access_token)?;

            if method == Method::GET && path.ends_with("/drive/v3/files") {
                let query = url
                    .query_pairs()
                    .find(|(key, _)| key == "q")
                    .map(|(_, value)| value.to_string());
                let state = self.state.lock().unwrap();
                let mut files = state.files.values().cloned().collect::<Vec<_>>();
                if let Some(query) = query.as_deref() {
                    files.retain(|file| file_matches_query(file, query));
                }

                return Ok(MemoryDriveResponse::Json(serde_json::json!({
                    "files": files.into_iter().map(file_to_json).collect::<Vec<_>>()
                })));
            }

            if method == Method::GET && path.contains("/drive/v3/files/") {
                let file_id = path
                    .rsplit('/')
                    .next()
                    .ok_or_else(|| "Missing file id".to_string())?;
                let alt = url
                    .query_pairs()
                    .find(|(key, _)| key == "alt")
                    .map(|(_, value)| value.to_string());
                let state = self.state.lock().unwrap();
                let file = state
                    .files
                    .get(file_id)
                    .ok_or_else(|| "File not found".to_string())?;

                return if alt.as_deref() == Some("media") {
                    Ok(MemoryDriveResponse::Bytes(file.bytes.clone()))
                } else {
                    Ok(MemoryDriveResponse::Json(file_to_json(file.clone())))
                };
            }

            if method == Method::POST && path.ends_with("/upload/drive/v3/files") {
                let content_type =
                    content_type.ok_or_else(|| "Missing upload Content-Type".to_string())?;
                let body = body.ok_or_else(|| "Missing upload body".to_string())?;
                let (metadata, bytes) = parse_multipart_related(&content_type, &body)?;

                let mut state = self.state.lock().unwrap();
                state.next_id += 1;
                let id = format!("file_{}", state.next_id);
                let file = StoredTestFile {
                    id: id.clone(),
                    name: metadata.name.clone(),
                    mime_type: metadata.mime_type.clone(),
                    modified_time: next_timestamp(&mut state),
                    parents: metadata.parents,
                    bytes,
                };
                state.files.insert(id.clone(), file.clone());
                maybe_overwrite_manifest_after_write(&mut state, &metadata.name);
                return Ok(MemoryDriveResponse::Json(file_to_json(file)));
            }

            if method == Method::PATCH && path.contains("/upload/drive/v3/files/") {
                let content_type =
                    content_type.ok_or_else(|| "Missing upload Content-Type".to_string())?;
                let body = body.ok_or_else(|| "Missing upload body".to_string())?;
                let (metadata, bytes) = parse_multipart_related(&content_type, &body)?;
                let file_id = path
                    .rsplit('/')
                    .next()
                    .ok_or_else(|| "Missing file id".to_string())?;

                let mut state = self.state.lock().unwrap();
                let modified_time = next_timestamp(&mut state);
                let file = state
                    .files
                    .get_mut(file_id)
                    .ok_or_else(|| "File not found".to_string())?;
                file.name = metadata.name.clone();
                file.mime_type = metadata.mime_type.clone();
                file.bytes = bytes;
                file.modified_time = modified_time;
                if !metadata.parents.is_empty() {
                    file.parents = metadata.parents;
                }
                let updated = file.clone();
                maybe_overwrite_manifest_after_write(&mut state, &metadata.name);
                return Ok(MemoryDriveResponse::Json(file_to_json(updated)));
            }

            Err(format!("Unhandled transport request: {} {}", method, url))
        }

        fn etag_for_file_url(&self, url: &str) -> Option<String> {
            let file_id = Url::parse(url).ok()?.path().rsplit('/').next()?.to_string();
            self.state
                .lock()
                .ok()?
                .files
                .get(&file_id)
                .map(|file| format!("\"{}\"", file.modified_time))
        }

        fn check_if_match(
            &self,
            method: &Method,
            url: &str,
            headers: &[(String, String)],
        ) -> Result<(), String> {
            if method != Method::PATCH {
                return Ok(());
            }
            let Some((_, expected)) = headers
                .iter()
                .find(|(name, _)| name.eq_ignore_ascii_case("if-match"))
            else {
                return Ok(());
            };
            if self.etag_for_file_url(url).as_deref() == Some(expected.as_str()) {
                Ok(())
            } else {
                Err("Google Drive API request failed with status 412 Precondition Failed".into())
            }
        }

        fn authorize_request(&self, access_token: &str) -> Result<(), String> {
            let state = self.state.lock().unwrap();
            if access_token == state.expected_access_token {
                Ok(())
            } else {
                Err("Unauthorized".to_string())
            }
        }
    }

    fn test_client_config() -> GoogleOAuthClientConfig {
        GoogleOAuthClientConfig {
            client_id: "client-id".to_string(),
            client_secret: Some("client-secret".to_string()),
            auth_endpoint: "https://accounts.example.test/authorize".to_string(),
            token_endpoint: "https://oauth.example.test/token".to_string(),
            scope: sync_auth::GOOGLE_DRIVE_APPDATA_SCOPE.to_string(),
            callback_timeout_secs: 5,
        }
    }

    fn test_token_store() -> MemoryTokenStore {
        let store = MemoryTokenStore::default();
        store
            .save_tokens(&StoredGoogleTokens {
                refresh_token: "refresh-token".to_string(),
                access_token: Some("access-token".to_string()),
                access_token_expires_at: Some("2999-01-01T00:00:00Z".to_string()),
                scope: Some(sync_auth::GOOGLE_DRIVE_APPDATA_SCOPE.to_string()),
                token_type: Some("Bearer".to_string()),
                google_account_email: Some("user@example.com".to_string()),
            })
            .unwrap();
        store
    }

    fn build_transport() -> MemoryDriveTransport {
        MemoryDriveTransport::new()
    }

    fn build_client(transport: MemoryDriveTransport) -> GoogleDriveClient<MemoryDriveTransport> {
        GoogleDriveClient::new_with_transport(
            test_client_config(),
            "https://drive.example.test/drive/v3",
            "https://drive.example.test/upload/drive/v3",
            transport,
        )
    }

    fn sample_snapshot(profile_id: &str, snapshot_id: &str) -> SyncSnapshot {
        let mut library = BTreeMap::new();
        library.insert(
            "uid-1".to_string(),
            sync_snapshot::SnapshotMediaAggregate {
                uid: "uid-1".to_string(),
                title: "Elden Ring".to_string(),
                variant: "Game".to_string(),
                default_activity_type: "Playing".to_string(),
                status: "Active".to_string(),
                language: "Japanese".to_string(),
                description: "".to_string(),
                content_type: "Videogame".to_string(),
                tracking_status: "Ongoing".to_string(),
                extra_data: "{}".to_string(),
                cover_blob_sha256: Some("a".repeat(64)),
                updated_at: "2026-04-02T10:00:00Z".to_string(),
                updated_by_device_id: "dev_local".to_string(),
                activities: vec![sync_snapshot::SnapshotActivity {
                    uid: "activity-1".to_string(),
                    date: "2026-04-01".to_string(),
                    activity_type: "Playing".to_string(),
                    duration_minutes: 90,
                    characters: 0,
                    notes: String::new(),
                }],
                milestones: vec![sync_snapshot::SnapshotMilestone {
                    uid: "milestone-1".to_string(),
                    name: "Finished Intro".to_string(),
                    duration: 90,
                    characters: 0,
                    date: Some("2026-04-01".to_string()),
                }],
            },
        );

        SyncSnapshot {
            sync_protocol_version: SYNC_PROTOCOL_VERSION,
            db_schema_version: db::CURRENT_SCHEMA_VERSION,
            snapshot_id: snapshot_id.to_string(),
            created_at: "2026-04-02T10:00:00Z".to_string(),
            created_by_device_id: "dev_local".to_string(),
            profile: sync_snapshot::SnapshotProfile {
                profile_id: profile_id.to_string(),
                profile_name: "Morg".to_string(),
                updated_at: "2026-04-02T09:00:00Z".to_string(),
            },
            library,
            settings: BTreeMap::from([(
                "theme".to_string(),
                sync_snapshot::SnapshotSettingValue {
                    value: "pastel-pink".to_string(),
                    updated_at: "2026-04-02T09:30:00Z".to_string(),
                    updated_by_device_id: "dev_local".to_string(),
                },
            )]),
            profile_picture: None,
            tombstones: vec![],
        }
    }

    #[test]
    fn remote_snapshot_validation_rejects_trim_equivalent_media_identities() {
        let mut snapshot = sample_snapshot("profile-1", "snapshot-1");
        let first = snapshot.library.get_mut("uid-1").unwrap();
        first.title = "Horimiya".to_string();
        first.variant = "Manga".to_string();
        let mut second = first.clone();
        second.uid = "uid-2".to_string();
        second.variant = "\u{2003}Manga\t".to_string();
        snapshot.library.insert(second.uid.clone(), second);

        let error = validate_remote_snapshot_compatibility(&snapshot).unwrap_err();

        assert!(error.contains("more than one media entry"));
        assert!(error.contains("Horimiya — Manga"));
    }

    #[test]
    fn remote_snapshot_validation_rejects_a_library_key_uid_mismatch_and_blank_title() {
        let mut snapshot = sample_snapshot("profile-1", "snapshot-1");
        snapshot.library.get_mut("uid-1").unwrap().uid = "uid-other".to_string();
        let mismatch = validate_remote_snapshot_compatibility(&snapshot).unwrap_err();
        assert!(mismatch.contains("library key 'uid-1'"));
        assert!(mismatch.contains("media uid 'uid-other'"));

        snapshot.library.get_mut("uid-1").unwrap().uid = "uid-1".to_string();
        snapshot.library.get_mut("uid-1").unwrap().title = " \t\u{2003}".to_string();
        let blank_title = validate_remote_snapshot_compatibility(&snapshot).unwrap_err();
        assert!(blank_title.contains("blank title"));

        let mut blank_uid_snapshot = sample_snapshot("profile-1", "snapshot-1");
        let mut media = blank_uid_snapshot.library.remove("uid-1").unwrap();
        media.uid.clear();
        blank_uid_snapshot.library.insert(String::new(), media);
        let blank_uid = validate_remote_snapshot_compatibility(&blank_uid_snapshot).unwrap_err();
        assert!(blank_uid.contains("blank sync UID"));
    }

    #[test]
    fn remote_compatibility_rejects_a_newer_database_schema_before_syncing() {
        let mut manifest = RemoteSyncManifest::new(
            "profile-1",
            "Morg",
            "snapshot-1",
            "sha256",
            1,
            "2026-04-02T10:00:00Z",
            "dev_remote",
        );
        manifest.db_schema_version = db::CURRENT_SCHEMA_VERSION + 1;

        let manifest_error = validate_remote_manifest_compatibility(&manifest).unwrap_err();
        assert!(manifest_error.contains("requires unsupported DB schema version"));
        assert!(manifest_error.contains(&db::CURRENT_SCHEMA_VERSION.to_string()));

        let mut snapshot = sample_snapshot("profile-1", "snapshot-1");
        snapshot.db_schema_version = db::CURRENT_SCHEMA_VERSION + 1;

        let snapshot_error = validate_remote_snapshot_compatibility(&snapshot).unwrap_err();
        assert!(snapshot_error.contains("requires unsupported DB schema version"));
        assert!(snapshot_error.contains(&db::CURRENT_SCHEMA_VERSION.to_string()));
    }

    fn file_to_json(file: StoredTestFile) -> serde_json::Value {
        serde_json::json!({
            "id": file.id,
            "name": file.name,
            "mimeType": file.mime_type,
            "size": file.bytes.len().to_string(),
            "modifiedTime": file.modified_time,
        })
    }

    fn file_matches_query(file: &StoredTestFile, query: &str) -> bool {
        let exact_name = query
            .split("name = '")
            .nth(1)
            .and_then(|rest| rest.split('\'').next());
        if let Some(name) = exact_name {
            return file.name == name;
        }

        let prefix = query
            .split("name contains '")
            .nth(1)
            .and_then(|rest| rest.split('\'').next());
        if let Some(prefix) = prefix {
            return file.name.contains(prefix);
        }

        true
    }

    fn next_timestamp(state: &mut TestDriveState) -> String {
        state.next_timestamp += 1;
        format!("2026-04-02T10:00:{:02}Z", state.next_timestamp)
    }

    fn parse_multipart_related(
        content_type: &str,
        body: &[u8],
    ) -> Result<(TestUploadMetadata, Vec<u8>), String> {
        let boundary = content_type
            .split("boundary=")
            .nth(1)
            .ok_or_else(|| "Missing multipart boundary".to_string())?;

        let first_prefix = format!("--{boundary}\r\n");
        let second_prefix = format!("\r\n--{boundary}\r\n");
        let final_suffix = format!("\r\n--{boundary}--\r\n");

        let after_first = body
            .strip_prefix(first_prefix.as_bytes())
            .ok_or_else(|| "Multipart body missing first boundary".to_string())?;
        let first_header_end = find_bytes(after_first, b"\r\n\r\n")
            .ok_or_else(|| "Multipart metadata headers missing".to_string())?;
        let metadata_start = first_header_end + 4;
        let metadata_end = find_bytes(&after_first[metadata_start..], second_prefix.as_bytes())
            .ok_or_else(|| "Multipart metadata section missing".to_string())?
            + metadata_start;
        let metadata = serde_json::from_slice::<TestUploadMetadata>(
            &after_first[metadata_start..metadata_end],
        )
        .map_err(|e| e.to_string())?;

        let after_second = &after_first[metadata_end + second_prefix.len()..];
        let second_header_end = find_bytes(after_second, b"\r\n\r\n")
            .ok_or_else(|| "Multipart media headers missing".to_string())?;
        let data_start = second_header_end + 4;
        let data_end = find_bytes(&after_second[data_start..], final_suffix.as_bytes())
            .ok_or_else(|| "Multipart final boundary missing".to_string())?
            + data_start;

        Ok((metadata, after_second[data_start..data_end].to_vec()))
    }

    fn maybe_overwrite_manifest_after_write(state: &mut TestDriveState, file_name: &str) {
        if !file_name.starts_with(MANIFEST_FILE_PREFIX) {
            return;
        }

        let Some(override_manifest) = state.overwrite_manifest_after_write.take() else {
            return;
        };
        let override_name = manifest_file_name(&override_manifest.profile_id);
        let target_id = state
            .files
            .iter()
            .find_map(|(id, file)| (file.name == override_name).then(|| id.clone()));
        let modified_time = next_timestamp(state);
        if let Some(target_id) = target_id {
            if let Some(file) = state.files.get_mut(&target_id) {
                file.bytes = serialize_manifest_bytes(&override_manifest).unwrap();
                file.modified_time = modified_time;
            }
        }
    }

    fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
        haystack
            .windows(needle.len())
            .position(|window| window == needle)
    }

    async fn insert_test_file(
        transport: &MemoryDriveTransport,
        name: &str,
        mime_type: &str,
        bytes: Vec<u8>,
    ) -> DriveFileMetadata {
        let mut state = transport.state.lock().unwrap();
        state.next_id += 1;
        let id = format!("file_{}", state.next_id);
        let file = StoredTestFile {
            id: id.clone(),
            name: name.to_string(),
            mime_type: mime_type.to_string(),
            modified_time: next_timestamp(&mut state),
            parents: vec![APP_DATA_FOLDER_NAME.to_string()],
            bytes,
        };
        state.files.insert(id.clone(), file.clone());
        serde_json::from_value(file_to_json(file)).unwrap()
    }

    #[tokio::test]
    async fn list_remote_sync_profiles_reads_manifest_files() {
        let transport = build_transport();
        let client = build_client(transport.clone());
        let token_store = test_token_store();

        let manifest_a = RemoteSyncManifest::new(
            "prof_a",
            "Alpha",
            "snap_a",
            "sha_a",
            2,
            "2026-04-02T12:00:00Z",
            "dev_a",
        );
        let manifest_b = RemoteSyncManifest::new(
            "prof_b",
            "Beta",
            "snap_b",
            "sha_b",
            5,
            "2026-04-02T13:00:00Z",
            "dev_b",
        );
        insert_test_file(
            &transport,
            &manifest_file_name(&manifest_a.profile_id),
            "application/json",
            serialize_manifest_bytes(&manifest_a).unwrap(),
        )
        .await;
        insert_test_file(
            &transport,
            &manifest_file_name(&manifest_b.profile_id),
            "application/json",
            serialize_manifest_bytes(&manifest_b).unwrap(),
        )
        .await;
        insert_test_file(
            &transport,
            &blob_file_name("deadbeef"),
            "application/octet-stream",
            vec![1, 2, 3],
        )
        .await;

        let profiles = client
            .list_remote_sync_profiles(&token_store)
            .await
            .unwrap();

        assert_eq!(profiles.len(), 2);
        assert_eq!(profiles[0].manifest.profile_id, "prof_b");
        assert_eq!(profiles[1].manifest.profile_id, "prof_a");
    }

    #[tokio::test]
    async fn duplicate_manifest_files_converge_on_the_highest_generation() {
        let transport = build_transport();
        let client = build_client(transport.clone());
        let token_store = test_token_store();
        let older = RemoteSyncManifest::new(
            "prof_duplicate",
            "Duplicate",
            "snap_older",
            "sha_older",
            1,
            "2026-04-02T12:00:00Z",
            "dev_a",
        );
        let newer = RemoteSyncManifest::new(
            "prof_duplicate",
            "Duplicate",
            "snap_newer",
            "sha_newer",
            2,
            "2026-04-02T12:01:00Z",
            "dev_b",
        );
        let file_name = manifest_file_name("prof_duplicate");
        insert_test_file(
            &transport,
            &file_name,
            "application/json",
            serialize_manifest_bytes(&older).unwrap(),
        )
        .await;
        insert_test_file(
            &transport,
            &file_name,
            "application/json",
            serialize_manifest_bytes(&newer).unwrap(),
        )
        .await;

        let selected = client
            .read_manifest(&token_store, "prof_duplicate")
            .await
            .unwrap()
            .unwrap();
        assert_eq!(selected.manifest.snapshot_id, "snap_newer");
        assert_eq!(selected.manifest.remote_generation, 2);

        let profiles = client
            .list_remote_sync_profiles(&token_store)
            .await
            .unwrap();
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].manifest.snapshot_id, "snap_newer");
    }

    #[tokio::test]
    async fn upload_and_download_snapshot_round_trip() {
        let transport = build_transport();
        let client = build_client(transport);
        let token_store = test_token_store();
        let snapshot = sample_snapshot("prof_1", "snap_1");

        let uploaded = client
            .upload_snapshot(&token_store, "prof_1", &snapshot)
            .await
            .unwrap();
        assert_eq!(uploaded.file.name, snapshot_file_name("prof_1", "snap_1"));

        let downloaded = client
            .download_snapshot(&token_store, "prof_1", "snap_1", &uploaded.snapshot_sha256)
            .await
            .unwrap();

        assert_eq!(downloaded, snapshot);
    }

    #[tokio::test]
    async fn download_snapshot_rejects_checksum_mismatch() {
        let transport = build_transport();
        let client = build_client(transport.clone());
        let token_store = test_token_store();
        let snapshot = sample_snapshot("prof_1", "snap_1");
        let archive = archive_snapshot(&snapshot).unwrap();

        insert_test_file(
            &transport,
            &snapshot_file_name("prof_1", "snap_1"),
            "application/gzip",
            archive.gzipped_bytes,
        )
        .await;

        let err = client
            .download_snapshot(&token_store, "prof_1", "snap_1", "not-the-right-sha")
            .await
            .unwrap_err();

        assert!(err.contains("checksum mismatch"));
    }

    #[test]
    fn snapshot_decompression_enforces_the_actual_output_limit() {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
        encoder.write_all(&[0_u8; 128]).unwrap();
        let compressed = encoder.finish().unwrap();

        let error = decompress_with_limit(&compressed, 64).unwrap_err();
        assert!(error.contains("64 byte limit"));
    }

    #[tokio::test]
    async fn upsert_manifest_and_confirm_detects_lost_race() {
        let transport = build_transport();
        let client = build_client(transport.clone());
        let token_store = test_token_store();

        let previous_manifest = RemoteSyncManifest::new(
            "prof_1",
            "Morg",
            "snap_previous",
            "sha_previous",
            2,
            "2026-04-02T12:29:00Z",
            "dev_previous",
        );
        insert_test_file(
            &transport,
            &manifest_file_name("prof_1"),
            "application/json",
            serialize_manifest_bytes(&previous_manifest).unwrap(),
        )
        .await;

        let our_manifest = RemoteSyncManifest::new(
            "prof_1",
            "Morg",
            "snap_ours",
            "sha_ours",
            3,
            "2026-04-02T12:30:00Z",
            "dev_ours",
        );
        let rival_manifest = RemoteSyncManifest::new(
            "prof_1",
            "Morg",
            "snap_rival",
            "sha_rival",
            4,
            "2026-04-02T12:31:00Z",
            "dev_rival",
        );

        transport
            .state
            .lock()
            .unwrap()
            .overwrite_manifest_after_write = Some(rival_manifest.clone());

        let outcome = client
            .upsert_manifest_and_confirm(&token_store, &our_manifest)
            .await
            .unwrap();

        assert!(!outcome.race_won);
        assert_eq!(outcome.confirmed_manifest, rival_manifest);
    }

    #[tokio::test]
    async fn blob_upload_exists_and_download_round_trip() {
        let transport = build_transport();
        let client = build_client(transport);
        let token_store = test_token_store();
        let bytes = vec![9, 8, 7, 6];
        let sha256 = compute_sha256_hex(&bytes);

        assert!(!client.blob_exists(&token_store, &sha256).await.unwrap());

        let file = client
            .upload_blob(&token_store, &sha256, &bytes)
            .await
            .unwrap();
        assert_eq!(file.name, blob_file_name(&sha256));
        assert!(client.blob_exists(&token_store, &sha256).await.unwrap());
        assert_eq!(
            client.download_blob(&token_store, &sha256).await.unwrap(),
            Some(bytes)
        );
    }

    #[tokio::test]
    async fn list_blob_hashes_returns_existing_blob_names() {
        let transport = build_transport();
        let client = build_client(transport.clone());
        let token_store = test_token_store();
        let blob_a = compute_sha256_hex(&[1, 2, 3]);
        let blob_b = compute_sha256_hex(&[4, 5, 6]);

        insert_test_file(
            &transport,
            &blob_file_name(&blob_a),
            "application/octet-stream",
            vec![1, 2, 3],
        )
        .await;
        insert_test_file(
            &transport,
            &blob_file_name(&blob_b),
            "application/octet-stream",
            vec![4, 5, 6],
        )
        .await;
        insert_test_file(
            &transport,
            &manifest_file_name("prof_1"),
            "application/json",
            serialize_manifest_bytes(&RemoteSyncManifest::new(
                "prof_1",
                "Morg",
                "snap_1",
                "sha_1",
                1,
                "2026-04-02T12:00:00Z",
                "dev_1",
            ))
            .unwrap(),
        )
        .await;

        let hashes = client.list_blob_hashes(&token_store).await.unwrap();

        assert_eq!(hashes.len(), 2);
        assert!(hashes.contains(&blob_a));
        assert!(hashes.contains(&blob_b));
    }
}
