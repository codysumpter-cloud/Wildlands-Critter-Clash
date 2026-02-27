# M4_APEX_LOOP.md — Apex Loop

Implemented in this milestone:

## 1) Level cap (configurable, target 100)
- Added configurable `levelCap` to world server.
- Default is 100.
- Can override via `LEVEL_CAP` env var.
- Exposed in snapshots as `levelCap`.

## 2) Apex designation + broadcast
- Server computes live apex from highest:
  1) level
  2) xp
  3) apexScore
- Emits `apexUpdate` when designation changes.
- Apex info included in state deltas/snapshots.

## 3) Territory/resource pressure objective
- Territory controller tracked per zone.
- `territoryUpdate` broadcast every objective tick.
- Controlled zones grant `apexScore` over time.
- Biomass drains under control; low biomass emits `resourcePressure` alerts.

## Validation
- `npm run world:smoke` passes with:
  - Darwin spawn and progression loop
  - death/respawn persistence
  - territory update events
  - apex update events
  - levelCap presence in snapshot
