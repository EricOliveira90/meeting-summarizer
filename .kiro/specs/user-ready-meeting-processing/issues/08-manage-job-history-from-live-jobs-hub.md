# Manage Job History from the Live Jobs Hub

## Parent

Part of #32.

## What to build

Make Jobs Hub the operational view of the complete workflow. It continuously
reconciles visible Jobs while open, scales to accumulated history, and routes
retry, cancellation, provider switching, Publication actions, and deletion to
the module that owns each operation.

## Acceptance criteria

- [ ] Jobs Hub paginates and filters durable Job history without loading or rendering the entire collection.
- [ ] The list refreshes while open without interrupting an active user prompt.
- [ ] Each Job shows its current operation, elapsed time, attempts, Summary Provider, last error, server reachability, and Publication outcome.
- [ ] Detail actions are available only when valid for the current durable state.
- [ ] Retry routes upload/download/Summary work locally, transcription work remotely, and Publication through its independent operation.
- [ ] Cancellation reaches both client and server owners when the active operation spans them.
- [ ] A failed Summary can explicitly switch among every available configured provider.
- [ ] Local-only, remote-only, and combined deletion are distinct confirmed actions with clear artifact consequences.
- [ ] Race conditions between refresh and an action resolve by revalidating state and reporting a conflict rather than corrupting it.
- [ ] Empty, large, active, failed, completed, cancelled, and Publication-failed views have behavior tests through the Jobs Hub seam.

## Blocked by

- #36
- #37
- #38
- #39
