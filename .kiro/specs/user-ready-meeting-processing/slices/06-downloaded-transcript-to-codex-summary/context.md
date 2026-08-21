# Slice 06 Context: Downloaded Transcript to Codex Summary

## Scope and ownership

- [GitHub issue #34](https://github.com/EricOliveira90/meeting-summarizer/issues/34) is the acceptance source: select Codex in setup, report executable/auth/model readiness separately, invoke it locally and non-interactively, keep Transcript text out of argv/logs, bound/cancel execution, classify failures, atomically persist the Summary, complete the Job, and expose both artifacts in Jobs Hub.
- Canonical ownership is notebook Summary creation and Publication, home-PC Transcript creation only; a Job completes after both Transcript and Summary exist, while Publication has an independent outcome (`CONTEXT.md:8-34`, `docs/adr/0001-split-transcription-and-summarization.md:7-18`, `docs/PRODUCT.md:13-21`).
- The workflow runner is the highest end-to-end interface; the documented adapter boundaries are process, storage, clock, server HTTP, provider, and Publication (`docs/ARCHITECTURE.md:5-14`, `docs/CONVENTIONS.md:3-10`).
- Security and persistence rules are explicit: external data is validated, artifacts/state are written atomically before stage advancement, and secrets/Transcript text must not enter logs or shell arguments (`docs/CONVENTIONS.md:13-20`).

## Relevant files

- `packages/client/src/domain/{models,configs,ports}.ts` - Client Job/configuration shapes and persistence, file, API, and Publication ports.
- `packages/client/src/services/{syncManager,db,config,setup,jobManager}.ts` - Transcript download workflow, LowDB persistence, setup/configuration, and completed-artifact reads.
- `packages/client/src/commands/{sync,jobsHub}.ts` - Manual workflow composition and inspect/read/retry/cancel user flow.
- `packages/client/src/utils/nodeFS.ts` - UTF-8 reads/writes, atomic rename, cleanup, existence, and path operations.
- `packages/shared/src/index.ts` - Server Job stages, upload options, timestamps, and HTTP response contracts.
- `packages/server/src/{routes/jobs,services/queue,services/index}.ts` - Authenticated Transcript boundary and Summary-free production processing graph.
- `packages/client/tests/{services,integration,commands}/` - Workflow, setup, storage, Jobs Hub, and cross-machine behavior tests.
- `packages/server/tests/{services,routes}/` - Child-process protocol and Transcript-only server contract tests.

## Current data model and gaps

- Shared server contracts expose `JobState`, server-only steps through `TRANSCRIPT_READY`, upload language/template options, and response timestamps; they contain no client Summary Provider contract (`packages/shared/src/index.ts:1-31`, `packages/shared/src/index.ts:44-65`).
- `ClientJob` currently adds only `filePath`, a coarse `ClientJobStatus`, `retryCount`, note template, and meeting ID. It does not persist transcript/summary paths, provider/model, per-stage timestamps, operation attempts, or structured failures (`packages/client/src/domain/models.ts:46-74`).
- The intended durable lifecycle includes `TRANSCRIPT_READY -> DOWNLOADING -> SUMMARIZING -> COMPLETED` and requires artifact paths, provider/template, timestamps, operation attempts, and structured retryability (`plans/user-ready-system.md:83-103`).
- `IClientDb` offers coarse status/error methods, and the client ports contain no `SummaryProvider`, process runner, clock, or workflow cancellation interface (`packages/client/src/domain/ports.ts:9-25`, `packages/client/src/domain/ports.ts:27-69`).
- LowDB stores unversioned `{ jobs, meetings }`; each mutation writes directly, `markCompleted` only changes status, and retry always resets to upload, which conflicts with Summary-only retry without retranscription (`packages/client/src/services/db.ts:8-34`, `packages/client/src/services/db.ts:109-171`).
- `AppConfig` has audio/server/path/Obsidian sections only. Setup prompts and saves only server and paths, so provider/model selection and separate readiness results are new surfaces (`packages/client/src/domain/configs.ts:31-37`, `packages/client/src/services/setup.ts:4-60`).

## Existing behavior and likely touch points

- `SyncManager.runFullSyncCycle()` ingests, reconciles server state, downloads ready Transcripts, then uploads pending Recordings (`packages/client/src/services/syncManager.ts:22-35`).
- Server `COMPLETED + TRANSCRIPT_READY` maps to client `READY`; the downloader writes `<name>_transcription.txt.<job>.tmp`, verifies it, then renames atomically. Failure removes the temp file, logs only job ID/reason, and leaves the Job ready for retry (`packages/client/src/services/syncManager.ts:41-64`, `packages/client/src/services/syncManager.ts:69-100`).
- No current step reads that downloaded Transcript, invokes a Summary Provider, writes a Summary, calls `markCompleted`, or publishes. The existing test explicitly asserts the atomic download leaves `READY` and makes no completion/Publication calls (`packages/client/tests/services/syncManager.test.ts:448-474`).
- Domain and service modules are exported through barrels (`packages/client/src/domain/index.ts:1-3`, `packages/client/src/services/index.ts:1-13`); `sync.ts` constructs the current workflow dependencies (`packages/client/src/commands/sync.ts:25-40`).
- `IFileManager` exposes `writeFile/readFile/renameFile/deleteFile`; the Transcript protocol already uses these operations for verified atomic persistence (`packages/client/src/domain/ports.ts:61-69`).
- `JobManager` currently derives summary/transcript filenames from the Recording name and reads them only for `COMPLETED`; it does not consult persisted artifact paths (`packages/client/src/services/jobManager.ts:19-43`).
- Jobs Hub already offers Summary and Transcript actions for completed Jobs and displays errors, but it only sees coarse status and derived artifacts (`packages/client/src/commands/jobsHub.ts:17-40`, `packages/client/src/commands/jobsHub.ts:79-100`, `packages/client/src/commands/jobsHub.ts:109-129`).
- `NoteService` consumes Summary/Transcript strings as a downstream Publication adapter; its direct write is not part of Job completion (`packages/client/src/services/note.ts:10-35`).

## Integration boundaries

- `ApiService.getTranscript()` is the notebook/server artifact boundary (`GET /jobs/:id/transcript` as text); Summary creation needs no server API or credential change (`packages/client/src/services/api.ts:104-123`).
- The server route serves a Transcript only for `COMPLETED + TRANSCRIPT_READY` and recursively redacts text, paths, and artifact-root values from status responses (`packages/server/src/routes/jobs.ts:11-44`, `packages/server/src/routes/jobs.ts:92-123`).
- The server queue verifies the Transcript artifact and ends at `TRANSCRIPT_READY` with no Summary dependency (`packages/server/src/services/queue.ts:84-134`).
- Legacy server `AIProvider`/Gemini/`SummaryService` files remain and can send Transcript text to Gemini, but they are not exported by the production service barrel or used by the queue (`packages/server/src/services/ai-provider.ts:1-24`, `packages/server/src/services/gemini-provider.ts:15-33`, `packages/server/src/services/summarizer.ts:18-60`, `packages/server/src/services/index.ts:1-6`).
- README workflow/API descriptions still claim server Gemini and downloaded summaries, so they are stale context, not the contract (`README.md:10`, `README.md:243-250`, `README.md:319-323`).

## Patterns and test infrastructure

- Vitest is the monorepo runner; root scripts build shared before client/server and run all tests with `vitest run` (`package.json:8-17`).
- `SyncManager` uses constructor injection, and its service tests supply Vitest fakes (`packages/client/src/services/syncManager.ts:7-16`, `packages/client/tests/services/syncManager.test.ts:40-76`).
- Issue #34 requires provider contract coverage for success, cancellation, timeout, malformed output, and redacted diagnostics; the closest process precedent asserts exact argv/environment and redacted child diagnostics (`packages/server/tests/services/transcriber.test.ts:16-23`, `packages/server/tests/services/transcriber.test.ts:55-91`).
- Setup tests mock Inquirer/config and assert persisted sections (`packages/client/tests/services/setupConfigSave.test.ts:13-44`, `packages/client/tests/services/setupConfigSave.test.ts:47-99`).
- Workflow tests cover atomic Transcript download and its write/read/rename/cleanup failure matrix, ending at `READY` (`packages/client/tests/services/syncManager.test.ts:448-542`).
- The client/server integration tracer bullet proves authenticated server states, one atomic local Transcript, no Summary artifacts, and no Publication call (`packages/client/tests/integration/existingRecordingToDownloadedTranscript.test.ts:107-160`).
- Jobs Hub/JobManager tests cover derived completed-artifact reads and conditional view actions (`packages/client/tests/services/jobManager.test.ts:43-104`, `packages/client/tests/commands/jobsHub.test.ts:102-121`).
- Server boundary tests prove completion without a Summary step and authenticated Transcript-only download/redaction (`packages/server/tests/services/queue.test.ts:89-123`, `packages/server/tests/routes/transcriptionJobContract.test.ts:527-646`, `packages/server/tests/routes/transcriptionJobContract.test.ts:649-754`).

## Potential conflicts

- Slice 03 established that server `COMPLETED` means Transcript-ready only and removed Summary dependencies from the production graph (`.kiro/specs/user-ready-meeting-processing/slices/03-server-job-to-transcript-on-canonical-paths/handoff.md:20-27`).
- Slices 04-05 established deterministic Transcript temporary paths, verified atomic rename, cleanup containment, and a client `READY` outcome; slice 05 also notes real `ApiService` cannot upload `.wav` because `form-data` emits `audio/wave` while the server accepts `audio/wav` (`.kiro/specs/user-ready-meeting-processing/slices/04-manual-sync-upload-and-atomic-transcript-download/handoff.md:13-23`, `.kiro/specs/user-ready-meeting-processing/slices/05-existing-recording-to-downloaded-transcript/handoff.md:12-24`).
- The latest source-area changes are the slice 04 Transcript workflow commits through `26c1de3`; slice 05 (`9e9b7ea`) added integration tests/spec artifacts only. No `TODO` or `FIXME` occurs in the scanned client, server, or shared source/tests.
