# QA Report

**Verdict:** FAIL
**Failure class:** IMPLEMENTATION

## Pass 1: Functional Correctness
- Sanity commands: PASS
- UAT verification: NOT IN SCOPE
- Boundary compliance: PASS
- Preservation check: PASS

## Pass 2: Quality & Craft
- Convention compliance: NOT RUN
- Code quality: NOT RUN
- Test quality: NOT RUN

## Resolved findings
- none

## Findings
### Finding 1 — Audio verification accepts a non-WAV container
**Severity:** Major
**Pass:** 1
**Evidence:** `packages/server/src/services/audio-extractor.ts:45-59` checks only the audio stream codec, sample rate, and channel count. After `npm run build`, calling the built `AudioExtractionService.convertToWav()` with the committed Recording and an exact output path ending in `.nut` resolved successfully; `ffprobe` reported `{"resolved":true,"format":"nut"}`. The unit and processing-smoke probes likewise request only stream fields, not `format_name`.
**What the contract expected:** "FFmpeg receives the exact writable audio path and produces a verified 16-kHz, mono, signed 16-bit PCM WAV before WhisperX starts"
**What I observed:** A NUT container containing a 16-kHz mono `pcm_s16le` stream passes verification and is allowed to reach WhisperX. The adapter neither forces the WAV muxer nor verifies the output container.

### Finding 2 — Failure attribution is not verified through authenticated status
**Severity:** Minor
**Pass:** 1
**Evidence:** `packages/server/tests/services/queue.test.ts:125` and `:139` call `processMeetingJob()` directly and inspect the mutable in-memory Job. `packages/server/tests/services/processingLifecycle.test.ts:28` crosses authenticated HTTP status only for the successful lifecycle; it has no extractor- or transcriber-failure case.
**What the contract expected:** "Given an accepted Job whose extractor adapter fails, when authenticated status is requested after processing rejects, then it reports `FAILED` with `failedStep: EXTRACTING_AUDIO`." It requires the equivalent authenticated assertion for `TRANSCRIBING`.
**What I observed:** The implementation-level assertions pass, but the locked HTTP-boundary failure scenarios are absent, so route serialization/redaction regressions in these outcomes would not be detected.
