# M3_PVP_LOOP.md — Darwin PvP Loop

Implemented in this milestone:

## 1) Spawn as Darwin
- New players spawn as species `darwin`.
- Spawn event emitted: `type=spawn`.

## 2) XP from feeding/combat
- `feed` message grants XP.
- `combatHit` message grants XP and optional damage.
- Level progression threshold: `level * 100` XP.

## 3) Evolution draft at level-up
- On level-up, server emits `evolutionDraft` with 3 options.
- Client selects via `chooseEvolution`.
- Server confirms via `evolutionChosen`.

## 4) Death/respawn + persistence rules
- Fatal damage emits `death` and sets respawn timer.
- Auto-respawn after 5s emits `respawn`.
- Reconnect with `playerId + reconnectToken` preserves:
  - level/xp
  - selected evolutions
  - current player state snapshot via `resync`.

## Validation
- `npm run world:smoke` passes end-to-end for M3 loop and reconnect persistence.
