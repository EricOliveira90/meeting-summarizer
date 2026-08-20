# Publish a Completed Job to Obsidian

## Parent

Part of #32.

## What to build

Keep Obsidian Publication in the automatic pipeline while preserving the domain
rule that Transcript and Summary complete the Job. After completion, the worker
publishes the note, records a separate Publication outcome, and retries or
regenerates Publication without repeating transcription or Summary creation.

## Acceptance criteria

- [ ] Summary completion automatically creates a pending Publication operation.
- [ ] Publication records pending, publishing, published, or failed independently from the Job lifecycle.
- [ ] A successful Publication renders the selected template from the persisted Transcript and Summary and writes atomically to the configured vault.
- [ ] A Publication failure leaves the Job completed and exposes its own error and attempt count.
- [ ] Transient Publication failure retries according to the client retry policy without rerunning upstream operations.
- [ ] Jobs Hub can manually retry failed Publication.
- [ ] Jobs Hub can regenerate Publication with another note template without invoking a Summary Provider.
- [ ] Missing vault, permission failure, invalid template, and atomic-write failure are actionable and do not corrupt an existing note.
- [ ] Settings changes affect subsequent Publication attempts without restarting the CLI.
- [ ] Tests prove automatic Publication, independent failure, retry, regeneration, and unchanged Job completion.

## Blocked by

- #35
