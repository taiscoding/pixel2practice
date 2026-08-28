#!/usr/bin/env python3
"""Build practice drills from radiology datasets.

Preferred for wording (non-commercial research OK for now):
  python3 scripts/build-drills.py --xraydar --limit 80

No-permission label stand-in:
  python3 scripts/build-drills.py --chestxdet --limit 120

Gated dumps when you have them locally:
  python3 scripts/build-drills.py --padchest-json ... --images ...
  python3 scripts/build-drills.py --vindr-annotations ... --images ...
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import re
import shutil
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
OUT_JSON = ROOT / "public" / "drills.json"
OUT_IMG = ROOT / "public" / "drills"

CHESTXDET_CUES = {
    "Atelectasis": "There is atelectasis.",
    "Calcification": "There is calcification.",
    "Cardiomegaly": "There is cardiomegaly.",
    "Consolidation": "There is consolidation.",
    "Diffuse Nodule": "There are diffuse nodules.",
    "Effusion": "There is a pleural effusion.",
    "Emphysema": "There is emphysema.",
    "Fibrosis": "There is fibrosis.",
    "Fracture": "There is a fracture.",
    "Mass": "There is a mass.",
    "Nodule": "There is a nodule.",
    "Pleural Thickening": "There is pleural thickening.",
    "Pneumothorax": "There is a pneumothorax.",
}

CHESTXDET_ATTR = (
    "ChestX-Det annotations (Apache-2.0); images from NIH ChestX-ray14 "
    "(https://nihcc.app.box.com/v/ChestXray-NIHCC). NIH Clinical Center is the data provider."
)

XRAYDAR_ATTR = (
    "X-Raydar multimodal (Cid, Macpherson et al.; non-commercial research). "
    "https://x-raydar.info / https://huggingface.co/datasets/dnamodel/xraydar-multimodal"
)

XRAYDAR_SKIP_LABELS = {
    "abnormal_non_clinically_important",
    "object",
    "comparison",
    "normal",
    "other",
    "possible_diagnosis",
    "recommendation",
    "technical_issue",
    "undefined_sentence",
}

XRAYDAR_HINTS: dict[str, list[str]] = {
    "hyperexpanded_lungs": ["large volume", "hyperexpand", "hyperinflat", "overexpand"],
    "pleural_abnormality": ["pleural"],
    "pleural_effusion": ["effusion", "pleural fluid"],
    "interstitial_shadowing": ["interstitial", "reticular", "reticul"],
    "apical_fibrosis": ["apical", "scar", "fibrosis"],
    "ground_glass_opacification": ["ground glass", "ground-glass"],
    "cavitating_lung_lesion": ["cavit"],
    "parenchymal_lesion": ["lesion", "nodule", "mass", "opacity", "opacification"],
    "paratracheal_hilar_enlargement": ["hilar", "paratracheal", "mediastinal"],
    "upper_lobe_blood_diversion": ["upper lobe blood", "diversion", "cephalisation", "cephalization"],
    "rib_lesion": ["rib"],
    "rib_fracture": ["rib", "fracture"],
    "clavicle_fracture": ["clavicle", "fracture"],
    "spinal_abnormality": ["spine", "vertebral", "scolio"],
    "scoliosis": ["scolio", "spine", "vertebral"],
    "pneumoperitoneum": ["pneumoperitoneum", "free air"],
    "subcutaneous_emphysema": ["subcutaneous"],
    "cardiomegaly": ["cardiomegaly", "heart size", "cardiac silhouette", "enlarged heart"],
    "consolidation": ["consolidat", "airspace opac", "lobar opac"],
    "atelectasis": ["atelecta", "collapse", "volume loss"],
    "pneumothorax": ["pneumothorax"],
    "emphysema": ["emphysema"],
    "bulla": ["bulla", "bullae"],
    "aortic_calcification": ["aortic", "calcification", "vascular calc"],
    "mediastinum_widened": ["widened mediastin", "mediastinal width"],
    "mediastinum_displaced": ["mediastinal shift", "mediastinum displaced", "mediastinal displacement"],
    "left_upper_lobe_collapse": ["left upper", "lu collapse", "left upper lobe"],
    "left_lower_lobe_collapse": ["left lower", "ll collapse", "left lower lobe"],
    "right_upper_lobe_collapse": ["right upper", "ru collapse", "right upper lobe"],
    "right_lower_lobe_collapse": ["right lower", "rl collapse", "right lower lobe"],
    "right_middle_lobe_collapse": ["right middle", "rm collapse", "middle lobe"],
}

# Sentences that deny or downplay the finding — reject for active labels.
XRAYDAR_NEGATION_RE = re.compile(
    r"\b("
    r"no |not |without |clear of |generally clear| lungs are clear|"
    r"no evidence|no significant|no focal|no acute|"
    r"unchanged|stable|resolved|improved|reduced slightly|if anything,? reduced|"
    r"may be old|could be due to|which could be|"
    r"accounts for|think accounts"
    r")\b",
    re.I,
)

# If another finding label's core hint dominates the sentence, reject unless target wins.
XRAYDAR_CROSS_LABEL: dict[str, list[str]] = {
    "consolidation": ["interstitial shadowing", "interstitial", "effusion", "cardiomegaly"],
    "atelectasis": ["consolidation", "effusion", "interstitial"],
    "pleural_effusion": ["consolidation", "atelecta", "cardiomegaly"],
    "interstitial_shadowing": ["consolidation", "effusion", "nodule"],
    "cardiomegaly": ["consolidation", "effusion", "pneumothorax"],
    "parenchymal_lesion": ["calcified nodule at left upper", "pleural"],
}


def clamp01(n: float) -> float:
    return max(0.0, min(1.0, float(n)))


def box_from_xyxy(
    x1: float, y1: float, x2: float, y2: float, width: float | None, height: float | None
) -> dict[str, float] | None:
    """Normalize absolute or already-normalized xyxy into {x,y,w,h} in 0–1."""
    if width and height and width > 1.5 and height > 1.5:
        # pixel coords
        x1, x2 = x1 / width, x2 / width
        y1, y2 = y1 / height, y2 / height
    elif max(x1, y1, x2, y2) > 1.5:
        # pixels without image size — skip
        return None

    x = clamp01(min(x1, x2))
    y = clamp01(min(y1, y2))
    w = clamp01(max(x1, x2)) - x
    h = clamp01(max(y1, y2)) - y
    if w < 0.005 or h < 0.005:
        return None
    return {"x": x, "y": y, "w": w, "h": h}


def box_area_norm(b: dict[str, float]) -> float:
    return b["w"] * b["h"]


def box_center_norm(b: dict[str, float]) -> tuple[float, float]:
    return (b["x"] + b["w"] / 2, b["y"] + b["h"] / 2)


def filter_outlier_boxes(boxes: list[dict[str, float]]) -> list[dict[str, float]]:
    """Drop tiny distant boxes that inflate unions (e.g. marker vs main effusion)."""
    if len(boxes) <= 1:
        return boxes
    areas = [box_area_norm(b) for b in boxes]
    max_area = max(areas)
    primary = boxes[areas.index(max_area)]
    pcx, pcy = box_center_norm(primary)
    kept: list[dict[str, float]] = []
    for b in boxes:
        area = box_area_norm(b)
        if area >= 0.15 * max_area:
            kept.append(b)
            continue
        cx, cy = box_center_norm(b)
        dist = ((cx - pcx) ** 2 + (cy - pcy) ** 2) ** 0.5
        if dist < 0.2:
            kept.append(b)
    return kept if kept else [primary]


def primary_box(boxes: list[dict[str, float]]) -> dict[str, float]:
    return max(boxes, key=box_area_norm)


def teaching_targets(boxes: list[dict[str, float]]) -> tuple[dict[str, float], list[dict[str, float]]]:
    """Primary = largest region; truths = all non-outlier annotator boxes."""
    filtered = filter_outlier_boxes(boxes)
    return primary_box(filtered), filtered


def union_box(boxes: list[dict[str, float]]) -> dict[str, float] | None:
    if not boxes:
        return None
    x1 = min(b["x"] for b in boxes)
    y1 = min(b["y"] for b in boxes)
    x2 = max(b["x"] + b["w"] for b in boxes)
    y2 = max(b["y"] + b["h"] for b in boxes)
    return {"x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1}


def pick_sentence(finding: dict[str, Any]) -> str | None:
    for key in (
        "sentence_en",
        "sentence",
        "text_en",
        "text",
        "finding_en",
        "finding",
        "phrase_en",
        "phrase",
        "description",
        "report",
    ):
        val = finding.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    labels = finding.get("labels")
    if isinstance(labels, str) and labels.strip():
        return f"There is {labels.strip().lower()}."
    if isinstance(labels, list) and labels:
        joined = ", ".join(str(x) for x in labels if x)
        if joined:
            return f"There is {joined.lower()}."
    return None


def extract_boxes(finding: dict[str, Any], img_w: float | None, img_h: float | None) -> list[dict[str, float]]:
    raw = finding.get("boxes") or finding.get("bounding_boxes") or finding.get("bbox") or []
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list):
        return []

    out: list[dict[str, float]] = []
    for b in raw:
        if not isinstance(b, dict):
            continue
        if {"x", "y", "w", "h"} <= b.keys():
            box = {
                "x": clamp01(b["x"]),
                "y": clamp01(b["y"]),
                "w": clamp01(b["w"]),
                "h": clamp01(b["h"]),
            }
            if box["w"] >= 0.005 and box["h"] >= 0.005:
                out.append(box)
            continue
        if {"x_min", "y_min", "x_max", "y_max"} <= b.keys():
            box = box_from_xyxy(b["x_min"], b["y_min"], b["x_max"], b["y_max"], img_w, img_h)
            if box:
                out.append(box)
            continue
        if {"xmin", "ymin", "xmax", "ymax"} <= b.keys():
            box = box_from_xyxy(b["xmin"], b["ymin"], b["xmax"], b["ymax"], img_w, img_h)
            if box:
                out.append(box)
            continue
        if all(k in b for k in ("x1", "y1", "x2", "y2")):
            box = box_from_xyxy(b["x1"], b["y1"], b["x2"], b["y2"], img_w, img_h)
            if box:
                out.append(box)
    return out


def iter_padchest_entries(data: Any) -> list[dict[str, Any]]:
    if isinstance(data, list):
        return [e for e in data if isinstance(e, dict)]
    if isinstance(data, dict):
        # either keyed by image id, or a wrapper with "images"/"studies"
        for key in ("images", "studies", "data", "reports"):
            if isinstance(data.get(key), list):
                return [e for e in data[key] if isinstance(e, dict)]
        return [e for e in data.values() if isinstance(e, dict)]
    raise SystemExit("Unsupported PadChest JSON (expected list or dict)")


def build_from_padchest(json_path: Path, images_dir: Path | None, limit: int, seed: int) -> list[dict[str, Any]]:
    data = json.loads(json_path.read_text(encoding="utf-8"))
    entries = iter_padchest_entries(data)
    drills: list[dict[str, Any]] = []

    for entry in entries:
        image_id = (
            entry.get("ImageID")
            or entry.get("image_id")
            or entry.get("image")
            or entry.get("filename")
        )
        if not image_id:
            continue
        image_id = str(image_id)
        img_w = entry.get("width") or entry.get("ImageWidth")
        img_h = entry.get("height") or entry.get("ImageHeight")

        findings = entry.get("findings") or entry.get("positive_findings") or []
        if not isinstance(findings, list):
            continue

        for fi, finding in enumerate(findings):
            if not isinstance(finding, dict):
                continue
            cue = pick_sentence(finding)
            boxes = extract_boxes(finding, img_w, img_h)
            if not boxes:
                continue
            truth, truths = teaching_targets(boxes)
            if not cue:
                continue
            drills.append(
                {
                    "id": f"padchest-{Path(image_id).stem}-{fi}",
                    "source": "padchest-gr",
                    "modality": "CXR",
                    "image": f"/drills/{Path(image_id).name}",
                    "image_file": image_id,
                    "cue": cue,
                    "truth": truth,
                    "truths": truths,
                    "attribution": "PadChest-GR (research use; BIMCV)",
                }
            )

    rng = random.Random(seed)
    rng.shuffle(drills)
    if limit > 0:
        drills = drills[:limit]

    if images_dir:
        copy_images(drills, images_dir)
    return drills


VINDR_TEMPLATES = {
    "aortic enlargement": "There is aortic enlargement.",
    "atelectasis": "There is atelectasis.",
    "calcification": "There is calcification.",
    "cardiomegaly": "There is cardiomegaly.",
    "consolidation": "There is consolidation.",
    "ild": "There are interstitial lung disease changes.",
    "infiltration": "There is infiltration.",
    "lung opacity": "There is a lung opacity.",
    "nodule/mass": "There is a nodule or mass.",
    "other lesion": "There is a focal lesion.",
    "pleural effusion": "There is a pleural effusion.",
    "pleural thickening": "There is pleural thickening.",
    "pneumothorax": "There is a pneumothorax.",
    "pulmonary fibrosis": "There are findings of pulmonary fibrosis.",
}


def build_from_vindr(ann_path: Path, images_dir: Path | None, limit: int, seed: int) -> list[dict[str, Any]]:
    # Group boxes by (image_id, class_name)
    groups: dict[tuple[str, str], list[dict[str, float]]] = {}
    with ann_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            image_id = (row.get("image_id") or "").strip()
            label = (row.get("class_name") or "").strip()
            if not image_id or not label or label.lower() == "no finding":
                continue
            try:
                x1 = float(row["x_min"])
                y1 = float(row["y_min"])
                x2 = float(row["x_max"])
                y2 = float(row["y_max"])
            except (KeyError, ValueError):
                continue
            # VinDr boxes are in pixel space; normalize later if we know size.
            # Many exports are already on DICOM pixel grid; without size we keep
            # relative by reading image when copying. Store absolute for now.
            groups.setdefault((image_id, label), []).append(
                {"_abs": True, "x1": x1, "y1": y1, "x2": x2, "y2": y2}
            )

    drills: list[dict[str, Any]] = []
    for (image_id, label), abs_boxes in groups.items():
        cue = VINDR_TEMPLATES.get(label.lower(), f"There is {label.lower()}.")
        # Defer normalization until we can read image size
        drills.append(
            {
                "id": f"vindr-{image_id}-{label.lower().replace(' ', '-')}",
                "source": "vindr-cxr",
                "modality": "CXR",
                "image": f"/drills/{image_id}.jpg",
                "image_file": image_id,
                "cue": cue,
                "_abs_boxes": abs_boxes,
                "attribution": "VinDr-CXR (PhysioNet credentialed access)",
            }
        )

    rng = random.Random(seed)
    rng.shuffle(drills)
    if limit > 0:
        drills = drills[:limit]

    if images_dir:
        finalize_vindr(drills, images_dir)
    else:
        raise SystemExit("VinDr import requires --images so boxes can be normalized")

    return drills


def find_image(images_dir: Path, image_file: str) -> Path | None:
    candidates = [
        images_dir / image_file,
        images_dir / f"{image_file}.jpg",
        images_dir / f"{image_file}.jpeg",
        images_dir / f"{image_file}.png",
        images_dir / f"{image_file}.dicom",
        images_dir / f"{image_file}.dcm",
    ]
    # also search one level deep
    for c in candidates:
        if c.exists():
            return c
    stem = Path(image_file).stem
    for p in images_dir.rglob("*"):
        if p.is_file() and p.stem == stem:
            return p
    return None


def copy_images(drills: list[dict[str, Any]], images_dir: Path) -> None:
    OUT_IMG.mkdir(parents=True, exist_ok=True)
    kept: list[dict[str, Any]] = []
    missing = 0
    for d in drills:
        src = find_image(images_dir, str(d["image_file"]))
        if not src:
            missing += 1
            continue
        dest_name = src.name if src.suffix else f"{src.name}.jpg"
        dest = OUT_IMG / dest_name
        if not dest.exists():
            shutil.copy2(src, dest)
        d["image"] = f"/drills/{dest_name}"
        d.pop("image_file", None)
        kept.append(d)
    drills[:] = kept
    print(f"Copied images for {len(kept)} drills (missing source: {missing})")


def finalize_vindr(drills: list[dict[str, Any]], images_dir: Path) -> None:
    try:
        from PIL import Image
    except ImportError as e:
        raise SystemExit("VinDr import needs Pillow: pip install pillow") from e

    OUT_IMG.mkdir(parents=True, exist_ok=True)
    kept: list[dict[str, Any]] = []
    missing = 0
    for d in drills:
        src = find_image(images_dir, str(d["image_file"]))
        if not src:
            missing += 1
            continue
        with Image.open(src) as im:
            w, h = im.size
            # save a jpeg for the browser if needed
            dest_name = f"{Path(str(d['image_file'])).stem}.jpg"
            dest = OUT_IMG / dest_name
            if not dest.exists():
                rgb = im.convert("RGB")
                rgb.save(dest, quality=92)
            boxes = []
            for b in d.pop("_abs_boxes", []):
                box = box_from_xyxy(b["x1"], b["y1"], b["x2"], b["y2"], w, h)
                if box:
                    boxes.append(box)
            truth, truths = teaching_targets(boxes)
            if not truth:
                continue
            d["image"] = f"/drills/{dest_name}"
            d["truth"] = truth
            d["truths"] = truths
            d.pop("image_file", None)
            kept.append(d)
    drills[:] = kept
    print(f"Prepared {len(kept)} VinDr drills (missing source: {missing})")


def build_from_chestxdet(limit: int, seed: int) -> list[dict[str, Any]]:
    """Stream ChestX-Det from Hugging Face; keep only a small practice pack."""
    try:
        from datasets import load_dataset
        from PIL import Image
    except ImportError as e:
        raise SystemExit(
            "ChestX-Det pull needs: pip install datasets pillow"
        ) from e

    OUT_IMG.mkdir(parents=True, exist_ok=True)
    rng = random.Random(seed)
    # Over-fetch a bit so shuffle still yields `limit` after filtering empties.
    target = limit if limit > 0 else 120
    fetch_cap = max(target * 4, 200)

    print(f"Streaming ChestX-Det (cap {fetch_cap} rows, keep ~{target} drills)…")
    ds = load_dataset("MedOtter/ChestX-Det", split="train", streaming=True)

    pool: list[dict[str, Any]] = []
    for i, row in enumerate(ds):
        if i >= fetch_cap:
            break
        if row.get("is_negative"):
            continue
        raw = row.get("annotation_json")
        if not raw:
            continue
        try:
            ann = json.loads(raw) if isinstance(raw, str) else raw
        except json.JSONDecodeError:
            continue

        syms = ann.get("syms") or []
        boxes_raw = ann.get("boxes") or []
        if not syms or not boxes_raw or len(syms) != len(boxes_raw):
            continue

        image_id = str(row.get("image_id") or ann.get("file_name") or i)
        width = float(row.get("width") or 1024)
        height = float(row.get("height") or 1024)

        # Group boxes by class label on this image
        by_label: dict[str, list[dict[str, float]]] = {}
        for sym, box in zip(syms, boxes_raw):
            label = str(sym).strip()
            if not label or len(box) < 4:
                continue
            nb = box_from_xyxy(box[0], box[1], box[2], box[3], width, height)
            if not nb:
                continue
            by_label.setdefault(label, []).append(nb)

        if not by_label:
            continue

        # Persist image once per source radiograph
        dest_name = f"chestxdet-{image_id}.jpg"
        dest = OUT_IMG / dest_name
        if not dest.exists():
            img = row["image"]
            if not isinstance(img, Image.Image):
                img = Image.open(img)
            img.convert("RGB").save(dest, quality=90)

        for label, boxes in by_label.items():
            truth, truths = teaching_targets(boxes)
            if not truth:
                continue
            cue = CHESTXDET_CUES.get(label, f"There is {label.lower()}.")
            pool.append(
                {
                    "id": f"chestxdet-{image_id}-{label.lower().replace(' ', '-')}",
                    "source": "chestx-det",
                    "modality": "CXR",
                    "image": f"/drills/{dest_name}",
                    "cue": cue,
                    "truth": truth,
                    "truths": truths,
                    "attribution": CHESTXDET_ATTR,
                }
            )

    rng.shuffle(pool)
    if limit > 0:
        pool = pool[:limit]
    print(f"Built {len(pool)} ChestX-Det drills")
    return pool


def _xraydar_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text.strip()) if s.strip()]


def _xraydar_hints(label: str) -> list[str]:
    hints = list(XRAYDAR_HINTS.get(label, []))
    parts = label.replace("_", " ").split()
    hints.append(label.replace("_", " "))
    hints.extend(parts)
    if "collapse" in label:
        hints.extend(["collapse", "atelecta", "lobe"])
    return [h.lower() for h in hints if h]


def _xraydar_distinct_hints(label: str) -> list[str]:
    """Hints long enough to be meaningful in a sentence match."""
    hints = _xraydar_hints(label)
    return [h for h in hints if len(h) >= 4]


def _xraydar_span_fragment(row: dict[str, Any], label: str) -> str | None:
    tokens = row.get("report_tokens") or []
    spans = [s for s in (row.get("report_spans") or []) if s.get("label") == label]
    if not spans or not tokens:
        return None
    span = max(spans, key=lambda s: int(s["end"]) - int(s["start"]))
    frag = " ".join(tokens[int(span["start"]) : int(span["end"]) + 1]).strip()
    return frag if len(frag.split()) >= 2 else None


def _xraydar_sentence_for_span(text: str, fragment: str) -> str | None:
    words = [w.strip(".,;:").lower() for w in fragment.split() if len(w.strip(".,;:")) > 3]
    if len(words) < 2:
        return None
    best: str | None = None
    best_overlap = 0
    for sent in _xraydar_sentences(text):
        low = sent.lower()
        overlap = sum(1 for w in words[:6] if w in low)
        if overlap >= 2 and overlap >= best_overlap:
            best_overlap = overlap
            best = sent
    return best


def _xraydar_cue_rejects(sentence: str, label: str) -> bool:
    low = sentence.lower()
    if XRAYDAR_NEGATION_RE.search(sentence):
        return True
    cross = XRAYDAR_CROSS_LABEL.get(label, [])
    target = _xraydar_distinct_hints(label)
    target_hits = sum(1 for h in target if h in low)
    cross_hits = sum(1 for c in cross if c in low)
    if cross_hits > 0 and target_hits <= cross_hits:
        return True
    return False


def _xraydar_score_sentence(sentence: str, label: str) -> int:
    low = sentence.lower()
    hints = _xraydar_hints(label)
    return sum(1 for h in hints if h in low)


def _xraydar_cue(row: dict[str, Any], label: str) -> tuple[str, int, str] | None:
    """Return (cue, score, method) or None if no trustworthy pairing."""
    text = (row.get("report_text") or "").strip()
    if not text:
        return None

    required = _xraydar_distinct_hints(label)
    if not required:
        required = _xraydar_hints(label)
    if not required:
        return None

    fragment = _xraydar_span_fragment(row, label)
    if fragment:
        span_sent = _xraydar_sentence_for_span(text, fragment)
        if span_sent and not _xraydar_cue_rejects(span_sent, label):
            score = _xraydar_score_sentence(span_sent, label)
            if score >= 1 and len(span_sent) > 15:
                return span_sent, score + 2, "span"

    def ok(sent: str) -> bool:
        if len(sent) <= 15:
            return False
        low = sent.lower()
        if not any(h in low for h in required):
            return False
        return not _xraydar_cue_rejects(sent, label)

    best: str | None = None
    best_score = 0
    for sent in _xraydar_sentences(text):
        if not ok(sent):
            continue
        score = _xraydar_score_sentence(sent, label)
        if score > best_score or (score == best_score and best and len(sent) > len(best)):
            best_score = score
            best = sent

    if not best or best_score < 2:
        return None
    return best, best_score, "hint"


def build_from_xraydar(
    limit: int, seed: int, ann_path: Path | None = None, min_cue_score: int = 2
) -> list[dict[str, Any]]:
    """Build drills from X-Raydar multimodal: real report sentences + boxes."""
    try:
        from PIL import Image
    except ImportError as e:
        raise SystemExit("X-Raydar build needs Pillow: pip install pillow") from e

    import urllib.request

    ann = ann_path or (ROOT / "data" / "raw" / "xraydar" / "annotations.jsonl")
    if not ann.exists():
        raise SystemExit(
            f"Missing {ann}. Download annotations.jsonl from "
            "https://huggingface.co/datasets/dnamodel/xraydar-multimodal"
        )

    rows = [json.loads(line) for line in ann.read_text(encoding="utf-8").splitlines() if line.strip()]
    rng = random.Random(seed)
    pool: list[dict[str, Any]] = []
    rejected = 0

    for row in rows:
        xray_id = str(row.get("xray_id") or "")
        image_file = str(row.get("image_file") or "")
        if not xray_id or not image_file:
            continue

        by_label: dict[str, list[dict[str, Any]]] = {}
        for b in row.get("bounding_boxes") or []:
            label = str(b.get("label") or "")
            if not label or label in XRAYDAR_SKIP_LABELS:
                continue
            by_label.setdefault(label, []).append(b)

        for label, blist in by_label.items():
            paired = _xraydar_cue(row, label)
            if not paired:
                rejected += 1
                continue
            cue, cue_score, cue_method = paired
            if cue_score < min_cue_score:
                rejected += 1
                continue
            # Prefer one annotator's boxes to avoid double-counting disagreement.
            by_ann: dict[str, list[dict[str, Any]]] = {}
            for b in blist:
                by_ann.setdefault(str(b.get("annotator") or "na"), []).append(b)
            chosen = max(by_ann.values(), key=len)
            abs_boxes = [
                {
                    "x1": float(b["x_min"]),
                    "y1": float(b["y_min"]),
                    "x2": float(b["x_max"]),
                    "y2": float(b["y_max"]),
                }
                for b in chosen
                if all(k in b for k in ("x_min", "y_min", "x_max", "y_max"))
            ]
            if not abs_boxes:
                continue
            pool.append(
                {
                    "id": f"xraydar-{xray_id}-{label}",
                    "source": "xraydar",
                    "modality": "CXR",
                    "image_file": image_file,
                    "xray_id": xray_id,
                    "cue": cue,
                    "_cue_score": cue_score,
                    "_cue_method": cue_method,
                    "_abs_boxes": abs_boxes,
                    "attribution": XRAYDAR_ATTR,
                }
            )

    pool.sort(key=lambda d: (-int(d["_cue_score"]), d["id"]))
    if limit > 0 and len(pool) > limit:
        head = pool[: max(limit * 3, limit)]
        rng.shuffle(head)
        pool = head[:limit]
    else:
        rng.shuffle(pool)

    print(f"X-Raydar cue filter: kept {len(pool)} candidates, rejected {rejected} weak pairings")

    OUT_IMG.mkdir(parents=True, exist_ok=True)
    raw_img_dir = ROOT / "data" / "raw" / "xraydar"
    kept: list[dict[str, Any]] = []
    base = "https://huggingface.co/datasets/dnamodel/xraydar-multimodal/resolve/main/"

    for i, d in enumerate(pool):
        rel = str(d["image_file"])
        src = raw_img_dir / rel
        if not src.exists():
            src.parent.mkdir(parents=True, exist_ok=True)
            url = base + rel
            print(f"[{i + 1}/{len(pool)}] download {rel}")
            try:
                req = urllib.request.Request(url, headers={"User-Agent": "pixel2practice/0.1"})
                with urllib.request.urlopen(req, timeout=120) as resp, src.open("wb") as out:
                    out.write(resp.read())
            except Exception as e:
                print(f"  skip {rel}: {e}")
                continue

        dest_name = f"xraydar-{d['xray_id']}.jpg"
        dest = OUT_IMG / dest_name
        with Image.open(src) as im:
            w, h = im.size
            if not dest.exists():
                im.convert("RGB").save(dest, quality=88)
            boxes = []
            for b in d.pop("_abs_boxes", []):
                box = box_from_xyxy(b["x1"], b["y1"], b["x2"], b["y2"], w, h)
                if box:
                    boxes.append(box)
        truth, truths = teaching_targets(boxes)
        if not truth:
            continue
        d["image"] = f"/drills/{dest_name}"
        d["truth"] = truth
        d["truths"] = truths
        d.pop("image_file", None)
        d.pop("xray_id", None)
        d.pop("_cue_score", None)
        d.pop("_cue_method", None)
        kept.append(d)

    print(f"Built {len(kept)} X-Raydar drills")
    return kept


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--xraydar", action="store_true", help="X-Raydar multimodal (report sentences + boxes)")
    p.add_argument("--chestxdet", action="store_true", help="Stream open ChestX-Det from Hugging Face")
    p.add_argument("--padchest-json", type=Path, help="PadChest-GR / RadGame-style localize JSON")
    p.add_argument("--vindr-annotations", type=Path, help="VinDr annotations_train.csv")
    p.add_argument("--images", type=Path, help="Directory of source images")
    p.add_argument("--limit", type=int, default=120, help="Max drills to emit (0 = all / large)")
    p.add_argument("--min-cue-score", type=int, default=2, help="X-Raydar: min hint score for cue↔box pairing")
    p.add_argument("--seed", type=int, default=7)
    p.add_argument("--out", type=Path, default=OUT_JSON)
    args = p.parse_args()

    modes = sum(
        [
            bool(args.xraydar),
            bool(args.chestxdet),
            bool(args.padchest_json),
            bool(args.vindr_annotations),
        ]
    )
    if modes != 1:
        raise SystemExit(
            "Pass exactly one of --xraydar, --chestxdet, --padchest-json, or --vindr-annotations"
        )

    if args.xraydar:
        drills = build_from_xraydar(args.limit, args.seed, min_cue_score=args.min_cue_score)
    elif args.chestxdet:
        drills = build_from_chestxdet(args.limit, args.seed)
    elif args.padchest_json:
        drills = build_from_padchest(args.padchest_json, args.images, args.limit, args.seed)
    else:
        drills = build_from_vindr(args.vindr_annotations, args.images, args.limit, args.seed)

    if not drills:
        raise SystemExit("No drills produced. Check JSON/CSV fields and image paths.")

    # strip internal keys
    clean = []
    for d in drills:
        clean.append(
            {
                "id": d["id"],
                "source": d["source"],
                "modality": d["modality"],
                "image": d["image"],
                "cue": d["cue"],
                "truth": d["truth"],
                "truths": d.get("truths") or [d["truth"]],
                "attribution": d["attribution"],
            }
        )

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(clean, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {len(clean)} drills → {args.out}")
    print("Restart or refresh the app; it loads /drills.json when present.")


if __name__ == "__main__":
    main()
