# Server Job to Transcript on Canonical Paths

## Parent

Part of #32.

## What to build

Process one accepted server Job through audio extraction and WhisperX until its
Transcript is ready. The server artifact module owns every path, and the home
server performs no Summary work.

## Acceptance criteria

- [ ] The queue advances one Job through queued, extracting, transcribing, and Transcript-ready states without a Summary stage.
- [ ] Injected sentinel paths from `FileManagerService` are used unchanged by upload writing, FFmpeg input/output, WhisperX input/output, readiness verification, and Transcript retrieval; no consumer reconstructs a path.
- [ ] FFmpeg receives a deterministic writable audio path and produces 16-kHz mono PCM WAV for WhisperX.
- [ ] WhisperX receives `HUGGING_FACE_TOKEN=sentinel-hf-token` with the same value in its child environment and receives no token argument.
- [ ] The token and Transcript sentinel text are absent from child argv, stdout, stderr, and captured application logs.
- [ ] The production server entry graph neither loads nor invokes Gemini or another Summary Provider.
- [ ] A committed short Recording crosses real FFmpeg and a spawned fake Whisper executable using production artifact-path construction.
- [ ] Process, path, status, and smoke tests run through replaceable adapters and leave existing server Job behavior green.

## Blocked by

- #45
