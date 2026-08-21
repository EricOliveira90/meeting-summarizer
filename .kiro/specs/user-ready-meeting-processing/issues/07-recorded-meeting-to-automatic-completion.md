# Recorded Meeting to Automatic Completion

## Parent

Part of #32.

## What to build

Consume the schema-v2 `RECORDED` Job produced by #48 and make automatic
processing the normal foreground notebook journey. The workflow runner carries
that Job through authenticated upload, server transcription, atomic Transcript
download, local Codex Summary, and verified completion without manual Sync.
This slice owns worker lifetime, restart recovery, retry scheduling, live
operation settings, and the composite record-to-completion acceptance test.

## Acceptance criteria

- [ ] `runOnce()` advances each due Job by at most one confirmed operation, and `watch(signal)` repeatedly invokes that behavior without overlapping work for the same Job.
- [ ] Every transition through `RECORDED -> UPLOADING -> SERVER_QUEUED -> EXTRACTING -> TRANSCRIBING -> TRANSCRIPT_READY -> DOWNLOADING -> SUMMARIZING -> COMPLETED` is durably committed with ordered start/completion timestamps before the next adapter call.
- [ ] Upload first reconciles the stable Job ID, preserves `recordedAt` and snapshotted Meeting choices, and sends a recorded `.wav` as `audio/wav`; each server stage maps to its distinct canonical client stage.
- [ ] Server `COMPLETED` means only `TRANSCRIPT_READY`. Client `COMPLETED` requires successful Codex output plus readable, non-empty Transcript and Summary finals whose byte lengths and SHA-256 digests match persisted artifact evidence.
- [ ] Restart recovery validates #49 artifact evidence. A matching server Job suppresses upload, valid Transcript evidence suppresses download, and valid Summary evidence suppresses Codex; missing, changed, truncated, or digest-mismatched finals return to their owning operation and stale sibling temporary files are removed.
- [ ] Retry policies are `UPLOAD` 5s/300s/8 attempts, `RECONCILE` 10s/300s/8, `DOWNLOAD` 5s/120s/5, and `SUMMARY` 30s/600s/4, using `min(base*2^(N-2), cap)` before attempt N greater than 1 with no jitter.
- [ ] Network, timeout, 5xx, and retryable Codex failures schedule retry; authentication, other 4xx, invalid configuration/media, and non-retryable Codex failures persist terminal `FAILED`. A not-ready server poll consumes no attempt and is next due exactly five seconds later.
- [ ] Server `FAILED` maps to client `FAILED` with operation `TRANSCRIPTION`, the sanitized server message, `retryable: true`, and no automatic or local retry action; #36 owns remote retry.
- [ ] `meeting-cli start` starts `watch()` before its first menu prompt. Normal Exit aborts the active reconciliation/upload/download/Codex operation, leaves its last confirmed stage durable, stops the watcher, and exits within two seconds.
- [ ] Direct `meeting-cli record` starts the same worker before recording and remains alive after #48 enqueue until that Job is `COMPLETED`, `FAILED`, or `CANCELLED`; `meeting-cli sync` performs exactly one `runOnce()` cycle and exits.
- [ ] Settings ownership is explicit: every server operation reads current host/port/API key at operation start; first download and Summary attempts resolve the current output root then persist their final paths; Summary reads the current Codex model; the Job's Recording path, Meeting choices, provider, and templates remain snapshotted. Audio-device settings are owned by #48 and are not reread after `RECORDED`.
- [ ] A real config save/reopen round trip proves persisted server/output/Codex changes are consumed by the next applicable operation without restarting the interactive CLI.
- [ ] Transcript and Summary use sibling temporary writes, exact read-back, evidence persistence, and rename before stage advancement. Jobs Hub reads the persisted completed artifact paths rather than deriving filenames.
- [ ] Codex process settlement is bounded and single-winner: an observed nonzero close cannot be replaced by a later cancellation while output metadata is read, timeout/cancellation cannot wait forever for `close`, and process termination escalates within the two-second shutdown bound.
- [ ] Managed-credential normalization removes `codex-wrapper: error: ` only when it is the leading prefix, and tests preserve identical text appearing later in diagnostics.
- [ ] Clock/server-gated tests observe every persisted stage in order, exact retry due times and exhaustion, fixed five-second polls, server failure mapping, three-operation restart guards, corrupt artifact recovery, and live-setting consumers.
- [ ] Launched-process tests prove start-before-prompt, bounded Exit during a blocked real operation, direct-record terminal waiting, and one-cycle Sync.
- [ ] One acceptance scenario launches direct `meeting-cli record` with real LowDB/filesystem, authenticated Fastify TCP routes, a short WAV, and controlled recorder/Whisper/Codex executables; it observes every stage and reaches one verified Codex Job without invoking Sync.

## Blocked by

- #48
