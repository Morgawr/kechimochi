use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::time::Duration;

use futures::StreamExt;
use reqwest::header::{HeaderName, HeaderValue, LOCATION};
use reqwest::{Method, StatusCode, Url};

pub const DEFAULT_USER_AGENT: &str = "Mozilla/5.0 (X11; Linux x86_64) \
    AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
pub const MAX_TEXT_RESPONSE_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_BINARY_RESPONSE_BYTES: usize = 25 * 1024 * 1024;

const MAX_REDIRECTS: usize = 5;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Clone)]
pub struct PublicFetchRequest {
    pub url: String,
    pub method: Method,
    pub body: Option<Vec<u8>>,
    pub headers: HashMap<String, String>,
    pub max_response_bytes: usize,
}

#[derive(Debug, Clone)]
pub struct PublicFetchResponse {
    pub bytes: Vec<u8>,
    pub final_url: Url,
    pub content_type: Option<String>,
}

pub async fn fetch_public(request: PublicFetchRequest) -> Result<PublicFetchResponse, String> {
    if request.method != Method::GET && request.method != Method::POST {
        return Err("Only GET and POST remote requests are supported".to_string());
    }
    if request.max_response_bytes == 0 {
        return Err("Remote response limit must be greater than zero".to_string());
    }

    let mut url = parse_public_http_url(&request.url)?;
    let mut method = request.method;
    let mut body = request.body;
    let mut headers = request.headers;

    for redirect_count in 0..=MAX_REDIRECTS {
        let (host, addresses) = resolve_public_addresses(&url).await?;
        let user_agent = headers
            .iter()
            .find(|(name, _)| name.eq_ignore_ascii_case("user-agent"))
            .map(|(_, value)| value.as_str())
            .unwrap_or(DEFAULT_USER_AGENT);
        let client = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(REQUEST_TIMEOUT)
            // A configured HTTP proxy would resolve the destination itself and
            // bypass the public-address validation and DNS pinning above.
            .no_proxy()
            .user_agent(user_agent)
            .resolve_to_addrs(&host, &addresses)
            .build()
            .map_err(|error| format!("Failed to prepare remote request: {error}"))?;

        let mut outgoing = client.request(method.clone(), url.clone());
        for (name, value) in &headers {
            if is_managed_request_header(name) {
                continue;
            }
            let name = HeaderName::from_bytes(name.as_bytes())
                .map_err(|error| format!("Invalid remote request header name: {error}"))?;
            let value = HeaderValue::from_str(value)
                .map_err(|error| format!("Invalid remote request header value: {error}"))?;
            outgoing = outgoing.header(name, value);
        }
        if let Some(bytes) = body.clone() {
            outgoing = outgoing.body(bytes);
        }

        let response = outgoing
            .send()
            .await
            .map_err(|error| format!("Remote request failed: {error}"))?;
        if response.status().is_redirection() {
            if redirect_count == MAX_REDIRECTS {
                return Err(format!(
                    "Remote request exceeded the limit of {MAX_REDIRECTS} redirects"
                ));
            }
            let location = response
                .headers()
                .get(LOCATION)
                .ok_or_else(|| "Remote redirect did not include a Location header".to_string())?
                .to_str()
                .map_err(|error| format!("Remote redirect Location is invalid: {error}"))?;
            let next_url = url
                .join(location)
                .map_err(|error| format!("Remote redirect URL is invalid: {error}"))?;
            let next_url = parse_public_http_url(next_url.as_str())?;
            if matches!(
                response.status(),
                StatusCode::SEE_OTHER | StatusCode::MOVED_PERMANENTLY | StatusCode::FOUND
            ) && method == Method::POST
            {
                method = Method::GET;
                body = None;
            }
            if url.origin() != next_url.origin() {
                if method != Method::GET || body.is_some() {
                    return Err(
                        "Refusing a cross-origin redirect for a remote request with a body"
                            .to_string(),
                    );
                }
                // Caller-supplied headers can contain API keys or cookies. A
                // redirect to another origin must not receive those secrets.
                headers.clear();
            }
            url = next_url;
            continue;
        }

        let response = response
            .error_for_status()
            .map_err(|error| format!("Remote server returned an error: {error}"))?;
        if let Some(content_length) = response.content_length() {
            if content_length > request.max_response_bytes as u64 {
                return Err(format!(
                    "Remote response is too large ({content_length} bytes; limit is {} bytes)",
                    request.max_response_bytes
                ));
            }
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .map(str::to_string);
        let final_url = response.url().clone();
        let mut stream = response.bytes_stream();
        let mut bytes = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk =
                chunk.map_err(|error| format!("Failed to read remote response: {error}"))?;
            let new_len = bytes
                .len()
                .checked_add(chunk.len())
                .ok_or_else(|| "Remote response size overflowed".to_string())?;
            if new_len > request.max_response_bytes {
                return Err(format!(
                    "Remote response exceeded the limit of {} bytes",
                    request.max_response_bytes
                ));
            }
            bytes.extend_from_slice(&chunk);
        }
        return Ok(PublicFetchResponse {
            bytes,
            final_url,
            content_type,
        });
    }

    Err("Remote request redirect handling failed".to_string())
}

pub fn infer_image_extension(bytes: &[u8]) -> Result<String, String> {
    let format = image::guess_format(bytes)
        .map_err(|_| "bytes are not a recognized image format".to_string())?;
    match format {
        image::ImageFormat::Jpeg => Ok("jpg".to_string()),
        image::ImageFormat::Png => Ok("png".to_string()),
        image::ImageFormat::Gif => Ok("gif".to_string()),
        image::ImageFormat::WebP => Ok("webp".to_string()),
        image::ImageFormat::Avif => Ok("avif".to_string()),
        image::ImageFormat::Bmp => Ok("bmp".to_string()),
        image::ImageFormat::Ico => Ok("ico".to_string()),
        _ => Err("image format is not supported for cover images".to_string()),
    }
}

fn parse_public_http_url(value: &str) -> Result<Url, String> {
    let url = Url::parse(value).map_err(|error| format!("Invalid remote URL: {error}"))?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Remote URL must use http or https".to_string());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Remote URL must not contain credentials".to_string());
    }
    if url.host_str().is_none() {
        return Err("Remote URL must include a host".to_string());
    }
    Ok(url)
}

async fn resolve_public_addresses(url: &Url) -> Result<(String, Vec<SocketAddr>), String> {
    let host = url
        .host_str()
        .ok_or_else(|| "Remote URL must include a host".to_string())?
        .to_string();
    let port = url
        .port_or_known_default()
        .ok_or_else(|| "Remote URL has no usable port".to_string())?;
    let addresses = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|error| format!("Failed to resolve remote host '{host}': {error}"))?
        .collect::<Vec<_>>();
    if addresses.is_empty() {
        return Err(format!(
            "Remote host '{host}' did not resolve to an address"
        ));
    }
    if let Some(address) = addresses.iter().find(|address| !is_public_ip(address.ip())) {
        return Err(format!(
            "Remote host '{host}' resolves to a private or non-routable address ({})",
            address.ip()
        ));
    }
    Ok((host, addresses))
}

fn is_managed_request_header(name: &str) -> bool {
    name.eq_ignore_ascii_case("user-agent")
        || name.eq_ignore_ascii_case("host")
        || name.eq_ignore_ascii_case("content-length")
        || name.eq_ignore_ascii_case("connection")
        || name.eq_ignore_ascii_case("transfer-encoding")
        || name.eq_ignore_ascii_case("proxy-authorization")
}

fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => is_public_ipv4(ip),
        IpAddr::V6(ip) => is_public_ipv6(ip),
    }
}

fn is_public_ipv4(ip: Ipv4Addr) -> bool {
    let [first, second, third, _] = ip.octets();
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_private()
        || ip.is_link_local()
        || ip.is_broadcast()
        || ip.is_multicast()
        || ip.is_documentation()
        || first == 0
        || first >= 240
        || (first == 100 && (64..=127).contains(&second))
        || (first == 192 && second == 0 && third == 0)
        || (first == 192 && second == 88 && third == 99)
        || (first == 198 && (18..=19).contains(&second)))
}

fn is_public_ipv6(ip: Ipv6Addr) -> bool {
    if let Some(ipv4) = ip.to_ipv4() {
        return is_public_ipv4(ipv4);
    }
    let segments = ip.segments();
    if segments[..6] == [0x0064, 0xff9b, 0, 0, 0, 0] {
        let mapped = Ipv4Addr::new(
            (segments[6] >> 8) as u8,
            segments[6] as u8,
            (segments[7] >> 8) as u8,
            segments[7] as u8,
        );
        return is_public_ipv4(mapped);
    }
    !(ip.is_unspecified()
        || ip.is_loopback()
        || ip.is_multicast()
        || segments[0] == 0x0064 && segments[1] == 0xff9b && segments[2] == 0x0001
        || segments[0] == 0x0100
        || segments[0] == 0x2001 && segments[1] < 0x0200
        || segments[0] == 0x2001 && segments[1] == 0x0db8
        || segments[0] == 0x2002
        || (segments[0] & 0xffc0) == 0xfec0
        || (segments[0] & 0xfe00) == 0xfc00
        || (segments[0] & 0xffc0) == 0xfe80
        || (segments[0] & 0xfff0) == 0x3ff0
        || segments[0] == 0x5f00)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_private_and_non_routable_addresses() {
        for address in [
            "0.0.0.0",
            "127.0.0.1",
            "10.0.0.1",
            "172.16.0.1",
            "192.168.1.1",
            "169.254.1.1",
            "100.64.0.1",
            "192.0.0.8",
            "192.88.99.1",
            "224.0.0.1",
            "::",
            "::1",
            "fc00::1",
            "fe80::1",
            "2001:db8::1",
            "64:ff9b:1::1",
            "64:ff9b::7f00:1",
            "100::1",
            "2001::1",
            "2002::1",
            "fec0::1",
            "3fff::1",
            "5f00::1",
            "::ffff:127.0.0.1",
        ] {
            assert!(!is_public_ip(address.parse().unwrap()), "{address}");
        }
    }

    #[test]
    fn accepts_public_addresses() {
        for address in ["1.1.1.1", "8.8.8.8", "2606:4700:4700::1111"] {
            assert!(is_public_ip(address.parse().unwrap()), "{address}");
        }
    }

    #[test]
    fn rejects_non_http_urls_and_credentials() {
        assert!(parse_public_http_url("file:///etc/passwd").is_err());
        assert!(parse_public_http_url("http://user:password@example.com").is_err());
        assert!(parse_public_http_url("https://example.com/path").is_ok());
    }

    #[tokio::test]
    async fn rejects_loopback_before_sending_a_request() {
        let error = fetch_public(PublicFetchRequest {
            url: "http://127.0.0.1:9/private".to_string(),
            method: Method::GET,
            body: None,
            headers: HashMap::new(),
            max_response_bytes: 1024,
        })
        .await
        .unwrap_err();

        assert!(error.contains("private or non-routable"));
    }
}
