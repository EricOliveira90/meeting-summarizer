# Context: Existing Recording to Downloaded Transcript

## Relevant Files
- `.kiro/specs/user-ready-meeting-processing/issues/05-existing-recording-to-downloaded-transcript.md:9-23` defines the integrated Manual Sync journey, ordered server states, atomic Transcript, redaction, failure, and acceptance-test scope.
- `CONTEXT.md:8-34`, `docs/adr/0001-split-transcription-and-summarization.md:5-18`, and `docs/ARCHITECTURE.md:5-14` assign the durable Job lifecycle to the notebook and transcription/artifacts to the home server.
- `packages/shared/src/index.ts:1-65` defines server Job states, `JobStep`, upload metadata, and status responses.
- `packages/client/src/services/ingestion.ts:13-82`, `packages/client/src/services/db.ts:41-56`, `packages/client/src/services/syncManager.ts:22-189`, `packages/client/src/services/api.ts:55-153`, and `packages/client/src/utils/nodeFS.ts:8-50` contain the existing-Recording journey.
- `packages/client/src/commands/sync.ts:17-40` exposes Manual Sync and constructs its concrete adapters.
- `packages/server/src/index.ts:21-77`, `routes/upload.ts:93-224`, `routes/jobs.ts:46-123`, and `services/queue.ts:84-163` expose and execute the authenticated transcription interface.
- Slice handoffs 02-04 record the authenticated/redacted HTTP contract, server `COMPLETED` as Transcript-ready rather than canonical Job completion, the Summary-free production graph, and the client Job remaining `READY` after atomic download.

## Existing Behavior in Touched Files
- `IngestionService.scanDirectory()` scans the configured output directory for `.mkv`, `.mp3`, `.opus`, `.m4a`, and `.wav`, skips exact paths already in the client database, and ingests each new path (`packages/client/src/services/ingestion.ts:14-53`).
- Orphan ingestion prompts for a title and processing options, renames the Recording, derives `recordedAt`, creates a Job, and persists options (`packages/client/src/services/ingestion.ts:59-82`).
- `LowDB.addRecording()` assigns a UUID and persists the renamed path, filename, timestamp, `WAITING_UPLOAD`, and zero retries (`packages/client/src/services/db.ts:41-56`).
- A Manual Sync cycle runs scan, active-state reconciliation, ready-result download, then pending upload in that order (`packages/client/src/services/syncManager.ts:22-35`).
- Upload first queries the same Job ID. Existing pending/processing Jobs become local `PROCESSING`; existing Transcript-ready Jobs become `READY`; only exact `404/JOB_NOT_FOUND` proceeds to creation (`packages/client/src/services/syncManager.ts:106-158`).
- `ApiService.uploadMeeting()` posts multipart media to `/jobs` with API key, persisted Job ID, normalized original time, language, template, and defined speaker bounds (`packages/client/src/services/api.ts:55-102`).
- Later Manual Sync cycles poll local `PROCESSING` Jobs and map only server `COMPLETED/TRANSCRIPT_READY` to local `READY` (`packages/client/src/services/syncManager.ts:41-65`).
- Ready Transcripts are fetched from `/jobs/:id/transcript`, written to `transcriptions/<recording-base>_transcription.txt.<job-id>.tmp`, read back exactly, and renamed to the final sibling path; the Job remains `READY` (`packages/client/src/services/syncManager.ts:71-101`).
- Server creation validates metadata and media before atomically committing the Recording, replacing the Job record, and queueing it (`packages/server/src/routes/upload.ts:96-220`).
- Server processing persists `QUEUED`, `EXTRACTING_AUDIO`, `TRANSCRIBING`, then atomic `COMPLETED/TRANSCRIPT_READY`; it invokes extraction and transcription only (`packages/server/src/services/queue.ts:84-145`).

## Patterns in Use
- Caller-facing collaborators are injected through client ports and `ServerDependencies` (`packages/client/src/domain/ports.ts:4-69`; `packages/server/src/domain/ports.ts:5-41`).
- External Axios failures become `SyncError` with HTTP status, server code, and transient classification (`packages/client/src/services/api.ts:134-153`).
- Server authentication is a Fastify `onRequest` hook returning stable `AUTH_REQUIRED` or `AUTH_INVALID` codes (`packages/server/src/index.ts:53-70`).
- Status responses recursively remove text, artifact paths, recovery metadata, and artifact-root string values (`packages/server/src/routes/jobs.ts:11-44,197-199`).
- Artifact commits use sibling staging plus rename on both server upload and client download (`packages/server/src/routes/upload.ts:173-188`; `packages/client/src/services/syncManager.ts:75-99`).
- The production server graph exports extraction, transcription, queue, storage, and recovery; Summary modules are absent from that graph (`packages/server/src/services/index.ts:1-6`).

## Test Infrastructure
- Root scripts run serial shared/client/server builds and Vitest; production audit is `npm audit --omit=dev --audit-level=high` (`package.json:8-17`).
- Vitest includes `packages/**/*.{test,spec}.{ts,tsx}` and aliases shared imports to source (`vitest.config.ts:4-20`).
- Client unit tests cover scan/filter/ingestion (`packages/client/tests/services/ingestion.test.ts:60-220`), upload headers and stable error codes (`packages/client/tests/services/api.test.ts:62-256`), reconciliation and atomic download recovery (`packages/client/tests/services/syncManager.test.ts:388-675`), and the Manual Sync command seam (`packages/client/tests/commands/chainIntegration.test.ts:11-28`).
- Server contract tests cover creation validation, redacted progress, and Transcript outcomes through Fastify injection (`packages/server/tests/routes/transcriptionJobContract.test.ts:131-754`).
- Server lifecycle tests expose all four states through authenticated status requests (`packages/server/tests/services/processingLifecycle.test.ts:28-131`).
- The processing smoke uses real FFmpeg, a replaceable fake Whisper process, production artifact storage, and authenticated HTTP upload/status/download (`packages/server/tests/services/processingSmoke.test.ts:54-178`).
- No current test imports both client workflow services and `buildServer`; client HTTP tests mock Axios and server interface tests use Fastify injection.

## Data Model
- `ClientJob` adds local path, local status, retries, optional Meeting ID, and note template to the shared Job (`packages/client/src/domain/models.ts:46-63`).
- Client persistence stores `{ jobs, meetings }` in `client-db.json`; server persistence stores `{ jobs }` in `db.json`. Both use LowDB JSON, with no migration layer or row-level access rules (`packages/client/src/services/db.ts:8-34`; `packages/server/src/services/db.ts:7-40`).
- Shared server stages are `QUEUED`, `EXTRACTING_AUDIO`, `TRANSCRIBING`, and `TRANSCRIPT_READY`; shared server states remain `PENDING`, `PROCESSING`, `COMPLETED`, and `FAILED` (`packages/shared/src/index.ts:1-8`).
- `JobRecord` adds server-only upload, audio, Transcript, Summary paths, step timestamps, and recovery attempts (`packages/server/src/domain/models.ts:3-10`).
- HTTP access control is the server-wide `x-api-key` hook; missing and invalid credentials return distinct 401 codes before route behavior (`packages/server/src/index.ts:53-70`).

## Integration Boundaries
- Notebook-to-server calls are authenticated `POST /jobs`, `GET /jobs/:id`, and `GET /jobs/:id/transcript` (`packages/client/src/services/api.ts:72-98,104-123`).
- `buildServer()` permits replacement of Job store, queue, and artifact store; queue processing separately permits replacement of FFmpeg and Whisper adapters (`packages/server/src/index.ts:16-40`; `packages/server/src/services/queue.ts:13-21`).
- Transcript text crosses only the dedicated plain-text route; status and list routes return redacted Job metadata (`packages/server/src/routes/jobs.ts:50-123`).
- The client filesystem boundary supplies write, verification read, atomic rename, cleanup, existence, and path joining (`packages/client/src/domain/ports.ts:61-69`).

## Potential Conflicts
- Recorder filenames use `YYYY-MM-DD_HH-mm_Title.wav`, while ingestion recognizes only `YYYY-MM-DD HH-mm-ss`; unmatched existing Recordings receive ingestion time as `recordedAt` (`packages/client/src/commands/record.ts:21-37`; `packages/client/src/services/ingestion.ts:122-143`).
- Server `POST /jobs` does not query for an existing ID before staging; it replaces the stored record and queues work after a repeated creation request (`packages/server/src/routes/upload.ts:173-220`).
- Active-state polling catches every status-request error without persisting its HTTP status or stable code (`packages/client/src/services/syncManager.ts:45-63`).
- Transcript transfer failures are logged, temporary data is removed best effort, and the Job remains `READY`; no failure code is persisted (`packages/client/src/services/syncManager.ts:82-100`).
- `ingestFileWithMeeting()` returns `meetingId` and `noteTemplate` on an enriched object, but its database calls persist only the base Job and upload options (`packages/client/src/services/ingestion.ts:89-120`).
- `JobManager` reads Transcript artifacts only for local `COMPLETED` Jobs, while this journey intentionally leaves downloaded Transcripts at `READY` (`packages/client/src/services/jobManager.ts:19-43`; `packages/client/tests/services/syncManager.test.ts:448-475`).
- No `TODO` or `FIXME` marker occurs in the inspected client/server source or tests; `TODOS.md:31-37` separately records deferred background status polling.
- Git history places server tracer work at `54bbff2` and Manual Sync work through `82b89ba`; HEAD is `82b89ba`, and the worktree was clean before this file was created.
