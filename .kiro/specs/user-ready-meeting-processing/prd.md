# PRD: User-Ready Two-Machine Meeting Processing
## Relevant Files

- `AGENTS.md` - repository instructions and pointers to issue, label, and domain documentation
- `CONTEXT.md` - canonical Job, Recording, Transcript, Summary, Summary Provider, and Publication language
- `docs/adr/0001-split-transcription-and-summarization.md` - accepted machine-ownership and completion decision
- `docs/PRODUCT.md` - product purpose, invariants, and active-scope pointer
- `docs/ARCHITECTURE.md` - system ownership, interfaces, and verification shape
- `docs/CONVENTIONS.md` - module, testing, security, and commit conventions
- `plans/user-ready-system.md` - baseline audit and ordered implementation roadmap
- `README.md` - current two-machine setup, bridge, CLI, and operational claims
- `package.json` - workspace build and test commands
- `packages/shared/src/index.ts` - current shared Job contracts and processing stages
- `packages/client/src/domain/` - current client Job, Meeting, configuration, and port contracts
- `packages/client/src/services/` - recording ingestion, persistence, workflow, Summary, and Publication behavior
- `packages/client/src/commands/` - recording and Jobs Hub user workflows
- `packages/client/tests/` - client behavior and command test prior art
- `packages/server/src/routes/` - current authenticated upload and Job HTTP interface
- `packages/server/src/services/` - queue, transcription, artifacts, recovery, and existing server Summary behavior
- `packages/server/tests/` - server route and processing test prior art

## Problem Statement

The current system contains recording, upload, transcription, summarization, and
Jobs Hub code, but it does not provide a dependable user workflow across the
notebook and home PC. The production build fails, real processing paths disagree
about artifact locations, meeting linkage is incomplete, the Google bridge is
manual, and the current server performs Gemini summarization instead of returning
a Transcript for local summarization.

The user needs to leave the home PC running unattended as a Whisper transcription
server, record meetings on the notebook, and trust that each Job will progress,
recover, and remain manageable without manually coordinating the two machines.

## Solution

The notebook records a Meeting and automatically creates a durable Job. A
background workflow runner uploads the Recording through a supervised SSH bridge
hosted on Google Cloud. The home PC extracts audio and produces a Transcript with
WhisperX. The notebook downloads the Transcript and produces a Summary with one
configured local Summary Provider: Kiro, Claude, or Codex.

The Jobs Hub presents one coherent lifecycle across both machines and supports
operation-specific retry, cancellation, provider switching, and artifact
management. Publication to Obsidian remains an automatic pipeline operation with
its own visible and retryable outcome. A Job is complete when its Transcript and
Summary exist; Publication failure does not invalidate it.

The system starts with Windows, survives either machine restarting, secures all
traffic through the Google bridge, and provides health diagnostics and retention
controls suitable for unattended personal use.

## User Stories

1. As the user, I want to record microphone and system audio on my notebook, so that meetings are captured where they happen.
2. As the user, I want a Recording to retain its Meeting relationship, so that its title and processing choices are never requested again.
3. As the user, I want recording completion to be detected from the recorder event, so that processing never starts against an incomplete file.
4. As the user, I want a Job to be created automatically after recording, so that manual Sync is not part of the normal workflow.
5. As the user, I want the notebook worker to resume pending Jobs after login or restart, so that interrupted work continues.
6. As the user, I want to run one manual processing cycle, so that I can diagnose or recover work without waiting for the worker.
7. As the user, I want recordings uploaded through the Google bridge, so that I do not expose my home network to the public internet.
8. As the user, I want uploads authenticated, so that possession of the bridge connection alone cannot submit or read Jobs.
9. As the user, I want duplicate upload attempts to return the existing Job, so that network retries do not repeat expensive work.
10. As the user, I want the original recording time preserved, so that delayed uploads do not change Meeting history.
11. As the user, I want upload progress and failures visible, so that slow or disconnected transfers are understandable.
12. As the user, I want the home PC to queue transcription work, so that recordings are processed one at a time within GPU limits.
13. As the user, I want the server to expose extraction and transcription progress, so that I know whether a long Job is advancing.
14. As the user, I want the server to return a Transcript without summarizing it, so that Summary Provider credentials remain on my notebook.
15. As the user, I want server work to resume after a restart, so that a reboot does not lose queued or active Jobs.
16. As the user, I want failed transcription work retried from the last verified artifact, so that completed expensive steps are not repeated.
17. As the user, I want an active transcription cancelled, so that mistaken or unwanted work releases server resources.
18. As the user, I want the notebook to download a completed Transcript automatically, so that no manual transfer is required.
19. As the user, I want Transcript downloads written atomically, so that partial files are never treated as complete.
20. As the user, I want to select a default Summary Provider during setup, so that normal Jobs require no provider prompt.
21. As the user, I want to override the Summary Provider for a Meeting, so that I can choose the most suitable local tool.
22. As the user, I want Kiro to produce a Summary programmatically, so that I can use my local Kiro access.
23. As the user, I want Claude to produce a Summary programmatically, so that I can use my local Claude access.
24. As the user, I want Codex to produce a Summary programmatically, so that I can use my local Codex access.
25. As the user, I want provider availability checked during setup, so that missing executables or authentication fail before a Meeting.
26. As the user, I want provider errors classified and visible, so that I can distinguish authentication, timeout, permission, and model failures.
27. As the user, I want to explicitly switch provider after a failure, so that a Transcript is never sent to another provider automatically.
28. As the user, I want Summary output written atomically, so that incomplete provider output cannot complete a Job.
29. As the user, I want a Job complete when its Transcript and Summary exist, so that optional output integrations cannot invalidate expensive work.
30. As the user, I want Obsidian Publication attempted automatically, so that completed Meetings appear in my vault without another command.
31. As the user, I want Publication status shown separately, so that a vault failure does not look like transcription or summarization failure.
32. As the user, I want failed Publication retried, so that temporary vault problems recover without repeating the Job.
33. As the user, I want to regenerate a Publication with another template, so that I can change note presentation without resummarizing.
34. As the user, I want the Jobs Hub to show the current operation, elapsed time, attempts, provider, and last error, so that every Job is understandable.
35. As the user, I want the Jobs Hub to update while open, so that I can watch progress without repeatedly running Sync.
36. As the user, I want Jobs paginated and filterable, so that history remains usable as recordings accumulate.
37. As the user, I want retry to resume the failed operation, so that upload, transcription, Summary creation, and Publication have correct recovery behavior.
38. As the user, I want cancellation routed to the notebook and server as needed, so that the displayed result matches actual work.
39. As the user, I want local and remote deletion choices to be explicit, so that deleting one copy does not unexpectedly delete another.
40. As the user, I want completed server uploads and extracted audio removed after an acknowledged download and seven-day grace period, so that private media does not accumulate.
41. As the user, I want notebook Recordings retained for 30 days by default, so that I have a recovery window without indefinite storage growth.
42. As the user, I want Transcripts, Summaries, and Publications retained indefinitely by default, so that processed knowledge remains available.
43. As the user, I want the home server and reverse tunnel to start with Windows, so that the system works while I am away.
44. As the user, I want the notebook tunnel and worker to start at login, so that recording and processing require no infrastructure commands.
45. As the user, I want tunnel failures supervised and restarted, so that temporary connectivity problems recover automatically.
46. As the user, I want a doctor command to check recording tools, provider access, tunnel connectivity, server readiness, disk space, and authentication, so that setup problems are actionable.
47. As the user, I want server readiness to verify FFmpeg, Python, WhisperX, storage, database, queue, and GPU visibility, so that an online process is not mistaken for a usable server.
48. As the user, I want logs rotated and redacted, so that unattended operation does not exhaust disk or expose Transcript content and credentials.
49. As the user, I want durable data backed up before schema migration, so that upgrades cannot silently destroy Job history.
50. As the user, I want a documented upgrade and rollback procedure, so that I can maintain both machines safely.

## Implementation Decisions

- The accepted architecture is recorded in ADR-0001: the home PC owns upload
  storage, extraction, and transcription; the notebook owns Summary creation and
  Publication.
- The client workflow runner is the authority for the end-to-end Job lifecycle.
  It exposes enqueue, list, inspect, retry, cancel, one-cycle, and continuous-run
  behavior behind one interface used by the CLI and tests.
- The server exposes an authenticated transcription-Job interface for creation,
  status, Transcript download, retry, cancellation, and readiness.
- The durable client-visible lifecycle is `RECORDED`, `UPLOADING`,
  `SERVER_QUEUED`, `EXTRACTING`, `TRANSCRIBING`, `TRANSCRIPT_READY`,
  `DOWNLOADING`, `SUMMARIZING`, and `COMPLETED`, with `FAILED` and `CANCELLED`
  terminal outcomes.
- Publication has an independent `PENDING`, `PUBLISHING`, `PUBLISHED`, or
  `FAILED` outcome. It runs automatically after Summary creation but does not
  gate Job completion.
- A Job records operation timestamps, Meeting and server identifiers, artifact
  locations, selected Summary Provider and templates, attempts, structured
  failure details, Publication outcome, and last reconciliation time.
- Retry resumes the failed operation and reuses verified artifacts. A retry must
  not repeat upload, transcription, or Summary creation unnecessarily.
- Upload creation is idempotent by Job identifier and preserves the Recording's
  original timestamp and validated processing options.
- Server persistence and artifact paths have one owner. Queue work, routes,
  recovery, cancellation, and retention use the same persisted records and path
  conventions.
- The server finishes at Transcript readiness and has no Summary Provider
  credentials or Summary stage.
- Summary Providers implement one local interface for availability checks and
  Summary creation. Kiro, Claude, and Codex are separate command adapters.
- Setup selects a default Summary Provider; a Meeting may override it.
- Provider fallback is never automatic. Switching providers after failure is an
  explicit user action.
- Provider processes are non-interactive, cancellable, time-bounded, and
  redacted. Transcript content is passed through a protected input mechanism,
  not shell arguments or logs.
- Recording completion awaits the recorder's completed or error event. The
  Recording-to-Meeting relationship is persisted before the Job enters the
  background workflow.
- Manual Sync is replaced by a continuously running notebook worker. A one-cycle
  command remains for diagnostics and recovery.
- Writes of downloaded Transcripts and generated Summaries are atomic, and state
  advances only after artifact verification.
- The Jobs Hub reads through the workflow runner and routes operation-specific
  retry and cancellation rather than mutating local display state alone.
- The Google Cloud VM remains an SSH jump host. The API is not exposed publicly
  and the home router requires no inbound port.
- SSH uses a dedicated account, key-only authentication, pinned host keys,
  loopback-only forwarding, forward-failure detection, and keepalives.
- Server authentication is mandatory at startup. Missing credentials are a
  startup error rather than an unauthenticated mode.
- Home server and reverse tunnel start with Windows. Notebook worker and local
  tunnel start at user login.
- Server uploads and extracted audio become eligible for deletion seven days
  after acknowledged Transcript download. Notebook Recordings default to 30-day
  retention. Transcripts, Summaries, and Publications default to indefinite
  retention.
- Existing local data gains an explicit schema version and backup-before-migrate
  behavior.
- The clean production build, dependency security baseline, and a real
  processing smoke path are release prerequisites, not deferred maintenance.

## Testing Decisions

- The highest test seam is the client workflow runner. Workflow tests exercise a
  complete Job lifecycle through its public interface while replacing the
  transcription server, Summary Provider, clock, recorder, storage, and
  Publication adapters.
- Tests assert externally visible state, artifacts, commands, and recovery
  outcomes rather than private calls or queue implementation details.
- Server contract tests exercise authenticated creation, idempotency, progress,
  Transcript download, retry, cancellation, validation, and readiness through
  the HTTP interface.
- Each Summary Provider has contract tests covering availability, successful
  output, authentication failure, timeout, cancellation, malformed output, and
  redacted diagnostics.
- Recorder integration tests cover completed and error events, durable Meeting
  linkage, and automatic enqueue behavior.
- Recovery tests restart the notebook worker or server at every durable stage and
  verify that the next run resumes without duplicate expensive work.
- Publication tests prove that automatic Publication is attempted, failed
  Publication is independently retryable, and Job completion remains unchanged.
- Retention tests use a controllable clock and verify acknowledgement plus grace
  period before remote deletion.
- Bridge and startup scripts receive smoke tests for configuration validation,
  status reporting, and forward-failure behavior.
- One release acceptance test uses a short real audio fixture through FFmpeg and
  the Whisper process seam. Installed-tool acceptance runs verify each available
  Summary Provider without committing credentials.
- Existing route, queue, recording, sync, Jobs Hub, and note tests provide prior
  art, but green mocked tests are not accepted as evidence for executable paths.

## Out of Scope

- Multiple users, shared accounts, or role-based access.
- Multiple notebooks concurrently controlling the same Job collection.
- A web, desktop, mobile, or browser user interface; the CLI and background
  worker remain the user experience.
- Public HTTP exposure of the home server or direct home-router port forwarding.
- Cloud-hosted Whisper or server-side Kiro, Claude, Codex, or Gemini Summary
  creation.
- Automatic fallback between Summary Providers.
- Real-time streaming transcription while a Meeting is still being recorded.
- Collaborative editing or synchronization of Obsidian notes.
- General-purpose GCP infrastructure beyond the dedicated SSH jump host.

## Further Notes

- Open issues 27-31 describe code already present on `main`. They should be
  verified and closed separately; failed criteria should become implementation
  tickets under this PRD.
- The current test suite passes, but the production workspace build fails and
  several real artifact paths disagree. Baseline repair is the first delivery
  slice.
- The current dependency audit includes production high and critical findings.
  Security upgrades are part of the release gate.
- The specification deliberately distinguishes Job, Transcript, Summary, Summary
  Provider, and Publication according to the project glossary.


