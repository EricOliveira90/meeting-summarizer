# Downloaded Transcript to Codex Summary

## Parent

Part of #32.

## What to build

Continue a Transcript-ready Job on the notebook through local Codex Summary
creation. Setup verifies Codex availability and selects it as the default
Summary Provider; the workflow invokes Codex non-interactively, stores its
result atomically, and completes the Job without sending Summary credentials to
the home server.

## Acceptance criteria

- [ ] Setup can select Codex as the default Summary Provider and reports executable, authentication, and model readiness separately.
- [ ] A Transcript-ready Job invokes Codex locally with the selected Summary template.
- [ ] Transcript content is not placed in a shell argument or application log.
- [ ] Codex execution is cancellable, time-bounded, and has bounded captured output.
- [ ] Authentication, timeout, permission, model, malformed-output, and process failures produce structured retryable or terminal errors.
- [ ] A successful Summary is written atomically before the Job becomes completed.
- [ ] The completed Job records its Transcript path, Summary path, provider, template, and stage timestamps.
- [ ] The server receives no Codex credentials and performs no Summary work.
- [ ] The Jobs Hub can inspect the completed Job and read its Transcript and Summary.
- [ ] Provider contract tests exercise success, cancellation, timeout, malformed output, and redacted diagnostics.

## Blocked by

- #33
