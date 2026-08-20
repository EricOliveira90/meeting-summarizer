# User-Ready Client/Server Roadmap

## Goal

Run the home PC as an unattended transcription server and the notebook as the
user-facing client:

1. The notebook records a meeting.
2. The notebook uploads the recording through an SSH bridge hosted on Google
   Cloud.
3. The home PC extracts audio and transcribes it with WhisperX.
4. The notebook downloads the transcript.
5. The notebook summarizes the transcript with a locally installed Kiro,
   Claude, or Codex command-line adapter.
6. A durable jobs manager shows progress, errors, retry and cancellation across
   the whole workflow.

## Current Baseline

| Area | Current state | Gap to the goal |
| --- | --- | --- |
| Recording | `audio-rec` adapter, device setup, meeting picker | Completion uses a fixed two-second wait and does not durably link the recording to its meeting |
| Upload | Multipart upload with a stable client job ID | No resumable upload, recorded timestamp header, duplicate-state guard, or end-to-end test through the tunnel |
| Server processing | Queue, FFmpeg, WhisperX, Gemini summary | The real extraction path passes an empty output directory; generated paths do not consistently use `FileManagerService` |
| Result download | Client polls a job and writes text files | Transcript filename written by WhisperX differs from the filename read by the job route |
| Summarization | Gemini runs on the server | Must move to the client and gain Kiro, Claude, and Codex adapters |
| Jobs | Separate client and server statuses, local Jobs Hub | No single lifecycle, background worker, server action routing, or automatic polling |
| Bridge | Manual SSH commands documented in the README | No checked-in configuration template, health supervision, boot startup, or setup verification |
| Deployment | README describes PM2 | Production build fails; PM2 config is ignored; `docker-compose.yml` runs unrelated Neo4j |
| Verification | 233 tests pass | Tests mock away several broken real paths; there is no two-machine or installed-tool smoke test |
| Security | SSH transport and optional API key | Server starts without auth when `API_KEY` is absent; dependencies include production high/critical advisories |

## Target Module Shape

### Transcription Server

The server should expose a small transcription-job interface:

- `POST /jobs` uploads a recording and creates or returns an idempotent job.
- `GET /jobs/:id` returns server stage, progress, error metadata, and transcript
  availability.
- `GET /jobs/:id/transcript` downloads the transcript.
- `POST /jobs/:id/retry` retries failed server work.
- `DELETE /jobs/:id` cancels and deletes remote work.
- `GET /health/ready` verifies database, storage, FFmpeg, Python, WhisperX, GPU
  visibility, and queue readiness.

The server owns upload storage, extraction, transcription, remote retry, and
remote retention. It does not summarize.

### Client Workflow Runner

The client should expose one workflow interface to the CLI:

- `enqueue(recording, meetingOptions)`
- `list(filter, page)`
- `get(jobId)`
- `retry(jobId)`
- `cancel(jobId)`
- `runOnce()` and `watch()`

Its implementation owns upload, server polling, transcript download, local
summarization, note generation, and reconciliation after restart. The CLI and
tests cross this same seam.

### Local Summary Provider

Use one client-side `SummaryProvider` interface:

```ts
interface SummaryProvider {
  readonly name: 'kiro' | 'claude' | 'codex';
  checkAvailability(): Promise<ProviderAvailability>;
  summarize(input: SummaryInput, signal?: AbortSignal): Promise<SummaryResult>;
}
```

Each adapter invokes its installed CLI non-interactively, keeps credentials on
the notebook, applies a timeout, captures stderr, and writes no transcript to a
shell argument or log. Exact executable flags must be covered by adapter
contract tests because the three tools do not share a command protocol.

## Durable Job Lifecycle

Use one client-visible stage rather than inferring state from two unrelated
enums:

`RECORDED -> UPLOADING -> SERVER_QUEUED -> EXTRACTING -> TRANSCRIBING ->
TRANSCRIPT_READY -> DOWNLOADING -> SUMMARIZING -> COMPLETED`

Terminal stages are `FAILED` and `CANCELLED`. Persist:

- current stage and stage timestamps;
- server job ID;
- meeting ID and recording path;
- transcript, summary, and note paths;
- selected summary provider and template;
- attempt count per operation;
- structured failure operation, message, and retryability;
- last successful reconciliation time.

Retry resumes the failed operation. It must not re-upload, re-transcribe, or
re-summarize work that has a verified artifact.

## Ordered Implementation

### 0. Repair the Executable Baseline

1. Build `shared` before `client` and `server`; make `npm run build` deterministic
   from a clean clone.
2. Remove the unrelated Neo4j compose file or replace it with deployment that
   actually represents this system.
3. Make all server artifact paths come from one `FileManagerService` instance.
4. Pass real audio and transcript output paths into FFmpeg and WhisperX.
5. Track and cancel the actual FFmpeg/WhisperX child process.
6. Make recovery inspect artifacts and genuinely resume, or remove the resume
   claim until implemented.
7. Require `API_KEY` at startup and update vulnerable production dependencies.
8. Add a real processing smoke test with short fixture audio and fake Whisper
   and summary executables.

Exit criterion: clean install, build, tests, server startup, upload, extraction,
transcription, transcript fetch, retry, and restart recovery all pass.

### 1. Split Transcription from Summarization

1. Remove `SUMMARIZING` and Gemini execution from the server queue.
2. Finish a server job at `TRANSCRIPT_READY`.
3. Add the dedicated transcript download route.
4. Send the original recording timestamp and validated options during upload.
5. Define shared, versioned request and response schemas and validate headers,
   query parameters, limits, and state transitions.
6. Correct the client paginated-list contract; it currently expects an array
   while the server returns `{ jobs, total, page, limit }`.

Exit criterion: an uploaded recording produces a transcript that the notebook
can download without any server-side AI summary key.

### 2. Implement Client Summary Providers

1. Move prompts/templates into a shared client-side summary module.
2. Implement Kiro, Claude, and Codex command adapters behind
   `SummaryProvider`.
3. Add provider discovery and a setup check that reports missing executable,
   authentication, model, and permission separately.
4. Add provider/model selection to config and per-meeting override.
5. Store raw provider output and normalized summary separately.
6. Add timeout, cancellation, bounded output, redacted logging, and deterministic
   failure classification.

Exit criterion: the same downloaded transcript can be summarized by each
configured adapter, and one adapter's failure can be retried or switched without
retranscription.

### 3. Replace Sync with a Durable Workflow Runner

1. Migrate the client database to the durable lifecycle above with schema
   versioning and backups.
2. Persist the recording-to-meeting relationship immediately when recording
   starts and enqueue immediately after the completed event.
3. Replace the fixed recording delay with completion/error event awaiting.
4. Replace manual `Sync & Summarize` orchestration with `runOnce()` plus a
   long-running `watch()` worker.
5. Reconcile local state against the server after client or server restart.
6. Use operation-specific exponential backoff and retry limits.
7. Write transcript and summary atomically before advancing stages.
8. Read config lazily or rebuild affected adapters after settings change.

Exit criterion: restarting either machine at every stage eventually resumes the
job without duplicate work or lost state.

### 4. Make the Jobs Hub Operational

1. Show stage, elapsed time, attempt count, provider, last error, and whether the
   server is reachable.
2. Poll while the hub is open and paginate the list.
3. Route retry by failed operation: upload locally, transcription remotely,
   summarization locally.
4. Route cancellation to both the local runner and server when applicable.
5. Add "switch summary provider", "download transcript again", "regenerate
   note", and "delete local and remote artifacts".
6. Keep local and server deletion semantics explicit and confirm destructive
   actions.

Exit criterion: every non-terminal job has visible progress, and every failed
job has an action that either recovers it or explains why it cannot recover.

### 5. Productize the Google Bridge and Both Machines

1. Add checked-in example configuration for the GCP VM, home reverse tunnel,
   and notebook local tunnel. Keep keys and host-specific values external.
2. Harden SSH with a dedicated user, key-only auth, pinned host key,
   `ExitOnForwardFailure`, keepalives, and loopback-only remote forwarding.
3. Add scripts to install/start/stop/status the server, worker, and tunnels.
4. Register home server and reverse tunnel for Windows boot startup.
5. Register the notebook worker and local tunnel for user login startup.
6. Add a doctor command that checks the local tools, tunnel, authenticated
   health route, upload limit, disk space, and AI provider.
7. Add log rotation, retention settings, database backup, and disk cleanup.
8. Document VM creation, SSH server settings, Windows service setup, upgrade,
   rollback, and secret rotation.

Exit criterion: after both machines reboot, a notebook health check reaches an
authenticated ready server through the bridge without opening the home router.

### 6. End-to-End Release Gate

Automate or record a repeatable acceptance run:

1. Reboot both machines.
2. Record a short microphone and system-audio fixture.
3. Observe every job stage without manually running sync.
4. Disconnect and reconnect the notebook during upload.
5. Restart the server during transcription and verify recovery.
6. Download the transcript and summarize with each installed provider.
7. Regenerate the Obsidian note.
8. Retry a forced transcription failure and a forced summary failure.
9. Cancel queued and active jobs.
10. Verify no secrets or transcript contents appear in logs.

## Recommended Ticket Breakdown

Create tickets in this dependency order:

1. Clean build and production packaging
2. Canonical server artifact paths and real-process cancellation
3. Real transcription smoke test
4. Mandatory auth, validation, and dependency upgrades
5. Transcription-only server contract
6. Client/server contract and recorded-time correction
7. Recording completion and meeting linkage
8. Client job schema migration and workflow runner
9. Codex summary adapter
10. Claude summary adapter
11. Kiro summary adapter
12. Provider setup and switching
13. Operational Jobs Hub
14. Google bridge configuration and supervision
15. Windows startup, doctor, logs, retention, and backup
16. Two-machine acceptance test and runbook

Tickets 9-11 can run in parallel after ticket 8 defines the provider interface.
Ticket 14 can run in parallel with tickets 8-13 after the server contract is
stable.

## Issue Tracker Cleanup

Open issues 27-31 describe code already merged on `main`; verify their
acceptance criteria against the current implementation, close those that are
actually satisfied, and move failed criteria into the roadmap tickets above.
Do not use the existing green tests alone as evidence because they do not cover
the production executable path.

