# Plan: Server Hardening — Extensible AI, Job Management, Progress Tracking & Resilience

> Source PRD: GitHub Issue #9

## Architectural decisions

Durable decisions that apply across all phases:

- **Routes**: `GET /` (health), `POST /upload`, `GET /jobs` (paginated), `GET /jobs/:id`, `DELETE /jobs/:id`, `POST /jobs/:id/retry`. All behind API key auth.
- **Schema (shared — Job)**: Extends with `currentStep?: JobStep`, `failedStep?: JobStep`. JobResponse extends with `steps` timestamps.
- **Schema (server — JobRecord)**: Extends with `steps: Record<JobStep, { startedAt: string; completedAt?: string } | undefined>`, `recoveryAttempts: number`.
- **Key enums (shared)**: `JobStep = 'QUEUED' | 'EXTRACTING_AUDIO' | 'TRANSCRIBING' | 'SUMMARIZING' | 'DONE'`.
- **AI provider selection**: Global via `AI_PROVIDER` env var (default `'gemini'`). Each provider needs `<PROVIDER>_API_KEY` and `<PROVIDER>_MODEL` env vars.
- **File persistence**: All files (uploads, audio, transcriptions, summaries) persist permanently. Only deleted when a job is explicitly deleted via `DELETE /jobs/:id`.
- **File directories**: `uploads/`, `audio_cache/`, `transcriptions/`, `summaries/` — all relative to `process.cwd()`.
- **Pagination contract**: `{ jobs: JobResponse[], total: number, page: number, limit: number }`. Query params: `?page=1&limit=20&status=COMPLETED`.
- **Queue**: `better-queue` with concurrency 1. Module-level variable tracks the active child process for cancellation support.
- **Auth**: Unchanged — `x-api-key` header validated via Fastify `onRequest` hook.

---

## Phase 1: FileManagerService + Route Extraction

**User stories**: 11, 12, 13, 17

### What to build

A `FileManagerService` that owns all file path conventions and directory bootstrapping, replacing the scattered `path.join()` calls currently spread across the queue processor, summarizer, transcriber, and route handlers. The service provides deterministic path methods for each file type (upload, audio, transcript, summary), ensures all directories exist on startup, and offers file reading methods for hydrating job responses.

Simultaneously, extract all route handlers from `index.ts` into three Fastify plugin files: `routes/health.ts` (`GET /`), `routes/upload.ts` (`POST /upload`), and `routes/jobs.ts` (`GET /jobs/:id`). The `index.ts` file reduces to server bootstrap: env loading, service initialization, middleware registration, plugin registration, and `server.listen()`. The `buildServer()` function remains the test entry point.

The upload route implementation should be consolidated — evaluate the existing header-based `routes/upload.ts` (streaming + idempotency) against the current multipart approach in `index.ts` and pick one.

All existing services (queue, summarizer, transcriber, audio-extractor) are updated to use `FileManagerService` for path resolution instead of inline `path.join()`. The queue processor stops deleting the source upload file after audio extraction (files persist per architectural decision).

### Acceptance criteria

- [ ] `FileManagerService` provides `getUploadPath`, `getAudioPath`, `getTranscriptPath`, `getSummaryPath` with deterministic naming
- [ ] `ensureDirectories()` creates all four directories on startup
- [ ] `readTranscript(jobId)` and `readSummary(jobId)` return file content or null
- [ ] All route handlers live in `routes/` as Fastify plugins; `index.ts` has no route logic
- [ ] Queue processor, summarizer, and transcriber use `FileManagerService` for all paths
- [ ] Source upload file is no longer deleted after audio extraction
- [ ] `GET /jobs/:id` hydrates text via `FileManagerService` instead of inline `fs` calls
- [ ] Existing tests pass; new unit tests cover `FileManagerService` path resolution, file reading, and directory creation

---

## Phase 2: Shared Types + Sub-Step Progress

**User stories**: 8, 9, 10

### What to build

Expand the shared type system with a `JobStep` enum and add step-tracking fields to both the shared `Job` interface and the server-side `JobRecord`. The queue processor updates `currentStep` and records `startedAt` timestamps before each processing step, and `completedAt` after each step succeeds. On failure, the processor sets `failedStep` to the step that was active when the error occurred.

The `GET /jobs/:id` response (and later `GET /jobs`) exposes `currentStep`, `failedStep`, and the full `steps` timestamp map, giving the client enough data to show "Transcribing..." or "Failed at: Summarizing" and estimate processing duration.

### Acceptance criteria

- [ ] `JobStep` enum exported from shared package: `QUEUED`, `EXTRACTING_AUDIO`, `TRANSCRIBING`, `SUMMARIZING`, `DONE`
- [ ] `Job` (shared) has `currentStep?: JobStep` and `failedStep?: JobStep`
- [ ] `JobResponse` (shared) has `steps?: Record<JobStep, { startedAt: string; completedAt?: string } | undefined>`
- [ ] `JobRecord` (server) has `steps` field and initializes it on job creation
- [ ] Queue processor updates `currentStep` + `steps[step].startedAt` before each step
- [ ] Queue processor updates `steps[step].completedAt` after each step succeeds
- [ ] Queue processor sets `failedStep = currentStep` on error
- [ ] `GET /jobs/:id` response includes `currentStep`, `failedStep`, and `steps`
- [ ] Existing tests updated to account for new fields

---

## Phase 3: AI Provider Abstraction

**User stories**: 1, 2, 3

### What to build

Extract an `AIProvider` interface with a `name` property and a `summarize(transcript, systemPrompt)` method. Create an `AIProviderFactory` with `register()`, `get(name)`, and `getDefault()` — default resolved from `AI_PROVIDER` env var, falling back to `'gemini'`.

Move the existing Gemini SDK logic from `SummaryService` into a `GeminiProvider` class that implements `AIProvider`. The `SummaryService` becomes a thin orchestrator: it resolves the active provider from the factory, selects the prompt template, calls `provider.summarize()`, and writes the result to disk via `FileManagerService`.

Adding a new AI provider (e.g., Claude, OpenAI) requires creating one class implementing `AIProvider` and one `factory.register()` call — no changes to the queue, routes, or `SummaryService`.

### Acceptance criteria

- [ ] `AIProvider` interface defined with `name: string` and `summarize(transcript: string, systemPrompt: string): Promise<string>`
- [ ] `AIProviderFactory` supports `register()`, `get(name)`, `getDefault()` — throws on unknown provider
- [ ] `getDefault()` reads `AI_PROVIDER` env var, falls back to `'gemini'`
- [ ] `GeminiProvider` implements `AIProvider` using existing `@google/genai` SDK logic
- [ ] `SummaryService` resolves provider via factory; no direct Gemini imports
- [ ] `SummaryService` writes output file via `FileManagerService`
- [ ] Unit tests cover factory registration, default resolution, and unknown-provider error
- [ ] End-to-end flow unchanged: upload, transcribe, summarize still works

---

## Phase 4: Job Management APIs

**User stories**: 4, 5, 6, 7, 18, 19

### What to build

Three new endpoints in the jobs route plugin:

**`GET /jobs`** — returns a paginated, filterable list. Accepts `?page=` (default 1), `?limit=` (default 20), and `?status=` (optional `JobState` filter). Response shape: `{ jobs: JobResponse[], total, page, limit }`. Each job is hydrated with text content just like `GET /jobs/:id`.

**`DELETE /jobs/:id`** — cancels the job if it is currently processing (kills the active subprocess via the module-level process reference; aborts Gemini calls via `AbortController`), removes the job record from the database, and deletes all associated files on disk (upload, audio, transcript, summary) using paths resolved from `FileManagerService`. Returns 404 if job not found.

**`POST /jobs/:id/retry`** — only allowed for `FAILED` jobs (returns 409 otherwise). Resets `serverStatus` to `PENDING`, clears `error` and `failedStep`, resets step timestamps for incomplete steps, preserves completed intermediate files, and re-queues. The queue processor detects existing output files (via `FileManagerService`) to skip already-completed steps.

The queue processor must expose a reference to the currently active child process (FFmpeg or WhisperX spawn) so that `DELETE` can kill it. Since concurrency is 1, a module-level variable is sufficient.

### Acceptance criteria

- [ ] `GET /jobs` returns paginated results with correct `total`, `page`, `limit`
- [ ] `GET /jobs?status=FAILED` returns only failed jobs
- [ ] `GET /jobs?page=2&limit=5` returns correct page offset
- [ ] `DELETE /jobs/:id` on a PENDING/QUEUED job removes DB record + files
- [ ] `DELETE /jobs/:id` on a PROCESSING job kills active subprocess, removes DB record + files
- [ ] `DELETE /jobs/:id` returns 404 for unknown job
- [ ] `POST /jobs/:id/retry` on a FAILED job resets status and re-queues
- [ ] `POST /jobs/:id/retry` skips already-completed steps (checks for existing output files)
- [ ] `POST /jobs/:id/retry` returns 409 for non-FAILED jobs
- [ ] Queue processor exposes active child process reference for cancellation
- [ ] Integration tests cover all new endpoints using Fastify `inject()`

---

## Phase 5: Startup Recovery + Graceful Shutdown

**User stories**: 14, 15, 16

### What to build

**Startup recovery:** On server boot, scan the database for jobs stuck in `PROCESSING` status (stalled from a previous crash). Apply a 3-strike recovery policy using a `recoveryAttempts` counter on `JobRecord`:

- `recoveryAttempts === 0`: resume from the last completed step (determine by checking which output files exist on disk via `FileManagerService`), increment counter, re-queue.
- `recoveryAttempts === 1`: re-queue from scratch (ignore existing intermediate files), increment counter.
- `recoveryAttempts >= 2`: mark as `FAILED` with error "Max recovery attempts exceeded".

The `recoveryAttempts` counter resets to 0 when a job completes successfully.

**Graceful shutdown:** On `SIGINT` and `SIGTERM`, pause the queue (stop picking new jobs), let the currently processing job finish naturally (the `better-queue` callback completes), then call `server.close()` and exit. No subprocess is killed — the current job runs to completion.

### Acceptance criteria

- [ ] `JobRecord` has `recoveryAttempts: number` field (defaults to 0)
- [ ] On startup, stalled `PROCESSING` jobs with `recoveryAttempts === 0` are re-queued from last completed step
- [ ] On startup, stalled jobs with `recoveryAttempts === 1` are re-queued from scratch
- [ ] On startup, stalled jobs with `recoveryAttempts >= 2` are marked `FAILED`
- [ ] `recoveryAttempts` resets to 0 on successful job completion
- [ ] Step detection uses `FileManagerService` to check for existing audio/transcript/summary files
- [ ] `SIGINT`/`SIGTERM` pauses the queue and waits for the current job before shutting down
- [ ] Unit tests cover 3-strike escalation logic and step detection from existing files
