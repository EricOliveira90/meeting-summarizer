# Diagnose and Certify the Installed System

## Parent

Part of #32.

## What to build

Provide one doctor command and repeatable release run that prove the installed
two-machine system is usable. Diagnostics cover every local tool, provider,
tunnel, server dependency, storage condition, and authentication requirement;
the release run exercises the agreed failure and recovery scenarios and
produces actionable evidence.

## Acceptance criteria

- [ ] Doctor checks notebook recording tools, configured Summary Providers, writable local storage, tunnel status, authenticated server reachability, and worker status.
- [ ] Server readiness checks database, artifact directories, free disk, FFmpeg, Python, WhisperX, GPU visibility, and queue acceptance.
- [ ] Every failed check identifies the machine, dependency, observed failure, and remediation action without exposing secrets.
- [ ] The release run starts from both machines rebooted and completes a short microphone/system-audio Meeting.
- [ ] The run verifies notebook disconnect during transfer, server restart during transcription, client restart before Summary, and recovery without duplicate expensive work.
- [ ] The run verifies Codex, Claude, and Kiro when installed, recording unavailable providers as explicit skipped prerequisites rather than false passes.
- [ ] The run verifies failed Summary provider switching, failed Publication retry, cancellation, and retention timing.
- [ ] Logs are checked for credentials, Transcript content, unbounded growth, and unexplained process failures.
- [ ] Upgrade, backup, rollback, and secret-rotation procedures are executable and identify human-only steps.
- [ ] A clean build, full automated suite, doctor output, and two-machine run form the release evidence consumed by guardian reviews.

## Blocked by

- #36
- #37
- #38
- #39
- #40
- #41
- #42
