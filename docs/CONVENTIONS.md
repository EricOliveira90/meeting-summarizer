# Engineering Conventions

## Modules

- Keep caller-facing interfaces small and place behavior behind the existing
  client workflow, server route, and adapter seams.
- Accept dependencies in constructors or functions so tests can replace
  processes, clocks, storage, and remote systems.
- Keep shared contracts in the shared workspace and machine-specific behavior
  in its owning workspace.
- Use the canonical domain language from `CONTEXT.md`.

## Changes

- Preserve unrelated behavior and user worktree changes.
- Prefer existing TypeScript, Fastify, LowDB, Commander, Inquirer, and Vitest
  patterns unless the locked slice contract explicitly changes them.
- Use structured parsing and validation for external data.
- Write state and artifacts atomically before advancing durable stages.
- Keep secrets and Transcript content out of logs and shell arguments.

## Tests

- Use test-driven tracer bullets: failing behavior test, minimal implementation,
  then the next behavior.
- Assert observable behavior through the highest practical interface.
- Keep unit tests for adapter-specific protocols and contract tests for HTTP.
- Run `npm test` for the full suite and `npm run build` for the production
  workspace build.

## Commits

Use conventional commit messages and reference the implementing GitHub issue.
Keep each commit scoped to one proven behavior from the locked slice contract.
