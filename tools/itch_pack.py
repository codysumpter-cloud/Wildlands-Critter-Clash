#!/usr/bin/env python3
"""Create an itch.io-ready zip from ./release.

Why this exists:
- itch.io has a hard limit on ZIP file *count* (commonly 1000).
- We keep dev-only sources + original_* archives in the DEV project, but only ship /release.

Behavior:
- Ensures ./release exists (built by npm run release)
- Validates file count within ./release
- Writes Wildlands_Critter_Clash_ITCH_UPLOAD.zip at repo root
- Flattens: contents of ./release become ZIP root (index.html at top level)
"""

from __future__ import annotations

import os
import sys
import zipfile
from pathlib import Path


ZIP_NAME = "Wildlands_Critter_Clash_ITCH_UPLOAD.zip"
ITCH_FILE_LIMIT = 1000


def iter_files(root: Path):
    for p in root.rglob("*"):
        if p.is_file():
            name = p.name.lower()
            if name in {".ds_store", "thumbs.db"}:
                continue
            yield p


def main() -> int:
    repo = Path.cwd()
    release = repo / "release"
    if not release.exists() or not release.is_dir():
        print("ERROR: ./release folder not found. Run: npm run release", file=sys.stderr)
        return 1

    files = list(iter_files(release))
    count = len(files)
    if count > ITCH_FILE_LIMIT:
        print(
            f"ERROR: Too many files for itch.io ({count} > {ITCH_FILE_LIMIT}).\n"
            "Fix by excluding dev-only/archival assets from /release (e.g., original_*).",
            file=sys.stderr,
        )
        return 2

    out = repo / ZIP_NAME
    if out.exists():
        out.unlink()

    # ZIP with deterministic-ish ordering
    files.sort(key=lambda p: str(p.as_posix()))
    with zipfile.ZipFile(out, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
        for f in files:
            arc = f.relative_to(release)
            zf.write(f, arcname=str(arc))

    size_mb = out.stat().st_size / (1024 * 1024)
    print(f"Wrote {ZIP_NAME} ({count} files, {size_mb:.2f} MB) from ./release")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
