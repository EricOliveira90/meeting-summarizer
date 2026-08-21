# Handoff

## What shipped
- Codex selection, model persistence, and ordered executable/authentication/model readiness: `packages/client/src/services/setup.ts:runSetup` and `packages/client/src/services/codexProvider.ts:checkCodexReadiness`
- Client-local Summary Provider contracts and Codex adapter: `packages/client/src/domain/ports.ts:SummaryProvider` and `packages/client/src/services/codexProvider.ts:CodexProvider`
- Selected Summary template instructions and exact stdin framing: `packages/client/src/templates/summaryPrompts.ts:SUMMARY_PROMPTS` and `packages/client/src/services/codexProvider.ts:CodexProvider.summarize`
- Bounded stdout, stderr, and final-message handling with timeout and cancellation: `packages/client/src/services/codexProvider.ts:runProcess` and `packages/client/src/services/codexProvider.ts:readBoundedFile`
- Deterministic failure classification, precedence, redaction, normalization, and final cleanup: `packages/client/src/services/codexProvider.ts:classifyProcessFailure` and `packages/client/src/services/codexProvider.ts:CodexProvider.summarize`
- Controlled process protocol, failure, precedence, cleanup, and redaction coverage: `packages/client/tests/fixtures/fake-codex.mjs` and `packages/client/tests/services/codexProvider.test.ts`

## Decisions made during implementation
- Persist provider selection as top-level `defaultProvider` and `codex` config fields to match the contract's literal shape without replacing existing config sections.
- Use `CODEX_MODEL` when present and `gpt-5-codex` as the initial setup default.
- Return a discriminated `SummaryProviderResult` so expected process failures remain values rather than thrown child-process diagnostics.
- Poll a live final-message file for overflow while also performing a bounded post-exit read.

## Gotchas / learnings
- Durable Job orchestration, Summary persistence, completion, retry routing, and Jobs Hub integration remain follow-on work under issue #34.
- Managed credentials are accepted only for the locked exit-1 stderr message after removing the optional wrapper prefix.
- `pnpm test` reports the existing pnpm workspace and future Vite config-loader warnings.

## Status
Tests passing locally. No regressions.
