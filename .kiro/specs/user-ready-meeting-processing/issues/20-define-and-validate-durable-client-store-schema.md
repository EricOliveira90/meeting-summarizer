# Define and Validate the Durable Client Store Schema

## Parent

Part of #32.

## What to build

Define the notebook-owned schema-v2 Job and Recording-attempt types and a pure,
fail-closed validator for schema v1 and v2. This slice performs no filesystem
migration, LowDB wiring, compatibility projection, recording, or workflow
execution. #50 consumes this validator for migration, and #51 wires the migrated
store through existing client callers.

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

Every operation key is present. IDs, paths, filenames, failure messages, and
models are non-empty strings. Counts and speaker bounds are non-negative
integers, and `minSpeakers <= maxSpeakers` when both exist. SHA-256 values are
lowercase 64-character hex strings.

## Accepted schema v1

- The root is an object with required `jobs`, optional `meetings`, and optional
  absent/`1` `schemaVersion`; no other root key is accepted. Absent `meetings`
  means `[]`.
- A Job requires non-empty `id`, `filePath`, `originalFilename`, and
  `recordedAt`; one current `ClientJobStatus`; and integer `retryCount >= 0`.
  Optional `options`, `error`, `currentStep`, `failedStep`, `noteTemplate`, and
  `meetingId` must match current types and enums. Optional IDs are non-empty
  when present. Unknown entry fields are accepted only when JSON-valued.
- A Meeting requires every current field. `id`, `title`, `scheduledAt`, and
  `createdAt` are non-empty; attendees are strings; enums and speaker bounds
  use current values and integer rules; optional `jobId` is non-empty. Unknown
  JSON-valued Meeting fields are preserved by #50.
- Legacy date strings remain opaque non-empty strings. V1 validation does not
  require them to be parseable timestamps.

## Accepted schema v2

- The root has exactly the four canonical keys. Jobs and attempts reject
  unknown fields outside `legacy`; Meetings use the accepted-v1 Meeting shape.
- Generated timestamps are calendar-valid UTC
  `YYYY-MM-DDTHH:mm:ss[.fraction]Z` instants.
- A Job has a non-empty `stageTimestamps`. The first entry is `RECORDED` with
  `startedAt === recordedAt`; stages are unique; the final entry is the current
  `stage` and has no `completedAt`; every prior entry has
  `startedAt <= completedAt <= next.startedAt`.
- Transcript evidence requires a timestamp for
  `TRANSCRIPT_READY|DOWNLOADING|SUMMARIZING|COMPLETED`. Summary evidence
  requires a `COMPLETED` timestamp. Evidence `committedAt` is at or after
  `recordedAt` and its first supporting stage start.
- `nextAttemptAt` is at or after the current-stage start.
  `lastReconciledAt` is at or after `recordedAt`.
- A Recording attempt validates only its own times:
  `completedAt >= startedAt` when present. `RECORDING` has no completion,
  error, actual path, or Job ID. `RECORDED` requires completion, actual path,
  and Job ID and has no error. `FAILED` requires completion and error and has
  no Job ID. `CANCELLED` requires completion, has no error, and has no Job ID.

## Validation diagnostics

Validation returns either typed data or:

```ts
{
  code: 'CLIENT_DB_INVALID';
  fieldPath: string;
  reason: ValidationReason;
  message: `Invalid client database at ${fieldPath}: ${reason}`;
}
```

`fieldPath` is an RFC 6901 URI-fragment JSON Pointer: `#` is root, tokens append
as `/token`, and `~`/`/` escape as `~0`/`~1`. `ValidationReason` is exactly:

`MALFORMED_JSON|NON_JSON_VALUE|EXPECTED_OBJECT|EXPECTED_ARRAY|EXPECTED_STRING|`
`EXPECTED_NON_EMPTY_STRING|EXPECTED_NUMBER|EXPECTED_BOOLEAN|`
`EXPECTED_NON_NEGATIVE_INTEGER|MISSING_FIELD|UNKNOWN_FIELD|`
`INVALID_SCHEMA_VERSION|INVALID_ENUM|INVALID_TIMESTAMP|`
`INVALID_TIMESTAMP_ORDER|DUPLICATE_STAGE|MISSING_OPERATION_KEY|INVALID_SHA256`.

Each test fixture has one defect unless it is an explicit precedence row.
Overlapping defects use this precedence:

1. malformed JSON, non-JSON values, then container kind;
2. required fields, with missing operation names reported as
   `MISSING_OPERATION_KEY` and every other missing field as `MISSING_FIELD`;
3. primitive type (`EXPECTED_*`);
4. non-empty and non-negative constraints;
5. schema version, enum, timestamp, and SHA-256 format;
6. duplicate stage, timestamp ordering, then unknown field.

Thus a numeric enum is `EXPECTED_STRING`, a missing operation key is
`MISSING_OPERATION_KEY`, and a non-string hash is `EXPECTED_STRING`.

## Acceptance criteria

- [ ] Export the exact schema-v2 types and pure schema-v1/schema-v2 parser without changing LowDB behavior.
- [ ] Accept minimal and full valid v1/v2 fixtures, unknown JSON-valued v1 entry fields, opaque v1 dates, and every optional canonical field.
- [ ] Pass one full v1 fixture with absent Meetings and known/unknown Job and Meeting fields, plus one full v2 fixture, through both JSON-text and deep-frozen parsed-value inputs. All four calls return the exact same canonical data; v1 adds exactly `meetings: []` and preserves every known and unknown entry field.
- [ ] Deep-freeze each parsed input and compare its complete structure before and after parsing; the parser neither throws from attempted mutation nor changes any caller-owned object or nested value.
- [ ] Reject null/array roots, wrong collections, missing and unknown fields, wrong primitive types, invalid enums/counts/speaker bounds/hashes, missing operation keys, duplicate stages, and each stated timestamp relationship.
- [ ] Return the exact JSON Pointer, finite reason, code, and derived message for each finite invalid row and every explicit precedence row.
- [ ] Pure table tests cover one valid and one invalid boundary for each field class, all enum members, counts `-1/0/0.5`, each attempt status shape, each evidence-support rule, and every timestamp-order rule.
- [ ] The validator has no filesystem, LowDB, config, recorder, workflow, or server side effects.

## Blocked by

- #34
