# PR Notes — Reboot PvP Foundation (M0→M8)

## Branch
- from: `reboot/pvp-foundation`
- to: `main`

## Includes
- M0: baseline freeze + branch discipline
- M1: core integrity and reproducible packaging
- M2: server world skeleton
- M3: Darwin PvP loop
- M4: apex loop + territory pressure objective
- M5: playtest/balance/stability docs + logs
- M6: metrics endpoint + 16-client soak
- M7: client-world playable bridge
- M8: native HUD integration

## Validation runbook
1. `npm run world:smoke`
2. `npm run world:soak`
3. `npm run play:pack:zip`

## Risk notes
- Client bridge currently uses control hotkeys for test hooks (`F/H/K`, `1..4`).
- Full visual-authoritative multiplayer rendering remains a follow-up iteration.

## Rollback
- Revert merge commit.
- Restore baseline tag: `baseline-good-master-2026-02-27`.
