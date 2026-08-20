# Recover a Failed Server Operation from Jobs Hub

## Parent

Part of #32.

## What to build

Let the user recover or stop server-owned work from the Jobs Hub. A failed or
interrupted extraction/transcription operation must retain verified artifacts,
survive server restart, expose its exact failed operation, and respond to
operation-aware retry or cancellation initiated on the notebook.

## Acceptance criteria

- [ ] Duplicate upload attempts for the same Job return the existing server Job instead of queueing duplicate work.
- [ ] The server persists enough state to reconcile queued and active Jobs after restart.
- [ ] Recovery verifies artifacts before deciding which operation to resume.
- [ ] A failed extraction or transcription reports the failed operation, error, attempt count, and retryability to the notebook.
- [ ] Jobs Hub retry invokes the remote retry operation and resumes from the last verified artifact.
- [ ] Jobs Hub cancellation stops the active FFmpeg or WhisperX process tree and reaches a durable cancelled state.
- [ ] Cancellation and retry are rejected with actionable conflicts when the current state does not allow them.
- [ ] Restarting the server during transcription eventually resumes or produces a visible terminal failure according to the retry policy.
- [ ] Retry, cancellation, and restart tests cross the authenticated server interface and the Jobs Hub workflow seam.
- [ ] No retry repeats upload, extraction, or transcription when its verified output is reusable.

## Blocked by

- #35
