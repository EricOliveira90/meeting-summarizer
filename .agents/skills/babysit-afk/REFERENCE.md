# Babysit AFK — Reference

Detailed runbook behind [SKILL.md](SKILL.md). Distilled from the PRD 048 and PRD 070 (draft PR #598) runs.

## Preflight details

- `pnpm branch:check` and **state the branch back to the user**. In a worktree you'll be on
  `worktree-<name>`, not `main` — that's expected. Confirm HEAD == `origin/main` (ahead/behind `0 0`).
- `pnpm afk:preflight --prd-dir=docs/prds/<slug>` must end with "Pre-flight clean". The
  **migration-prefix collision** line is the one that matters: confirm the prefix the PRD's
  migration slice will add (e.g. 057) is free vs `origin/main` AND that no other in-flight AFK
  run is about to grab it. `grep` hits inside `.afk/logs/*` filenames are false positives — check
  actual `supabase/migrations/NNN_*.sql` files.
- Commit `afk.json` for scoped runs. Preflight checks every selected AFK issue is **OPEN**, rejects selected
  HITL slices, validates every reserved migration prefix, and verifies each protected issue's expected state.
  Do not apply one blanket OPEN expectation to parent, wayfinder, or protected issues.
- **Branch base:** AFK forks worktrees from `prd/<slug>` if it exists, else main. Create it at the
  PRD commit: `git branch prd/<slug> <commit>`. Keep it current if main advances under you
  (`git branch -f prd/<slug> <new-main>`) — but only if the PRD dir itself is unchanged.

## Launching on Windows

- **Do NOT launch the pipeline as a tool-managed background process.** Those hand child processes dead
  stdio pipes: the pre-ship sanity gate fails its "tests" step in ~30s with zero diagnostics, and the
  launcher log stays 0 bytes (PRD 070 burned 6 launch attempts on this).
- Reliable pattern: a small `.cmd` wrapper (sets `AWS_CONFIG_FILE`/`AWS_PROFILE`, `cd`s to the repo,
  calls `npx afk-codex ...`), launched detached via:
  ```
  powershell Start-Process cmd.exe -ArgumentList "/c", "<wrapper.cmd> 1>C:\...\out.log 2>C:\...\err.log" -WindowStyle Hidden
  ```
- Working examples from the 070 run: `C:\Code\rumo-app\.afk\launch-070-attempt7.cmd` and
  `.afk\launch-070-attempt7.ps1`.

## Monitoring

- Launch **detached** (§ Launching on Windows); poll the redirected out-log's `[afk]` lines (filter out `Updating files:` spam).
- The state slug is `<slug>-claude-code`; logs live in `.afk/logs/<slug>-claude-code/slice-NN-<role>-rN.log`.
- `.afk/state/<slug>-claude-code.json` is written only at terminal PASS/STUCK — absence mid-run is normal.
  Track phase from the `[afk]` lines and growing log sizes / recent tool names instead.
- Per-slice flow: explorer → planner ⇄ evaluator-contract (≤3) → generator ⇄ evaluator-qa (≤3) → committed.
  A slice bouncing to "implementing (round 2/3)" is the **normal** generator↔evaluator loop, not a failure —
  read the QA log's last assistant text to see what it asked for (usually trivial typecheck/lint nits).

## Failure families (how to tell them apart)

Read the **generator log tail** (`tail -c 4000`) to classify:

| Symptom in log tail | Cause | Recovery |
|---|---|---|
| `awsCredentialExport did not return a valid value` / `Could not load credentials` | Bedrock creds lapsed mid-run (often machine sleep). Both lanes die together. NOT a code bug. | Confirm creds healthy now (`<toolbox> default-credential-export` returns JSON with future `Expiration`); clean up; re-run. |
| `Negotiation returned ERROR` at gen:0 eval:0 | explorer spawned a nested Agent (idle-watcher kill) / MCP leak | needs PascalCase agent tools + `--strict-mcp-config` — see `feedback_afk_subagent_mcp_isolation`. |
| Slice STUCK with `stuck.md` | real slice problem | read `stuck.md`; fix the contract/issue, then re-run. |

**Re-running is the recovery path** (CLAUDE.md rule 4): re-run the *same* `npx afk-claude` — it auto-skips
PASS slices via `.afk/state`. STUCK/ERROR slices retry from scratch (no WIP commit is lost; they never committed).

### Clean before a re-run (after credential/transient death)
1. `git worktree remove --force .afk/worktrees/<slice-dir>` for each dead per-slice worktree; then `git worktree prune`.
2. `git branch -D afk-claude-code/<slug>-slice-*` and `feat-claude-code/<slug>` (no WIP commits to lose — verify with `git log <base>..<branch>`).
3. `rm -rf .afk/worktrees/<leftover-dirs>` and `rm -f .afk/state/<slug>-claude-code.json` so slices re-attempt fresh.
4. Re-run preflight (it should report "fresh run"), confirm creds, relaunch.

## Reviews & the UNKNOWN verdict

Post-merge runs a pre-ship sanity gate (typecheck+lint+test on the merged branch) then architect + PM
reviews, then opens the draft PR.

- **The launcher's exit code lies.** It prints "Pipeline completed successfully" and exits 0 even on a
  "Not ready" review outcome. Parse the `Ready to merge` / `Not ready:` lines of the output (or
  `run-summary.md`) — never the exit code.
- **`afk:preflight` will flag the long-lived `*-review` worktree** (e.g. `.afk/worktrees/prd-070-review-fixes`)
  as stale and suggest `git worktree prune`. Do **NOT** prune it mid-review: it holds the uncommitted
  guardian review artifacts and is the pipeline's `reviewDir`.

If a review verdict is **UNKNOWN**:

0. **Grep the launcher's err log for `review failed: Agent ... exited with code` first.** A review agent
   can die at spawn (PRD 070: `codex-wrapper: error: failed to persist AWS config file: Access is denied`
   — a race between the two concurrently launched reviewers over the shared AWS config). That is an
   infrastructure failure, not a verdict: relaunch the same command.
1. **Prove the review ran** before trusting or rerunning (`feedback_afk_review_verdict_parser`): log size
   (hundreds of KB), turn count (`grep -c '"type":"assistant"'` > 1), and real tool calls. A blind reviewer
   with no tools hallucinates (PRD 046).
2. Extract the real verdict from the log's final assistant text (the review-*.md content). A favorable
   verdict the parser couldn't read (`**Verdict: ACCEPT-WITH-NOTES**` with the colon inside the bold, vs the
   expected `**Verdict:** …`) is still favorable.
3. If both reviews are favorable but no PR opened, **open the draft PR manually** — opening is not merging.
   `gh pr create --draft --base main --head feat-claude-code/<slug>`; body summarizes slices, `Closes #N`,
   and records both verdicts incl. the parse-failure note.

## Posthandoff from the primary checkout

`pnpm afk:posthandoff` / `db:push` act on **whatever branch the primary checkout is on**, and `.env.preview`
/`.env.local` live **only in the primary checkout** (not in worktrees) — see
`feedback_afk_posthandoff_checkout_branch`. So:

- The migration push must run from the primary on the **feature branch**. If the primary is on another
  session's branch (clean), **guide the human** through: `fetch → checkout feat → pull --ff-only → verify
  HEAD shows the right commit + the migration file exists → db:link:check:preview (●) → db:push → re-check
  preview → checkout back`. Don't yank a shared checkout unilaterally; production-safety + shared-state.
- **`db:push` error "Remote migration versions not found in local"** = you're on the WRONG branch (the local
  migrations dir doesn't match remote history). Do **NOT** run the CLI's suggested
  `migration repair --status reverted NNN` or `db pull` — they corrupt good migrations. Fix the branch.
- Migration that adds/alters a function → update `lib/infra/types/database.ts` in the same commit
  (`feedback_database_types_sync`). A pure `GRANT` migration does NOT change generated types.

## Preview-UAT verify loop

- Put every integration and Playwright command in one preview-UAT manifest and invoke
  `pnpm afk:preview-uat --manifest=.afk/uat/<slug>/manifest.json`. The runner owns the cross-process lock,
  executes suites serially, runs cleanup in `finally`, verifies cleanup, and writes commit-bound evidence.
- If parallel database suites accidentally leave PostgREST transactions aborted, stop launching probes.
  Inspect active sessions first, then terminate only the affected PostgREST sessions with an approved
  `supabase db query`; do not restart the database or project. Re-run the serial manifest from the start.
- Invoke the `preview-uat` skill once the migration is live on preview. It seeds, queries with the
  service-role key, drives the UI with Playwright (Vercel bypass), and **must clean up** all seed data.
- **Independently verify any extraordinary finding before relaying it** — e.g. "a shipped feature is also
  broken." Reproduce it yourself (a real authenticated-JWT write, not service-role which bypasses grants).
- If preview-UAT finds a real blocker, fix on the feature branch, push, have the human db:push it, then
  **re-verify** with a self-restoring probe (snapshot → write → restore → cleanup). Record PASS in the guide.
- Known `clinics` trap surfaced this way: no `GRANT UPDATE` on `clinics` → authenticated writes 42501; RLS
  policy unreachable. Mocked tests + policy-only RLS audit miss it. See `feedback_clinics_update_grant_gap`.

## Hand back

**Commit ordering when the run exits "Not ready" with uncommitted guardian artifacts:**
`scripts/afk-verify-draft.mjs` allows only `<prdDir>/uat-guide.md` and `uat-results.json` to change
after the UAT evidence's `testedSha`. So the sequence is: commit `review-*.md` + the
`docs/governance/log.md` append **first**, then re-run the preview-UAT manifest at that head, then
commit the refreshed evidence, then push once and run `afk:verify-draft`. Any other order fails
UAT ancestry.

Commit `uat-results.json` plus the rendered UAT guide, push, and wait for checks on that final HEAD. Run
`pnpm afk:verify-draft --prd-dir=docs/prds/<slug> --pr=<number>` to prove branch parity, exact issue-closing
scope, protected states, migrations, UAT ancestry, and green CI/Vercel. Summarize the PR number and
per-Success-Criterion result; leave the human the merge.
Do not run `gh pr merge`. After the human merges, the `post-merge-cleanup` skill takes over.
