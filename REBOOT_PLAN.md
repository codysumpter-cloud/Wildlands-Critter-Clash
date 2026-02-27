# REBOOT_PLAN.md — Wildlands Critter Clash

## Goal
Reboot development from a known-good baseline and build toward an open-world PvP Darwin→Apex experience.

## Phase 0 — Baseline Freeze (Now)
- Keep the known-good master build as immutable reference.
- Record checksum/version tag.
- Do all new work in a reboot branch.

## Phase 1 — Core Stability
- Deterministic run loop, progression, save/load sanity.
- Data bible consistency checks in CI.
- One packaging path only.

## Phase 2 — World Foundation
- Persistent world state (zones, resources, timers).
- Server-authoritative simulation model.
- Basic spawn/respawn and anti-desync rules.

## Phase 3 — PvP Vertical Slice
- Darwin start for all players.
- Eat/gain XP/evolution draft choices.
- Combat interactions + death loop.
- Apex status + leaderboard loop.

## Phase 4 — Meta + Seasons
- Difficulty ladders and server wipes/seasons.
- Challenge modifiers and progression rewards.
- Balance passes on evolutions and lineages.

## Non-Negotiables
- No untracked release drift.
- No mixed artifact sources.
- Every milestone has smoke tests + rollback plan.
