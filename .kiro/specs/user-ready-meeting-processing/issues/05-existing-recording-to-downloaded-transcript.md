# Existing Recording to Downloaded Transcript

## Parent

Part of #32.

## What to build

Lock the first integrated production tracer bullet after its server and notebook
contracts exist: Manual Sync submits one existing Recording, observes home-server
transcription progress, and atomically receives its Transcript. This capstone
owns only integration wiring and acceptance evidence.

## Acceptance criteria

- [ ] Starting from a persisted existing Recording, Manual Sync submits its existing Job identifier, original recording time, language, and speaker hints through the authenticated server contract.
- [ ] The integrated journey observes queued, extracting, transcribing, and Transcript-ready states in order.
- [ ] The downloaded speaker-attributed Transcript is committed atomically at the expected notebook path.
- [ ] The server executes no Summary Provider, and the client Job remains ready for later Summary creation rather than completed.
- [ ] Status responses reveal no artifact paths, Transcript text, Summary text, or credentials.
- [ ] Authentication, validation, server processing, and notebook transfer failures retain their stable codes and leave no duplicate Job or partial Transcript.
- [ ] One acceptance test composes the real public client/server interfaces with replaceable FFmpeg and Whisper processes; it does not reimplement behavior owned by prerequisite slices.
- [ ] `npm ci`, `npm run build`, `npm run audit:production`, and `npm test` all pass from a clean checkout.
- [ ] Existing recording, Meeting, server Job, Jobs Hub, Summary, and Publication behavior outside this journey remains green.

## Blocked by

- #46
- #47
