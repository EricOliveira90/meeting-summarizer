# Route Extraction into Fastify Plugins

## Parent PRD

#9

## What to build

Extract all route handlers from `index.ts` into three Fastify plugin files:

- **`routes/health.ts`** — `GET /` health check endpoint
- **`routes/upload.ts`** — `POST /upload` file upload endpoint (consolidate the existing header-based streaming implementation in `routes/upload.ts` with the current multipart approach in `index.ts` — pick one approach, preferring the header-based streaming strategy for large file support and idempotency)
- **`routes/jobs.ts`** — `GET /jobs/:id` job status endpoint (hydrates text content via `FileManagerService` instead of inline `fs` calls)

After extraction, `index.ts` reduces to pure server bootstrap: env loading, service initialization, middleware registration (CORS, multipart, auth hook), plugin registration, and `server.listen()`. The `buildServer()` function remains the test entry point.

See **Phase 1** of the [server-hardening plan](plans/server-hardening.md) for full details.

## Acceptance criteria

- [ ] `routes/health.ts` exports a Fastify plugin handling `GET /`
- [ ] `routes/upload.ts` exports a Fastify plugin handling `POST /upload` with one consolidated implementation (header-based streaming preferred)
- [ ] `routes/jobs.ts` exports a Fastify plugin handling `GET /jobs/:id`
- [ ] `GET /jobs/:id` hydrates transcript/summary text via `FileManagerService` (no inline `fs` calls)
- [ ] `index.ts` has zero route logic — only bootstrap code
- [ ] `buildServer()` still works as the test entry point
- [ ] All existing tests pass with the new route structure

## Blocked by

- Blocked by #17 — FileManagerService + Directory Bootstrapping (routes use `FileManagerService` for text hydration)

## User stories addressed

- User story 17: Route handlers extracted into Fastify plugins, `index.ts` is clean bootstrap code
