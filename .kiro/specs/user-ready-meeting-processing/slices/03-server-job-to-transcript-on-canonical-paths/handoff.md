# Handoff

## What shipped
- Transcript-ready server lifecycle: `packages/server/src/services/queue.ts:processMeetingJob`
- Authenticated ready Transcript retrieval: `packages/server/src/routes/jobs.ts:jobRoutes`
- Canonical processing paths: `packages/server/src/services/queue.ts:ProcessingDependencies`
- Exact-path Transcript reads: `packages/server/src/services/file-manager.ts:FileManagerService.readTranscript`
- Verified Whisper-ready WAV extraction: `packages/server/src/services/audio-extractor.ts:AudioExtractionService.convertToWav`
- Environment-only Whisper token transfer and discarded child output: `packages/server/src/services/transcriber.ts:TranscriptionService.transcribe`
- Environment-based Python Whisper token consumption: `packages/server/scripts/whisper-x.py:main`
- Summary-free production service graph: `packages/server/src/services/index.ts`
- Real-process source and built-runtime smoke coverage: `packages/server/tests/services/processingSmoke.test.ts` and `scripts/smoke-built-runtime.mjs:smokeServer`

## Decisions made during implementation
- Persist `COMPLETED/TRANSCRIPT_READY` and its timestamps atomically so status never exposes `PROCESSING/TRANSCRIPT_READY`.
- Pass the persisted Transcript path into artifact reads instead of resolving it again from the Job ID.
- Discard Whisper stdout and stderr at the process boundary and return generic process errors.
- Keep legacy Summary implementation modules isolated for existing direct tests while removing them from production entry graphs.

## Gotchas / learnings
- Server `COMPLETED` means transcription is complete; the canonical Job remains incomplete until the notebook creates a Summary.
- `pnpm test` reports the existing workspace and future Vite config-loader warnings.
- The committed Recording fixture is force-added because the repository ignores WAV files by default.

## Status
Tests passing locally. No regressions.
