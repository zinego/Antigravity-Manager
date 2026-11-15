use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Aggregated token statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenStatsAggregated {
    pub period: String, // e.g., "2024-01-15 14:00" for hourly, "2024-01-15" for daily
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cached_tokens: u64,
    #[serde(default)]
    pub total_reasoning_tokens: u64,
    pub total_tokens: u64,
    pub request_count: u64,
}

/// Per-account token statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountTokenStats {
    pub account_email: String,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cached_tokens: u64,
    #[serde(default)]
    pub total_reasoning_tokens: u64,
    pub total_tokens: u64,
    pub request_count: u64,
}

/// Summary statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TokenStatsSummary {
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cached_tokens: u64,
    #[serde(default)]
    pub total_reasoning_tokens: u64,
    pub total_tokens: u64,
    pub total_requests: u64,
    pub unique_accounts: u64,
    #[serde(default)]
    pub avg_ttft_ms: Option<f64>,
    #[serde(default)]
    pub avg_output_tps: Option<f64>,
}

/// Per-model token statistics
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelTokenStats {
    pub model: String,
    pub total_input_tokens: u64,
    pub total_output_tokens: u64,
    pub total_cached_tokens: u64,
    #[serde(default)]
    pub total_reasoning_tokens: u64,
    pub total_tokens: u64,
    pub request_count: u64,
    #[serde(default)]
    pub avg_ttft_ms: Option<f64>,
    #[serde(default)]
    pub avg_output_tps: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelSpeedBucketPoint {
    pub avg_tps: f64,
    pub sample_count: u64,
    pub total_output_tokens: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelSpeedBucket {
    pub label: String,
    pub start_ts: i64,
    pub end_ts: i64,
    pub models: std::collections::HashMap<String, ModelSpeedBucketPoint>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelSpeedItem {
    pub model: String,
    pub sample_count: u64,
    pub total_output_tokens: u64,
    pub avg_tps: f64,
    pub weighted_tps: f64,
    pub min_tps: f64,
    pub max_tps: f64,
    #[serde(default)]
    pub avg_ttft_ms: Option<f64>,
    #[serde(default)]
    pub p95_ttft_ms: Option<f64>,
    #[serde(default)]
    pub first_half_tps: Option<f64>,
    #[serde(default)]
    pub second_half_tps: Option<f64>,
    #[serde(default)]
    pub tps_delta: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelSpeedGlobalSummary {
    pub total_samples: u64,
    pub total_output_tokens: u64,
    #[serde(default)]
    pub avg_tps: Option<f64>,
    #[serde(default)]
    pub weighted_tps: Option<f64>,
    #[serde(default)]
    pub avg_ttft_ms: Option<f64>,
    #[serde(default)]
    pub p95_ttft_ms: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelSpeedResponse {
    pub summary: ModelSpeedGlobalSummary,
    pub models: Vec<ModelSpeedItem>,
    pub buckets: Vec<ModelSpeedBucket>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountDistributionSlice {
    pub account_email: String,
    pub request_count: u64,
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cached_tokens: u64,
    pub total_tokens: u64,
    pub request_share_pct: f64,
    pub token_share_pct: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelAccountDistributionItem {
    pub model: String,
    pub total_requests: u64,
    pub total_tokens: u64,
    pub accounts: Vec<AccountDistributionSlice>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelAccountDistributionResponse {
    pub total_requests: u64,
    pub total_tokens: u64,
    pub models: Vec<ModelAccountDistributionItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelTrendPoint {
    pub period: String,
    pub model_data: std::collections::HashMap<String, u64>,
}

/// Account trend data point (for stacked area chart)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountTrendPoint {
    pub period: String,
    pub account_data: std::collections::HashMap<String, u64>,
}

pub(crate) fn get_db_path() -> Result<PathBuf, String> {
    let data_dir = crate::modules::account::get_data_dir()?;
    Ok(data_dir.join("token_stats.db"))
}

fn connect_db() -> Result<Connection, String> {
    let db_path = get_db_path()?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    // Enable WAL mode for better concurrency
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "busy_timeout", 5000)
        .map_err(|e| e.to_string())?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|e| e.to_string())?;

    Ok(conn)
}

fn add_column_if_missing(conn: &Connection, table: &str, column_def: &str) -> Result<(), String> {
    let sql = format!("ALTER TABLE {} ADD COLUMN {}", table, column_def);
    match conn.execute(&sql, []) {
        Ok(_) => Ok(()),
        Err(e) if e.to_string().contains("duplicate column name") => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Initialize the token stats database
pub fn init_db() -> Result<(), String> {
    let conn = connect_db()?;

    // Create main usage table
    conn.execute(
        "CREATE TABLE IF NOT EXISTS token_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp INTEGER NOT NULL,
            account_email TEXT NOT NULL,
            model TEXT NOT NULL,
            input_tokens INTEGER NOT NULL DEFAULT 0,
            output_tokens INTEGER NOT NULL DEFAULT 0,
            cached_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    // Create indexes for efficient queries
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_token_timestamp ON token_usage (timestamp DESC)",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_token_account ON token_usage (account_email)",
        [],
    )
    .map_err(|e| e.to_string())?;

    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_token_account_timestamp ON token_usage (account_email, timestamp DESC)",
        [],
    );

    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_token_model ON token_usage (model)",
        [],
    );

    // Create hourly aggregation table for fast queries
    conn.execute(
        "CREATE TABLE IF NOT EXISTS token_stats_hourly (
            hour_bucket TEXT NOT NULL,
            account_email TEXT NOT NULL,
            total_input_tokens INTEGER NOT NULL DEFAULT 0,
            total_output_tokens INTEGER NOT NULL DEFAULT 0,
            total_cached_tokens INTEGER NOT NULL DEFAULT 0,
            total_tokens INTEGER NOT NULL DEFAULT 0,
            request_count INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (hour_bucket, account_email)
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_hourly_account ON token_stats_hourly (account_email, hour_bucket)",
        [],
    );

    add_column_if_missing(
        &conn,
        "token_usage",
        "cached_tokens INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(
        &conn,
        "token_usage",
        "reasoning_tokens INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(&conn, "token_usage", "requested_model TEXT")?;
    add_column_if_missing(&conn, "token_usage", "ttft_ms REAL")?;
    add_column_if_missing(&conn, "token_usage", "duration_ms REAL")?;
    let _ = conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_token_requested_model ON token_usage (requested_model)",
        [],
    );
    add_column_if_missing(
        &conn,
        "token_stats_hourly",
        "total_cached_tokens INTEGER NOT NULL DEFAULT 0",
    )?;
    add_column_if_missing(
        &conn,
        "token_stats_hourly",
        "total_reasoning_tokens INTEGER NOT NULL DEFAULT 0",
    )?;

    // 历史数据平滑迁移：针对旧版本未记录 requested_model 的记录，依据默认路由规则反推并回填实际路由模型
    migrate_legacy_unmapped_models(&conn);

    Ok(())
}

/// 历史数据兼容迁移：针对 requested_model IS NULL 的历史记录，将其原先记录的模型保留至 requested_model，
/// 并通过网关统一路由解析器计算其真实生效的物理/路由模型填入 model 字段。
fn migrate_legacy_unmapped_models(conn: &Connection) {
    let unmapped_models: Vec<String> = {
        let mut stmt = match conn
            .prepare("SELECT DISTINCT model FROM token_usage WHERE requested_model IS NULL")
        {
            Ok(s) => s,
            Err(_) => return,
        };
        let rows = match stmt.query_map([], |row| row.get::<_, String>(0)) {
            Ok(r) => r,
            Err(_) => return,
        };
        rows.filter_map(|r| r.ok()).collect()
    };

    if unmapped_models.is_empty() {
        return;
    }

    let default_custom = crate::proxy::config::default_custom_mapping();
    for original_model in unmapped_models {
        let routed_model = crate::proxy::common::model_mapping::resolve_model_route(
            &original_model,
            &default_custom,
        );

        // 如果原始模型与路由模型不同，说明历史记录存的是客户端原始名，需要迁移成：
        // model = routed_model (实际路由模型), requested_model = original_model (原始请求模型)
        // 如果相同，直接将 requested_model 置为 original_model
        let _ = conn.execute(
            "UPDATE token_usage SET model = ?1, requested_model = ?2 WHERE model = ?2 AND requested_model IS NULL",
            params![routed_model, original_model],
        );
    }
}

/// Record token usage from a request
pub fn record_usage(
    account_email: &str,
    model: &str,
    requested_model: Option<&str>,
    input_tokens: u32,
    output_tokens: u32,
    cached_tokens: u32,
    reasoning_tokens: u32,
    ttft_ms: Option<f64>,
    duration_ms: Option<f64>,
) -> Result<(), String> {
    let conn = connect_db()?;
    let timestamp = chrono::Local::now().timestamp();
    let total_tokens = input_tokens + output_tokens;

    // Insert into raw usage table
    conn.execute(
        "INSERT INTO token_usage (timestamp, account_email, model, requested_model, input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens, ttft_ms, duration_ms)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![timestamp, account_email, model, requested_model, input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens, ttft_ms, duration_ms],
    ).map_err(|e| e.to_string())?;

    let hour_bucket = chrono::Local::now().format("%Y-%m-%d %H:00").to_string();
    conn.execute(
        "INSERT INTO token_stats_hourly (hour_bucket, account_email, total_input_tokens, total_output_tokens, total_cached_tokens, total_reasoning_tokens, total_tokens, request_count)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 1)
         ON CONFLICT(hour_bucket, account_email) DO UPDATE SET
            total_input_tokens = total_input_tokens + ?3,
            total_output_tokens = total_output_tokens + ?4,
            total_cached_tokens = total_cached_tokens + ?5,
            total_reasoning_tokens = total_reasoning_tokens + ?6,
            total_tokens = total_tokens + ?7,
            request_count = request_count + 1",
        params![hour_bucket, account_email, input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

/// Attach current weekly usage without loading raw history or persisting derived totals.
pub(crate) fn populate_weekly_usage(accounts: &mut [crate::models::Account]) -> Result<(), String> {
    if !accounts.iter().any(|account| {
        account
            .quota
            .as_ref()
            .is_some_and(|q| q.quota_groups.is_some())
    }) {
        return Ok(());
    }
    let conn = connect_db()?;
    populate_weekly_usage_with_conn(&conn, accounts, chrono::Utc::now().timestamp())
}

fn populate_weekly_usage_with_conn(
    conn: &Connection,
    accounts: &mut [crate::models::Account],
    now: i64,
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "SELECT COALESCE(SUM(input_tokens + output_tokens), 0) FROM token_usage
         WHERE account_email = ?1 AND timestamp >= ?2 AND timestamp < ?3 AND timestamp <= ?4
         AND ((?5 = 0 AND model LIKE 'gemini%')
           OR (?5 = 1 AND (model LIKE 'claude%' OR model LIKE 'gpt%')))",
        )
        .map_err(|e| e.to_string())?;
    for account in accounts {
        let Some(groups) = account
            .quota
            .as_mut()
            .and_then(|quota| quota.quota_groups.as_mut())
        else {
            continue;
        };
        for group in groups {
            let name = group.display_name.to_lowercase();
            for bucket in &mut group.buckets {
                bucket.cycle_tokens = None;
                let Some((start, end)) = bucket.weekly_cycle_bounds(now) else {
                    continue;
                };
                let id = bucket.bucket_id.to_lowercase();
                let third_party =
                    name.contains("claude") || name.contains("gpt") || id.contains("3p");
                if !third_party && !name.contains("gemini") && !id.contains("gemini") {
                    continue;
                }
                bucket.cycle_tokens = Some(
                    stmt.query_row(
                        params![account.email, start, end, now, third_party],
                        |row| row.get(0),
                    )
                    .map_err(|e| e.to_string())?,
                );
            }
        }
    }
    Ok(())
}

/// Get minute-level aggregated stats for a time range
pub fn get_minute_stats(
    minutes: i64,
    step_minutes: i64,
) -> Result<Vec<TokenStatsAggregated>, String> {
    let conn = connect_db()?;
    let step_secs = step_minutes.max(1) * 60;
    let cutoff = if minutes <= 0 {
        0
    } else {
        chrono::Local::now().timestamp() - (minutes * 60)
    };

    let mut stmt = conn
        .prepare(
            "SELECT strftime('%Y-%m-%d %H:%M', datetime(timestamp - (timestamp % ?2), 'unixepoch', 'localtime')) as minute_bucket, 
                SUM(input_tokens) as input, 
                SUM(output_tokens) as output,
                SUM(cached_tokens) as cached,
                SUM(COALESCE(reasoning_tokens, 0)) as reasoning,
                SUM(total_tokens) as total,
                COUNT(*) as count
         FROM token_usage 
         WHERE timestamp >= ?1
         GROUP BY minute_bucket
         ORDER BY minute_bucket ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![cutoff, step_secs], |row| {
            Ok(TokenStatsAggregated {
                period: row.get(0)?,
                total_input_tokens: row.get(1)?,
                total_output_tokens: row.get(2)?,
                total_cached_tokens: row.get(3)?,
                total_reasoning_tokens: row.get(4)?,
                total_tokens: row.get(5)?,
                request_count: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

/// Get hourly aggregated stats for a time range
pub fn get_hourly_stats(hours: i64) -> Result<Vec<TokenStatsAggregated>, String> {
    let conn = connect_db()?;
    let cutoff_bucket = if hours <= 0 {
        String::new()
    } else {
        let cutoff = chrono::Local::now() - chrono::Duration::hours(hours);
        cutoff.format("%Y-%m-%d %H:00").to_string()
    };

    let mut stmt = conn
        .prepare(
            "SELECT hour_bucket, 
                SUM(total_input_tokens) as input, 
                SUM(total_output_tokens) as output,
                SUM(total_cached_tokens) as cached,
                SUM(total_reasoning_tokens) as reasoning,
                SUM(total_tokens) as total,
                SUM(request_count) as count
         FROM token_stats_hourly 
         WHERE hour_bucket >= ?1
         GROUP BY hour_bucket
         ORDER BY hour_bucket ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([cutoff_bucket], |row| {
            Ok(TokenStatsAggregated {
                period: row.get(0)?,
                total_input_tokens: row.get(1)?,
                total_output_tokens: row.get(2)?,
                total_cached_tokens: row.get(3)?,
                total_reasoning_tokens: row.get(4)?,
                total_tokens: row.get(5)?,
                request_count: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

/// Get daily aggregated stats for a time range
pub fn get_daily_stats(days: i64) -> Result<Vec<TokenStatsAggregated>, String> {
    let conn = connect_db()?;
    let cutoff_bucket = if days <= 0 {
        String::new()
    } else {
        let cutoff = chrono::Local::now() - chrono::Duration::days(days);
        cutoff.format("%Y-%m-%d").to_string()
    };

    let mut stmt = conn
        .prepare(
            "SELECT substr(hour_bucket, 1, 10) as day_bucket, 
                SUM(total_input_tokens) as input, 
                SUM(total_output_tokens) as output,
                SUM(total_cached_tokens) as cached,
                SUM(total_reasoning_tokens) as reasoning,
                SUM(total_tokens) as total,
                SUM(request_count) as count
         FROM token_stats_hourly 
         WHERE substr(hour_bucket, 1, 10) >= ?1
         GROUP BY day_bucket
         ORDER BY day_bucket ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([cutoff_bucket], |row| {
            Ok(TokenStatsAggregated {
                period: row.get(0)?,
                total_input_tokens: row.get(1)?,
                total_output_tokens: row.get(2)?,
                total_cached_tokens: row.get(3)?,
                total_reasoning_tokens: row.get(4)?,
                total_tokens: row.get(5)?,
                request_count: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

/// Get weekly aggregated stats
pub fn get_weekly_stats(weeks: i64) -> Result<Vec<TokenStatsAggregated>, String> {
    let conn = connect_db()?;
    let cutoff_timestamp = if weeks <= 0 {
        0
    } else {
        let cutoff = chrono::Local::now() - chrono::Duration::weeks(weeks);
        cutoff.timestamp()
    };

    let mut stmt = conn
        .prepare(
            "SELECT strftime('%Y-W%W', datetime(timestamp, 'unixepoch', 'localtime')) as week_bucket,
                SUM(input_tokens) as input, 
                SUM(output_tokens) as output,
                SUM(cached_tokens) as cached,
                SUM(reasoning_tokens) as reasoning,
                SUM(total_tokens) as total,
                COUNT(*) as count
         FROM token_usage 
         WHERE timestamp >= ?1
         GROUP BY week_bucket
         ORDER BY week_bucket ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([cutoff_timestamp], |row| {
            Ok(TokenStatsAggregated {
                period: row.get(0)?,
                total_input_tokens: row.get(1)?,
                total_output_tokens: row.get(2)?,
                total_cached_tokens: row.get(3)?,
                total_reasoning_tokens: row.get(4)?,
                total_tokens: row.get(5)?,
                request_count: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

/// Get per-account statistics for a time range
pub fn get_account_stats(hours: i64) -> Result<Vec<AccountTokenStats>, String> {
    let conn = connect_db()?;
    let cutoff_bucket = if hours <= 0 {
        String::new()
    } else {
        let cutoff = chrono::Local::now() - chrono::Duration::hours(hours);
        cutoff.format("%Y-%m-%d %H:00").to_string()
    };

    let mut stmt = conn
        .prepare(
            "SELECT account_email,
                SUM(total_input_tokens) as input, 
                SUM(total_output_tokens) as output,
                SUM(total_cached_tokens) as cached,
                SUM(total_reasoning_tokens) as reasoning,
                SUM(total_tokens) as total,
                SUM(request_count) as count
         FROM token_stats_hourly 
         WHERE hour_bucket >= ?1
         GROUP BY account_email
         ORDER BY total DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([cutoff_bucket], |row| {
            Ok(AccountTokenStats {
                account_email: row.get(0)?,
                total_input_tokens: row.get(1)?,
                total_output_tokens: row.get(2)?,
                total_cached_tokens: row.get(3)?,
                total_reasoning_tokens: row.get(4)?,
                total_tokens: row.get(5)?,
                request_count: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

/// Get summary statistics for a time range
pub fn get_summary_stats(hours: i64) -> Result<TokenStatsSummary, String> {
    let conn = connect_db()?;
    let cutoff_bucket = if hours <= 0 {
        String::new()
    } else {
        let cutoff = chrono::Local::now() - chrono::Duration::hours(hours);
        cutoff.format("%Y-%m-%d %H:00").to_string()
    };

    let (total_input, total_output, total_cached, total_reasoning, total, requests): (
        u64,
        u64,
        u64,
        u64,
        u64,
        u64,
    ) = conn
        .query_row(
            "SELECT COALESCE(SUM(total_input_tokens), 0),
                COALESCE(SUM(total_output_tokens), 0),
                COALESCE(SUM(total_cached_tokens), 0),
                COALESCE(SUM(total_reasoning_tokens), 0),
                COALESCE(SUM(total_tokens), 0),
                COALESCE(SUM(request_count), 0)
         FROM token_stats_hourly 
         WHERE hour_bucket >= ?1",
            [&cutoff_bucket],
            |row| {
                Ok((
                    row.get(0)?,
                    row.get(1)?,
                    row.get(2)?,
                    row.get(3)?,
                    row.get(4)?,
                    row.get(5)?,
                ))
            },
        )
        .map_err(|e| e.to_string())?;

    let unique_accounts: u64 = conn
        .query_row(
            "SELECT COUNT(DISTINCT account_email) FROM token_stats_hourly WHERE hour_bucket >= ?1",
            [&cutoff_bucket],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let cutoff_timestamp = if hours <= 0 {
        0
    } else {
        chrono::Local::now().timestamp() - (hours * 3600)
    };

    let avg_ttft_ms: Option<f64> = conn
        .query_row(
            "SELECT ROUND(AVG(ttft_ms), 1) FROM token_usage WHERE timestamp >= ?1 AND ttft_ms IS NOT NULL AND ttft_ms > 0",
            [cutoff_timestamp],
            |row| row.get(0),
        )
        .unwrap_or(None);

    let avg_output_tps: Option<f64> = conn
        .query_row(
            "SELECT ROUND(AVG(CAST(output_tokens AS REAL) / (duration_ms / 1000.0)), 2) FROM token_usage WHERE timestamp >= ?1 AND duration_ms IS NOT NULL AND duration_ms > 0 AND output_tokens > 0",
            [cutoff_timestamp],
            |row| row.get(0),
        )
        .unwrap_or(None);

    Ok(TokenStatsSummary {
        total_input_tokens: total_input,
        total_output_tokens: total_output,
        total_cached_tokens: total_cached,
        total_reasoning_tokens: total_reasoning,
        total_tokens: total,
        total_requests: requests,
        unique_accounts,
        avg_ttft_ms,
        avg_output_tps,
    })
}

fn model_column_expr(view_mode: Option<&str>) -> &'static str {
    match view_mode {
        Some("requested") => "COALESCE(NULLIF(requested_model, ''), model)",
        _ => "model",
    }
}

pub fn get_model_stats(
    hours: i64,
    view_mode: Option<&str>,
) -> Result<Vec<ModelTokenStats>, String> {
    let conn = connect_db()?;
    let cutoff = if hours <= 0 {
        0
    } else {
        chrono::Local::now().timestamp() - (hours * 3600)
    };

    let model_expr = model_column_expr(view_mode);
    let sql = format!(
        "SELECT {col} as agg_model,
                SUM(input_tokens) as input,
                SUM(output_tokens) as output,
                SUM(cached_tokens) as cached,
                SUM(reasoning_tokens) as reasoning,
                SUM(total_tokens) as total,
                COUNT(*) as count,
                ROUND(AVG(CASE WHEN ttft_ms > 0 THEN ttft_ms ELSE NULL END), 1) as avg_ttft,
                ROUND(AVG(CASE WHEN duration_ms > 0 AND output_tokens > 0 THEN CAST(output_tokens AS REAL) / (duration_ms / 1000.0) ELSE NULL END), 2) as avg_tps
         FROM token_usage
         WHERE timestamp >= ?1
         GROUP BY agg_model
         ORDER BY total DESC",
        col = model_expr
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([cutoff], |row| {
            Ok(ModelTokenStats {
                model: row.get(0)?,
                total_input_tokens: row.get(1)?,
                total_output_tokens: row.get(2)?,
                total_cached_tokens: row.get(3)?,
                total_reasoning_tokens: row.get(4)?,
                total_tokens: row.get(5)?,
                request_count: row.get(6)?,
                avg_ttft_ms: row.get(7)?,
                avg_output_tps: row.get(8)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        result.push(row.map_err(|e| e.to_string())?);
    }
    Ok(result)
}

pub fn get_model_trend_minute(
    minutes: i64,
    step_minutes: i64,
    view_mode: Option<&str>,
) -> Result<Vec<ModelTrendPoint>, String> {
    let conn = connect_db()?;
    let step_secs = step_minutes.max(1) * 60;
    let cutoff = if minutes <= 0 {
        0
    } else {
        chrono::Local::now().timestamp() - (minutes * 60)
    };

    let model_expr = model_column_expr(view_mode);
    let sql = format!(
        "SELECT strftime('%Y-%m-%d %H:%M', datetime(timestamp - (timestamp % ?2), 'unixepoch', 'localtime')) as minute_bucket,
                {col} as agg_model,
                SUM(total_tokens) as total
         FROM token_usage
         WHERE timestamp >= ?1
         GROUP BY minute_bucket, agg_model
         ORDER BY minute_bucket ASC",
        col = model_expr
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let mut trend_map: std::collections::BTreeMap<String, std::collections::HashMap<String, u64>> =
        std::collections::BTreeMap::new();

    let rows = stmt
        .query_map(params![cutoff, step_secs], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (period, model, total) = row.map_err(|e| e.to_string())?;
        trend_map.entry(period).or_default().insert(model, total);
    }

    Ok(trend_map
        .into_iter()
        .map(|(period, model_data)| ModelTrendPoint { period, model_data })
        .collect())
}

pub fn get_model_trend_hourly(
    hours: i64,
    view_mode: Option<&str>,
) -> Result<Vec<ModelTrendPoint>, String> {
    let conn = connect_db()?;
    let cutoff = if hours <= 0 {
        0
    } else {
        chrono::Local::now().timestamp() - (hours * 3600)
    };

    let model_expr = model_column_expr(view_mode);
    let sql = format!(
        "SELECT strftime('%Y-%m-%d %H:00', datetime(timestamp, 'unixepoch', 'localtime')) as hour_bucket,
                {col} as agg_model,
                SUM(total_tokens) as total
         FROM token_usage
         WHERE timestamp >= ?1
         GROUP BY hour_bucket, agg_model
         ORDER BY hour_bucket ASC",
        col = model_expr
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let mut trend_map: std::collections::BTreeMap<String, std::collections::HashMap<String, u64>> =
        std::collections::BTreeMap::new();

    let rows = stmt
        .query_map([cutoff], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (period, model, total) = row.map_err(|e| e.to_string())?;
        trend_map.entry(period).or_default().insert(model, total);
    }

    Ok(trend_map
        .into_iter()
        .map(|(period, model_data)| ModelTrendPoint { period, model_data })
        .collect())
}

pub fn get_model_trend_daily(
    days: i64,
    view_mode: Option<&str>,
) -> Result<Vec<ModelTrendPoint>, String> {
    let conn = connect_db()?;
    let cutoff = if days <= 0 {
        0
    } else {
        chrono::Local::now().timestamp() - (days * 24 * 3600)
    };

    let model_expr = model_column_expr(view_mode);
    let sql = format!(
        "SELECT strftime('%Y-%m-%d', datetime(timestamp, 'unixepoch', 'localtime')) as day_bucket,
                {col} as agg_model,
                SUM(total_tokens) as total
         FROM token_usage
         WHERE timestamp >= ?1
         GROUP BY day_bucket, agg_model
         ORDER BY day_bucket ASC",
        col = model_expr
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    let mut trend_map: std::collections::BTreeMap<String, std::collections::HashMap<String, u64>> =
        std::collections::BTreeMap::new();

    let rows = stmt
        .query_map([cutoff], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (period, model, total) = row.map_err(|e| e.to_string())?;
        trend_map.entry(period).or_default().insert(model, total);
    }

    Ok(trend_map
        .into_iter()
        .map(|(period, model_data)| ModelTrendPoint { period, model_data })
        .collect())
}

pub fn get_account_trend_minute(
    minutes: i64,
    step_minutes: i64,
) -> Result<Vec<AccountTrendPoint>, String> {
    let conn = connect_db()?;
    let step_secs = step_minutes.max(1) * 60;
    let cutoff = if minutes <= 0 {
        0
    } else {
        chrono::Local::now().timestamp() - (minutes * 60)
    };

    let mut stmt = conn
        .prepare(
            "SELECT strftime('%Y-%m-%d %H:%M', datetime(timestamp - (timestamp % ?2), 'unixepoch', 'localtime')) as minute_bucket,
                account_email,
                SUM(total_tokens) as total
         FROM token_usage
         WHERE timestamp >= ?1
         GROUP BY minute_bucket, account_email
         ORDER BY minute_bucket ASC",
        )
        .map_err(|e| e.to_string())?;

    let mut trend_map: std::collections::BTreeMap<String, std::collections::HashMap<String, u64>> =
        std::collections::BTreeMap::new();

    let rows = stmt
        .query_map(params![cutoff, step_secs], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (period, account, total) = row.map_err(|e| e.to_string())?;
        trend_map.entry(period).or_default().insert(account, total);
    }

    Ok(trend_map
        .into_iter()
        .map(|(period, account_data)| AccountTrendPoint {
            period,
            account_data,
        })
        .collect())
}

pub fn get_account_trend_hourly(hours: i64) -> Result<Vec<AccountTrendPoint>, String> {
    let conn = connect_db()?;
    let cutoff = if hours <= 0 {
        0
    } else {
        chrono::Local::now().timestamp() - (hours * 3600)
    };

    let mut stmt = conn
        .prepare(
            "SELECT strftime('%Y-%m-%d %H:00', datetime(timestamp, 'unixepoch', 'localtime')) as hour_bucket,
                account_email,
                SUM(total_tokens) as total
         FROM token_usage
         WHERE timestamp >= ?1
         GROUP BY hour_bucket, account_email
         ORDER BY hour_bucket ASC",
        )
        .map_err(|e| e.to_string())?;

    let mut trend_map: std::collections::BTreeMap<String, std::collections::HashMap<String, u64>> =
        std::collections::BTreeMap::new();

    let rows = stmt
        .query_map([cutoff], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (period, account, total) = row.map_err(|e| e.to_string())?;
        trend_map.entry(period).or_default().insert(account, total);
    }

    Ok(trend_map
        .into_iter()
        .map(|(period, account_data)| AccountTrendPoint {
            period,
            account_data,
        })
        .collect())
}

pub fn get_account_trend_daily(days: i64) -> Result<Vec<AccountTrendPoint>, String> {
    let conn = connect_db()?;
    let cutoff = if days <= 0 {
        0
    } else {
        chrono::Local::now().timestamp() - (days * 24 * 3600)
    };

    let mut stmt = conn
        .prepare(
            "SELECT strftime('%Y-%m-%d', datetime(timestamp, 'unixepoch', 'localtime')) as day_bucket,
                account_email,
                SUM(total_tokens) as total
         FROM token_usage
         WHERE timestamp >= ?1
         GROUP BY day_bucket, account_email
         ORDER BY day_bucket ASC",
        )
        .map_err(|e| e.to_string())?;

    let mut trend_map: std::collections::BTreeMap<String, std::collections::HashMap<String, u64>> =
        std::collections::BTreeMap::new();

    let rows = stmt
        .query_map([cutoff], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, u64>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (period, account, total) = row.map_err(|e| e.to_string())?;
        trend_map.entry(period).or_default().insert(account, total);
    }

    Ok(trend_map
        .into_iter()
        .map(|(period, account_data)| AccountTrendPoint {
            period,
            account_data,
        })
        .collect())
}

/// Calculate model output speed statistics (TPS & TTFT), including summary, per-model stats, and time-bucketed trend series
pub fn get_model_speed_stats(
    hours: i64,
    buckets: Option<i64>,
    view_mode: Option<&str>,
) -> Result<ModelSpeedResponse, String> {
    let conn = connect_db()?;
    get_model_speed_stats_with_conn(&conn, hours, buckets, view_mode)
}

pub(crate) fn get_model_speed_stats_with_conn(
    conn: &Connection,
    hours: i64,
    buckets: Option<i64>,
    view_mode: Option<&str>,
) -> Result<ModelSpeedResponse, String> {
    let now = chrono::Local::now().timestamp();
    let (start_ts, end_ts) = if hours <= 0 {
        let min_ts: Option<i64> = conn
            .query_row(
                "SELECT MIN(timestamp) FROM token_usage WHERE duration_ms > 0 AND output_tokens > 0",
                [],
                |r| r.get(0),
            )
            .unwrap_or(None);
        let start = min_ts.unwrap_or(now - 86400);
        let valid_start = if start >= now { now - 3600 } else { start };
        (valid_start, now)
    } else {
        (now - (hours * 3600), now)
    };

    let num_buckets = buckets.unwrap_or(8).clamp(2, 60) as usize;
    let total_span = (end_ts - start_ts).max(1) as f64;
    let bucket_span = total_span / (num_buckets as f64);

    let model_expr = model_column_expr(view_mode);
    let sql = format!(
        "SELECT timestamp, {col} as agg_model, output_tokens, duration_ms, ttft_ms
         FROM token_usage
         WHERE timestamp >= ?1 AND timestamp <= ?2 AND duration_ms IS NOT NULL AND duration_ms > 0 AND output_tokens > 0
         ORDER BY timestamp ASC",
        col = model_expr
    );

    struct RawSpeedSample {
        timestamp: i64,
        model: String,
        output_tokens: u64,
        duration_ms: f64,
        ttft_ms: Option<f64>,
        tps: f64,
    }

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![start_ts, end_ts], |row| {
            let ts: i64 = row.get(0)?;
            let model: String = row.get(1)?;
            let output: u64 = row.get(2)?;
            let dur: f64 = row.get(3)?;
            let ttft: Option<f64> = row.get(4)?;
            let tps = if dur > 0.0 {
                (output as f64) / (dur / 1000.0)
            } else {
                0.0
            };
            Ok(RawSpeedSample {
                timestamp: ts,
                model,
                output_tokens: output,
                duration_ms: dur,
                ttft_ms: ttft,
                tps,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut samples: Vec<RawSpeedSample> = Vec::new();
    for r in rows {
        samples.push(r.map_err(|e| e.to_string())?);
    }

    // Mid timestamp for dumbbell comparison (first half vs second half)
    let mid_ts = start_ts + (end_ts - start_ts) / 2;

    // Per-model grouping
    struct ModelAccumulator {
        sample_count: u64,
        total_output_tokens: u64,
        sum_tps: f64,
        sum_duration_sec: f64,
        min_tps: f64,
        max_tps: f64,
        ttft_samples: Vec<f64>,
        first_half_tps_sum: f64,
        first_half_count: u64,
        second_half_tps_sum: f64,
        second_half_count: u64,
    }

    let mut model_acc: std::collections::HashMap<String, ModelAccumulator> =
        std::collections::HashMap::new();

    // Global summary aggregators
    let mut global_total_samples = 0u64;
    let mut global_total_output_tokens = 0u64;
    let mut global_sum_tps = 0.0f64;
    let mut global_sum_duration_sec = 0.0f64;
    let mut global_ttft_samples: Vec<f64> = Vec::new();

    // Pre-create time buckets
    let mut bucket_list: Vec<ModelSpeedBucket> = Vec::with_capacity(num_buckets);
    for i in 0..num_buckets {
        let b_start = start_ts + (i as f64 * bucket_span).round() as i64;
        let b_end = if i == num_buckets - 1 {
            end_ts
        } else {
            start_ts + ((i + 1) as f64 * bucket_span).round() as i64
        };
        let label = chrono::DateTime::from_timestamp(b_start, 0)
            .map(|dt| {
                dt.with_timezone(&chrono::Local)
                    .format("%m-%d %H:%M")
                    .to_string()
            })
            .unwrap_or_else(|| format!("B{}", i + 1));
        bucket_list.push(ModelSpeedBucket {
            label,
            start_ts: b_start,
            end_ts: b_end,
            models: std::collections::HashMap::new(),
        });
    }

    // Helper for bucket accumulation: (bucket_idx, model) -> (sum_tps, count, tokens)
    let mut bucket_accum: std::collections::HashMap<(usize, String), (f64, u64, u64)> =
        std::collections::HashMap::new();

    for s in &samples {
        global_total_samples += 1;
        global_total_output_tokens += s.output_tokens;
        global_sum_tps += s.tps;
        global_sum_duration_sec += s.duration_ms / 1000.0;
        if let Some(t) = s.ttft_ms {
            if t > 0.0 {
                global_ttft_samples.push(t);
            }
        }

        let acc = model_acc
            .entry(s.model.clone())
            .or_insert_with(|| ModelAccumulator {
                sample_count: 0,
                total_output_tokens: 0,
                sum_tps: 0.0,
                sum_duration_sec: 0.0,
                min_tps: f64::MAX,
                max_tps: 0.0,
                ttft_samples: Vec::new(),
                first_half_tps_sum: 0.0,
                first_half_count: 0,
                second_half_tps_sum: 0.0,
                second_half_count: 0,
            });

        acc.sample_count += 1;
        acc.total_output_tokens += s.output_tokens;
        acc.sum_tps += s.tps;
        acc.sum_duration_sec += s.duration_ms / 1000.0;
        if s.tps < acc.min_tps {
            acc.min_tps = s.tps;
        }
        if s.tps > acc.max_tps {
            acc.max_tps = s.tps;
        }
        if let Some(t) = s.ttft_ms {
            if t > 0.0 {
                acc.ttft_samples.push(t);
            }
        }

        if s.timestamp < mid_ts {
            acc.first_half_tps_sum += s.tps;
            acc.first_half_count += 1;
        } else {
            acc.second_half_tps_sum += s.tps;
            acc.second_half_count += 1;
        }

        // Assign to bucket
        let mut b_idx = if bucket_span > 0.0 {
            ((s.timestamp - start_ts) as f64 / bucket_span).floor() as usize
        } else {
            0
        };
        if b_idx >= num_buckets {
            b_idx = num_buckets - 1;
        }
        let b_entry = bucket_accum
            .entry((b_idx, s.model.clone()))
            .or_insert((0.0, 0, 0));
        b_entry.0 += s.tps;
        b_entry.1 += 1;
        b_entry.2 += s.output_tokens;
    }

    // Populate buckets
    for ((b_idx, model), (sum_tps, count, tokens)) in bucket_accum {
        if b_idx < bucket_list.len() && count > 0 {
            let avg = (sum_tps / count as f64 * 100.0).round() / 100.0;
            bucket_list[b_idx].models.insert(
                model,
                ModelSpeedBucketPoint {
                    avg_tps: avg,
                    sample_count: count,
                    total_output_tokens: tokens,
                },
            );
        }
    }

    let mut model_items: Vec<ModelSpeedItem> = Vec::new();
    for (model, mut acc) in model_acc {
        let avg_tps = if acc.sample_count > 0 {
            (acc.sum_tps / acc.sample_count as f64 * 100.0).round() / 100.0
        } else {
            0.0
        };
        let weighted_tps = if acc.sum_duration_sec > 0.0 {
            (acc.total_output_tokens as f64 / acc.sum_duration_sec * 100.0).round() / 100.0
        } else {
            0.0
        };
        let min_tps = if acc.min_tps == f64::MAX {
            0.0
        } else {
            (acc.min_tps * 100.0).round() / 100.0
        };
        let max_tps = (acc.max_tps * 100.0).round() / 100.0;

        let avg_ttft_ms = if !acc.ttft_samples.is_empty() {
            let sum: f64 = acc.ttft_samples.iter().sum();
            Some((sum / acc.ttft_samples.len() as f64 * 10.0).round() / 10.0)
        } else {
            None
        };

        let p95_ttft_ms = if !acc.ttft_samples.is_empty() {
            acc.ttft_samples
                .sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            let rank = (acc.ttft_samples.len() as f64 * 0.95).ceil() as usize;
            let idx = (rank.saturating_sub(1)).min(acc.ttft_samples.len() - 1);
            Some((acc.ttft_samples[idx] * 10.0).round() / 10.0)
        } else {
            None
        };

        let first_half_tps = if acc.first_half_count > 0 {
            Some((acc.first_half_tps_sum / acc.first_half_count as f64 * 100.0).round() / 100.0)
        } else {
            None
        };

        let second_half_tps = if acc.second_half_count > 0 {
            Some((acc.second_half_tps_sum / acc.second_half_count as f64 * 100.0).round() / 100.0)
        } else {
            None
        };

        let tps_delta = match (first_half_tps, second_half_tps) {
            (Some(f), Some(s)) => Some(((s - f) * 100.0).round() / 100.0),
            _ => None,
        };

        model_items.push(ModelSpeedItem {
            model,
            sample_count: acc.sample_count,
            total_output_tokens: acc.total_output_tokens,
            avg_tps,
            weighted_tps,
            min_tps,
            max_tps,
            avg_ttft_ms,
            p95_ttft_ms,
            first_half_tps,
            second_half_tps,
            tps_delta,
        });
    }

    // Sort models by sample_count DESC, then total_output_tokens DESC
    model_items.sort_by(|a, b| {
        b.sample_count
            .cmp(&a.sample_count)
            .then_with(|| b.total_output_tokens.cmp(&a.total_output_tokens))
    });

    let global_avg_tps = if global_total_samples > 0 {
        Some((global_sum_tps / global_total_samples as f64 * 100.0).round() / 100.0)
    } else {
        None
    };

    let global_weighted_tps = if global_sum_duration_sec > 0.0 {
        Some((global_total_output_tokens as f64 / global_sum_duration_sec * 100.0).round() / 100.0)
    } else {
        None
    };

    let global_avg_ttft = if !global_ttft_samples.is_empty() {
        let sum: f64 = global_ttft_samples.iter().sum();
        Some((sum / global_ttft_samples.len() as f64 * 10.0).round() / 10.0)
    } else {
        None
    };

    let global_p95_ttft = if !global_ttft_samples.is_empty() {
        global_ttft_samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let rank = (global_ttft_samples.len() as f64 * 0.95).ceil() as usize;
        let idx = (rank.saturating_sub(1)).min(global_ttft_samples.len() - 1);
        Some((global_ttft_samples[idx] * 10.0).round() / 10.0)
    } else {
        None
    };

    let summary = ModelSpeedGlobalSummary {
        total_samples: global_total_samples,
        total_output_tokens: global_total_output_tokens,
        avg_tps: global_avg_tps,
        weighted_tps: global_weighted_tps,
        avg_ttft_ms: global_avg_ttft,
        p95_ttft_ms: global_p95_ttft,
    };

    Ok(ModelSpeedResponse {
        summary,
        models: model_items,
        buckets: bucket_list,
    })
}

/// Query token distribution per model and account
pub fn get_model_account_distribution(
    hours: i64,
    view_mode: Option<&str>,
) -> Result<ModelAccountDistributionResponse, String> {
    let conn = connect_db()?;
    get_model_account_distribution_with_conn(&conn, hours, view_mode)
}

pub(crate) fn get_model_account_distribution_with_conn(
    conn: &Connection,
    hours: i64,
    view_mode: Option<&str>,
) -> Result<ModelAccountDistributionResponse, String> {
    let cutoff = if hours <= 0 {
        0
    } else {
        chrono::Local::now().timestamp() - (hours * 3600)
    };

    let model_expr = model_column_expr(view_mode);
    let sql = format!(
        "SELECT {col} as agg_model,
                account_email,
                COUNT(*) as request_count,
                COALESCE(SUM(input_tokens), 0) as input_tokens,
                COALESCE(SUM(output_tokens), 0) as output_tokens,
                COALESCE(SUM(cached_tokens), 0) as cached_tokens,
                COALESCE(SUM(total_tokens), 0) as total_tokens
         FROM token_usage
         WHERE timestamp >= ?1
         GROUP BY agg_model, account_email",
        col = model_expr
    );

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    struct RawAccountRow {
        account_email: String,
        request_count: u64,
        input_tokens: u64,
        output_tokens: u64,
        cached_tokens: u64,
        total_tokens: u64,
    }

    let mut model_map: std::collections::BTreeMap<String, Vec<RawAccountRow>> =
        std::collections::BTreeMap::new();

    let rows = stmt
        .query_map([cutoff], |row| {
            let model = row
                .get::<_, Option<String>>(0)?
                .unwrap_or_else(|| "unknown".to_string());
            let account_email = row
                .get::<_, Option<String>>(1)?
                .unwrap_or_else(|| "unknown".to_string());
            let request_count = row.get::<_, i64>(2).unwrap_or(0).max(0) as u64;
            let input_tokens = row.get::<_, i64>(3).unwrap_or(0).max(0) as u64;
            let output_tokens = row.get::<_, i64>(4).unwrap_or(0).max(0) as u64;
            let cached_tokens = row.get::<_, i64>(5).unwrap_or(0).max(0) as u64;
            let total_tokens = row.get::<_, i64>(6).unwrap_or(0).max(0) as u64;

            Ok((
                model,
                RawAccountRow {
                    account_email,
                    request_count,
                    input_tokens,
                    output_tokens,
                    cached_tokens,
                    total_tokens,
                },
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (model, raw_acc) = row.map_err(|e| e.to_string())?;
        model_map.entry(model).or_default().push(raw_acc);
    }

    let mut models = Vec::new();
    let mut grand_total_requests: u64 = 0;
    let mut grand_total_tokens: u64 = 0;

    for (model, raw_accounts) in model_map {
        let model_total_requests: u64 = raw_accounts.iter().map(|a| a.request_count).sum();
        let model_total_tokens: u64 = raw_accounts.iter().map(|a| a.total_tokens).sum();

        grand_total_requests += model_total_requests;
        grand_total_tokens += model_total_tokens;

        let mut accounts: Vec<AccountDistributionSlice> = raw_accounts
            .into_iter()
            .map(|a| {
                let request_share_pct = if model_total_requests > 0 {
                    (((a.request_count as f64 / model_total_requests as f64) * 10000.0).round())
                        / 100.0
                } else {
                    0.0
                }
                .clamp(0.0, 100.0);

                let token_share_pct = if model_total_tokens > 0 {
                    (((a.total_tokens as f64 / model_total_tokens as f64) * 10000.0).round())
                        / 100.0
                } else {
                    0.0
                }
                .clamp(0.0, 100.0);

                AccountDistributionSlice {
                    account_email: a.account_email,
                    request_count: a.request_count,
                    input_tokens: a.input_tokens,
                    output_tokens: a.output_tokens,
                    cached_tokens: a.cached_tokens,
                    total_tokens: a.total_tokens,
                    request_share_pct,
                    token_share_pct,
                }
            })
            .collect();

        accounts.sort_by(|a, b| {
            b.total_tokens
                .cmp(&a.total_tokens)
                .then_with(|| b.request_count.cmp(&a.request_count))
                .then_with(|| a.account_email.cmp(&b.account_email))
        });

        models.push(ModelAccountDistributionItem {
            model,
            total_requests: model_total_requests,
            total_tokens: model_total_tokens,
            accounts,
        });
    }

    models.sort_by(|a, b| {
        b.total_tokens
            .cmp(&a.total_tokens)
            .then_with(|| b.total_requests.cmp(&a.total_requests))
            .then_with(|| a.model.cmp(&b.model))
    });

    Ok(ModelAccountDistributionResponse {
        total_requests: grand_total_requests,
        total_tokens: grand_total_tokens,
        models,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn weekly_snapshot(observed: i64, reset: i64, fraction: f64) -> crate::models::QuotaData {
        let iso = |seconds| {
            chrono::DateTime::from_timestamp(seconds, 0)
                .unwrap()
                .to_rfc3339()
        };
        serde_json::from_value(serde_json::json!({
            "models": [{"name": "claude-3-7-sonnet", "percentage": 100, "reset_time": "2026-11-08T00:00:00Z"}], "last_updated": observed,
            "quota_groups": [
                {"display_name": "Gemini Models", "buckets": [
                    {"bucket_id": "gemini-weekly", "window": "weekly", "remaining_fraction": fraction,
                     "reset_time": iso(reset), "observed_at": observed * 1000},
                    {"bucket_id": "gemini-5h", "window": "5h", "remaining_fraction": 1,
                     "reset_time": iso(reset), "observed_at": observed * 1000}
                ]},
                {"display_name": "Claude and GPT models", "buckets": [
                    {"bucket_id": "3p-weekly", "window": "weekly", "remaining_fraction": 0.5,
                     "reset_time": iso(reset + 100), "observed_at": observed * 1000}
                ]}
            ]
        })).unwrap()
    }

    #[test]
    fn weekly_usage_tracks_accounts_groups_and_official_reset_cycles() {
        let now = 1_700_000_000;
        let reset = now + 100;
        let start = reset - 7 * 86400;
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE token_usage (timestamp INTEGER, account_email TEXT,
            model TEXT, input_tokens INTEGER, output_tokens INTEGER, cached_tokens INTEGER);",
        )
        .unwrap();
        for (email, model, timestamp, input, output) in [
            ("a", "gemini-pro", start - 1, 900, 0),
            ("a", "gemini-pro", start, 11, 2),
            ("a", "claude-sonnet", start, 900, 0),
            ("a", "claude-sonnet", start + 100, 20, 0),
            ("a", "gpt-oss", now, 30, 0),
            ("a", "custom-alias", now, 900, 0),
            ("b", "gemini-pro", start - 51, 900, 0),
            ("b", "gemini-pro", start - 50, 7, 3),
            ("b", "gemini-pro", now, 900, 0),
            ("a", "gemini-pro", reset, 40, 0),
        ] {
            conn.execute(
                "INSERT INTO token_usage VALUES (?1, ?2, ?3, ?4, ?5, 99)",
                params![timestamp, email, model, input, output],
            )
            .unwrap();
        }
        let mut accounts: Vec<_> = [("a", reset), ("b", reset - 50)]
            .into_iter()
            .map(|(email, account_reset)| {
                let token = crate::models::TokenData::new(
                    String::new(),
                    String::new(),
                    0,
                    None,
                    None,
                    None,
                    false,
                    None,
                );
                let mut account = crate::models::Account::new(email.into(), email.into(), token);
                account.update_quota(weekly_snapshot(now, account_reset, 0.0));
                account
            })
            .collect();
        let buckets = |account: &crate::models::Account| {
            account
                .quota
                .as_ref()
                .unwrap()
                .quota_groups
                .as_ref()
                .unwrap()
                .iter()
                .flat_map(|group| group.buckets.iter().map(|bucket| bucket.cycle_tokens))
                .collect::<Vec<_>>()
        };
        populate_weekly_usage_with_conn(&conn, &mut accounts, now).unwrap();
        assert_eq!(buckets(&accounts[0]), vec![Some(13), None, Some(50)]);
        assert_eq!(buckets(&accounts[1]), vec![Some(910), None, Some(0)]);

        // Legacy persisted boundaries are ignored and omitted on the next serialization.
        let mut legacy = serde_json::to_value(&accounts[0]).unwrap();
        legacy["quota"]["quota_groups"][0]["buckets"][0]["cycle_start"] = now.into();
        accounts[0] = serde_json::from_value(legacy).unwrap();
        assert!(
            serde_json::to_value(&accounts[0]).unwrap()["quota"]["quota_groups"][0]["buckets"][0]
                .get("cycle_start")
                .is_none()
        );
        populate_weekly_usage_with_conn(&conn, &mut accounts, now).unwrap();
        assert_eq!(buckets(&accounts[0]), vec![Some(13), None, Some(50)]);

        // Small and large replenishments, refreshes and reloads keep the official interval.
        for (offset, fraction) in [(1, 0.000001), (2, 1.0), (3, 0.9)] {
            accounts[0].update_quota(weekly_snapshot(now + offset, reset, fraction));
            accounts[0] =
                serde_json::from_value(serde_json::to_value(&accounts[0]).unwrap()).unwrap();
            populate_weekly_usage_with_conn(&conn, &mut accounts, now + offset).unwrap();
            assert_eq!(buckets(&accounts[0]), vec![Some(13), None, Some(50)]);
            assert_eq!(buckets(&accounts[1]), vec![Some(910), None, Some(0)]);
        }
        // An older positive observation cannot move the boundary.
        accounts[0].update_quota(weekly_snapshot(now, reset + 10, 1.0));
        populate_weekly_usage_with_conn(&conn, &mut accounts, now + 3).unwrap();
        assert_eq!(buckets(&accounts[0]), vec![Some(13), None, Some(50)]);

        // A new official reset switches cycles and includes its exact new start.
        accounts[0].update_quota(weekly_snapshot(reset, reset + 7 * 86400, 1.0));
        populate_weekly_usage_with_conn(&conn, &mut accounts, reset).unwrap();
        assert_eq!(buckets(&accounts[0]), vec![Some(40), None, None]);
        let first = &accounts[0]
            .quota
            .as_ref()
            .unwrap()
            .quota_groups
            .as_ref()
            .unwrap()[0]
            .buckets[0];
        assert_eq!(
            first.weekly_cycle_bounds(reset),
            Some((reset, reset + 7 * 86400))
        );

        // Invalid and expired periods are unavailable, never fabricated zero totals.
        accounts[0]
            .quota
            .as_mut()
            .unwrap()
            .quota_groups
            .as_mut()
            .unwrap()[0]
            .buckets[0]
            .reset_time = "invalid".into();
        populate_weekly_usage_with_conn(&conn, &mut accounts, reset + 101).unwrap();
        assert_eq!(buckets(&accounts[0]), vec![None, None, Some(0)]);
        assert_eq!(buckets(&accounts[1]), vec![None, None, None]);
    }

    #[test]
    fn test_record_and_query() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE token_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                account_email TEXT NOT NULL,
                model TEXT NOT NULL,
                requested_model TEXT,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                cached_tokens INTEGER NOT NULL DEFAULT 0,
                reasoning_tokens INTEGER NOT NULL DEFAULT 0,
                total_tokens INTEGER NOT NULL DEFAULT 0
            );",
        )
        .unwrap();

        // 模拟：请求 claude-3-7-sonnet，实际路由到了 fable-5
        conn.execute(
            "INSERT INTO token_usage (timestamp, account_email, model, requested_model, input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![1_700_000_000, "user@example.com", "fable-5", "claude-3-7-sonnet", 100, 200, 0, 0, 300],
        ).unwrap();

        // 验证按 routed 聚合（默认）
        let expr_routed = model_column_expr(None);
        let sql_routed = format!("SELECT {expr_routed} as agg_model, SUM(total_tokens) FROM token_usage GROUP BY agg_model");
        let (m_routed, total_routed): (String, i64) = conn
            .query_row(&sql_routed, [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(m_routed, "fable-5");
        assert_eq!(total_routed, 300);

        // 验证按 requested 聚合
        let expr_requested = model_column_expr(Some("requested"));
        let sql_requested = format!("SELECT {expr_requested} as agg_model, SUM(total_tokens) FROM token_usage GROUP BY agg_model");
        let (m_req, total_req): (String, i64) = conn
            .query_row(&sql_requested, [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(m_req, "claude-3-7-sonnet");
        assert_eq!(total_req, 300);

        // 验证历史旧数据迁移逻辑 (针对 requested_model 为 NULL 的老数据)
        conn.execute(
            "INSERT INTO token_usage (timestamp, account_email, model, requested_model, input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens)
             VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, ?8)",
            params![1_700_000_100, "user@example.com", "claude-haiku-4-5-20251001", 50, 50, 0, 0, 100],
        ).unwrap();

        migrate_legacy_unmapped_models(&conn);

        // 迁移后，根据 default_custom_mapping，claude-haiku-4-5-20251001 实际路由为 gemini-3.8-flash-low，而 requested_model 为原始请求名
        let (m_migrated, req_migrated): (String, Option<String>) = conn
            .query_row(
                "SELECT model, requested_model FROM token_usage WHERE timestamp = 1700000100",
                [],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .unwrap();

        assert_eq!(m_migrated, "gemini-3.8-flash-low");
        assert_eq!(req_migrated.as_deref(), Some("claude-haiku-4-5-20251001"));
    }

    #[test]
    fn test_model_speed_stats_calculation() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE token_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                account_email TEXT NOT NULL,
                model TEXT NOT NULL,
                requested_model TEXT,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                cached_tokens INTEGER NOT NULL DEFAULT 0,
                reasoning_tokens INTEGER NOT NULL DEFAULT 0,
                total_tokens INTEGER NOT NULL DEFAULT 0,
                ttft_ms REAL,
                duration_ms REAL
            );",
        )
        .unwrap();

        let base_ts = 1_700_000_000;
        // Model A: sample 1: 100 tokens in 2000ms = 50 tps, ttft 200
        // Model A: sample 2: 200 tokens in 2000ms = 100 tps, ttft 400
        // Model B: sample 1: 300 tokens in 10000ms = 30 tps, ttft 600
        conn.execute(
            "INSERT INTO token_usage (timestamp, account_email, model, requested_model, input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens, ttft_ms, duration_ms)
             VALUES (?1, 'test@a.com', 'model-a', 'alias-a', 50, 100, 0, 0, 150, 200.0, 2000.0)",
            params![base_ts + 100],
        ).unwrap();

        conn.execute(
            "INSERT INTO token_usage (timestamp, account_email, model, requested_model, input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens, ttft_ms, duration_ms)
             VALUES (?1, 'test@a.com', 'model-a', 'alias-a', 50, 200, 0, 0, 250, 400.0, 2000.0)",
            params![base_ts + 500],
        ).unwrap();

        conn.execute(
            "INSERT INTO token_usage (timestamp, account_email, model, requested_model, input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens, ttft_ms, duration_ms)
             VALUES (?1, 'test@b.com', 'model-b', 'alias-b', 50, 300, 0, 0, 350, 600.0, 10000.0)",
            params![base_ts + 800],
        ).unwrap();

        let res = get_model_speed_stats_with_conn(&conn, 0, Some(4), None).unwrap();
        assert_eq!(res.summary.total_samples, 3);
        assert_eq!(res.summary.total_output_tokens, 600);
        // sample-mean tps: (50 + 100 + 30) / 3 = 60.0
        assert_eq!(res.summary.avg_tps, Some(60.0));
        // weighted tps: 600 / (2.0 + 2.0 + 10.0) = 600 / 14 = 42.86
        assert_eq!(res.summary.weighted_tps, Some(42.86));

        assert_eq!(res.models.len(), 2);
        let model_a = res.models.iter().find(|m| m.model == "model-a").unwrap();
        assert_eq!(model_a.sample_count, 2);
        assert_eq!(model_a.total_output_tokens, 300);
        assert_eq!(model_a.avg_tps, 75.0); // (50 + 100) / 2
        assert_eq!(model_a.weighted_tps, 75.0); // 300 / 4s = 75
        assert_eq!(model_a.min_tps, 50.0);
        assert_eq!(model_a.max_tps, 100.0);
        assert_eq!(model_a.avg_ttft_ms, Some(300.0));
    }

    #[test]
    fn test_model_account_distribution() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE token_usage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                timestamp INTEGER NOT NULL,
                account_email TEXT NOT NULL,
                model TEXT NOT NULL,
                requested_model TEXT,
                input_tokens INTEGER NOT NULL DEFAULT 0,
                output_tokens INTEGER NOT NULL DEFAULT 0,
                cached_tokens INTEGER NOT NULL DEFAULT 0,
                reasoning_tokens INTEGER NOT NULL DEFAULT 0,
                total_tokens INTEGER NOT NULL DEFAULT 0,
                ttft_ms REAL,
                duration_ms REAL
            );",
        )
        .unwrap();

        let base_ts = 1_700_000_000;

        // Model flash (requested: claude-haiku):
        // Account A: 300 input + 100 output + 100 cached = 500 total, 1 req
        conn.execute(
            "INSERT INTO token_usage (timestamp, account_email, model, requested_model, input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens)
             VALUES (?1, 'acc_a@example.com', 'gemini-flash', 'claude-haiku', 300, 100, 100, 0, 500)",
            params![base_ts + 10],
        ).unwrap();

        // Account B: 1200 input + 300 output + 0 cached = 1500 total, 1 req
        conn.execute(
            "INSERT INTO token_usage (timestamp, account_email, model, requested_model, input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens)
             VALUES (?1, 'acc_b@example.com', 'gemini-flash', 'claude-haiku', 1200, 300, 0, 0, 1500)",
            params![base_ts + 20],
        ).unwrap();

        // Model pro (requested: claude-sonnet):
        // Account A: 2000 input + 1000 output + 0 cached = 3000 total, 1 req
        conn.execute(
            "INSERT INTO token_usage (timestamp, account_email, model, requested_model, input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens)
             VALUES (?1, 'acc_a@example.com', 'gemini-pro', 'claude-sonnet', 2000, 1000, 0, 0, 3000)",
            params![base_ts + 30],
        ).unwrap();

        // Test 1: Routed view (view_mode = None)
        let res_routed = get_model_account_distribution_with_conn(&conn, 0, None).unwrap();
        assert_eq!(res_routed.total_requests, 3);
        assert_eq!(res_routed.total_tokens, 5000);
        assert_eq!(res_routed.models.len(), 2);

        // Sorted by total_tokens DESC: gemini-pro (3000) > gemini-flash (2000)
        let pro = &res_routed.models[0];
        assert_eq!(pro.model, "gemini-pro");
        assert_eq!(pro.total_tokens, 3000);
        assert_eq!(pro.total_requests, 1);
        assert_eq!(pro.accounts.len(), 1);
        assert_eq!(pro.accounts[0].account_email, "acc_a@example.com");
        assert_eq!(pro.accounts[0].token_share_pct, 100.0);
        assert_eq!(pro.accounts[0].request_share_pct, 100.0);

        let flash = &res_routed.models[1];
        assert_eq!(flash.model, "gemini-flash");
        assert_eq!(flash.total_tokens, 2000);
        assert_eq!(flash.total_requests, 2);
        assert_eq!(flash.accounts.len(), 2);
        // Within flash: acc_b (1500 tokens, 75.0%) > acc_a (500 tokens, 25.0%)
        assert_eq!(flash.accounts[0].account_email, "acc_b@example.com");
        assert_eq!(flash.accounts[0].total_tokens, 1500);
        assert_eq!(flash.accounts[0].token_share_pct, 75.0);
        assert_eq!(flash.accounts[0].request_share_pct, 50.0);
        assert_eq!(flash.accounts[1].account_email, "acc_a@example.com");
        assert_eq!(flash.accounts[1].total_tokens, 500);
        assert_eq!(flash.accounts[1].token_share_pct, 25.0);
        assert_eq!(flash.accounts[1].request_share_pct, 50.0);

        // Test 2: Requested view (view_mode = Some("requested"))
        let res_requested =
            get_model_account_distribution_with_conn(&conn, 0, Some("requested")).unwrap();
        assert_eq!(res_requested.total_requests, 3);
        assert_eq!(res_requested.total_tokens, 5000);
        assert_eq!(res_requested.models.len(), 2);

        // Models should be "claude-sonnet" (3000) and "claude-haiku" (2000)
        assert_eq!(res_requested.models[0].model, "claude-sonnet");
        assert_eq!(res_requested.models[0].total_tokens, 3000);
        assert_eq!(res_requested.models[1].model, "claude-haiku");
        assert_eq!(res_requested.models[1].total_tokens, 2000);

        // Within claude-haiku: acc_b (1500 tokens, 75.0%) > acc_a (500 tokens, 25.0%)
        let haiku = &res_requested.models[1];
        assert_eq!(haiku.accounts[0].account_email, "acc_b@example.com");
        assert_eq!(haiku.accounts[0].token_share_pct, 75.0);
        assert_eq!(haiku.accounts[1].account_email, "acc_a@example.com");
        assert_eq!(haiku.accounts[1].token_share_pct, 25.0);

        // Check fallback when requested_model is empty/NULL: defaults back to model
        conn.execute(
            "INSERT INTO token_usage (timestamp, account_email, model, requested_model, input_tokens, output_tokens, cached_tokens, reasoning_tokens, total_tokens)
             VALUES (?1, 'acc_c@example.com', 'gpt-4o', '', 100, 100, 0, 0, 200)",
            params![base_ts + 40],
        ).unwrap();
        let res_fallback =
            get_model_account_distribution_with_conn(&conn, 0, Some("requested")).unwrap();
        assert!(res_fallback.models.iter().any(|m| m.model == "gpt-4o"));
    }
}
