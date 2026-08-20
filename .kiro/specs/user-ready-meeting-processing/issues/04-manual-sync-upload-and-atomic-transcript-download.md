# Manual Sync Upload and Atomic Transcript Download

## Parent

Part of #32.

## What to build

Make the notebook side of the manual tracer bullet exact and recoverable. Manual
Sync submits persisted Job metadata, polls the authenticated server, and writes
the ready Transcript atomically without completing the Job.

## Acceptance criteria

- [ ] Tests begin with a persisted client Job and prove Manual Sync does not regenerate its Job identifier or Recording time.
- [ ] For Job `job-123` recorded at `2026-08-20T09:30:00-03:00`, the captured request sends `x-job-id: job-123` and canonical `x-recorded-at: 2026-08-20T12:30:00.000Z`.
- [ ] The captured request sends the persisted language and positive integer speaker bounds; undefined bounds omit their headers instead of sending empty values.
- [ ] Manual Sync uses the authenticated creation, status, and dedicated Transcript operations behind the existing client API port.
- [ ] A ready Transcript is written to a same-directory temporary file, verified, and renamed atomically to the final path.
- [ ] Write, verification, rename, timeout, and interrupted-download failures remove temporary data, preserve any prior final file, and expose a retryable failure.
- [ ] Download success leaves the Job ready for Summary creation and never marks it completed.
- [ ] Client tests preserve existing scan, reconciliation, retry filtering, Meeting linkage, and Jobs Hub behavior.

## Blocked by

- #45
