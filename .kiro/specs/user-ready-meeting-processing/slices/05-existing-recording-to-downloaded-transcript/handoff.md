# Handoff

## What shipped
- Existing Recording metadata, ordered server states, redaction, atomic Transcript, and READY client outcome: `packages/client/tests/integration/existingRecordingToDownloadedTranscript.test.ts:runIntegratedSuccessJourney`
- Exact authentication and language-validation rejection outcomes: `packages/client/tests/integration/existingRecordingToDownloadedTranscript.test.ts:runCreationRejectionJourney`
- Extraction and transcription failure attribution without partial notebook Transcripts: `packages/client/tests/integration/existingRecordingToDownloadedTranscript.test.ts:runProcessingFailureJourneys`
- Write, verification-read, mismatch, rename, and interrupted-download recovery: `packages/client/tests/integration/existingRecordingToDownloadedTranscript.test.ts:runTransferFailureJourneys`
- Populated Summary and process-credential redaction canaries for every observed status source: `packages/client/tests/integration/existingRecordingToDownloadedTranscript.test.ts:seedRedactionSource`
- Exact transfer retry diagnostics for all five injected faults: `packages/client/tests/integration/existingRecordingToDownloadedTranscript.test.ts:TRANSFER_FAILURE_REASONS`

## Decisions made during implementation
- Pause and resume the production processing queue so Manual Sync observes the queued state deterministically before the controlled extraction and transcription adapters run.
- Reload the production server modules from each temporary server root so the real server LowDB store remains isolated between acceptance scenarios.
- Interrupt the dedicated Transcript HTTP response at the TCP socket after partial output instead of replacing `ApiService`.
- Use an `.mkv` Recording for the integrated success path because its inferred multipart media type matches the locked server contract.
- Persist redaction canaries under prohibited status keys and snapshot the source before each authenticated status request.
- Assert transfer diagnostics against an independent fault-to-reason table; the interrupted response produces `socket hang up`.

## Gotchas / learnings
- Node `form-data` infers `.wav` as `audio/wave`, while the server accepts `.wav` only as `audio/wav`; the real `ApiService` therefore cannot currently submit WAV Recordings without an explicit multipart content type.
- `pnpm test` reports the existing workspace and future Vite config-loader warnings.
- The production audit reports two moderate `uuid` findings below the configured high-severity failure threshold.
- The production build passes. A separate whole-client test type-check is not configured as a repository gate and reports existing test/type errors plus cross-workspace `rootDir` errors for this acceptance suite.

## Status
Tests passing locally. No regressions.
