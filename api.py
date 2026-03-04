from fastapi import FastAPI, UploadFile, File
from fastapi.responses import FileResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional
import uuid
from pathlib import Path
import shutil
import sys
import os
import re
import threading
import time
from subprocess import Popen, PIPE, STDOUT
import numpy as np
from sentence_transformers import SentenceTransformer
from transformers import AutoTokenizer, AutoModelForCausalLM
import torch
import faiss
import pickle

# Import PyMuPDF for PDF detection
try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

# ===============================
# In-memory job store
# ===============================
JOB_PROGRESS = {}   # job_id -> {current, total, percent, elapsed_time, start_time, pdf_type}
JOB_STATUS = {}     # job_id -> running | done | error | cancelled


def detect_pdf_type(pdf_path: Path) -> str:
    """Detect if PDF is scanned (image) or text-based"""
    if not fitz:
        # Default to scan if PyMuPDF not available
        print(f"[INFO] PyMuPDF not available, defaulting to scan", flush=True)
        return "scan"
    
    try:
        doc = fitz.open(pdf_path)
        total_pages = doc.page_count
        
        print(f"[INFO] PDF has {total_pages} pages", flush=True)
        
        # For very large files (>50 pages), sample more pages
        sample_pages = min(5, total_pages) if total_pages > 50 else min(3, total_pages)
        
        text_length = 0
        has_images = 0
        hybrid_pages = 0
        total_images = 0
        
        for page_num in range(sample_pages):
            page = doc[page_num]
            text = page.get_text()
            text_len = len(text.strip())
            text_length += text_len
            
            # Check if page has images
            image_list = page.get_images()
            img_count = len(image_list)
            if img_count > 0:
                has_images += 1
                total_images += img_count
            
            # Check if hybrid (both text and images)
            if text_len > 0 and img_count > 0:
                hybrid_pages += 1
        
        doc.close()
        
        # Calculate metrics
        avg_text = text_length / sample_pages if sample_pages > 0 else 0
        image_ratio = has_images / sample_pages if sample_pages > 0 else 0
        hybrid_ratio = hybrid_pages / sample_pages if sample_pages > 0 else 0
        
        print(f"[INFO] PDF Detection - Avg text: {avg_text:.0f} chars/page, Images: {has_images}/{sample_pages} pages, Hybrid: {hybrid_pages}/{sample_pages}", flush=True)
        
        # Decision logic:
        # 1. Very large files (>50 pages) with many images → use OCR (faster)
        # 2. Hybrid PDFs (text + images) → use OCR if >30% hybrid or >50 pages
        # 3. Pure text with many pages (>100) → still use convert_keep_layout
        # 4. Pure text small/medium → use convert_keep_layout
        
        is_large_file = total_pages > 50
        is_very_large = total_pages > 100
        has_many_images = total_images > sample_pages * 2  # Average >2 images per page
        
        if avg_text < 100 and image_ratio > 0.5:
            print(f"[INFO] Detected as: SCAN (low text: {avg_text:.0f}, high images: {image_ratio:.1%})", flush=True)
            return "scan"
        elif avg_text >= 100:
            # Pure text PDF detected
            if is_very_large and (hybrid_ratio > 0.3 or has_many_images):
                # Large hybrid file - OCR might be faster
                print(f"[INFO] Detected as: TEXT (but large hybrid: {total_pages} pages, {hybrid_ratio:.1%} hybrid)", flush=True)
                print(f"[INFO] Recommendation: Using OCR for better performance with large hybrid files", flush=True)
                return "scan"  # Use OCR for large hybrid files
            elif is_large_file and hybrid_ratio > 0.5:
                # Medium-large hybrid - use OCR
                print(f"[INFO] Detected as: HYBRID TEXT (large file: {total_pages} pages, {hybrid_ratio:.1%} hybrid)", flush=True)
                print(f"[INFO] Recommendation: Using OCR for better performance", flush=True)
                return "scan"
            else:
                # Pure or mostly text
                print(f"[INFO] Detected as: TEXT (high text: {avg_text:.0f}, {total_pages} pages)", flush=True)
                return "text"
        else:
            # Default to scan if unclear
            print(f"[INFO] Detected as: SCAN (unclear, defaulting to scan)", flush=True)
            return "scan"
    except Exception as e:
        print(f"[WARN] Error detecting PDF type: {e}, defaulting to scan", flush=True)
        return "scan"


def process_pdf_background(job_id: str, pdf_path: Path, output_docx: Path, pdf_type: str):
    """Process PDF in background thread"""
    start_time = time.time()
    JOB_PROGRESS[job_id]["start_time"] = start_time
    JOB_PROGRESS[job_id]["pdf_type"] = pdf_type
    
    try:
        # ===============================
        # Select script based on PDF type
        # ===============================
        scripts_dir = BASE_DIR / "scripts"
        if pdf_type == "scan":
            script_path = scripts_dir / "convert_pdf_gpu.py"
            print(f"[INFO] Job {job_id}: Using OCR script (convert_pdf_gpu.py) for SCAN PDF", flush=True)
        else:  # text
            script_path = scripts_dir / "convert_keep_layout.py"
            print(f"[INFO] Job {job_id}: Using layout-preserving script (convert_keep_layout.py) for TEXT PDF", flush=True)
        
        # Verify script exists
        if not script_path.exists():
            error_msg = f"Script not found: {script_path}. Please ensure the script exists in the scripts directory."
            print(f"[ERROR] {error_msg}", flush=True)
            raise FileNotFoundError(error_msg)
        
        # Verify PDF file exists
        if not pdf_path.exists():
            error_msg = f"PDF file not found: {pdf_path}"
            print(f"[ERROR] {error_msg}", flush=True)
            raise FileNotFoundError(error_msg)
        
        # Verify Python executable
        if not sys.executable:
            error_msg = "Python executable not found"
            print(f"[ERROR] {error_msg}", flush=True)
            raise RuntimeError(error_msg)
        
        cmd = [
            sys.executable,
            "-u",  # Unbuffered output
            str(script_path),
            str(pdf_path),
            "--output",
            str(output_docx),
        ]
        
        print(f"[INFO] Job {job_id}: Starting conversion with command: {' '.join(cmd)}", flush=True)
        print(f"[INFO] Job {job_id}: Python executable: {sys.executable}", flush=True)
        print(f"[INFO] Job {job_id}: Script path: {script_path}", flush=True)
        print(f"[INFO] Job {job_id}: PDF path: {pdf_path}", flush=True)
        print(f"[INFO] Job {job_id}: Output path: {output_docx}", flush=True)

        # ===============================
        # Regex for OCR phases (only for scan PDFs)
        # ===============================
        pdf_info_pattern = re.compile(r"--- PDF Info: (\d+) pages ---")
        layout_pattern = re.compile(r"Recognizing Layout")
        ocr_error_pattern = re.compile(r"OCR Error Detection")
        bbox_pattern = re.compile(r"Detecting bboxes")
        # Match formats like:
        # - "Recognizing Text: 0% | 0/40 [time]"
        # - "Recognizing Text: 2%|2 | 1/40 [time]"
        # - "Recognizing Text: 18%|#7 | 7/40 [time]"
        # Only match lines that start with "Recognizing Text:" and have progress bar format
        text_pattern = re.compile(r"^Recognizing Text:\s*\d+%.*?(\d+)\s*/\s*(\d+)")
        
        # For text PDFs (convert_keep_layout.py)
        layout_convert_pattern = re.compile(r"--- Starting Layout-Preserving Conversion ---")

        # Set environment to force unbuffered output and UTF-8 on Windows
        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"

        # Use UTF-8 encoding to avoid "charmap codec can't decode" on Windows
        # when subprocess prints Vietnamese or other non-ASCII characters
        # Run subprocess with project root as cwd so scripts and relative paths (models, etc.) resolve correctly
        process = Popen(
            cmd,
            stdout=PIPE,
            stderr=STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",  # Replace invalid bytes instead of raising
            bufsize=0,  # Unbuffered
            universal_newlines=True,
            env=env,
            cwd=str(BASE_DIR),
        )

        for line in process.stdout:
            print(line, end="", flush=True)
            
            # Skip if job is already done
            if JOB_STATUS.get(job_id) == "done":
                continue

            # Update elapsed time
            elapsed = time.time() - start_time
            JOB_PROGRESS[job_id]["elapsed_time"] = elapsed

            if pdf_type == "scan":
                # ----- For SCAN PDFs: Parse OCR progress -----
                # Parse PDF info at start
                m_info = pdf_info_pattern.search(line)
                if m_info:
                    total_pages = int(m_info.group(1))
                    # Set total from PDF Info - this is the source of truth
                    JOB_PROGRESS[job_id]["total"] = total_pages
                    JOB_PROGRESS[job_id]["percent"] = 1
                    continue

                # Phase-based progress
                if layout_pattern.search(line):
                    JOB_PROGRESS[job_id]["percent"] = 5

                elif ocr_error_pattern.search(line):
                    JOB_PROGRESS[job_id]["percent"] = 10

                elif bbox_pattern.search(line):
                    JOB_PROGRESS[job_id]["percent"] = 15

                # Real page-based progress
                # Only process if line contains "Recognizing Text:" to avoid false matches
                if "Recognizing Text:" in line:
                    m = text_pattern.search(line.strip())  # Strip to handle line breaks
                    if m:
                        current = int(m.group(1))
                        total_from_log = int(m.group(2))
                        
                        # ALWAYS use total from PDF Info if available (source of truth)
                        current_total = JOB_PROGRESS[job_id].get("total", 0)
                        if current_total > 0:
                            total = current_total
                            current = min(current, total)
                        else:
                            total = total_from_log
                            JOB_PROGRESS[job_id]["total"] = total
                            print(f"[INFO] Job {job_id}: Using total from log: {total}", flush=True)
                        
                        # Progress: 15% (initial phases) + up to 85% based on pages
                        if total > 0:
                            percent = 15 + int((current / total) * 85)
                        else:
                            percent = 15

                        JOB_PROGRESS[job_id].update({
                            "current": current,
                            "percent": min(percent, 99)
                        })
                        print(f"[PROGRESS] Job {job_id}: {current}/{total} pages ({percent}%)", flush=True)
            
            else:
                # ----- For TEXT PDFs: Simple progress tracking -----
                # Parse PDF info if available (from convert_keep_layout.py)
                m_info = pdf_info_pattern.search(line)
                if m_info:
                    total_pages = int(m_info.group(1))
                    JOB_PROGRESS[job_id]["total"] = total_pages
                    JOB_PROGRESS[job_id]["percent"] = 20
                    JOB_PROGRESS[job_id]["current"] = 0
                    print(f"[PROGRESS] Job {job_id}: Text PDF - {total_pages} pages detected, starting conversion", flush=True)
                
                if layout_convert_pattern.search(line):
                    # Progress to 30% when conversion starts
                    JOB_PROGRESS[job_id]["percent"] = 30
                    print(f"[PROGRESS] Job {job_id}: Text PDF conversion started", flush=True)
                
                # For text PDFs, gradually increase progress based on time
                # This runs for every log line, so we update progress smoothly
                elapsed = time.time() - start_time
                current_percent = JOB_PROGRESS[job_id].get("percent", 0)
                
                # Only update if we have total pages and percent is reasonable
                total_pages = JOB_PROGRESS[job_id].get("total", 0)
                if total_pages > 0:
                    # For text PDFs, pdf2docx can be slow for large files
                    # Estimate: ~1-3 seconds per page depending on complexity
                    estimated_time_per_page = 2.0  # seconds per page (conservative for large files)
                    estimated_total_time = total_pages * estimated_time_per_page
                    
                    # Progress: 30% (start) + 65% (during conversion) + 5% (finalize)
                    if elapsed > 0 and current_percent < 95:
                        # Use logarithmic scale for progress (slower at end)
                        if elapsed < estimated_total_time:
                            progress_estimate = 30 + int((elapsed / max(estimated_total_time, 1)) * 65)
                        else:
                            # If over estimated time, show 95% (almost done, finalizing)
                            progress_estimate = 95
                        
                        progress_estimate = min(progress_estimate, 95)  # Cap at 95% until done
                        if progress_estimate > current_percent:
                            JOB_PROGRESS[job_id]["percent"] = progress_estimate
                            print(f"[PROGRESS] Job {job_id}: Text PDF progress {progress_estimate}% (elapsed: {elapsed:.1f}s, estimated: {estimated_total_time:.1f}s)", flush=True)
                elif current_percent < 30:
                    # If no total yet, at least show we're starting
                    JOB_PROGRESS[job_id]["percent"] = 20

        process.wait()

        if process.returncode == 0:
            elapsed_total = time.time() - start_time
            JOB_PROGRESS[job_id].update({
                "percent": 100,
                "elapsed_time": elapsed_total
            })
            JOB_STATUS[job_id] = "done"
            print(f"[SUCCESS] Job {job_id} completed in {elapsed_total:.2f} seconds", flush=True)
        else:
            JOB_STATUS[job_id] = "error"
            error_msg = f"Chuyển đổi thất bại (mã thoát: {process.returncode}). Kiểm tra terminal backend để xem log chi tiết."
            print(f"[ERROR] Job {job_id} failed with return code {process.returncode}", flush=True)
            JOB_PROGRESS[job_id]["error"] = error_msg
            # Try to capture stderr if available
            if hasattr(process, 'stderr') and process.stderr:
                stderr_output = process.stderr.read()
                if stderr_output:
                    print(f"[ERROR] Stderr output: {stderr_output}", flush=True)

    except FileNotFoundError as e:
        error_msg = f"Script not found: {e}"
        print(f"[ERROR] {error_msg}", flush=True)
        JOB_STATUS[job_id] = "error"
        JOB_PROGRESS[job_id]["error"] = error_msg
    except Exception as e:
        error_msg = f"OCR ERROR for job {job_id}: {e}"
        print(f"[ERROR] {error_msg}", flush=True)
        import traceback
        print(f"[ERROR] Traceback: {traceback.format_exc()}", flush=True)
        JOB_STATUS[job_id] = "error"
        JOB_PROGRESS[job_id]["error"] = str(e)


@app.post("/convert")
async def convert_pdf(file: UploadFile = File(...)):
    job_id = str(uuid.uuid4())

    pdf_path = UPLOAD_DIR / f"{job_id}.pdf"
    output_docx = UPLOAD_DIR / f"{job_id}.docx"

    # Save uploaded PDF
    with open(pdf_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # Detect PDF type
    detection_start = time.time()
    pdf_type = detect_pdf_type(pdf_path)
    pdf_type_display = "scan" if pdf_type == "scan" else "text"
    detection_time = time.time() - detection_start
    
    print(f"[INFO] Job {job_id}: Detected PDF type: {pdf_type_display} (took {detection_time:.2f}s)", flush=True)
    print(f"[INFO] Job {job_id}: File will be processed with {'OCR (convert_pdf_gpu.py)' if pdf_type == 'scan' else 'Direct conversion (convert_keep_layout.py)'}", flush=True)

    # Initialize job status
    JOB_PROGRESS[job_id] = {
        "current": 0,
        "total": 0,
        "percent": 0,
        "elapsed_time": 0,
        "start_time": 0,
        "pdf_type": pdf_type_display
    }
    JOB_STATUS[job_id] = "running"

    # Start processing in background thread
    thread = threading.Thread(
        target=process_pdf_background,
        args=(job_id, pdf_path, output_docx, pdf_type),
        daemon=True
    )
    thread.start()

    # Return job_id immediately so frontend can start polling
    return {"job_id": job_id, "pdf_type": pdf_type_display}


@app.post("/convert_basic")
async def convert_basic_pdf(file: UploadFile = File(...)):
    """
    Basic OCR/Text extraction:
    - Chỉ trích xuất text, không giữ bố cục.
    - Hỗ trợ cả PDF text và PDF scan.
      + PDF text: trích xuất trực tiếp bằng PyMuPDF (rất nhanh).
      + PDF scan: dùng pipeline OCR hiện tại (convert_pdf_gpu.py), sau đó lấy text đơn giản.
    """
    temp_id = str(uuid.uuid4())
    pdf_path = UPLOAD_DIR / f"basic_{temp_id}.pdf"
    output_docx = UPLOAD_DIR / f"basic_{temp_id}.docx"

    # Save uploaded PDF
    with open(pdf_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    # Detect PDF type (scan / text)
    pdf_type = detect_pdf_type(pdf_path)

    text: str = ""

    if pdf_type == "scan":
        # ===== PDF scan: dùng pipeline OCR có sẵn để tạo DOCX tạm, rồi rút text ra =====
        scripts_dir = BASE_DIR / "scripts"
        script_path = scripts_dir / "convert_pdf_gpu.py"
        if not script_path.exists():
            return JSONResponse(
                status_code=500,
                content={
                    "error": f"Không tìm thấy script OCR: {script_path}. Vui lòng kiểm tra thư mục scripts."
                },
            )

        temp_layout_docx = UPLOAD_DIR / f"basic_{temp_id}_layout.docx"

        cmd = [
            sys.executable,
            "-u",
            str(script_path),
            str(pdf_path),
            "--output",
            str(temp_layout_docx),
        ]

        print(f"[INFO] Basic OCR (scan) - running command: {' '.join(cmd)}", flush=True)

        env = os.environ.copy()
        env["PYTHONUNBUFFERED"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"

        process = Popen(
            cmd,
            stdout=PIPE,
            stderr=STDOUT,
            text=True,
            encoding="utf-8",
            errors="replace",
            bufsize=0,
            universal_newlines=True,
            env=env,
            cwd=str(BASE_DIR),
        )

        # In basic mode chúng ta không parse progress, chỉ log ra để debug
        ocr_logs = []
        for line in process.stdout:
            ocr_logs.append(line)
            print(line, end="", flush=True)

        process.wait()

        if process.returncode != 0 or not temp_layout_docx.exists():
            print(f"[ERROR] Basic OCR scan failed, return code: {process.returncode}", flush=True)
            return JSONResponse(
                status_code=500,
                content={
                    "error": "OCR cơ bản cho PDF scan thất bại. Vui lòng thử lại hoặc dùng chế độ OCR nâng cao."
                },
            )

        # Lấy text từ DOCX tạm
        text = extract_text_from_docx(temp_layout_docx)
    else:
        # ===== PDF text: trích xuất trực tiếp (nhanh) =====
        text = extract_text_from_pdf(pdf_path)

    if not text.strip():
        return JSONResponse(
            status_code=400,
            content={
                "error": "Không trích xuất được văn bản từ PDF. Vui lòng thử lại hoặc sử dụng chế độ OCR nâng cao."
            },
        )

    try:
        create_plain_docx_from_text(text, output_docx)
    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"error": f"Lỗi khi tạo file DOCX đơn giản: {e}"},
        )

    filename_stem = Path(file.filename).stem if file.filename else "result"

    return FileResponse(
        output_docx,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"{filename_stem}_basic.docx",
    )


@app.get("/progress/{job_id}")
def get_progress(job_id: str):
    if job_id not in JOB_STATUS:
        return JSONResponse(
            status_code=404,
            content={"error": "Job not found"}
        )

    progress_data = JOB_PROGRESS.get(job_id, {
        "current": 0, 
        "total": 0, 
        "percent": 0, 
        "elapsed_time": 0,
        "start_time": 0
    })
    
    # Update elapsed time if still running
    if JOB_STATUS[job_id] == "running" and progress_data.get("start_time"):
        progress_data["elapsed_time"] = time.time() - progress_data["start_time"]
    
    return {
        "status": JOB_STATUS[job_id],
        **progress_data
    }


@app.get("/result/{job_id}")
def get_result(job_id: str):
    output_docx = UPLOAD_DIR / f"{job_id}.docx"

    if not output_docx.exists():
        return JSONResponse(
            status_code=404,
            content={"error": "Result not ready"}
        )

    return FileResponse(
        output_docx,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename="result.docx"
    )


@app.post("/cancel/{job_id}")
def cancel_job(job_id: str):
    """Đánh dấu hủy job phía backend (không chờ subprocess kết thúc)."""
    if job_id not in JOB_STATUS:
        return JSONResponse(status_code=404, content={"error": "Job not found"})

    JOB_STATUS[job_id] = "cancelled"
    progress_data = JOB_PROGRESS.get(job_id)
    if progress_data is not None:
        progress_data["status"] = "cancelled"

    return {"status": "cancelled"}


# ===============================
# Chatbot RAG System
# ===============================

CHATBOT_DIR = BASE_DIR / "chatbot_data"
CHATBOT_DIR.mkdir(exist_ok=True)
CHATBOT_UPLOAD_DIR = CHATBOT_DIR / "uploads"
CHATBOT_UPLOAD_DIR.mkdir(exist_ok=True)
RAG_CACHE_DIR = CHATBOT_DIR / "rag_cache"
RAG_CACHE_DIR.mkdir(exist_ok=True)
RAG_CACHE_FILE = RAG_CACHE_DIR / "all_documents.pkl"  # Single .pkl file for all documents

# Global models (loaded once)
embedding_model = None
llm_model = None
llm_tokenizer = None
device = "cuda" if torch.cuda.is_available() else "cpu"

# Document store: file_id -> {chunks, embeddings, index, file_path, file_name}
DOCUMENT_STORE = {}


def save_document_store():
    """Save DOCUMENT_STORE to pickle file"""
    try:
        # Convert FAISS index to bytes for serialization
        store_to_save = {}
        for file_id, doc_data in DOCUMENT_STORE.items():
            # FAISS index cannot be pickled directly, need to save separately
            # Save index to bytes
            index_bytes = None
            if 'index' in doc_data and doc_data['index'] is not None:
                # Serialize FAISS index
                index = doc_data['index']
                index_bytes = faiss.serialize_index(index).tobytes()
            
            store_to_save[file_id] = {
                'chunks': doc_data['chunks'],
                'embeddings': doc_data['embeddings'],
                'index_bytes': index_bytes,
                'file_path': doc_data.get('file_path', ''),
                'file_name': doc_data.get('file_name', ''),
            }
        
        with open(RAG_CACHE_FILE, 'wb') as f:
            pickle.dump(store_to_save, f)
        print(f"[INFO] Saved {len(store_to_save)} documents to {RAG_CACHE_FILE}", flush=True)
    except Exception as e:
        print(f"[ERROR] Failed to save document store: {e}", flush=True)


def load_document_store():
    """Load DOCUMENT_STORE from pickle file"""
    global DOCUMENT_STORE
    
    if not RAG_CACHE_FILE.exists():
        print("[INFO] No cache file found, starting with empty document store", flush=True)
        return
    
    try:
        with open(RAG_CACHE_FILE, 'rb') as f:
            store_loaded = pickle.load(f)
        
        # Reconstruct FAISS indices from bytes
        for file_id, doc_data in store_loaded.items():
            index = None
            if doc_data.get('index_bytes'):
                # Deserialize FAISS index
                index_bytes = doc_data['index_bytes']
                index = faiss.deserialize_index(np.frombuffer(index_bytes, dtype=np.uint8))
            
            DOCUMENT_STORE[file_id] = {
                'chunks': doc_data['chunks'],
                'embeddings': doc_data['embeddings'],
                'index': index,
                'file_path': doc_data.get('file_path', ''),
                'file_name': doc_data.get('file_name', ''),
            }
        
        print(f"[INFO] Loaded {len(DOCUMENT_STORE)} documents from cache", flush=True)
    except Exception as e:
        print(f"[ERROR] Failed to load document store: {e}", flush=True)
        DOCUMENT_STORE = {}


def clear_old_cache_files():
    """Clear old individual .pkl files in rag_cache directory"""
    try:
        old_files = list(RAG_CACHE_DIR.glob("*.pkl"))
        old_files = [f for f in old_files if f.name != "all_documents.pkl"]  # Keep the new unified file
        
        for old_file in old_files:
            try:
                old_file.unlink()
                print(f"[INFO] Deleted old cache file: {old_file.name}", flush=True)
            except Exception as e:
                print(f"[WARN] Failed to delete {old_file.name}: {e}", flush=True)
        
        # Also delete old .index and .json files
        for old_file in RAG_CACHE_DIR.glob("*.index"):
            try:
                old_file.unlink()
                print(f"[INFO] Deleted old index file: {old_file.name}", flush=True)
            except Exception as e:
                print(f"[WARN] Failed to delete {old_file.name}: {e}", flush=True)
        
        for old_file in RAG_CACHE_DIR.glob("*.json"):
            try:
                old_file.unlink()
                print(f"[INFO] Deleted old json file: {old_file.name}", flush=True)
            except Exception as e:
                print(f"[WARN] Failed to delete {old_file.name}: {e}", flush=True)
    except Exception as e:
        print(f"[WARN] Failed to clear old cache files: {e}", flush=True)

def load_models():
    """Load Qwen2.5 models offline"""
    global embedding_model, llm_model, llm_tokenizer
    
    if embedding_model is None:
        print("[INFO] Loading Qwen2.5-Embedding model...", flush=True)
        try:
            # Try to load embedding models (offline-first, then download if needed)
            # Priority: Qwen2.5-Embedding for best compatibility with Qwen LLM
            embedding_models = [
                "Qwen/Qwen2.5-0.5B-Instruct",  # Qwen2.5 Embedding - Best sync with Qwen LLM, low hallucination
                "sentence-transformers/paraphrase-multilingual-mpnet-base-v2",  # High quality, 768D, excellent for Vietnamese
                "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2",  # Good balance, 384D, fast
                "sentence-transformers/all-mpnet-base-v2",  # High quality English/Vietnamese
                "sentence-transformers/all-MiniLM-L6-v2",  # English fallback
            ]
            
            loaded = False
            for model_name in embedding_models:
                try:
                    embedding_model = SentenceTransformer(model_name, device=device)
                    print(f"[INFO] Using embedding model: {model_name}", flush=True)
                    loaded = True
                    break
                except Exception as e:
                    print(f"[INFO] Failed to load {model_name}: {e}, trying next...", flush=True)
                    continue
            
            if not loaded:
                raise Exception("Failed to load any embedding model")
        except Exception as e:
            print(f"[ERROR] Failed to load embedding model: {e}", flush=True)
            raise
    
    if llm_model is None:
        print("[INFO] Loading Qwen2.5-3B-Instruct model...", flush=True)
        try:
            # Use Qwen2.5-3B-Instruct model (best quality for Vietnamese + RTX 4050 6GB)
            # Alternative: "Qwen/Qwen2.5-1.5B-Instruct" for lighter weight (~2GB VRAM)
            # Note: Models should be downloaded first using huggingface-cli
            model_name = "Qwen/Qwen2.5-3B-Instruct"  # High quality: 3B params, ~3-4GB VRAM, excellent Vietnamese support
            
            # Try to load with local_files_only first (offline mode)
            try:
                llm_tokenizer = AutoTokenizer.from_pretrained(
                    model_name,
                    trust_remote_code=True,
                    local_files_only=True
                )
                llm_model = AutoModelForCausalLM.from_pretrained(
                    model_name,
                    trust_remote_code=True,
                    torch_dtype=torch.float16 if device == "cuda" else torch.float32,
                    device_map="auto" if device == "cuda" else None,
                    local_files_only=True
                )
                print("[INFO] LLM model loaded in offline mode", flush=True)
            except:
                # If offline fails, try to download (first time only)
                print("[INFO] Models not found locally, downloading...", flush=True)
                llm_tokenizer = AutoTokenizer.from_pretrained(
                    model_name,
                    trust_remote_code=True
                )
                llm_model = AutoModelForCausalLM.from_pretrained(
                    model_name,
                    trust_remote_code=True,
                    torch_dtype=torch.float16 if device == "cuda" else torch.float32,
                    device_map="auto" if device == "cuda" else None
                )
                print("[INFO] LLM model downloaded and loaded", flush=True)
            
            if device == "cpu":
                llm_model = llm_model.to(device)
            llm_model.eval()
            print("[INFO] LLM model loaded successfully", flush=True)
        except Exception as e:
            print(f"[ERROR] Failed to load LLM model: {e}", flush=True)
            print("[WARN] LLM will not be available. Please ensure models are downloaded.", flush=True)
            print("[INFO] To download models offline, run:", flush=True)
            print(f"  huggingface-cli download {model_name}", flush=True)

# Load models on startup (lazy loading - models will be loaded when first needed)
# This prevents blocking server startup if models are not available
def ensure_models_loaded():
    """Ensure models are loaded, load them if not already loaded"""
    global embedding_model, llm_model, llm_tokenizer
    if embedding_model is None or llm_model is None:
        try:
            print("[INFO] Loading models (first time - this may take a few minutes)...", flush=True)
            load_models()
            print("[INFO] Models loaded successfully!", flush=True)
        except Exception as e:
            print(f"[WARN] Models not loaded: {e}. Chatbot features may not work.", flush=True)
            print("[INFO] Models will be loaded on first use. Please ensure models are downloaded.", flush=True)

# Pre-load models in background thread (non-blocking)
def preload_models():
    """Pre-load models in background to avoid first-request delay"""
    try:
        time.sleep(2)  # Wait a bit for server to start
        print("[INFO] Pre-loading models in background...", flush=True)
        ensure_models_loaded()
        print("[INFO] Models pre-loaded successfully! Chatbot is ready.", flush=True)
    except Exception as e:
        print(f"[WARN] Failed to pre-load models: {e}", flush=True)

# Start pre-loading models in background thread
threading.Thread(target=preload_models, daemon=True).start()

# Load document store from cache on startup
load_document_store()

# Clear old cache files (individual .pkl, .index, .json files)
clear_old_cache_files()


def extract_text_from_pdf(pdf_path: Path) -> str:
    """Extract text from PDF file"""
    try:
        if fitz:
            doc = fitz.open(pdf_path)
            text_parts = []
            for page_num in range(doc.page_count):
                page = doc[page_num]
                text = page.get_text()
                text_parts.append(text)
            doc.close()
            return "\n\n".join(text_parts)
        else:
            return ""
    except Exception as e:
        print(f"[ERROR] Failed to extract text from PDF: {e}", flush=True)
        return ""


def create_plain_docx_from_text(text: str, output_path: Path) -> None:
    """Create a simple DOCX containing only plain text paragraphs."""
    try:
        from docx import Document  # Imported here to avoid global import if not needed

        doc = Document()
        # Split text into lines, keep empty lines as paragraph breaks
        for line in text.splitlines():
            doc.add_paragraph(line)
        doc.save(output_path)
    except Exception as e:
        print(f"[ERROR] Failed to create plain DOCX: {e}", flush=True)
        raise


def extract_text_from_docx(docx_path: Path) -> str:
    """Extract text from DOCX file"""
    try:
        from docx import Document
        doc = Document(docx_path)
        text_parts = []
        for paragraph in doc.paragraphs:
            if paragraph.text.strip():
                text_parts.append(paragraph.text)
        return "\n\n".join(text_parts)
    except Exception as e:
        print(f"[ERROR] Failed to extract text from DOCX: {e}", flush=True)
        return ""


def chunk_text(text: str, chunk_size: int = 800, overlap: int = 100) -> List[str]:
    """Split text into chunks with overlap"""
    if not text:
        return []
    
    # Simple chunking by character count
    chunks = []
    words = text.split()
    current_chunk = []
    current_length = 0
    
    for word in words:
        word_length = len(word) + 1  # +1 for space
        if current_length + word_length > chunk_size and current_chunk:
            chunks.append(" ".join(current_chunk))
            # Overlap: keep last few words
            overlap_words = current_chunk[-overlap:] if len(current_chunk) > overlap else current_chunk
            current_chunk = overlap_words + [word]
            current_length = sum(len(w) + 1 for w in current_chunk)
        else:
            current_chunk.append(word)
            current_length += word_length
    
    if current_chunk:
        chunks.append(" ".join(current_chunk))
    
    return chunks


def process_document(file_path: Path, file_id: str):
    """Process uploaded document and create embeddings"""
    global embedding_model
    
    ensure_models_loaded()
    
    if embedding_model is None:
        raise Exception("Embedding model not loaded. Please check model installation.")
    
    # Extract text
    if file_path.suffix.lower() == ".pdf":
        text = extract_text_from_pdf(file_path)
    elif file_path.suffix.lower() == ".docx":
        text = extract_text_from_docx(file_path)
    else:
        raise Exception(f"Unsupported file type: {file_path.suffix}")
    
    if not text.strip():
        raise Exception("No text extracted from document")
    
    # Chunk text
    chunks = chunk_text(text)
    if not chunks:
        raise Exception("No chunks created from document")
    
    # Create embeddings
    print(f"[INFO] Creating embeddings for {len(chunks)} chunks...", flush=True)
    embeddings = embedding_model.encode(chunks, show_progress_bar=False, convert_to_numpy=True)
    
    # Create FAISS index
    dimension = embeddings.shape[1]
    index = faiss.IndexFlatL2(dimension)
    index.add(embeddings.astype('float32'))
    
    # Store in document store
    DOCUMENT_STORE[file_id] = {
        "chunks": chunks,
        "embeddings": embeddings,
        "index": index,
        "file_path": str(file_path),
        "file_name": file_path.name
    }
    
    # Save to cache after processing
    save_document_store()
    
    print(f"[INFO] Document {file_id} processed: {len(chunks)} chunks, {dimension}D embeddings", flush=True)
    return len(chunks)


def retrieve_relevant_chunks(question: str, file_ids: List[str], top_k: int = 15, distance_threshold: float = 3.0) -> List[str]:
    """Retrieve relevant chunks using RAG with distance threshold filtering"""
    global embedding_model
    
    ensure_models_loaded()
    
    if embedding_model is None or not file_ids:
        print(f"[DEBUG] No embedding model or no file_ids", flush=True)
        return []
    
    # Encode question
    question_embedding = embedding_model.encode([question], convert_to_numpy=True).astype('float32')
    
    all_results = []
    
    for file_id in file_ids:
        if file_id not in DOCUMENT_STORE:
            print(f"[DEBUG] File {file_id} not in DOCUMENT_STORE", flush=True)
            continue
        
        doc_data = DOCUMENT_STORE[file_id]
        index = doc_data["index"]
        chunks = doc_data["chunks"]
        
        print(f"[DEBUG] Searching in {len(chunks)} chunks for file {file_id}", flush=True)
        
        # Search in FAISS - get more candidates for better accuracy
        k = min(top_k * 4, len(chunks))  # Get 4x candidates for filtering (increased from 3x)
        distances, indices = index.search(question_embedding, k)
        
        print(f"[DEBUG] Found {len(indices[0])} candidates, distances: {distances[0][:5]}", flush=True)
        
        # Filter by distance threshold and get top_k most relevant
        # Lower distance = more relevant
        chunk_with_distance = []
        for i, idx in enumerate(indices[0]):
            if idx < len(chunks):
                distance = distances[0][i]
                # More lenient threshold - include chunks below threshold
                if distance <= distance_threshold:
                    chunk_with_distance.append((chunks[idx], distance))
        
        print(f"[DEBUG] After filtering (threshold={distance_threshold}): {len(chunk_with_distance)} chunks", flush=True)
        
        # Sort by distance (lower is better) and take top_k
        chunk_with_distance.sort(key=lambda x: x[1])
        for chunk, dist in chunk_with_distance[:top_k]:
            all_results.append(chunk)
            print(f"[DEBUG] Added chunk (distance={dist:.2f}): {chunk[:50]}...", flush=True)
    
    # Limit total results and remove duplicates
    seen = set()
    unique_results = []
    for chunk in all_results[:top_k * len(file_ids)]:
        chunk_hash = hash(chunk[:100])  # Hash first 100 chars to detect duplicates
        if chunk_hash not in seen:
            seen.add(chunk_hash)
            unique_results.append(chunk)
    
    print(f"[DEBUG] Final retrieved chunks: {len(unique_results)}", flush=True)
    return unique_results


def clean_answer(answer: str) -> str:
    """Clean and normalize answer: remove repetition, replace English, remove trailing phrases"""
    if not answer:
        return answer
    
    answer = answer.strip()
    
    # Replace common English phrases with Vietnamese equivalents (comprehensive list)
    english_to_vietnamese = {
        "1 plus 1": "một cộng một",
        "2 plus 2": "hai cộng hai",
        "plus": "cộng",
        "minus": "trừ",
        "equals": "bằng",
        "equal": "bằng",
        "times": "nhân",
        "divided by": "chia cho",
        "divide": "chia",
        "is": "là",
        "are": "là",
        "was": "là",
        "were": "là",
        "the": "",
        "a ": "một ",
        "an ": "một ",
        "and": "và",
        "or": "hoặc",
        "but": "nhưng",
        "if": "nếu",
        "then": "thì",
        "when": "khi",
        "where": "ở đâu",
        "what": "gì",
        "who": "ai",
        "how": "như thế nào",
        "why": "tại sao",
    }
    
    # Replace English phrases (case-insensitive)
    for eng, vi in english_to_vietnamese.items():
        # Replace whole words only to avoid partial matches
        pattern = r'\b' + re.escape(eng) + r'\b'
        answer = re.sub(pattern, vi, answer, flags=re.IGNORECASE)
    
    # Improved repetition detection: check for repeated phrases throughout the answer
    words = answer.split()
    if len(words) > 10:
        # Check for repetition in overlapping windows
        for window_size in range(5, min(15, len(words) // 2)):
            for start in range(len(words) - window_size * 2):
                phrase1 = " ".join(words[start:start + window_size])
                phrase2 = " ".join(words[start + window_size:start + window_size * 2])
                if phrase1 == phrase2 and len(phrase1) > 10:
                    # Found repetition, remove second occurrence
                    answer = " ".join(words[:start + window_size])
                    words = answer.split()
                    break
    
    # Remove repeated phrases at the end (improved heuristic)
    if len(words) > 15:
        # Check for repetition in last 12 words
        last_12 = words[-12:]
        for i in range(4, len(last_12)):
            phrase = " ".join(last_12[-i:])
            # Check if this phrase appears earlier in the answer
            earlier_text = " ".join(words[:-12])
            if phrase in earlier_text and len(phrase) > 15:
                # Found repetition, truncate
                answer = " ".join(words[:-i])
                break
    
    # Remove common trailing phrases that indicate repetition or unnecessary endings
    trailing_phrases = [
        "Nếu bạn cần thêm thông tin",
        "Bạn có thể cần thêm",
        "Chúc bạn một ngày",
        "Xin chào và hẹn gặp lại",
        "Nếu bạn cần thêm sự hỗ trợ",
        "Chúng tôi rất vinh dự",
        "Cảm ơn bạn đã lựa chọn",
        "Rất vui được làm việc với bạn",
        "Đừng ngần ngại liên hệ",
        "Nếu bạn có thêm câu hỏi",
        "Hy vọng thông tin này hữu ích",
        "Cảm ơn bạn đã sử dụng",
    ]
    for phrase in trailing_phrases:
        if phrase in answer:
            idx = answer.find(phrase)
            answer = answer[:idx].strip()
            break
    
    # Remove duplicate sentences (simple check)
    sentences = answer.split('. ')
    if len(sentences) > 1:
        seen = set()
        unique_sentences = []
        for sent in sentences:
            sent_clean = sent.strip().lower()
            if sent_clean and sent_clean not in seen:
                seen.add(sent_clean)
                unique_sentences.append(sent)
        answer = '. '.join(unique_sentences)
    
    # Filter out non-Vietnamese/Latin characters (Chinese, Japanese, Korean, etc.)
    # Only keep Vietnamese characters, Latin letters, numbers, and common punctuation
    filtered_chars = []
    for char in answer:
        # Allow: Vietnamese characters, Latin letters, numbers, spaces, common punctuation
        if (ord('a') <= ord(char.lower()) <= ord('z') or  # Latin letters
            ord('0') <= ord(char) <= ord('9') or  # Numbers
            char in ' .,!?;:()[]{}\'"-–—' or  # Common punctuation
            '\u00C0' <= char <= '\u1EF9'):  # Vietnamese characters (À-ỹ)
            filtered_chars.append(char)
        # Skip all other characters (Chinese, Japanese, Korean, etc.)
    
    answer = ''.join(filtered_chars)
    
    # Final cleanup: remove extra whitespace
    answer = ' '.join(answer.split())
    
    return answer.strip()


def generate_answer(question: str, context_chunks: List[str]) -> str:
    """Generate answer using Qwen2.5-3B-Instruct"""
    global llm_model, llm_tokenizer
    
    ensure_models_loaded()
    
    if llm_model is None or llm_tokenizer is None:
        return "Xin lỗi, mô hình ngôn ngữ chưa được tải. Vui lòng kiểm tra lại cấu hình và đảm bảo models đã được tải về."
    
    # Build context - use more chunks for comprehensive answers
    context = "\n\n".join(context_chunks[:20])  # Increased from 10 to 20 chunks
    
    # Use Qwen chat template for better format
    # Strong prompt to enforce Vietnamese-only output
    messages = [
        {
            "role": "system",
            "content": "Bạn là trợ lý AI. QUY TẮC NGHIÊM NGẶT: CHỈ được dùng TIẾNG VIỆT (Vietnamese). TUYỆT ĐỐI KHÔNG dùng tiếng Anh, tiếng Trung, tiếng Nhật, tiếng Hàn, hoặc bất kỳ ngôn ngữ nào khác. Chỉ dùng thông tin trong ngữ cảnh. Nếu không có, nói 'Không tìm thấy trong tài liệu'."
        },
        {
            "role": "user",
            "content": f"Ngữ cảnh:\n{context}\n\nHỏi: {question}\n\nTrả lời ngắn gọn BẰNG TIẾNG VIỆT (chỉ tiếng Việt, không dùng ngôn ngữ khác):"
        }
    ]
    
    try:
        # Apply chat template
        prompt = llm_tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True
        )
        
        # Tokenize
        inputs = llm_tokenizer(prompt, return_tensors="pt", truncation=True, max_length=2048)
        inputs = {k: v.to(device) for k, v in inputs.items()}
        
        # Generate with optimized anti-repetition parameters
        with torch.no_grad():
            outputs = llm_model.generate(
                **inputs,
                max_new_tokens=250,  # Further reduced for concise answers
                temperature=0.6,  # Lower temperature for more focused responses
                do_sample=True,
                pad_token_id=llm_tokenizer.eos_token_id,
                eos_token_id=llm_tokenizer.eos_token_id,
                repetition_penalty=1.5,  # Increased to 1.5 for stronger anti-repetition
                no_repeat_ngram_size=4,  # Increased to 4-gram to prevent longer phrase repetition
                top_p=0.85,  # Slightly lower for more focused sampling
                top_k=50,  # Add top_k for better control
            )
        
        # Decode only new tokens
        generated_tokens = outputs[0][inputs['input_ids'].shape[1]:]
        answer = llm_tokenizer.decode(generated_tokens, skip_special_tokens=True)
        
        # Clean up answer - remove trailing tags and repeated phrases
        answer = answer.strip()
        
        # Enhanced post-processing: Clean and normalize answer
        answer = clean_answer(answer)
        
        return answer if answer else "Xin lỗi, tôi không thể tạo câu trả lời."
    
    except Exception as e:
        print(f"[ERROR] Failed to generate answer: {e}", flush=True)
        return f"Xin lỗi, đã xảy ra lỗi khi tạo câu trả lời: {str(e)}"


class ChatbotQuestion(BaseModel):
    question: str
    file_ids: List[str]


@app.post("/chatbot/upload")
async def chatbot_upload(files: List[UploadFile] = File(...)):
    """Upload files for chatbot processing"""
    uploaded_file_ids = []
    
    for file in files:
        file_id = str(uuid.uuid4())
        file_ext = Path(file.filename).suffix.lower()
        
        if file_ext not in [".pdf", ".docx"]:
            continue
        
        file_path = CHATBOT_UPLOAD_DIR / f"{file_id}{file_ext}"
        
        # Save file
        with open(file_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
        
        try:
            # Process document
            chunk_count = process_document(file_path, file_id)
            uploaded_file_ids.append({
                "id": file_id,
                "name": file.filename,
                "chunks": chunk_count
            })
        except Exception as e:
            print(f"[ERROR] Failed to process {file.filename}: {e}", flush=True)
            # Clean up file
            if file_path.exists():
                file_path.unlink()
    
    return {"files": uploaded_file_ids}


def generate_answer_direct(question: str) -> str:
    """Generate answer directly using LLM without RAG"""
    global llm_model, llm_tokenizer
    
    if llm_model is None or llm_tokenizer is None:
        return "Xin lỗi, mô hình ngôn ngữ chưa được tải. Vui lòng kiểm tra lại cấu hình và đảm bảo models đã được tải về."
    
    # Use Qwen chat template for better format
    # Strong prompt to enforce Vietnamese-only output
    messages = [
        {
            "role": "system",
            "content": "Bạn là trợ lý thân thiện. QUY TẮC NGHIÊM NGẶT: CHỈ được dùng TIẾNG VIỆT (Vietnamese). TUYỆT ĐỐI KHÔNG dùng tiếng Anh, tiếng Trung, tiếng Nhật, tiếng Hàn, hoặc bất kỳ ngôn ngữ nào khác. Trả lời ngắn gọn, tự nhiên. Nếu không biết, nói 'Tôi không có thông tin này'."
        },
        {
            "role": "user",
            "content": f"{question}\n\nTrả lời ngắn gọn BẰNG TIẾNG VIỆT (chỉ tiếng Việt, không dùng ngôn ngữ khác):"
        }
    ]
    
    try:
        # Apply chat template
        prompt = llm_tokenizer.apply_chat_template(
            messages,
            tokenize=False,
            add_generation_prompt=True
        )
        
        # Tokenize
        inputs = llm_tokenizer(prompt, return_tensors="pt", truncation=True, max_length=2048)
        inputs = {k: v.to(device) for k, v in inputs.items()}
        
        # Generate with optimized anti-repetition parameters
        with torch.no_grad():
            outputs = llm_model.generate(
                **inputs,
                max_new_tokens=180,  # Reduced for concise answers
                temperature=0.6,  # Lower temperature for more focused responses
                do_sample=True,
                pad_token_id=llm_tokenizer.eos_token_id,
                eos_token_id=llm_tokenizer.eos_token_id,
                repetition_penalty=1.5,  # Increased to 1.5 for stronger anti-repetition
                no_repeat_ngram_size=4,  # Increased to 4-gram to prevent longer phrase repetition
                top_p=0.85,  # Slightly lower for more focused sampling
                top_k=50,  # Add top_k for better control
            )
        
        # Decode only new tokens
        generated_tokens = outputs[0][inputs['input_ids'].shape[1]:]
        answer = llm_tokenizer.decode(generated_tokens, skip_special_tokens=True)
        
        # Clean up answer - remove trailing tags and repeated phrases
        answer = answer.strip()
        
        # Enhanced post-processing: Clean and normalize answer
        answer = clean_answer(answer)
        
        return answer if answer else "Xin lỗi, tôi không thể tạo câu trả lời."
    
    except Exception as e:
        print(f"[ERROR] Failed to generate direct answer: {e}", flush=True)
        return f"Xin lỗi, đã xảy ra lỗi khi tạo câu trả lời: {str(e)}"


@app.post("/chatbot/ask")
async def chatbot_ask(request: ChatbotQuestion):
    """Ask question to chatbot with improved routing logic"""
    ensure_models_loaded()
    
    # If no files uploaded, use direct LLM
    if not request.file_ids:
        answer = generate_answer_direct(request.question)
        return {"answer": answer}
    
    # If files uploaded, use RAG with improved retrieval
    # Retrieve relevant chunks with more lenient threshold for better recall
    context_chunks = retrieve_relevant_chunks(request.question, request.file_ids, top_k=15, distance_threshold=3.0)
    
    # If no relevant chunks found, try with even more lenient threshold
    if not context_chunks:
        print(f"[WARN] No chunks found with threshold=3.0, trying threshold=5.0", flush=True)
        context_chunks = retrieve_relevant_chunks(request.question, request.file_ids, top_k=10, distance_threshold=5.0)
    
    # If still no chunks, fallback to direct LLM
    if not context_chunks:
        answer = generate_answer_direct(request.question)
        return {
            "answer": answer + "\n\n(Lưu ý: Không tìm thấy thông tin liên quan trong tài liệu đã tải lên. Đây là câu trả lời dựa trên kiến thức chung.)"
        }
    
    # Generate answer using RAG
    answer = generate_answer(request.question, context_chunks)
    
    return {"answer": answer}
