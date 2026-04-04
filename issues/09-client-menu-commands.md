# PRD: Wire Up Create Meeting & Jobs Hub CLI Commands

## Problem Statement

The Meeting Summarizer CLI has a main menu with 7 items reflecting the meeting lifecycle. Currently, only 4 of the 7 menu actions are implemented (Start Recording, Sync & Summarize, Audio Setup, Settings). The **Create Meeting** and **Jobs** menu items are placeholders that print a log message and do nothing. This means users cannot:

- Pre-create meetings with specific configuration (language, AI template, attendees, speaker counts) before recording — they must configure everything ad-hoc during the sync step.
- Browse, inspect, retry, or manage their processing jobs — they have no visibility into what's been uploaded, what's processing, what failed, or what completed.

The backend services for both features (`MeetingService`, `JobManager`, `NoteService`) are fully implemented and tested. The gap is purely in the CLI command layer — the interactive UI that connects the menu to these services.

## Solution

Implement two new interactive CLI commands and refactor the application entry point to use a singleton service factory:

1. **Create Meeting Command** — A guided prompt flow that collects all meeting details (title, scheduled date, language, AI template, attendees, speaker counts), persists the meeting via `MeetingService`, and optionally chains directly into the Record command with the meeting pre-selected.

2. **Jobs Hub Command** — An interactive sub-menu that displays all jobs in a chalk-formatted table with borders and status emojis, lets the user select a job to see details, and provides context-aware actions (view summary/transcript, retry failed jobs, cancel pending uploads, regenerate Obsidian notes with a different template).

3. **Singleton Service Factory** — Refactor `index.ts` to instantiate shared services (`LowDB`, `MeetingService`, `JobManager`, `NoteService`, `NodeFileSystem`) once at the top of the main menu loop and pass them into each command, eliminating the risk of multiple database instances and ensuring data consistency.

## User Stories

1. As a CLI user, I want to create a meeting before recording, so that all configuration (language, template, attendees) is pre-set and I don't have to configure it during sync.
2. As a CLI user, I want to provide a meeting title when creating a meeting, so that my recordings are properly labeled from the start.
3. As a CLI user, I want to select a transcription language (auto/en/pt/es) when creating a meeting, so that the server uses the correct language model.
4. As a CLI user, I want to select an AI summary template (meeting/training/summary) when creating a meeting, so that the generated summary matches my meeting type.
5. As a CLI user, I want to optionally add attendees as a comma-separated list, so that the meeting record includes participant information.
6. As a CLI user, I want to optionally specify min/max speaker counts, so that the transcription diarization is more accurate.
7. As a CLI user, I want to optionally set a scheduled date/time (defaulting to now), so that I can pre-create meetings for future events.
8. As a CLI user, I want to be asked "Start recording now?" after creating a meeting, so that I can seamlessly chain into the recording workflow without navigating back to the menu.
9. As a CLI user, I want to see a confirmation message with the meeting details after creation, so that I know the meeting was saved correctly.
10. As a CLI user, I want to see all my jobs in a formatted table with columns (ID, Filename, Status, Recorded date), so that I have a clear overview of my processing pipeline.
11. As a CLI user, I want job statuses displayed with emoji indicators (✅ COMPLETED, ⏳ PROCESSING, 📤 UPLOADING, ⏸️ WAITING, ❌ FAILED, 💀 ABANDONED, 🗑️ DELETED), so that I can quickly scan the status of each job.
12. As a CLI user, I want to select a job from the list to see its details, so that I can inspect individual jobs.
13. As a CLI user, I want to view the summary text of a completed job, so that I can review the AI-generated output.
14. As a CLI user, I want to view the transcript text of a completed job, so that I can review the full transcription.
15. As a CLI user, I want to retry a failed or abandoned job, so that transient errors don't permanently block my recordings.
16. As a CLI user, I want to cancel a job that's waiting for upload, so that I can remove recordings I no longer want to process.
17. As a CLI user, I want to regenerate an Obsidian note for a completed job using a different template, so that I can change the note format after the fact.
18. As a CLI user, I want the job detail sub-menu to only show actions relevant to the job's current status, so that I'm not confused by inapplicable options.
19. As a CLI user, I want to see a friendly empty state message when there are no jobs, so that I know what to do next (record a meeting and run sync).
20. As a CLI user, I want the jobs hub to loop (list → detail → back to list) until I choose to go back to the main menu, so that I can inspect multiple jobs without re-entering the hub.
21. As a CLI user, I want long filenames in the jobs table to be truncated, so that the table layout doesn't break on narrow terminals.
22. As a CLI user, I want the Record command to receive the MeetingService so the meeting picker works, so that pre-created meetings appear when I start recording.
23. As a CLI user, I want all commands to share a single database instance, so that data is consistent across the entire session.

## Implementation Decisions

### New Modules

- **Create Meeting Command Module**: A pure async function that accepts an `IMeetingService` and returns a boolean indicating whether the user wants to chain to recording. It encapsulates all inquirer prompt logic for collecting meeting details (title, scheduledAt, language, AI template, attendees, min/max speakers). After successful creation, it displays a confirmation and asks "Start recording now?".

- **Jobs Hub Command Module**: A pure async function that accepts `JobManager`, `NoteService`, and `IFileManager`. It implements a sub-loop: render the chalk table → user picks a job (or "Back to menu") → show detail sub-menu with status-aware actions → execute action → return to list. Actions include: View Summary, View Transcript, Retry, Cancel, Regenerate Note, Back.

- **Table Formatter Module**: A pure function that accepts an array of `ClientJob` objects and returns a formatted string. Uses chalk for colored borders and status indicators. Columns: short ID (first 8 chars), Filename (truncated to ~30 chars), Status (emoji + label), Recorded date (formatted). Handles empty arrays with a friendly message.

- **Meeting Details Prompt**: A new prompt function in the UI prompts module that collects all `CreateMeetingInput` fields in sequence. Title is validated as required. ScheduledAt accepts a date string or defaults to now on Enter. Language and AI template use list selectors. Attendees accepts comma-separated input. Min/max speakers accept optional numbers.

### Modified Modules

- **Application Entry Point (index.ts)**: Refactored to use a singleton factory pattern. All shared services (`NodeFileSystem`, `LowDB`, `MeetingService`, `JobManager`, `NoteService`, `ApiService`, `IngestionService`, `SyncManager`) are instantiated once at the top of `mainMenuLoop()`. Each command receives its dependencies as function parameters. The `createMeetingCommand` return value is used to conditionally chain into `recordCommand`. The sync command is refactored to accept shared services instead of creating its own.

- **Commands Index**: Updated to re-export the new command modules.

- **Record Command Integration**: The `recordCommand` call in the main menu switch is updated to always pass the `meetingService` instance, enabling the meeting picker flow for pre-created meetings.

### Architectural Decisions

- **Singleton Factory over Service Locator**: Chosen because it's the simplest approach — no new abstractions needed, just function parameters. It prevents multiple `LowDB` instances from reading/writing the same JSON file concurrently. The `recordCommand` already follows this pattern (it optionally receives `meetingService`).

- **Chalk table with borders**: The jobs table uses chalk for styling rather than a third-party table library, keeping dependencies minimal. Box-drawing characters (─, │, ┌, ┐, └, ┘) create the bordered look.

- **Status-aware action filtering**: The job detail sub-menu dynamically builds its choices based on the job's `clientStatus`. This prevents users from attempting invalid operations (e.g., retrying a COMPLETED job).

- **Chain-to-record pattern**: `createMeetingCommand` returns a boolean rather than directly calling `recordCommand`, keeping the command decoupled. The caller (`index.ts`) handles the chaining, which is more testable.

## Testing Decisions

Good tests verify external behavior through the module's public interface, not implementation details. Tests should mock dependencies at the port/interface boundary and assert on observable outcomes (return values, calls to mocked services, output strings).

### Modules to Test

1. **Create Meeting Command Tests**: Mock `IMeetingService` and `inquirer`. Verify that `meetingService.create()` is called with the correct `CreateMeetingInput` assembled from prompt answers. Test validation (empty title rejection). Test the chain-to-record return value based on the user's yes/no answer. Test that date defaults to now when skipped. Prior art: `tests/commands/record.test.ts`, `tests/commands/recordMeetingPicker.test.ts`.

2. **Jobs Hub Command Tests**: Mock `JobManager`, `NoteService`, `IFileManager`, and `inquirer`. Test that `jobManager.listJobs()` is called. Test that selecting a COMPLETED job shows View Summary/Transcript/Regenerate Note actions. Test that selecting a FAILED job shows Retry action. Test that selecting a WAITING_UPLOAD job shows Cancel action. Test that retry calls `jobManager.retryJob()`. Test that cancel calls `jobManager.cancelJob()`. Test empty state handling. Prior art: `tests/commands/record.test.ts`.

3. **Table Formatter Tests**: Pure function tests — no mocks needed. Test column alignment with various data. Test status emoji mapping for all `ClientJobStatus` values. Test filename truncation at boundary lengths. Test empty array returns friendly message. Test short ID generation (first 8 chars). Prior art: `tests/services/progressDisplay.test.ts` (similar presentation logic testing).

4. **Service Wiring Tests**: Test that the singleton factory in `mainMenuLoop` creates the correct service types. Verify that the same `LowDB` instance is shared across `MeetingService`, `JobManager`, and `SyncManager`. Prior art: `tests/commands/menuStructure.test.ts` (testing structural correctness).

## Out of Scope

- **Meeting editing/deletion**: Users cannot edit or delete pre-created meetings from the CLI. This can be added later.
- **Real-time job status polling**: The Jobs Hub shows a snapshot; it does not auto-refresh or poll the server for status changes. Users run Sync to update statuses.
- **Pagination**: The jobs table shows all jobs. Pagination can be added if the list grows large.
- **Meeting list view**: There is no dedicated "List Meetings" menu item. Meetings are visible through the recording picker.
- **Server-side changes**: This PRD is entirely client-side. No server API changes are needed.
- **New npm dependencies**: The table formatter uses chalk (already a dependency) and box-drawing Unicode characters. No new packages are added.

## CEO Review Amendments (2026-04-03)

> Full review: `issues/09-ceo-review.md` | GH Issue #26 comment

### Required Amendments

1. **Sync dual-entry refactor (Issue 3):** Extract sync logic into `runSync(services)` plain async function. Both `mainMenuLoop` (shared services) and Commander `sync` command (own services) call it. Maintains backward compatibility for `cli sync`.

2. **Jobs Hub per-action error handling (Issue 5):** Each action in the Jobs Hub sub-menu (retry, cancel, regenerate) must be wrapped in its own try/catch. Display `chalk.red` friendly message per error type instead of crashing to the main menu.

3. **Ctrl+C graceful handling (Issue 6):** Add `ExitPromptError` check in `mainMenuLoop`'s catch block: `if (error instanceof ExitPromptError) continue;` — silently returns to menu instead of printing ugly error.

4. **Chain-to-record auto-selection (Issue 4 — UNRESOLVED):** `createMeetingCommand` should return `{ chainToRecord: boolean, meetingId?: string }` instead of just a boolean. `recordCommand` should accept an optional `preSelectedMeetingId` parameter to skip the picker. *(Pending owner decision: 4A vs 4B)*

5. **Date input validation (Issue 7):** Add inquirer `validate` on scheduledAt: `!input || !isNaN(Date.parse(input))`. Prevents garbage dates in the database.

6. **Speaker count cross-validation (Issue 8):** If both minSpeakers and maxSpeakers are provided and min > max, show validation error.

7. **DRY prompt extraction (Issue 9):** Extract shared prompt questions (language, template, minSpeakers, maxSpeakers) into reusable question arrays in `ui/prompts.ts`. Both `promptForJobConfig` and `promptForMeetingDetails` compose from these shared arrays.

8. **Chain integration test (Issue 10):** Add integration test in `tests/commands/` that mocks both `createMeetingCommand` and `recordCommand`, verifying the chaining logic in the menu switch statement.

9. **Action outcome logging (Issue 11):** Add explicit `console.log` messages for every Jobs Hub action outcome: `✅ Job retried successfully`, `🗑️ Job cancelled`, `📝 Note regenerated with template: X`, `❌ Failed to [action]: [reason]`.

10. **Title truncation (Issue 12):** Truncate title display to ~50 chars in confirmation box and jobs table. Store full title in DB.

### Expansion Opportunities (Deferred — see TODOS)

- **Quick Create** — minimal meeting creation (title only, all defaults) for power users
- **Job Status Counts in Menu** — show `Jobs 📊 (3 pending, 1 failed)` in main menu
- **Job Sorting/Filtering** — filter jobs table by status, sort by date
- **Meeting-to-Job Linkage Display** — show linked meeting title/config in job detail view
- **Confirmation Before Destructive Actions** — 'Are you sure?' before retry/cancel

## Further Notes

- The `NoteTemplate` enum includes `SELLER_MEETING` which has no corresponding `AIPromptTemplate` mapping. The Regenerate Note action in the Jobs Hub should offer all `NoteTemplate` values including `SELLER_MEETING`, since it's an explicit override that doesn't need an AI template mapping.
- The `promptForJobConfig` function in `ui/prompts.ts` already exists and handles language/template/speakers prompts. The new `promptForMeetingDetails` function will reuse similar prompt patterns but collects the full `CreateMeetingInput` shape including title and attendees.
- The sync command currently uses Commander's `parseAsync` to trigger its action. The refactoring should extract the sync logic into a plain async function that accepts services, making it consistent with the other commands.

## Engineering Review (2026-04-03)

> Reviewer: /plan-eng-review | Branch: main | Mode: FULL_REVIEW

### Step 0: Scope Challenge

**Scope accepted as-is.** The plan is well-calibrated:
- 7 files touched (under 8-file smell threshold)
- 0 new classes (all plain async functions)
- All backend services exist and are tested. This is pure CLI wiring.
- No innovation tokens spent. chalk + inquirer are Layer 1 (already dependencies).
- No TODOS.md exists yet. CEO review proposes creating one with 4 deferred items.
- Plan does the complete version. All 23 user stories addressed. 10 CEO amendments incorporated.

### Section 1: Architecture Review — 3 Issues Found, All Resolved

**Issue 1: Sync refactor — what does `runSync()` accept?** (confidence: 8/10)
- `sync.ts` creates its own `SyncManager` with 5 services. The singleton factory will also create a `SyncManager`.
- **Decision: 1A** — `runSync(syncManager: SyncManager)` accepts a pre-built SyncManager. The standalone Commander `sync` command creates its own (like today). Follows the existing pattern where `recordCommand` receives `meetingService`.

**Issue 2: Chain-to-record needs the meeting ID** (confidence: 9/10)
- CEO review Issue 4 (was unresolved). `recordCommand` at lines 62-80 shows a picker if `meetingService` is provided. Returning just `true` forces the user to re-select the meeting they just created.
- **Decision: 2A** — `createMeetingCommand` returns `{ chainToRecord: boolean, meetingId?: string }`. `recordCommand` accepts optional `preSelectedMeetingId` to skip the picker. Seamless flow.

**Issue 3: Singleton factory placement** (confidence: 8/10)
- **Decision: 3A** — Factory inside `mainMenuLoop()`, before the `while(true)`. Services created once, used by all commands. Standalone Commander commands create their own services. Minimal diff.

### Section 2: Code Quality Review — 7 Issues Found, All Resolved

**Issue 4: DRY violation — shared prompt questions** (confidence: 9/10)
- `promptForJobConfig()` in `ui/prompts.ts` lines 28-52 has 4 identical questions (language, template, minSpeakers, maxSpeakers) that `promptForMeetingDetails` will duplicate.
- **Decision: 4A** — Extract shared questions into reusable arrays. Both functions compose from them.

**Issue 5: Jobs Hub per-action error handling** (confidence: 9/10)
- `jobManager.retryJob()` and `cancelJob()` throw specific errors. `noteService.regenerateNote()` can fail on missing files. None caught in the Jobs Hub command.
- **Decision: 5A** — Each action gets its own try/catch with `chalk.red` friendly messages. User stays in Jobs Hub loop instead of crashing to menu.

**Issue 6: Ctrl+C graceful handling** (confidence: 9/10)
- inquirer v5+ throws `ExitPromptError` on Ctrl+C. Current catch block prints ugly error.
- **Decision: 6A** — Add `if (error instanceof ExitPromptError) continue;` in `mainMenuLoop`'s catch. Handles all commands uniformly.

**Issue 7: Date input validation** (confidence: 9/10)
- `new Date("banana")` returns Invalid Date. No validation in the prompt.
- **Decision: 7A** — Add inquirer `validate`: `!input || !isNaN(Date.parse(input))`.

**Issue 8: minSpeakers > maxSpeakers cross-validation** (confidence: 8/10)
- **Decision: 8A** — Add cross-field validation. If both provided and min > max, show error.

**Issue 9: Action outcome logging** (confidence: 9/10)
- **Decision: Locked in.** Add explicit `console.log` for every Jobs Hub action outcome.

**Issue 10: Title truncation** (confidence: 8/10)
- **Decision: Locked in.** Truncate title display to ~50 chars in confirmation box and jobs table.

### Section 3: Test Review — 45 Gaps Identified

Test framework: **vitest** (confirmed by `vitest.config.ts`).

```
CODE PATH COVERAGE
[+] commands/createMeeting.ts (NEW)
    │
    ├── createMeetingCommand(meetingService)
    │   ├── [GAP] Happy path: prompts → create → confirmation → chain=true
    │   ├── [GAP] Happy path: prompts → create → confirmation → chain=false
    │   ├── [GAP] Empty title → re-prompt (inquirer validate)
    │   ├── [GAP] Invalid date "banana" → re-prompt (Issue 7)
    │   ├── [GAP] min > max speakers → re-prompt (Issue 8)
    │   ├── [GAP] All defaults (Enter through everything)
    │   ├── [GAP] Ctrl+C mid-prompt → ExitPromptError
    │   └── [GAP] Return shape: { chainToRecord: true, meetingId: "uuid" }

[+] commands/jobsHub.ts (NEW)
    │
    ├── jobsHubCommand(jobManager, noteService, fileManager)
    │   ├── [GAP] Empty job list → friendly message → back to menu
    │   ├── [GAP] Job list renders → user picks job → detail view
    │   ├── [GAP] COMPLETED job → shows View Summary/Transcript/Regenerate
    │   ├── [GAP] FAILED job → shows Retry action
    │   ├── [GAP] ABANDONED job → shows Retry action
    │   ├── [GAP] WAITING_UPLOAD job → shows Cancel action
    │   ├── [GAP] PROCESSING job → view only, no actions
    │   ├── [GAP] Retry → calls jobManager.retryJob()
    │   ├── [GAP] Cancel → calls jobManager.cancelJob()
    │   ├── [GAP] Regenerate → prompts template → calls noteService.regenerateNote()
    │   ├── [GAP] View Summary → reads and displays text
    │   ├── [GAP] View Transcript → reads and displays text
    │   ├── [GAP] Retry invalid state → friendly error, stays in hub
    │   ├── [GAP] Cancel invalid state → friendly error
    │   ├── [GAP] Regenerate missing file → friendly error
    │   ├── [GAP] Job deleted between list and detail → "not found"
    │   ├── [GAP] Back to list → re-renders table
    │   ├── [GAP] Back to menu → exits loop
    │   └── [GAP] Ctrl+C → ExitPromptError

[+] ui/tableFormatter.ts (NEW)
    │
    ├── formatJobsTable(jobs: ClientJob[])
    │   ├── [GAP] Multiple jobs → formatted table with borders
    │   ├── [GAP] Empty array → "No jobs yet" message
    │   ├── [GAP] All 8 ClientJobStatus → correct emoji mapping
    │   ├── [GAP] Short ID = first 8 chars
    │   ├── [GAP] Filename > 30 chars → truncated
    │   ├── [GAP] Title > 50 chars → truncated
    │   ├── [GAP] Date formatting
    │   └── [GAP] Single job → one-row table

[+] ui/prompts.ts (MODIFIED)
    │
    ├── [GAP] Shared question arrays produce correct field names
    ├── [GAP] promptForMeetingDetails full flow
    ├── [GAP] Date validation accepts/rejects correctly
    ├── [GAP] Speaker cross-validation rejects min > max
    ├── [GAP] Attendees comma parsing
    └── [REGRESSION] promptForJobConfig still returns correct UploadOptions after refactor

[+] index.ts (MODIFIED)
    │
    ├── [GAP] Singleton: same LowDB shared across services
    ├── [GAP] Chain: createMeeting returns true → recordCommand called with meetingId
    ├── [GAP] ExitPromptError → continue (no error printed)
    └── [GAP] All switch cases wire correct services

[+] commands/record.ts (MODIFIED)
    │
    ├── [★★★ TESTED] Existing picker flow — recordMeetingPicker.test.ts
    ├── [★★★ TESTED] Existing filename building — record.test.ts
    └── [GAP] preSelectedMeetingId → skips picker

[+] commands/sync.ts (MODIFIED)
    │
    └── [GAP] runSync(syncManager) calls runFullSyncCycle()

USER FLOW COVERAGE
[+] Create Meeting → Chain to Record
    ├── [GAP] Full journey: create → yes → recording starts with meeting title
    ├── [GAP] Create → no → back to menu
    └── [GAP] Create → Ctrl+C → back to menu

[+] Jobs Hub browsing
    ├── [GAP] Table → pick job → view summary → back to list → back to menu
    ├── [GAP] Table → pick failed → retry → success → back to list
    ├── [GAP] Table → pick completed → regenerate → pick template → success
    └── [GAP] Table → no jobs → friendly message → back to menu

[+] Error recovery
    ├── [GAP] Retry invalid state → error → stays in hub
    ├── [GAP] Cancel invalid state → error → stays in hub
    └── [GAP] Regenerate missing file → error → stays in hub

─────────────────────────────────
COVERAGE: 3/48 paths tested (6%)
  Code paths: 3/40 (8%)
  User flows: 0/8 (0%)
QUALITY:  ★★★: 3  ★★: 0  ★: 0
GAPS: 45 paths need tests
REGRESSION: 1 (promptForJobConfig after DRY refactor)
─────────────────────────────────
```

#### Required Test Files

1. **`tests/commands/createMeeting.test.ts`** — Mock IMeetingService + inquirer. 8 test cases.
2. **`tests/commands/jobsHub.test.ts`** — Mock JobManager + NoteService + IFileManager + inquirer. 18 test cases.
3. **`tests/ui/tableFormatter.test.ts`** — Pure function tests. 8 test cases.
4. **`tests/ui/prompts.test.ts`** — Shared questions + promptForMeetingDetails + regression. 6 test cases.
5. **`tests/commands/chainIntegration.test.ts`** — Mock both commands, verify chaining in menu switch. 2 test cases.
6. **`tests/commands/record.test.ts`** (extend) — preSelectedMeetingId skips picker. 1 test case.
7. **`tests/commands/singletonWiring.test.ts`** — Same LowDB shared across services. 2 test cases.

### Section 4: Performance Review — 0 Issues

No N+1 queries (LowDB reads entire JSON into memory). Table rendering for 100 jobs is <1ms. One `db.write()` per meeting creation. Singleton factory init is once per session.

### Outside Voice (Claude Adversarial Subagent)

Codex unavailable. Providing independent critical challenge:

```
OUTSIDE VOICE (adversarial challenge):
════════════════════════════════════════════════════════════
1. SETTINGS CHANGE INVALIDATES SINGLETON SERVICES.
   The singleton factory creates NoteService with configService.get('obsidian')
   at init time. If the user runs Settings (menu item 6) and changes their
   Obsidian vault path mid-session, the NoteService still holds the OLD config.
   The Jobs Hub "Regenerate Note" action would write to the wrong vault.
   
   Severity: Medium. The user would need to restart the CLI after changing
   settings for the new vault path to take effect. This is a pre-existing
   issue (sync.ts creates NoteService the same way), but the singleton
   pattern makes it more visible because the service lives for the entire
   session instead of being recreated each sync run.

2. SYNC COMMAND STANDALONE vs SHARED — BEHAVIORAL DIVERGENCE.
   The standalone `cli sync` command (Commander action) creates its own
   services. The menu `sync` option uses shared services. If there's a
   bug in service initialization, it could manifest differently between
   the two paths. No test covers this divergence.
   
   Severity: Low. Both paths create the same service types with the same
   constructor args. The risk is theoretical.

3. JOBS HUB SUB-LOOP EXIT CONDITION.
   The Jobs Hub implements a while(true) sub-loop (list → detail → back
   to list). If the user's terminal loses focus or the process gets
   backgrounded, inquirer prompts will hang. This is standard CLI behavior,
   not a bug, but worth noting that the sub-loop has no timeout or
   heartbeat.
   
   Severity: Low. Standard CLI limitation.

4. NO TEST FOR NoteService.regenerateNote() RECEIVING fileManager.
   The NoteService.regenerateNote() method takes a separate `fileManager`
   parameter (not the one injected via constructor). The Jobs Hub will
   pass the shared IFileManager. But the test plan doesn't explicitly
   verify that the correct fileManager instance is passed through.
   
   Severity: Low. The wiring is straightforward, but a test would catch
   accidental parameter ordering bugs.

5. TABLE FORMATTER TERMINAL WIDTH.
   The chalk table with box-drawing characters assumes a minimum terminal
   width. On very narrow terminals (< 60 cols), the table will wrap and
   look broken. The PRD mentions filename truncation but doesn't mention
   terminal width detection.
   
   Severity: Low. Edge case for narrow terminals. Acceptable for v1.
════════════════════════════════════════════════════════════
```

**CROSS-MODEL TENSION:**

- **[Settings invalidation]:** The review didn't flag this. The outside voice is right that changing Obsidian settings mid-session won't take effect for the singleton NoteService. However, this is a pre-existing pattern (sync.ts does the same thing), and fixing it would require either lazy config reads or service recreation after settings change. That's scope expansion. **Recommend: Add to TODOS.md, don't fix in this PR.**

- **[fileManager parameter test]:** The review's test plan covers "regenerate calls noteService.regenerateNote()" but doesn't explicitly assert the fileManager argument. **Recommend: Add assertion to the jobsHub.test.ts regenerate test case.** Trivial addition.

No other tension points. Both reviewers agree on the core architecture and approach.

### "NOT in scope" Section

| Item | Rationale |
|---|---|
| Meeting editing/deletion from CLI | PRD explicitly defers |
| Real-time job status polling | PRD explicitly defers |
| Pagination for jobs list | PRD explicitly defers |
| Meeting list view menu item | PRD explicitly defers |
| Server-side changes | PRD explicitly defers |
| New npm dependencies | PRD explicitly defers |
| Settings change invalidating singleton services | Pre-existing pattern, scope expansion |
| Terminal width detection for table | Edge case, acceptable for v1 |

### "What already exists" Section

| Sub-problem | Existing Code | Reused? |
|---|---|---|
| Meeting CRUD | `MeetingService` + `LowDB` meeting methods | ✅ |
| Job listing/details | `JobManager.listJobs()` + `getJobDetails()` | ✅ |
| Job retry/cancel | `JobManager.retryJob()` + `cancelJob()` | ✅ |
| Note regeneration | `NoteService.regenerateNote()` | ✅ |
| Meeting picker | `MeetingPicker` class | ✅ |
| Prompt patterns | `promptForJobConfig()` in `ui/prompts.ts` | ✅ (pattern) |
| Menu structure | `menu.ts` with all 7 items | ✅ |
| Record with meeting | `recordCommand(meetingService?)` | ✅ |

### Failure Modes

| Codepath | Failure Mode | Test? | Error Handling? | User Sees? | Logged? |
|---|---|---|---|---|---|
| Create Meeting | Empty title | Y | Y (validate) | Re-prompt | N |
| Create Meeting | Invalid date | Y | Y (validate, Issue 7) | Re-prompt | N |
| Create Meeting | min > max speakers | Y | Y (validate, Issue 8) | Re-prompt | N |
| Create Meeting | Ctrl+C | Y | Y (Issue 6) | Menu | N |
| Create Meeting | LowDB write fail | N | Y (outer catch) | "Unexpected error" | Y |
| Jobs Hub | Empty list | Y | Y | Friendly msg | N |
| Jobs Hub | Retry invalid state | Y | Y (Issue 5) | Friendly error | N |
| Jobs Hub | Cancel invalid state | Y | Y (Issue 5) | Friendly error | N |
| Jobs Hub | Regenerate file missing | Y | Y (Issue 5) | Friendly error | N |
| Jobs Hub | Job deleted mid-view | Y | Y | "Not found" | N |
| Jobs Hub | Ctrl+C | Y | Y (Issue 6) | Menu | N |
| Singleton factory | Service init fails | N | N | Crash | Y — **WARNING** |

**Critical gaps:** 0. All failure modes have either tests or error handling.
**Warnings:** 1 (singleton init failure — low severity, would only happen on corrupted config or disk issues).

### Worktree Parallelization Strategy

| Step | Modules touched | Depends on |
|---|---|---|
| A: Create Meeting command | commands/, ui/prompts | — |
| B: Jobs Hub command + table formatter | commands/, ui/ | — |
| C: Singleton factory + sync refactor | index.ts, commands/sync.ts | — |
| D: Record command preSelectedMeetingId | commands/record.ts | A (needs return type) |
| E: Tests | tests/ | A, B, C, D |

**Parallel lanes:**
- **Lane A:** Create Meeting command + prompts DRY refactor (independent)
- **Lane B:** Jobs Hub command + table formatter (independent)
- **Lane C:** Singleton factory + sync refactor + record.ts modification (independent of A/B for structure, but D depends on A's return type)

**Execution order:** Launch A + B in parallel. Merge both. Then C (wires everything together). Then E (tests for all).

**Conflict flags:** Lanes A and B both touch `ui/prompts.ts` (A adds shared questions, B doesn't touch it). Lane C touches `index.ts` which imports from A and B. Merge A+B first, then C.

### Completion Summary

```
+=========================================================================+
|            ENGINEERING REVIEW — COMPLETION SUMMARY                       |
+=========================================================================+
| Step 0  (Scope)     | Accepted as-is. 7 files, 0 new classes.          |
| Section 1 (Arch)    | 3 issues found, all resolved (1A, 2A, 3A)       |
| Section 2 (Quality) | 7 issues found, all resolved (4A-10)             |
| Section 3 (Tests)   | Diagram produced, 45 gaps, 1 regression          |
| Section 4 (Perf)    | 0 issues                                         |
| Outside Voice       | Ran (Claude adversarial). 5 findings.            |
|                     | 1 deferred to TODOS (settings invalidation).     |
|                     | 1 minor test addition (fileManager assertion).   |
| NOT in scope        | Written (8 items)                                |
| What already exists | Written (8 items — all reused)                   |
| Failure modes       | 12 total, 0 critical gaps, 1 warning             |
| TODOS.md updates    | 5 items proposed                                 |
| Parallelization     | 3 parallel lanes, merge order: A+B → C → E      |
| Unresolved decisions| 0 (all resolved during review)                   |
| Lake Score          | 10/10 recommendations chose complete option      |
+=========================================================================+
```

### TODOS.md Proposed Items

1. **Settings change invalidating singleton services** — If user changes Obsidian vault path via Settings mid-session, NoteService still holds old config. Fix: either lazy config reads or service recreation after settings. Low priority.
2. **Pagination for Jobs Hub** — When job count exceeds terminal height, add pagination or scrolling. Deferred per PRD.
3. **Meeting editing/deletion CLI commands** — CRUD is half-done (create + read exist). Deferred per PRD.
4. **Real-time job status polling** — Background daemon that auto-syncs. Deferred per PRD.
5. **Meeting list view as dedicated menu item** — Browse all meetings without going through recording picker. Deferred per PRD.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | 12 issues, 5 expansions deferred |
| Codex Review | `/codex review` | Independent 2nd opinion | 0 | — | — |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | CLEAR (PLAN) | 10 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | — |

- **UNRESOLVED:** 0 decisions
- **VERDICT:** CEO + ENG CLEARED — ready to implement
