---
name: handoff-to-babysit-afk
description: Write a standalone prompt that hands a finalized, ticketed PRD to a babysit-afk session with a manual-fix handoff guard.
---

# Handoff to Babysit AFK

Return one prompt for a new `$babysit-afk` session. Do not launch AFK, modify
files, or create branches.

## Workflow

1. Resolve the PRD directory from the user's request or current session. If
   more than one PRD is plausible, ask for the exact directory.
2. Read `prd.md`, `issues.md`, `afk.json`, and the selected slice files. Inspect
   the current worktree path, branch, HEAD commit, and cleanliness. Use issue
   metadata already available in the session; query the tracker only when a
   required identifier or state is missing.
3. Write a standalone prompt containing:
   - `$babysit-afk` as the first instruction;
   - the objective: shepherd the named PRD to a verified draft PR and never
     merge;
   - the exact worktree, branch, commit, PRD directory, parent issue, selected
     AFK slices, excluded HITL slices, and reserved migration prefixes when
     known;
   - instructions to read the PRD files and `babysit-afk` skill, verify the
     branch, and rerun preflight before launch;
   - permission to use normal AFK monitoring, retries, and operational
     verification;
   - instruct the agent to use AFK Kiro backend with the `afk` command;
   - a guard requiring the babysitting agent to stop when progress needs manual
     implementation, debugging edits, generated-code changes, conflict
     resolution, or another intervention outside AFK automation;
   - at that guard, require `$write-a-prompt` to produce a standalone handoff
     prompt with the failing phase, evidence, branch/worktree, and next task;
     the user will start that session;
   - a warning not to modify or clean another worktree without explicit
     permission.
4. Return only the prompt in a fenced `text` block.

## Output Rules

- Point to repository files instead of copying their contents.
- State only metadata verified from files, Git, the tracker, or current-session
  evidence.
- Always tell the next agent to rerun preflight, even when a prior run passed.
- Keep operational recovery inside `$babysit-afk`; route code changes through
  the guarded handoff.
