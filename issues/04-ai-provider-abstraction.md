# AI Provider Abstraction

## Parent PRD

#9

## What to build

Extract an `AIProvider` interface and factory pattern to decouple the summarization pipeline from any specific AI SDK. The existing Gemini logic moves into a dedicated provider class, and `SummaryService` becomes a thin orchestrator.

**New types/classes:**
- **`AIProvider` interface** — `name: string` property and `summarize(transcript: string, systemPrompt: string): Promise<string>` method. Intentionally minimal.
- **`AIProviderFactory`** — `register(provider: AIProvider)`, `get(name: string): AIProvider`, `getDefault(): AIProvider`. Default resolved from `AI_PROVIDER` env var, falling back to `'gemini'`. Throws on unknown provider.
- **`GeminiProvider`** — implements `AIProvider` using the existing `@google/genai` SDK logic currently in `SummaryService`. Reads `GEMINI_API_KEY` and `GEMINI_MODEL` env vars.

**Refactored `SummaryService`:**
- Resolves the active provider from the factory (no direct Gemini imports)
- Selects the prompt template
- Calls `provider.summarize()`
- Writes the result to disk via `FileManagerService`

Adding a new AI provider (e.g., Claude, OpenAI) requires only: creating one class implementing `AIProvider` and one `factory.register()` call — no changes to the queue, routes, or `SummaryService`.

See **Phase 3** of the [server-hardening plan](plans/server-hardening.md) for full details.

## Acceptance criteria

- [ ] `AIProvider` interface defined with `name: string` and `summarize(transcript: string, systemPrompt: string): Promise<string>`
- [ ] `AIProviderFactory` supports `register()`, `get(name)`, `getDefault()` — throws on unknown provider
- [ ] `getDefault()` reads `AI_PROVIDER` env var, falls back to `'gemini'`
- [ ] `GeminiProvider` implements `AIProvider` using existing `@google/genai` SDK logic
- [ ] `SummaryService` resolves provider via factory; no direct Gemini imports
- [ ] `SummaryService` writes output file via `FileManagerService`
- [ ] Unit tests cover factory registration, default resolution, and unknown-provider error
- [ ] End-to-end flow unchanged: upload, transcribe, summarize still works

## Blocked by

- Blocked by #17 — FileManagerService + Directory Bootstrapping (`SummaryService` writes output via `FileManagerService`)

## User stories addressed

- User story 1: Swap AI summarization provider by changing config and adding a provider class
- User story 2: All AI providers conform to the same interface
- User story 3: AI provider configured globally via environment variable
