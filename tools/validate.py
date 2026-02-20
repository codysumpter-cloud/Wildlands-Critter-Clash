#!/usr/bin/env python3
import json
from pathlib import Path
import sys

errors = []

required_files = [
    Path("data/generated/manifest.json"),
    Path("data/generated/core_data.json"),
    Path("runtime/manifest.json"),
    Path("runtime/weapons.json"),
    Path("runtime/damage_types.json"),
    Path("runtime/status_effects.json"),
]

for f in required_files:
    if not f.exists():
        errors.append(f"Missing required file: {f}")

if not errors:
    try:
        manifest = json.loads(Path("runtime/manifest.json").read_text(encoding="utf-8"))
        if manifest.get("schemaVersion") != "v16":
            errors.append("runtime/manifest.json schemaVersion must be v16")
    except Exception as e:
        errors.append(f"Invalid runtime/manifest.json: {e}")

if errors:
    print("VALIDATION CRITICAL ERRORS:")
    for e in errors:
        print(f"- {e}")
    sys.exit(1)

print("Validation passed: no critical errors")
