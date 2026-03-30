# Job Deletion API (DELETE /jobs/:id with Subprocess Cancellation)

## Parent PRD

#9

## What to build

A new `DELETE /jobs/:id` endpoint that cancels in-progress work, removes the job record from the database, and deletes all associated files from disk.

**Endpoint:** `DELETE /jobs/:id`

**Behavior by job state:**
- **PENDING/QUEUED** — removes DB record, deletes all associated files (upload, audio, transcript, summary) via paths resolved from `FileManagerService`
- **PROCESSING** — kills the active subprocess (FFmpeg or WhisperX spawn via module-level process reference; aborts Gemini API calls via `AbortController`), then removes DB record and files
- **COMPLETED/FAILED** — removes DB record and deletes all associated files
- **Unknown job** — returns 404

**Queue processor changes:**
- Exposes a reference to the currently active child process (module-level variable, since concurrency is 1)
- The active process reference is used by the DELETE handler to kill subprocesses when cancelling a PROCESSING job

See **Phase 4** of the [server-hardening plan](plans/server-hardening.md) for full details.

## Acceptance criteria

- [ ] `DELETE /jobs/:id` on a PENDING/QUEUED job removes DB record + all associated files
- [ ] `DELETE /jobs/:id` on a PROCESSING job kills active subprocess, removes DB record + files
- [ ] `DELETE /jobs/:id` on a COMPLETED/FAILED job removes DB record + files
- [ ] `DELETE /jobs/:id` returns 404 for unknown job
- [ ] Files deleted include: upload, audio, transcript, summary (all paths resolved via `FileManagerService`)
- [ ] Queue processor exposes active child process reference for cancellation
- [ ] Gemini API calls are abortable via `AbortController`
- [ ] Integration tests cover all job states and 404 case using Fastify `inject()`

## Blocked by

- Blocked by #17 — FileManagerService + Directory Bootstrapping (file path resolution for deletion)
- Blocked by #18 — Route Extraction into Fastify Plugins (jobs route plugin must exist)

## User stories addressed

- User story 5: Client can delete a job and have all associated files removed
- User story 6: Client can cancel a currently processing job
