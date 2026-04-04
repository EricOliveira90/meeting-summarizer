# 🔍 MEGA PLAN REVIEW — Sections 1-11

**PRD:** `issues/09-client-menu-commands.md` — Wire Up Create Meeting & Jobs Hub CLI Commands  
**Mode:** SELECTIVE EXPANSION (Approach A — Full Implementation)

---

## Section 1: Architecture Review

### System Architecture Diagram

```
  ┌─────────────────────────────────────────────────────────────────┐
  │                        index.ts (Entry Point)                   │
  │  ┌──────────────────────────────────────────────────────────┐   │
  │  │              mainMenuLoop() — SINGLETON FACTORY          │   │
  │  │                                                          │   │
  │  │  NodeFileSystem ──┐                                      │   │
  │  │  LowDB ───────────┤── shared instances                   │   │
  │  │  MeetingService ──┤                                      │   │
  │  │  JobManager ──────┤                                      │   │
  │  │  NoteService ─────┤                                      │   │
  │  │  ApiService ──────┤                                      │   │
  │  │  IngestionService ┤                                      │   │
  │  │  SyncManager ─────┘                                      │   │
  │  └──────────────────────────────────────────────────────────┘   │
  │                          │                                      │
  │          ┌───────────────┼───────────────┐                      │
  │          ▼               ▼               ▼                      │
  │  ┌──────────────┐ ┌──────────┐ ┌──────────────┐                │
  │  │createMeeting │ │  record  │ │   jobsHub    │                │
  │  │  Command     │ │ Command  │ │   Command    │                │
  │  │              │ │          │ │              │                  │
  │  │ IMeetingServ │ │ IMeeting │ │ JobManager   │                │
  │  │              │ │ Service  │ │ NoteService  │                │
  │  │ returns bool │ │          │ │ IFileManager │                │
  │  │ (chain-to-   │ │          │ │              │                │
  │  │  record?)    │ │          │ │ sub-loop:    │                │
  │  └──────┬───────┘ └──────────┘ │ list→detail  │                │
  │         │                      │ →action→list │                │
  │         │ if true              └──────────────┘                │
  │         └──────► recordCommand(meetingService)                  │
  │                                                                 │
  │          ┌───────────────┬───────────────┐                      │
  │          ▼               ▼               ▼                      │
  │  ┌──────────────┐ ┌──────────┐ ┌──────────────┐                │
  │  │  syncAction  │ │  audio   │ │  settings    │                │
  │  │  (refactored)│ │  setup   │ │  (setup)     │                │
  │  └──────────────┘ └──────────┘ └──────────────┘                │
  └─────────────────────────────────────────────────────────────────┘
                          │
                          ▼
              ┌──────────────────────┐
              │   LowDB (JSON file)  │
              │   client-db.json     │
              │   ┌────────────────┐ │
              │   │ jobs: []       │ │
              │   │ meetings: []   │ │
              │   └────────────────┘ │
              └──────────────────────┘
```

### Dependency Graph — New Components

```
  createMeetingCommand ──► IMeetingService (interface)
       │                        │
       │                        ▼
       │                   MeetingService ──► LowDB
       │
       └──► returns boolean ──► index.ts chains to recordCommand

  jobsHubCommand ──► JobManager ──► IClientDb (LowDB)
       │                              IFileManager
       │
       ├──► NoteService ──► IFileManager
       │                     ObsidianConfig
       │
       └──► IFileManager (for reading summary/transcript files)

  tableFormatter ──► ClientJob[] (pure function, no deps)
```

### Architecture Assessment

**Coupling:** The singleton factory in `mainMenuLoop` creates a new coupling point — all services are instantiated in one place. This is **justified** because:
1. It replaces the worse pattern (sync.ts creating its own instances)
2. It ensures a single LowDB instance (prevents concurrent JSON file writes)
3. It follows the existing pattern (`recordCommand` already optionally accepts `meetingService`)

**Single Points of Failure:** The LowDB JSON file is the single data store. If it corrupts mid-write, all data is lost. This is a **pre-existing risk**, not introduced by this plan. The plan actually *reduces* this risk by ensuring only one LowDB instance exists.

**Rollback Posture:** If this ships and breaks, rollback is trivial — revert the commit. The placeholder functions still exist in the current code. No data migration needed. **Reversibility: 5/5.**

**Production Failure Scenario:** The most realistic failure is: user creates a meeting, chains to record, but the `meetingService` instance passed to `recordCommand` has a stale LowDB read. Since LowDB reads from file on init and writes on every mutation, and we're using a singleton, this is **not a risk** — the same instance is shared.

### Architecture Issues

**Issue 3: Sync command refactor — dual entry point problem**

The sync command currently exists as a Commander `Command` object (`sync.ts`) that creates its own services. The PRD says to refactor it to a plain async function. But the CLI also exposes `cli sync` as a standalone command (`program.command('sync')`).

**3A.** Extract sync logic into `runSync(services)` plain function. Both `mainMenuLoop` and the Commander `sync` command call it. The Commander action creates its own services (for standalone use), while `mainMenuLoop` passes shared services. Effort: S. Risk: Low. **Recommended** — maintains backward compatibility.

**3B.** Remove the standalone `cli sync` command entirely. Users must use the interactive menu. Effort: XS. Risk: Med (breaks existing workflows).

**3C.** Keep sync.ts as-is for standalone, create a separate `runSyncWithServices()` for the menu loop. Effort: XS. Risk: Low but creates DRY violation.

**→ I'll proceed with 3A as the obvious fix. Moving on.**

**Issue 4: Chain-to-record — should the newly created meeting be auto-selected?**

The PRD says `createMeetingCommand` returns a boolean. If true, `index.ts` calls `recordCommand(meetingService)`. But `recordCommand` will then show the meeting picker again, and the user has to re-select the meeting they just created.

**4A.** `createMeetingCommand` returns `{ chainToRecord: boolean, meetingId?: string }`. `recordCommand` accepts an optional `preSelectedMeetingId` parameter to skip the picker. Effort: S. Risk: Low. **Recommended** — eliminates redundant interaction.

**4B.** Keep as-is (return boolean only). The user sees the picker with their new meeting at the top. Effort: XS. Risk: Low but slightly annoying UX.

**Which do you prefer? 4A or 4B?**

---

## Section 2: Error & Rescue Map

### Create Meeting Command

```
  METHOD/CODEPATH              | WHAT CAN GO WRONG              | EXCEPTION CLASS
  -----------------------------|--------------------------------|------------------
  inquirer.prompt (title)      | User presses Ctrl+C            | ExitPromptError
  inquirer.prompt (scheduledAt)| Invalid date string entered     | (validation handles)
  inquirer.prompt (speakers)   | Non-numeric input               | (validation handles)
  meetingService.create()      | Empty title after trim          | Error('Title is required')
  meetingService.create()      | LowDB write fails (disk full)  | Error (from lowdb)
  meetingService.create()      | LowDB file locked/corrupted    | Error (from lowdb)

  EXCEPTION CLASS              | RESCUED?  | RESCUE ACTION              | USER SEES
  -----------------------------|-----------|----------------------------|------------------
  ExitPromptError (Ctrl+C)     | Y (catch) | Return to main menu        | Menu re-displays
  Error('Title is required')   | Y (valid) | Re-prompt                  | "Title is required"
  Error (lowdb disk full)      | N ← GAP   | —                          | Unhandled in command
  Error (lowdb corrupted)      | N ← GAP   | —                          | Unhandled in command
```

### Jobs Hub Command

```
  METHOD/CODEPATH              | WHAT CAN GO WRONG              | EXCEPTION CLASS
  -----------------------------|--------------------------------|------------------
  jobManager.listJobs()        | LowDB read fails               | Error (from lowdb)
  jobManager.getJobDetails()   | Job not found (deleted between  | Returns undefined
                               |   list render and detail view)  |
  jobManager.retryJob()        | Job not in FAILED/ABANDONED     | Error('Only FAILED...')
  jobManager.cancelJob()       | Job not in WAITING_UPLOAD       | Error('Only WAITING...')
  noteService.regenerateNote() | Summary file missing on disk    | Error (readFile fails)
  noteService.regenerateNote() | Vault path doesn't exist        | Error (writeFile fails)
  fs.readFile (summary)        | File deleted between check      | Error (ENOENT)
  inquirer.prompt (job select) | User presses Ctrl+C             | ExitPromptError

  EXCEPTION CLASS              | RESCUED?  | RESCUE ACTION              | USER SEES
  -----------------------------|-----------|----------------------------|------------------
  Error (lowdb read)           | N ← GAP   | —                          | Crash to menu catch
  undefined (job not found)    | PARTIAL   | Should show "Job not found"| Depends on impl
  Error('Only FAILED...')      | N ← GAP   | —                          | Crash to menu catch
  Error('Only WAITING...')     | N ← GAP   | —                          | Crash to menu catch
  Error (summary ENOENT)       | N ← GAP   | —                          | Crash to menu catch
  Error (vault write)          | N ← GAP   | —                          | Crash to menu catch
  ExitPromptError (Ctrl+C)     | Y (catch) | Return to main menu        | Menu re-displays
```

### Critical Gaps Identified

**Issue 5: Jobs Hub action errors are unhandled**

The `jobManager.retryJob()` and `cancelJob()` throw specific errors for invalid state transitions. The `noteService.regenerateNote()` can fail if files are missing. None of these are caught in the Jobs Hub command.

**5A.** Wrap each action in a try/catch within the Jobs Hub command. Display a user-friendly chalk.red message for each known error type. Effort: S. Risk: Low. **Recommended** — explicit error handling per action.

**5B.** Rely on the outer `catch` in `mainMenuLoop`'s switch statement. Effort: XS. Risk: Med — user gets a generic "unexpected error" and is kicked back to the menu instead of staying in the Jobs Hub loop.

**→ 5A is the obvious fix. Each action in the Jobs Hub sub-menu should have its own try/catch with a friendly message. I'll note this as a required plan amendment. Moving on.**

**Issue 6: Ctrl+C handling in prompt flows**

inquirer v5+ throws `ExitPromptError` when the user presses Ctrl+C. The current `mainMenuLoop` has a generic `catch(error)` that prints the error. This means Ctrl+C during Create Meeting or Jobs Hub will print an ugly error object.

**6A.** Add an `ExitPromptError` check in the catch block: `if (error instanceof ExitPromptError) continue;` — silently returns to menu. Effort: XS. Risk: Low. **Recommended.**

**6B.** Each command catches `ExitPromptError` internally and returns gracefully. Effort: S. Risk: Low but more code.

**→ 6A is simpler and handles all commands uniformly. Moving on.**

---

## Section 3: Security & Threat Model

This plan is **entirely client-side CLI** with no new network surfaces, no new API endpoints, no new authentication flows, and no new data classification changes.

**Attack surface expansion:** None. The new commands only interact with local LowDB (JSON file) and local filesystem.

**Input validation:**
- Meeting title: validated as non-empty (already in `MeetingService.create()`)
- Attendees: comma-separated string — no injection risk (stored as string array in JSON)
- Speaker counts: validated as numbers by inquirer filter
- Date string: parsed by `new Date()` — invalid dates default to now

**No new secrets, no new dependencies, no new PII handling.**

**Assessment: OK — no security issues introduced.**

---

## Section 4: Data Flow & Interaction Edge Cases

### Create Meeting Data Flow

```
  USER INPUT ──► INQUIRER ──► CreateMeetingInput ──► MeetingService.create() ──► LowDB.addMeeting()
    │               │              │                       │                         │
    ▼               ▼              ▼                       ▼                         ▼
  [Ctrl+C?]    [empty title?]  [invalid date?]      [title empty?]            [disk full?]
  [empty?]     [non-numeric    [defaults to now]     [throws Error]            [write fails]
               speakers?]
```

### Jobs Hub Data Flow

```
  jobManager.listJobs() ──► tableFormatter() ──► console.log ──► inquirer (pick job)
       │                         │                                     │
       ▼                         ▼                                     ▼
  [empty array?]           [long filenames?]                    [job deleted between
   → friendly msg]          → truncated]                         list and detail?]
                                                                      │
                                                                      ▼
                                                               jobManager.getJobDetails()
                                                                      │
                                                                      ▼
                                                               [undefined? → "not found"]
```

### Interaction Edge Cases

```
  INTERACTION                | EDGE CASE                    | HANDLED? | HOW?
  ---------------------------|------------------------------|----------|------------------
  Create Meeting prompt      | Ctrl+C mid-prompt            | PARTIAL  | Caught by outer catch (Issue 6)
  Create Meeting prompt      | Empty title + Enter           | YES      | inquirer validate
  Create Meeting prompt      | Date "abc" entered            | PARTIAL  | Needs validation ← GAP
  Create Meeting prompt      | minSpeakers > maxSpeakers     | NO ← GAP| Not validated
  Jobs Hub table             | Zero jobs                     | YES      | Friendly empty message
  Jobs Hub table             | 500+ jobs                     | NO ← GAP| No pagination (noted as out of scope)
  Jobs Hub detail            | Job status changed since list | PARTIAL  | getJobDetails re-reads from DB
  Jobs Hub retry action      | Job already retried by sync   | YES      | retryJob checks status
  Jobs Hub cancel action     | Job already uploading         | YES      | cancelJob checks status
  Jobs Hub regenerate note   | Summary file deleted          | NO ← GAP| readFile throws (Issue 5)
  Chain-to-record            | User says "yes" but no audio  | YES      | recordCommand handles its own errors
                             | device configured              |          |
```

### Issues Found

**Issue 7: Date input validation**

The PRD says "ScheduledAt accepts a date string or defaults to now on Enter." But what if the user types "banana"? `new Date("banana")` returns `Invalid Date`. The `MeetingService.create()` stores whatever string is passed.

**7A.** Add inquirer `validate` that checks `!input || !isNaN(Date.parse(input))`. Effort: XS. Risk: Low. **Recommended.**

**7B.** Accept any string — it's the user's problem. Effort: 0. Risk: Low (data quality issue, not a crash).

**→ 7A is trivial and prevents garbage data. Moving on.**

**Issue 8: minSpeakers > maxSpeakers validation**

The existing `promptForJobConfig` in `ui/prompts.ts` doesn't validate this either. But the new `promptForMeetingDetails` should.

**8A.** Add cross-field validation: if both are provided and min > max, show error. Effort: XS. Risk: Low. **Recommended.**

**8B.** Skip — the server handles it. Effort: 0. Risk: Low.

**→ 8A is trivial. Moving on.**

---

## Section 5: Code Quality Review

### Code Organization

The PRD proposes 4 new modules:
1. `commands/createMeeting.ts` — Create Meeting command
2. `commands/jobsHub.ts` — Jobs Hub command
3. `ui/tableFormatter.ts` — Pure table formatting function
4. `ui/prompts.ts` (modified) — New `promptForMeetingDetails` function

This fits the existing pattern perfectly:
- Commands go in `commands/`
- UI helpers go in `ui/`
- Pure functions are separated from side-effectful code

**Assessment: OK — clean organization.**

### DRY Analysis

**Issue 9: Prompt duplication between `promptForJobConfig` and `promptForMeetingDetails`**

The existing `promptForJobConfig` already prompts for language, template, minSpeakers, maxSpeakers. The new `promptForMeetingDetails` will prompt for the same fields plus title, scheduledAt, and attendees.

**9A.** Extract shared prompt questions (language, template, speakers) into reusable question arrays. `promptForMeetingDetails` composes them with the meeting-specific questions. Effort: S. Risk: Low. **Recommended** — DRY is important per engineering preferences.

**9B.** Duplicate the prompts. They're slightly different (meeting uses `CreateMeetingInput` shape, job uses `UploadOptions` shape). Effort: XS. Risk: Low but DRY violation.

**→ 9A is worth doing. The shared questions are identical. Moving on.**

### Naming Quality

- `createMeetingCommand` — clear ✅
- `jobsHubCommand` — clear ✅
- `formatJobsTable` — clear ✅
- `promptForMeetingDetails` — clear ✅

### Over/Under-Engineering Check

- **Table formatter as a separate module:** Correct — it's a pure function, easy to test independently. Not over-engineered.
- **Singleton factory in mainMenuLoop:** Correct — simplest approach, no DI container needed. Not over-engineered.
- **Chain-to-record boolean return:** Correct — keeps commands decoupled. Not over-engineered.

**Assessment: OK — well-calibrated engineering level.**

---

## Section 6: Test Review

### New Things Diagram

```
  NEW UX FLOWS:
    1. Create Meeting prompt flow (title → date → language → template → attendees → speakers → confirm → chain?)
    2. Jobs Hub list view (table render → pick job or back)
    3. Jobs Hub detail view (view summary → view transcript → retry → cancel → regenerate → back)
    4. Chain-to-record flow (create meeting → yes → recordCommand with meetingService)

  NEW DATA FLOWS:
    1. User input → CreateMeetingInput → MeetingService.create() → LowDB
    2. LowDB → JobManager.listJobs() → tableFormatter → console
    3. LowDB + filesystem → JobManager.getJobDetails() → console
    4. User action → JobManager.retryJob/cancelJob → LowDB
    5. User action → NoteService.regenerateNote() → filesystem

  NEW CODEPATHS:
    1. createMeetingCommand (prompt → create → confirm → chain decision)
    2. jobsHubCommand (list loop → detail sub-menu → action dispatch)
    3. formatJobsTable (pure: jobs[] → string)
    4. promptForMeetingDetails (prompt sequence → CreateMeetingInput)
    5. Singleton factory in mainMenuLoop (service instantiation)
    6. Sync refactor (plain function accepting services)

  NEW ERROR/RESCUE PATHS:
    1. Create Meeting: empty title → re-prompt
    2. Create Meeting: invalid date → re-prompt (Issue 7)
    3. Jobs Hub: empty job list → friendly message
    4. Jobs Hub: retry invalid state → error message (Issue 5)
    5. Jobs Hub: cancel invalid state → error message (Issue 5)
    6. Jobs Hub: regenerate with missing files → error message (Issue 5)
    7. All commands: Ctrl+C → graceful return (Issue 6)
```

### Test Coverage Assessment

The PRD's test plan covers:
- ✅ Create Meeting command (mock IMeetingService + inquirer)
- ✅ Jobs Hub command (mock JobManager + NoteService + inquirer)
- ✅ Table formatter (pure function tests)
- ✅ Service wiring (singleton verification)

**Issue 10: Missing test for the chain-to-record integration**

The PRD tests `createMeetingCommand` return value and tests `recordCommand` separately. But there's no test that verifies the *integration* in `mainMenuLoop` — that when `createMeetingCommand` returns `true`, `recordCommand` is actually called with `meetingService`.

**10A.** Add an integration test in `tests/commands/` that mocks both commands and verifies the chaining logic in the menu switch. Effort: S. Risk: Low. **Recommended.**

**10B.** Skip — the unit tests for each command are sufficient. Effort: 0. Risk: Low (the wiring is simple enough).

**→ 10A is worth doing for confidence. Moving on.**

### Hostile QA Test

The test that would break this: **"Create a meeting, chain to record, Ctrl+C during recording, then go to Jobs Hub — does the meeting show as CREATED (not RECORDING)?"** This tests the state machine integrity across command boundaries.

### Chaos Test

**"Delete the client-db.json file while the Jobs Hub is rendering."** The LowDB instance holds data in memory, so the table would render fine. But the next write would recreate the file with only the in-memory data. This is a pre-existing LowDB behavior, not introduced by this plan.

---

## Section 7: Performance Review

**N+1 queries:** Not applicable — LowDB reads the entire JSON file into memory. No query optimization needed.

**Memory usage:** `jobManager.listJobs()` returns all jobs. For a typical user with <100 jobs, this is negligible. The PRD correctly notes pagination is out of scope.

**Table rendering:** The chalk table formatter processes the full job array. For 100 jobs, this is <1ms. For 10,000 jobs, it might take ~50ms — still fine for a CLI.

**LowDB write frequency:** Each `MeetingService.create()` call triggers one `db.write()`. This writes the entire JSON file. For a single meeting creation, this is fine. No batching needed.

**Assessment: OK — no performance issues for the expected scale.**

---

## Section 8: Observability & Debuggability Review

**Issue 11: No logging in new commands**

The existing codebase uses `console.log` for user-facing output and `console.error` for errors. The new commands should follow this pattern, but the PRD doesn't explicitly mention logging for:
- Meeting creation success (the PRD mentions a "confirmation message" — good)
- Jobs Hub actions (retry success, cancel success, regenerate success)
- Error cases (the PRD doesn't specify what the user sees on failure)

**11A.** Add explicit console.log messages for every action outcome: `✅ Job retried successfully`, `🗑️ Job cancelled`, `📝 Note regenerated with template: X`, `❌ Failed to retry: [reason]`. Effort: XS. Risk: Low. **Recommended.**

**→ This is obvious. Moving on.**

**Debuggability:** If a user reports "I created a meeting but it doesn't show in the recording picker," the debug path is:
1. Check `client-db.json` for the meeting record
2. Check the meeting's `status` field (should be `CREATED`)
3. Check if `recordCommand` received `meetingService` (singleton wiring)

This is straightforward. No additional observability needed.

---

## Section 9: Deployment & Rollout Review

**Migration safety:** No database migration needed. The `meetings` array already exists in the LowDB schema (added in a previous commit). The `init()` method in `db.ts` already handles the case where `meetings` is missing: `if (!this.db.data.meetings) { this.db.data.meetings = []; }`.

**Feature flags:** Not needed — this is a CLI tool, not a web service. The user updates by pulling the latest code.

**Rollback plan:** `git revert <commit>`. No data migration to reverse.

**Deploy-time risk:** Zero — this is a local CLI tool. No server deployment.

**Assessment: OK — no deployment risks.**

---

## Section 10: Long-Term Trajectory Review

**Technical debt introduced:** Minimal.
- The chalk table formatter is custom code that could be replaced by a library later. This is acceptable debt.
- The singleton factory in `mainMenuLoop` is simple but will grow as more services are added. This is acceptable for now.

**Path dependency:** The singleton factory pattern is a stepping stone toward proper DI. It doesn't block future refactoring to a DI container if needed.

**Knowledge concentration:** The PRD is thorough enough that a new engineer could implement it. The code follows existing patterns.

**Reversibility:** 5/5 — easily reversible, no data changes.

**Ecosystem fit:** Aligns with the existing architecture (interface-first, dependency injection via constructor, pure functions for testability).

**The 1-year question:** A new engineer reading this code in 12 months would understand it immediately. The command structure mirrors the menu structure. The singleton factory is explicit.

### What Comes After This Ships?

Phase 2 candidates (natural next steps):
1. **Meeting editing/deletion** — CRUD is half-done (create + read exist, update/delete missing from CLI)
2. **Real-time job polling** — background daemon that auto-syncs
3. **Meeting list view** — dedicated menu item to browse all meetings
4. **Job deletion from CLI** — the server API exists (PRD #6), just needs CLI wiring

The architecture supports all of these without changes.

---

## Section 11: Design & UX Review (CLI UI)

### Information Architecture — What the User Sees

**Create Meeting flow:**
```
  1. "Enter Meeting Title:" ──────────────── (required, validated)
  2. "Scheduled date (Enter for now):" ───── (optional, defaults to now)
  3. "Select language:" ──────────────────── (list: auto/en/pt/es)
  4. "Select AI template:" ───────────────── (list: meeting/training/summary)
  5. "Attendees (comma-separated):" ──────── (optional)
  6. "Min speakers:" ─────────────────────── (optional number)
  7. "Max speakers:" ─────────────────────── (optional number)
  8. ✅ Confirmation box with all details
  9. "Start recording now? (Y/n)" ────────── (chain decision)
```

**Jobs Hub flow:**
```
  ┌─────────────────────────────────────────────────────────┐
  │ ID       │ Filename                  │ Status    │ Date │
  ├──────────┼───────────────────────────┼───────────┼──────┤
  │ a1b2c3d4 │ 2026-04-03_Team_Standup.. │ ✅ DONE   │ 4/3  │
  │ e5f6g7h8 │ 2026-04-02_Client_Call... │ ⏳ PROC   │ 4/2  │
  │ i9j0k1l2 │ 2026-04-01_Training...... │ ❌ FAIL   │ 4/1  │
  └──────────┴───────────────────────────┴───────────┴──────┘
  
  ? Select a job: (use arrow keys)
  > a1b2c3d4 — Team_Standup (✅ COMPLETED)
    e5f6g7h8 — Client_Call (⏳ PROCESSING)
    i9j0k1l2 — Training (❌ FAILED)
    ← Back to menu
```

**Job Detail sub-menu (COMPLETED job):**
```
  ? What would you like to do with "Team_Standup"?
  > 📄 View Summary
    📝 View Transcript
    🔄 Regenerate Note (different template)
    ← Back to jobs list
```

**Job Detail sub-menu (FAILED job):**
```
  ? What would you like to do with "Training"?
  > 🔁 Retry
    ← Back to jobs list
```

### Interaction State Coverage

```
  FEATURE          | LOADING | EMPTY        | ERROR         | SUCCESS       | PARTIAL
  -----------------|---------|--------------|---------------|---------------|--------
  Create Meeting   | N/A     | N/A          | "Title req'd" | ✅ Confirm box | N/A
  Jobs Hub list    | N/A     | "No jobs yet"| DB read fail  | Table renders | N/A
  Jobs Hub detail  | N/A     | "Not found"  | Action fails  | Action msg    | N/A
  Jobs Hub retry   | N/A     | N/A          | "Only FAILED" | "✅ Retried"  | N/A
  Jobs Hub cancel  | N/A     | N/A          | "Only WAIT"   | "🗑️ Cancelled"| N/A
  Jobs Hub regen   | N/A     | N/A          | File missing  | "📝 Regen'd" | N/A
```

### User Journey — Emotional Arc

```
  Create Meeting:
  "I want to set up my meeting" → guided prompts → confirmation → "nice, it's ready"
  → "Start recording now?" → seamless transition → "wow, that was smooth"

  Jobs Hub:
  "What happened to my recordings?" → clear table → pick one → see details
  → "oh, this one failed" → retry → "✅ retried" → back to list → "I'm in control"
```

### Edge Case Paranoia

**Issue 12: What if the meeting title is 200 characters?**

The confirmation box and the Jobs Hub table both display titles. Long titles could break formatting.

**12A.** Truncate title display to ~50 chars in confirmation and table. Store full title in DB. Effort: XS. Risk: Low. **Recommended.**

**12B.** No truncation — let it wrap. Effort: 0. Risk: Low (ugly but functional).

**→ 12A is trivial. The PRD already mentions filename truncation for the table but not title truncation for the confirmation. Moving on.**

---

## Cherry-Pick Ceremony (SELECTIVE EXPANSION)

The baseline scope is solid. Here are expansion opportunities I spotted. Each is presented individually — you decide.

### Expansion A: "Quick Create" — Minimal Meeting Creation

Instead of always running the full 7-prompt flow, offer a "Quick Create" that only asks for title and uses all defaults. Power users who just want to label a recording don't need to pick language/template every time.

- **Effort:** S (~15 min with AI)
- **Risk:** Low
- **Options:** A) Add to this plan's scope | B) Defer to TODOS.md | C) Skip

### Expansion B: Job Status Counts in Menu

Show job status counts directly in the main menu: `Jobs 📊 (3 pending, 1 failed)` — so users know at a glance if they need to check the Jobs Hub.

- **Effort:** S (~15 min with AI)
- **Risk:** Low (requires `jobManager.listJobs()` call before rendering menu, which means services must be instantiated before the menu — already planned)
- **Options:** A) Add to this plan's scope | B) Defer to TODOS.md | C) Skip

### Expansion C: Job Sorting/Filtering in Jobs Hub

Let users filter the jobs table by status (e.g., "Show only FAILED jobs") or sort by date/status.

- **Effort:** M (~30 min with AI)
- **Risk:** Low
- **Options:** A) Add to this plan's scope | B) Defer to TODOS.md | C) Skip

### Expansion D: Meeting-to-Job Linkage Display

In the Jobs Hub detail view, if a job is linked to a meeting, show the meeting title and configuration. This gives context to what template/language was used.

- **Effort:** S (~15 min with AI)
- **Risk:** Low
- **Options:** A) Add to this plan's scope | B) Defer to TODOS.md | C) Skip

### Expansion E: Confirmation Before Destructive Actions

Before retry/cancel in the Jobs Hub, ask "Are you sure?" This prevents accidental actions.

- **Effort:** XS (~5 min with AI)
- **Risk:** Low
- **Options:** A) Add to this plan's scope | B) Defer to TODOS.md | C) Skip

---

## Required Outputs

### "NOT in scope" section

| Item | Rationale |
|---|---|
| Meeting editing/deletion from CLI | PRD explicitly defers |
| Real-time job status polling | PRD explicitly defers |
| Pagination for jobs list | PRD explicitly defers |
| Meeting list view menu item | PRD explicitly defers |
| Server-side changes | PRD explicitly defers |
| New npm dependencies | PRD explicitly defers |

### "What already exists" section

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

### "Dream state delta" section

After this plan ships, we're at **"complete CLI surface area with singleton services."** The delta to the 12-month ideal is:
- Missing: real-time polling, background sync daemon, meeting calendar integration, team features
- Foundation laid: singleton factory enables background services, Jobs Hub enables future dashboard

### Error & Rescue Registry

```
  METHOD                        | EXCEPTION              | RESCUED? | RESCUE ACTION           | USER SEES
  ------------------------------|------------------------|----------|-------------------------|------------------
  inquirer.prompt (any)         | ExitPromptError        | Y*       | Return to menu          | Menu re-displays
  meetingService.create()       | Error('Title required')| Y        | Re-prompt (validate)    | "Title is required"
  meetingService.create()       | Error (lowdb)          | Y*       | Caught by outer catch   | "Unexpected error"
  jobManager.listJobs()         | Error (lowdb)          | Y*       | Caught by outer catch   | "Unexpected error"
  jobManager.retryJob()         | Error('Only FAILED')   | Y**      | Show friendly message   | "❌ Cannot retry..."
  jobManager.cancelJob()        | Error('Only WAITING')  | Y**      | Show friendly message   | "❌ Cannot cancel..."
  noteService.regenerateNote()  | Error (file missing)   | Y**      | Show friendly message   | "❌ Summary file..."
  
  * = requires Issue 6 fix (ExitPromptError handling)
  ** = requires Issue 5 fix (per-action try/catch in Jobs Hub)
```

### Failure Modes Registry

```
  CODEPATH              | FAILURE MODE          | RESCUED? | TEST? | USER SEES?      | LOGGED?
  ----------------------|-----------------------|----------|-------|-----------------|--------
  Create Meeting        | Empty title           | Y        | Y     | Re-prompt       | N
  Create Meeting        | Invalid date          | N*       | N*    | Garbage in DB   | N      ← WARNING (Issue 7)
  Create Meeting        | min > max speakers    | N*       | N*    | Garbage in DB   | N      ← WARNING (Issue 8)
  Create Meeting        | Ctrl+C                | Y*       | N     | Menu            | N      ← OK (Issue 6)
  Create Meeting        | LowDB write fail      | Y        | N     | "Unexpected"    | Y
  Jobs Hub              | Empty list            | Y        | Y     | Friendly msg    | N
  Jobs Hub              | Retry invalid state   | Y*       | Y*    | Friendly msg    | N      ← OK (Issue 5)
  Jobs Hub              | Cancel invalid state  | Y*       | Y*    | Friendly msg    | N      ← OK (Issue 5)
  Jobs Hub              | Regen file missing    | Y*       | Y*    | Friendly msg    | N      ← OK (Issue 5)
  Jobs Hub              | Ctrl+C                | Y*       | N     | Menu            | N      ← OK (Issue 6)
  Jobs Hub              | Job deleted mid-view  | Y        | Y     | "Not found"     | N
  Singleton factory     | Service init fails    | N        | N     | Crash           | Y      ← WARNING
  
  * = requires plan amendment per issues noted above
```

**CRITICAL GAPS:** None (all gaps have identified fixes above).
**WARNINGS:** 3 (Issues 7, 8, and singleton init failure — all low severity).

### TODOS.md Updates

These are items to track regardless of cherry-pick decisions:

1. **TODO: Add pagination to Jobs Hub when job count exceeds terminal height** — deferred per PRD
2. **TODO: Add meeting editing/deletion CLI commands** — deferred per PRD
3. **TODO: Add real-time job status polling (background sync daemon)** — deferred per PRD
4. **TODO: Add meeting list view as dedicated menu item** — deferred per PRD

### Diagrams Produced

1. ✅ System architecture (Section 1)
2. ✅ Data flow — Create Meeting (Section 4)
3. ✅ Data flow — Jobs Hub (Section 4)
4. ✅ Error flow (Section 2)
5. ✅ User flow — Create Meeting (Section 11)
6. ✅ User flow — Jobs Hub (Section 11)

---

## Completion Summary

```
  +=========================================================================+
  |            MEGA PLAN REVIEW — COMPLETION SUMMARY                        |
  +=========================================================================+
  | Mode selected        | SELECTIVE EXPANSION (Approach A)                 |
  | System Audit         | Clean codebase, no TODOs, sync.ts anti-pattern  |
  |                      | confirmed, placeholders confirmed                |
  | Step 0               | Right problem, all backend exists, Approach A    |
  |                      | approved, SELECTIVE EXPANSION confirmed          |
  | Section 1  (Arch)    | 2 issues (sync dual-entry 3A, chain-to-record 4)|
  | Section 2  (Errors)  | 8 error paths mapped, 2 GAP patterns (5, 6)     |
  | Section 3  (Security)| 0 issues — pure client-side CLI                  |
  | Section 4  (Data/UX) | 10 edge cases mapped, 2 unhandled (7, 8)        |
  | Section 5  (Quality) | 1 issue (DRY prompt reuse 9)                    |
  | Section 6  (Tests)   | Diagram produced, 1 gap (chain integration 10)  |
  | Section 7  (Perf)    | 0 issues                                        |
  | Section 8  (Observ)  | 1 gap (action outcome logging 11)               |
  | Section 9  (Deploy)  | 0 risks                                         |
  | Section 10 (Future)  | Reversibility: 5/5, debt items: 1 (table fmt)   |
  | Section 11 (Design)  | 1 issue (title truncation 12)                   |
  +-------------------------------------------------------------------------+
  | NOT in scope         | written (6 items)                                |
  | What already exists  | written (8 items — all reused)                   |
  | Dream state delta    | written                                          |
  | Error/rescue registry| 6 methods, 0 CRITICAL GAPS (all have fixes)     |
  | Failure modes        | 11 total, 0 CRITICAL GAPS, 3 WARNINGS           |
  | TODOS.md updates     | 4 items proposed                                |
  | Scope proposals      | 5 proposed (cherry-pick ceremony above)          |
  | Diagrams produced    | 6 (arch, 2x data flow, error, 2x user flow)     |
  | Stale diagrams found | 0                                                |
  | Unresolved decisions | 1 (Issue 4: chain-to-record auto-select)         |
  +=========================================================================+
```

