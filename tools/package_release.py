#!/usr/bin/env python3
from pathlib import Path
import zipfile

OUT = Path("out")
OUT.mkdir(parents=True, exist_ok=True)
zip_path = OUT / "wildlands-critter-clash-web.zip"

include_paths = [Path("runtime"), Path("assets"), Path("README.md"), Path("LICENSE")]

with zipfile.ZipFile(zip_path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
    count = 0
    for p in include_paths:
        if not p.exists():
            continue
        if p.is_file():
            zf.write(p, p.as_posix())
            count += 1
        else:
            for f in p.rglob("*"):
                if f.is_file():
                    zf.write(f, f.as_posix())
                    count += 1

if count > 1000:
    raise SystemExit(f"Release gate failed: file count {count} exceeds 1000")

print(f"Packaged {count} files -> {zip_path}")
