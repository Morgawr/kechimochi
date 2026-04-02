use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use keyring::{Entry, Error as KeyringError};
use oauth2::basic::{BasicClient, BasicErrorResponseType, BasicRequestTokenError, BasicTokenType};
use oauth2::{
    AuthUrl, AuthorizationCode, ClientId, ClientSecret, CsrfToken, EmptyExtraTokenFields,
    EndpointNotSet, EndpointSet, HttpClientError, PkceCodeChallenge, PkceCodeVerifier, RedirectUrl,
    RefreshToken, RequestTokenError, Scope, StandardTokenResponse, TokenResponse, TokenUrl,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use url::Url;

use crate::sync_state;

pub const GOOGLE_DRIVE_APPDATA_SCOPE: &str = "https://www.googleapis.com/auth/drive.appdata";
const DEFAULT_AUTH_ENDPOINT: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_TOKEN_ENDPOINT: &str = "https://oauth2.googleapis.com/token";
const DEFAULT_CALLBACK_TIMEOUT_SECS: u64 = 60;
const ACCESS_TOKEN_EXPIRY_SAFETY_MARGIN_SECS: i64 = 60;
const OAUTH_HTTP_CONNECT_TIMEOUT_SECS: u64 = 15;
const OAUTH_HTTP_REQUEST_TIMEOUT_SECS: u64 = 60;
const APP_USER_AGENT: &str = concat!(env!("CARGO_PKG_NAME"), "/", env!("CARGO_PKG_VERSION"));
const TOKEN_STORE_SERVICE: &str = "com.morg.kechimochi.google-drive";
const TOKEN_STORE_ACCOUNT: &str = "oauth_tokens";
const ENV_CLIENT_ID: &str = "KECHIMOCHI_GOOGLE_CLIENT_ID";
const ENV_CLIENT_SECRET: &str = "KECHIMOCHI_GOOGLE_CLIENT_SECRET";
const ENV_AUTH_ENDPOINT: &str = "KECHIMOCHI_GOOGLE_AUTH_ENDPOINT";
const ENV_TOKEN_ENDPOINT: &str = "KECHIMOCHI_GOOGLE_TOKEN_ENDPOINT";
const TAURI_PLUGIN_CONFIG_KEY: &str = "kechimochiSync";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GoogleOAuthClientConfig {
    pub client_id: String,
    #[serde(default)]
    pub client_secret: Option<String>,
    pub auth_endpoint: String,
    pub token_endpoint: String,
    pub scope: String,
    pub callback_timeout_secs: u64,
}

#[derive(Debug, Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct GoogleOAuthPluginConfig {
    #[serde(default)]
    client_id: Option<String>,
    #[serde(default)]
    client_secret: Option<String>,
    #[serde(default)]
    auth_endpoint: Option<String>,
    #[serde(default)]
    token_endpoint: Option<String>,
    #[serde(default)]
    callback_timeout_secs: Option<u64>,
}

impl GoogleOAuthClientConfig {
    pub fn from_env() -> Result<Self, String> {
        let client_id = std::env::var(ENV_CLIENT_ID)
            .map_err(|_| format!("Missing Google OAuth client ID in {ENV_CLIENT_ID}"))?;
        let client_secret = std::env::var(ENV_CLIENT_SECRET).ok();
        let auth_endpoint =
            std::env::var(ENV_AUTH_ENDPOINT).unwrap_or_else(|_| DEFAULT_AUTH_ENDPOINT.to_string());
        let token_endpoint = std::env::var(ENV_TOKEN_ENDPOINT)
            .unwrap_or_else(|_| DEFAULT_TOKEN_ENDPOINT.to_string());

        Ok(Self {
            client_id,
            client_secret,
            auth_endpoint,
            token_endpoint,
            scope: GOOGLE_DRIVE_APPDATA_SCOPE.to_string(),
            callback_timeout_secs: DEFAULT_CALLBACK_TIMEOUT_SECS,
        })
    }

    pub fn from_plugin_config(config: Option<&Value>) -> Result<Option<Self>, String> {
        let Some(config) = config else {
            return Ok(None);
        };

        let parsed: GoogleOAuthPluginConfig =
            serde_json::from_value(config.clone()).map_err(|err| {
                format!("Invalid Tauri plugin config for {TAURI_PLUGIN_CONFIG_KEY}: {err}")
            })?;

        let client_id = parsed
            .client_id
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let Some(client_id) = client_id else {
            return Ok(None);
        };

        let client_secret = parsed
            .client_secret
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty());
        let auth_endpoint = parsed
            .auth_endpoint
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_AUTH_ENDPOINT.to_string());
        let token_endpoint = parsed
            .token_endpoint
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| DEFAULT_TOKEN_ENDPOINT.to_string());

        Ok(Some(Self {
            client_id,
            client_secret,
            auth_endpoint,
            token_endpoint,
            scope: GOOGLE_DRIVE_APPDATA_SCOPE.to_string(),
            callback_timeout_secs: parsed
                .callback_timeout_secs
                .unwrap_or(DEFAULT_CALLBACK_TIMEOUT_SECS),
        }))
    }

    pub fn from_plugin_or_env(plugin_config: Option<&Value>) -> Result<Self, String> {
        if let Some(config) = Self::from_plugin_config(plugin_config)? {
            return Ok(config);
        }

        Self::from_env().map_err(|_| {
            format!(
                "Google Drive sync is not configured. Set `plugins.{TAURI_PLUGIN_CONFIG_KEY}.clientId` in src-tauri/tauri.conf.json or export {ENV_CLIENT_ID} before launching the app."
            )
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoredGoogleTokens {
    pub refresh_token: String,
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub access_token_expires_at: Option<String>,
    #[serde(default)]
    pub scope: Option<String>,
    #[serde(default)]
    pub token_type: Option<String>,
    #[serde(default)]
    pub google_account_email: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct GoogleDriveAuthSession {
    pub device_id: String,
    #[serde(default)]
    pub google_account_email: Option<String>,
    #[serde(default)]
    pub access_token_expires_at: Option<String>,
}

#[derive(Debug, Clone)]
struct PendingGoogleOAuthFlow {
    auth_url: Url,
    redirect_uri: String,
    pkce_verifier: String,
}

pub trait SecureTokenStore: Send + Sync {
    fn load_tokens(&self) -> Result<Option<StoredGoogleTokens>, String>;
    fn save_tokens(&self, tokens: &StoredGoogleTokens) -> Result<(), String>;
    fn clear_tokens(&self) -> Result<(), String>;
}

#[derive(Debug, Clone)]
pub struct OsSecureTokenStore {
    service: String,
    account: String,
}

impl Default for OsSecureTokenStore {
    fn default() -> Self {
        Self {
            service: TOKEN_STORE_SERVICE.to_string(),
            account: TOKEN_STORE_ACCOUNT.to_string(),
        }
    }
}

fn in_process_token_cache() -> &'static Mutex<Option<StoredGoogleTokens>> {
    static TOKEN_CACHE: OnceLock<Mutex<Option<StoredGoogleTokens>>> = OnceLock::new();
    TOKEN_CACHE.get_or_init(|| Mutex::new(None))
}

impl SecureTokenStore for OsSecureTokenStore {
    fn load_tokens(&self) -> Result<Option<StoredGoogleTokens>, String> {
        if let Some(tokens) = in_process_token_cache().lock().unwrap().clone() {
            return Ok(Some(tokens));
        }

        let maybe_secret = load_secret(&self.service, &self.account)?;
        let parsed = maybe_secret
            .map(|raw| serde_json::from_str(&raw).map_err(|e| e.to_string()))
            .transpose()?;

        if let Some(tokens) = parsed.clone() {
            *in_process_token_cache().lock().unwrap() = Some(tokens);
        }

        Ok(parsed)
    }

    fn save_tokens(&self, tokens: &StoredGoogleTokens) -> Result<(), String> {
        let secret = serde_json::to_string(tokens).map_err(|e| e.to_string())?;
        save_secret(&self.service, &self.account, &secret)?;
        *in_process_token_cache().lock().unwrap() = Some(tokens.clone());
        Ok(())
    }

    fn clear_tokens(&self) -> Result<(), String> {
        delete_secret(&self.service, &self.account)?;
        *in_process_token_cache().lock().unwrap() = None;
        Ok(())
    }
}

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    #[serde(default)]
    expires_in: Option<i64>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    scope: Option<String>,
    #[serde(default)]
    token_type: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum TokenRefreshError {
    Revoked,
    Message(String),
}

type ConfiguredBasicClient =
    BasicClient<EndpointSet, EndpointNotSet, EndpointNotSet, EndpointNotSet, EndpointSet>;

impl From<String> for TokenRefreshError {
    fn from(value: String) -> Self {
        Self::Message(value)
    }
}

pub async fn connect_google_drive_with_browser<F>(
    app_dir: &Path,
    config: &GoogleOAuthClientConfig,
    token_store: &dyn SecureTokenStore,
    open_browser: F,
) -> Result<GoogleDriveAuthSession, String>
where
    F: FnOnce(&str) -> Result<(), String>,
{
    let state = format!("state_{}", uuid::Uuid::new_v4().simple());
    let listener = TcpListener::bind(("127.0.0.1", 0)).map_err(|e| e.to_string())?;
    let redirect_uri = format!(
        "http://127.0.0.1:{}/callback",
        listener.local_addr().map_err(|e| e.to_string())?.port()
    );
    let pending_flow = prepare_google_oauth_flow(config, &redirect_uri, &state)?;
    let timeout = Duration::from_secs(config.callback_timeout_secs.max(1));
    let callback_state = state.clone();
    let callback_task = tokio::task::spawn_blocking(move || {
        wait_for_oauth_callback(listener, &callback_state, timeout)
    });

    open_browser(pending_flow.auth_url.as_str())?;

    let code = callback_task
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| e.to_string())?;
    finalize_google_drive_sign_in_with_exchange(
        app_dir,
        config,
        token_store,
        &pending_flow,
        &code,
        |config, code, pkce_verifier, redirect_uri| async move {
            exchange_authorization_code(&config, &code, &pkce_verifier, &redirect_uri).await
        },
    )
    .await
}

pub async fn get_valid_google_access_token(
    config: &GoogleOAuthClientConfig,
    token_store: &dyn SecureTokenStore,
) -> Result<String, String> {
    get_valid_google_access_token_with_refresh(
        config,
        token_store,
        |config, refresh_token| async move { refresh_access_token(&config, &refresh_token).await },
    )
    .await
}

async fn get_valid_google_access_token_with_refresh<F, Fut>(
    config: &GoogleOAuthClientConfig,
    token_store: &dyn SecureTokenStore,
    refresh_fn: F,
) -> Result<String, String>
where
    F: FnOnce(GoogleOAuthClientConfig, String) -> Fut,
    Fut: std::future::Future<Output = Result<GoogleTokenResponse, TokenRefreshError>>,
{
    let Some(mut tokens) = token_store.load_tokens()? else {
        return Err("Google Drive is not authenticated".to_string());
    };

    if access_token_is_still_valid(&tokens) {
        if let Some(access_token) = tokens.access_token {
            return Ok(access_token);
        }
    }

    let refresh_token = tokens.refresh_token.clone();
    let token_response = match refresh_fn(config.clone(), refresh_token).await {
        Ok(token_response) => token_response,
        Err(TokenRefreshError::Revoked) => {
            let _ = token_store.clear_tokens();
            return Err(
                "Google Drive refresh token was revoked or expired. Please reconnect.".to_string(),
            );
        }
        Err(TokenRefreshError::Message(err)) => return Err(err),
    };

    tokens.access_token = Some(token_response.access_token.clone());
    tokens.access_token_expires_at = token_response.expires_in.map(compute_expiry_timestamp);
    if let Some(refresh_token) = token_response.refresh_token {
        tokens.refresh_token = refresh_token;
    }
    if token_response.scope.is_some() {
        tokens.scope = token_response.scope;
    }
    if token_response.token_type.is_some() {
        tokens.token_type = token_response.token_type;
    }
    token_store.save_tokens(&tokens)?;

    Ok(token_response.access_token)
}

pub fn load_google_account_email(
    token_store: &dyn SecureTokenStore,
) -> Result<Option<String>, String> {
    Ok(token_store
        .load_tokens()?
        .and_then(|tokens| tokens.google_account_email))
}

pub fn has_google_drive_tokens(token_store: &dyn SecureTokenStore) -> Result<bool, String> {
    Ok(token_store.load_tokens()?.is_some())
}

pub fn disconnect_google_drive_data(
    app_dir: &Path,
    token_store: &dyn SecureTokenStore,
) -> Result<(), String> {
    token_store.clear_tokens()?;
    sync_state::clear_sync_runtime_files(app_dir)?;
    Ok(())
}

fn prepare_google_oauth_flow(
    config: &GoogleOAuthClientConfig,
    redirect_uri: &str,
    state: &str,
) -> Result<PendingGoogleOAuthFlow, String> {
    let client = build_oauth_client(config, Some(redirect_uri))?;
    let (pkce_challenge, pkce_verifier) = PkceCodeChallenge::new_random_sha256();
    let (auth_url, _) = client
        .authorize_url(|| CsrfToken::new(state.to_string()))
        .add_scope(Scope::new(config.scope.clone()))
        .add_extra_param("access_type", "offline")
        .add_extra_param("prompt", "consent")
        .set_pkce_challenge(pkce_challenge)
        .url();

    Ok(PendingGoogleOAuthFlow {
        auth_url,
        redirect_uri: redirect_uri.to_string(),
        pkce_verifier: pkce_verifier.secret().to_string(),
    })
}

async fn finalize_google_drive_sign_in_with_exchange<F, Fut>(
    app_dir: &Path,
    config: &GoogleOAuthClientConfig,
    token_store: &dyn SecureTokenStore,
    pending_flow: &PendingGoogleOAuthFlow,
    code: &str,
    exchange_fn: F,
) -> Result<GoogleDriveAuthSession, String>
where
    F: FnOnce(GoogleOAuthClientConfig, String, String, String) -> Fut,
    Fut: std::future::Future<Output = Result<GoogleTokenResponse, String>>,
{
    let token_response = exchange_fn(
        config.clone(),
        code.to_string(),
        pending_flow.pkce_verifier.clone(),
        pending_flow.redirect_uri.clone(),
    )
    .await?;

    let tokens = StoredGoogleTokens {
        refresh_token: token_response
            .refresh_token
            .ok_or_else(|| "Google OAuth did not return a refresh token".to_string())?,
        access_token: Some(token_response.access_token.clone()),
        access_token_expires_at: token_response.expires_in.map(compute_expiry_timestamp),
        scope: token_response.scope.clone(),
        token_type: token_response.token_type.clone(),
        google_account_email: None,
    };
    token_store.save_tokens(&tokens)?;

    let device_id = sync_state::get_or_create_device_id(app_dir)?;
    Ok(GoogleDriveAuthSession {
        device_id,
        google_account_email: tokens.google_account_email,
        access_token_expires_at: tokens.access_token_expires_at,
    })
}

async fn exchange_authorization_code(
    config: &GoogleOAuthClientConfig,
    code: &str,
    pkce_verifier: &str,
    redirect_uri: &str,
) -> Result<GoogleTokenResponse, String> {
    let client = build_oauth_client(config, Some(redirect_uri))?;
    let http_client = build_http_client()?;
    let token = client
        .exchange_code(AuthorizationCode::new(code.to_string()))
        .set_pkce_verifier(PkceCodeVerifier::new(pkce_verifier.to_string()))
        .request_async(&http_client)
        .await
        .map_err(|e| e.to_string())?;

    Ok(convert_token_response(&token))
}

async fn refresh_access_token(
    config: &GoogleOAuthClientConfig,
    refresh_token: &str,
) -> Result<GoogleTokenResponse, TokenRefreshError> {
    let client = build_oauth_client(config, None)?;
    let http_client = build_http_client()?;
    let token = client
        .exchange_refresh_token(&RefreshToken::new(refresh_token.to_string()))
        .request_async(&http_client)
        .await
        .map_err(map_refresh_token_error)?;

    Ok(convert_token_response(&token))
}

fn wait_for_oauth_callback(
    listener: TcpListener,
    expected_state: &str,
    timeout: Duration,
) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + timeout;

    loop {
        match listener.accept() {
            Ok((mut stream, _)) => return handle_callback_stream(&mut stream, expected_state),
            Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() >= deadline {
                    return Err("Timed out waiting for Google OAuth callback".to_string());
                }
                std::thread::sleep(Duration::from_millis(50));
            }
            Err(err) => return Err(err.to_string()),
        }
    }
}

fn handle_callback_stream(stream: &mut TcpStream, expected_state: &str) -> Result<String, String> {
    let mut reader = BufReader::new(stream.try_clone().map_err(|e| e.to_string())?);
    let mut request_line = String::new();
    reader
        .read_line(&mut request_line)
        .map_err(|e| e.to_string())?;
    drain_http_headers(&mut reader)?;

    let path = request_line
        .split_whitespace()
        .nth(1)
        .ok_or_else(|| "Malformed OAuth callback request".to_string())?;
    let callback_url = Url::parse(&format!("http://127.0.0.1{path}")).map_err(|e| e.to_string())?;
    let params = callback_url
        .query_pairs()
        .into_owned()
        .collect::<HashMap<_, _>>();

    if let Some(error) = params.get("error") {
        let message = params
            .get("error_description")
            .cloned()
            .unwrap_or_else(|| error.clone());
        write_callback_response(stream, false)?;
        return Err(format!("Google OAuth authorization failed: {message}"));
    }

    let state = params
        .get("state")
        .ok_or_else(|| "OAuth callback did not include state".to_string())?;
    if state != expected_state {
        write_callback_response(stream, false)?;
        return Err("Google OAuth callback state mismatch".to_string());
    }

    let code = params
        .get("code")
        .cloned()
        .ok_or_else(|| "OAuth callback did not include an authorization code".to_string())?;
    write_callback_response(stream, true)?;
    Ok(code)
}

fn write_callback_response(stream: &mut TcpStream, success: bool) -> Result<(), String> {
    let body = if success {
        "<html><body><h1>Kechimochi</h1><p>Google Drive authorization complete. You can close this window.</p></body></html>"
    } else {
        "<html><body><h1>Kechimochi</h1><p>Google Drive authorization failed. You can close this window and return to the app.</p></body></html>"
    };
    let response = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    );
    stream
        .write_all(response.as_bytes())
        .map_err(|e| e.to_string())
}

fn drain_http_headers(reader: &mut BufReader<TcpStream>) -> Result<(), String> {
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).map_err(|e| e.to_string())?;
        if line == "\r\n" || line.is_empty() {
            return Ok(());
        }
    }
}

fn access_token_is_still_valid(tokens: &StoredGoogleTokens) -> bool {
    let Some(access_token) = tokens.access_token.as_ref() else {
        return false;
    };
    if access_token.is_empty() {
        return false;
    }

    let Some(expires_at) = tokens.access_token_expires_at.as_ref() else {
        return false;
    };
    DateTime::parse_from_rfc3339(expires_at)
        .map(|timestamp| timestamp.with_timezone(&Utc) > Utc::now())
        .unwrap_or(false)
}

fn compute_expiry_timestamp(expires_in_seconds: i64) -> String {
    (Utc::now()
        + ChronoDuration::seconds(
            (expires_in_seconds - ACCESS_TOKEN_EXPIRY_SAFETY_MARGIN_SECS).max(0),
        ))
    .to_rfc3339()
}

fn build_oauth_client(
    config: &GoogleOAuthClientConfig,
    redirect_uri: Option<&str>,
) -> Result<ConfiguredBasicClient, String> {
    let auth_url = AuthUrl::new(config.auth_endpoint.clone()).map_err(|e| e.to_string())?;
    let token_url = TokenUrl::new(config.token_endpoint.clone()).map_err(|e| e.to_string())?;
    let mut client = BasicClient::new(ClientId::new(config.client_id.clone()))
        .set_auth_uri(auth_url)
        .set_token_uri(token_url);

    if let Some(client_secret) = config
        .client_secret
        .clone()
        .filter(|secret| !secret.is_empty())
    {
        client = client.set_client_secret(ClientSecret::new(client_secret));
    }

    if let Some(redirect_uri) = redirect_uri {
        client = client.set_redirect_uri(
            RedirectUrl::new(redirect_uri.to_string()).map_err(|e| e.to_string())?,
        );
    }

    Ok(client)
}

fn build_http_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(APP_USER_AGENT)
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(OAUTH_HTTP_CONNECT_TIMEOUT_SECS))
        .timeout(Duration::from_secs(OAUTH_HTTP_REQUEST_TIMEOUT_SECS))
        .build()
        .map_err(|e| e.to_string())
}

fn map_refresh_token_error(
    error: BasicRequestTokenError<HttpClientError<reqwest::Error>>,
) -> TokenRefreshError {
    match error {
        RequestTokenError::ServerResponse(error_response)
            if matches!(error_response.error(), BasicErrorResponseType::InvalidGrant) =>
        {
            TokenRefreshError::Revoked
        }
        other => TokenRefreshError::Message(other.to_string()),
    }
}

fn convert_token_response(
    token: &StandardTokenResponse<EmptyExtraTokenFields, BasicTokenType>,
) -> GoogleTokenResponse {
    GoogleTokenResponse {
        access_token: token.access_token().secret().to_string(),
        expires_in: token.expires_in().map(|duration| duration.as_secs() as i64),
        refresh_token: token
            .refresh_token()
            .map(|refresh_token| refresh_token.secret().to_string()),
        scope: token.scopes().map(|scopes| {
            scopes
                .iter()
                .map(|scope| scope.to_string())
                .collect::<Vec<_>>()
                .join(" ")
        }),
        token_type: Some(format!("{:?}", token.token_type())),
    }
}

fn save_secret(service: &str, account: &str, secret: &str) -> Result<(), String> {
    keyring_entry(service, account)?
        .set_password(secret)
        .map_err(keyring_error_message)
}

fn load_secret(service: &str, account: &str) -> Result<Option<String>, String> {
    match keyring_entry(service, account)?.get_password() {
        Ok(secret) if secret.is_empty() => Ok(None),
        Ok(secret) => Ok(Some(secret)),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(err) => Err(keyring_error_message(err)),
    }
}

fn delete_secret(service: &str, account: &str) -> Result<(), String> {
    match keyring_entry(service, account)?.delete_credential() {
        Ok(()) | Err(KeyringError::NoEntry) => Ok(()),
        Err(err) => Err(keyring_error_message(err)),
    }
}

fn keyring_entry(service: &str, account: &str) -> Result<Entry, String> {
    Entry::new(service, account).map_err(keyring_error_message)
}

fn keyring_error_message(error: KeyringError) -> String {
    match error {
        KeyringError::NoStorageAccess(_) | KeyringError::NoEntry => error.to_string(),
        other => format!("Secure token storage failed: {other}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::{Arc, Mutex};
    use tempfile::TempDir;

    #[derive(Debug, Default, Clone)]
    struct MemoryTokenStore {
        inner: Arc<Mutex<Option<StoredGoogleTokens>>>,
    }

    impl SecureTokenStore for MemoryTokenStore {
        fn load_tokens(&self) -> Result<Option<StoredGoogleTokens>, String> {
            Ok(self.inner.lock().unwrap().clone())
        }

        fn save_tokens(&self, tokens: &StoredGoogleTokens) -> Result<(), String> {
            *self.inner.lock().unwrap() = Some(tokens.clone());
            Ok(())
        }

        fn clear_tokens(&self) -> Result<(), String> {
            *self.inner.lock().unwrap() = None;
            Ok(())
        }
    }

    fn test_config(token_endpoint: String) -> GoogleOAuthClientConfig {
        GoogleOAuthClientConfig {
            client_id: "client-id".to_string(),
            client_secret: Some("client-secret".to_string()),
            auth_endpoint: "https://accounts.example.test/authorize".to_string(),
            token_endpoint,
            scope: GOOGLE_DRIVE_APPDATA_SCOPE.to_string(),
            callback_timeout_secs: 5,
        }
    }

    #[test]
    fn oauth_config_can_be_loaded_from_tauri_plugin_config() {
        let config = GoogleOAuthClientConfig::from_plugin_or_env(Some(&serde_json::json!({
            "clientId": "tauri-client-id",
            "clientSecret": "tauri-client-secret",
            "authEndpoint": "https://accounts.example.test/custom-auth",
            "tokenEndpoint": "https://oauth.example.test/custom-token",
            "callbackTimeoutSecs": 42
        })))
        .unwrap();

        assert_eq!(config.client_id, "tauri-client-id");
        assert_eq!(config.client_secret.as_deref(), Some("tauri-client-secret"));
        assert_eq!(
            config.auth_endpoint,
            "https://accounts.example.test/custom-auth"
        );
        assert_eq!(
            config.token_endpoint,
            "https://oauth.example.test/custom-token"
        );
        assert_eq!(config.callback_timeout_secs, 42);
    }

    #[test]
    fn empty_tauri_plugin_config_is_treated_as_not_configured() {
        assert_eq!(
            GoogleOAuthClientConfig::from_plugin_config(Some(&serde_json::json!({}))).unwrap(),
            None
        );
    }

    #[test]
    fn os_secure_token_store_uses_in_process_cache_before_keyring_lookup() {
        let expected = StoredGoogleTokens {
            refresh_token: "refresh-1".to_string(),
            access_token: Some("access-1".to_string()),
            access_token_expires_at: Some("2026-04-02T00:00:00Z".to_string()),
            scope: Some(GOOGLE_DRIVE_APPDATA_SCOPE.to_string()),
            token_type: Some("Bearer".to_string()),
            google_account_email: Some("user@example.com".to_string()),
        };

        *in_process_token_cache().lock().unwrap() = Some(expected.clone());

        let loaded = OsSecureTokenStore::default().load_tokens().unwrap();

        assert_eq!(loaded, Some(expected));
        *in_process_token_cache().lock().unwrap() = None;
    }

    #[tokio::test]
    async fn initial_oauth_sign_in_persists_tokens_and_device_id() {
        let config = test_config("https://oauth.example.test/token".to_string());
        let temp_dir = TempDir::new().unwrap();
        let token_store = MemoryTokenStore::default();
        let pending_flow =
            prepare_google_oauth_flow(&config, "http://127.0.0.1:8765/callback", "state_test")
                .unwrap();
        assert_eq!(
            pending_flow
                .auth_url
                .query_pairs()
                .find(|(key, _)| key == "scope")
                .map(|(_, value)| value.to_string())
                .as_deref(),
            Some(GOOGLE_DRIVE_APPDATA_SCOPE)
        );
        assert_eq!(
            pending_flow
                .auth_url
                .query_pairs()
                .find(|(key, _)| key == "code_challenge_method")
                .map(|(_, value)| value.to_string())
                .as_deref(),
            Some("S256")
        );
        let expected_verifier = pending_flow.pkce_verifier.clone();

        let session = finalize_google_drive_sign_in_with_exchange(
            temp_dir.path(),
            &config,
            &token_store,
            &pending_flow,
            "auth-code",
            |_config, code, verifier, redirect_uri| async move {
                assert_eq!(code, "auth-code");
                assert_eq!(redirect_uri, "http://127.0.0.1:8765/callback");
                assert_eq!(verifier, expected_verifier);
                Ok(GoogleTokenResponse {
                    access_token: "access-1".to_string(),
                    expires_in: Some(3600),
                    refresh_token: Some("refresh-1".to_string()),
                    scope: Some(GOOGLE_DRIVE_APPDATA_SCOPE.to_string()),
                    token_type: Some("Bearer".to_string()),
                })
            },
        )
        .await
        .unwrap();

        let stored = token_store.load_tokens().unwrap().unwrap();
        assert_eq!(stored.refresh_token, "refresh-1");
        assert_eq!(stored.access_token.as_deref(), Some("access-1"));
        assert_eq!(
            session.device_id,
            sync_state::get_or_create_device_id(temp_dir.path()).unwrap()
        );
    }

    #[tokio::test]
    async fn token_refresh_updates_access_token_and_preserves_refresh_token() {
        let config = test_config("https://oauth.example.test/token".to_string());
        let token_store = MemoryTokenStore::default();
        token_store
            .save_tokens(&StoredGoogleTokens {
                refresh_token: "refresh-1".to_string(),
                access_token: Some("expired".to_string()),
                access_token_expires_at: Some((Utc::now() - ChronoDuration::hours(1)).to_rfc3339()),
                scope: Some(GOOGLE_DRIVE_APPDATA_SCOPE.to_string()),
                token_type: Some("Bearer".to_string()),
                google_account_email: None,
            })
            .unwrap();

        let access_token = get_valid_google_access_token_with_refresh(
            &config,
            &token_store,
            |_config, refresh_token| async move {
                assert_eq!(refresh_token, "refresh-1");
                Ok(GoogleTokenResponse {
                    access_token: "access-2".to_string(),
                    expires_in: Some(3600),
                    refresh_token: None,
                    scope: None,
                    token_type: Some("Bearer".to_string()),
                })
            },
        )
        .await
        .unwrap();

        let stored = token_store.load_tokens().unwrap().unwrap();
        assert_eq!(access_token, "access-2");
        assert_eq!(stored.refresh_token, "refresh-1");
        assert_eq!(stored.access_token.as_deref(), Some("access-2"));
    }

    #[tokio::test]
    async fn revoked_refresh_token_is_detected_and_cleared() {
        let config = test_config("https://oauth.example.test/token".to_string());
        let token_store = MemoryTokenStore::default();
        token_store
            .save_tokens(&StoredGoogleTokens {
                refresh_token: "refresh-1".to_string(),
                access_token: None,
                access_token_expires_at: None,
                scope: None,
                token_type: None,
                google_account_email: None,
            })
            .unwrap();

        let err = get_valid_google_access_token_with_refresh(
            &config,
            &token_store,
            |_config, _refresh_token| async move { Err(TokenRefreshError::Revoked) },
        )
        .await
        .unwrap_err();

        assert!(err.contains("revoked"));
        assert!(token_store.load_tokens().unwrap().is_none());
    }

    #[test]
    fn disconnect_clears_tokens_and_sync_config() {
        let temp_dir = TempDir::new().unwrap();
        sync_state::ensure_sync_dir(temp_dir.path()).unwrap();
        sync_state::save_sync_config(
            temp_dir.path(),
            &sync_state::SyncConfig {
                sync_profile_id: "prof_1".to_string(),
                profile_name: "Morg".to_string(),
                google_account_email: Some("user@example.com".to_string()),
                remote_manifest_name: "manifest.json".to_string(),
                last_confirmed_snapshot_id: Some("snap_1".to_string()),
                last_sync_at: Some("2026-04-02T00:00:00Z".to_string()),
                last_sync_status: sync_state::SyncLifecycleStatus::Clean,
                device_name: "Laptop".to_string(),
            },
        )
        .unwrap();
        fs::write(sync_state::base_snapshot_path(temp_dir.path()), "snapshot").unwrap();
        fs::write(sync_state::pending_conflicts_path(temp_dir.path()), "[]").unwrap();

        let token_store = MemoryTokenStore::default();
        token_store
            .save_tokens(&StoredGoogleTokens {
                refresh_token: "refresh-1".to_string(),
                access_token: None,
                access_token_expires_at: None,
                scope: None,
                token_type: None,
                google_account_email: None,
            })
            .unwrap();

        disconnect_google_drive_data(temp_dir.path(), &token_store).unwrap();

        assert!(token_store.load_tokens().unwrap().is_none());
        assert!(!sync_state::sync_config_path(temp_dir.path()).exists());
        assert!(!sync_state::base_snapshot_path(temp_dir.path()).exists());
        assert!(!sync_state::pending_conflicts_path(temp_dir.path()).exists());
    }
}
