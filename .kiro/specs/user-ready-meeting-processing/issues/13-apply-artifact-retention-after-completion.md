# Apply Artifact Retention after Completion

## Parent

Part of #32.

## What to build

Apply the agreed privacy and storage lifecycle after successful processing.
Acknowledged Transcript download starts the server grace period; server source
media is removed after seven days, notebook Recordings after 30 days, and
Transcripts, Summaries, and Publications remain indefinitely by default.

## Acceptance criteria

- [ ] The notebook explicitly acknowledges a verified Transcript download to the server.
- [ ] Server upload and extracted-audio retention begins only after acknowledgement, not merely after Transcript readiness.
- [ ] Server source artifacts remain available throughout the seven-day grace period and are deleted after it.
- [ ] Notebook Recordings become eligible for cleanup 30 days after successful Job completion.
- [ ] Transcript, Summary, and Publication artifacts have no automatic expiry by default.
- [ ] Active, failed, cancelled, unacknowledged, and Publication-failed states follow explicit retention rules consistent with recoverability.
- [ ] Cleanup is idempotent, restart-safe, and reports failures without changing Job completion.
- [ ] Jobs Hub shows scheduled cleanup and retained artifact availability before destructive actions.
- [ ] Retention settings are configurable without weakening the agreed defaults during migration.
- [ ] Tests use a controllable clock and cover boundary times, missing files, repeated cleanup, and partial deletion failure.

## Blocked by

- #35
