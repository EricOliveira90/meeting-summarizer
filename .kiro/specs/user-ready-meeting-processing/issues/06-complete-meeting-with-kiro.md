# Complete a Meeting with Kiro

## Parent

Part of #32.

## What to build

Allow Kiro to be selected as the notebook's default Summary Provider or as a
Meeting override, then complete that Meeting through the existing automatic
workflow. Kiro must satisfy the same availability, privacy, cancellation, and
failure contracts as the other providers.

## Acceptance criteria

- [ ] Setup reports Kiro executable, authentication, and model readiness separately and can save it as the default provider.
- [ ] Meeting creation can override the configured default with Kiro.
- [ ] A Kiro-selected Meeting retains that provider choice through Recording and Job creation.
- [ ] The workflow invokes Kiro locally from the downloaded Transcript without server Summary work.
- [ ] Kiro execution is non-interactive, cancellable, time-bounded, and produces structured failures.
- [ ] Transcript input and credentials are absent from shell arguments and logs.
- [ ] Successful output is committed atomically and records Kiro as the completing provider.
- [ ] Kiro contract tests cover availability, success, authentication failure, timeout, cancellation, malformed output, and redaction.
- [ ] A default-provider test and a per-Meeting override test both complete a Kiro Summary.
- [ ] Existing Codex and Claude workflows remain unchanged.

## Blocked by

- #35
