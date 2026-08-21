# Wire Durable Jobs Through the Legacy Client Database API

## Parent

Part of #32.

## What to build

Wire #50's prepared schema-v2 store into LowDB while preserving every existing
`IClientDb` and Meeting caller through exact projections and durable mutations.
This slice owns compatibility behavior only. It performs no recorder intake or
background workflow execution.

## Legacy ClientJob projection

Every read projects a fresh `ClientJob`:

- `id`, `originalFilename`, and `recordedAt` are unchanged;
- `filePath = recordingPath`, `meetingId = meetingId`;
- `retryCount = operationAttempts.RECONCILE.count`;
- `options = { language: uploadOptions.language, template: summary.template,
  minSpeakers, maxSpeakers }`;
- `noteTemplate = noteTemplate`;
- `error = failure?.message`, otherwise a string `legacy.error`, otherwise
  absent.

Status projection is exact:

- `RECORDED -> WAITING_UPLOAD`
- `UPLOADING -> UPLOADING`
- `SERVER_QUEUED|EXTRACTING|TRANSCRIBING|DOWNLOADING|SUMMARIZING -> PROCESSING`
- `TRANSCRIPT_READY -> READY`
- `COMPLETED -> COMPLETED`
- retryable/non-retryable `FAILED -> FAILED/ABANDONED`
- `CANCELLED -> DELETED`

`currentStep` maps `RECORDED|UPLOADING|SERVER_QUEUED -> QUEUED`,
`EXTRACTING -> EXTRACTING_AUDIO`,
`TRANSCRIBING|TRANSCRIPT_READY|DOWNLOADING -> TRANSCRIBING`,
`SUMMARIZING -> SUMMARIZING`, `COMPLETED -> DONE`, and terminal stages to
absent. For `FAILED`, `failedStep` maps
`UPLOAD|RECONCILE -> QUEUED`, `TRANSCRIPTION|DOWNLOAD -> TRANSCRIBING`, and
`SUMMARY -> SUMMARIZING`; otherwise it is absent.

Reads preserve exact-path lookup, pending/ready filters, newest-first Job
sorting, scheduled-time Meeting sorting, and missing-ID no-ops.

## Durable compatibility mutations

All real stage changes close the prior timestamp at one injected UTC time and
append the new open stage at that same time. Same-stage updates write nothing.
Unrelated choices, attempts, evidence, links, and legacy fields remain
unchanged.

- `addRecording(path, datetime)` creates one UUID Job plus a linked synthetic
  Meeting `legacy-add-<jobId>` with collision suffixes. A parseable zoned
  datetime normalizes to UTC; an opaque datetime uses the injected clock and is
  preserved as `legacy.recordedAt`. Meeting title is the filename base,
  scheduled/created time equals canonical `recordedAt`, language/template are
  `auto`/`meeting`, attendees is `[]`, status is `LINKED`, and `jobId` is set.
  The Job is `RECORDED`, snapshots current Codex model and recognized current
  note template (else `Internal Meeting`), has zero attempts, and has no
  failure, server ID, reconciliation time, or evidence.
- `updateOptions` changes upload language/speaker bounds and Summary template
  only.
- `resetJobForRetry` writes `RECORDED`, clears failure and every next-due time,
  and zeros `RECONCILE`.
- `setError` stores `FAILED/RECONCILE/RECORDED` and the exact message. Nonfatal
  calls increment `RECONCILE`; counts 1-3 are retryable and count 4+ is not.
  Fatal calls do not increment and are non-retryable.
- `cleanPhantomFiles` checks only projected `WAITING_UPLOAD` and retryable
  `FAILED` Jobs. A missing Recording writes `CANCELLED` and
  `legacy.error = 'File was deleted from the local disk.'`; other Jobs and
  bytes remain unchanged.

`updateStatus` handles every input:

| Input | Durable effect |
|---|---|
| `WAITING_UPLOAD` | transition to `RECORDED` |
| `UPLOADING` | transition to `UPLOADING` |
| `PROCESSING` | from `RECORDED|UPLOADING`, transition to `SERVER_QUEUED`; from any projected-processing stage, no-op; otherwise throw `INVALID_LEGACY_STATUS_TRANSITION` without writing |
| `READY` | verify/record Transcript evidence and transition to `TRANSCRIPT_READY` |
| `COMPLETED` | verify/record both finals and transition to `COMPLETED` |
| `FAILED` | write retryable `FAILED/RECONCILE/RECORDED` without incrementing |
| `ABANDONED` | write non-retryable `FAILED/RECONCILE/RECORDED` without incrementing |
| `DELETED` | transition to `CANCELLED` |

`markCompleted` is exactly `updateStatus(COMPLETED)`. READY/COMPLETED derives
the #50 final paths. Missing, empty, unreadable, or changed required finals
throw `ARTIFACT_EVIDENCE_REQUIRED` and preserve raw v2 bytes. A final without
evidence is hashed and recorded before transition; existing evidence must match
path, bytes, and digest.

Meeting CRUD reads and writes the schema-v2 `meetings` collection with existing
defaults, return shapes, ordering, missing-ID behavior, and `LINKED` updates.

## Acceptance criteria

- [ ] LowDB initialization delegates to #50 and never resets or rewrites rejected data.
- [ ] A table containing every canonical stage/failure proves every projected `ClientJob` field, including status, error, retry, options, current step, and failed step.
- [ ] Existing exact-path, filter, sort, missing-ID, Meeting CRUD, ingestion, Manual Sync, and Jobs Hub tests remain green against v2.
- [ ] Real-file tests prove the exact raw v2 effects of add/options/retry/error/phantom/status/completion mutations and no unrelated-field changes.
- [ ] Every `updateStatus` row, allowed source state, no-op, and rejection has one expected test outcome.
- [ ] Transcript and completion evidence tests cover present, missing, empty, unreadable, newly recorded, matching, and digest/byte/path mismatch rows with raw-byte no-write assertions on rejection.
- [ ] No recorder, workflow runner, server, CLI redesign, Publication execution, or retention behavior is added.

## Blocked by

- #50
