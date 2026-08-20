# AFK Codex Runbook

Run every command from the `meeting-summarizer` repository root.

## Preflight

1. Commit the PRD, manifest, local issue files, glossary, ADR, and agent
   instructions to the default branch. AFK worktrees only see committed files.
2. Confirm GitHub and Codex authentication:

   ```powershell
   gh auth status
   codex --version
   ```

3. Build the local AFK pipeline revision:

   ```powershell
   pnpm --dir C:\Code\afk build
   ```

4. Confirm the consuming repository baseline:

   ```powershell
   npm ci
   npm test
   ```

The current production build defect belongs to slice 01. A failing
`npm run build` before that slice is expected and must be green after it.

## Preview

```powershell
node C:\Code\afk\dist\afk-codex.js `
  --prd-dir .kiro/specs/user-ready-meeting-processing `
  --dry-run
```

Proceed only when the preview reports 11 AFK slices, slice 01 as the sole
initial frontier, and no missing dependencies.

## Run

```powershell
node C:\Code\afk\dist\afk-codex.js `
  --prd-dir .kiro/specs/user-ready-meeting-processing `
  --command-timeout-ms 900000 `
  --heartbeat-interval-ms 30000 `
  --infrastructure-retries 2
```

Codex is the only provider for this pipeline run. AFK creates provider-specific
worktrees, branches, state, and logs.

## Monitor

- Run state: `.afk/state/user-ready-meeting-processing-codex.json`
- Logs: `.afk/logs/user-ready-meeting-processing-codex/`
- Per-slice artifacts: `.kiro/specs/user-ready-meeting-processing/slices/`
- Terminal handoff: `.afk/logs/user-ready-meeting-processing-codex/handoff.json`

## Resume

Re-run the exact Run command. AFK reuses the persisted scope, skips completed
slices, and resumes eligible failed worktrees.

If a human has determined that a preserved slice branch is invalid, restart
only that slice:

```powershell
node C:\Code\afk\dist\afk-codex.js `
  --prd-dir .kiro/specs/user-ready-meeting-processing `
  --force-restart 04
```

## Clean Failed Work

Preview cleanup before removing failed worktrees:

```powershell
node C:\Code\afk\dist\afk-codex.js clean-failed `
  --prd-dir .kiro/specs/user-ready-meeting-processing `
  --dry-run
```

Run the same command without `--dry-run` after reviewing the plan. Branches
with unmerged commits are preserved.

## Completion

The run is complete only when:

- every selected slice passes;
- the merged feature branch passes AFK's sanity gate;
- architect and product guardian verdicts allow shipment;
- AFK opens a draft PR containing `Closes #33` through `Closes #43`;
- `handoff.json` reports the draft PR and no failed or skipped AFK slice.
