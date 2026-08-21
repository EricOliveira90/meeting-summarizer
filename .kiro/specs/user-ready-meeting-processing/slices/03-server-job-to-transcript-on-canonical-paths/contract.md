# Slice Contract — Server Job to Transcript on Canonical Paths

**Parent PRD:** .kiro/specs/user-ready-meeting-processing/prd.md
**GH issue:** #46
**Status:** LOCKED
**Negotiation round:** 3

## Scope lock
Excluding notebook workflows, Summary/Publication, and changes to retry, recovery, cancellation, retention, readiness, or operations, this slice processes an accepted Recording on the home server through queued, extracting, transcribing, and Transcript-ready server states. The server artifact interface supplies every path, FFmpeg and WhisperX cross replaceable process adapters, and the production server performs no Summary work (issue #46; PRD stories 12-14; ADR-0001).

### In scope
- Authenticated status exposes `PENDING/QUEUED`, live `PROCESSING/EXTRACTING_AUDIO`, live `PROCESSING/TRANSCRIBING`, then server-operation `COMPLETED/TRANSCRIPT_READY`; completed step timestamps follow that order, failures identify the active step, and no Summary step runs (issue #46 AC 1; PRD stories 12-14).
- Server `COMPLETED` means its transcription operation is complete; the canonical Job remains incomplete until the notebook also creates a Summary (CONTEXT.md Job; ADR-0001; PRD completion decision).
- Every upload, audio, and Transcript path comes from the injected artifact interface and passes unchanged through upload writing, persistence/queueing, FFmpeg, WhisperX, readiness verification, and Transcript retrieval; consumers do not reconstruct paths (issue #46 AC 2; PRD canonical-path decision).
- FFmpeg receives the exact writable audio path and produces a verified 16-kHz, mono, signed 16-bit PCM WAV before WhisperX starts (issue #46 AC 3; PRD story 13).
- WhisperX receives exact audio/Transcript paths in argv and `HUGGING_FACE_TOKEN=sentinel-hf-token` in its child environment, with no token argument (issue #46 AC 4; PRD process-security decision).
- Child output is discarded or redacted so the token and Transcript canaries are absent from captured stdout/stderr, adapter errors, and application logs on success and failure (issue #46 AC 5; PRD logging/redaction decision).
- Importing, building, starting, and processing through the production server entry graph neither loads nor invokes Gemini, `SummaryService`, or another Summary Provider (issue #46 AC 6; ADR-0001).
- A committed short Recording crosses production artifact construction, real FFmpeg, spawned fake Whisper, readiness verification, and authenticated Transcript retrieval (issue #46 AC 7-8; PRD real-process test decision).

### Non-goals (explicit out-of-scope)
- Client upload/status/download changes, local Summary creation, Publication, or the end-to-end notebook workflow (issue #46 server boundary; PRD stories 18-33).
- Real WhisperX models, GPU/CUDA, Hugging Face authentication, or Transcript quality; smoke uses a fake Whisper executable (issue #46 AC 7; PRD release acceptance).
- New retry/resume, recovery, process-tree cancellation, retention, readiness diagnostics, bridge/startup, logging rotation, migration, or rollback behavior (PRD stories 15-17 and 37-50).
- Changes to duplicate upload, validation, pagination, or public HTTP schemas except `TRANSCRIPT_READY` (issue #46; #45 HTTP contract).

### Existing behavior to preserve
- Mandatory API-key auth, health/CORS, multipart limits, both creation aliases, validation/defaults, atomic staging, and response redaction — `packages/server/src/index.ts:buildServer`, `packages/server/src/routes/upload.ts:uploadRoutes`, `packages/server/src/routes/jobs.ts:jobRoutes` (#45).
- Paginated/filterable listing, detail errors, exact `text/plain` Transcript responses, retry timestamp preservation/requeue, and delete cleanup — `packages/server/src/routes/jobs.ts:jobRoutes` (#45).
- Concurrency-one queueing, step timestamps, failed-step attribution, and recovery-attempt reset after success — `packages/server/src/services/queue.ts:processMeetingJob` (issue #46 AC 1, 8).
- Filename retention/sanitization and deterministic upload/audio/Transcript paths — `packages/server/src/services/file-manager.ts:FileManagerService` (#45; issue #46 AC 2).

### Changes to existing behavior (only if the issue asks for it)
- Replace server `SUMMARIZING` and `DONE` progression with `TRANSCRIPT_READY`: "through queued, extracting, transcribing, and Transcript-ready states without a Summary stage" (issue #46 AC 1).
- Disconnect the production server from Gemini and all Summary execution: "the home server performs no Summary work" (issue #46).

## Files expected to change
- packages/shared/src/index.ts
- packages/server/scripts/whisper-x.py
- packages/server/src/domain/ports.ts
- packages/server/src/index.ts
- packages/server/src/routes/jobs.ts
- packages/server/src/services/audio-extractor.ts
- packages/server/src/services/file-manager.ts
- packages/server/src/services/index.ts
- packages/server/src/services/queue.ts
- packages/server/src/services/recovery.ts
- packages/server/src/services/transcriber.ts
- packages/server/tests/app.test.ts
- packages/server/tests/routes/jobDeletion.test.ts
- packages/server/tests/routes/jobListing.test.ts
- packages/server/tests/routes/jobRetry.test.ts
- packages/server/tests/routes/transcriptionJobContract.test.ts
- packages/server/tests/services/audioExtractor.test.ts (new file)
- packages/server/tests/services/fileManager.test.ts
- packages/server/tests/services/processingSmoke.test.ts (new file)
- packages/server/tests/services/queue.test.ts
- packages/server/tests/services/recovery.test.ts
- packages/server/tests/services/transcriber.test.ts (new file)
- packages/server/tests/fixtures/fake-whisper.mjs (new file)
- packages/server/tests/fixtures/short-recording.wav (new file)
- scripts/smoke-built-runtime.mjs

## New patterns / deps / schema (if any)
- Replaceable FFmpeg/child-process adapters, shared `TRANSCRIPT_READY`, and Whisper token transfer by child environment. No new runtime dependency or persisted schema (issue #46 AC 1, 4, 8).

## Test plan
- Given an accepted Job and gated extractor/transcriber adapters, when authenticated status is requested before processing, while extraction is blocked, while transcription is blocked, and after release, then it reports `PENDING/QUEUED`, `PROCESSING/EXTRACTING_AUDIO`, `PROCESSING/TRANSCRIBING`, and server-operation `COMPLETED/TRANSCRIPT_READY` respectively, with ordered timestamps and no Summary step.
- Given an accepted Job whose extractor adapter fails, when authenticated status is requested after processing rejects, then it reports `FAILED` with `failedStep: EXTRACTING_AUDIO`.
- Given an accepted Job whose extractor succeeds and transcriber adapter fails, when authenticated status is requested after processing rejects, then it reports `FAILED` with `failedStep: TRANSCRIBING`.
- Given unrelated sentinel paths from one injected artifact interface, when upload and processing run, then upload commit/persistence/queueing, FFmpeg input/output, WhisperX input/output, existence verification, persisted paths, and Transcript read receive those exact values unchanged.
- Given the committed Recording and canonical audio path, when real FFmpeg runs, then `ffprobe` reports one 16,000-Hz mono `pcm_s16le` stream at that exact path before fake Whisper starts.
- Given a fake Whisper that records env/argv and, on failure, emits token and Transcript canaries to both stdout and stderr, when both modes run, then the exact token exists only in child env, argv has no token, and captured diagnostics, thrown errors, and application logs contain neither canary.
- Given no Gemini configuration and a Summary module/provider that fails if loaded, when the built production entry is imported, started, and processes a Job, then health and processing succeed without loading or invoking it.
- Given the committed Recording, production `FileManagerService`, real FFmpeg, and spawned fake Whisper, when the smoke runs, then authenticated status reaches server-operation `COMPLETED/TRANSCRIPT_READY` and Transcript retrieval returns exact sentinel text.
- Given two queued Jobs and the first Job's process adapter blocked, when the queue runs, then the second remains `PENDING/QUEUED` with no process invocation until the first finishes.
- Given a valid API key and `Origin` header, when health is requested, then the existing health body and permissive CORS response header are returned; existing upload/list/detail/retry/delete/recovery/Transcript-not-ready suites remain green.
- Given all changes, when `npm test`, `npm run build`, and `npm run smoke:built` run, then each exits zero.

## Definition of done
- [ ] Server transcription reaches a verified, retrievable `COMPLETED/TRANSCRIPT_READY` result without declaring the canonical Job complete
- [ ] Every artifact consumer uses the authoritative injected path unchanged
- [ ] FFmpeg format, live stages, queue serialization, Whisper environment protocol, and redaction are proven
- [ ] Real-FFmpeg/fake-Whisper smoke, CORS preservation, and production no-Summary graph checks pass
- [ ] All tests pass locally
- [ ] No regression in existing suite
- [ ] Evaluator has signed off via qa-report.md
