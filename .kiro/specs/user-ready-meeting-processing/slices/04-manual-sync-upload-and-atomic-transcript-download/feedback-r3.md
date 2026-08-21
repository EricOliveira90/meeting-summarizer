## Evaluator feedback — round 3

VERDICT: REVISE
GAPS: 1
RE_RAISED_GAPS: 0

### If REVISE, specific gaps:
- **In scope / Test plan:** In scope promises, "Any found Job suppresses creation and reconciles locally: server `PENDING`/`PROCESSING` becomes `PROCESSING`, `COMPLETED/TRANSCRIPT_READY` becomes `READY`, and `FAILED` keeps the existing fatal-failure mapping. Only exact 404 `JOB_NOT_FOUND` permits one creation attempt; transport, auth, or other lookup failures permit no creation." The test plan covers exact 404, but its found case says only "the returned server state is reconciled locally," without naming an input state and expected local state, and it has no case for transport, auth, or other non-404 lookup failures. Incorrect `COMPLETED`/`FAILED` mappings or a POST after a 401/500/transport error could therefore pass the planned suite. This violates falsifiability and UAT-verifiability. Add table-driven cases for each promised found-state mapping and each non-404 failure class, asserting the exact local outcome and zero creation calls.
