# Wildlands Critter Clash

Web-based game project with a Bible-driven data pipeline (v16 schema) for deterministic content generation and runtime packaging.

## Production Status

- Branch protection enabled (configure in GitHub UI)
- CI required on `main`
- Deterministic release packaging
- Model B generated-content policy (version what ships)

## Repository Structure

- `assets/` - source art/audio/design assets
- `dev_with_release/` - development and release orchestration files
- `tools/` - Python/Node build and validation scripts
- `data/generated/` - generated intermediate outputs from Bible import
- `runtime/` - runtime-ready JSON/assets consumed by the web game
- `.github/workflows/ci.yml` - CI validation pipeline

## Build Pipeline

Canonical commands:

```bash
npm run build:all
npm run release:itch
```

Equivalent direct steps:

```bash
python3 tools/bible_import.py --xlsx docs/Bible_v16.xlsx --out data/generated
node tools/build_runtime.js
python3 tools/validate.py
```

## Notes on v16 Schema

Bible v16 introduces/normalizes:

- `Damage_Types`
- `Status_Effects`
- Signature weapons merged into `weapons.json`

## CI Behavior

On push/PR, CI:
1. Sets up Python + Node
2. Installs dependencies if `package.json` exists
3. Runs `npm run build:all`
4. Enforces deterministic generated artifacts (`git diff --exit-code`)

No manual secrets are required for CI.
