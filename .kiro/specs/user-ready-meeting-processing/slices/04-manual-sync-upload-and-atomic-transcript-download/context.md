# Slice 04 Context: Manual Sync Upload and Atomic Transcript Download

## Relevant Files

- `packages/shared/src/index.ts:1-65` - shared `Job`, `JobResponse`, `UploadOptions`, `JobStep`, language, template, and API response contracts.
- `packages/client/src/domain/models.ts:46-73` - client statuses, persisted `ClientJob`, and retry-classified `SyncError`.
- `packages/client/src/domain/ports.ts:9-61` - database, authenticated API, ingestion, Publication, and filesystem ports used by Manual Sync.
- `packages/client/src/services/api.ts:15-130` - Axios adapter for authenticated creation, status/list reads, upload progress, and error classification.
- `packages/client/src/services/syncManager.ts:7-150` - Manual Sync orchestration, reconciliation, Transcript/Summary fetch, upload, and retry filtering.
- `packages/client/src/services/db.ts:8-178` - LowDB client Job persistence, status queries, errors, and retry reset.
- `packages/client/src/utils/nodeFS.ts:5-43` - concrete UTF-8 read/write, existence, and path adapter; it currently has no rename/delete operation.
- `packages/client/src/services/ingestion.ts:13-190` - recording scan, persisted Job creation, timestamp extraction, options, and Meeting-linked ingestion.
- `packages/client/src/services/jobManager.ts:9-70` and `packages/client/src/commands/jobsHub.ts:17-171` - Jobs Hub reads/actions affected by client statuses and local artifacts.
- `packages/client/src/commands/sync.ts:17-47` - `runSync()` entry point and standalone dependency wiring for `SyncManager`.
- `packages/client/tests/services/{api,syncManager,db,ingestion,meetingIngestion,jobManager}.test.ts` and `packages/client/tests/utils/nodeFS.test.ts` - direct adapter/workflow persistence and preservation coverage.
- `packages/client/tests/commands/{chainIntegration,jobsHub}.test.ts` - Manual Sync command seam and Jobs Hub behavior.
- `packages/server/src/index.ts:21-77` - mandatory `x-api-key` hook and registration of upload/Job routes.
- `packages/server/src/routes/upload.ts:93-224` - shared authenticated `POST /jobs` and legacy `POST /upload` creation handler.
- `packages/server/src/routes/jobs.ts:46-123` - redacted Job status and dedicated `GET /jobs/:id/transcript`.
- `packages/server/tests/routes/transcriptionJobContract.test.ts:132-524,527-755` - locked creation, metadata, status-redaction, and Transcript download contract.

## Existing Behavior in Touched Files

- `SyncManager.runFullSyncCycle()` runs `scanDirectory -> updateActiveStates -> fetchResults -> pushPending` in that order (`syncManager.ts:22-35`); its orchestration test asserts call order (`syncManager.test.ts:67-87`).
- Reconciliation polls only `PROCESSING` Jobs; server `COMPLETED` becomes client `READY`, server `FAILED` becomes fatal local failure, and polling transport errors leave state unchanged (`syncManager.ts:41-62`).
- Result fetch selects `READY` Jobs, calls status again, directly writes `_summary.txt` and `_transcription.txt`, publishes to Obsidian, then calls `markCompleted`; fetch errors are logged and leave the Job `READY` (`syncManager.ts:68-97`).
- Upload uses the persisted `job.id`, `filePath`, and `options`; missing options prompt and persist first. It transitions through `UPLOADING`, then `PROCESSING`, and classifies `SyncError` auth failures as fatal (`syncManager.ts:102-130`).
- Pending selection includes `WAITING_UPLOAD` plus `FAILED` with `retryCount < 3`; the existing filter test excludes count 3 and `READY` (`syncManager.ts:137-149`, `syncManager.test.ts:138-157`).
- `ApiService` lazily creates an Axios client with 10-second default timeout, `x-api-key`, keep-alive, and unlimited body limits (`api.ts:18-34`). Upload currently posts `/upload` with timeout `0`, omits Recording time, and emits empty strings for undefined speaker bounds (`api.ts:54-95`).
- `getJobStatus()` uses `GET /jobs/:id`; there is no client Transcript operation. Axios errors become transient for no status, 5xx, `ECONNREFUSED`, or `ECONNRESET`; 401 is non-transient (`api.ts:97-129`).
- `NodeFileSystem.writeFile()` creates parent directories and writes directly to the requested final path; current port/tests expose read, write, exists, and path joins only (`nodeFS.ts:8-42`, `nodeFS.test.ts:19-99`).
- LowDB creates Job IDs only in `addRecording()` and stores `recordedAt` unchanged (`db.ts:41-55`). `getAll()` sorts newest first; `getReadyToFetch()` is status-exact; `setError()` increments retries and abandons at 4 (`db.ts:97-106,135-155`).
- Scan ignores unsupported/already tracked files; Meeting-linked ingestion preserves Meeting language/speaker options and returns `meetingId`/`noteTemplate` without prompts (`ingestion.ts:22-52,89-120`).
- Jobs Hub currently exposes artifact viewing/regeneration only for `COMPLETED`, retry for `FAILED`/`ABANDONED`, and cancel for `WAITING_UPLOAD` (`jobsHub.ts:17-40`).

## Patterns in Use

- Caller-facing seams are constructor-injected interfaces: `new SyncManager(api, db, note, ingestion, fs)` (`syncManager.ts:10-16`); tests use fresh `vi.fn()` collaborator objects (`syncManager.test.ts:22-64`).
- Client artifacts use `joinPathsInProjectFolder('transcriptions', \`${baseName}_transcription.txt\`)`; JobManager and Publication regeneration read the same naming convention.
- API methods catch transport failures and route them through one `formatError()`; the workflow records failures through `IClientDb.setError(id, message, isFatal?)`.
- Server creation validates metadata before multipart access, canonicalizes zoned `x-recorded-at` with `toISOString()`, accepts positive integer bounds, and omits absent bounds from persisted options (`upload.ts:96-146,189-210`).
- Server status deliberately redacts Transcript text and artifact paths; the dedicated route returns `text/plain` only for `COMPLETED` plus `TRANSCRIPT_READY` and reads the persisted `transcriptPath` (`jobs.ts:11-44,79-123`).

## Test Infrastructure

- Vitest discovers `packages/**/*.{test,spec}.{ts,tsx}` and aliases shared source (`vitest.config.ts`); full commands are `npm test` and `npm run build`, client-only is `npx vitest run packages/client/tests/`.
- Client tests use Vitest mocks/spies; `api.test.ts` mocks Axios, `fs`, and config, while `db.test.ts` uses a per-suite JSON file with cleanup.
- Existing preservation cases cover scan filtering (`ingestion.test.ts:60-100`), Meeting option/linkage behavior (`meetingIngestion.test.ts:52-128`, `meeting.test.ts:142-151`), reconciliation and retry filtering (`syncManager.test.ts:138-187`), and Jobs Hub actions (`jobsHub.test.ts:67-317`).
- Server `createHarness()` injects in-memory Job/store/queue/artifact collaborators and uses `app.inject`; Transcript cases assert authenticated 404, 409, and plain-text 200 outcomes (`transcriptionJobContract.test.ts:649-755`).

## Data Model

- Client storage is `client-db.json`, LowDB schema `{ jobs: ClientJob[], meetings: Meeting[] }`; there are no tables, migrations, or access-control rows (`db.ts:8-34`).
- `ClientJob` contains shared `id`, `originalFilename`, `recordedAt`, optional `options/error/currentStep/failedStep`, plus `filePath`, `clientStatus`, `retryCount`, optional `noteTemplate`, and optional `meetingId` (`models.ts:57-63`, shared `index.ts:49-58`).
- `UploadOptions` persists `language`, `template`, and optional numeric `minSpeakers`/`maxSpeakers` (`shared/src/index.ts:26-31`).
- HTTP access control is the server-wide `x-api-key` hook; missing/invalid credentials return stable 401 bodies before routes execute (`server/src/index.ts:53-70`).

## Integration Boundaries

- Manual Sync is exported to both the menu and Commander through `runSync(syncManager)`; standalone wiring supplies concrete `ApiService`, `LowDB`, `IngestionService`, `NoteService`, and `NodeFileSystem` (`commands/sync.ts:17-40`).
- `IApiService` currently exports `uploadMeeting(filePath, id, options, onProgress?)`, `getJobStatus(jobId)`, and `getJobs()` (`ports.ts:27-53`); server operations are `POST /jobs`, `GET /jobs/:id`, and `GET /jobs/:id/transcript`.
- The server contract uses server `COMPLETED` to mean Transcript production is complete; ADR-0001 and `CONTEXT.md` reserve canonical Job completion for both Transcript and Summary.

## Potential Conflicts

- Recent server commits `60d0942` through `5676d2d` added shared creation, strict metadata validation, redacted status, and dedicated Transcript retrieval; `a439fec` and `2684b2f` changed completion and canonical path behavior.
- Slice 02 handoff states the client does not send required `x-recorded-at`; slice 03 handoff states server `COMPLETED` means Transcript-ready and exact persisted Transcript paths are authoritative.
- Slice 01 notes LowDB/steno writes a sibling `.tmp`; fixed database paths can collide across concurrent test workers.
- No `TODO`, `FIXME`, `HACK`, or `XXX` markers were found in the inspected client/server source and tests.
