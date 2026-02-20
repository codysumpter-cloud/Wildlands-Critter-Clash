# Branching Strategy

- `main` = protected, always playable
- `feature/<area>-<desc>` = systems/code/runtime/ui/tools
- `content/<domain>-<desc>` = Bible/content/data tuning
- `hotfix/<issue>-<desc>` = urgent patch from main

Rules:
- Merge to main via PR + green CI
- Avoid force-push to main
- Keep PR scope small and testable
