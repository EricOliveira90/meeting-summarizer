# Recorded Meeting to Automatic Completion

## Parent

Part of #32.

## What to build

Turn the manual tracer bullets into the normal user journey. Recording a
Meeting on the notebook must persist its relationship, await the recorder's
completed event, create a durable Job, and let a background workflow runner
carry it through upload, transcription, Transcript download, Codex Summary, and
completion without manual Sync.

## Acceptance criteria

- [ ] Starting a Recording persists the selected Meeting relationship and processing choices before asynchronous work begins.
- [ ] The recording command awaits a completed or error event instead of sleeping for a fixed delay.
- [ ] Only a completed Recording creates a Job; recorder failure remains visible and does not enqueue incomplete media.
- [ ] Existing client data is backed up and migrated through an explicit schema version before the durable Job shape is written.
- [ ] The workflow runner automatically advances Jobs through every confirmed lifecycle stage.
- [ ] The worker starts at notebook login or through a documented foreground command suitable for verification.
- [ ] Restarting the notebook during any client-owned operation resumes from the last durable stage without duplicate upload or Summary work.
- [ ] Operation-specific exponential backoff distinguishes transient tunnel/server failures from terminal configuration failures.
- [ ] A manual one-cycle command remains available for diagnosis and recovery.
- [ ] Changing settings takes effect for subsequent operations without restarting the interactive CLI.
- [ ] One acceptance scenario records a short Meeting and reaches a completed Codex Job without invoking manual Sync.

## Blocked by

- #34
