# TODOS

Deferred work items tracked across PRDs and reviews.

## From PRD #09 — Wire Up Create Meeting & Jobs Hub CLI Commands

### Settings change invalidating singleton services
- **What:** If user changes Obsidian vault path via Settings mid-session, NoteService still holds old config.
- **Why:** The singleton factory creates NoteService with `configService.get('obsidian')` at init time. Changing settings doesn't recreate services.
- **Pros:** Fixing this ensures config changes take effect immediately without restarting the CLI.
- **Cons:** Requires either lazy config reads or service recreation after settings change. Adds complexity to the singleton factory.
- **Context:** Pre-existing pattern (sync.ts creates NoteService the same way). The singleton pattern makes it more visible because the service lives for the entire session. Flagged by outside voice during eng review.
- **Depends on:** PRD #09 implementation (singleton factory must exist first).

### Pagination for Jobs Hub
- **What:** Add pagination or scrolling when job count exceeds terminal height.
- **Why:** With 100+ jobs, the table will scroll off screen and the user loses context.
- **Pros:** Better UX for power users with many recordings.
- **Cons:** Adds complexity to the table formatter and inquirer flow.
- **Context:** PRD #09 explicitly defers this. The table currently shows all jobs. For typical users with <100 jobs, this is fine.
- **Depends on:** PRD #09 Jobs Hub implementation.

### Meeting editing/deletion CLI commands
- **What:** Add update and delete operations for pre-created meetings from the CLI.
- **Why:** CRUD is half-done (create + read exist via MeetingService). Users can't fix typos or remove unwanted meetings.
- **Pros:** Complete CRUD surface area. MeetingService already has `update()` method.
- **Cons:** Needs new UI prompts and a dedicated menu item or sub-menu.
- **Context:** PRD #09 explicitly defers. The backend `IMeetingService.update()` already exists.
- **Depends on:** PRD #09 implementation.

### Real-time job status polling
- **What:** Background daemon that auto-syncs job statuses without manual "Sync & Summarize" runs.
- **Why:** Users currently must manually run sync to see if jobs completed. Polling would show real-time progress.
- **Pros:** Much better UX. Users see results as soon as server finishes processing.
- **Cons:** Significant complexity: background process, event loop, terminal UI updates during prompts.
- **Context:** PRD #09 explicitly defers. The singleton factory architecture supports this (shared services enable background tasks).
- **Depends on:** PRD #09 singleton factory.

### Meeting list view as dedicated menu item
- **What:** Add a "List Meetings" menu item to browse all meetings without going through the recording picker.
- **Why:** Currently meetings are only visible when starting a recording. Users can't browse their meeting history.
- **Pros:** Better discoverability. Natural complement to Create Meeting.
- **Cons:** Adds another menu item (8 total). Needs its own sub-menu for actions.
- **Context:** PRD #09 explicitly defers. Meetings are visible through the recording picker flow.
- **Depends on:** PRD #09 implementation.
