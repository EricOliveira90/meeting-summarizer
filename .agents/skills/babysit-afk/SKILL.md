---
name: babysit-afk
description: Shepherd an AFK pipeline run end-to-end — preflight, launch, monitor, recover from failures, push the migration, fill the UAT guide, and run preview-UAT — stopping at a draft PR for the human to merge. Use when the user says "run AFK and babysit it", "shepherd PRD <slug> to a draft PR", "watch the AFK run", or asks to take a published PRD's slices all the way to a verified draft PR. Wraps the `afk`, `preview-uat`, and `post-merge-cleanup` skills; never merges.
---

# Babysit AFK

Take a published PRD (prd.md + issues.md + GH issues on origin/main) all the way to a
**verified draft PR**, then stop. You launch the pipeline, watch it, recover when it
breaks, push the migration, fill the UAT guide, and verify on preview. **You never merge —
only the human merges** (`.kiro/steering/shipping.md`).

This orchestrates other skills: `afk` (runs the pipeline), `preview-uat` (verifies on the
Vercel preview), `post-merge-cleanup` (after the human merges). Read the CLAUDE.md AFK rules
(preflight, posthandoff, branch-base, verdict-parser, posthandoff-from-primary) before starting.

## Quick start

```
pnpm branch:check                                                  # state branch back to user
pnpm afk:preflight --prd-dir=docs/prds/<slug>                      # validates afk.json scope + full migration range
git branch prd/<slug> <main-commit>                                # branch-base so planner reads prd.md
npx afk-claude --prd-dir docs/prds/<slug>                          # launch detached (see REFERENCE.md § Launching on Windows)
pnpm afk:status <slug>                                             # monitor (state slug may have -claude-code suffix)
```

## Workflow

- [ ] **Preflight** — `branch:check` (state it back); `git pull` so local main matches the pushed PRD;
      `afk:preflight` and resolve everything. For scoped runs, commit `afk.json` with selected AFK slices,
      the full migration-prefix range, and protected issue states. The gate verifies selected issues are OPEN
      and HITL slices remain excluded. Create `prd/<slug>` at the PRD commit so the planner reads the right base.
- [ ] **Launch** — `npx afk-claude --prd-dir docs/prds/<slug>` **detached, not as a tool-managed background
      process** (dead stdio pipes break the pre-ship gate on Windows — use the `.cmd` wrapper + `Start-Process`
      pattern, REFERENCE.md § Launching on Windows); poll the redirected out-log's
      `[afk]` lines + `.afk/logs/<slug>-claude-code/` (the state slug has a `-claude-code` suffix; `.afk/state/`
      is only written at terminal PASS/STUCK checkpoints, so track phase via logs meanwhile).
- [ ] **Verify each contract** — as each slice locks its contract, read it and check it against the PRD's
      **hard non-goals** *before* the generator runs deep. Flag scope drift early.
- [ ] **Recover** — most failures are transient (credentials, sleep), not slice bugs. Diagnose from the
      generator log tail; **re-running the same `npx afk-claude` is the recovery** (auto-skips PASS slices).
      See [REFERENCE.md](REFERENCE.md) for the failure families and the clean-before-rerun steps.
- [ ] **Reviews** — parse the `Ready to merge` / `Not ready:` output lines, **never the launcher's exit code**
      (it exits 0 either way). If a review shows **UNKNOWN**, grep the launcher err log for a spawn failure
      (`review failed: Agent ... exited with code` → infra failure, relaunch), then prove it actually ran
      (log size, >1 turn, real tool calls) before trusting/rerunning.
      A favorable review the parser couldn't read (`**Verdict: X**`
      vs `**Verdict:** X`) is still favorable → open the draft PR manually (opening ≠ merging).
- [ ] **Posthandoff** — `pnpm afk:posthandoff --prd-dir=docs/prds/<slug>` first runs the local DB-types drift
      gate, then migration db:push from the **primary checkout** (only it has `.env.preview`).
      If the primary is on another session's branch, **guide the human** through the commands rather than
      yanking it. Confirm `●` PREVIEW before and after; re-link to preview after any prod push.
- [ ] **UAT guide** — fill `docs/prds/<slug>/uat-guide.md` mapping every Success Criterion to a clickable
      check; commit it to the **feature branch**; echo the path.
- [ ] **Preview-UAT** — once the migration is live, invoke the `preview-uat` skill and run all suites through
      `pnpm afk:preview-uat --manifest=.afk/uat/<slug>/manifest.json`. Never launch preview DB suites in parallel.
      **Independently verify any extraordinary finding** before relaying it; if it surfaces a real blocker,
      fix on the feature branch, push, and **re-verify**. Commit the generated `uat-results.json` and updated guide.
- [ ] **Stop** — wait for final-head CI/Vercel, then run
      `pnpm afk:verify-draft --prd-dir=docs/prds/<slug> --pr=<number>`. Stop only on PASS; never merge.

## Hazards (read before touching worktrees)

- **NEVER create a `node_modules` junction in a worktree and then `rm -rf` that worktree** — MSYS `rm` follows
  the junction into the primary's real `node_modules` and deletes it. Use doc-only worktrees, or have the
  human run DB/Playwright probes from the primary checkout. Remove a junction with PowerShell
  `Remove-Item` / `rmdir` *before* deleting the dir, and verify the primary's node_modules is intact.
- A branch can't be checked out in two worktrees — a silent `git checkout` no-op is why a push can hit the
  wrong branch. After any branch switch, verify `git rev-parse --abbrev-ref HEAD` before pushing.

See [REFERENCE.md](REFERENCE.md) for the full runbook: failure families, verdict extraction, posthandoff-from-primary, and the preview-UAT verify loop.
