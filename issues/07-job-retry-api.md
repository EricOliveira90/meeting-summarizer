# Job Retry API (POST /jobs/:id/retry with Step Resume)

## Parent PRD

#9

## What to build

A new `POST /jobs/:id/retry` endpoint that re-queues a failed job, resuming from the step that failed rather than starting from scratch.

**Endpoint:** `POST /jobs/:id/retry`

**Behavior:**
- Only allowed for `FAILED` jobs — returns 409 for any other status
- Resets `serverStatus` to `PENDING`
- Clears `error` and `failedStep`
- Resets step timestamps for incomplete steps (preserves timestamps for completed steps)
- Preserves completed intermediate files on disk (audio, transcript)
- Re-queues the job

**Queue processor changes:**
- On processing a retried job, detects existing output files via `FileManagerService` to determine which steps are already complete
- Skips already-completed steps (e.g., if audio file exists, skip `EXTRACTING_AUDIO`; if transcript file exists, skip `TRANSCRIBING`)
- Resumes from the first incomplete step

See **Phase 4** of the [server-hardening plan](plans/server-hardening.md) for full details.

## Acceptance criteria

- [ ] `POST /jobs/:id/retry` on a FAILED job resets status to PENDING and re-queues
- [ ] `POST /jobs/:id/retry` clears `error` and `failedStep` fields
- [ ] `POST /jobs/:id/retry` preserves completed intermediate files on disk
- [ ] `POST /jobs/:id/retry` returns 409 for non-FAILED jobs
- [ ] `POST /jobs/:id/retry` returns 404 for unknown job
- [ ] Queue processor detects existing output files via `FileManagerService` to skip completed steps
- [ ] Retried job resumes from the first incomplete step (not from scratch)
- [ ] Integration tests cover retry success, 409 conflict, 404 not found, and step-skip behavior using Fastify `inject()`

## Blocked by

- Blocked by #19 — Shared Types: JobStep Enum + Sub-Step Progress Tracking (step tracking fields needed for reset/resume)
- Blocked by #22 — Job Deletion API (queue processor exposes active process reference pattern)

## User stories addressed

- User story 7: Client can retry a failed job starting from the step that failed
