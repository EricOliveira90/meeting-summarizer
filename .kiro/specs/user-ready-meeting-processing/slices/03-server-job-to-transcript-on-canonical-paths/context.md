# Slice 03: Server Job to Transcript on Canonical Paths

## Relevant files

- `packages/server/src/services/queue.ts:11-133` - Defines `QueueInput`, step persistence, `processMeetingJob()`, the module-level `activeProcess`, and the concurrency-one `meetingQueue`.
- `packages/server/src/services/file-manager.ts:8-121` - Implements the injected artifact root, deterministic upload/audio/Transcript/Summary paths, staging, reads, existence checks, and deletion.
- `packages/server/src/services/audio-extractor.ts:11-75` - Wraps fluent-ffmpeg in `AudioExtractionService.convertToWav(inputPath, outputDir)`.
- `packages/server/src/services/transcriber.ts:5-97` - Defines `TranscriptionResult`, `TranscribeOptions`, and the spawned WhisperX adapter.
- `packages/server/scripts/whisper-x.py:47-126` - Parses the current child protocol, runs WhisperX/diarization, and writes speaker-attributed text.
- `packages/server/src/{index.ts,services/index.ts}:1-105,1-9` - Builds the production dependency graph and exports every server service through one barrel.
- `packages/server/src/services/{summarizer,gemini-provider,ai-provider}.ts` - Current server Summary graph and Gemini registration/provider implementation.
- `packages/server/src/routes/{upload,jobs}.ts:93-225,46-196` - Persist/queue accepted Recordings and expose redacted status, Transcript retrieval, retry, and deletion.
- `packages/server/src/domain/{models,ports}.ts` and `packages/shared/src/index.ts` - Persisted Job, collaborator, state, step, and transport shapes.
- `packages/server/tests/services/{queue,fileManager,recovery}.test.ts` and `tests/routes/transcriptionJobContract.test.ts` - Current process-state, artifact, recovery, and HTTP contract coverage.

## Existing behavior in touched files

- Upload gets `savePath` once from `artifacts.getUploadPath(jobId, safeOriginalName)`, stages and commits to that path, persists it as `JobRecord.filePath`, then queues the identical `{ jobId, filePath: savePath }` (`routes/upload.ts:173-213`).
- `FileManagerService(root)` returns `<root>/uploads/<jobId>_<filename>`, `<root>/audio_cache/<jobId>_<stem>.wav`, and `<root>/transcriptions/<jobId>_transcript.txt`; `readTranscript(jobId)` resolves through `getTranscriptPath(jobId)` (`file-manager.ts:10-25,73-75`).
- `processMeetingJob({jobId,filePath})` reads the persisted options, sets `PROCESSING/EXTRACTING_AUDIO`, calls `convertToWav(filePath, '')`, persists its returned path, then sets `TRANSCRIBING` and calls `transcribe(returnedAudioPath, options)` (`queue.ts:64-93`).
- The same function next starts `SUMMARIZING`, calls `summaryService.summarize(transResult.text, jobId, template)`, persists `summaryPath`, and ends as `COMPLETED/DONE`; failures persist `FAILED`, the message, and the active `currentStep` as `failedStep` (`queue.ts:95-120`).
- `convertToWav(inputPath, outputDir)` checks/creates `outputDir`, derives `<outputDir>/<input-stem>.wav`, configures `pcm_s16le`, mono, and 16000 Hz, logs the generated FFmpeg command/output path, and resolves after `ffprobe` (`audio-extractor.ts:19-69`).
- `TranscriptionService` captures `HUGGING_FACE_TOKEN` in an instance field, derives `transcriptions/<audio-stem>.txt`, passes the token in `--hf_token`, and spawns without an explicit `env` (therefore inheriting `process.env`); it buffers stdout/stderr and includes stderr in nonzero-exit errors (`transcriber.ts:18-29,31-92`).
- The transcriber-derived `<audio-stem>.txt` does not match `FileManagerService.getTranscriptPath()`'s `<jobId>_transcript.txt` when the audio stem includes the Recording name; queue persistence records the former while route retrieval reads the latter (`transcriber.ts:38-51,84-88`; `file-manager.ts:24-25,73-75`; `queue.ts:87-92`).
- The Python script currently requires `--hf_token` and `--output_file`, passes the token to `DiarizationPipeline`, writes `[<speaker>] <text>\n`, and prints JSON success/error metadata (`scripts/whisper-x.py:48-61,76-123`).
- Transcript retrieval requires `COMPLETED/DONE`, calls `artifacts.readTranscript(job.id)`, and returns exact text or `TRANSCRIPT_NOT_READY` (`routes/jobs.ts:92-118`).
- Existing global API-key auth, health/CORS, upload validation and aliases, response redaction, list filtering/pagination, retry timestamp preservation/requeue, and delete cancellation/artifact/record cleanup are route contracts from slice 02 (`index.ts:19-68`; `routes/upload.ts:93-225`; `routes/jobs.ts:46-196`).

## Patterns in use

- Route dependencies are Fastify decorations implementing `ServerDependencies { jobStore, jobQueue, artifacts }`; `buildServer()` accepts partial replacements and defaults to LowDB, `meetingQueue`, and `new FileManagerService(process.cwd())` (`domain/ports.ts:37-40`; `index.ts:14-37`).
- Processing dependencies are module singletons imported from the services barrel; queue tests replace that barrel with `vi.mock('../../src/services', ...)` (`queue.ts:3-8`; `tests/services/queue.test.ts:7-22`).
- Step changes mutate a `Partial<Record<JobStep, StepTimestamp>>`, write after each start/completion, and use ISO timestamps (`queue.ts:23-61`).
- `meetingQueue` uses better-queue with `concurrent: 1` and `afterProcessDelay: 1000`; its callback adapter converts the `processMeetingJob()` promise to queue completion (`queue.ts:124-133`).
- A module-level `activeProcess` plus `setActiveProcess()` is consumed by Job deletion, but neither current process adapter assigns its FFmpeg or Python process to it (`queue.ts:16-21`; `routes/jobs.ts:133-138`).

## Test infrastructure

- Root `npm test` is `vitest run`; discovery is `packages/**/*.{test,spec}.{ts,tsx}` and aliases shared source directly (`package.json:14`; `vitest.config.ts:4-20`).
- Queue tests mock extraction, transcription, Summary, and LowDB; they assert successful `EXTRACTING_AUDIO`, `TRANSCRIBING`, `SUMMARIZING`, `DONE`, failure attribution, and recovery-attempt reset (`tests/services/queue.test.ts:7-22,51-102`).
- File-manager tests use a fresh OS temporary directory and cover deterministic paths, directory creation, Transcript reads, existence, and deletion (`tests/services/fileManager.test.ts:7-18,22-139`).
- The authenticated HTTP harness injects in-memory store/queue/artifacts; its sentinel artifact methods return `/artifact-root/...`, and ready Transcript cases cover text, null, and rejected reads (`tests/routes/transcriptionJobContract.test.ts:39-98,652-742`).
- No automated test targets `AudioExtractionService` or `TranscriptionService`; `src/test-extraction.ts` and `src/test-whisperx.ts` are manual runners with hard-coded local filenames (`test-extraction.ts:4-32`; `test-whisperx.ts:10-26,30-94`).
- No committed audio fixture or fake Whisper executable appears in the repository; `npm run smoke:built` currently checks compiled client help and server startup/authenticated health only (`scripts/smoke-built-runtime.mjs:13-105`).

## Data model if applicable

- Shared states are `'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'`; `JobStep` is `QUEUED | EXTRACTING_AUDIO | TRANSCRIBING | SUMMARIZING | DONE` (`packages/shared/src/index.ts:1-9`).
- `JobRecord` extends shared `Job` with required `filePath`, optional `audioPath`, `transcriptPath`, `summaryPath`, `steps`, and `recoveryAttempts` (`domain/models.ts:3-10`).
- Persistence is unversioned `<process.cwd()>/db.json` with `{ jobs: JobRecord[] }`; there are no tables, migrations, or row-level access rules, and every HTTP route is covered by the global API-key hook (`services/db.ts:7-21`; `index.ts:46-68`).

## Integration boundaries

- Production flow is multipart stream -> `ArtifactStore.stageRecording/commitRecording` -> `JobStore.replace` -> `JobQueue.push({jobId,filePath})` -> FFmpeg -> WhisperX -> LowDB status/artifact fields -> authenticated `GET /jobs/:id/transcript`.
- `ArtifactStore` exposes path factories, staging, `fileExists(path)`, `readTranscript(jobId)`, Summary operations, and deletion; processing currently receives only queue input and imports concrete singleton adapters (`domain/ports.ts:21-34`; `queue.ts:3-13`).
- Startup calls `app.fileManager.ensureDirectories()`, requeues stalled Jobs through the concrete `meetingQueue`, and supplies artifact path/existence methods to recovery (`index.ts:85-95`; `recovery.ts:19-53`).
- Recovery labels first-attempt work as resume but only requeues `{jobId,filePath}`; its `FileCheckMethods` path/existence methods are not called by `recoverStalledJobs()` (`recovery.ts:5-10,23-53`).

## Potential conflicts

- Slice 02 locked and tests Transcript readiness as `COMPLETED/DONE`; its contract assigns the processing lifecycle, Summary removal, and a `TRANSCRIPT_READY` step to #46, and its handoff repeats ownership of `SUMMARIZING`/Summary removal (`slices/02-authenticated-transcription-job-http-contract/contract.md:19,24`; `handoff.md:26`).
- `services/index.ts` exports Gemini and Summary modules; importing `meetingQueue` loads the barrel, whose `summarizer.ts` registers `new GeminiProvider()` at module evaluation (`services/index.ts:1-9`; `queue.ts:3-8`; `summarizer.ts:12-16`).
- `@google/genai` remains a production server dependency and multiple route/startup tests mock it because importing `buildServer()` reaches the current service graph (`packages/server/package.json:12-21`; `tests/routes/transcriptionJobContract.test.ts:7-12`).
- Existing queue assertions require the Summary stage, and HTTP status assertions include `PROCESSING/SUMMARIZING`; both encode behavior that issue #46 removes (`tests/services/queue.test.ts:51-72`; `tests/routes/transcriptionJobContract.test.ts:528-535`).
- Slice 04 starts from the same commit and owns client upload/status/Transcript operations; slice 05 composes both slices and requires the observed order queued, extracting, transcribing, Transcript-ready (`issues/04-manual-sync-upload-and-atomic-transcript-download.md`; `issues/05-existing-recording-to-downloaded-transcript.md`).
