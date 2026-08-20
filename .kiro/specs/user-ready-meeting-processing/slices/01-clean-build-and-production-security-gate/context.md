# Slice 01: Clean Build and Production Security Gate

## Relevant files

- `package.json:5-23` - Declares `packages/*`, root build/clean/start/test scripts, and shared development tooling; no `audit:production` script exists.
- `package-lock.json:1-21,5110-5371` - npm lockfile v3 for the root and three linked workspaces; source of the complete production dependency graph.
- `packages/shared/package.json:1-12` - Builds shared declarations and JavaScript into `dist`; has no production dependencies.
- `packages/client/package.json:1-30` - Publishes the `meeting-cli` binary from `dist/index.js`; owns client runtime dependencies and its build.
- `packages/server/package.json:1-31` - Starts `dist/index.js`; owns server runtime dependencies and its build.
- `tsconfig.base.json:1-14` - CommonJS/ES2022, strict, composite, declaration and source-map defaults.
- `tsconfig.json:1-8` - Root project references list shared, client build, then server build.
- `packages/{client,server}/tsconfig.build.json:1-16` - Emit only `src/**/*` to `dist`, exclude tests, and reference `../shared`.
- `packages/shared/tsconfig.json:1-10` - Composite shared build from `src` to `dist`.
- `vitest.config.ts:4-21` - Root test discovery/exclusions and source alias for `@meeting-summarizer/shared`.
- `packages/shared/src/index.ts:1-65` - Shared Job states/stages plus upload and HTTP response contracts consumed by both machines.
- `packages/client/src/domain/{configs,models,ports}.ts` - Client config, Meeting/Job models, and ingestion/database/API/file/Meeting ports.
- `packages/client/src/services/` and `src/commands/` - Recording ingestion, Axios upload/polling, LowDB persistence, Summary/Publication workflow, and CLI workflows.
- `packages/server/src/index.ts:14-44` and `src/routes/` - Fastify assembly, optional API-key hook, health, Recording upload, and Job endpoints.
- `packages/server/src/services/` - LowDB, queue, FFmpeg/WhisperX, Gemini Summary, artifact, and recovery implementations.
- `packages/{client,server}/tests/`, `packages/shared/src/index.test.ts` - Existing behavior coverage that guards this runtime-neutral slice.
- `plans/user-ready-system.md:18-32,107-123` - Audited baseline: production build failure and production high/critical advisories.

## Existing behavior in touched files

- Root `build` is `npm run build --workspaces --if-present` (`package.json:9`); npm enumerates client, server, shared, while both consumers require shared output.
- Shared build removes `dist` and `tsconfig.tsbuildinfo`; client removes `dist` and `tsconfig.build.tsbuildinfo`; server removes only `dist` (`packages/*/package.json` build scripts).
- Root `clean`, `nuke`, `start:server`, `start:client`, `test`, and `test:watch` commands remain public operational commands (`package.json:9-15`).
- Client runtime dependencies support the current CLI menu (`create-meeting`, `record`, `jobs`, `sync`, `audio-setup`, `settings`), recording, local Job persistence, upload/polling, result files, and Obsidian Publication (`packages/client/src/commands/menu.ts:6-31`).
- `ApiService` uses Axios plus `form-data`, sends `x-api-key` and Job option headers, keeps SSH-tunnel HTTP connections alive, and maps failures to `SyncError` (`packages/client/src/services/api.ts:15-125`).
- Server runtime dependencies support Fastify/CORS/multipart, `better-queue`, FFmpeg, LowDB, and Gemini; `buildServer()` registers all plugins, auth hook, and routes (`packages/server/src/index.ts:14-44`).
- Preserved HTTP surface: `GET /`, `POST /upload`, `GET /jobs`, `GET /jobs/:id`, `DELETE /jobs/:id`, `POST /jobs/:id/retry` (`packages/server/src/routes/*.ts`).
- Shared exports and all runtime workflows are acceptance-regression surfaces even though this slice specifies no runtime behavior changes.

## Patterns in use

- Both consuming workspaces depend on exact `@meeting-summarizer/shared: "1.0.0"` and import it by package name; production resolution uses shared `dist`, while Vitest aliases directly to shared source.
- Build scripts use `rimraf ... && tsc`; consumer build configs use TypeScript project references to shared and exclude tests.
- Root scripts are direct command verdicts (`"test": "vitest run"`); the slice requires the same direct form for `npm audit --omit=dev --audit-level=high`, with no wrapper classification.
- Tests replace process, storage, queue, provider, HTTP, and prompt boundaries with constructor arguments or `vi.mock`/`vi.fn`, matching `docs/CONVENTIONS.md:5-10,22-29`.

## Test infrastructure

- Runner: Vitest 4; full command is `npm test` -> `vitest run` (`package.json:14`, `vitest.config.ts:4-20`).
- Discovery is `packages/**/*.{test,spec}.{ts,tsx}`; `node_modules`, `dist`, Cypress, and temporary/editor directories are excluded.
- Current layout contains 24 client test files, 9 server test files, and 1 shared test file.
- Client tests mock Axios, filesystem, `audio-rec` child processes, prompts, clocks, and ports; command tests preserve menu/Create Meeting/recording/Jobs Hub/sync behavior.
- Server route tests call `buildServer()` through Fastify `app.inject`; service tests mock queue/provider/process boundaries, and file-manager tests use `fs.mkdtempSync(os.tmpdir())`.
- No dedicated build-order, clean-install, lockfile-stability, or audit-script test exists.
- Read-only baseline checks on 2026-08-20: `npm ci --dry-run --ignore-scripts` exited 0; `npm audit --omit=dev --audit-level=high` exited 1 with 15 findings (5 moderate, 9 high, 1 critical). Full install/build/tests were not run during this read-only investigation.

## Integration boundaries

- Build order boundary: shared emits `dist/index.js` and `dist/index.d.ts`; client and server resolve those through each package's `main`/`types`.
- Dependency boundary: root lockfile covers all workspace production dependencies; `--omit=dev` still evaluates both client and server transitive graphs.
- Runtime package use: client imports `axios`/`form-data`; server imports Fastify plugins, `@google/genai`, `better-queue`, `fluent-ffmpeg`, and LowDB.
- Verification boundary: root `npm run build`, `npm run audit:production`, and `npm test` are the slice-level gates; runtime acceptance remains at client workflows and authenticated server interfaces.

## Potential conflicts

- Commit `887b3be` replaced project-reference-aware `tsc --build` with workspace execution; current workspace enumeration is client, server, shared despite consumer references to shared.
- Commit `50e5b95` removed `obs-websocket-js` from `packages/client/package.json`, but `package-lock.json:5122-5123` still records it; the dry-run install still selects `obs-websocket-js@5.0.7` and `ws@8.19.0`.
- Current high/critical direct findings include Axios, Fastify, and form-data. Transitive paths include `@google/genai -> protobufjs@7.5.4/ws@8.19.0`, `fastify -> find-my-way@9.4.0/fast-uri@3.1.0`, `inquirer -> lodash@4.17.23`, and Google auth tooling -> minimatch/brace-expansion.
- Server declares both `@fastify/multipart` and deprecated `fastify-multipart` (`packages/server/package.json:13-20`; deprecation at `package-lock.json:2433-2441`); source imports only `@fastify/multipart` (`packages/server/src/index.ts:4`).
- `better-queue@3.8.12` supplies the audit's vulnerable `uuid` path; npm reports its available direct-package fix as `better-queue@3.8.4`.
- `@google/genai@1.39.0` declares Node `>=20` in the lockfile; the root manifest declares no `engines`.
- Commit `934ceb0` removed tracked TypeScript build caches; unlike client/shared build scripts, the server build does not remove `tsconfig.build.tsbuildinfo`.
- No TODO/FIXME occurs in manifests, lockfile, tsconfigs, or build scripts. No sibling slice or `handoff.md` exists in this worktree or local refs.
