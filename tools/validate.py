"""validate.py - Bible-derived JSON validation + runtime sanity checks.

Writes:
  runtime/validation_report.json

Non-destructive: never crashes the app; only produces criticalErrors if the
core launch set is broken (no launch creature/stage/weapon).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Set


ROOT = Path(__file__).resolve().parents[1]
GEN = ROOT / "data" / "generated"


def load(rel: str) -> Any:
    p = GEN / rel
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def main() -> int:
    report: Dict[str, Any] = {"warnings": [], "criticalErrors": []}

    creatures = load("creatures.json") or []
    stages = load("stages.json") or []
    weapons = load("weapons.json") or []

    # Duplicates
    def dup_ids(items: List[Dict[str, Any]], kind: str):
        seen: Set[str] = set()
        dups: Set[str] = set()
        for it in items:
            iid = str(it.get("id") or "")
            if not iid:
                continue
            if iid in seen:
                dups.add(iid)
            seen.add(iid)
        for d in sorted(dups):
            report["warnings"].append({"code": "DUPLICATE_ID", "kind": kind, "id": d})

    dup_ids(creatures, "creature")
    dup_ids(stages, "stage")
    dup_ids(weapons, "weapon")

    # Core launch gate
    launch_creatures = [c for c in creatures if c.get("isLaunch")]
    launch_stages = [s for s in stages if s.get("isLaunch")]
    launch_weapons = [w for w in weapons if w.get("isLaunch")]
    if not launch_creatures:
        report["criticalErrors"].append({"code": "LAUNCH_SCOPE_EMPTY", "kind": "creature"})
    if not launch_stages:
        report["criticalErrors"].append({"code": "LAUNCH_SCOPE_EMPTY", "kind": "stage"})
    if not launch_weapons:
        report["warnings"].append({"code": "LAUNCH_SCOPE_EMPTY", "kind": "weapon", "note": "falling back to existing runtime weapons"})

    # Asset existence checks (best-effort) using build paths if present
    for c in creatures[:500]:
        p = c.get("buildPlayerSpritePath")
        if p and not (ROOT / p).exists():
            report["warnings"].append({"code": "ASSET_FILE_MISSING", "id": c.get("id"), "path": p})
        ip = c.get("buildIconPath")
        if ip and not (ROOT / ip).exists():
            report["warnings"].append({"code": "ASSET_FILE_MISSING", "id": c.get("id"), "path": ip})

    # Evolution graph sanity (missing prereq references)
    nodes = load("evolution/nodes.json") or []
    prereqs = load("evolution/prereqs.json") or []
    node_ids = {str(n.get("id")) for n in nodes if n.get("id")}
    for pr in prereqs[:2000]:
        a = pr.get("nodeId") or pr.get("node")
        b = pr.get("requiresNodeId") or pr.get("requires")
        if a and str(a) not in node_ids:
            report["warnings"].append({"code": "ORPHAN_PREREQ", "node": a, "missing": True})
        if b and str(b) not in node_ids:
            report["warnings"].append({"code": "MISSING_PREREQ_NODE", "requires": b})

    (ROOT / "runtime").mkdir(parents=True, exist_ok=True)
    (ROOT / "runtime" / "validation_report.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print("validate complete")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
