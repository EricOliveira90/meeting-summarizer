# QA Report

**Verdict:** FAIL
**Failure class:** IMPLEMENTATION

## Pass 1: Functional Correctness
- Sanity commands: PASS
- UAT verification: NOT IN SCOPE
- Boundary compliance: PASS
- Preservation check: FAIL

## Pass 2: Quality & Craft
- Convention compliance: NOT RUN
- Code quality: NOT RUN
- Test quality: NOT RUN

## Resolved findings
- none

## Findings
### Finding 1 — Sanitized Recording artifacts survive Job deletion
**Severity:** Major
**Pass:** 1
**Evidence:** `pnpm run test` passed 37 files and 387 tests. A deterministic repro against `FileManagerService` then created the upload artifact returned by `getUploadPath("job-123", "team_retro_.wav")`, called `deleteJobFiles("job-123", "team retro?.wav")`, and printed `"remainsAfterDelete":true`. Creation sanitizes the artifact filename at `packages/server/src/routes/upload.ts:173-174`, while deletion passes the retained original filename at `packages/server/src/routes/jobs.ts:141-144` and reconstructs an unsanitized path at `packages/server/src/services/file-manager.ts:94-104`.
**What the contract expected:** "delete active-process cancellation/file/record removal" and "`team retro?.wav` remains the original name while its artifact name is `team_retro_.wav`".
**What I observed:** Deleting a Job removes its record but silently targets `job-123_team retro?.wav`; the actual `job-123_team_retro_.wav` Recording remains on disk.
