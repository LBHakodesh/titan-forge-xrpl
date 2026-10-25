//! Serde mirrors of contracts/schemas/*.schema.json (contract v1.0.0, wire v1).
//! The JSON Schemas are normative; if these structs and the schemas disagree, the schemas win.
//! Field names are camelCase on the wire.
#![allow(dead_code)]
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const CONTRACT_VERSION: &str = "1.0.0";
pub const WIRE_VERSION: u32 = 1;

// ---------- common.schema.json (enums derived from public/domain.js) ----------
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Mode {
    #[serde(rename = "LIVE_TESTNET")] LiveTestnet,
    #[serde(rename = "SIMULATION")] Simulation,
    #[serde(rename = "REPLAY")] Replay,
}

/// Modes allowed for hypothetical outputs (allocations, recommendations, strategy).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum HypotheticalMode {
    #[serde(rename = "SIMULATION")] Simulation,
    #[serde(rename = "REPLAY")] Replay,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum RingId { Velocity, Bridge, Earn, Money, Deep, Ceiling }
pub const RINGS: [RingId; 6] = [RingId::Velocity, RingId::Bridge, RingId::Earn, RingId::Money, RingId::Deep, RingId::Ceiling];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StageId { Entered, Spoke, GrowingSpoke, Corridor, Mature, Standby }

/// MarketRef: one of currencies|securities|real_estate|precious_metals, or "token:<CODE>". Kept as a string.
pub type MarketRef = String;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side { Bid, Ask }

// ---------- token-ref / asset ----------
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TokenRef {
    pub currency: String,
    pub issuer: String,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub launch_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub network: Option<String>, // "testnet"
}

/// asset.schema.json: {"currency":"XRP"} or a TokenRef. Untagged: XRP has no issuer.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Asset { Token(TokenRef), Xrp { currency: String } }

// ---------- tx-evidence ----------
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TxEvidence {
    pub hash: String,
    pub result: String,
    pub ledger: u64,
    pub validated: bool,
    pub explorer: String, // https://testnet.xrpl.org/transactions/<HASH>
    #[serde(default, skip_serializing_if = "Option::is_none")] pub mode: Option<Mode>, // always LIVE_TESTNET
    #[serde(default, skip_serializing_if = "Option::is_none")] pub step: Option<String>,
}

// ---------- financial-event ----------
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FinancialEvent {
    #[serde(rename = "type")] pub kind: String, // "<area>.<verb>"
    pub mode: Mode,
    pub at: String, // RFC 3339
    #[serde(default, skip_serializing_if = "Option::is_none")] pub payload: Option<Value>,
}

// ---------- ring-metrics / allocation / corridor-state ----------
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RingMetrics {
    pub id: RingId,
    pub alloc_usd: f64,
    pub daily_earn_usd: f64,
    pub marginal_bps: f64,
    pub utilization: f64, // 0..=1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Allocation {
    pub mode: HypotheticalMode,
    pub capital_usd: f64,
    pub deployed_usd: f64,
    pub idle_usd: f64,
    pub daily_earn_usd: f64,
    pub yield_bps_on_deployed: f64,
    pub rings: Vec<RingMetrics>, // <= 6
    #[serde(default, skip_serializing_if = "Option::is_none")] pub source: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CorridorState {
    #[serde(default, skip_serializing_if = "Option::is_none")] pub token: Option<TokenRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub launch_id: Option<String>,
    pub stage: StageId,
    pub rings_active: u8, // 0..=6
    pub rings: Vec<RingMetrics>,
    pub mode: Mode,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub at: Option<String>,
}

// ---------- recommendation ----------
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Recommendation {
    pub source: String,
    pub action: String, // reallocate | hold | add_ring | retire_ring | advance_stage | revert_stage | pause
    #[serde(default, skip_serializing_if = "Option::is_none")] pub from_market: Option<MarketRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub to_market: Option<MarketRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub amount_usd: Option<f64>,
    pub rationale: String,
    pub mode: HypotheticalMode,
}

// ---------- quoter ----------
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Pair { pub base: Asset, pub quote: Asset }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuoteRequest {
    pub pair: Pair,
    pub side: Side,
    pub size: f64,
    pub ring: RingId,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub market_id: Option<MarketRef>,
    pub mode: Mode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct QuoteResponse {
    pub source: String,
    pub authentic: bool,
    pub side: Side,
    pub ring: RingId,
    pub price: f64,
    pub size: f64,
    pub expiry: String, // RFC 3339
    pub mode: Mode,     // must equal request mode
}

// ---------- strategic engine ----------
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketInput {
    pub market_id: MarketRef,
    pub capital_usd: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub flow_scale: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub rings_active: Option<u8>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub stage: Option<StageId>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub token: Option<TokenRef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StrategyRequest {
    pub markets: Vec<MarketInput>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub hurdle_bps: Option<f64>,
    pub mode: HypotheticalMode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MarketAllocation { pub market_id: MarketRef, pub allocation: Allocation }

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StrategyResponse {
    pub source: String,
    pub authentic: bool,
    pub mode: HypotheticalMode,
    pub allocations: Vec<MarketAllocation>,
    pub recommendations: Vec<Recommendation>,
}

// ---------- handshake + rpc envelope ----------
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EngineInfo {
    pub id: String,
    pub label: String,
    pub authentic: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub version: Option<String>,
    pub contract_version: String,
    pub methods: Vec<String>, // subset of info|health|quote|strategy
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RpcRequest {
    pub v: u32,
    pub id: String,
    pub method: String,
    #[serde(default)] pub params: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub deadline_ms: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ErrorCode { BadRequest, UnsupportedVersion, UnknownMethod, NotReady, ModeViolation, Timeout, Internal }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    pub code: ErrorCode,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub retryable: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcResponse {
    pub v: u32,
    pub id: String,
    pub ok: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")] pub error: Option<RpcError>,
}

impl RpcResponse {
    pub fn ok(id: String, result: Value) -> Self { Self { v: WIRE_VERSION, id, ok: true, result: Some(result), error: None } }
    pub fn err(id: String, code: ErrorCode, message: impl Into<String>) -> Self {
        Self { v: WIRE_VERSION, id, ok: false, result: None, error: Some(RpcError { code, message: message.into(), retryable: None }) }
    }
}
