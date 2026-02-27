# TECH_DECISIONS.md

## Decision 1: Baseline policy
Use known-good master zip as read-only baseline; no direct edits.

## Decision 2: Branch strategy
- `main`: stable + releasable
- `reboot/*`: feature branches for new architecture and PvP systems

## Decision 3: Packaging policy
Single source packaging from frozen runtime artifacts.
No release mixing from stale folders.

## Decision 4: Data authority
Data Bible remains source of truth for creatures/evolutions/weapons.
Runtime data generated from validated import pipeline.

## Decision 5: Multiplayer architecture
Server-authoritative world simulation for PvP fairness and anti-desync.
Client handles presentation/input prediction only.

## Decision 6: Risk controls
- Keep smoke tests per milestone
- Keep rollback snapshots
- Keep checksum logs for distributed builds
