# Build Contract (Canonical)

Use these commands locally and in CI:

```bash
npm run build:all
npm run release:itch
```

## Notes
- `build:all` runs Bible import, runtime build, and validation.
- `release:itch` creates the release zip artifact with payload file-count gate.
- Generated artifacts are versioned under Model B policy and CI enforces they are up to date.
