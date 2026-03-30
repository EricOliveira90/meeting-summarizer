# Job Listing API (GET /jobs with Pagination + Filtering)

## Parent PRD

#9

## What to build

A new `GET /jobs` endpoint in the jobs route plugin that returns a paginated, filterable list of all jobs. Each job in the response is hydrated with text content (transcript/summary) just like `GET /jobs/:id`.

**Endpoint:** `GET /jobs`

**Query parameters:**
- `page` — page number (default: 1)
- `limit` — items per page (default: 20)
- `status` — optional `JobState` filter (e.g., `COMPLETED`, `FAILED`, `PENDING`, `PROCESSING`)

**Response shape:**
```json
{
  "jobs": [JobResponse, ...],
  "total": 42,
  "page": 1,
  "limit": 20
}
```

Each `JobResponse` includes `currentStep`, `failedStep`, `steps` timestamps, and hydrated `transcriptText`/`summaryText` fields.

See **Phase 4** of the [server-hardening plan](plans/server-hardening.md) for full details.

## Acceptance criteria

- [ ] `GET /jobs` returns paginated results with correct `total`, `page`, `limit`
- [ ] `GET /jobs?status=FAILED` returns only failed jobs
- [ ] `GET /jobs?status=COMPLETED` returns only completed jobs
- [ ] `GET /jobs?page=2&limit=5` returns correct page offset
- [ ] Each job in the response is hydrated with text content via `FileManagerService`
- [ ] Each job includes `currentStep`, `failedStep`, and `steps` fields
- [ ] Default pagination is `page=1, limit=20`
- [ ] Integration tests cover pagination, filtering, and empty results using Fastify `inject()`

## Blocked by

- Blocked by #18 — Route Extraction into Fastify Plugins (jobs route plugin must exist)
- Blocked by #19 — Shared Types: JobStep Enum + Sub-Step Progress Tracking (step fields on `JobResponse`)

## User stories addressed

- User story 4: Client can fetch a paginated list of all jobs for a job management hub
- User story 18: Paginated jobs endpoint supports filtering by `serverStatus`
