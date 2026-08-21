# Persist Recording Attempts and Migrate Durable Jobs

## Parent

Part of #32.

## What to build

Establish the durable notebook boundary that automatic processing consumes.
Migrate existing client data to schema version 2 with a restorable backup,
persist a Recording attempt before the recorder starts, await its terminal
event, and create one `RECORDED` Job only after successful completion.

## Canonical schema-v2 contract

The client database root is `{ schemaVersion: 2, jobs, meetings,
recordingAttempts }`.

- A Job records `id`, canonical `stage`, `recordingPath`, `originalFilename`,
  `recordedAt`, `meetingId`, optional `serverJobId`, snapshotted upload options,
  Summary Provider/template, optional note template, artifact evidence, stage
  timestamps, per-operation attempts and next-due times, optional structured
  failure with resume stage, and optional last-reconciliation time.
- Canonical stages are `RECORDED`, `UPLOADING`, `SERVER_QUEUED`, `EXTRACTING`,
  `TRANSCRIBING`, `TRANSCRIPT_READY`, `DOWNLOADING`, `SUMMARIZING`,
  `COMPLETED`, `FAILED`, and `CANCELLED`.
- Client operation keys are `UPLOAD`, `RECONCILE`, `DOWNLOAD`, `SUMMARY`, and
  `TRANSCRIPTION`. Each attempt entry is `{ count, nextAttemptAt? }`.
- Artifact evidence is `{ path, sha256, bytes, committedAt }`. Evidence is
  valid only when the final file is readable, non-empty, has the recorded byte
  length, and has the recorded SHA-256 digest.
- A Recording attempt records `id`, `meetingId`, expected and optional actual
  paths, snapshotted language/speaker/Summary/Publication choices, provider,
  `startedAt`, optional `completedAt`, status `RECORDING|RECORDED|FAILED|CANCELLED`,
  optional sanitized error, and optional `jobId`.

## Acceptance criteria

- [ ] Before the first schema-v2 write, the exact schema-v1 database bytes are copied to a sibling `<database>.v1-<UTC-basic-timestamp>.bak`; collisions append `-2`, `-3`, and so on without overwriting any backup.
- [ ] Migration writes schema v2 through a sibling temporary file and rename only after the backup is readable and byte-identical; backup or migration failure leaves the original database unchanged and reports an actionable error.
- [ ] Restoring the backup bytes over the migrated database reopens with every original Job and Meeting field unchanged; reopening a valid v2 database is idempotent and creates no additional backup.
- [ ] An absent database initializes directly as schema v2, while malformed data or a schema version greater than 2 stops without rewriting it.
- [ ] Legacy `WAITING_UPLOAD`, `UPLOADING`, and `PROCESSING` Jobs migrate to `RECORDED`; `READY` migrates to `TRANSCRIPT_READY` only when its derived final Transcript is readable and non-empty, otherwise `RECORDED`.
- [ ] Legacy `COMPLETED` migrates to `COMPLETED` only when both derived final artifacts are readable and non-empty, to `TRANSCRIPT_READY` when only the Transcript is verified, and otherwise to `RECORDED`; verified migrated artifacts receive exact evidence.
- [ ] Legacy `FAILED` and `ABANDONED` migrate to `FAILED` with operation `RECONCILE`, resume stage `RECORDED`, preserved error text, and retryability true only for `FAILED`; `DELETED` migrates to `CANCELLED`.
- [ ] Migration preserves stable Job IDs, Recording times and paths, Meeting linkage, processing choices, provider/templates, and original records; it never infers a later stage from legacy status alone.
- [ ] Starting a Recording persists its attempt and all selected Meeting/processing choices before spawning the recorder; a fresh database read can observe that snapshot while recording is active.
- [ ] The command waits for a `completed`, `cancelled`, or `error` recorder event with no fixed sleep. It preserves existing started/audio/processing/completed/cancelled/error console events.
- [ ] Only `completed` creates exactly one Job. Error, cancellation, recorder exit without a terminal event, and command interruption persist a visible terminal attempt and create no Job.
- [ ] The completed event path is authoritative. If the user accepts the optional rename, the attempt and Job both persist the final renamed path; a rename failure remains visible and does not enqueue an unusable Job.
- [ ] The created Job uses the attempt ID as its stable Job ID, starts at `RECORDED`, snapshots the Meeting relationship and choices, records ordered stage timestamps, and stores no Transcript or Summary evidence.
- [ ] Real LowDB/filesystem tests cover successful migration, every legacy mapping, backup restore, interrupted migration, reopen idempotence, completed/error/cancelled recorder events, rename, and exactly-once enqueue.
- [ ] A launched `meeting-cli record` test uses a controlled recorder executable and reads the database from another process to prove pre-spawn persistence and post-event Job creation.

## Blocked by

- #34
