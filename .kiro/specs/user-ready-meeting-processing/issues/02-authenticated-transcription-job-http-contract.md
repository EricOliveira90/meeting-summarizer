# Authenticated Transcription Job HTTP Contract

## Parent

Part of #32.

## What to build

Define the authenticated home-server HTTP contract for creating and observing
transcription Jobs and downloading ready Transcripts. This slice owns route
authentication, validation, redaction, and stable errors; it uses replaceable
queue and artifact collaborators and does not implement FFmpeg, WhisperX, or
notebook workflow behavior.

## Acceptance criteria

- [ ] Direct server startup without `API_KEY` exits nonzero before listening with code `CONFIG_API_KEY_REQUIRED` and message `API_KEY is required.`
- [ ] Every route rejects a missing credential as 401/`AUTH_REQUIRED`/`API credential is required.` and a wrong credential as 401/`AUTH_INVALID`/`API credential is invalid.` without echoing either credential.
- [ ] `POST /jobs` and compatibility alias `POST /upload` use the same authentication, validation, persistence, and queue path.
- [ ] Both creation routes accept each supported extension/MIME pair (`.mkv`/`video/x-matroska`, `.mp3`/`audio/mpeg`, `.opus`/`audio/ogg`, `.m4a`/`audio/mp4`, `.wav`/`audio/wav`) with each language (`auto`, `en`, `pt`, `es`).
- [ ] Both routes accept a valid ISO-8601 recording time normalized to UTC, a size from 1 byte through 500 MiB, omitted speaker bounds, either bound alone, equal bounds, and `min < max`; bounds must be positive integers.
- [ ] Tests send a present Recording containing zero bytes to both `POST /jobs` and `POST /upload` and assert 400/`EMPTY_RECORDING`/`Recording file must not be empty.` with zero artifact, store, or queue side effects.
- [ ] Tests for both creation routes assert the exact persisted `UploadOptions` for submitted `x-language: en` and the existing `x-template: meeting` across every speaker-bound shape: omitted `{ language: "en", template: "meeting" }`, min-only `{ language: "en", template: "meeting", minSpeakers: 2 }`, max-only `{ language: "en", template: "meeting", maxSpeakers: 5 }`, equal `{ language: "en", template: "meeting", minSpeakers: 3, maxSpeakers: 3 }`, and ordered `{ language: "en", template: "meeting", minSpeakers: 2, maxSpeakers: 5 }`.
- [ ] Table-driven tests reject missing or malformed recording time, unknown language, invalid speaker values or ranges, missing file, unsupported or mismatched extension/MIME, and uploads over 500 MiB, with zero persisted or queued Jobs.
- [ ] HTTP failures return exactly `{ code, error }` using the status, code, and exact message table below.
- [ ] `GET /jobs/:id` exposes queued, extracting, transcribing, and Transcript-ready states through a replaceable Job store.
- [ ] Status and list responses recursively omit Transcript/Summary text and `uploadPath`, `audioPath`, `transcriptPath`, and `summaryPath`, including sentinel text and the configured artifact root.
- [ ] `GET /jobs/:id/transcript` returns 404/`JOB_NOT_FOUND`/`Job was not found.`, 409/`TRANSCRIPT_NOT_READY`/`Transcript is not ready.`, or a ready `text/plain` Transcript.

## Stable errors

| Condition | Status/code | Exact message |
|---|---|---|
| Missing API key at startup | nonzero / `CONFIG_API_KEY_REQUIRED` | `API_KEY is required.` |
| Missing credential | 401 / `AUTH_REQUIRED` | `API credential is required.` |
| Wrong credential | 401 / `AUTH_INVALID` | `API credential is invalid.` |
| Invalid recording time | 400 / `INVALID_RECORDED_AT` | `x-recorded-at must be a valid ISO-8601 timestamp.` |
| Invalid language | 400 / `INVALID_LANGUAGE` | `x-language must be one of: auto, en, pt, es.` |
| Invalid speaker value | 400 / `INVALID_SPEAKER_BOUND` | `Speaker bounds must be positive integers.` |
| Invalid speaker range | 400 / `INVALID_SPEAKER_RANGE` | `x-min-speakers must not exceed x-max-speakers.` |
| Missing file | 400 / `FILE_REQUIRED` | `A Recording file is required.` |
| Empty Recording | 400 / `EMPTY_RECORDING` | `Recording file must not be empty.` |
| Unsupported or mismatched media | 415 / `UNSUPPORTED_MEDIA_TYPE` | `Recording extension and MIME type are not a supported pair.` |
| Oversized upload | 413 / `UPLOAD_TOO_LARGE` | `Recording exceeds the 500 MiB limit.` |
| Unknown Job | 404 / `JOB_NOT_FOUND` | `Job was not found.` |
| Transcript unavailable | 409 / `TRANSCRIPT_NOT_READY` | `Transcript is not ready.` |

## Blocked by

- #44
