# Handoff

## What shipped
- Lockfile-stable clean install: `packages/shared/src/release-baseline.test.ts` and `package-lock.json`
- Deterministic shared-first build: `package.json:scripts.build` and `packages/server/package.json:scripts.build`
- Direct production audit gate: `package.json:scripts.audit:production`
- High-severity production dependency remediation: `packages/client/package.json`, `packages/server/package.json`, and `package-lock.json`
- Unmocked compiled runtime verification: `scripts/smoke-built-runtime.mjs:smokeClient` and `scripts/smoke-built-runtime.mjs:smokeServer`
- Deterministic MeetingService test database isolation: `packages/client/tests/services/meeting.test.ts`

## Decisions made during implementation
- Run the three workspace builds serially in shared, client, server order.
- Remove the server TypeScript build-info cache whenever its output directory is removed.
- Give only the smoke process a placeholder Gemini key so the real SDK can load without external calls.
- Pass a configured server API key through the injected smoke request when present.
- Give every MeetingService test its own OS temporary directory and await LowDB initialization before cleanup.

## Gotchas / learnings
- The production audit reports two moderate findings through `better-queue -> uuid`; both specified high-severity audit commands exit zero.
- `pnpm test` reports that npm workspaces are not declared in `pnpm-workspace.yaml` and warns about future Vite native config loading; 237 tests pass.
- LowDB's `steno` writer uses a sibling `.tmp` file, so fixed test database paths can collide across concurrent suite workers.

## Status
Tests passing locally. No regressions.
