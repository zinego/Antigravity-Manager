use crate::models::quota::{ModelQuota, QuotaData};
use dashmap::DashMap;
use jsonwebtoken::{encode, Algorithm, EncodingKey, Header};
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;

pub const DEFAULT_VERTEX_LOCATION: &str = "global";
pub const DEFAULT_TOKEN_URI: &str = "https://oauth2.googleapis.com/token";
pub const CLOUD_PLATFORM_SCOPE: &str = "https://www.googleapis.com/auth/cloud-platform";
pub const VERTEX_OAUTH_CLIENT_KEY: &str = "vertex_service_account";

fn default_sa_type() -> String {
    "service_account".to_string()
}

fn default_token_uri() -> String {
    DEFAULT_TOKEN_URI.to_string()
}

#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ServiceAccountCredentials {
    #[serde(rename = "type", default = "default_sa_type")]
    pub cred_type: String,
    pub project_id: String,
    #[serde(default)]
    pub private_key_id: String,
    pub private_key: String,
    pub client_email: String,
    #[serde(default)]
    pub client_id: String,
    #[serde(default = "default_token_uri")]
    pub token_uri: String,
}

impl fmt::Debug for ServiceAccountCredentials {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ServiceAccountCredentials")
            .field("cred_type", &self.cred_type)
            .field("project_id", &self.project_id)
            .field("private_key_id", &self.private_key_id)
            .field("private_key", &"[REDACTED]")
            .field("client_email", &self.client_email)
            .field("client_id", &self.client_id)
            .field("token_uri", &self.token_uri)
            .finish()
    }
}

impl ServiceAccountCredentials {
    pub fn redacted(&self) -> Self {
        let mut cloned = self.clone();
        cloned.private_key = "[REDACTED]".to_string();
        cloned
    }

    pub fn effective_token_uri(&self) -> &str {
        let trimmed = self.token_uri.trim();
        if trimmed.is_empty() {
            DEFAULT_TOKEN_URI
        } else {
            trimmed
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedVertexImport {
    pub service_account: ServiceAccountCredentials,
    pub location: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VertexAccountMeta {
    pub project_id: String,
    pub location: String,
}

static VERTEX_ACCOUNT_REGISTRY: Lazy<DashMap<String, VertexAccountMeta>> = Lazy::new(DashMap::new);

pub fn register_vertex_account(account_id: &str, project_id: &str, location: &str) {
    let trimmed_loc = location.trim();
    let normalized_location = if trimmed_loc.is_empty() {
        DEFAULT_VERTEX_LOCATION.to_string()
    } else {
        trimmed_loc.to_string()
    };
    VERTEX_ACCOUNT_REGISTRY.insert(
        account_id.to_string(),
        VertexAccountMeta {
            project_id: project_id.trim().to_string(),
            location: normalized_location,
        },
    );
}

pub fn unregister_vertex_account(account_id: &str) {
    VERTEX_ACCOUNT_REGISTRY.remove(account_id);
}

pub fn get_vertex_account_meta(account_id: &str) -> Option<VertexAccountMeta> {
    VERTEX_ACCOUNT_REGISTRY
        .get(account_id)
        .map(|entry| entry.value().clone())
}

pub fn normalize_vertex_location(location: Option<&str>) -> String {
    match location.map(str::trim).filter(|s| !s.is_empty()) {
        Some(loc) => loc.to_string(),
        None => DEFAULT_VERTEX_LOCATION.to_string(),
    }
}

fn extract_location_from_value(val: &Value) -> Option<&str> {
    val.get("location")
        .or_else(|| val.get("vertex_location"))
        .or_else(|| val.get("vertexLocation"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
}

/// Parses either a raw GCP service account JSON (`"type": "service_account"`) or
/// a `cli-proxy-api` Vertex wrapper JSON (`"type": "vertex"` or nested `"service_account"`).
/// Returns `Ok(None)` if the input is clearly not Vertex/SA JSON (e.g. an OAuth refresh token).
pub fn parse_vertex_credentials(raw: &str) -> Result<Option<ParsedVertexImport>, String> {
    let trimmed = raw.trim();
    if !trimmed.starts_with('{') {
        return Ok(None);
    }

    let val: Value = serde_json::from_str(trimmed)
        .map_err(|e| format!("Invalid Vertex service account JSON: {}", e))?;
    let Some(obj) = val.as_object() else {
        return Ok(None);
    };

    let cred_type = obj.get("type").and_then(|v| v.as_str()).map(str::trim);
    let nested_sa = obj
        .get("service_account")
        .or_else(|| obj.get("serviceAccount"));

    let is_sa_payload =
        matches!(cred_type, Some("service_account") | Some("vertex")) || nested_sa.is_some();
    if !is_sa_payload {
        return Ok(None);
    }

    let sa_value = if let Some(inner) = nested_sa {
        if !inner.is_object() {
            return Err("Invalid Vertex JSON: 'service_account' must be an object".to_string());
        }
        inner
    } else {
        &val
    };

    let mut sa: ServiceAccountCredentials = serde_json::from_value(sa_value.clone())
        .map_err(|e| format!("Invalid service_account credentials fields: {}", e))?;

    if let Some(top_project) = obj
        .get("project_id")
        .or_else(|| obj.get("projectId"))
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        sa.project_id = top_project.to_string();
    } else {
        sa.project_id = sa.project_id.trim().to_string();
    }

    sa.client_email = sa.client_email.trim().to_string();
    sa.private_key_id = sa.private_key_id.trim().to_string();
    sa.client_id = sa.client_id.trim().to_string();
    if !sa.private_key.contains('\n') && sa.private_key.contains("\\n") {
        sa.private_key = sa.private_key.replace("\\n", "\n");
    }
    sa.private_key = sa.private_key.trim().to_string();
    if sa.token_uri.trim().is_empty() {
        sa.token_uri = default_token_uri();
    } else {
        sa.token_uri = sa.token_uri.trim().to_string();
    }
    if sa.cred_type.trim().is_empty() || sa.cred_type.trim() == "vertex" {
        sa.cred_type = default_sa_type();
    }

    if sa.project_id.is_empty() {
        return Err("Service account JSON is missing non-empty 'project_id'".to_string());
    }
    if sa.client_email.is_empty() {
        return Err("Service account JSON is missing non-empty 'client_email'".to_string());
    }
    if sa.private_key.is_empty() {
        return Err("Service account JSON is missing non-empty 'private_key'".to_string());
    }

    EncodingKey::from_rsa_pem(sa.private_key.as_bytes())
        .map_err(|e| format!("Invalid service account RSA private_key PEM: {}", e))?;

    let location = extract_location_from_value(&val)
        .or_else(|| extract_location_from_value(sa_value))
        .map(ToString::to_string)
        .unwrap_or_else(|| DEFAULT_VERTEX_LOCATION.to_string());

    Ok(Some(ParsedVertexImport {
        service_account: sa,
        location,
    }))
}

#[derive(Debug, Serialize, Deserialize)]
struct ServiceAccountJwtClaims {
    iss: String,
    sub: String,
    scope: String,
    aud: String,
    iat: i64,
    exp: i64,
}

#[derive(Debug, Deserialize)]
struct ServiceAccountTokenResponse {
    access_token: String,
    #[serde(default = "default_expires_in")]
    expires_in: i64,
}

fn default_expires_in() -> i64 {
    3600
}

pub fn build_service_account_jwt(
    sa: &ServiceAccountCredentials,
    now: i64,
) -> Result<(String, i64), String> {
    let token_uri = sa.effective_token_uri();
    let exp = now + 3600;

    let mut header = Header::new(Algorithm::RS256);
    header.typ = Some("JWT".to_string());
    if !sa.private_key_id.trim().is_empty() {
        header.kid = Some(sa.private_key_id.trim().to_string());
    }

    let claims = ServiceAccountJwtClaims {
        iss: sa.client_email.clone(),
        sub: sa.client_email.clone(),
        scope: CLOUD_PLATFORM_SCOPE.to_string(),
        aud: token_uri.to_string(),
        iat: now,
        exp,
    };

    let key = EncodingKey::from_rsa_pem(sa.private_key.as_bytes())
        .map_err(|e| format!("Invalid RSA private_key PEM: {}", e))?;
    let assertion = encode(&header, &claims, &key)
        .map_err(|e| format!("Failed to sign Vertex SA JWT assertion: {}", e))?;

    Ok((assertion, exp))
}

pub async fn exchange_service_account_token(
    sa: &ServiceAccountCredentials,
    account_id: Option<&str>,
) -> Result<(String, i64), String> {
    let now = chrono::Utc::now().timestamp();
    let (assertion, _) = build_service_account_jwt(sa, now)?;
    let token_uri = sa.effective_token_uri();

    let client = crate::modules::oauth::create_oauth_client_for_account(account_id).await;
    let params = [
        ("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer"),
        ("assertion", assertion.as_str()),
    ];

    let response = client
        .post(token_uri)
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("Vertex SA token exchange request failed: {}", e))?;

    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(format!(
            "Vertex SA token exchange failed (HTTP {}): {}",
            status.as_u16(),
            body
        ));
    }

    let parsed: ServiceAccountTokenResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse Vertex SA token response: {}", e))?;
    if parsed.access_token.trim().is_empty() {
        return Err("Vertex SA token exchange returned empty access_token".to_string());
    }

    Ok((parsed.access_token, parsed.expires_in.max(60)))
}

fn strip_model_resource_prefix(model: &str) -> String {
    let trimmed = model.trim().to_lowercase();
    if let Some(rest) = trimmed.strip_prefix("publishers/google/models/") {
        rest.to_string()
    } else if let Some(rest) = trimmed.strip_prefix("models/") {
        rest.to_string()
    } else {
        trimmed
    }
}

pub fn is_vertex_supported_model(model: &str) -> bool {
    let clean = strip_model_resource_prefix(model);
    if clean.is_empty() {
        return false;
    }

    if clean.starts_with("claude")
        || clean.starts_with("gpt")
        || clean.starts_with("o1")
        || clean.starts_with("o3")
        || clean.starts_with("o4")
        || clean.starts_with("deepseek")
        || clean.starts_with("qwen")
        || clean.starts_with("fable")
        || clean.contains("opus")
        || clean.contains("sonnet")
        || clean.contains("haiku")
    {
        return false;
    }

    clean.starts_with("gemini-")
        || clean.starts_with("imagen-")
        || matches!(clean.as_str(), "argon" | "carbon" | "hydrogen")
}

pub fn resolve_vertex_model_id(model: &str) -> String {
    let mut clean = strip_model_resource_prefix(model);
    const EFFORT_TIER_SUFFIXES: &[&str] = &[
        "-extra-low",
        "-xhigh",
        "-minimal",
        "-medium",
        "-high",
        "-low",
        "-thinking",
        "-tiered",
        "-agent",
        "-online",
        "@default",
    ];

    loop {
        let mut stripped = false;
        for suffix in EFFORT_TIER_SUFFIXES {
            if let Some(base) = clean.strip_suffix(suffix) {
                clean = base.to_string();
                stripped = true;
                break;
            }
        }
        if !stripped {
            break;
        }
    }

    match clean.as_str() {
        "argon" => "gemini-4-argon".to_string(),
        "carbon" => "gemini-4-carbon".to_string(),
        "hydrogen" => "gemini-4-hydrogen".to_string(),
        "gemini-3-flash" => "gemini-3-flash-preview".to_string(),
        "gemini-3-pro" | "gemini-3.1-pro" => "gemini-3.1-pro-preview".to_string(),
        "gemini-3.1-flash-image-preview" => "gemini-3.1-flash-image".to_string(),
        "gemini-3-pro-image-preview" => "gemini-3-pro-image".to_string(),
        _ => clean,
    }
}

pub fn build_vertex_endpoint_url(
    project_id: &str,
    location: &str,
    vertex_model: &str,
    method: &str,
    query_string: Option<&str>,
) -> String {
    let loc = normalize_vertex_location(Some(location));
    let host = if loc == DEFAULT_VERTEX_LOCATION {
        "https://aiplatform.googleapis.com".to_string()
    } else {
        format!("https://{}-aiplatform.googleapis.com", loc)
    };

    let base = format!(
        "{}/v1beta1/projects/{}/locations/{}/publishers/google/models/{}:{}",
        host,
        project_id.trim(),
        loc,
        vertex_model.trim(),
        method.trim()
    );

    if let Some(qs) = query_string
        .map(str::trim)
        .map(|s| s.trim_start_matches('?'))
        .filter(|s| !s.is_empty())
    {
        format!("{}?{}", base, qs)
    } else {
        base
    }
}

pub fn prepare_vertex_request_body(body: &Value, method: &str) -> Value {
    let mut unwrapped = if let Some(inner) = body.get("request").and_then(|v| v.as_object()) {
        Value::Object(inner.clone())
    } else {
        body.clone()
    };

    if let Some(obj) = unwrapped.as_object_mut() {
        const V1INTERNAL_ONLY_KEYS: &[&str] = &[
            "sessionId",
            "_session_thinking_id",
            "enabledCreditTypes",
            "requestType",
            "userAgent",
            "project",
            "model",
            "requestId",
            "labels",
            "metadata",
            "x-agm-vertex-model",
        ];
        for key in V1INTERNAL_ONLY_KEYS {
            obj.remove(*key);
        }

        if let Some(tools) = obj.get_mut("tools").and_then(|v| v.as_array_mut()) {
            for tool in tools {
                if let Some(gs) = tool.get_mut("googleSearch").and_then(|v| v.as_object_mut()) {
                    gs.remove("enhancedContent");
                    gs.remove("enhanced_content");
                }
            }
        }

        if method == "countTokens" {
            obj.remove("safetySettings");
            obj.remove("generationConfig");
        }
    }

    unwrapped
}

pub const VERTEX_MODEL_IDS: &[&str] = &[
    "gemini-4-argon",
    "gemini-4-argon-high",
    "gemini-4-argon-medium",
    "gemini-4-argon-low",
    "gemini-4-carbon",
    "gemini-4-hydrogen",
    "gemini-3.8-flash",
    "gemini-3.8-flash-high",
    "gemini-3.8-flash-medium",
    "gemini-3.8-flash-low",
    "gemini-3.6-flash",
    "gemini-3.6-flash-high",
    "gemini-3.6-flash-medium",
    "gemini-3.6-flash-low",
    "gemini-3.5-flash",
    "gemini-3.5-flash-high",
    "gemini-3.5-flash-medium",
    "gemini-3.5-flash-low",
    "gemini-3.5-flash-tiered",
    "gemini-3.5-flash-lite",
    "gemini-3.1-pro-preview",
    "gemini-3.1-pro-high",
    "gemini-3.1-pro-low",
    "gemini-3.1-flash-lite",
    "gemini-3.1-flash-image",
    "gemini-3-flash-preview",
    "gemini-3-flash-high",
    "gemini-3-flash-medium",
    "gemini-3-flash-low",
    "gemini-3-pro-image",
    "gemini-2.5-flash-image",
];

pub fn is_vertex_model_id_exposed(model_id: &str) -> bool {
    let lower = model_id.trim().to_lowercase();
    VERTEX_MODEL_IDS.iter().any(|&id| id == lower)
}

pub fn build_synthetic_vertex_quota() -> QuotaData {
    let mut quota = QuotaData::new();
    quota.is_forbidden = false;
    quota.subscription_tier = Some("ENTERPRISE".to_string());
    quota.last_updated = chrono::Utc::now().timestamp();

    for &name in VERTEX_MODEL_IDS {
        quota.add_model(ModelQuota {
            name: name.to_string(),
            percentage: 100,
            reset_time: String::new(),
            display_name: None,
            supports_images: None,
            supports_thinking: None,
            thinking_budget: None,
            recommended: None,
            max_tokens: None,
            max_output_tokens: None,
            model: None,
            supported_mime_types: None,
        });
    }

    quota
}

#[cfg(test)]
mod tests {
    use super::*;
    use jsonwebtoken::{decode, DecodingKey, Validation};
    use serde_json::json;

    // Disposable 2048-bit RSA test fixture generated offline for unit testing only.
    fn test_private_pem() -> String {
        concat!(
            "-----BEGIN ",
            "PRIVATE KEY-----\n",
            "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQCaw6F574LYgKOx\n",
            "9Uhc7b+/Dj8Edgrh0y92q9hDAhxW3lxEFpe1d6K0Uqsujr/Sxhgqp4tV7RP+nkXe\n",
            "2VnqNQ1mt2gHVTJ4HhWUFgXZ9rAN9Id8kDW236UEnSfuFNef0L3t4R47tBQM7ZCP\n",
            "Ub0CpGvOn1u7sNPbJUIFizdiG5vKXOSp65kxxb/DmAoy/ekAs/VoVasK7uYPQ0ji\n",
            "cy0W+3gn7Uo9OPTK3FbNb+/Nm6BFqnbiJDcK90CZXzGwNKcpGnog2gDhvhyaQ1QQ\n",
            "gE4qVpbmsGi5+bJ4XFoiWF2Cuaq9qAIkw2jjGySrv4BQFVDbGJKDBXMfQ6jfMrh1\n",
            "MwHRDkO9AgMBAAECggEAAW5ZqeT7EsFtwhGAj8trAHtDPelRhHENeU1xfH0igfMg\n",
            "a0jCMl1e1cgF6TJMt8g5JPvToAHHM42HG95qpG3FJ/P+NEMnalDs5iel+jP7wMVI\n",
            "E3DJ7lz3C6ngWqU6sTGe7/oq62Zo4Q25Tnn1A3c9v/VdRckGzHn1uFNnObMDp8Vc\n",
            "cPGKT8bgswI/MHe9Qif3gSZ4xzy1Fgk8eUj4pKc4sPMPWoyzzv2PHj9iPtJzwRmE\n",
            "eWBgjVHMR2RgwrRJFvar7ANchlYDp9/Ke1Rq8DljBlE3GgDfejx3mxwccVV94WGe\n",
            "jZ4zvU9HuWfqeS/E+0+qEgE6k9esju3/zHcbP94wyQKBgQDOaw+dGb3ojQ7aoI1O\n",
            "lfLpyWfNN8GbCjkYn7Z08actgEgN88odHvhSeMz4twbyMo89RxBf5I7/J3HxD2Uf\n",
            "6o/3J4ZR8g/lZCc4el40jgM5AkemftpxuLZ0bmtpKYNFE9w5Tjy+lMelLAITfOPI\n",
            "gcez5RRudLHQo7YIkwnlj1hOdwKBgQC/8Er6sUwTP24Q2rUnjpEHxPWAKmrVREUd\n",
            "c/mU0b4t20ncIotqz6SazT43NmRHMCPamd984CJMxUr4WxaV7LAoSDQyBWt5KNNM\n",
            "HceViZnPO1S6HLeNKiB45DQdIyrmj9DhqW2XFHF6I8yvGuf04eoOEfyZwh7FY85V\n",
            "SNqoGIxIawKBgQDG9ocsRJ26xAxnS44pC3wDQLEfK/kfujDivT+fZTZhM19Ao5ZT\n",
            "j4CH7gyUR8cYOQe8Zv0vkR0McDbxxocQxoVSE/Tyk8Iit/DeDYU0XxZYIwxxPaDN\n",
            "MOAdRjmeOfdf5A7H5dPDV6FAYjT2F9FveTjG+64/8ZdbphFWHnTRouPZbQKBgEQd\n",
            "qN5S8WabShpdI5EIPVv+gAmeBA/vjH+pWtd/n/hyLEIdWFDto8L0N7IscWX6JZ88\n",
            "oF2WxVVtZu/Ak8FdIB8LkMp3te5nmKUYpG3jSVyL98Oc0V8dpiyBACWfB2iPfVe4\n",
            "YxYMwUDRV6CE8fCsA/4+T+DZTUZL5zvJASBKpe5FAoGBAIYnSM69p01Jf3Et/Hby\n",
            "BnuT8PGMWyGYBHWC4tfor5bfetSzyrcLT7oyc5bm3dKQl2dmke2BDK/02QTB/0Gp\n",
            "/19MNrxonAUtmZFY/gMe4hSdrXfoe4l8JRqZzsOQWCFFHtD1NfVu7o7qPhZD1sKl\n",
            "+h50UJcv5a3OrpBQg26SPL+q\n",
            "-----END ",
            "PRIVATE KEY-----\n"
        )
        .to_string()
    }

    fn test_public_pem() -> String {
        concat!(
            "-----BEGIN PUBLIC KEY-----\n",
            "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAmsOhee+C2ICjsfVIXO2/\n",
            "vw4/BHYK4dMvdqvYQwIcVt5cRBaXtXeitFKrLo6/0sYYKqeLVe0T/p5F3tlZ6jUN\n",
            "ZrdoB1UyeB4VlBYF2fawDfSHfJA1tt+lBJ0n7hTXn9C97eEeO7QUDO2Qj1G9AqRr\n",
            "zp9bu7DT2yVCBYs3YhubylzkqeuZMcW/w5gKMv3pALP1aFWrCu7mD0NI4nMtFvt4\n",
            "J+1KPTj0ytxWzW/vzZugRap24iQ3CvdAmV8xsDSnKRp6INoA4b4cmkNUEIBOKlaW\n",
            "5rBoufmyeFxaIlhdgrmqvagCJMNo4xskq7+AUBVQ2xiSgwVzH0Oo3zK4dTMB0Q5D\n",
            "vQIDAQAB\n",
            "-----END PUBLIC KEY-----\n"
        )
        .to_string()
    }

    fn sample_sa_json() -> String {
        serde_json::to_string(&json!({
            "type": "service_account",
            "project_id": "proj-vertex-123",
            "private_key_id": "key-id-1",
            "private_key": test_private_pem(),
            "client_email": "vertex-runner@proj-vertex-123.iam.gserviceaccount.com",
            "client_id": "1234567890",
            "token_uri": "https://oauth2.googleapis.com/token"
        }))
        .unwrap()
    }

    #[test]
    fn parse_vertex_credentials_ignores_plain_refresh_token() {
        assert!(parse_vertex_credentials("1//04abc_refresh_token")
            .unwrap()
            .is_none());
        assert!(parse_vertex_credentials("  ").unwrap().is_none());
        assert!(parse_vertex_credentials(r#"{"refresh_token":"1//abc"}"#)
            .unwrap()
            .is_none());
    }

    #[test]
    fn parse_vertex_credentials_supports_raw_and_wrapper_json() {
        let parsed = parse_vertex_credentials(&sample_sa_json())
            .unwrap()
            .expect("raw service_account JSON should parse");
        assert_eq!(parsed.location, "global");
        assert_eq!(parsed.service_account.project_id, "proj-vertex-123");
        assert_eq!(
            parsed.service_account.client_email,
            "vertex-runner@proj-vertex-123.iam.gserviceaccount.com"
        );
        assert!(format!("{:?}", parsed.service_account).contains("[REDACTED]"));
        assert!(!format!("{:?}", parsed.service_account).contains("MIIEvg"));
        assert_eq!(parsed.service_account.redacted().private_key, "[REDACTED]");

        let wrapper = json!({
            "type": "vertex",
            "location": "us-central1",
            "project_id": "override-proj",
            "service_account": serde_json::from_str::<Value>(&sample_sa_json()).unwrap()
        });
        let parsed_wrapper = parse_vertex_credentials(&wrapper.to_string())
            .unwrap()
            .expect("cli-proxy-api wrapper JSON should parse");
        assert_eq!(parsed_wrapper.location, "us-central1");
        assert_eq!(parsed_wrapper.service_account.project_id, "override-proj");
        assert_eq!(parsed_wrapper.service_account.cred_type, "service_account");
    }

    #[test]
    fn parse_vertex_credentials_rejects_invalid_private_key() {
        let bad = json!({
            "type": "service_account",
            "project_id": "proj-bad",
            "private_key": "not-a-valid-pem",
            "client_email": "bad@proj.iam.gserviceaccount.com"
        });
        let err = parse_vertex_credentials(&bad.to_string()).unwrap_err();
        assert!(err.contains("RSA private_key"));
    }

    #[test]
    fn build_service_account_jwt_signs_valid_rs256_assertion() {
        let parsed = parse_vertex_credentials(&sample_sa_json())
            .unwrap()
            .unwrap();
        let now = chrono::Utc::now().timestamp();
        let (jwt, exp) = build_service_account_jwt(&parsed.service_account, now).unwrap();
        assert_eq!(exp, now + 3600);

        let mut validation = Validation::new(Algorithm::RS256);
        validation.set_audience(&[DEFAULT_TOKEN_URI]);
        let decoded = decode::<ServiceAccountJwtClaims>(
            &jwt,
            &DecodingKey::from_rsa_pem(test_public_pem().as_bytes()).unwrap(),
            &validation,
        )
        .unwrap();

        assert_eq!(decoded.header.kid.as_deref(), Some("key-id-1"));
        assert_eq!(
            decoded.claims.iss,
            "vertex-runner@proj-vertex-123.iam.gserviceaccount.com"
        );
        assert_eq!(decoded.claims.sub, decoded.claims.iss);
        assert_eq!(decoded.claims.scope, CLOUD_PLATFORM_SCOPE);
        assert_eq!(decoded.claims.iat, now);
        assert_eq!(decoded.claims.exp, now + 3600);
    }

    #[test]
    fn vertex_model_filtering_and_resolution_rules() {
        assert!(is_vertex_supported_model("gemini-3-flash-preview"));
        assert!(is_vertex_supported_model("models/gemini-3.8-flash-high"));
        assert!(is_vertex_supported_model("argon"));
        assert!(is_vertex_supported_model("carbon"));
        assert!(is_vertex_supported_model("hydrogen"));
        assert!(is_vertex_supported_model("imagen-3.0-generate-002"));

        assert!(!is_vertex_supported_model("claude-sonnet-4-6"));
        assert!(!is_vertex_supported_model("claude-opus-4-6-thinking"));
        assert!(!is_vertex_supported_model("gpt-4o"));
        assert!(!is_vertex_supported_model("deepseek-r1"));
        assert!(!is_vertex_supported_model("o3-mini"));
        assert!(!is_vertex_supported_model(""));

        assert_eq!(resolve_vertex_model_id("argon"), "gemini-4-argon");
        assert_eq!(resolve_vertex_model_id("carbon"), "gemini-4-carbon");
        assert_eq!(resolve_vertex_model_id("hydrogen"), "gemini-4-hydrogen");
        assert_eq!(
            resolve_vertex_model_id("gemini-3-flash"),
            "gemini-3-flash-preview"
        );
        assert_eq!(
            resolve_vertex_model_id("gemini-3-flash-high"),
            "gemini-3-flash-preview"
        );
        assert_eq!(
            resolve_vertex_model_id("gemini-3.1-pro-low"),
            "gemini-3.1-pro-preview"
        );
        assert_eq!(
            resolve_vertex_model_id("gemini-3-pro"),
            "gemini-3.1-pro-preview"
        );
        assert_eq!(
            resolve_vertex_model_id("models/gemini-3.8-flash-medium"),
            "gemini-3.8-flash"
        );
        assert_eq!(
            resolve_vertex_model_id("gemini-3.1-flash-image-preview"),
            "gemini-3.1-flash-image"
        );
        assert_eq!(
            resolve_vertex_model_id("gemini-3-pro-image-preview"),
            "gemini-3-pro-image"
        );
        assert_eq!(
            resolve_vertex_model_id("gemini-2.5-flash-image@default"),
            "gemini-2.5-flash-image"
        );
        assert_eq!(
            resolve_vertex_model_id("publishers/google/models/gemini-3.5-flash-lite"),
            "gemini-3.5-flash-lite"
        );
    }

    #[test]
    fn vertex_endpoint_url_and_request_body_transform() {
        assert_eq!(
            build_vertex_endpoint_url(
                "my-proj",
                "",
                "gemini-3-flash-preview",
                "streamGenerateContent",
                Some("alt=sse"),
            ),
            "https://aiplatform.googleapis.com/v1beta1/projects/my-proj/locations/global/publishers/google/models/gemini-3-flash-preview:streamGenerateContent?alt=sse"
        );
        assert_eq!(
            build_vertex_endpoint_url(
                "my-proj",
                "us-central1",
                "gemini-3.1-pro-preview",
                "generateContent",
                None,
            ),
            "https://us-central1-aiplatform.googleapis.com/v1beta1/projects/my-proj/locations/us-central1/publishers/google/models/gemini-3.1-pro-preview:generateContent"
        );

        let wrapped = json!({
            "project": "antigravity-proj",
            "model": "gemini-3-flash-preview",
            "requestId": "req-1",
            "userAgent": "antigravity",
            "requestType": "agent",
            "request": {
                "sessionId": "sess-1",
                "_session_thinking_id": "t-1",
                "enabledCreditTypes": ["GOOGLE_ONE"],
                "labels": {"a": "b"},
                "metadata": {"m": 1},
                "contents": [{"role": "user", "parts": [{"text": "hi"}]}],
                "tools": [{"googleSearch": {"enhancedContent": {"foo": true}}}],
                "safetySettings": [{"category": "HARM_CATEGORY_HATE_SPEECH"}],
                "generationConfig": {"temperature": 0.2}
            }
        });

        let gen_body = prepare_vertex_request_body(&wrapped, "generateContent");
        assert!(gen_body.get("request").is_none());
        assert!(gen_body.get("sessionId").is_none());
        assert!(gen_body.get("_session_thinking_id").is_none());
        assert!(gen_body.get("enabledCreditTypes").is_none());
        assert!(gen_body.get("labels").is_none());
        assert!(gen_body.get("metadata").is_none());
        assert_eq!(gen_body["tools"][0]["googleSearch"], json!({}));
        assert!(gen_body.get("safetySettings").is_some());
        assert!(gen_body.get("generationConfig").is_some());

        let count_body = prepare_vertex_request_body(&wrapped, "countTokens");
        assert!(count_body.get("safetySettings").is_none());
        assert!(count_body.get("generationConfig").is_none());
        assert!(count_body.get("contents").is_some());
    }

    #[test]
    fn synthetic_vertex_quota_has_enterprise_tier_and_no_3p_models() {
        let quota = build_synthetic_vertex_quota();
        assert!(!quota.is_forbidden);
        assert_eq!(quota.subscription_tier.as_deref(), Some("ENTERPRISE"));
        assert!(!quota.models.is_empty());
        assert!(quota
            .models
            .iter()
            .any(|m| m.name == "gemini-3-flash-preview"));
        assert!(quota
            .models
            .iter()
            .any(|m| m.name == "gemini-3.5-flash-high"));
        assert!(quota
            .models
            .iter()
            .any(|m| m.name == "gemini-3.5-flash-tiered"));
        assert!(quota.models.iter().any(|m| m.name == "gemini-4-argon"));
        assert!(!quota
            .models
            .iter()
            .any(|m| m.name.contains("claude") || m.name.contains("gpt")));
    }

    #[test]
    fn vertex_account_registry_crud_works() {
        let acc_id = "unit-test-vertex-acc-1";
        register_vertex_account(acc_id, "proj-1", "");
        let meta = get_vertex_account_meta(acc_id).expect("meta should exist");
        assert_eq!(meta.project_id, "proj-1");
        assert_eq!(meta.location, "global");
        unregister_vertex_account(acc_id);
        assert!(get_vertex_account_meta(acc_id).is_none());
    }

    #[test]
    fn account_redacted_for_ipc_masks_private_key() {
        let parsed = parse_vertex_credentials(&sample_sa_json())
            .unwrap()
            .unwrap();
        let mut token = crate::models::TokenData::new(
            "access-tok".to_string(),
            String::new(),
            3600,
            Some(parsed.service_account.client_email.clone()),
            Some(parsed.service_account.project_id.clone()),
            None,
            true,
            None,
        );
        token.service_account = Some(parsed.service_account.clone());
        token.vertex_location = Some(parsed.location);
        assert!(token.is_vertex_service_account());

        let acc = crate::models::Account::new(
            "acc-vertex-ipc".to_string(),
            parsed.service_account.client_email.clone(),
            token,
        );
        let redacted = acc.redacted_for_ipc();
        let sa = redacted
            .token
            .service_account
            .expect("service_account kept");
        assert_eq!(sa.private_key, "[REDACTED]");
        assert_eq!(sa.project_id, "proj-vertex-123");
        assert_ne!(
            acc.token.service_account.as_ref().unwrap().private_key,
            "[REDACTED]"
        );
    }

    #[test]
    fn parse_import_entries_supports_vertex_sa_json() {
        let sa_json = sample_sa_json();
        let single = crate::modules::account::parse_import_entries_from_str(&sa_json);
        assert_eq!(single.len(), 1);
        assert_eq!(
            single[0].email.as_deref(),
            Some("vertex-runner@proj-vertex-123.iam.gserviceaccount.com")
        );
        assert!(parse_vertex_credentials(&single[0].refresh_token)
            .unwrap()
            .is_some());

        let array_json = format!("[{}]", sa_json);
        let multi = crate::modules::account::parse_import_entries_from_str(&array_json);
        assert_eq!(multi.len(), 1);
        assert!(parse_vertex_credentials(&multi[0].refresh_token)
            .unwrap()
            .is_some());
    }
}
