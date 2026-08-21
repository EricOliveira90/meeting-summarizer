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

The exported parser boundary is exact:

```ts
type ClientStoreData = ClientStoreV1 | ClientStoreV2;
type ClientStoreParseResult = ClientStoreData | ClientDbInvalid;
declare function parseClientStore(input: unknown): ClientStoreParseResult;
```

Every operation key is present. IDs, paths, filenames, failure messages, and
models are non-empty strings. Counts and speaker bounds are non-negative
integers, and `minSpeakers <= maxSpeakers` when both exist. SHA-256 values are
lowercase 64-character hex strings.

## JSON value contract

`JsonValue` is null, boolean, string, finite number, a dense `JsonValue[]`, or a
cycle-free plain record whose prototype is `Object.prototype` or null and whose
own keys are enumerable string data properties. Shared acyclic references are
valid.

Reject root or nested `undefined`, symbol, function, bigint, `NaN`, infinities,
array holes, cycles, accessors, symbol or non-enumerable keys, Date/Map/Set, and
class instances as `NON_JSON_VALUE`. Scan depth-first in array-index and
`Object.keys` order before schema validation. Report the value, hole, or cycle
back-edge pointer. For an invalid object property shape that has no canonical
JSON member representation, including symbol keys, non-enumerable keys, and
accessors, report the containing-object pointer. For example, a symbol key on a
nested `metadata` extension reports `#/jobs/0/metadata`.

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
- A current `SUMMARIZING` or `COMPLETED` Job requires Transcript evidence. A
  current `COMPLETED` Job also requires Summary evidence. `TRANSCRIPT_READY`
  and `DOWNLOADING` do not require committed local Transcript evidence.
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

Invariant diagnostics are exact:

- `minSpeakers > maxSpeakers`: the `maxSpeakers` pointer /
  `INVALID_TIMESTAMP_ORDER`.
- Empty stage history: `stageTimestamps/0` / `MISSING_FIELD`.
- Wrong first or final stage: the offending `stage` / `INVALID_ENUM`.
- First start different from `recordedAt`, a prior start after completion, or a
  prior completion after the next start: the offending timestamp /
  `INVALID_TIMESTAMP_ORDER`.
- Duplicate stage: the duplicate `stage` / `DUPLICATE_STAGE`.
- Missing prior completion: that `completedAt` / `MISSING_FIELD`; completion on
  the final stage: that `completedAt` / `UNKNOWN_FIELD`.
- Missing required Transcript or Summary evidence: that artifact member /
  `MISSING_FIELD`; unsupported or early evidence: its `committedAt` /
  `INVALID_TIMESTAMP_ORDER`.
- Early `nextAttemptAt`, `lastReconciledAt`, or attempt completion: the
  offending timestamp / `INVALID_TIMESTAMP_ORDER`.
- Missing attempt-status fields: the missing member / `MISSING_FIELD`;
  status-forbidden `completedAt`, `error`, `actualPath`, or `jobId`: the
  offending member / `UNKNOWN_FIELD`.

## Acceptance criteria

- [ ] Export the exact schema-v2 types, `ClientStoreV1`, `ClientStoreV2`, `ClientStoreData = ClientStoreV1 | ClientStoreV2`, `ClientStoreParseResult = ClientStoreData | ClientDbInvalid`, and `parseClientStore(input: unknown): ClientStoreParseResult` without changing LowDB behavior.
- [ ] Accept minimal and full valid v1/v2 fixtures, unknown JSON-valued v1 entry fields, opaque v1 dates, and every optional canonical field.
- [ ] Pass full v1 fixtures with Meetings present and absent, plus one full v2 fixture, through both JSON-text and deep-frozen parsed-value inputs. Every pair returns the exact same canonical data; v1 preserves every known and unknown Job/Meeting entry field and only the absent case gains `meetings: []`.
- [ ] Deep-freeze each parsed input and compare its complete structure before and after parsing; the parser neither throws from attempted mutation nor changes any caller-owned object or nested value.
- [ ] Positive deep-frozen parsed-input rows accept and preserve a nested null-prototype record and one plain record shared by two accepted extension fields without treating the repeated reference as a cycle.
- [ ] Reject null/array roots, wrong collections, missing and unknown fields, wrong primitive types, invalid enums/counts/speaker bounds/hashes, missing operation keys, duplicate stages, and each stated timestamp relationship.
- [ ] Reject every named non-JSON JavaScript shape and return the exact JSON Pointer, finite reason, code, and derived message for each finite invalid row and every explicit precedence row, including the containing-object pointer for a nested symbol-key fixture.
- [ ] Pure table tests cover one valid and one invalid boundary for each field class, all enum members, counts `-1/0/0.5`, each attempt status shape, each evidence-support rule, and every timestamp-order rule.
- [ ] An isolated no-emit TypeScript consumer imports only the domain barrel and uses positive assignments plus `@ts-expect-error` rows to prove every export, alias, union member, required field, forbidden field, and parser-result narrowing.
- [ ] The validator has no filesystem, LowDB, config, recorder, workflow, or server side effects.

## Blocked by

- #34
