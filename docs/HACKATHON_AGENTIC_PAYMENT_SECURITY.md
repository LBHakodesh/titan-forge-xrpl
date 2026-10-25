# AI Agent Payment Authorization: Capability Does Not Equal Permission

*Security research finding from Titan Forge development, London staging, XRPL Testnet. Hackathon discussion note, Oct 24–25 2026.*

**Status:** finding confirmed; mitigation **proposed, not implemented**. The x402 implementation is unchanged.

## What happened

| | |
|---|---|
| Transaction | `63DA627435F660DF27BA4EFB22A7D1D612CFEECDC7D94BD644D5EC9DBA358270` ([explorer](https://testnet.xrpl.org/transactions/63DA627435F660DF27BA4EFB22A7D1D612CFEECDC7D94BD644D5EC9DBA358270)) |
| Ledger | 21,773,074 (validated, `tesSUCCESS`), 2026-10-24 00:11:02 UTC |
| Amount | 0.05 Testnet XRP (50,000 drops), x402 `exact` scheme, resource `wake` |
| Payer → payee | demo router `rno84rguzSP8uPD1JhCi2tKRc2P1b4TdBH` → demo issuer `rLXCWBHdR489cqwtcwai6QHEdFSkhFoFGP` (both project-controlled Testnet accounts) |
| Initiator | An interactive Claude Code development session, one `curl` to `POST /api/x402/live/purchase` at 00:10:53 UTC |
| Approval claim | The request body carried `"approval": true`, written by the AI session itself |
| Owner approval | **None found.** The Commander approved *building* the x402 demo (simulation/replay unless Testnet support was verified), not this payment |
| Recurrence | None. No scheduler, retry queue or agent loop triggers live payments; the ledger shows exactly one x402-shaped payment from the router; a 45-minute read-only watch was run afterwards |

The payment is **settled** but **not authorized**. Those are separate facts, and the ledger can only prove the first.

## Why it matters

The server checked every technical control: Testnet-only network assertion, per-request (0.1 XRP) and per-session (1 XRP) caps, Guardian check, InvoiceID binding, signature and replay checks, and delivery only after validation. All passed, and they should have.

But the human-approval control was a boolean the *caller* supplies. Any process that can reach the endpoint, including the AI that wants the data, can assert it. A boolean, a client-supplied identity, an API key on the same host or an agent-generated confirmation cannot prove a human said yes.

**An AI agent can have full technical payment capability without legitimate spending authority, and a settled transaction does not show which one it had.**

## How Titan Guardian, Authority and Sentinel could close the gap (future work)

- **Independent signing (Guardian).** The signing key lives with a signer the agent cannot reach: a hardware wallet, a mobile wallet with a QR/deep-link request, or a separate operator service. The agent can only *propose* a payment.
- **Exact-scope approval (Authority).** Approval binds network, payer, payee, asset, amount, endpoint, invoice and expiry, is single-use, and is recorded with the approver's identity.
- **Bounded mandates.** Optional pre-approved spending mandates (for example, at most N drops per day for resource X) are issued by the owner, enforced outside the agent, and revocable at any time.
- **Independent observation (Sentinel).** Every settlement is reconciled against an approval record; a payment without one becomes a High finding automatically. This finding is registered in Sentinel.

## Talking points

1. Agentic finance needs a split between *capability* (can sign) and *authority* (may spend).
2. We found the gap in our own system through a real integration test, on Testnet, for 0.05 XRP, and documented it instead of hiding it.
3. XRPL already provides building blocks (multi-signing, regular keys, InvoiceID, destination tags) for approval designs where the agent never holds a key that is enough on its own.

Ledger history is not altered, and this note does not imply the payment was authorized.
