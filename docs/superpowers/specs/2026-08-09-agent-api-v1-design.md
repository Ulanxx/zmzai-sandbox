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

Relay adds `POST /api/internal/sandbox/models`. It requires the existing Sandbox service authorization, accepts `{ "sandboxKey": "zsk_..." }`, and resolves the key exactly once to derive its owner. It returns:

```json
{
  "models": [{
    "model": "gpt-5.6-terra",
    "maxInputTokens": 128000,
    "maxOutputTokens": 16000,
    "allowedReasoningEfforts": ["low", "medium", "high"]
  }]
}
```

`model` is required; the remaining fields are optional. Results are filtered to enabled and routable public models. Relay returns `401 INTERNAL_SERVICE_UNAUTHORIZED` for an invalid service secret and `401 SANDBOX_KEY_INVALID` for an invalid key. Sandbox maps only the latter to its public `401 SANDBOX_KEY_INVALID`; it maps the former, unavailable Relay, and malformed responses to `503 RELAY_UNAVAILABLE`. This endpoint must not forward the key to Relay's public `/api/v1/models` route or return account, channel, or provider fields.

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

The status enum is `queued`, `planning`, `running`, `cancellation_requested`, `cleanup_pending`, `succeeded`, `failed`, or `cancelled`. Terminal states are `succeeded`, `failed`, and `cancelled`; `cleanup_pending` is deliberately non-terminal and retains capacity until provider deletion is confirmed. A failed run includes `{ "failure": { "code": "...", "error": "...", "retryable": false } }`; `ownerSandboxKeyId`, provider ids, and execution leases are never returned to API clients.

Sequence starts at `1` for every run and never changes after persistence. Existing event ids remain opaque. Events are stored in their own collection with the unique key `(runId, sequence)`. To append an event, the store atomically increments the run's `nextEventSequence`, then inserts the event with the allocated value; a failed insert may leave a gap but never reuses or reorders a sequence. Readers use `sequence > cursor`, so gaps are harmless and no event can be emitted twice after reconnection.

Errors use a JSON envelope with an invariant `code` and a human-readable `error`:

| HTTP | Code | Meaning |
| --- | --- | --- |
| `400` | `INVALID_BODY` or `INVALID_IDEMPOTENCY_KEY` | Client must correct the request. |
| `401` | `SANDBOX_KEY_INVALID` | Key is invalid or revoked. |
| `404` | `RUN_NOT_FOUND` | Run is absent or belongs to another key. |
| `409` | `IDEMPOTENCY_CONFLICT` | Same idempotency key with a different payload. |
| `429` | `RATE_LIMITED` | Per-key or global execution limit; include `Retry-After`. |
| `503` | `RELAY_UNAVAILABLE` or `SANDBOX_UNAVAILABLE` | Retry with bounded backoff. |

`POST /runs` acknowledges a durable queued run with `201` before Relay planning. A Relay balance rejection, invalid model, or planner failure is therefore a terminal `failed` run with its failure code, not an HTTP `402` from the submission request. No Sandbox instance is created for those failures. Run failures caused after creation remain a `200` run snapshot with `status: "failed"`; they are not converted into a new transport error.

## SSE replay contract

`GET /runs/:runId/events` emits standard SSE frames:

```text
id: 3
event: stdout
data: {"id":"evt_01","sequence":3,"runId":"run_ab12cd34","type":"stdout","at":"...","data":{"text":"2"},"status":"running"}

```

The server reads `Last-Event-ID` as a sequence cursor. It stores that cursor as `sent`, queries persisted events using `sequence > sent` in ascending order, advances `sent` only after each successful write, and repeats the same query while the run is active. This single cursor rule covers the handoff from the initial replay to tailing, so an event inserted between either poll is emitted exactly once. A terminal run sends any remaining events and closes. A reconnect without `Last-Event-ID` starts from sequence `1`.

The stream sends a comment heartbeat at least every 15 seconds. A client that cannot keep SSE open uses `GET /runs/:runId` for recovery; it must treat the persisted snapshot as authoritative.

## Persistence and lifecycle

- Run snapshots, ordered events, and submissions are persisted in MongoDB. Run retention stays one hour for v1; event documents share the run expiry; submission/idempotency records stay 24 hours.
- A submission contains the immutable request fingerprint, run id, and state `accepted`, `planning_started`, or `resolved`. The unique `(sandboxKeyId, idempotencyKey)` claim is written before background work. A retry returns its existing run regardless of submission state. If a process dies after claiming a submission but before writing the run, the recovery worker reconstructs the queued run from the immutable submission payload.
- The planner writes `planning_started` before its single Relay request. If it crashes after that marker and cannot prove the response was persisted, recovery marks the run `failed` with `PLANNING_OUTCOME_UNKNOWN` rather than calling Relay again. The request id is the stable run id. This deliberately favours no duplicate model charge over automatic retry; the caller creates a new run with a new idempotency key after resolving the uncertainty.
- Each active run holds an execution lease: `executionId`, `leaseOwner`, `leaseExpiresAt`, and `heartbeatAt`. The worker renews the lease while planning or executing. Admission and active-run counts consider only unexpired leases; per-key and global capacity are acquired atomically before work begins and released only by a compare-and-set transition from that `executionId`.
- Before calling OpenSandbox create, the worker writes `runId` and `executionId` into the request metadata (`zmzai.run_id` and `zmzai.execution_id`) as well as keeping them in the execution lease. The provider callback persists `providerSandboxId` immediately after instance creation, before executing the command. On startup, a recovery worker atomically claims only expired leases, lists OpenSandbox instances tagged with those stable metadata values, deletes both the recorded id and any matching orphan, then releases capacity and appends an orphan-recovery event. This covers a process failure after OpenSandbox creates an instance but before the create response is persisted. A worker with a current lease is never touched by recovery.
- Cancellation atomically transitions an active run to `cancellation_requested` and returns `202` with that snapshot. The executor or recovery worker aborts the command and deletes the recorded or metadata-discovered instance. Successful cleanup transitions to `cancelled`; a failed deletion transitions to `cleanup_pending` with `SANDBOX_CLEANUP_PENDING`, retains its execution/capacity lease, and remains on the cleanup retry queue. Capacity is released only after the control plane confirms that all matching instances are absent. A natural completion may transition from `running` only; if cancellation won the compare-and-set race, it cannot overwrite the cancellation outcome. Repeating cancellation returns `202` while cleanup is pending and `200` for a terminal run.

## Security and operational limits

Current policies remain part of the public behavior: one active run per key, three active runs globally, 256 KiB combined stdout/stderr, 60-second maximum command timeout, network-denied temporary sandboxes, and no database access from the workload.

Every API response uses `Cache-Control: no-store`. Logs must never contain plaintext `sandbox_key`, Relay internal service secrets, provider API keys, or user session cookies.

## Verification

1. A valid key lists models through `/api/v1/models`; the same key receives `401` from Relay public model and chat endpoints.
2. A `POST /runs` retry with the same idempotency key returns the same run without a second Relay call or Sandbox. An interrupted `planning_started` record becomes `PLANNING_OUTCOME_UNKNOWN` without a second Relay request.
3. `1+1` emits ordered events including stdout `2`; reconnecting with `Last-Event-ID: 2` receives only events after sequence 2, including one appended during the replay-to-tail handoff.
4. A restarted Sandbox process replays a final run's persisted events, and safely recovers an expired active lease without touching a worker with a renewed lease. It deletes an instance that was created but not yet recorded by locating the run/execution metadata.
5. A revoked key cannot read or cancel its former runs; a different valid key receives `404`.
6. Relay balance rejection, concurrency exhaustion, an invalid model, cancellation races, failed provider cleanup, and OpenSandbox failure all return the documented transport/error or terminal-run behavior. A pending cleanup continues to consume its per-key and global slot until the control plane confirms deletion.

## Deferred work

P2 can add a capability registry and tool loop for `read`, `write`, `edit`, and approved `webfetch`. Those capabilities will be submitted through this v1 run/event contract rather than introducing a second execution API.
