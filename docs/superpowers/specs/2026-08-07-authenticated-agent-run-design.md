# Authenticated Agent Run Design

> Scope: make the Sandbox console execute an authenticated user's natural-language task through the ZMZAI Relay and OpenSandbox.
> Related repositories: `zmzai-sandbox`, `zmzai-relay`.

## Goal

Replace the current OpenSandbox placeholder failure with one accountable path:

```text
Browser session
  -> Sandbox console
  -> Relay chat completion, forwarding the shared .zmzai.cloud session cookie
  -> structured run_code request
  -> OpenSandbox
  -> stdout/stderr and final result in the console
```

Users do not enter, receive, or store a Relay API key. The Relay keeps user identity, model access, balance reservation, and settlement as its existing responsibility.

## Boundaries

- `zmzai-sandbox` verifies the shared login session before accepting a run.
- `zmzai-sandbox` forwards the inbound `Cookie` header server-to-server to `m.zmzai.cloud`; it never exposes the cookie to browser JavaScript and never creates a bearer token.
- `zmzai-relay` remains the sole model gateway and billing authority.
- `zmzai-sandbox` accepts only an Agent-produced structured command. It must never treat natural-language user input as a shell command.
- OpenSandbox stays private on `127.0.0.1` and continues to create an ephemeral, network-denied sandbox with CPU, memory, and timeout limits.

## API Contract

### Relay model directory

Add an authenticated `GET /api/v1/models` endpoint in `zmzai-relay`.

- Authentication: the same session or bearer-key resolution model as chat completion.
- Response: enabled and currently routable public model identifiers, display labels, and supported reasoning efforts.
- The Sandbox console fetches this through its own server route. It must not ship a static model list such as `relay-default` or `relay-coder`.

### Sandbox identity and run submission

`GET /api/me` in `zmzai-sandbox` returns the shared-session user or `401`.

`GET /api/models` proxies the authenticated Relay directory. It returns `401` for signed-out users and `503` when Relay is unavailable.

`POST /api/runs` accepts a task and a selected allowed model. It must:

1. reject signed-out requests;
2. reject a model not returned for that user;
3. create the run record and append visible status events;
4. ask Relay to convert the task into one JSON `run_code` command;
5. validate the command schema locally;
6. pass only that command to `runOpenSandboxCommand`;
7. append stdout/stderr, final exit code, and a bounded final answer;
8. return a billing error without opening a sandbox when Relay returns `402`.

## Agent Command Contract

The initial Agent tool surface contains one tool:

```json
{
  "name": "run_code",
  "language": "javascript | python | shell",
  "code": "string",
  "timeoutMs": 1000
}
```

The server validates a fixed language allowlist, non-empty code, a bounded code size, and a timeout no larger than the Sandbox policy. The command is built from the structured fields, not copied from the user's task text.

The first slice supports one tool call per run. File upload, Workspace snapshot transfer, connector credentials, and multi-tool loops stay out of scope.

## Console States

- Signed out: show one login action and no active model selector.
- Loading models: disable run submission.
- Signed in: show only Relay-returned models and the user's current selection.
- Insufficient balance: show the Relay failure and link to `https://m.zmzai.cloud/dashboard/billing`.
- Relay unavailable or malformed Agent command: mark the run failed before sandbox creation.
- Sandbox failure: retain logs, exit code, and the provider error.

## Verification

1. A signed-out visitor cannot submit a run and is sent to the login page with a safe return URL.
2. A signed-in user sees the Relay model directory, with no browser-visible Relay credential.
3. A task such as `1+1 equals what?` produces a structured JavaScript or Python command, executes in OpenSandbox, and displays `2`.
4. A user without balance receives the Relay `402` response and no sandbox is created.
5. A malformed model response or command fails closed and records an explanatory run event.
6. The existing OpenSandbox health endpoint remains private and healthy after the change.
