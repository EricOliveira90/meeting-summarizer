# Plan: Meeting-Centric Workflow & Job Management

> Source PRD: GitHub Issue #1 — "Client Package: Meeting-Centric Workflow & Job Management"

## Architectural decisions

Durable decisions that apply across all phases:

- **Data model**: New `Meeting` entity (client-only) with fields: `id`, `title`, `scheduledAt`, `language`, `aiTemplate`, `noteTemplate`, `attendees`, `minSpeakers`, `maxSpeakers`, `status`, `jobId`, `createdAt`. `MeetingStatus` enum: `CREATED | RECORDING | RECORDED | LINKED`.
- **Schema**: `ClientSchema` gains a `meetings[]` array alongside the existing `jobs[]` array.
- **Linkage**: `ClientJob` gains an optional `meetingId` field. `Meeting` gains an optional `jobId` field.
- **Template mapping**: AI template `meeting` maps to Obsidian `STD_MEETING`, `training` to `TRAINING`, `summary` to `SUMMARY`. Pure utility function, overridable per-job. `SELLER_MEETING` is available only as an explicit override.
- **DI pattern**: `IMeetingService` port interface, consistent with existing `IClientDb`, `IApiService`, etc.
- **Server unchanged**: The `Meeting` entity is client-only. The server has no concept of meetings — it only knows about jobs and upload options.
- **Menu order**: Create Meeting -> Start Recording -> Jobs -> Sync -> Audio Setup -> Settings -> Exit.

---

## Phase 1: Meeting Entity + Create Meeting CLI

**User stories**: 1, 4, 5, 6, 7

### What to build

Introduce the `Meeting` data model and its service layer, extend the client database schema with a `meetings` collection, and add an interactive "Create Meeting" command to the CLI.

The create flow prompts for a title (required), then optional fields: scheduled date/time (defaults to "now"), AI template (defaults to `meeting`), language (defaults to `auto`), attendees (comma-separated list), and speaker hints (min/max). The meeting is persisted with status `CREATED`.

A `list` method on the service returns meetings sorted by `scheduledAt`, which the later recording phase will use as a picker.

### Acceptance criteria

- [ ] `Meeting` type and `MeetingStatus` enum are defined in the client domain
- [ ] `IMeetingService` port interface is defined with `create`, `list`, `getById`, `update`, `updateStatus`, `linkToJob` methods
- [ ] `MeetingService` implements the port, persisting to the client DB
- [ ] `ClientDb` schema includes a `meetings` array and exposes meeting CRUD methods
- [ ] "Create Meeting" command prompts for title (required) and optional fields with sensible defaults (time=now, template=meeting, language=auto)
- [ ] Created meetings are persisted and retrievable via `list`
- [ ] Unit tests cover MeetingService CRUD, lifecycle transitions, and validation

---

## Phase 2: Record with Meeting Picker + Config Flow

**User stories**: 2, 3, 8, 18, 20

### What to build

Wire meetings into the recording and ingestion pipeline end-to-end. Before recording starts, the user sees a picker listing all `CREATED` meetings (sorted by scheduled time) plus a "Quick start" option. Selecting a pre-created meeting skips all config prompts and transitions the meeting to `RECORDING` status. Selecting "Quick start" creates an ad-hoc meeting inline (title prompt only, defaults for everything else).

When recording stops, the meeting transitions to `RECORDED`. During ingestion, if a file is linked to a meeting, config (language, template, speakers) is pulled from the meeting entity — no prompts. The meeting transitions to `LINKED` when a `ClientJob` is created from it. Orphan files (not linked to any meeting) still trigger the existing prompt flow.

A `TemplateMapper` utility function maps `AIPromptTemplate` to `NoteTemplate` and is used during ingestion to set the job's `noteTemplate` from the meeting's `aiTemplate`.

### Acceptance criteria

- [ ] Record command shows a picker with `CREATED` meetings + "Quick start new" option
- [ ] Selecting a pre-created meeting skips title/config prompts and uses the meeting's metadata
- [ ] "Quick start" creates an ad-hoc meeting inline with minimal prompts
- [ ] Meeting status transitions correctly: `CREATED` -> `RECORDING` -> `RECORDED` -> `LINKED`
- [ ] `ClientJob` gets a `meetingId` field when created from a meeting
- [ ] Ingestion pulls `UploadOptions` and `noteTemplate` from the linked meeting instead of prompting
- [ ] `TemplateMapper` correctly maps all AI templates to Obsidian templates
- [ ] Orphan recording files (not linked to any meeting) are still ingested with prompts as before
- [ ] Unit tests cover the template mapper, meeting-linked ingestion path, and orphan path

---

## Phase 3: Job Management Hub

**User stories**: 10, 11, 12, 13

### What to build

A new "Jobs" sub-menu accessible from the main CLI menu. It lists all jobs with their current status (color-coded or icon-differentiated), then lets the user select a job to act on.

The detail view shows: job ID, original filename, status, recorded date, and — for completed jobs — summary text and transcript text (read from local files). For failed/abandoned jobs, the error message is displayed.

Actions available from the detail view: **Retry** (re-queues a `FAILED` or `ABANDONED` job by resetting status to `WAITING_UPLOAD` and clearing the retry count), **Cancel** (removes a `WAITING_UPLOAD` job from the queue by marking it `DELETED`), and **Back** (return to the job list).

### Acceptance criteria

- [ ] "Jobs" menu item appears in the main CLI menu
- [ ] Job list displays all jobs with their current status
- [ ] Selecting a job shows its details: filename, status, recorded date, error (if any)
- [ ] Completed jobs show summary and transcript text from local files
- [ ] "Retry" action resets a `FAILED` or `ABANDONED` job to `WAITING_UPLOAD` with retry count cleared
- [ ] "Cancel" action marks a `WAITING_UPLOAD` job as `DELETED`
- [ ] Sub-menu loops back to the job list after each action until the user exits
- [ ] Unit tests cover retry logic (status reset, retry count clear) and cancel logic

---

## Phase 4: Note Regeneration & Template Override

**User stories**: 9, 14, 15

### What to build

From the job detail view in the Jobs hub, add a "Regenerate Note" action for `COMPLETED` jobs. This action re-reads the locally stored summary and transcript files and re-renders the Obsidian note.

The user is prompted to pick an Obsidian template from all available options (STD_MEETING, SELLER_MEETING, TRAINING, SUMMARY), defaulting to the job's current `noteTemplate`. The selected template is saved back to the job so future regenerations default to it.

The `NoteService` gains a `regenerateNote` method that accepts a job and a template, reads the local files, and overwrites the existing note in the vault.

### Acceptance criteria

- [ ] "Regenerate Note" action appears for `COMPLETED` jobs in the job detail view
- [ ] User is prompted to select an Obsidian template, defaulting to the job's current template
- [ ] All four Obsidian templates are available as options (including `SELLER_MEETING`)
- [ ] Note is re-rendered from local summary/transcript files and written to the vault
- [ ] The job's `noteTemplate` is updated to the selected template
- [ ] Regeneration works even if the original note file was deleted or corrupted
- [ ] Unit tests cover note regeneration with template switching

---

## Phase 5: Upload Progress Display

**User stories**: 16, 17

### What to build

Visual progress feedback during the `pushPending` step of the sync cycle. A `ProgressDisplay` utility wraps a CLI progress bar library and provides: `startUpload(filename, totalBytes)` which returns an `onProgress(bytesTransferred)` callback, `finish()`, and `fail()`.

The `SyncManager` wires the progress display into `pushJob()` via the existing HTTP upload mechanism. When multiple jobs are synced, a batch counter (`[1/5]`, `[2/5]`, etc.) is shown alongside the progress bar.

### Acceptance criteria

- [ ] A progress bar is displayed during each file upload showing percentage and bytes transferred
- [ ] A batch counter (`[N/M]`) is displayed when syncing multiple jobs
- [ ] Progress bar updates in real-time as bytes are transferred
- [ ] Progress display handles upload failure gracefully (shows error, moves to next job)
- [ ] Progress display handles single-job uploads (no batch counter needed, or `[1/1]`)
- [ ] Unit tests cover ProgressDisplay start/update/finish/fail lifecycle

---

## Phase 6: CLI Menu Restructure

**User story**: 19

### What to build

Reorder the main CLI menu to reflect the meeting lifecycle. The new order is:

1. Create Meeting
2. Start Recording
3. Jobs
4. Sync & Summarize
5. Audio Setup
6. Settings
7. Exit

This is a cosmetic change to the menu definition in the main entry point. All menu items already exist from prior phases; this phase just sets the final ordering.

### Acceptance criteria

- [ ] Main menu items appear in the specified lifecycle order
- [ ] All menu items route to their correct commands
- [ ] Menu loop behavior (return to menu after command) is preserved
