# Startup Recovery + Graceful Shutdown

## Parent PRD

#9

## What to build

Two resilience features that protect against server crashes and ensure clean shutdowns.

### Startup Recovery

On server boot, scan the database for jobs stuck in `PROCESSING` status (stalled from a previous crash). Apply a 3-strike recovery policy using a `recoveryAttempts` counter on `JobRecord`:

| `recoveryAttempts` | Action |
|---|---|
| 0 | Resume from the last completed step (determine by checking which output files exist on disk via `FileManagerService`), increment counter, re-queue |
| 1 | Re-queue from scratch (ignore existing intermediate files), increment counter |
| ≥ 2 | Mark as `FAILED` with error "Max recovery attempts exceeded" |

The `recoveryAttempts` counter resets to 0 when a job completes successfully.

### Graceful Shutdown

On `SIGINT` and `SIGTERM`:
1. Pause the queue (stop picking new jobs)
2. Let the currently processing job finish naturally (the `better-queue` callback completes)
3. Call `server.close()` and exit

No subprocess is killed — the current job runs to completion.

See **Phase 5** of the [server-hardening plan](plans/server-hardening.md) for full details.

## Acceptance criteria

- [ ] `JobRecord` has `recoveryAttempts: number` field (defaults to 0)
- [ ] On startup, stalled `PROCESSING` jobs with `recoveryAttempts === 0` are re-queued from last completed step
- [ ] On startup, stalled jobs with `recoveryAttempts === 1` are re-queued from scratch
- [ ] On startup, stalled jobs with `recoveryAttempts >= 2` are marked `FAILED` with "Max recovery attempts exceeded"
- [ ] `recoveryAttempts` resets to 0 on successful job completion
- [ ] Step detection uses `FileManagerService` to check for existing audio/transcript/summary files
- [ ] `SIGINT`/`SIGTERM` pauses the queue and waits for the current job before shutting down
- [ ] `server.close()` is called after the current job completes
- [ ] Unit tests cover 3-strike escalation logic and step detection from existing files

## Blocked by

- Blocked by #19 — Shared Types: JobStep Enum + Sub-Step Progress Tracking (step tracking needed for resume logic)
- Blocked by #23 — Job Retry API (retry/resume logic in queue processor)

## User stories addressed

- User story 14: Stalled jobs automatically resume from last completed step on server restart
- User story 15: 3-strike recovery policy — resume, retry from scratch, then mark FAILED
- User story 16: Server drains queue gracefully on SIGINT/SIGTERM
