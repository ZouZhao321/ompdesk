# Runtime logs

ompdesk writes its server logs into the same rotating process log that omp
uses. There is one file set per server process, so HTTP requests, agent runs,
security decisions, audit records and browser errors can be read together, in
order, without a second logging system.

## Where the logs are

The active file is `<omp logs dir>/omp.<local-day>.<pid>.log`. With the default
omp home that is:

```
~/.omp/logs/omp.2026-10-24.1528.log
```

The day and PID stay in the name, so a restarted server writes a new file
instead of appending to the old one. Rotation is per process and per local day:
up to five 10 MiB files, named `.log`, `.log.1`, `.log.2`, … `.log.4`. Old files
beyond the fifth are deleted. The SDK batches writes once per second or 64 KiB;
`warn` and `error` records are written immediately, together with everything
buffered before them.

The Settings → Logs panel reads the current process's file and rotations only.
It cannot list or open any other file.

## Record shape

Each line is one JSON object. `message` is a stable event name; business fields
are flat next to it rather than nested under a `context` key.

```json
{
  "timestamp": "2026-10-24T15:00:00.000+08:00",
  "level": "info",
  "pid": 1528,
  "source": "ompdesk",
  "subsystem": "http",
  "message": "http.request",
  "requestId": "8e0c4a3e-...",
  "route": "/api/sessions/[id]",
  "method": "GET",
  "status": 200,
  "durationMs": 42,
  "slow": false
}
```

| Field | Meaning |
| --- | --- |
| `timestamp` | Local time with offset, written by the SDK logger. |
| `level` | `error`, `warn`, `info` or `debug`. |
| `pid` | Process that wrote the record. |
| `source` | `ompdesk` for records written by this app; `sdk` for raw omp SDK events whose record has no source. |
| `subsystem` | `process`, `http`, `agent`, `audit`, `security` or `client` (`system` is reserved). |
| `message` | Event name, dot-separated. This is the field to filter or count on. |
| other keys | Event-specific fields, such as `requestId`, `sessionId`, `runId`, `route`, `status`, `durationMs`. |

Fields are sanitized on the way in:

- Strings are cut at 2,000 characters and stacks at 4,000.
- Objects are walked at most four levels deep, 40 keys per object, 50 items per
  array; excess is replaced with a marker instead of being dropped silently.
- `Error` values keep only `name`, `message` and a truncated `stack`.
- Binary values become `[buffer N bytes]` / `[bytes N]`, circular references
  become `[circular]`, functions become `[function]`.
- Keys that name credentials are removed at any depth, including `password`,
  `passwords`, `passwd`, `passphrase`, `secret`, `secrets`, `authorization`,
  `cookie`, `apiKey`, `recoveryCode`, `privateKey`, `accessKey`, `sessionKey`,
  `setCookie`, and any name ending in a `token` segment (`token`,
  `accessToken`, `refreshToken`, `bearerToken`, `authToken`, `sessionToken`,
  `apiToken`, `GITHUB_TOKEN`, `HF_TOKEN`, `NPM_TOKEN`, `idToken`,
  `oauthToken`). Usage counters such as `inputTokens`, `outputTokens`,
  `cachedTokens`, `totalTokens`, `tokenCount`, `tokensBefore` and
  `inputTokenCount` are kept.

A logging failure never fails the request or operation being logged.

## Levels

| Level | Used for |
| --- | --- |
| `error` | Request or agent run that failed, a thrown route handler, a `client.error` report, compaction that ended with an error. |
| `warn` | Rejected credentials or hosts, `4xx` requests, audit actions that failed, aborted or incomplete agent work, SSE close by controller failure or heartbeat failure. |
| `info` | Successful requests, audit successes, run/tool/compaction lifecycle, stream open and normal close, `process.start`. |
| `debug` | Diagnostic records: the periodic `process.memory` sample, and nothing else on the current server paths. |

Concrete mappings:

- `http.request` is `error` for `5xx`, `warn` for `4xx`, `info` otherwise.
- `http.stream.close` is `info` for `cancelled` / `aborted` and `warn` for
  `connect_failed` / `controller_closed` / `heartbeat_failed`.
- `agent.run.end` is `error` for `stopReason: "error"`, `warn` for `aborted` or
  `fork`, and `info` for the rest.
- `audit.*` is `info` for `outcome: "success"` and `warn` for `"failure"`.

## Environment variables

| Variable | Default | Effect |
| --- | --- | --- |
| `OMP_LOG_LEVEL` | `debug` | Most verbose level written to the log **file and the stdout mirror**: `error`, `warn`, `info` or `debug`, case-insensitive. An unknown value falls back to `debug`. |
| `OMPDESK_LOG_STDOUT` | unset | Mirror records to stdout. `1`, `true`, `yes`, `on` enable it; `0`, `false`, `no`, `off` disable it. When unset, stdout mirroring is on only when `NODE_ENV` is not `production`. |
| `OMPDESK_SLOW_REQUEST_MS` | `1000` | Threshold for the `slow` flag on `http.request`. A positive number of milliseconds; anything else keeps the default. |
| `OMPDESK_MEMORY_SAMPLE_MS` | `60000` | Interval between `process.memory` samples. `0` turns sampling off. A non-number, a negative value or anything below `1000` keeps the default. |
| `OMPDESK_TRUST_PROXY` | unset | Trust `x-forwarded-for` / `x-real-ip` from a reverse proxy in front of ompdesk. `1`, `true`, `yes`, `on` enable it. When unset, the proxy records the client address as `local`: a directly reachable server cannot distinguish a real forwarding header from one the caller made up. |

The Settings panel does not change the level or retention; both are process
configuration. Restart the server after changing these variables.

## Standard output and Docker

The file transport is always on. Stdout is a mirror, decided by
`OMPDESK_LOG_STDOUT` or, when it is unset, by development mode. The mirror
writes the same JSON lines as the file and applies the same `OMP_LOG_LEVEL`
filter:

| Environment | `NODE_ENV` | Stdout by default | How to change it |
| --- | --- | --- | --- |
| `bun run dev`, local development | `development` | on | `OMPDESK_LOG_STDOUT=0` |
| Production server (`next start`, the npm package) | `production` | off | `OMPDESK_LOG_STDOUT=1` |
| Docker image | `production` (set in the image) | off | `-e OMPDESK_LOG_STDOUT=1`, then `docker logs` shows the same records |

The mirror applies the same key redaction as the file path, including records the
SDK writes on its own.

`process.start` records `mode` as `development` or `production`, so a log file
says which of these produced it.

## Correlation ids

- **`requestId`** — minted by `proxy.ts` for every request matched by `/`,
  `/recover` and `/api/:path*`, and forwarded to the handler as
  `x-ompdesk-request-id`. The request wrapper (`withRequestLog`) puts it into an
  async context, so any record written while the handler runs carries it:
  HTTP completion, audit records, agent records started by that request, and
  nested route logs. A caller-supplied header is replaced, not trusted.
- **`actor`** — the proxy writes how the caller was admitted to
  `x-ompdesk-actor`: `local`, `password` or `recovery`. Request, audit and other
  correlated records can carry it.
- **`runId`** — minted for each accepted prompt. `agent.run.start`,
  `agent.run.command`, `agent.tool.end`, `agent.compaction.*` and
  `agent.run.end` share it. If the prompt came from an HTTP request, the same
  records also carry that `requestId`; `agent.run.end` repeats it so a record
  read alone still links back to the request.
- **`sessionId`** — present on agent, SSE and client records whenever known.
- **`toolCallId`** — pairs a tool's start time with its `agent.tool.end`.

A single failure can therefore be followed from `http.request` (requestId) to
`agent.run.*` (requestId + runId) to `agent.tool.end` (runId + toolCallId), and
from an `http.stream.close` back to the same requestId.

## Events by subsystem

### `process`

`process.start` — one record per server start, after the transport policy is
applied.

| Field | Meaning |
| --- | --- |
| `version` | ompdesk version. |
| `runtime` | `bun <version>` or `node <version>`. |
| `listenAddress` | Address derived from `--hostname`/`--port` or `OMPDESK_HOSTNAME`/`PORT`. |
| `authEnabled` | Whether password access is on at startup. |
| `mode` | `development` or `production`. |
| `pid` | Server process id. |

`process.memory` — one record per sample: immediately when sampling starts, then
once per `OMPDESK_MEMORY_SAMPLE_MS`. It is written by the server process only;
the session worker processes it spawns keep their own memory outside
`process.memoryUsage()`. Sampling starts with the transport policy: at
`process.start` in a source checkout, and on the first record when the server
runs from a build. Tests and callers that pass an explicit log file start no
sampler.

| Field | Meaning |
| --- | --- |
| `rss` | Resident set size: physical memory the process holds, in bytes. |
| `heapTotal` | JavaScript heap the runtime allocated, in bytes. |
| `heapUsed` | JavaScript heap currently in use, in bytes. |
| `external` | Native and buffer memory outside the JavaScript heap, in bytes. |
| `arrayBuffers` | Part of `external` held by `ArrayBuffer`s and `Buffer`s, in bytes; `0` when the runtime does not report it. |
| `uptimeSec` | Seconds since the process started. |
| `intervalMs` | The interval this monitor is sampling at, so a gap can be told from a changed cadence. |

`rss` is the figure a task manager shows. `heapUsed` against `heapTotal` says
whether the heap is near its allocation; `external` above `rss - heapTotal`
means the growth sits in buffers rather than in JavaScript objects.

### `http`

| Event | Fields |
| --- | --- |
| `http.request` | `requestId`, `route` (template, e.g. `/api/sessions/[id]`), `method`, `status`, `durationMs`, `slow`, optional `actor`; on a thrown handler `failed: true` and `error` with name/message/stack. One record per completed request. |
| `http.stream.open` | `requestId`, `route`, optional `sessionId`, `runtimeId`. |
| `http.stream.close` | Same ids plus `reason` (`cancelled`, `aborted`, `connect_failed`, `controller_closed`, `heartbeat_failed`) and `durationMs` for the connection lifetime. Written once per connection. |

Every API route handler is exported through `withRequestLog`. The two SSE
routes (`/api/agent/[id]/events` and `/api/agent/running/events`) are no
exception, but their response outlives the handler that returned its headers.
`http.request` for an SSE route therefore measures time to response headers;
the connection's own lifetime appears in `http.stream.open` /
`http.stream.close`. The stream opens before frames start and closes exactly
once on client cancel, request abort, connection setup failure, controller
failure or heartbeat failure; cleanup registered by the wiring step runs even
when that step throws.

### `agent`

| Event | Fields |
| --- | --- |
| `agent.run.start` | `sessionId`, `runId`, `provider`, `model`, `role`, `thinkingLevel`, `configuredThinkingLevel`, `requestId` (when present). |
| `agent.run.end` | `sessionId`, `runId`, `provider`, `model`, `role`, `thinkingLevel`, `configuredThinkingLevel`, `durationMs`, `stopReason` (`stop`, `length`, `toolUse`, `error`, `aborted`, `fork`, `unknown`), `turns`, `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `totalTokens`, `requestId`, `failed`/`error` when the run failed, `superseded: true` when a new prompt replaced an unfinished run. |
| `agent.run.command` | `sessionId`, `runId`, `command` (`steer`, `follow_up`, `abort`, `fork`, `compact`), `ok`, `durationMs`, optional `cancelled`, `newSessionId`, `error`. |
| `agent.tool.end` | `sessionId`, `runId`, `toolCallId`, `toolName`, `durationMs`, `isError`, `outputBytes`, `outputSize` (`empty`, `small`, `medium`, `large`, `huge`). |
| `agent.tool.incomplete` | `sessionId`, `runId`, `count`, `toolNames` (at most 10), `omitted` when more were open. Written when a run ends with tools that never produced an end event. |
| `agent.compaction.start` | `sessionId`, `runId`, `reason`, `action`. |
| `agent.compaction.end` | Same ids and `reason`/`action`, plus `durationMs`, `tokensBefore`, `tokensAfter`, `aborted`, `skipped`, `willRetry`, `errorMessage`. |

Only lifecycle summaries are recorded. Streaming token updates
(`message_update`) are ignored, and tool arguments/results are never read into
the log.

### `audit`

Every audit record uses the event name `audit.<action>` and carries `action`,
`outcome` (`success` or `failure`), optional `target`, optional `actor` and
`requestId`, plus bounded details (primitives only; at most 12 keys, 200
characters per value). URLs in targets, detail strings and error messages lose
userinfo, query values and fragments — including protocol-relative (`//host`)
forms and URLs the parser cannot canonicalize (for example an out-of-range
port).

| Area | Actions |
| --- | --- |
| Sessions | `session.delete`, `session.rename`, `session.archive` |
| Worktrees | `worktree.create`, `worktree.remove` |
| Models | `models.config.write`, `models.role.write` |
| Plugins | `plugin.install`, `plugin.uninstall`, `plugin.update`, `plugin.enable`, `plugin.disable` |
| Skills | `skill.install`, `skill.update`, `skill.toggle` |
| Credentials | `auth.api-key.set`, `auth.api-key.remove`, `auth.oauth.logout` |
| Password | `web-access.password.set`, `web-access.password.enable`, `web-access.password.disable`, `web-access.password.clear` |
| Recovery | `web-access.recovery.issue`, `web-access.recovery.redeem` |
| Project trust | `project-trust.grant`, `project-trust.revoke` |
| MCP | `mcp.config.write`, `mcp.server.toggle` |
| Settings | `settings.write` |

Failure paths write a record too, with the HTTP status or rejection reason in
the details. Recovery records use the target label `recovery-code`; the code
itself is never part of the record.

### `security`

These records are written by the proxy and the recovery endpoint. They carry
`requestId`, `route` and `method` where a request exists; they never carry
credentials or headers. The proxy reaches the same runtime-resolved logger as
the route handlers, so security events need no second logging stack and the SDK
is never bundled into the proxy bundle.

| Event | Level | Meaning and fields |
| --- | --- | --- |
| `security.host.denied` | warn | Host not in the allow-list. `reason: "untrusted-host"`. |
| `security.origin.denied` | warn | Cross-site request. `reason: "cross-site-request"`. |
| `security.auth.denied` | warn | Wrong or missing Basic Auth. `reason` is `invalid-credentials` or `missing-credentials`. |
| `security.auth.unavailable` | warn | Password access is on but the credential file cannot be read. `reason: "credential-file-unreadable"`. |
| `security.recovery.access` | info | The `/recover` page or recovery API was reached while locked. `reason: "recovery-surface"`, and the request proceeds as actor `recovery`. |
| `security.recovery.code.issued` | info / warn | `ok`, plus `expiresAt` on success or `reason`/`retryAfterMs` on failure. |
| `security.recovery.code.redeemed` | info / warn | `ok`, plus `reason` when redemption fails. The submitted code and the new password are not recorded. |

### `client`

`client.error` — one record for an uncaught browser error or an unhandled
promise rejection. `level` is `error`.

| Field | Meaning |
| --- | --- |
| `kind` | `error` or `unhandledrejection`. |
| `error.message` | Reported message, at most 1,000 characters. |
| `error.stack` | Stack, at most 2,000 characters, when available. |
| `url` | Page path only; query string and fragment are stripped. |
| `sessionId` | `?session=` from the page URL, when present. |
| `buildVersion` | Build that produced the error, when supplied. |

The browser installs the reporter at the app root. It reports at most one copy
of the same failure per 5 seconds, at most 20 reports per minute per page, and
never wraps `console.error`. It sends `POST /api/client-logs`, which the proxy
protects like every other API route. The endpoint accepts JSON only, rejects
unknown fields, caps the body at 16 KiB (413 beyond it, 400 for invalid JSON),
and rate-limits to 20 reports per minute per session (or observed client
address) and 200 per minute globally (429 with `Retry-After`).

## Settings → Logs

Open **Settings → Logs**. The panel is read-only:

- Level filter: all, error and above, warn and above, info and above, debug.
- Keyword search over the raw JSON line, debounced by 300 ms.
- File selector for the current file and its rotations, with size and last-write
  time.
- Follow latest, pause, refresh, and download of the selected file. Following
  keeps new lines in view only while the list is scrolled to the bottom;
  scrolling up leaves the reader where they are.
- Expand an entry to see its full JSON. Unparseable lines are shown with their
  parse error and raw text.
- Polling stops while the tab is hidden; while visible it polls every 2 seconds,
  slower than the SDK's one-second write batch so a page does not spin on an
  unchanged file. A truncated page is read again immediately, and the panel
  shows a catching-up state instead of an empty or no-match result until the
  backlog is drained.

The panel is backed by `GET /api/logs`:

| Parameter | Meaning |
| --- | --- |
| `file` | Basename from the file list. Omitted means the newest file. Names must match `omp.<day>.<pid>.log[.N]` for the running PID; separators, `..`, symlinks and other PIDs are rejected. |
| `cursor` | Raw byte offset of the next line; `0` starts at the beginning. |
| `tail=1` | With `cursor=0`, read the newest 256 KiB instead of the head, so the first screen of a large file does not replay from byte 0. A file whose last record is wider than that window falls back to the head so the record is still shown. |
| `fingerprint` | Identity from the previous page. A mismatch means the same basename was recreated, and the page restarts with `reset: true`. |
| `limit` | Entries per page, 1–1000, default 200. |
| `level` | `error`, `warn`, `info`, `debug` or `all` (default), applied after parsing. |
| `q` | Case-insensitive keyword, at most 200 characters, applied after parsing. |
| `download=1` | Return the selected file verbatim as an attachment. Requires `file`. |

Each page reads at most 1 MiB and stops at a line boundary unless it reaches
end-of-file. `truncated` says whether unread bytes remain, `nextCursor` is the
offset to request next, and `files` lists the current process's file set. A
`cursor` past the file's current size means the writer restarted the same
basename; the page then restarts at byte 0 and sets `reset: true`, and the
panel replaces its buffer instead of appending.

A filtered first page only covers the newest window of a file larger than
256 KiB, so its empty state says so and points at the older rotations instead of
claiming the whole file has no matches. A rotation that removes the file while
it is being read returns `404`, which the panel treats as retryable.

## What is never logged

- Prompts, model output, message content, chat history.
- Tool arguments, tool results, and file contents.
- Request or response bodies.
- Passwords, recovery codes in plaintext, API keys, OAuth tokens, cookies, and
  `Authorization` headers.

The logger drops keys that name these values and truncates everything else, so
a log file can be attached to an issue without redaction. Audit targets are
URL-redacted; client reports accept only their fixed field set; security records
name the rejection reason, not the credential that caused it.
