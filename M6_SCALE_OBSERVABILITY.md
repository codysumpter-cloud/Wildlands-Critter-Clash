# M6 Scale + Observability

Implemented:

## 1) Lightweight server metrics endpoint
- Added `/metrics` JSON on world server.
- Exposes:
  - player counts (total/connected/ghost)
  - tick counters
  - avg/max tick durations for sim/state/objective loops
  - uptime

## 2) Multi-client soak test
- Added `tools/world_soak.js`.
- Spawns 16 clients, joins all, sends jittered movement input for 5s.
- Validates welcomes, snapshots, and state deltas.

## 3) Scripted run path
- New npm script: `world:soak`
- Existing `world:smoke` retained for deterministic regression checks.

Validation:
- `npm run world:soak` passes.
- `npm run world:smoke` still passes after metrics additions.
