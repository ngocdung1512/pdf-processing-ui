# Models to download (pre-install)

This document lists **all models** used by the project so you can download them in advance.  
**Excluded:** `doclayout_yolo_docstructbench_imgsz1024.pt` (you already have it).

---

## 1. Qwen2.5-VL-3B (OCR nâng cao – giữ bố cục)

**Used by:** Main conversion for **scan PDFs** (pipeline: `convert_pdf_gpu.py` → `process_pdf_to_docx` with `enable_ocr=True`).

| Item | Value |
|------|--------|
| **Hugging Face model ID** | `Qwen/Qwen2.5-VL-3B-Instruct` |
| **Default local path in project** | `Qwen2.5-VL-3B/` (project root) |
| **Size** | ~7GB (e.g. 2 safetensors files) |

**How to pre-download:**

**Option A – Python one-liner (recommended on Windows)**  
With `conversion_env` activated, from project root:

```bash
python -c "from huggingface_hub import snapshot_download; snapshot_download('Qwen/Qwen2.5-VL-3B-Instruct', local_dir='Qwen2.5-VL-3B')"
```

*(On Windows, `huggingface-cli` may not be in PATH; use this Python form instead.)*

**Option B – Hugging Face CLI**  
With venv activated: `huggingface-cli download Qwen/Qwen2.5-VL-3B-Instruct --local-dir Qwen2.5-VL-3B`  
If the command is not found, use: `python -m huggingface_hub.cli.download Qwen/Qwen2.5-VL-3B-Instruct --local-dir Qwen2.5-VL-3B`

**Option C – Manual**  
- Open: https://huggingface.co/Qwen/Qwen2.5-VL-3B-Instruct  
- Download all repo files into a folder named `Qwen2.5-VL-3B` in the project root.

If you put the model elsewhere, pass its path when running (e.g. `--ocr-model D:\path\to\Qwen2.5-VL-3B` in `process_pdf_to_docx` or set the same path in the API/config).

---

## 2. VietOCR – vgg_transformer.pth (OCR cơ bản – scan)

**Used by:** **Basic OCR** for scan PDFs via `ocr_basic.py` (YOLO + VietOCR), e.g. endpoint `/convert_basic`.

| Item | Value |
|------|--------|
| **File** | `vgg_transformer.pth` |
| **URL** | https://vocr.vn/data/vietocr/vgg_transformer.pth |
| **Config name in code** | `Cfg.load_config_from_name('vgg_transformer')` |

**How to pre-download:**

- Download: https://vocr.vn/data/vietocr/vgg_transformer.pth  
- Save to project root or a folder of your choice, e.g. `D:\pdf-processing-ui\vgg_transformer.pth`.

**Use local weight when running:**

- CLI: `python ocr_basic.py <pdf> --output out.docx --ocr-weight vgg_transformer.pth`  
- If you omit `--ocr-weight`, the code will use the URL above on first run (downloads to VietOCR cache).

---

## 3. PaddleOCR (OCR cơ bản – text extraction from scan)

**Used by:** `api.py` → `get_basic_ocr()` / `ocr_basic_scan_pdf_to_text()` when extracting plain text from scan PDFs (no layout).

| Item | Value |
|------|--------|
| **Package** | `paddleocr` (already in `requirements.txt`) |
| **Behavior** | Downloads detection + recognition + angle classification models on **first use** (e.g. when first calling PaddleOCR with `lang="vi"`, `use_angle_cls=True`). |
| **Default cache** | `~/.paddleocr/` (often on C:). |

**Pre-download:**  
No separate “model package” to download. Run the app once and trigger a call that uses PaddleOCR (e.g. use “OCR cơ bản” on a scan PDF); the first run will download the models.  
If you need cache on the same drive as the project (e.g. D:), check PaddleOCR docs for `model_dir` or env vars (e.g. some versions support a custom base dir).

---

## Summary

| Model | Purpose | Pre-download |
|--------|----------|----------------|
| **doclayout_yolo_docstructbench_imgsz1024.pt** | Layout detection (YOLO) | You have it — skip. |
| **Qwen2.5-VL-3B-Instruct** | OCR nâng cao (scan, keep layout) | Yes — Hugging Face (see above). |
| **vgg_transformer.pth** (VietOCR) | OCR cơ bản (scan, ocr_basic.py) | Optional — download from vocr.vn or let VietOCR download on first run. |
| **PaddleOCR (vi + cls)** | OCR cơ bản (plain text from scan) | Auto on first use; no manual file needed. |

To have everything ready before running:

1. **Qwen2.5-VL-3B** → download to `Qwen2.5-VL-3B/` in project root (or set `--ocr-model` to that path).  
2. **vgg_transformer.pth** → download to project root and use `--ocr-weight vgg_transformer.pth` when calling `ocr_basic.py`.  
3. **PaddleOCR** → use the app once so it can download its models on first use.
