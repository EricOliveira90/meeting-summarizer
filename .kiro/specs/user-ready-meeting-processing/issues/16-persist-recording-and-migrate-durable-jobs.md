# Persist Recording Attempts and Create the Recorded Job

## Parent

Part of #32.

## What to build

Use the wired schema-v2 store from #51 to persist a Recording attempt before the
recorder starts, await the recorder's terminal outcome, and atomically create
one linked `RECORDED` Job only after a usable completed Recording. This slice
owns recorder intake only; #49-#51 own schema, migration, and compatibility,
and #35 owns automatic processing after `RECORDED`.

## Acceptance criteria

- [ ] Picker-selected, chained preselected, quick-title, standalone-title, and standalone-blank flows resolve or create one durable Meeting before recorder spawn.
- [ ] The command snapshots the Meeting ID, expected path, language, speaker bounds, Summary provider/model/template, and optional Publication note template into one `RECORDING` attempt before spawn; a fresh database read from another process observes the attempt while recording is active.
- [ ] Persisting the Meeting `RECORDING` state and attempt is atomic. If that write fails, the Meeting remains unchanged, the command reports an actionable error, and the recorder spawn count is zero.
- [ ] The command waits for the first `completed`, `cancelled`, or `error` event with no fixed sleep. Clean recorder exit without a terminal event becomes `FAILED`, command interruption becomes `CANCELLED`, and duplicate or late terminal events cannot change the first settlement.
- [ ] Existing `started`, `audio_state`, `muted`, `processing`, `completed`, `cancelled`, and `error` console event kinds remain observable. Child-supplied processing/error text, stdout, stderr, credentials, and Transcript text are never interpolated; hostile canaries are absent from captured output and persisted diagnostics.
- [ ] Attempt error text is a fixed category-only message of at most 256 characters. Cancellation stores no error. Raw child diagnostics and Transcript text are never persisted.
- [ ] A completed event path is authoritative but usable only when it resolves inside the configured output root, has `.wav`, is a non-symlink regular file, is readable, and is non-empty. Missing, unreadable, empty, directory, symlink, outside-root, and wrong-extension paths settle `FAILED` and create no Job.
- [ ] If the user accepts the optional rename, the renamed path becomes authoritative only after rename succeeds. Rename failure settles the attempt `FAILED`, leaves the Meeting `RECORDED` without `jobId`, and creates no Job.
- [ ] Successful settlement is one atomic database write: the attempt becomes `RECORDED` with final `actualPath`, `completedAt`, and `jobId`; the Meeting becomes `LINKED` with that `jobId`; and exactly one same-ID Job starts at `RECORDED`.
- [ ] A successful Job snapshots the attempt's Meeting and processing choices, stores `recordingPath` and `originalFilename` from the final path, records one `RECORDED` stage timestamp, initializes every operation attempt to count zero, and has no server ID, failure, reconciliation time, Transcript evidence, or Summary evidence.
- [ ] Cancellation, child error, clean exit without a terminal event, interruption, unusable path, and rename failure leave the Meeting `RECORDED` with no `jobId`, persist one matching terminal attempt, and create no Job.
- [ ] Real LowDB/filesystem tests cover every entry flow, pre-spawn write failure, all seven console events, every terminal outcome, hostile diagnostic redaction, usable-path rejection, rename accept/decline/failure, Meeting terminal records, duplicate events, and exactly-once Job creation.
- [ ] A launched `meeting-cli record` test uses a controlled recorder executable and a second process to prove pre-spawn persistence, terminal waiting, and post-event atomic Meeting/attempt/Job state without invoking Sync.

## Blocked by

- #49
