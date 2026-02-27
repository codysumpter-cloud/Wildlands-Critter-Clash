# BASELINE_FREEZE.md

## Frozen Baseline
- Git tag: `baseline-good-master-2026-02-27`
- Branch at freeze: `main`
- Source zip: `WildlandsCritterClash_TRUE_MASTER_UI_VIDEO_MATCH_v6_ATTACKVFX_RESTORE.zip`
- SHA256: `B73DEECCD6800A673B656818CD0A90CA7D727AAB7849836B317F61D1645A5C0F`

## Policy
- Treat baseline as read-only reference.
- Do not patch baseline artifacts directly.
- All development proceeds on `reboot/pvp-foundation` (or child branches).

## Recovery
If reboot branch regresses, restore from:
1. Git tag `baseline-good-master-2026-02-27`
2. Source zip checksum above
