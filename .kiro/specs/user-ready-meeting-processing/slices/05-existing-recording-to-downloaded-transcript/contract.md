# Slice Contract — Existing Recording to Downloaded Transcript

**Parent PRD:** .kiro/specs/user-ready-meeting-processing/prd.md
**GH issue:** #33
**Status:** LOCKED
**Negotiation round:** 2

## Scope lock
Excluding new production behavior, automatic processing, Summary creation, Publication, Jobs Hub changes, and server operational tooling, this slice proves the first integrated production tracer bullet: repeated Manual Sync cycles submit one persisted existing Recording through the authenticated server, observe transcription progress, and atomically receive its speaker-attributed Transcript while the canonical Job remains incomplete (issue #33; PRD stories 6, 8-10, 12-14, 18-19; ADR-0001).

### In scope
- One acceptance suite's success path composes the real public `SyncManager`, `ApiService`, `LowDB`, `NodeFileSystem`, listening `buildServer`, server Job/artifact stores, and processing queue. External ingestion/Note collaborators and FFmpeg/Whisper adapters are replaced; transfer-failure cases may additionally replace `IFileManager` to inject deterministic write, read, mismatch, and rename faults (issue #33 AC 6-7; #47 transfer contract; Architecture Verification).
- Starting with one persisted existing Recording, Manual Sync sends its existing Job ID, original `recordedAt`, language, and sparse speaker bounds through authenticated `POST /jobs`; repeated cycles leave exactly one client Job, one server Job, and one creation request (issue #33 AC 1 and 6; #47 contract).
- Gated processing makes the integrated journey observe `PENDING/QUEUED`, `PROCESSING/EXTRACTING_AUDIO`, `PROCESSING/TRANSCRIBING`, and server-operation `COMPLETED/TRANSCRIPT_READY` in order through authenticated status responses (issue #33 AC 2; #46 contract).
- Every observed success and failure status body excludes artifact-root values, artifact path keys, Transcript/Summary text, and credential sentinels; Transcript text crosses only `GET /jobs/:id/transcript` (issue #33 AC 5; #45 redaction and download contract).
- The exact speaker-attributed Transcript is verified and atomically renamed to `<notebook-root>/transcriptions/<recording-base>_transcription.txt`; no sibling `.tmp` remains (issue #33 AC 3; #47 atomic-download contract; PRD story 19).
- Success executes no Summary Provider or Publication collaborator, creates no Summary/Publication artifact, and leaves the client Job `READY`, not `COMPLETED`, for later Summary creation (issue #33 AC 4; ADR-0001; PRD story 29).
- Missing/wrong auth preserve #45's exact 401 triples; representative validation `x-language: fr` preserves exact 400/`INVALID_LANGUAGE`/`x-language must be one of: auto, en, pt, es.`; extraction/transcription preserve their exact `failedStep`; transfer faults preserve #47's retry diagnostic/outcome. Each leaves no duplicate Job or newly committed partial Transcript (issue #33 AC 6; #45-#47 contracts).

### Non-goals (explicit out-of-scope)
- Reimplementing or changing upload validation, redaction, server processing, artifact paths, or atomic notebook transfer; prerequisite issues #45-#47 own those behaviors (issue #33 “integration wiring and acceptance evidence”).
- Real WhisperX models, GPU/CUDA, Transcript-quality evaluation, or another real-process smoke; #46 already owns real FFmpeg/fake Whisper coverage (issue #33 AC 7; #46 AC 7).
- Summary Provider selection/execution, Summary writes, Publication, or canonical Job completion (ADR-0001; PRD stories 20-33).
- Automatic enqueue/watch, lifecycle migration, restart recovery, backoff, or replacement of Manual Sync (PRD stories 4-6 and implementation decision).
- Jobs Hub, retry/cancellation redesign, retention, readiness, bridge, startup, or operational tooling (PRD stories 34-50).
- Recording capture, orphan-ingestion timestamp correction, or Meeting-linkage repair (issue #33 starts from a persisted existing Recording; explorer Potential Conflicts).

### Existing behavior to preserve
- Scan, reconcile, download, then upload ordering and Manual Sync command delegation — `packages/client/src/services/syncManager.ts:SyncManager.runFullSyncCycle`, `packages/client/src/commands/sync.ts:runSync` (#47).
- Existing Recording scan/filter/prompt behavior and LowDB Job/Meeting persistence — `packages/client/src/services/ingestion.ts:IngestionService`, `packages/client/src/services/db.ts:LowDB` (issue #33 AC 9).
- Pre-creation lookup, exact metadata upload, status mapping, transfer diagnostics, and `READY` outcome — `packages/client/src/services/syncManager.ts:SyncManager`, `packages/client/src/services/api.ts:ApiService` (#47).
- Auth, validation/defaults, redaction, pagination, retry, deletion, and Transcript download — `packages/server/src/index.ts:buildServer`, `packages/server/src/routes/upload.ts:uploadRoutes`, `packages/server/src/routes/jobs.ts:jobRoutes` (#45).
- Canonical paths, ordered server stages, failed-step attribution, queue serialization, and Summary-free production graph — `packages/server/src/services/queue.ts:processMeetingJob`, `packages/server/src/services/index.ts` (#46).
- Existing Recording, Meeting, server Job, Jobs Hub, Summary, and Publication suites remain unchanged and green (issue #33 AC 9).

### Changes to existing behavior (only if the issue asks for it)
None

## Files expected to change
- packages/client/tests/integration/existingRecordingToDownloadedTranscript.test.ts (new file)

## New patterns / deps / schema (if any)
- One cross-workspace acceptance suite using existing constructor/dependency seams; no runtime dependency, public contract, or persisted-schema change (issue #33 AC 7; Conventions Modules).

## Test plan
- Given a persisted Recording with a stable Job ID, offset timestamp, language, and bounds `2/5`, when Manual Sync runs against a listening authenticated server, then one creation persists the same ID, normalized original time, language, and bounds, and later cycles never create a duplicate.
- Given gated extractor and transcriber adapters, when Manual Sync cycles run before processing, at each gate, and after release, then authenticated status observations occur in the exact queued, extracting, transcribing, Transcript-ready order with ordered timestamps.
- Given path, Transcript, Summary, API-key, and process-credential sentinels, when every queued, extracting, transcribing, Transcript-ready, extractor-failed, and transcriber-failed status body is inspected, then none appears and no prohibited path/text key appears; only the dedicated Transcript response contains the Transcript.
- Given exact multi-speaker Transcript text at Transcript readiness, when the next Manual Sync runs, then the expected final notebook file matches exactly, no temporary or Summary/Publication artifact exists, no Summary/Publication collaborator ran, and the persisted client Job is `READY`.
- Given an otherwise valid creation with no API key, a wrong sentinel key, or `x-language: fr`, when the public server interface is called, then responses are exactly 401/`AUTH_REQUIRED`/`API credential is required.`, 401/`AUTH_INVALID`/`API credential is invalid.`, or 400/`INVALID_LANGUAGE`/`x-language must be one of: auto, en, pt, es.` respectively, with zero queued/server Job and no committed notebook Transcript.
- Given extractor or transcriber failure, when processing and another Manual Sync complete, then status is `FAILED` with the exact active `failedStep`, one Job remains on each machine, and no final or temporary notebook Transcript exists.
- Given an existing final Transcript sentinel, when a fault-injected `IFileManager` causes write, verification-read, mismatch, or rename failure, or Transcript download is interrupted, then #47's exact retry diagnostic/outcome remains, the sentinel is byte-for-byte unchanged, temporary data is absent, and no upload or duplicate Job occurs.
- Given a clean checkout, when `npm ci`, `npm run build`, `npm run audit:production`, and `npm test` run, then each exits zero and the existing behavior suites remain green (issue #33 AC 8-9).

## Definition of done
- [ ] One acceptance suite proves the integrated metadata, ordered-state, redaction, atomic-download, and no-Summary journey
- [ ] Auth, validation, processing, and transfer failures preserve prerequisite outcomes without duplicate Jobs or partial Transcripts
- [ ] The client Job remains `READY` for later Summary creation
- [ ] Clean-checkout install, build, production audit, and test commands pass
- [ ] All tests pass locally
- [ ] No regression in existing suite
- [ ] Evaluator has signed off via qa-report.md
