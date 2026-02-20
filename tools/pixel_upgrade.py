#!/usr/bin/env python3
"""Pixel Upgrade Engine (offline build-step)

Rules enforced:
  - Uses ONLY existing project PNGs as source pixels.
  - Bible-driven selection via runtime/registry.json tags when available.
  - Can also target whole asset folders for completeness (still only uses project pixels).
  - Non-destructive: move originals to prefix+filename, write upgraded PNG to original filename.
  - Keeps canvas size identical and does not shift pixels.

Transforms are conservative and deterministic:
  - isolated speckle cleanup
  - palette discipline via no-dither quantization (only when needed)
  - mild contrast normalization on opaque pixels
  - boundary/outline emphasis using darkest existing color

This is NOT a style transfer tool.
"""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Tuple

from PIL import Image


RGBA = Tuple[int, int, int, int]


def clamp(x: int) -> int:
    return 0 if x < 0 else 255 if x > 255 else x


def luminance(rgb: Tuple[int, int, int]) -> float:
    r, g, b = rgb
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def iter_neighbors(x: int, y: int) -> Iterable[Tuple[int, int]]:
    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            if dx == 0 and dy == 0:
                continue
            yield x + dx, y + dy


def is_boundary(px: List[RGBA], w: int, h: int, x: int, y: int) -> bool:
    i = y * w + x
    if px[i][3] == 0:
        return False
    for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
        if nx < 0 or ny < 0 or nx >= w or ny >= h:
            return True
        if px[ny * w + nx][3] == 0:
            return True
    return False


def speckle_cleanup(img: Image.Image, alpha_threshold: int = 1) -> Image.Image:
    """Remove isolated 1px opaque speckles by replacing them with the most common neighboring color."""
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    w, h = img.size
    px = list(img.getdata())
    out = px[:]
    for y in range(h):
        for x in range(w):
            i = y * w + x
            r, g, b, a = px[i]
            if a <= alpha_threshold:
                continue
            colors: Dict[Tuple[int, int, int, int], int] = {}
            opaque_n = 0
            for nx, ny in iter_neighbors(x, y):
                if nx < 0 or ny < 0 or nx >= w or ny >= h:
                    continue
                nr, ng, nb, na = px[ny * w + nx]
                if na > alpha_threshold:
                    opaque_n += 1
                    key = (nr, ng, nb, na)
                    colors[key] = colors.get(key, 0) + 1
            if opaque_n <= 1 and colors:
                repl = max(colors.items(), key=lambda kv: kv[1])[0]
                out[i] = repl
    img2 = Image.new("RGBA", (w, h))
    img2.putdata(out)
    return img2


def quantize_if_needed(img: Image.Image, max_colors: int) -> Image.Image:
    """Quantize only if unique opaque colors exceed max_colors. No dithering."""
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    data = list(img.getdata())
    uniq = set((r, g, b) for (r, g, b, a) in data if a != 0)
    if len(uniq) <= max_colors:
        return img
    rgb = img.convert("RGB")
    q = rgb.quantize(colors=max_colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    rgb2 = q.convert("RGB")
    r2, g2, b2 = rgb2.split()
    a = img.split()[3]
    return Image.merge("RGBA", (r2, g2, b2, a))


def contrast_normalize(img: Image.Image, strength: float = 0.10) -> Image.Image:
    """Mild contrast stretch on opaque pixels only (percentile window)."""
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    w, h = img.size
    px = list(img.getdata())
    lums = [luminance((r, g, b)) for (r, g, b, a) in px if a != 0]
    if not lums:
        return img
    lums.sort()
    lo = lums[int(0.05 * (len(lums) - 1))]
    hi = lums[int(0.95 * (len(lums) - 1))]
    if hi <= lo + 1e-6:
        return img

    def adj(c: int) -> int:
        t = (c - lo) / (hi - lo)
        if t < 0.0:
            t = 0.0
        elif t > 1.0:
            t = 1.0
        t = 0.5 + (t - 0.5) * (1.0 + strength)
        return clamp(int(round(t * 255.0)))

    out: List[RGBA] = []
    for (r, g, b, a) in px:
        if a == 0:
            out.append((r, g, b, a))
        else:
            out.append((adj(r), adj(g), adj(b), a))
    img2 = Image.new("RGBA", (w, h))
    img2.putdata(out)
    return img2


def outline_emphasis(img: Image.Image, amount: float = 0.35) -> Image.Image:
    """Darken boundary pixels slightly toward the darkest existing color."""
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    w, h = img.size
    px = list(img.getdata())
    opaque = [(r, g, b) for (r, g, b, a) in px if a != 0]
    if not opaque:
        return img
    darkest = min(opaque, key=luminance)
    dr, dg, db = darkest
    out = px[:]
    for y in range(h):
        for x in range(w):
            if not is_boundary(px, w, h, x, y):
                continue
            i = y * w + x
            r, g, b, a = px[i]
            nr = clamp(int(round(r * (1 - amount) + dr * amount)))
            ng = clamp(int(round(g * (1 - amount) + dg * amount)))
            nb = clamp(int(round(b * (1 - amount) + db * amount)))
            out[i] = (nr, ng, nb, a)
    img2 = Image.new("RGBA", (w, h))
    img2.putdata(out)
    return img2


@dataclass
class Target:
    path: Path
    kind: str  # 'sheet'|'icon'|'image'


def infer_kind_from_path(p: Path) -> str:
    s = str(p).lower()
    if "/icons/" in s or s.endswith("_icon.png") or "icon" in p.name.lower():
        return "icon"
    if any(seg in s for seg in ("/players/", "/enemies/", "/bosses/", "/vfx/")):
        return "sheet"
    return "image"


def load_targets_from_registry(registry_path: Path, tag: str) -> List[Target]:
    reg = json.loads(registry_path.read_text(encoding="utf-8"))
    assets = reg.get("assets", [])
    out: List[Target] = []
    for a in assets:
        tags = a.get("tags", [])
        if tag not in tags:
            continue
        p = Path(a["path"])
        kind = a.get("type", "image")
        if kind == "spritesheet":
            k = "sheet"
        elif kind == "icon":
            k = "icon"
        else:
            k = infer_kind_from_path(p)
        out.append(Target(path=p, kind=k))
    # Deduplicate
    seen = set()
    dedup: List[Target] = []
    for t in out:
        sp = str(t.path)
        if sp in seen:
            continue
        seen.add(sp)
        dedup.append(t)
    return dedup


def load_targets_from_dirs(root: Path, dirs: List[str], prefix: str) -> List[Target]:
    out: List[Target] = []
    for d in dirs:
        abs_d = (root / d).resolve()
        if not abs_d.exists():
            continue
        for p in abs_d.rglob("*.png"):
            if p.name.startswith(prefix):
                continue
            rel = p.relative_to(root)
            out.append(Target(path=Path(str(rel)), kind=infer_kind_from_path(rel)))
    # Deduplicate
    seen = set()
    dedup: List[Target] = []
    for t in out:
        sp = str(t.path)
        if sp in seen:
            continue
        seen.add(sp)
        dedup.append(t)
    return dedup


def upgrade_image(img: Image.Image, kind: str) -> Image.Image:
    # Category-tuned parameters (conservative)
    if kind == "icon":
        max_colors = 20
        contrast = 0.12
        outline_amt = 0.40
    elif kind == "sheet":
        max_colors = 64
        contrast = 0.10
        outline_amt = 0.30
    else:
        max_colors = 48
        contrast = 0.10
        outline_amt = 0.30

    out = img.convert("RGBA")
    out = speckle_cleanup(out)
    out = quantize_if_needed(out, max_colors=max_colors)
    out = contrast_normalize(out, strength=contrast)
    out = outline_emphasis(out, amount=outline_amt)
    return out


def preserve_and_upgrade(root: Path, t: Target, prefix: str, dry_run: bool) -> Tuple[bool, bool, str]:
    abs_path = (root / t.path).resolve()
    if not abs_path.exists():
        return False, True, f"missing from the two zips: {t.path}"
    if abs_path.name.startswith(prefix):
        return False, True, "prefixed"

    preserved = abs_path.with_name(prefix + abs_path.name)
    if dry_run:
        return True, False, f"would preserve {t.path} -> {preserved.relative_to(root)}; upgrade kind={t.kind}"

    # Preserve original once
    if not preserved.exists():
        os.replace(abs_path, preserved)

    src = Image.open(preserved)
    upgraded = upgrade_image(src, t.kind)
    upgraded.save(abs_path, format="PNG", optimize=False)
    return True, False, "upgraded"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--registry", default="runtime/registry.json", help="Path to runtime/registry.json")
    ap.add_argument("--tag", default="", help="Registry tag to upgrade (e.g. player, enemy, vfx)")
    ap.add_argument("--dirs", default="", help="Comma-separated asset dirs to scan (e.g. assets/icons,assets/props)")
    ap.add_argument("--prefix", default="original_", help="Prefix for preserved originals")
    ap.add_argument("--dry-run", action="store_true", help="List actions without writing")
    args = ap.parse_args()

    root = Path.cwd()
    prefix = args.prefix

    targets: List[Target] = []

    registry_path = (root / args.registry).resolve()
    if args.tag:
        if not registry_path.exists():
            print(f"[pixel_upgrade] missing from the two zips: {args.registry}")
            return 2
        targets.extend(load_targets_from_registry(registry_path, args.tag))

    if args.dirs:
        dirs = [d.strip() for d in args.dirs.split(",") if d.strip()]
        targets.extend(load_targets_from_dirs(root, dirs, prefix=prefix))

    # Deduplicate final
    seen = set()
    final: List[Target] = []
    for t in targets:
        sp = str(t.path)
        if sp in seen:
            continue
        seen.add(sp)
        final.append(t)

    if not final:
        print("[pixel_upgrade] No targets matched.")
        return 0

    changed = 0
    skipped = 0
    for t in final:
        ok, skip, msg = preserve_and_upgrade(root, t, prefix=prefix, dry_run=args.dry_run)
        if args.dry_run:
            print(f"[pixel_upgrade] {msg}")
            continue
        if ok and not skip:
            if msg == "upgraded":
                changed += 1
        else:
            skipped += 1
            if msg.startswith("missing from the two zips"):
                print(f"[pixel_upgrade] {msg}")

    print(f"[pixel_upgrade] Upgraded {changed} asset(s); skipped {skipped}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
