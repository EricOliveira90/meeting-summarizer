# Slice Contract — Codex Provider Setup and Adapter

**Parent PRD:** .kiro/specs/user-ready-meeting-processing/prd.md
**GH issue:** #34
**Status:** LOCKED
**Negotiation round:** 3

## Scope lock
This first sub-slice of #34 adds notebook setup for Codex and a local `SummaryProvider` adapter. It proves readiness, the non-interactive process protocol, bounded execution and output, deterministic failures, cleanup, and redaction. Durable Job orchestration remains a follow-on contract (issue #34 AC 1-5 and 10; PRD stories 20, 24-26).

### In scope
- Setup persists `{ defaultProvider: 'codex', codex: { model } }` while preserving all other config, and displays separate `executable`, `authentication`, and `model` results as `ready`, `failed`, or `not_checked` with safe reasons (issue #34 AC 1; PRD stories 20 and 25).
- Readiness runs in order: `codex --version`; `codex login status`; then the exact production `codex exec` argv below with stdin `Reply with exactly READY.`. Executable passes on exit 0 plus non-empty version output. Authentication passes on exit 0, or exit 1 when stderr, after removing an optional literal `codex-wrapper: error: ` prefix, is exactly `Login is not required. OpenAI Codex uses Bedrock via managed credentials.`. Model passes on exit 0 plus normalized final message `READY`; any failed probe makes later probes `not_checked` (issue #34 AC 1; PRD story 25).
- Summary creation directly spawns with `shell: false`: `codex exec --ephemeral --ignore-user-config --ignore-rules --sandbox read-only -c approval_policy="never" --model <model> --color never --output-last-message <temp-output> -`. Stdin is exactly `<selected template instructions>\n\nTranscript:\n<exact Transcript>`; only `<temp-output>` can become the Summary (issue #34 AC 2-3; PRD story 24 and provider contract-testing decision).
- Normalization converts CRLF to LF and trims outer whitespace. Empty normalized final output is `MALFORMED_OUTPUT`; arbitrary non-empty text is valid (issue #34 AC 5; PRD structured-validation decision).
- The adapter accepts `AbortSignal`, an injected timeout, and separate byte limits for stdout, stderr, and the final-message file. It captures/reads no more than each limit plus one detection byte; any overflow terminates a live child and returns `PROCESS/true/"Codex output exceeded the capture limit."` (issue #34 AC 3-4; PRD provider-process decision).
- `<temp-output>` is removed in a final cleanup path after success, cancellation, timeout, every overflow, every classified/nonzero/spawn failure, and malformed output; cleanup never exposes its content (issue #34 AC 3-5; PRD redaction decision).
- Failures are `{ category, retryable, message }`: auth stderr `Not logged in` -> `AUTHENTICATION/false/"Codex authentication is unavailable."`; `permission denied` -> `PERMISSION/false/"Codex permission was denied."`; `model "missing-model" is not supported` -> `MODEL/false/"The selected Codex model is unavailable."`; timeout -> `TIMEOUT/true/"Codex timed out."`; abort -> `CANCELLED/true/"Codex was cancelled."`; empty output -> `MALFORMED_OUTPUT/true/"Codex returned no Summary."`; exit 23 -> `PROCESS/true/"Codex failed (exit 23)."`; spawn error -> `PROCESS/false/"Codex could not be started."` (issue #34 AC 5; PRD story 26).
- Classification is a total order: cancellation, timeout, any output overflow, `AUTHENTICATION`, `PERMISSION`, `MODEL`, other process failure, then malformed output. Returned errors and application logs exclude credentials, Transcript/template text, child stdout/stderr, and temp-file content (issue #34 AC 3-5; PRD redaction decision).

### Non-goals (explicit out-of-scope)
- Reading a Job Transcript, invoking Codex from Manual Sync, atomic Summary commit, Job schema/stages/timestamps/completion, Summary-only retry, or Jobs Hub artifact inspection. These issue #34 AC 2 and 6-9 obligations require a follow-on contract before #34 closes (PRD stories 28-29, 34, and 37).
- Kiro/Claude, Meeting overrides, provider switching/fallback, Publication, background workers, or lifecycle migration (PRD stories 21-23, 27, and 30-33).
- Server routes or Summary work, bridge, retention, startup, or doctor tooling (ADR-0001; PRD stories 40-50).
- Real credentials in automated tests; controlled executables prove protocol and outcomes, while target-environment UAT covers managed credentials (PRD Testing Decisions).

### Existing behavior to preserve
- Setup still saves API key and paths; `hasConfigured()` still depends on output path plus server API key — `packages/client/src/services/setup.ts:runSetup`, `packages/client/src/services/config.ts:ConfigService`.
- Existing audio, Obsidian, server, and path config remains readable — `packages/client/src/domain/configs.ts:AppConfig`.
- Manual Sync still ends after atomic Transcript download with the Job `READY` — `packages/client/src/services/syncManager.ts:SyncManager.runFullSyncCycle`.
- Jobs Hub, recording, Meeting, Publication, and authenticated server behavior remain unchanged — `packages/client/src/commands/jobsHub.ts:jobsHubCommand`, `packages/server/src/services/queue.ts:processMeetingJob`.

### Changes to existing behavior (only if the issue asks for it)
- Setup adds Codex default/model selection and three readiness results: “Setup verifies Codex availability and selects it as the default Summary Provider.”

## Files expected to change
- packages/client/src/domain/configs.ts
- packages/client/src/domain/ports.ts
- packages/client/src/templates/summaryPrompts.ts (new file)
- packages/client/src/services/codexProvider.ts (new file)
- packages/client/src/services/config.ts
- packages/client/src/services/setup.ts
- packages/client/src/services/index.ts
- packages/client/tests/fixtures/fake-codex.mjs (new file)
- packages/client/tests/services/codexProvider.test.ts (new file)
- packages/client/tests/services/setupConfigSave.test.ts
- packages/client/tests/services/configCleanup.test.ts

## New patterns / deps / schema (if any)
- Add client-local `SummaryProvider`, readiness/result/failure contracts, Codex process adapter, Summary prompts, and provider config; no dependency, Job/shared schema, or server change (PRD Summary Provider decision).

## Test plan
- Given controlled executable, normal-login, managed-credential, model-failure, auth-failure, and executable-failure modes, when setup runs, then tests assert exact argv/order, exact persisted config and named results, and every `not_checked` short circuit; target managed Codex's exit-1 message passes authentication and reaches the model probe.
- Given Transcript/template/model canaries, when Summary creation succeeds, then exact argv/stdin and normalized final-message output are observed, argv/logs exclude canaries, and `<temp-output>` no longer exists.
- Given oversized stdout, stderr, or `<temp-output>`, when Codex runs, then capture/read is bounded, the exact overflow failure is returned, any live child terminates, and no temp artifact remains.
- Given each ordinary failure above, when Codex terminates, then exact category/retryability/message and no temp artifact are observed; mixed fixtures prove cancellation over timeout, timeout over overflow, overflow over auth, auth over permission/model, permission over model, model over exit 23, and exit 23 over empty output.
- Given cancellation, timeout, malformed output, spawn failure, success, and redaction canaries, when the adapter finishes, then the child is terminated where applicable, no temp artifact remains, and diagnostics contain no credential, Transcript, template, stderr, stdout, or final-message content.
- Given the repository, when `npm run build` and `npm test` run, then both exit zero and existing suites retain their outcomes.

## Definition of done
- [ ] Setup persists Codex/model and reports executable, managed/local authentication, and model readiness separately
- [ ] Adapter tests prove exact protocol, success, cancellation, timeout, all output bounds, cleanup, malformed output, classification precedence, and redaction
- [ ] No Job, Jobs Hub, server, or Publication behavior changes
- [ ] Follow-on orchestration remains required for issue #34 AC 2 and 6-9
- [ ] All tests pass locally
- [ ] No regression in existing suite
- [ ] Evaluator has signed off via qa-report.md
