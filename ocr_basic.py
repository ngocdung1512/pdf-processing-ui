from examples.ocr_basic import main


def get_device() -> str:
    """
    Chọn device cho YOLO + VietOCR.
    - Ưu tiên GPU ('cuda' / 'cuda:0') nếu torch.cuda.available().
    - Nếu không có GPU thì mới rơi về 'cpu'.
    """
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


def get_gpu_memory_gib() -> float:
    """Return GPU 0 total memory in GiB, or 0 if no CUDA."""
    if not torch.cuda.is_available():
        return 0.0
    try:
        return torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
    except Exception:
        return 0.0


def resize_image_for_qwen(image_np, max_size: int = 1024):
    """Resize image so longer side <= max_size to reduce VRAM. Returns PIL Image."""
    h, w = image_np.shape[:2]
    if max(h, w) <= max_size:
        return Image.fromarray(cv2.cvtColor(image_np, cv2.COLOR_BGR2RGB))
    scale = max_size / max(h, w)
    new_w, new_h = int(w * scale), int(h * scale)
    resized = cv2.resize(image_np, (new_w, new_h), interpolation=cv2.INTER_AREA)
    return Image.fromarray(cv2.cvtColor(resized, cv2.COLOR_BGR2RGB))


def sort_bboxes_by_position(bboxes):
    """Sort bboxes by natural reading order: top-to-bottom, left-to-right"""
    if not bboxes:
        return []

    # Calculate median bbox height for tolerance
    bbox_heights = [bbox['y2'] - bbox['y1'] for bbox in bboxes if 'y1' in bbox and 'y2' in bbox]
    median_height = sorted(bbox_heights)[len(bbox_heights) // 2] if bbox_heights else 30

    # Sort primarily by Y, then by X
    sorted_by_y = sorted(bboxes, key=lambda b: (b['y1'], b['center_y'], b['x1']))
    
    strips = []
    current_strip = []
    last_y = None
    
    # Tolerance for clustering into same row
    strict_tolerance = max(median_height * 0.4, 15)

    for bbox in sorted_by_y:
        bbox_y1 = bbox['y1']
        
        if last_y is None:
            current_strip.append(bbox)
            last_y = bbox_y1
        else:
            y_diff = abs(bbox_y1 - last_y)
            if y_diff <= strict_tolerance:
                current_strip.append(bbox)
                last_y = min(last_y, bbox_y1)
            else:
                if current_strip:
                    current_strip.sort(key=lambda b: (b['x1'], b['center_x']))
                    strips.append(current_strip)
                current_strip = [bbox]
                last_y = bbox_y1
    
    if current_strip:
        current_strip.sort(key=lambda b: (b['x1'], b['center_x']))
        strips.append(current_strip)
    
    # Flatten strips
    result = []
    for strip in strips:
        result.extend(strip)
    
    return result


def get_tight_text_boxes(image_np):
    """Find tight horizontal single-line bounding boxes using dynamic projection thresholds."""
    import cv2
    import numpy as np
    
    gray = cv2.cvtColor(image_np, cv2.COLOR_BGR2GRAY)
    _, thresh = cv2.threshold(gray, 200, 255, cv2.THRESH_BINARY_INV)
    
    # 1. Horizontal projection to separate lines
    proj = np.sum(thresh, axis=1)
    if len(proj) == 0:
        return []
        
    min_val = np.min(proj)
    max_val = np.max(proj)
    # Define threshold 5% above the baseline noise level
    cut_threshold = min_val + (max_val - min_val) * 0.05
    
    line_y_spans = []
    in_line = False
    start_y = 0
    for i, val in enumerate(proj):
        if val > cut_threshold and not in_line:
            in_line = True
            start_y = i
        elif val <= cut_threshold and in_line:
            in_line = False
            line_y_spans.append((max(0, start_y - 2), min(image_np.shape[0], i + 2)))
            
    if in_line:
        line_y_spans.append((max(0, start_y - 2), image_np.shape[0]))
        
    # Filter extraordinarily small noise lines
    line_y_spans = [span for span in line_y_spans if (span[1] - span[0]) > 8]
    if not line_y_spans:
        return [(0, 0, image_np.shape[1], image_np.shape[0])]
        
    # 2. Vertical projection to strip immense horizontal padding
    final_boxes = []
    for (ly1, ly2) in line_y_spans:
        line_strip = thresh[ly1:ly2, :]
        v_proj = np.sum(line_strip, axis=0)
        
        v_min = np.min(v_proj)
        v_max = np.max(v_proj)
        # 2% above noise floor to trim white spaces at sides
        v_thresh = v_min + (v_max - v_min) * 0.02
        
        text_cols = np.where(v_proj > v_thresh)[0]
        if len(text_cols) == 0:
            text_cols = np.where(v_proj > 0)[0]
            if len(text_cols) == 0:
                continue
            
        min_x = text_cols[0]
        max_x = text_cols[-1]
        
        # Add 3 pixels padding so we don't clip the edges of characters
        lx = max(0, min_x - 3)
        lw = min(image_np.shape[1], max_x + 3) - lx
        ly = ly1
        lh = ly2 - ly1
        
        final_boxes.append((lx, ly, lw, lh))
        
    return final_boxes


def process_pdf_to_docx(
    pdf_path: str,
    output_docx: str = None,
    model_path: str = "doclayout_yolo_docstructbench_imgsz1024.pt",
    imgsz: int = 1024,
    conf: float = 0.1,
    dpi: int = 300,
    enable_ocr: bool = True,
    max_pages: int = None,
    ocr_weight: str = None,
    ocr_engine: str = "vietocr",
    ocr_model_path: str = None,
    use_4bit: bool = False,
    qwen_per_page: bool = True,
):
    """Complete pipeline: PDF → Single DOCX. OCR engine: 'vietocr' or 'qwen_vl'.
    When ocr_engine=qwen_vl and qwen_per_page=True: one Qwen call per page (no YOLO), fast text-only."""
    
    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        print(f"Error: PDF file not found: {pdf_path}")
        return None
    
    if output_docx is None:
        output_docx = pdf_path.parent / f"{pdf_path.stem}_reconstructed.docx"
    else:
        output_docx = Path(output_docx)
    
    ocr_engine = (ocr_engine or "vietocr").lower().strip()
    if ocr_engine not in ("vietocr", "qwen_vl"):
        ocr_engine = "vietocr"
    
    use_qwen_per_page = (ocr_engine == "qwen_vl" and qwen_per_page)
    
    print("=" * 80)
    print("COMPLETE PDF PROCESSING PIPELINE (" + ("Qwen2.5-VL (1 page = 1 call, text only)" if use_qwen_per_page else "Qwen2.5-VL" if ocr_engine == "qwen_vl" else "VietOCR") + ")")
    print("=" * 80)
    print(f"PDF: {pdf_path.name}")
    print(f"Output: {output_docx.name}")
    # Show device: prefer GPU when available
    if torch.cuda.is_available():
        gpu_name = torch.cuda.get_device_name(0)
        gpu_mem = torch.cuda.get_device_properties(0).total_memory / (1024 ** 3)
        print(f"Device: GPU ({gpu_name}, {gpu_mem:.1f} GB VRAM)")
    else:
        print("Device: CPU (no CUDA GPU detected)")
    print()
    
    # Step 1: Load YOLO only when not using per-page Qwen (saves time and memory)
    model = None
    device = get_device()
    if not use_qwen_per_page:
        print("[Step 1] Loading YOLO model...")
        model = YOLOv10(str(model_path))
        print(f"  Using device: {device} (GPU ưu tiên, fallback CPU nếu không có)")
        print("  ✓ YOLO Model loaded")
    else:
        print("[Step 1] Skipping YOLO (Qwen per-page mode: text only, 1 call per page)")
    
    # Step 2: Load OCR models if enabled
    detector = None
    qwen_model = None
    processor = None
    if enable_ocr:
        if ocr_engine == "qwen_vl":
            if not QWEN_VL_AVAILABLE:
                print("  ⚠️  Qwen2.5-VL not available (transformers, qwen_vl_utils). Falling back to VietOCR if available.")
                ocr_engine = "vietocr"
            else:
                _root = Path(__file__).resolve().parent
                qwen_path = ocr_model_path or str(_root / "Qwen2.5-VL-3B")
                print(f"\n[Step 2] Loading Qwen2.5-VL OCR model from '{qwen_path}'...")
                qwen_loaded = False
                try_4bit = use_4bit
                try:
                    gpu_gib = get_gpu_memory_gib()
                    try_4bit = use_4bit or (gpu_gib > 0 and gpu_gib < 18)
                    if try_4bit and not use_4bit:
                        print(f"  Auto-enabling 4-bit quantization (GPU {gpu_gib:.1f} GiB)")
                    model_kwargs = {"device_map": "auto"}
                    if try_4bit:
                        try:
                            from transformers import BitsAndBytesConfig
                            model_kwargs["quantization_config"] = BitsAndBytesConfig(
                                load_in_4bit=True,
                                bnb_4bit_compute_dtype=torch.float16,
                                bnb_4bit_quant_type="nf4",
                                bnb_4bit_use_double_quant=True,
                            )
                            print("  Using 4-bit quantization")
                        except Exception as _:
                            print("  4-bit config failed, loading in fp16")
                            model_kwargs.pop("quantization_config", None)
                            model_kwargs["torch_dtype"] = torch.float16
                    else:
                        model_kwargs["torch_dtype"] = torch.float16
                    qwen_model = Qwen2_5_VLForConditionalGeneration.from_pretrained(qwen_path, **model_kwargs)
                    processor = AutoProcessor.from_pretrained(qwen_path)
                    processor.tokenizer.padding_side = "left"
                    print("  ✓ Qwen2.5-VL OCR model loaded")
                    qwen_loaded = True
                except Exception as e:
                    # Often "No package metadata for bitsandbytes" when 4-bit requested; retry fp16
                    if try_4bit and ("bitsandbytes" in str(e).lower() or "metadata" in str(e).lower()):
                        print(f"  4-bit failed ({e}), retrying in fp16...")
                        try:
                            model_kwargs = {"device_map": "auto", "torch_dtype": torch.float16}
                            qwen_model = Qwen2_5_VLForConditionalGeneration.from_pretrained(qwen_path, **model_kwargs)
                            processor = AutoProcessor.from_pretrained(qwen_path)
                            processor.tokenizer.padding_side = "left"
                            print("  ✓ Qwen2.5-VL OCR model loaded (fp16)")
                            qwen_loaded = True
                        except Exception as e2:
                            print(f"  ⚠️  Failed to load Qwen2.5-VL: {e2}. Falling back to VietOCR.")
                    if not qwen_loaded:
                        print(f"  ⚠️  Failed to load Qwen2.5-VL: {e}. Falling back to VietOCR.")
                        ocr_engine = "vietocr"
                        qwen_model = None
                        processor = None
                        if model is None:
                            print("  Loading YOLO model for VietOCR pipeline...")
                            model = YOLOv10(str(model_path))
                            print("  ✓ YOLO model loaded")
        if ocr_engine == "vietocr":
            if not VIETOCR_AVAILABLE:
                print("  ⚠️  VietOCR not available, skipping OCR step")
                enable_ocr = False
            else:
                print("\n[Step 2] Loading VietOCR model...")
                config = Cfg.load_config_from_name('vgg_transformer')
                config['cnn']['pretrained'] = False
                config['device'] = f"{device}:0" if device.startswith("cuda") else "cpu"
                if ocr_weight and Path(ocr_weight).exists():
                    print(f"  Using local OCR weights: {ocr_weight}")
                    config['weights'] = str(ocr_weight)
                else:
                    config['weights'] = 'https://vocr.vn/data/vietocr/vgg_transformer.pth'
                detector = Predictor(config)
                print("  ✓ VietOCR model loaded")
    
    # Step 3: Convert PDF to images
    print(f"\n[Step 3] Converting PDF to images (DPI={dpi})...")
    images = pdf_to_images(str(pdf_path), dpi=dpi)
    total_pages = len(images)
    if max_pages is not None and max_pages > 0:
        images = images[:max_pages]
        print(f"  ✓ Converted {total_pages} pages, processing first {len(images)} pages")
    else:
        print(f"  ✓ Converted {len(images)} pages to images")
    
    # ----- Fast path: Qwen per-page (1 call per page, text only, no YOLO) — sequential + prep thread -----
    if use_qwen_per_page and qwen_model is not None and processor is not None and enable_ocr:
        # Resize images to this max size to reduce VRAM (vision encoder memory scales with resolution)
        max_image_size = 1024
        print(f"\n[Step 4] Qwen per-page: sequential inference, 1 thread prepares next page (max image size={max_image_size})...")
        doc = Document()
        for section in doc.sections:
            section.top_margin = Cm(2.0)
            section.bottom_margin = Cm(2.0)
            section.left_margin = Cm(2.0)
            section.right_margin = Cm(2.0)
        prompt_text = "Trích xuất toàn bộ văn bản trong ảnh trang tài liệu theo thứ tự đọc. Chỉ xuất văn bản thuần, không định dạng, không giải thích."

        next_pil_container = [None]
        next_thread = None
        for page_idx in range(len(images)):
            if next_thread is not None:
                next_thread.join()
                next_thread = None
            current_pil = next_pil_container[0] if page_idx > 0 else resize_image_for_qwen(images[0], max_image_size)
            if page_idx == 0:
                next_pil_container[0] = current_pil
            if page_idx + 1 < len(images):
                def _prepare_next(idx):
                    next_pil_container[0] = resize_image_for_qwen(images[idx], max_image_size)
                next_thread = threading.Thread(target=_prepare_next, args=(page_idx + 1,))
                next_thread.start()

            messages = [
                {"role": "system", "content": [{"type": "text", "text": "Bạn là công cụ OCR. Nhiệm vụ: nhận diện toàn bộ văn bản trong ảnh trang tài liệu theo thứ tự đọc, xuất ra văn bản thuần."}]},
                {"role": "user", "content": [{"type": "image", "image": current_pil}, {"type": "text", "text": prompt_text}]},
            ]
            inputs = None
            try:
                text_inputs = processor.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
                image_inputs, video_inputs = process_vision_info(messages)
                inputs = processor(text=text_inputs, images=image_inputs, videos=video_inputs, return_tensors="pt")
                inputs = inputs.to(qwen_model.device)
                with torch.no_grad():
                    generated_ids = qwen_model.generate(**inputs, max_new_tokens=512)
                generated_ids_trimmed = generated_ids[0][inputs.input_ids.shape[1]:]
                text = processor.decode(generated_ids_trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False).strip()
                text = text.replace("```", "").strip()
                del generated_ids, generated_ids_trimmed
            except Exception as e:
                print(f"    ⚠️  Page {page_idx + 1} failed: {e}", flush=True)
                text = ""
            finally:
                del messages
                if inputs is not None:
                    del inputs
                # Clear GPU cache every 5 pages to reduce sync overhead; less often = faster (PyTorch reuses cache)
                if torch.cuda.is_available() and (page_idx + 1) % 5 == 0:
                    torch.cuda.empty_cache()
                gc.collect()

            if page_idx > 0:
                doc.add_page_break()
            if text:
                for block in text.split("\n\n"):
                    block = block.strip()
                    if block:
                        p = doc.add_paragraph(block)
                        p.paragraph_format.space_after = Pt(2)
                        for r in p.runs:
                            r.font.name = "Times New Roman"
                            r.font.size = Pt(12)
            print(f"  Page {page_idx + 1}/{len(images)} done.", flush=True)

        try:
            doc.save(str(output_docx))
            print(f"\n  ✓ Saved to: {output_docx} ({len(images)} pages)")
        except Exception as e:
            print(f"\n  ⚠️  Save error: {e}")
        print("PROCESSING COMPLETE (Qwen per-page, sequential)", flush=True)
        return output_docx
    
    # ----- Standard path: YOLO + per-bbox OCR (VietOCR or Qwen) -----
    print("\n[Step 4] Processing pages & generating Word document (YOLO + OCR)...")
    doc = Document()
    for section in doc.sections:
        section.top_margin = Cm(2.0)
        section.bottom_margin = Cm(2.0)
        section.left_margin = Cm(2.0)
        section.right_margin = Cm(2.0)
    
    total_bboxes = 0
    
    for page_idx, image in enumerate(images):
        print(f"\n  Processing page {page_idx + 1}/{len(images)}...")
        
        # Detect
        print("    Detecting bboxes...")
        detections = detect_bboxes(model, image, imgsz=imgsz, conf=conf)
        boxes = detections['boxes']
        scores = detections['scores']
        class_names = detections['class_names']
        
        # Remove overlaps > 80%
        print("    Removing overlapping bboxes...")
        filtered_boxes = []
        filtered_scores = []
        filtered_class_names = []
        removed_indices = set()
        
        for i, (box1, score1, class1) in enumerate(zip(boxes, scores, class_names)):
            if i in removed_indices:
                continue
            
            x1_1, y1_1, x2_1, y2_1 = box1
            is_duplicate = False
            
            for j, (box2, score2, class2) in enumerate(zip(boxes, scores, class_names)):
                if i == j or j in removed_indices:
                    continue
                x1_2, y1_2, x2_2, y2_2 = box2
                
                overlap_x = max(0, min(x2_1, x2_2) - max(x1_1, x1_2))
                overlap_y = max(0, min(y2_1, y2_2) - max(y1_1, y1_2))
                overlap_area = overlap_x * overlap_y
                
                area1 = (x2_1 - x1_1) * (y2_1 - y1_1)
                area2 = (x2_2 - x1_2) * (y2_2 - y1_2)
                min_area = min(area1, area2)
                
                if min_area > 0:
                    overlap_ratio = overlap_area / min_area
                    if overlap_ratio > 0.8:
                        if score1 < score2:
                            is_duplicate = True
                            removed_indices.add(i)
                            break
                        else:
                            removed_indices.add(j)
            
            if not is_duplicate:
                filtered_boxes.append(box1)
                filtered_scores.append(score1)
                filtered_class_names.append(class1)
                
        print(f"    ✓ Kept {len(filtered_boxes)} bboxes after removing overlaps")
        
        valid_boxes = []
        all_line_images = []
        box_to_lines = []
        # For Qwen2.5-VL: list of (box, score, class_name, bbox_image) and batch messages
        qwen_valid_boxes = []
        qwen_messages_batch = []
        
        for idx, (box, score, class_name) in enumerate(zip(filtered_boxes, filtered_scores, filtered_class_names)):
            x1, y1, x2, y2 = box
            width = x2 - x1
            height = y2 - y1
            
            # Skip likely watermarks
            if class_name == 'abandon':
                is_in_header_zone = y1 < image.shape[0] * 0.20
                if (height > width * 3 or width > height * 3) and not is_in_header_zone:
                    continue
                    
            bbox_image = crop_bbox(image, box, padding=10)
            if bbox_image.shape[0] == 0 or bbox_image.shape[1] == 0:
                continue
            
            if ocr_engine == "qwen_vl" and qwen_model is not None and processor is not None:
                pil_crop = Image.fromarray(cv2.cvtColor(bbox_image, cv2.COLOR_BGR2RGB))
                prompt_text = (
                    "Trích xuất văn bản trong ảnh. Chỉ xuất văn bản thuần, không định dạng, không giải thích."
                )
                messages = [
                    {"role": "system", "content": [{"type": "text", "text": "Bạn là công cụ OCR. Nhiệm vụ: nhận diện chính xác văn bản trong ảnh và xuất ra văn bản thuần."}]},
                    {"role": "user", "content": [{"type": "image", "image": pil_crop}, {"type": "text", "text": prompt_text}]},
                ]
                qwen_valid_boxes.append({"box": box, "score": score, "class_name": class_name})
                qwen_messages_batch.append(messages)
                continue
            
            line_boxes = get_tight_text_boxes(bbox_image)
            lines_in_this_box = 0
            
            for (lx, ly, lw, lh) in line_boxes:
                # Add minor padding
                lx1 = max(0, lx - 2)
                ly1 = max(0, ly - 4)
                lx2 = min(bbox_image.shape[1], lx + lw + 2)
                ly2 = min(bbox_image.shape[0], ly + lh + 4)
                
                line_img = bbox_image[ly1:ly2, lx1:lx2]
                if line_img.shape[0] == 0 or line_img.shape[1] == 0:
                    continue
                    
                # Resize if incredibly small
                if line_img.shape[0] < 16:
                    line_img = cv2.resize(line_img, None, fx=2, fy=2, interpolation=cv2.INTER_CUBIC)
                    
                pil_image = Image.fromarray(line_img)
                all_line_images.append(pil_image)
                lines_in_this_box += 1
                
            if lines_in_this_box > 0:
                valid_boxes.append((box, score, class_name))
                box_to_lines.append(lines_in_this_box)

        page_bboxes = []
        if ocr_engine == "qwen_vl" and enable_ocr and qwen_model is not None and processor is not None and qwen_messages_batch:
            BATCH_SIZE = 8
            print(f"    Running Qwen2.5-VL OCR for {len(qwen_messages_batch)} bboxes (batch size {BATCH_SIZE})...")
            all_texts = []
            for i in range(0, len(qwen_messages_batch), BATCH_SIZE):
                batch_msgs = qwen_messages_batch[i:i + BATCH_SIZE]
                try:
                    text_inputs = processor.apply_chat_template(batch_msgs, tokenize=False, add_generation_prompt=True)
                    image_inputs, video_inputs = process_vision_info(batch_msgs)
                    inputs = processor(text=text_inputs, images=image_inputs, videos=video_inputs, padding=True, return_tensors="pt")
                    inputs = inputs.to(qwen_model.device)
                    with torch.no_grad():
                        generated_ids = qwen_model.generate(**inputs, max_new_tokens=512)
                    generated_ids_trimmed = [out_ids[len(in_ids):] for in_ids, out_ids in zip(inputs.input_ids, generated_ids)]
                    texts = processor.batch_decode(generated_ids_trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False)
                    all_texts.extend(texts)
                    if torch.cuda.is_available():
                        torch.cuda.empty_cache()
                except Exception as e:
                    print(f"    ⚠️  Qwen batch failed: {e}")
                    all_texts.extend([""] * len(batch_msgs))
            for j, info in enumerate(qwen_valid_boxes):
                text = (all_texts[j].strip() if j < len(all_texts) else "").replace("```", "").strip()
                if not text:
                    continue
                box = info["box"]
                x1, y1, x2, y2 = box
                page_bboxes.append({
                    "class": info["class_name"],
                    "confidence": float(info["score"]),
                    "text": text,
                    "x1": float(x1), "y1": float(y1), "x2": float(x2), "y2": float(y2),
                    "center_x": (x1 + x2) / 2, "center_y": (y1 + y2) / 2,
                })
        elif enable_ocr and all_line_images:
            print(f"    Running VietOCR in batch mode for {len(all_line_images)} lines across {len(valid_boxes)} bboxes...")
            try:
                batch_res = detector.predict_batch(all_line_images, return_prob=True)
                all_texts = list(zip(batch_res[0], batch_res[1]))
            except Exception as e:
                print(f"    ⚠️  Batch prediction failed ({e}), falling back to loop...")
                all_texts = []
                for img in all_line_images:
                    res_tuple = detector.predict(img, return_prob=True)
                    all_texts.append(res_tuple)
            
            curr_idx = 0
            for (box, score, class_name), num_lines in zip(valid_boxes, box_to_lines):
                box_texts = all_texts[curr_idx : curr_idx + num_lines]
                curr_idx += num_lines
                
                filtered_texts = []
                for (text_raw, prob) in box_texts:
                    text_str = text_raw.strip()
                    if not text_str:
                        continue
                    if prob < 0.60:
                        continue
                    text_no_space = text_str.replace(' ', '').replace('.', '').replace(',', '')
                    if len(text_no_space) > 5 and sum(c.isdigit() for c in text_no_space) / max(1, len(text_no_space)) > 0.7:
                        continue
                    if len(text_str) > 8 and ' ' not in text_str and text_str.isupper() and prob < 0.85:
                        continue
                    filtered_texts.append(text_str)

                text = " ".join(filtered_texts)
                if not text:
                    continue
                
                x1, y1, x2, y2 = box
                page_bboxes.append({
                    'class': class_name,
                    'confidence': float(score),
                    'text': text,
                    'x1': float(x1),
                    'y1': float(y1),
                    'x2': float(x2),
                    'y2': float(y2),
                    'center_x': (x1 + x2) / 2,
                    'center_y': (y1 + y2) / 2,
                })

        # Sort bboxes
        sorted_bboxes = sort_bboxes_by_position(page_bboxes)
        total_bboxes += len(sorted_bboxes)
        
        # Add to document
        if page_idx > 0:
            doc.add_page_break()
            
        for bbox in sorted_bboxes:
            p = doc.add_paragraph()
            p.paragraph_format.space_after = Pt(2)
            p.paragraph_format.space_before = Pt(2)
            
            run = p.add_run(bbox['text'])
            run.font.name = 'Times New Roman'
            run.font.size = Pt(12)
            
            if bbox['class'] in ['title', 'heading1', 'heading2']:
                run.font.bold = True
                run.font.size = Pt(14)
                
    # Save document
    print(f"\n[Step 5] Saving Word document...")
    try:
        doc.save(str(output_docx))
        print(f"  ✓ Saved to: {output_docx}")
    except PermissionError:
        import datetime
        timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
        new_output = output_docx.parent / f"{output_docx.stem}_{timestamp}.docx"
        print(f"  ⚠️  Original file locked, saving as: {new_output.name}")
        doc.save(str(new_output))
        output_docx = new_output
    
    print("\n" + "=" * 80)
    print("PROCESSING COMPLETE")
    print("=" * 80)
    print(f"Output file: {output_docx}")
    print(f"Total pages: {len(images)}")
    print(f"Total bboxes: {total_bboxes}")
    
    return output_docx

if __name__ == "__main__":
    main()
