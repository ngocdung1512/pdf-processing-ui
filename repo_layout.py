"""
Monorepo layout helpers: repo root detection and default model paths.
Run entrypoints from repo root (or ensure repo root is on sys.path).
"""

from pathlib import Path
from typing import Optional

YOLO_DOC_LAYOUT_PT = "doclayout_yolo_docstructbench_imgsz1024.pt"


def find_monorepo_root(start: Path) -> Path:
    p = start.resolve()
    if p.is_file():
        p = p.parent
    for d in [p, *p.parents]:
        try:
            if (d / "ocr_app").is_dir() and (d / "package.json").is_file():
                return d
        except OSError:
            continue
    raise RuntimeError(
        f"Could not find repo root from {start} (expected ocr_app/ and package.json)."
    )


def resolve_yolo_weights(repo: Path, model_path: Optional[str]) -> str:
    if model_path is None:
        for cand in (repo / "models" / YOLO_DOC_LAYOUT_PT, repo / YOLO_DOC_LAYOUT_PT):
            if cand.is_file():
                return str(cand)
        return str((repo / "models" / YOLO_DOC_LAYOUT_PT).resolve())
    mp = Path(model_path)
    if mp.is_file():
        return str(mp.resolve())
    for cand in (repo / "models" / mp.name, repo / mp.name):
        if cand.is_file():
            return str(cand.resolve())
    return str(mp.resolve() if mp.is_absolute() else (repo / "models" / mp).resolve())


def resolve_vietocr_pth(repo: Path, ocr_weight: Optional[str]) -> Optional[Path]:
    if ocr_weight and Path(ocr_weight).is_file():
        return Path(ocr_weight).resolve()
    for cand in (repo / "models" / "vgg_transformer.pth", repo / "vgg_transformer.pth"):
        if cand.is_file():
            return cand
    return None
