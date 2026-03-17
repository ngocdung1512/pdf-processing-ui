"""
Shared YOLO + PDF utilities for the pipeline.

This module is imported by `process_pdf_to_docx.py`.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import List

import cv2
import numpy as np
import torch

# Try to import PyMuPDF for PDF to image conversion
try:
    import fitz  # PyMuPDF

    HAS_FITZ = True
except ImportError:
    HAS_FITZ = False
    try:
        from pdf2image import convert_from_path

        HAS_PDF2IMAGE = True
    except ImportError:
        HAS_PDF2IMAGE = False

# Import YOLOv10 from doclayout_yolo
try:
    from doclayout_yolo import YOLOv10
except ImportError as e:
    raise ImportError(
        "doclayout_yolo is required. Install DocLayout-YOLO (editable) in your env."
    ) from e


def pdf_to_images_pymupdf(pdf_path: str, dpi: int = 200) -> List[np.ndarray]:
    """Convert PDF pages to images using PyMuPDF."""
    doc = fitz.open(pdf_path)
    images: List[np.ndarray] = []

    for page_num in range(len(doc)):
        page = doc[page_num]
        mat = fitz.Matrix(dpi / 72, dpi / 72)
        pix = page.get_pixmap(matrix=mat)
        img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(
            pix.height, pix.width, pix.n
        )
        if pix.n == 4:  # RGBA
            img = cv2.cvtColor(img, cv2.COLOR_RGBA2RGB)
        elif pix.n == 1:  # Grayscale
            img = cv2.cvtColor(img, cv2.COLOR_GRAY2RGB)
        images.append(img)

    doc.close()
    return images


def pdf_to_images_pdf2image(pdf_path: str, dpi: int = 200) -> List[np.ndarray]:
    """Convert PDF pages to images using pdf2image."""
    pil_images = convert_from_path(pdf_path, dpi=dpi)
    images: List[np.ndarray] = []
    for pil_img in pil_images:
        img = np.array(pil_img)
        if len(img.shape) == 3:
            img = cv2.cvtColor(img, cv2.COLOR_RGB2BGR)
        images.append(img)
    return images


def pdf_to_images(pdf_path: str, dpi: int = 200) -> List[np.ndarray]:
    """Convert PDF to images using available library."""
    if HAS_FITZ:
        return pdf_to_images_pymupdf(pdf_path, dpi)
    if "HAS_PDF2IMAGE" in globals() and HAS_PDF2IMAGE:
        return pdf_to_images_pdf2image(pdf_path, dpi)
    raise RuntimeError(
        "No PDF to image converter available. Install PyMuPDF or pdf2image."
    )


def detect_bboxes(model: YOLOv10, image: np.ndarray, imgsz: int = 1024, conf: float = 0.1) -> dict:
    """Detect bounding boxes in image using YOLO model."""
    if len(image.shape) == 3 and image.shape[2] == 3:
        image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
    else:
        image_rgb = image

    det_res = model.predict(
        image_rgb,
        imgsz=imgsz,
        conf=conf,
        device="cuda" if torch.cuda.is_available() else "cpu",
    )

    result = det_res[0]

    boxes = result.boxes.xyxy.cpu().numpy() if result.boxes is not None else np.array([])
    scores = result.boxes.conf.cpu().numpy() if result.boxes is not None else np.array([])
    class_ids = (
        result.boxes.cls.cpu().numpy().astype(int) if result.boxes is not None else np.array([])
    )
    class_names = [result.names[i] for i in class_ids] if len(class_ids) > 0 else []

    return {
        "boxes": boxes,
        "scores": scores,
        "class_ids": class_ids,
        "class_names": class_names,
        "result": result,
    }


def crop_bbox(image: np.ndarray, bbox: np.ndarray, padding: int = 10) -> np.ndarray:
    """Crop bounding box from image with padding."""
    h, w = image.shape[:2]
    x1, y1, x2, y2 = bbox.astype(int)

    x1 = max(0, x1 - padding)
    y1 = max(0, y1 - padding)
    x2 = min(w, x2 + padding)
    y2 = min(h, y2 + padding)

    cropped = image[y1:y2, x1:x2]

    # Minimum size for downstream OCR
    min_size = 32
    if cropped.size and (cropped.shape[0] < min_size or cropped.shape[1] < min_size):
        scale = max(min_size / cropped.shape[0], min_size / cropped.shape[1])
        new_h = int(cropped.shape[0] * scale)
        new_w = int(cropped.shape[1] * scale)
        cropped = cv2.resize(cropped, (new_w, new_h), interpolation=cv2.INTER_CUBIC)

    return cropped

