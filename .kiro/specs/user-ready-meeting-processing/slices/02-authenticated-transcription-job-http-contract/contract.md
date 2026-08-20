# Slice Contract — Authenticated Transcription Job HTTP Contract

**Parent PRD:** .kiro/specs/user-ready-meeting-processing/prd.md
**GH issue:** #45
**Status:** LOCKED
**Negotiation round:** 3

## Scope lock
Excluding machine processing and notebook changes, deliver the authenticated home-server HTTP boundary that validates and queues Recordings through one creation path, exposes redacted Job progress, and downloads a ready Transcript through replaceable store, queue, and artifact collaborators (issue #45; PRD stories 8, 10, 12-14, 18; ADR-0001).

### In scope
- Direct startup without `API_KEY` exits nonzero before listening with `CONFIG_API_KEY_REQUIRED` / `API_KEY is required.`; every route distinguishes exact missing-key and wrong-key 401 `{code,error}` responses without disclosing either key (issue #45 AC 1-2; PRD mandatory-auth decision).
- Authenticated `POST /jobs` and alias `POST /upload` share validation, persistence, queueing, cleanup, and existing success behavior (issue #45 AC 3; "`/upload` compatibility means route alias only").
- Both routes accept Job IDs matching `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`; real zoned ISO timestamps normalized to UTC; `auto|en|pt|es`; omitted or `meeting|training|summary` templates; positive-integer omitted, one-sided, equal, or ordered speaker bounds; and 1-524,288,000-byte Recordings (issue #45 AC 4-8).
- Both routes accept every cross-product of `.mkv/video/x-matroska`, `.mp3/audio/mpeg`, `.opus/audio/ogg`, `.m4a/audio/mp4`, `.wav/audio/wav` and the four languages; omitted language/template persist exactly `auto`/`meeting` (issue #45 AC 5-6; context.md existing defaults).
- `2026-04-01T10:30:00Z` and `2026-04-01T07:30:00-03:00` persist as `2026-04-01T10:30:00.000Z`; zone-less, date-only, week/ordinal-date, leap-second, impossible-date, and malformed inputs fail as specified below (issue #45 AC 7 and stable errors).
- With language `en` and template `meeting`, each route persists exact sparse options for omitted bounds, min `2`, max `5`, equal `3/3`, and ordered `2/5`; `team retro?.wav` remains the original name while its artifact name is `team_retro_.wav` (issue #45 AC 9-10).
- Validation returns only the exact stable `{code,error}` below; metadata/file/media rejection has no collaborator effect, while an oversized staged artifact is deleted and never committed, persisted, or queued (issue #45 AC 4, 6, 8, 11-12; Conventions atomic-write rule).
- List/detail preserve `PENDING/QUEUED`, `PROCESSING/EXTRACTING_AUDIO`, `PROCESSING/TRANSCRIBING`, temporary `PROCESSING/SUMMARIZING`, `COMPLETED/DONE`, and `FAILED` optional metadata; they recursively omit Transcript/Summary text, `filePath`, `uploadPath`, `audioPath`, `transcriptPath`, `summaryPath`, `recoveryAttempts`, and artifact-root values (issue #45 AC 13-16; context.md redaction).
- Authenticated Transcript download returns exact 404 `JOB_NOT_FOUND`, 409 `TRANSCRIPT_NOT_READY` for non-ready/null/rejected reads, or exact 200 `text/plain` content for a `COMPLETED/DONE` Job (issue #45 AC 17; stable errors).

### Non-goals (explicit out-of-scope)
- Client upload adapters, `SyncManager`, or sending `x-recorded-at`; #47 owns client compatibility (issue #45 What to build).
- FFmpeg, WhisperX, processing paths/lifecycle, server Summary removal, or a `TRANSCRIPT_READY` `JobStep`; #46 owns them (issue #45 AC 14; ADR-0001).
- New duplicate-idempotency semantics, recovery/cancellation redesign, Jobs Hub, readiness, retention, bridge/startup, public exposure, or multi-user/notebook behavior (PRD stories 9, 15-17, 34-50; PRD Out of Scope).

### Existing behavior to preserve
- Authenticated health payload, CORS `*`, multipart support, and 500 MiB limit — `packages/server/src/index.ts:buildServer`, `packages/server/src/routes/health.ts:healthRoutes`.
- Insertion-order status filtering and `{jobs,total,page,limit}` pagination with `1/20` defaults — `packages/server/src/routes/jobs.ts:jobRoutes`.
- Retry completed-step preservation/requeue and delete active-process cancellation/file/record removal — `packages/server/src/routes/jobs.ts:jobRoutes`.
- Omitted language `auto`, duplicate-ID replacement/requeue, `{success:true,jobId,message:"File queued."}`, and temporary `SUMMARIZING` — `packages/server/src/routes/upload.ts:uploadRoutes`, `packages/server/src/services/queue.ts:processMeetingJob`.
- Shared Job/language/template/upload contracts except issue-authorized coded errors — `packages/shared/src/index.ts`.

### Changes to existing behavior (only if the issue asks for it)
- Mandatory auth, strict creation validation, recursive redaction, and stable coded errors: "This slice owns route authentication, validation, redaction, and stable errors" (issue #45 What to build).
- Canonical `POST /jobs` with `/upload` as the same route behavior: "`/upload` compatibility means route alias only" (issue #45 What to build).

## Files expected to change
- packages/shared/src/index.ts
- packages/server/src/index.ts
- packages/server/src/routes/upload.ts
- packages/server/src/routes/jobs.ts
- packages/server/src/types/fastify.d.ts
- packages/server/tests/app.test.ts
- packages/server/tests/startup.test.ts (new file)
- packages/server/tests/routes/transcriptionJobContract.test.ts (new file)
- packages/server/tests/routes/jobListing.test.ts
- packages/server/tests/routes/jobDeletion.test.ts
- packages/server/tests/routes/jobRetry.test.ts
- packages/server/tests/routes/routes.test.ts
- scripts/smoke-built-runtime.mjs

## New patterns / deps / schema (if any)
- Server construction/route registration accepts replaceable Job-store, queue, and artifact collaborators; no runtime dependency, migration, or `JobStep` value (issue #45; Conventions Modules).

## Test plan
- Given direct startup without `API_KEY`, when the built server starts, then it exits nonzero before listening and emits exactly `CONFIG_API_KEY_REQUIRED` / `API_KEY is required.`
- Given each registered route and sentinel keys, when credentials are absent, wrong, or correct, then responses are respectively 401 `{"code":"AUTH_REQUIRED","error":"API credential is required."}`, 401 `{"code":"AUTH_INVALID","error":"API credential is invalid."}`, or route behavior, and neither sentinel occurs in response, logs, stdout, or stderr.
- Given either creation URL, valid one/128-character IDs, all media/language combinations, all templates/defaults, speaker shapes, timestamp examples, and 1/524,288,000-byte boundaries, when uploaded, then exact normalized names/options/response persist before one queue push and one committed artifact.
- Given either creation URL, run every row below; `none` means zero artifact path/stage/delete calls, store writes, and queue pushes:

| Input | Exact response | Collaborator effects |
|---|---|---|
| missing `x-job-id`; `_job`; `job.1`; `../job`; 129 `a`s | 400 `{"code":"INVALID_JOB_ID","error":"x-job-id must contain 1-128 letters, digits, hyphens, or underscores and start with a letter or digit."}` | none |
| missing `x-recorded-at`; `2026-04-01T10:30:00`; `2026-04-01`; `2026-W14-3T10:30:00Z`; `2026-091T10:30:00Z`; `2026-04-01T10:30:60Z`; `2026-02-30T10:30:00Z`; `not-a-date` | 400 `{"code":"INVALID_RECORDED_AT","error":"x-recorded-at must be a valid ISO-8601 timestamp."}` | none |
| `x-language: fr` | 400 `{"code":"INVALID_LANGUAGE","error":"x-language must be one of: auto, en, pt, es."}` | none |
| `x-template: minutes` | 400 `{"code":"INVALID_TEMPLATE","error":"x-template must be one of: meeting, training, summary."}` | none |
| either speaker header set to `0`, `-1`, `1.5`, or `2x` | 400 `{"code":"INVALID_SPEAKER_BOUND","error":"Speaker bounds must be positive integers."}` | none |
| min `3`, max `2` | 400 `{"code":"INVALID_SPEAKER_RANGE","error":"x-min-speakers must not exceed x-max-speakers."}` | none |
| no multipart file | 400 `{"code":"FILE_REQUIRED","error":"A Recording file is required."}` | none |
| present zero-byte `.wav` / `audio/wav` | 400 `{"code":"EMPTY_RECORDING","error":"Recording file must not be empty."}` | none |
| `recording.flac` / `audio/flac`; `recording.wav` / `audio/mpeg` | 415 `{"code":"UNSUPPORTED_MEDIA_TYPE","error":"Recording extension and MIME type are not a supported pair."}` | none |
| 524,288,001-byte `.wav` / `audio/wav` | 413 `{"code":"UPLOAD_TOO_LARGE","error":"Recording exceeds the 500 MiB limit."}` | zero commit/store/queue; any staged artifact is deleted |

- Given a prior Job ID, when each route uploads changed valid metadata/media with that ID, then exactly one record remains replaced, the existing success payload returns, and the replacement is persisted and queued once per request.
- Given authenticated `GET /` with an `Origin`, when requested, then body is exactly `{status:"online",service:"Meeting Summarizer Server"}` and `access-control-allow-origin` is `*`; successful multipart creation proves registration and the size cases prove the configured limit.
- Given stored Jobs, when authenticated list/detail requests cover filtering, pagination, all state pairs, optional failure/step metadata, and nested secret/text/path sentinels, then the envelope/order/defaults and allowed metadata remain while every prohibited key/value is absent.
- Given absent, pending, completed-with-text, completed-with-null, and completed-with-rejected-read Jobs, when Transcript is fetched, then outcomes are 404 `{"code":"JOB_NOT_FOUND","error":"Job was not found."}`, 409 `{"code":"TRANSCRIPT_NOT_READY","error":"Transcript is not ready."}`, exact 200 `text/plain`, 409 `TRANSCRIPT_NOT_READY`, and 409 `TRANSCRIPT_NOT_READY`.
- Given a FAILED Job with completed and incomplete steps, when retry is called, then completed timestamps remain, incomplete timestamps/error/failedStep clear, status becomes `PENDING`, persistence occurs, and `{jobId,filePath}` is pushed once.
- Given a PROCESSING Job and active process, when delete is called, then `kill()` occurs, the active reference clears, `deleteJobFiles(id,originalFilename)` occurs, the record is removed/persisted, and the existing success payload returns.
- Given all changes, when `npm test`, `npm run build`, and `npm run smoke:built` run, then all commands exit zero.

## Definition of done
- [ ] Both authenticated creation routes satisfy the complete success, rejection, cleanup, duplicate, and preservation matrices
- [ ] Status/list redaction and Transcript download satisfy exact wire contracts
- [ ] Direct startup and every route enforce mandatory authentication without credential disclosure
- [ ] Existing health/CORS, pagination, retry, delete, success/default, and state-pair behavior remains covered
- [ ] All tests pass locally
- [ ] No regression in existing suite
- [ ] Evaluator has signed off via qa-report.md
