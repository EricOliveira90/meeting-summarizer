## Evaluator feedback — round 2

VERDICT: REVISE
GAPS: 2
RE_RAISED_GAPS: 0

### If REVISE, specific gaps:
- **Scope lock / Existing behavior to preserve / Test plan:** The contract calls the tracer bullet "exact and recoverable," but preserves "Poll only `PROCESSING`" and "Upload targets remain `WAITING_UPLOAD` plus `FAILED` below three retries," while its only duplicate guard is "status becomes `PROCESSING`, and a second cycle does not upload it." Issue #47 also requires recovery when creation had an uncertain outcome: before creating again, Manual Sync must query the persisted Job ID; a found Job must suppress creation, while stable `404 JOB_NOT_FOUND` must cause exactly one creation with unchanged metadata and one local Job. Neither branch is in scope or the test plan. A transport failure after server acceptance can therefore still pass this contract while the next cycle creates again. This violates falsifiability and the promised recoverability.
- **In scope / Test plan:** In scope promises that "timeout, and interrupted-download failures ... preserve any prior final Transcript byte-for-byte," but the sentinel test covers only "write, verification-read, mismatch, or rename fault," and the timeout/interruption scenario asserts only that "the same cleanup/retry signal occurred, no upload occurred, and the exact Transcript commits successfully." It never establishes or inspects a prior final Transcript after the failed attempt and before the successful retry. An implementation could delete the prior final during timeout/interruption and still pass after the retry replaces it. This violates falsifiability.
