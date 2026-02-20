# Build Meta Overlay (Dev-Only)

## Purpose
Display runtime build info in a non-player-facing debug overlay.

## Files
- `runtime/buildMeta.js` (fail-soft loader + optional overlay mount)
- `runtime/build_meta.json` (generated at build time; gitignored)

## Constraints (enforced)
1. Missing or malformed `build_meta.json` **must not** block startup.
2. Overlay only appears in dev mode (`?dev=1` or `localStorage.WCC_DEV=1`).

## Integration
In your runtime entrypoint:

```js
import { mountBuildMetaOverlay } from './buildMeta.js';

mountBuildMetaOverlay({ fetchPath: 'runtime/build_meta.json' });
```

If your runtime serves files from a different root, adjust `fetchPath` to `build_meta.json` or equivalent.

## Expected schema
```json
{
  "shaShort": "274288b",
  "sha": "274288b...",
  "tag": "v0.1.0",
  "builtAt": "2026-02-20T16:12:00Z"
}
```
