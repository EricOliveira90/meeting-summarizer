# FileManagerService + Directory Bootstrapping

## Parent PRD

#9

## What to build

A `FileManagerService` that centralizes all file path conventions and directory bootstrapping, replacing the scattered `path.join()` calls currently spread across `queue.ts`, `summarizer.ts`, `transcriber.ts`, `audio-extractor.ts`, and `index.ts`.

The service provides:
- **Deterministic path methods** for each file type: `getUploadPath(jobId, filename)`, `getAudioPath(jobId, filename)`, `getTranscriptPath(jobId, filename)`, `getSummaryPath(jobId)`
- **Directory bootstrapping**: `ensureDirectories()` creates all four directories (`uploads/`, `audio_cache/`, `transcriptions/`, `summaries/`) on startup
- **File reading methods**: `readTranscript(jobId)` and `readSummary(jobId)` return file content or null — used by route handlers to hydrate job responses

All existing services (`queue.ts`, `summarizer.ts`, `transcriber.ts`, `audio-extractor.ts`) are updated to resolve paths through `FileManagerService` instead of inline `path.join()`. The queue processor stops deleting the source upload file after audio extraction (files persist permanently per PRD architectural decision).

See **Phase 1** of the [server-hardening plan](plans/server-hardening.md) for full details.

## Acceptance criteria

- [ ] `FileManagerService` provides `getUploadPath`, `getAudioPath`, `getTranscriptPath`, `getSummaryPath` with deterministic naming
- [ ] `ensureDirectories()` creates all four directories (`uploads/`, `audio_cache/`, `transcriptions/`, `summaries/`) on startup
- [ ] `readTranscript(jobId)` and `readSummary(jobId)` return file content or null
- [ ] Queue processor, summarizer, transcriber, and audio-extractor use `FileManagerService` for all path resolution
- [ ] Source upload file is no longer deleted after audio extraction
- [ ] All files (uploads, audio, transcriptions, summaries) persist permanently unless explicitly deleted
- [ ] Existing tests pass; new unit tests cover path resolution, file reading, and directory creation

## Blocked by

None — can start immediately.

## User stories addressed

- User story 11: Single service owns all file path conventions
- User story 12: Server bootstraps all required directories on startup
- User story 13: File reading logic centralized in one service
- User story 19: All server files persist permanently unless explicitly deleted
