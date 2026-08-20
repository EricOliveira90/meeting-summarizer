# Architecture

## System Shape

- **Notebook client**: records Meetings, owns durable Jobs, runs the workflow,
  invokes Summary Providers, publishes to Obsidian, and presents Jobs Hub.
- **Home transcription server**: accepts authenticated Recordings, extracts
  audio, runs WhisperX, persists progress, and serves Transcripts.
- **Google bridge**: an SSH jump host connecting outbound tunnels from both
  machines; it runs no meeting-processing workload.

The client workflow runner is the highest end-to-end interface. Server HTTP,
recorder, Summary Provider, storage, clock, and Publication implementations are
adapters exercised through that interface where possible.

## Decisions

- `docs/adr/0001-split-transcription-and-summarization.md` owns machine and
  completion responsibilities.
- `.kiro/specs/user-ready-meeting-processing/prd.md` owns the lifecycle,
  contracts, recovery, security, retention, and testing decisions for the
  current change.
- `plans/user-ready-system.md` records the audited baseline and release risks.

## Verification

Behavior is verified at the workflow runner and authenticated server interfaces.
Real-process smoke coverage must cross FFmpeg and the Whisper process seam;
mock-only green tests do not prove the executable processing path.
