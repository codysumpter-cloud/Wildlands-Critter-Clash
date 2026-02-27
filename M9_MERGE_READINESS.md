# M9 Merge Readiness

## Scope
Prepare `reboot/pvp-foundation` for review/merge into `main` with clear validation and rollback guidance.

## Checklist

### Branch hygiene
- [x] Branch up to date with remote
- [x] Milestone docs committed (M0→M8)
- [x] No debug-only temporary files pending

### Functional checks
- [x] `npm run world:smoke` passes
- [x] `npm run world:soak` passes
- [x] `npm run play:pack:zip` succeeds

### Artifacts and docs
- [x] Baseline freeze doc present (`BASELINE_FREEZE.md`)
- [x] Milestone reports present (`M2_...` through `M8_...`)
- [x] Playtest logs present (`playtests/logs/*.json`)

### Merge plan
1. Open PR from `reboot/pvp-foundation` to `main`.
2. Include PR summary + risk notes.
3. Require at least one full smoke + soak rerun on latest head.
4. Merge via squash or merge commit (team preference).

### Rollback plan
- If regression appears post-merge:
  1. Revert merge commit on `main`
  2. Restore baseline via tag `baseline-good-master-2026-02-27`
  3. Re-open hotfix branch from latest good state
