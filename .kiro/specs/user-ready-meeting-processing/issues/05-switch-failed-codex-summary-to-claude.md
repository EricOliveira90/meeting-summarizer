# Switch Failed Codex Summary to Claude

## Parent

Part of #32.

## What to build

After a Codex Summary failure, let the user explicitly switch that Job to
Claude and complete it from the existing Transcript. Claude participates in the
same local Summary Provider contract and never triggers as an automatic
fallback.

## Acceptance criteria

- [ ] Setup and Jobs Hub report Claude executable, authentication, and model readiness separately.
- [ ] Claude implements the same local Summary Provider behavior and failure classification as Codex.
- [ ] A failed Codex Job offers an explicit switch-provider action.
- [ ] No provider switch occurs without user confirmation.
- [ ] Switching to Claude preserves the Recording, remote Job, Transcript, templates, and prior failure history.
- [ ] The workflow invokes Claude from the existing Transcript without uploading or transcribing again.
- [ ] Successful Claude output is stored atomically and records Claude as the provider that completed the Summary.
- [ ] Claude transcript input and credentials are absent from shell arguments and logs.
- [ ] Contract tests cover Claude success, availability, authentication failure, timeout, cancellation, malformed output, and redaction.
- [ ] An end-to-end test forces Codex failure, switches to Claude, and completes the same Job.

## Blocked by

- #35
