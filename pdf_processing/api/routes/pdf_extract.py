"""
AnythingLLM / Collector bridge: extract plain text from PDF using pdf_processing pipeline.

Run standalone (no LLM load): from pdf_processing dir:
  uvicorn api.extract_main:app --host 0.0.0.0 --port 8001

Or include in full api.main app (heavier startup).
"""
import os
import uuid
from pathlib import Path

from fastapi import APIRouter, File, Header, HTTPException, UploadFile

router = APIRouter(prefix="/integrations", tags=["integrations"])

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
EXTRACT_TEMP = ROOT_DIR / "uploads" / "_chatbot_extract"
TOKEN_ENV = "CHATBOT_PDF_EXTRACT_TOKEN"


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

    EXTRACT_TEMP.mkdir(parents=True, exist_ok=True)
    uid = uuid.uuid4().hex
    pdf_path = EXTRACT_TEMP / f"{uid}.pdf"

    try:
        raw = await file.read()
        if not raw:
            return {
                "success": False,
                "pageContent": "",
                "title": file.filename or "document.pdf",
                "error": "Empty file",
            }
        pdf_path.write_bytes(raw)

        from llm_pipeline import document_parser

        structure = document_parser.ingest_file(
            str(pdf_path.resolve()),
            upload_dir=str(EXTRACT_TEMP.resolve()),
        )
        text = structure.get_full_text()
        return {
            "success": True,
            "pageContent": text,
            "title": structure.file_name or file.filename,
            "error": None,
        }
    except Exception as e:
        return {
            "success": False,
            "pageContent": "",
            "title": file.filename or "document.pdf",
            "error": str(e),
        }
    finally:
        for pattern in (f"{uid}.pdf", f"{uid}_converted.docx"):
            p = EXTRACT_TEMP / pattern
            try:
                if p.exists():
                    p.unlink()
            except OSError:
                pass
