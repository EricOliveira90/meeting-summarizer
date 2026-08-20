# Slice Contract — Clean Build and Production Security Gate

**Parent PRD:** .kiro/specs/user-ready-meeting-processing/prd.md
**GH issue:** #44
**Status:** LOCKED
**Negotiation round:** 2

## Scope lock
Deliver the runtime-neutral release baseline: from a clean checkout, the locked workspace installs reproducibly, builds shared before both consumers, passes the complete production dependency audit at high severity, and keeps the existing client and server runtime surfaces loadable without changing meeting-processing behavior (issue #44; PRD Implementation and Testing Decisions).

### In scope
- Given a clean checkout, when `npm ci` runs, then it exits zero and leaves `package-lock.json` byte-for-byte unchanged (issue #44 AC 1).
- Given a successful clean install with no prior build output, when `npm run build` runs, then shared completes before client and server compile, and the root command exits zero (issue #44 AC 2; roadmap 0.1).
- Given the root manifest, when `npm run audit:production` runs, then it executes exactly `npm audit --omit=dev --audit-level=high` and returns that command's exit code as the sole verdict for all workspace production dependencies (issue #44 AC 3-4).
- Given the locked production graph, when the direct audit command runs, then it exits zero after vulnerable production dependencies are upgraded or removed; no allowlist or path-impact classification may override a failure (issue #44 AC 4-5; PRD Further Notes).
- Given the repaired baseline, when `npm test` and the unmocked built-runtime smoke run, then the existing suite passes, the compiled client exposes its current CLI commands, and the compiled server returns its current health response (issue #44 AC 6; PRD Testing Decisions; Architecture Verification).

### Non-goals (explicit out-of-scope)
- Changing recording, Job lifecycle, upload, transcription, Summary, Publication, Jobs Hub, or server HTTP behavior (issue #44: "changes no runtime workflow behavior").
- Repairing artifact paths, process cancellation/recovery, mandatory authentication, or adding the real Whisper smoke path (roadmap 0.2-0.8; separate PRD slices).
- Splitting server transcription from notebook Summary creation or changing shared Job contracts (ADR-0001; roadmap section 1).
- Making dev-only or below-high advisories a separate release verdict; the specified production audit command owns this slice's threshold (issue #44 AC 3).

### Existing behavior to preserve
- Root `clean`, `nuke`, `start:server`, `start:client`, `test`, and `test:watch` commands - `package.json:scripts`.
- Shared package exports and emitted `dist` entrypoints consumed by both workspaces - `packages/shared/package.json:main/types/scripts.build`.
- Client `meeting-cli`, start/dev/test commands, recording, upload/polling, Job persistence, Summary retrieval, and Publication - `packages/client/package.json:bin/scripts/dependencies`.
- Server start/dev/whisperx/test commands, Fastify upload/Job routes, queue, transcription, Summary, artifacts, and recovery - `packages/server/package.json:scripts/dependencies`.
- Current shared Job states, stages, upload options, and HTTP response types - `packages/shared/src/index.ts`.

### Changes to existing behavior (only if the issue asks for it)
- Root build ordering becomes deterministic: "The root build compiles shared before client and server, and exits zero."
- Clean install becomes lockfile-stable: "A clean checkout completes `npm ci` without modifying the lockfile."
- Add the direct production audit gate: "The root `audit:production` script runs `npm audit --omit=dev --audit-level=high`."

## Files expected to change
- package.json
- package-lock.json
- packages/client/package.json
- packages/server/package.json
- scripts/smoke-built-runtime.mjs (new file)

## New patterns / deps / schema (if any)
- Add one root command for an unmocked smoke of compiled client and server entrypoints; no new dependency or schema (PRD Testing Decisions).

## Test plan
- Given a fresh checkout and the initial lockfile hash, when `npm ci` completes, then its exit code is zero, the hash is unchanged, and `git diff --exit-code -- package-lock.json` passes.
- Given that clean install and absent workspace `dist`/build-info output, when `npm run build` runs, then command output records shared completion before client and server and the exit code is zero.
- Given the root manifest, when its `audit:production` value is inspected and `npm run audit:production` is run, then the value is exactly `npm audit --omit=dev --audit-level=high` and the command exits zero.
- Given the same installed lockfile, when `npm audit --omit=dev --audit-level=high` runs directly, then it exits zero for the complete workspace production graph with no allowlist or alternate verdict step.
- Given the dependency and build changes, when `npm test` runs, then all shared, client, and server tests pass with the existing CLI and HTTP expectations unchanged.
- Given a successful clean build, when `npm run smoke:built` runs without module mocks, then `packages/client/dist/index.js --help` exits zero and lists `start`, `record`, `sync`, `settings`, and `audio`, while `buildServer()` from `packages/server/dist/index.js` becomes ready and an injected `GET /` returns status 200 with `{ "status": "online", "service": "Meeting Summarizer Server" }`.

## Definition of done
- [ ] Clean `npm ci` exits zero without changing `package-lock.json`
- [ ] Clean root build compiles shared before client and server and exits zero
- [ ] The exact production audit script and its direct command both exit zero without bypass logic
- [ ] Existing suite and unmocked built client/server smoke pass
- [ ] Existing meeting-processing contracts and runtime workflows are unchanged
- [ ] All tests pass locally
- [ ] No regression in existing suite
- [ ] Evaluator has signed off via qa-report.md
