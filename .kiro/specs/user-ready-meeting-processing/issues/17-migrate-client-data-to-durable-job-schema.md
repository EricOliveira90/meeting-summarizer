# Migrate Client Data to the Durable Job Schema

## Parent

Part of #32.

## What to build

Establish the notebook's schema-v2 persistence boundary before recorder intake.
Migrate the current LowDB database through a byte-identical restorable backup,
lock the canonical Job and Recording-attempt JSON shapes, and preserve current
client callers through an exact compatibility mapping. This slice performs no
recording or workflow execution.

## Canonical schema-v2 contract

The root is exactly `{ schemaVersion: 2, jobs, meetings, recordingAttempts }`.
Known fields use these shapes:

```ts
type JobStage =
  | 'RECORDED' | 'UPLOADING' | 'SERVER_QUEUED' | 'EXTRACTING'
  | 'TRANSCRIBING' | 'TRANSCRIPT_READY' | 'DOWNLOADING'
  | 'SUMMARIZING' | 'COMPLETED' | 'FAILED' | 'CANCELLED';
type ClientOperation =
  | 'UPLOAD' | 'RECONCILE' | 'DOWNLOAD' | 'SUMMARY' | 'TRANSCRIPTION';
type ArtifactEvidence = {
  path: string; sha256: string; bytes: number; committedAt: string;
};
type StageTimestamp = {
  stage: JobStage; startedAt: string; completedAt?: string;
};
type OperationAttempt = { count: number; nextAttemptAt?: string };
type JobFailure = {
  operation: ClientOperation;
  message: string;
  retryable: boolean;
  resumeStage: JobStage;
};
type DurableJob = {
  id: string;
  stage: JobStage;
  recordingPath: string;
  originalFilename: string;
  recordedAt: string;
  meetingId: string;
  serverJobId?: string;
  uploadOptions: {
    language: 'auto' | 'en' | 'pt' | 'es';
    minSpeakers?: number;
    maxSpeakers?: number;
  };
  summary: {
    provider: 'codex';
    model: string;
    template: 'meeting' | 'training' | 'summary';
  };
  noteTemplate?: 'Internal Meeting' | 'Seller Meeting' | 'Training' | 'Simple Summary';
  artifacts: {
    transcript?: ArtifactEvidence;
    summary?: ArtifactEvidence;
  };
  stageTimestamps: StageTimestamp[];
  operationAttempts: Record<ClientOperation, OperationAttempt>;
  failure?: JobFailure;
  lastReconciledAt?: string;
  legacy?: Record<string, JsonValue>;
};
type RecordingAttempt = {
  id: string;
  meetingId: string;
  expectedPath: string;
  actualPath?: string;
  uploadOptions: DurableJob['uploadOptions'];
  summary: DurableJob['summary'];
  noteTemplate?: DurableJob['noteTemplate'];
  startedAt: string;
  completedAt?: string;
  status: 'RECORDING' | 'RECORDED' | 'FAILED' | 'CANCELLED';
  error?: string;
  jobId?: string;
};
```

The optional note template is the snapshotted Publication choice. Every
operation key is present in `operationAttempts`. SHA-256 values are lowercase
64-character hex strings, byte counts and attempt counts are non-negative
integers, IDs and paths are non-empty strings, enums accept only the values
above, and generated timestamps are valid UTC ISO-8601 strings.

## Accepted and rejected data

- Valid schema v1 is a plain object with required `jobs`, optional `meetings`,
  and optional `schemaVersion`; no other root keys are accepted.
  `schemaVersion` is absent or `1`, `jobs` is an array, and absent `meetings`
  means `[]`.
- A v1 Job requires non-empty string `id`, `filePath`, `originalFilename`, and
  `recordedAt`; a canonical legacy status; and integer `retryCount >= 0`.
  Optional `options`, error, step, note-template, and Meeting fields must match
  their current enums/types. Unknown JSON-valued entry fields are accepted and
  preserved in `legacy`.
- A v1 Meeting requires every current required Meeting field with current
  enum/array/number/string types. Optional speaker bounds, note template, and
  `jobId` must match their current types. Unknown JSON-valued Meeting fields
  remain unchanged.
- Valid schema v2 has exactly the four root keys. Jobs and attempts reject
  missing required fields, unknown fields outside `legacy`, wrong nested types,
  invalid enums, negative/non-integer counts, duplicate stage entries, invalid
  timestamp ordering, malformed evidence, and missing operation keys. Meetings
  use the v1 Meeting validation rule.
- Null/array roots, missing/non-array collections, unknown root keys, invalid
  entries, schema versions other than 1 or 2, and non-JSON values fail closed.
  Opening rejected data reports the field path and reason and does not rewrite
  any database byte.

## Acceptance criteria

- [ ] An absent database initializes directly as empty v2 without creating a backup.
- [ ] Before the first v2 write, exact v1 bytes are copied to sibling `<database>.v1-<YYYYMMDDTHHmmssSSSZ>.bak`; collisions append `-2`, `-3`, and so on without overwrite.
- [ ] Migration reads back and byte-compares the backup, writes and parses a unique sibling temporary v2 file, and only then renames it over the database. Any read, backup, compare, serialize, temporary-write, parse, or rename failure leaves the original bytes unchanged and reports the failed operation.
- [ ] Restoring backup bytes over the migrated file migrates again with every original Job and Meeting field unchanged. Reopening valid v2 performs no write and creates no backup.
- [ ] Migration preserves stable Job IDs, Recording paths/times, Meeting linkage, processing choices, provider/templates, errors, retries, and the full original Job under `legacy`. Orphan Jobs receive deterministic collision-free synthetic Meetings and a required `meetingId`.
- [ ] Missing legacy choices fall back through Job, linked Meeting, then current config/defaults. Provider/model come from current Codex config; language defaults to `auto`; Summary template defaults to `meeting`; optional note template is preserved.
- [ ] `WAITING_UPLOAD`, `UPLOADING`, and `PROCESSING` map to `RECORDED`. `FAILED` and `ABANDONED` map to `FAILED` with operation `RECONCILE`, resume `RECORDED`, preserved error, and retryability true only for `FAILED`. `DELETED` maps to `CANCELLED`.
- [ ] Derive legacy finals from the injected notebook root and `path.parse(originalFilename).name`: `transcriptions/<base>_transcription.txt` and `summaries/<base>_summary.txt`.
- [ ] `READY` maps to `TRANSCRIPT_READY` only when its derived Transcript is readable and non-empty, otherwise `RECORDED`. `COMPLETED` maps to `COMPLETED` with both verified finals, `TRANSCRIPT_READY` with Transcript only, otherwise `RECORDED`.
- [ ] Every verified migrated artifact receives its exact path, SHA-256, byte count, and migration time. Migration never promotes from status alone.
- [ ] Migrated timestamps start with `RECORDED` at `recordedAt` and append only the evidence-supported or terminal mapped stage at migration time. `RECONCILE.count` starts at legacy `retryCount`; every other count starts at zero; next-due, server ID, and reconciliation time start absent.
- [ ] Legacy projections are exact: `RECORDED -> WAITING_UPLOAD`, `UPLOADING -> UPLOADING`, `SERVER_QUEUED|EXTRACTING|TRANSCRIBING|DOWNLOADING|SUMMARIZING -> PROCESSING`, `TRANSCRIPT_READY -> READY`, `COMPLETED -> COMPLETED`, retryable/non-retryable `FAILED -> FAILED/ABANDONED`, and `CANCELLED -> DELETED`.
- [ ] `addRecording` creates a synthetic linked Meeting and zero-attempt `RECORDED` Job. `updateOptions` changes upload options and Summary template only. `resetJobForRetry` writes `RECORDED`, clears failure/next due, and zeros `RECONCILE`.
- [ ] `setError` increments nonfatal `RECONCILE`, writes `FAILED/RECONCILE/RECORDED`, and remains retryable only below count four; fatal errors do not increment and are non-retryable. `cleanPhantomFiles` writes `CANCELLED` with the existing deletion message.
- [ ] `updateStatus(READY)` derives and verifies the Transcript, persists evidence, and writes `TRANSCRIPT_READY`; `updateStatus(COMPLETED)` and `markCompleted` derive and verify both finals, persist both evidences, and write `COMPLETED`.
- [ ] Evidence-gated legacy mutations reject with `ARTIFACT_EVIDENCE_REQUIRED` and leave raw v2 bytes unchanged when required finals are missing, empty, unreadable, or do not match already-persisted evidence. Files present without evidence are verified and recorded before the stage change.
- [ ] Every real stage change closes the previous stage timestamp and appends the new stage. Status-only updates leave unrelated options, attempts, and evidence unchanged.
- [ ] Real LowDB/filesystem tests cover every accepted/rejected root and record case, backup collision/restore/faults, every legacy mapping and artifact combination, every projection and mutation, completion evidence outcomes, raw v2 effects, and reopen idempotence.

## Blocked by

- #34
