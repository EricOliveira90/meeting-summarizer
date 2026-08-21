## Evaluator feedback — round 1

VERDICT: REVISE
GAPS: 3
RE_RAISED_GAPS: 0

### If REVISE, specific gaps:
- **In scope / Existing behavior to preserve / Test plan:** In scope says, "no upload attempt regenerates or changes its Job ID, `recordedAt`, Meeting linkage, or options," while preservation requires "options prompts," and the current `pushJob` persists prompted options when they are missing. The test plan covers only a Job that already has options, so it cannot resolve or detect this contradiction. This violates falsifiability and boundary explicitness. Limit immutability to Jobs with complete persisted options, or specify and test the missing-options behavior.
- **In scope / Test plan:** The contract promises failures will "report a retryable failure," and the test plan repeats "Manual Sync reports the failure as retryable," but it defines no observable return value, event, persisted field, or exact CLI output that distinguishes retryable from non-retryable failure. Leaving the Job `READY` proves that another cycle can retry; it does not prove that Manual Sync reports retryability to an evaluator. This violates falsifiability and UAT-verifiability. Define a concrete observable retryable outcome and assertion, or remove the reporting promise and make `READY` plus no re-upload the complete verdict.
- **In scope / Test plan:** In scope requires "a unique sibling temporary path," but the planned success case observes only one download: "a unique same-directory temporary file is written." A fixed `<final>.tmp` path can pass that single-run scenario, so uniqueness cannot fail. This violates falsifiability. Exercise at least two attempts or concurrent commits and assert distinct sibling temporary paths and cleanup, or remove the uniqueness requirement.
