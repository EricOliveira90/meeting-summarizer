# Shared Types: JobStep Enum + Sub-Step Progress Tracking

## Parent PRD

#9

## What to build

Expand the shared type system with a `JobStep` enum and add step-tracking fields to both the shared `Job` interface and the server-side `JobRecord`. Wire the queue processor to update step progress in real time.

**Shared package changes:**
- New `JobStep` enum: `QUEUED`, `EXTRACTING_AUDIO`, `TRANSCRIBING`, `SUMMARIZING`, `DONE`
- `Job` interface gains `currentStep?: JobStep` and `failedStep?: JobStep`
- `JobResponse` interface gains `steps?: Record<JobStep, { startedAt: string; completedAt?: string } | undefined>`

**Server package changes:**
- `JobRecord` gains `steps: Record<JobStep, { startedAt: string; completedAt?: string } | undefined>` field, initialized on job creation
- Queue processor updates `currentStep` and records `steps[step].startedAt` before each processing step
- Queue processor updates `steps[step].completedAt` after each step succeeds
- On failure, queue processor sets `failedStep = currentStep`
- `GET /jobs/:id` response includes `currentStep`, `failedStep`, and `steps` timestamps

This gives the client enough data to show "Transcribing..." or "Failed at: Summarizing" and estimate processing duration.

See **Phase 2** of the [server-hardening plan](plans/server-hardening.md) for full details.

## Acceptance criteria

- [ ] `JobStep` enum exported from shared package: `QUEUED`, `EXTRACTING_AUDIO`, `TRANSCRIBING`, `SUMMARIZING`, `DONE`
- [ ] `Job` (shared) has `currentStep?: JobStep` and `failedStep?: JobStep`
- [ ] `JobResponse` (shared) has `steps?: Record<JobStep, { startedAt: string; completedAt?: string } | undefined>`
- [ ] `JobRecord` (server) has `steps` field and initializes it on job creation
- [ ] Queue processor updates `currentStep` + `steps[step].startedAt` before each step
- [ ] Queue processor updates `steps[step].completedAt` after each step succeeds
- [ ] Queue processor sets `failedStep = currentStep` on error
- [ ] `GET /jobs/:id` response includes `currentStep`, `failedStep`, and `steps`
- [ ] Existing tests updated to account for new fields

## Blocked by

- Blocked by #17 — FileManagerService + Directory Bootstrapping (queue processor already refactored to use FileManagerService)

## User stories addressed

- User story 8: Client can see which processing step a job is currently on
- User story 9: Client can see which step a job failed at
- User story 10: Client can see timestamps for when each processing step started and completed
