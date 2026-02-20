# Wildlands Critter Clash

Web-based game project with a Bible-driven data pipeline (v16 schema) for deterministic content generation and runtime packaging.

## Repository Structure

- `assets/` - source art/audio/design assets
- `dev_with_release/` - development and release orchestration files
- `tools/` - Python/Node build and validation scripts
- `data/generated/` - generated intermediate outputs from Bible import
- `runtime/` - runtime-ready JSON/assets consumed by the web game
- `.github/workflows/ci.yml` - CI validation pipeline

## Build Pipeline

### 1) Import Bible data (v16)

```bash
python3 tools/bible_import.py --xlsx docs/Bible_v16.xlsx --out data/generated
```

### 2) Build runtime bundles

```bash
node tools/build_runtime.js
```

### 3) Validate generated and runtime outputs

```bash
python3 tools/validate.py
```

## Notes on v16 Schema

Bible v16 introduces/normalizes:

- `Damage_Types`
- `Status_Effects`
- Signature weapons merged into `weapons.json`

## CI Behavior

On push to `main`, CI:
1. Sets up Python + Node
2. Installs Node dependencies if `package.json` exists
3. Runs Bible import → runtime build → validation
4. Fails on critical validation errors

No manual secrets are required for CI.
