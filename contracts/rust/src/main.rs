//! tf-stub-engine — PLACEHOLDER conformance stub. NOT the authentic Titan Ghost Quoter or Strategic Engine.
//! It contains no pricing or allocation logic: every answer is schema-valid but obviously fake
//! (zero allocation, all capital idle, price 1, "hold" recommendation). Use it only to exercise the transport:
//!   cargo build --release && node contracts/conformance.mjs --bin contracts/rust/target/release/tf-stub-engine
//! Protocol: one JSON RpcRequest per stdin line -> one JSON RpcResponse per stdout line. Logs go to stderr only.
mod types;

use serde_json::{json, Value};
use std::io::{self, BufRead, Write};
use std::time::{SystemTime, UNIX_EPOCH};
use types::*;

const LABEL: &str = "PLACEHOLDER Rust conformance stub (NOT the authentic Titan Ghost engine)";

fn rfc3339_in(secs: u64) -> String {
    // Minimal UTC formatter (no chrono dependency).
    let t = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) + secs;
    let (days, rem) = (t / 86_400, t % 86_400);
    let (h, m, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    // civil-from-days (Howard Hinnant)
    let z = days as i64 + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let mo = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if mo <= 2 { 1 } else { 0 };
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z", y, mo, d, h, m, s)
}

fn handle(req: RpcRequest) -> RpcResponse {
    let id = req.id.clone();
    if req.v != WIRE_VERSION {
        return RpcResponse::err(id, ErrorCode::UnsupportedVersion, "wire v1 only");
    }
    match req.method.as_str() {
        "info" => RpcResponse::ok(id, serde_json::to_value(EngineInfo {
            id: "rust-conformance-stub".into(), label: LABEL.into(), authentic: false,
            version: Some(env!("CARGO_PKG_VERSION").into()), contract_version: CONTRACT_VERSION.into(),
            methods: vec!["info".into(), "health".into(), "quote".into(), "strategy".into()],
        }).unwrap()),
        "health" => RpcResponse::ok(id, json!({ "ok": true })),
        "quote" => match serde_json::from_value::<QuoteRequest>(req.params) {
            Err(e) => RpcResponse::err(id, ErrorCode::BadRequest, e.to_string()),
            Ok(q) => RpcResponse::ok(id, serde_json::to_value(QuoteResponse {
                source: LABEL.into(), authentic: false, side: q.side, ring: q.ring,
                price: 1.0, size: q.size, expiry: rfc3339_in(5), mode: q.mode,
            }).unwrap()),
        },
        "strategy" => match serde_json::from_value::<StrategyRequest>(req.params) {
            Err(e) => RpcResponse::err(id, ErrorCode::BadRequest, e.to_string()),
            Ok(s) if s.markets.is_empty() => RpcResponse::err(id, ErrorCode::BadRequest, "markets must be non-empty"),
            Ok(s) => {
                let allocations = s.markets.iter().map(|m| {
                    let n = m.rings_active.unwrap_or(6).min(6) as usize;
                    MarketAllocation { market_id: m.market_id.clone(), allocation: Allocation {
                        mode: s.mode, capital_usd: m.capital_usd, deployed_usd: 0.0, idle_usd: m.capital_usd,
                        daily_earn_usd: 0.0, yield_bps_on_deployed: 0.0, source: Some(LABEL.into()),
                        rings: RINGS[..n].iter().map(|&r| RingMetrics { id: r, alloc_usd: 0.0, daily_earn_usd: 0.0, marginal_bps: 0.0, utilization: 0.0 }).collect(),
                    } }
                }).collect();
                RpcResponse::ok(id, serde_json::to_value(StrategyResponse {
                    source: LABEL.into(), authentic: false, mode: s.mode, allocations,
                    recommendations: vec![Recommendation { source: LABEL.into(), action: "hold".into(), from_market: None, to_market: None,
                        amount_usd: None, rationale: "Placeholder: stub engine makes no recommendation.".into(), mode: s.mode }],
                }).unwrap())
            }
        },
        other => RpcResponse::err(id, ErrorCode::UnknownMethod, format!("unknown method {other}")),
    }
}

fn main() {
    let stdin = io::stdin();
    let mut out = io::stdout().lock();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() { continue; }
        let resp = match serde_json::from_str::<Value>(&line) {
            Err(e) => RpcResponse::err("unknown".into(), ErrorCode::BadRequest, format!("invalid JSON: {e}")),
            Ok(v) => {
                let id = v.get("id").and_then(Value::as_str).unwrap_or("unknown").to_string();
                match serde_json::from_value::<RpcRequest>(v) {
                    Ok(req) => handle(req),
                    Err(e) => RpcResponse::err(id, ErrorCode::BadRequest, e.to_string()),
                }
            }
        };
        let _ = writeln!(out, "{}", serde_json::to_string(&resp).unwrap());
        let _ = out.flush();
    }
}
