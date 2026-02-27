# M5 Playtest Report

## Sessions Run
- Automated server-loop playtests: **10**
- Log location: `playtests/logs/session-*.json`
- Summary: `playtests/summary.json`

## Result
- Pass rate: **10/10**
- Typical session duration: ~11.3s (`world:smoke` scenario)

## What was validated each run
- Darwin spawn
- XP gain from feed/combat
- Evolution draft + selection
- Death + timed respawn
- Territory/apex update events
- Reconnect + resync persistence

## Notes
These are deterministic smoke-playtests for M3/M4 loops, intended to gate regressions while PvP systems are expanded.
