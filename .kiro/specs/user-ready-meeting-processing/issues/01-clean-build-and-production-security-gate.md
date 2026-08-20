# Clean Build and Production Security Gate

## Parent

Part of #32.

## What to build

Establish the deterministic build and production dependency baseline required
by every meeting-processing slice. This technical enabler changes no runtime
workflow behavior.

## Acceptance criteria

- [ ] A clean checkout completes `npm ci` without modifying the lockfile.
- [ ] The root build compiles shared before client and server, and exits zero.
- [ ] The root `audit:production` script runs `npm audit --omit=dev --audit-level=high`; that command's exit code is the sole verdict for the complete production dependency graph.
- [ ] No advisory allowlist or subjective "affects this path" classification can turn a nonzero audit result into a pass.
- [ ] Production dependencies are upgraded or removed until `npm run audit:production` exits zero.
- [ ] `npm test` remains green, and no meeting-processing runtime behavior changes in this slice.

## Blocked by

None - can start immediately.
