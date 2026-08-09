# Stable Agent API v1 Design

> Status: approved for planning. Scope: turn the existing `sandbox_key` preview into a stable API for ZMZAI Agent and trusted server-side clients.

## Goal

An Agent submits and supervises one constrained execution without relying on browser cookies or the Sandbox console:

```text
Agent + sandbox_key
  -> Sandbox API v1
  -> Relay (model access and billing)
  -> OpenSandbox (ephemeral execution)
  -> persisted run state + replayable SSE events
```

This is an API stability slice. It does not add Workspace mounting, artifacts, multi-tool loops, schedules, arbitrary network access, or a new token issuer.

## Identity and authority

`sandbox_key` (`zsk_...`) remains the only public Agent credential in v1.

- The client sends it only in `Authorization: Bearer <sandbox_key>`.
- Sandbox resolves it through Relay's authenticated internal service endpoint.
- The key is scoped to its owner and can read, cancel, or replay only runs created by that same key.
- The key never authorizes Relay's public chat or model endpoints directly.
- Relay remains responsible for the user's permitted model directory, balance reservation, and settlement.

The API does not accept provider API keys, images, host mounts, environment secrets, Docker options, or network-policy overrides.

## API surface

Base URL: `https://z.zmzai.cloud/api/v1`.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/models` | Return models available to the key owner for Sandbox planning. |
| `POST` | `/runs` | Submit an idempotent natural-language execution task. |
| `GET` | `/runs` | List recent runs owned by this key. |
| `GET` | `/runs/:runId` | Read the persisted run snapshot. |
| `GET` | `/runs/:runId/events` | Replay events and then stream newly appended events. |
| `POST` | `/runs/:runId/cancel` | Request cancellation and sandbox cleanup. |

`POST /runs` keeps the current request shape:

```json
{
  "task": "计算 1+1，并只输出结果",
  "model": "gpt-5.6-terra"
}
```

It requires an `Idempotency-Key` of 16 to 128 printable ASCII characters. Reusing the key with the identical request returns the original run; reusing it with a different request returns `409`.

`GET /models` is a Sandbox-owned proxy backed by a Relay internal endpoint. It returns only supported public fields: model id, token limits, and allowed reasoning efforts. It does not return channel configuration, provider credentials, or a Relay bearer credential.

## Run and error contracts

The stable run object retains the current fields, but its event items gain a durable `sequence`:

```json
{
  "id": "run_ab12cd34",
  "status": "running",
  "model": "gpt-5.6-terra",
  "events": [
    {
      "id": "evt_01",
      "sequence": 3,
      "at": "2026-08-09T00:00:00.000Z",
      "kind": "stdout",
      "message": "2"
    }
  ]
}
```

Sequence starts at `1` for every run and never changes after persistence. Existing event ids remain opaque.

Errors use a JSON envelope with an invariant `code` and a human-readable `error`:

| HTTP | Code | Meaning |
| --- | --- | --- |
| `400` | `INVALID_BODY` or `INVALID_IDEMPOTENCY_KEY` | Client must correct the request. |
| `401` | `SANDBOX_KEY_INVALID` | Key is invalid or revoked. |
| `402` | `INSUFFICIENT_BALANCE` | Relay rejected the model call before Sandbox creation. |
| `404` | `RUN_NOT_FOUND` | Run is absent or belongs to another key. |
| `409` | `IDEMPOTENCY_CONFLICT` | Same idempotency key with a different payload. |
| `429` | `RATE_LIMITED` | Per-key or global execution limit; include `Retry-After`. |
| `503` | `RELAY_UNAVAILABLE` or `SANDBOX_UNAVAILABLE` | Retry with bounded backoff. |

Run failures caused after creation remain a `200` run snapshot with `status: "failed"`; they are not converted into a new transport error.

## SSE replay contract

`GET /runs/:runId/events` emits standard SSE frames:

```text
id: 3
event: stdout
data: {"id":"evt_01","sequence":3,"runId":"run_ab12cd34","type":"stdout","at":"...","data":{"text":"2"},"status":"running"}

```

The server reads `Last-Event-ID` as a sequence cursor. It first sends every persisted event whose sequence is greater than that cursor, then tails new events. A terminal run sends any remaining events and closes. A reconnect without `Last-Event-ID` starts from sequence `1`.

The stream sends a comment heartbeat at least every 15 seconds. A client that cannot keep SSE open uses `GET /runs/:runId` for recovery; it must treat the persisted snapshot as authoritative.

## Persistence and lifecycle

- Run snapshots and their ordered events are persisted in MongoDB on every state transition and event append.
- Run retention stays one hour for v1; submission/idempotency records stay 24 hours.
- On an in-process restart, read/list/SSE replay work from MongoDB. An active process cannot be resumed automatically in this phase; an orphaned active run is reconciled to a failed terminal state with an explicit event.
- Cancellation is idempotent. It aborts the in-process command when present and requests deletion of the OpenSandbox instance; repeat cancellation returns the current terminal snapshot.

## Security and operational limits

Current policies remain part of the public behavior: one active run per key, three active runs globally, 256 KiB combined stdout/stderr, 60-second maximum command timeout, network-denied temporary sandboxes, and no database access from the workload.

Every API response uses `Cache-Control: no-store`. Logs must never contain plaintext `sandbox_key`, Relay internal service secrets, provider API keys, or user session cookies.

## Verification

1. A valid key lists models through `/api/v1/models`; the same key receives `401` from Relay public model and chat endpoints.
2. A `POST /runs` retry with the same idempotency key returns the same run without a second Relay call or Sandbox.
3. `1+1` emits ordered events including stdout `2`; reconnecting with `Last-Event-ID: 2` receives only events after sequence 2.
4. A restarted Sandbox process still returns the final run snapshot and replays its persisted events.
5. A revoked key cannot read or cancel its former runs; a different valid key receives `404`.
6. Relay `402`, concurrency exhaustion, an invalid model, cancellation, and OpenSandbox failure all return the documented transport/error or terminal-run behavior.

## Deferred work

P2 can add a capability registry and tool loop for `read`, `write`, `edit`, and approved `webfetch`. Those capabilities will be submitted through this v1 run/event contract rather than introducing a second execution API.
