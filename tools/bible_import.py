#!/usr/bin/env python3
import argparse
import json
from pathlib import Path

def main():
    p = argparse.ArgumentParser(description="Import Bible v16 data into generated JSON stubs")
    p.add_argument("--xlsx", default="docs/Bible_v16.xlsx", help="Path to Bible workbook")
    p.add_argument("--out", default="data/generated", help="Output directory")
    args = p.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    manifest = {
        "schemaVersion": "v16",
        "sourceWorkbook": args.xlsx,
        "datasets": [
            "creatures",
            "weapons",
            "damage_types",
            "status_effects",
            "evolution_nodes",
            "stages",
            "props",
            "vfx",
            "sfx"
        ]
    }

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    base = {
        "creatures": [],
        "weapons": [],
        "damage_types": [],
        "status_effects": []
    }
    (out_dir / "core_data.json").write_text(json.dumps(base, indent=2) + "\n", encoding="utf-8")

    print(f"[bible_import] wrote {out_dir / 'manifest.json'} and core_data.json")

if __name__ == "__main__":
    main()
