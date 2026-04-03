"""
AnythingLLM / Collector bridge: extract plain text from PDF using pdf_processing pipeline.

Run standalone (no LLM load): from pdf_processing dir:
  uvicorn api.extract_main:app --host 0.0.0.0 --port 8001

Or include in full api.main app (heavier startup).
"""
import os
import uuid
import asyncio
import time
import hashlib
from pathlib import Path

from fastapi import APIRouter, File, Header, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool

router = APIRouter(prefix="/integrations", tags=["integrations"])

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
EXTRACT_TEMP = ROOT_DIR / "uploads" / "_chatbot_extract"
TOKEN_ENV = "CHATBOT_PDF_EXTRACT_TOKEN"
EXTRACT_TIMEOUT_SEC = int(os.environ.get("PDF_EXTRACT_TIMEOUT_SEC", "900"))
DEDUP_TTL_SEC = int(os.environ.get("PDF_EXTRACT_DEDUP_TTL_SEC", "180"))
_INFLIGHT: dict[str, asyncio.Task] = {}
_RECENT: dict[str, tuple[float, dict]] = {}


def _auth_ok(authorization: str | None) -> None:
    expected = os.environ.get(TOKEN_ENV)
    if not expected:
        return
    if not authorization or authorization.strip() != f"Bearer {expected}":
        raise HTTPException(status_code=401, detail="Unauthorized")


@router.post("/chatbot-extract-pdf")
async def chatbot_extract_pdf(
    file: UploadFile = File(...),
    authorization: str | None = Header(None, alias="Authorization"),
):
    """
    Accept a PDF, run document_parser.ingest_file (convert + structure), return full text.
    Response shape matches what the Collector Node client expects.
    """
    _auth_ok(authorization)

    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")

    try:
        raw = await file.read()
        if not raw:
            return {
                "success": False,
                "pageContent": "",
                "title": file.filename or "document.pdf",
                "error": "Empty file",
            }
        # Deduplicate repeated requests for the same file bytes.
        file_key = f"{len(raw)}:{hashlib.sha256(raw).hexdigest()}"
        now = time.time()
        cached = _RECENT.get(file_key)
        if cached and now - cached[0] <= max(0, DEDUP_TTL_SEC):
            return cached[1]
        if cached:
            _RECENT.pop(file_key, None)

        existing_task = _INFLIGHT.get(file_key)
        if existing_task is not None:
            return await existing_task

        EXTRACT_TEMP.mkdir(parents=True, exist_ok=True)
        uid = uuid.uuid4().hex
        pdf_path = EXTRACT_TEMP / f"{uid}.pdf"

        async def _run_extract() -> dict:
            try:
                pdf_path.write_bytes(raw)
                from llm_pipeline import document_parser

                structure = await asyncio.wait_for(
                    run_in_threadpool(
                        document_parser.ingest_file,
                        str(pdf_path.resolve()),
                        upload_dir=str(EXTRACT_TEMP.resolve()),
                    ),
                    timeout=EXTRACT_TIMEOUT_SEC,
                )
                use_plain = os.environ.get(
                    "PDF_EXTRACT_PLAIN_PAGE_CONTENT", "true"
                ).strip().lower() not in ("0", "false", "no", "off")
                text = (
                    structure.get_plain_text_for_embed()
                    if use_plain
                    else structure.get_full_text()
                )
                return {
                    "success": True,
                    "pageContent": text,
                    "title": structure.file_name or file.filename,
                    "error": None,
                }
            finally:
                for pattern in (f"{uid}.pdf", f"{uid}_converted.docx"):
                    p = EXTRACT_TEMP / pattern
                    try:
                        if p.exists():
                            p.unlink()
                    except OSError:
                        pass

        task = asyncio.create_task(_run_extract())
        _INFLIGHT[file_key] = task
        try:
            result = await task
            _RECENT[file_key] = (time.time(), result)
            return result
        finally:
            if _INFLIGHT.get(file_key) is task:
                _INFLIGHT.pop(file_key, None)
    except asyncio.TimeoutError:
        return {
            "success": False,
            "pageContent": "",
            "title": file.filename or "document.pdf",
            "error": f"PDF extract timeout after {EXTRACT_TIMEOUT_SEC}s",
        }
    except Exception as e:
        return {
            "success": False,
            "pageContent": "",
            "title": file.filename or "document.pdf",
            "error": str(e),
        }
