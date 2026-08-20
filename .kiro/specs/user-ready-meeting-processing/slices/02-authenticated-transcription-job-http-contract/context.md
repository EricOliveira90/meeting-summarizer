# Slice 02: Authenticated Transcription Job HTTP Contract

## Relevant files

- `packages/server/src/index.ts:12-72` - Builds Fastify, sets the 500 MiB body limit, decorates `fileManager`, installs optional global API-key auth, registers all routes, and performs direct-process startup/recovery/listen.
- `packages/server/src/routes/upload.ts:13-65` - Current `POST /upload`: reads option headers, sanitizes the filename, streams the Recording, upserts a Job, and pushes `meetingQueue`.
- `packages/server/src/routes/jobs.ts:12-137` - Lists, reads, retries, and deletes Jobs; `hydrateJobResponse()` removes direct path fields but reads Transcript and Summary text into responses.
- `packages/server/src/routes/health.ts:3-7` - `GET /` returns the current online/service payload and is covered as part of the all-routes authentication surface.
- `packages/server/src/domain/models.ts:4-10` - Server-only `JobRecord` extends shared `Job` with `filePath`, artifact paths, `steps`, and `recoveryAttempts`.
- `packages/server/src/services/{db,file-manager,queue}.ts` - Concrete LowDB Job persistence, artifact path/read/delete operations, and singleton queue consumed directly by routes.
- `packages/server/src/types/fastify.d.ts:3-6` - Declares the decorated `FastifyInstance.fileManager`.
- `packages/shared/src/index.ts:1-65` - Defines `JobState`, `JobStep`, languages/templates, `UploadOptions`, `Job`, `JobResponse`, and the current `{ error }` `ErrorResponse`.
- `packages/server/tests/app.test.ts` and `tests/routes/routes.test.ts` - Basic injected health, missing Job ID/file, and unknown Job route coverage.
- `packages/server/tests/routes/jobListing.test.ts` - Pagination/filter and direct path-redaction prior art using an in-memory mocked Job array.
- `packages/server/tests/routes/{jobDeletion,jobRetry}.test.ts` - Existing mutation behavior that remains behind global authentication.
- `packages/server/tests/services/fileManager.test.ts` - Artifact path/read/delete tests using an OS temporary directory.
- `scripts/smoke-built-runtime.mjs:53-76` - Loads compiled `buildServer()`, injects `GET /`, and currently supplies `x-api-key` only when the environment already has one.
- `packages/client/src/services/api.ts:15-130` and `tests/services/api.test.ts:17-154` - Existing notebook adapter and tests; retained as-is by this slice despite temporary incompatibility.

## Existing behavior in touched files

- `buildServer()` is importable without `API_KEY`; module-scope `API_KEY` is captured at import, and auth is skipped when absent. Direct startup creates directories, recovers Jobs, installs signal handlers, then listens on `127.0.0.1` (`index.ts:12-72`).
- The auth hook covers every registered route when configured, accepts exact `x-api-key`, and otherwise returns `401 { error: "Unauthorized: Invalid or missing API Key" }`; its warning logs only `request.ip` (`index.ts:28-42`).
- Fastify keeps CORS `origin: '*'`, multipart support, and `bodyLimit: 1048576 * 500` (`index.ts:14-26`).
- `/upload` defaults language/template to `auto`/`meeting`, parses speaker headers with `parseInt`, retains `data.filename` in the Job, sanitizes artifact filenames via `/[^a-zA-Z0-9.-]/g`, overwrites a duplicate Job ID, persists, queues `{ jobId, filePath }`, then returns `{ success, jobId, message }` (`upload.ts:16-64`).
- Upload currently assigns server receipt time to `recordedAt`, includes explicitly `undefined` speaker keys in `options`, performs no MIME/extension/size/empty-file validation, and resolves/opens the artifact path before persistence (`upload.ts:17-51`).
- `GET /jobs` preserves insertion order, optional exact status filtering, page default `1`, limit default `20`, and `{ jobs, total, page, limit }` (`jobs.ts:18-40`).
- `GET /jobs/:id` currently returns `{ error: "Job not found" }` or a hydrated Job. Hydration strips `filePath`, `audioPath`, `transcriptPath`, `summaryPath`, and `recoveryAttempts`, but adds disk-read `transcriptText`/`summaryText` (`jobs.ts:45-51,122-137`).
- Existing `DELETE /jobs/:id` cancellation/file removal/record removal and `POST /jobs/:id/retry` status reset, completed-step preservation, persistence, and requeue behavior remain registered (`jobs.ts:54-120`).
- Current state pairs originate from queue writes: `PENDING` before queue work; `PROCESSING` with `EXTRACTING_AUDIO`, `TRANSCRIBING`, or `SUMMARIZING`; `COMPLETED`/`DONE`; failures retain the active `currentStep`, set `failedStep`, and store `error` (`queue.ts:64-120`).
- `JobStep.SUMMARIZING` remains in this slice; shared exports are `QUEUED`, `EXTRACTING_AUDIO`, `TRANSCRIBING`, `SUMMARIZING`, `DONE` with no `TRANSCRIPT_READY` (`shared/src/index.ts:3-9`).

## Patterns in use

- Routes are async Fastify registration functions and are assembled only by `buildServer()`; route tests call `await app.ready()` then `app.inject(...)`.
- Shared transport/domain types are imported by package name; Vitest aliases that package directly to `packages/shared/src/index.ts` (`vitest.config.ts:16-20`).
- Replaceable test boundaries use `vi.mock`, `vi.hoisted`, `vi.fn`, constructor arguments, or decorated Fastify services. Production upload/jobs routes currently import singleton `getDb` and `meetingQueue`; only `fileManager` is decorated.
- Persistence updates mutate LowDB records then `await db.write()`; queue steps use `Partial<Record<JobStep, StepTimestamp>>` with ISO timestamps (`queue.ts:23-61`).
- Route errors currently use `{ error }`; this slice's locked HTTP failures require exactly `{ code, error }`.

## Test infrastructure

- Root `npm test` runs Vitest 4 via `vitest run`; `npm run build` serially builds shared, client, then server (`package.json:9-15`).
- Discovery is `packages/**/*.{test,spec}.{ts,tsx}` with build/temp directories excluded; current layout has 24 client, 9 server, and 2 shared test files (`vitest.config.ts:4-14`).
- Server route tests mock `@google/genai` and `better-queue`; Job route suites mock `getDb()` with mutable `mockJobs` and a write spy. There is no shared server test builder, multipart fixture, or successful upload-route test.
- File-manager tests create `fs.mkdtempSync(path.join(os.tmpdir(), "fm-test-"))` and recursively clean it in `afterEach` (`fileManager.test.ts:7-18`).
- Established verification commands are `npm test`, `npm run build`, and compiled runtime `npm run smoke:built`; conventions require contract behavior through authenticated HTTP.

## Data model

- Server persistence is one unversioned LowDB JSON file at `<process.cwd()>/db.json` with shape `{ jobs: JobRecord[] }`; there are no tables, migrations, or access-control rows (`services/db.ts:6-17`).
- Shared `Job` fields are `id`, `originalFilename`, `serverStatus`, `recordedAt`, optional `options`, `error`, `currentStep`, and `failedStep`; `JobResponse` adds optional text/errors and `steps` (`shared/src/index.ts:49-65`).
- `UploadOptions` is `{ language, template, minSpeakers?, maxSpeakers? }`; accepted enum values already exist as `auto|en|pt|es` and `meeting|training|summary` (`shared/src/index.ts:11-32`).
- Artifact paths are rooted at the injected `FileManagerService.baseDir`: `uploads/<jobId>_<filename>`, `audio_cache/<jobId>_<stem>.wav`, `transcriptions/<jobId>_transcript.txt`, and `summaries/<jobId>_summary.txt` (`file-manager.ts:4-25`).

## Integration boundaries

- HTTP creation currently crosses multipart stream -> `fs.createWriteStream` -> LowDB `JobRecord` -> `meetingQueue.push({ jobId, filePath })`; queue input is exactly those two strings (`upload.ts:27-64`, `queue.ts:11-14`).
- Status crosses LowDB plus `FileManagerService.readTranscript/readSummary`; the new Transcript route can only observe readiness through the Job and artifact collaborator defined by the slice contract.
- The notebook Axios client sends `/upload`, `x-job-id`, language/template/speaker headers, API key, and multipart file, but no `x-recorded-at`; it expects status text from `GET /jobs/:id` and incorrectly types list as `Job[]` instead of the server envelope (`client/src/services/api.ts:54-113`).
- ADR-0001 assigns server ownership only through Transcript production, but queue/Gemini Summary execution is deliberately preserved until sibling issue #46.

## Potential conflicts

- HEAD commits `3974c96` and `0250080` tightened #45 after the baseline: no client changes, `/upload` alias only, safe Job IDs, template validation, empty Recording, exact sparse speaker options, filename retention/sanitization, exact state pairs, recursive redaction, and no `TRANSCRIPT_READY`.
- Slice 01 handoff records a required placeholder Gemini key for compiled smoke loading, conditional smoke authentication, 237 passing tests, and LowDB sibling `.tmp` collision risk for fixed test paths.
- `FileManagerService.deleteJobFiles()` reconstructs the upload path from `originalFilename` (`file-manager.ts:59-64`), while upload writes the sanitized filename (`upload.ts:33-34`); existing deletion tests use already-safe names.
- Making all routes mandatory-auth changes existing route tests and compiled smoke requests, which currently omit credentials unless ambient `API_KEY` exists.
- No `TODO`, `FIXME`, `HACK`, or `XXX` markers occur in the scanned client/server source and tests; no sibling handoff beyond slice 01 exists.
