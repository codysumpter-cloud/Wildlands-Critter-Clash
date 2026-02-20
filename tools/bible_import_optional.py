#!/usr/bin/env python3
"""Optional Bible importer wrapper.

If the XLSX is missing, exit 0 with a clear message so builds remain stable
when runtime/registry outputs already exist.
"""

import os
import sys
import subprocess


def main() -> int:
    # Keep CLI compatibility with existing scripts.
    args = sys.argv[1:]
    xlsx = None
    out = None
    for i, a in enumerate(args):
        if a == "--xlsx" and i + 1 < len(args):
            xlsx = args[i + 1]
        if a == "--out" and i + 1 < len(args):
            out = args[i + 1]

    if xlsx and not os.path.exists(xlsx):
        print("Bible XLSX not found; skipping import (runtime already present).")
        if out and not os.path.exists(out):
            # Create output dir to avoid downstream tooling surprises.
            os.makedirs(out, exist_ok=True)
        return 0

    # Delegate to the real importer.
    cmd = [sys.executable, os.path.join("tools", "bible_import.py"), *args]
    return subprocess.call(cmd)


if __name__ == "__main__":
    raise SystemExit(main())
