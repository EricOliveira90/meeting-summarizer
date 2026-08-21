# Migrate Legacy Client Data Safely

## Parent

Part of #32.

## What to build

Use #49's types and validator to initialize absent stores, reopen valid v2
without writing, and migrate valid v1 bytes through a verified restorable
backup and atomic replacement. This slice owns conversion and filesystem
safety only. #51 wires the result into LowDB and existing callers.

## Conversion rules

- Parse and validate before writing. Invalid JSON/data throws #49's
  `CLIENT_DB_INVALID` diagnostic and changes no database byte.
- `migrationNow` is the injected clock as UTC ISO. A parseable v1 zoned ISO
  `recordedAt` normalizes with `new Date(value).toISOString()`; an opaque value
  uses `migrationNow`. The exact original Job remains under `legacy`.
- Each Job's generated event time is
  `max(migrationNow, canonical recordedAt)`. Stage completion/start,
  artifact `committedAt`, and synthetic times that would otherwise use the
  migration clock use this event time, including future legacy instants.
- Existing Meetings remain field-for-field unchanged and in original order.
  V1 validation has already rejected empty IDs and links.

## Meeting linkage and snapshots

Resolve each v1 Job in array order:

1. Use `job.meetingId` when it names one Meeting whose `jobId` is absent or
   equals that Job ID.
2. Otherwise use the Meeting only when exactly one Meeting has
   `jobId === job.id`.
3. A dangling direct ID, conflicting direct `jobId`, zero reverse matches, or
   multiple reverse matches is orphaned. Preserve all original links in
   `legacy`.

An orphan receives `legacy-<job.id>`, then `-2`, `-3`, and so on against all
existing and earlier synthetic Meeting IDs. Its fields are exact:

- `title = path.parse(originalFilename).name`;
- `scheduledAt = createdAt = canonical recordedAt`;
- `status = LINKED`, `jobId = job.id`, and `attendees = []`;
- language, Summary template, speaker bounds, and note template use the
  resolved Job snapshot.

Snapshot precedence is Job options/fields, linked Meeting, current config,
then default. Language defaults to `auto`; Summary template defaults to
`meeting`; provider is `codex`; model is the current configured Codex model.
Note-template candidates are accepted only when one of the four #49 values;
an absent or unrecognized config value defaults to `Internal Meeting`.

## Status, artifact, and timestamp table

Derived finals are:

- `<notebookRoot>/transcriptions/<base>_transcription.txt`
- `<notebookRoot>/summaries/<base>_summary.txt`

where `base = path.parse(originalFilename).name`. A final is verified only when
it is a readable, non-empty regular file. Apply this finite table:

| Legacy status | Finals inspected | Canonical result | Evidence retained |
|---|---|---|---|
| `WAITING_UPLOAD`, `UPLOADING`, `PROCESSING` | none | `RECORDED` | none |
| `FAILED` | none | `FAILED`, `RECONCILE`, resume `RECORDED`, retryable | none |
| `ABANDONED` | none | same failure, non-retryable | none |
| `DELETED` | none | `CANCELLED` | none |
| `READY` | Transcript only | `TRANSCRIPT_READY` when verified, else `RECORDED` | verified Transcript only |
| `COMPLETED` with both finals | both | `COMPLETED` | both |
| `COMPLETED` with Transcript only | both | `TRANSCRIPT_READY` | Transcript only |
| `COMPLETED` with Summary only or neither | both | `RECORDED` | none |

Unreadable and empty files count as absent. A Summary is never retained without
a verified Transcript. Files for statuses not listed as inspected are ignored.
Evidence stores exact path, lowercase SHA-256, bytes, and Job event time.

Timestamps begin with `RECORDED` at canonical `recordedAt`. A distinct mapped
stage is appended at Job event time after closing `RECORDED` at that same time.
`RECONCILE.count` inherits `retryCount`; all other operation counts are zero.
Server ID, next-due times, and reconciliation time start absent.

## Atomic migration and diagnostics

- An absent path writes exact
  `{ schemaVersion: 2, jobs: [], meetings: [], recordingAttempts: [] }` and
  creates no backup. Valid v2 returns with no write or backup.
- Before replacement, copy exact source bytes to sibling
  `<database>.v1-<YYYYMMDDTHHmmssSSSZ>.bak`; collisions append `-2`, `-3`, and
  so on without overwrite. Read back and byte-compare the selected backup.
- Serialize canonical v2, write a unique sibling temporary file, read/parse and
  validate it with #49, then rename it over the database.
- Migration errors are exactly
  `{ code: 'CLIENT_DB_MIGRATION_FAILED', operation, message:
  'Client database migration failed during <operation>.' }`, where operation is
  `SOURCE_READ|SERIALIZE_V2|BACKUP_WRITE|BACKUP_VERIFY_READ|BACKUP_COMPARE|`
  `TEMP_WRITE|TEMP_PARSE|REPLACE`.
- Source/serialize/backup faults leave no candidate backup or temp. Faults
  after verified backup retain that backup and remove the temp. Every fault
  preserves original database bytes. Success retains the new verified backup
  and no temp.

## Acceptance criteria

- [ ] Real-file tests prove exact empty initialization, v2 no-write reopen, and invalid-data no-write failure.
- [ ] UTC, offset, opaque, and future v1 `recordedAt` rows produce the exact canonical and generated times while preserving originals in `legacy`.
- [ ] Direct, reverse-only, dangling, conflicting, multiple-reverse, orphan, and two collision rows produce the exact Meeting linkage and synthetic fields.
- [ ] Job/Meeting/config/default rows prove every snapshot precedence, including an unrecognized configured note template.
- [ ] The finite status/artifact table proves stages, failure, evidence inclusion/exclusion, hashes, bytes, and timestamp support.
- [ ] Backup collision plus one injected fault per named operation proves diagnostic shape, byte preservation, and exact retained/removed backup/temp outcomes.
- [ ] Restoring backup bytes migrates again without loss; reopening resulting v2 is idempotent.
- [ ] This slice does not wire LowDB, mutate through `IClientDb`, record, or execute workflow operations.

## Blocked by

- #49
