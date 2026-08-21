# Slice Contract — Manual Sync Upload and Atomic Transcript Download

**Parent PRD:** .kiro/specs/user-ready-meeting-processing/prd.md
**GH issue:** #47
**Status:** LOCKED
**Negotiation round:** 4

## Scope lock
Excluding server processing, Summary creation, Publication, Jobs Hub changes, and the future background runner, this slice makes the existing notebook Manual Sync tracer bullet exact and recoverable: it reconciles the persisted Job ID before creation, submits unchanged metadata only when absent, polls status, and atomically commits the ready Transcript while leaving the Job `READY` for later Summary creation (issue #47; PRD stories 9-10, 18-19; ADR-0001).

### In scope
- For a Job with complete persisted options, upload preserves its ID, `recordedAt`, Meeting linkage, and options. A Job missing options keeps the existing prompt-and-persist behavior before upload; prompting must not change its ID, `recordedAt`, or Meeting linkage (issue #47 AC 1; explorer context: `SyncManager.pushJob`).
- Before creating each `WAITING_UPLOAD` or retry-eligible `FAILED` Job, Manual Sync calls authenticated `GET /jobs/:id` with its persisted ID. Any found Job suppresses creation and reconciles locally: server `PENDING`/`PROCESSING` becomes `PROCESSING`, `COMPLETED/TRANSCRIPT_READY` becomes `READY`, and `FAILED` keeps the existing fatal-failure mapping. Only exact 404 `JOB_NOT_FOUND` permits one creation attempt. Transport and 5xx failures use the existing transient mapping; auth and other non-transient failures use the existing fatal mapping; none permits creation (issue #47 "exact and recoverable"; PRD stories 6 and 9).
- For persisted Job `job-123` at `2026-08-20T09:30:00-03:00`, authenticated `POST /jobs` sends `x-job-id: job-123`, `x-recorded-at: 2026-08-20T12:30:00.000Z`, and persisted language/template (issue #47 AC 2-4; #45 creation contract).
- Positive integer persisted speaker bounds are decimal headers; each undefined bound omits its header (issue #47 AC 3; #45 sparse-option contract).
- Creation, `GET /jobs/:id` polling, and `GET /jobs/:id/transcript` plain-text download stay behind `IApiService` and use the configured credential; status bodies are not artifact payloads (issue #47 AC 4; #45 redacted-status contract).
- Server `COMPLETED` at `TRANSCRIPT_READY` maps locally to `READY`; download writes a sibling temporary file, verifies it by byte-for-byte read-back, then renames it atomically to `transcriptions/<recording-base>_transcription.txt` (issue #47 AC 5; PRD atomic-write decision).
- Write, verification read/mismatch, rename, timeout, and interrupted-download failures remove temporary data, preserve any prior final Transcript byte-for-byte, leave the Job `READY`, avoid re-upload, and emit stderr `Transcript download failed for <job-id>; retry on next Manual Sync: <reason>` (issue #47 AC 6).
- Success leaves no temporary data, creates no Summary or Publication, never calls `markCompleted`, and leaves the Job `READY` for Summary creation (issue #47 AC 7; ADR-0001).

### Non-goals (explicit out-of-scope)
- Server routes, processing, artifacts, authentication, or schemas; issues #45-46 own those contracts (issue #47 notebook scope).
- Integrated client/server process composition; slice #33 owns that tracer bullet (issue #33).
- Summary Providers, Summary writes, Publication, or canonical Job completion; slice #34 and later slices own them (ADR-0001; PRD stories 20-33).
- Automatic enqueue/watch, lifecycle migration, backoff, restart recovery, or replacement of Manual Sync; slice #35 owns the normal workflow (PRD Manual Sync decision).
- Jobs Hub changes, server retry/cancellation, retention, bridge/startup, or readiness diagnostics (PRD stories 34-50).

### Existing behavior to preserve
- Sync order `scanDirectory -> updateActiveStates -> fetchResults -> pushPending` and command delegation — `packages/client/src/services/syncManager.ts:SyncManager.runFullSyncCycle`, `packages/client/src/commands/sync.ts:runSync`.
- Scan filtering, persisted Recording time, orphan option prompts, and Meeting-linked no-prompt ingestion — `packages/client/src/services/ingestion.ts:IngestionService`.
- Routine reconciliation still polls only `PROCESSING`; map server success to `READY`, fatal server failure to local fatal failure, and leave polling transport failures unchanged — `packages/client/src/services/syncManager.ts:SyncManager.updateActiveStates`.
- Creation candidates remain `WAITING_UPLOAD` plus `FAILED` below three retries; each now receives the required pre-creation lookup, while `READY` is never uploaded — `packages/client/src/services/syncManager.ts:SyncManager.pushPending`.
- LowDB ID creation, newest-first reads, exact `READY` selection, retry counts, Meeting linkage/options, and existing Jobs Hub actions/artifact names — `packages/client/src/services/db.ts:LowDB`, `packages/client/src/services/jobManager.ts:JobManager`, `packages/client/src/commands/jobsHub.ts:jobsHubCommand`.

### Changes to existing behavior (only if the issue asks for it)
- Eligible creation candidates query their persisted ID first and create only after stable `404 JOB_NOT_FOUND`: "Make the notebook side of the manual tracer bullet exact and recoverable" (issue #47).
- Upload uses authenticated `POST /jobs` with persisted ID, canonical Recording time, and sparse options: "Manual Sync submits persisted Job metadata" (issue #47).
- Result fetch uses dedicated Transcript retrieval and verified atomic commit instead of hydrated status text/direct final writes: "writes the ready Transcript atomically" (issue #47).
- Transcript success leaves the Job `READY` and does not create Summary/Publication or complete it: "without completing the Job" (issue #47).

## Files expected to change
- packages/client/src/domain/ports.ts
- packages/client/src/services/api.ts
- packages/client/src/services/syncManager.ts
- packages/client/src/utils/nodeFS.ts
- packages/client/tests/services/api.test.ts
- packages/client/tests/services/syncManager.test.ts
- packages/client/tests/utils/nodeFS.test.ts

## New patterns / deps / schema (if any)
- Extend existing API/filesystem ports for persisted Recording time, dedicated Transcript retrieval, and verified same-directory temporary replacement; no dependency or persisted-schema change (issue #47; Conventions).

## Test plan
- Given complete persisted `job-123` with the issue timestamp, Meeting linkage, language/template, and bounds `2/5`, when authenticated lookup returns exact 404 `JOB_NOT_FOUND`, then Manual Sync performs one lookup followed by exactly one `POST /jobs`, captured headers are canonical, one unchanged local Job remains, and status becomes `PROCESSING`.
- Given a creation candidate, including one whose prior accepted response was lost, when table-driven lookup returns `PENDING`, `PROCESSING`, `COMPLETED` at `TRANSCRIPT_READY`, or `FAILED` with an error, then creation is called zero times and the exact local outcomes are respectively `PROCESSING`, `PROCESSING`, `READY`, or `ABANDONED` with that error and unchanged retry count; ID, Recording time, Meeting linkage, and options remain unchanged.
- Given a creation candidate, when table-driven lookup fails by transport/no response, authenticated `401`, or `500`, then creation is called zero times; transport and `500` produce retryable `FAILED` with retry count incremented once, while `401` produces `ABANDONED` with retry count unchanged, and each exposes the lookup error.
- Given a persisted Job missing options, when Manual Sync uploads it, then the existing prompt result is persisted and sent while ID, `recordedAt`, and Meeting linkage stay unchanged.
- Given each speaker bound is independently undefined, when uploaded, then its header key is absent; positive present bounds are decimal strings.
- Given a `PROCESSING` Job reaches server `COMPLETED/TRANSCRIPT_READY`, when Manual Sync runs, then it uses authenticated status and dedicated Transcript operations through `IApiService` and maps the Job to `READY`.
- Given a ready Job and exact Transcript text, when download succeeds, then the temporary path has the final path's directory, read-back matches, rename targets the expected final path, temporary data is absent, and the Job remains `READY` without Summary, Publication, or completion.
- Given a prior final Transcript sentinel, when each write, verification-read, mismatch, or rename fault occurs, then the sentinel is unchanged, temporary data is absent, stderr has the exact retry message with Job ID/reason, and the Job remains `READY`.
- Given a prior final Transcript sentinel, when download times out or is interrupted, then before any retry the sentinel is byte-for-byte unchanged, temporary data is absent, stderr has the exact retry message, the Job remains `READY`, and no upload occurs; when a later Manual Sync succeeds, the exact Transcript commits.
- Given existing client suites, when `npm test` runs, then scan, reconciliation, retry filtering, Meeting linkage, command order, Jobs Hub, and artifact behavior retain their outcomes.

## Definition of done
- [ ] Persisted metadata reaches authenticated creation exactly, with tested complete- and missing-option behavior
- [ ] Pre-creation lookup prevents duplicate creation after an uncertain accepted request
- [ ] Dedicated Transcript retrieval commits only after same-directory temporary verification and atomic rename
- [ ] Every specified failure preserves the final artifact and exposes the exact retryable outcome
- [ ] Success leaves the Job `READY` and never creates a Summary/Publication or marks it completed
- [ ] All tests pass locally
- [ ] No regression in existing suite
- [ ] Evaluator has signed off via qa-report.md
