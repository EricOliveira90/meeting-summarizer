# Handoff

## What shipped
- Mandatory startup and route authentication: `packages/server/src/index.ts:buildServer` and `startServer`
- Shared authenticated Job creation aliases: `packages/server/src/routes/upload.ts:uploadRoutes`
- Strict metadata, media, speaker, and Recording validation: `packages/server/src/routes/upload.ts:createJob`
- Replaceable Job-store, queue, and artifact collaborators: `packages/server/src/domain/ports.ts` and `packages/server/src/index.ts:buildServer`
- Atomic Recording staging and cleanup: `packages/server/src/services/file-manager.ts:FileManagerService`
- Sanitized Recording artifact deletion: `packages/server/src/services/file-manager.ts:FileManagerService.deleteJobFiles`
- Redacted Job list and detail responses: `packages/server/src/routes/jobs.ts:redactResponse`
- Preserved retry and delete behavior through injected collaborators: `packages/server/src/routes/jobs.ts:jobRoutes`
- Ready Transcript download: `packages/server/src/routes/jobs.ts:jobRoutes`
- Compiled missing-key startup verification: `scripts/smoke-built-runtime.mjs:runServerWithoutApiKey`

## Decisions made during implementation
- Validate all metadata before multipart file access and artifact path resolution.
- Parse only zoned calendar ISO-8601 timestamps, validate calendar/time fields, then normalize with `Date.toISOString()`.
- Read one stream chunk before artifact staging so an empty Recording has no artifact collaborator effects.
- Stage up to 500 MiB plus one byte so the route can return the stable oversized response and delete the staged artifact.
- Remove prohibited response keys recursively and omit any string value containing the configured artifact root.
- Construct the Gemini SDK client only when Summary execution starts so API authentication remains the first startup gate.
- Apply the creation filename sanitizer when resolving filename-derived artifacts for deletion.

## Gotchas / learnings
- The current client does not send `x-recorded-at`; issue #47 owns that temporary incompatibility.
- Server `SUMMARIZING` and Summary execution remain present; issue #46 owns their removal.
- `pnpm test` reports workspace and future Vite config-loader warnings.
- Final verification: 388 tests passed; the production build and built-runtime smoke passed.

## Status
Tests passing locally. No regressions.
