# Existing Recording to Downloaded Transcript

## Parent

Part of #32.

## What to build

Make the first production tracer bullet work from the notebook CLI through the
home server: submit one existing Recording, process it through authenticated
audio extraction and WhisperX transcription, and atomically download its
Transcript. This slice establishes the transcription-only server contract and
repairs only the build, artifact, process, and security defects that block this
journey.

## Acceptance criteria

- [ ] A clean checkout installs and builds all workspace packages in dependency order.
- [ ] Server startup fails clearly when its authentication secret is missing.
- [ ] The notebook can submit a supported existing Recording with a stable Job identifier, original recording time, language, and speaker hints.
- [ ] The authenticated server accepts the Recording and reports queued, extracting, transcribing, and Transcript-ready progress.
- [ ] Audio extraction and WhisperX receive deterministic, writable artifact paths owned by the server artifact module.
- [ ] The server does not execute Gemini or any other Summary Provider.
- [ ] The notebook downloads the Transcript through a dedicated authenticated operation and commits it atomically.
- [ ] A missing or invalid credential, unsupported Recording, malformed option, and oversized upload return actionable errors.
- [ ] A short fixture proves the executable FFmpeg-to-Whisper process seam without mocking away path construction.
- [ ] Existing recording, Meeting, and server Job behaviors outside this journey remain green.
- [ ] Production dependency vulnerabilities directly affecting this exposed path are upgraded or explicitly removed.

## Blocked by

None - can start immediately.
