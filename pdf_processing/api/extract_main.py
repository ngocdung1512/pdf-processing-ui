"""
Lightweight FastAPI app for PDF text extraction only (AnythingLLM Collector bridge).

Does NOT load ChromaDB or LLM — faster startup than api.main.

Usage (from repository root pdf_processing/):
  pip install -r requirements.txt   # or your env
  uvicorn api.extract_main:app --host 0.0.0.0 --port 8001

Collector .env:
  PDF_PROCESSING_EXTRACT_URL=http://127.0.0.1:8001/integrations/chatbot-extract-pdf
  PDF_PROCESSING_EXTRACT_TOKEN=<optional; must match CHATBOT_PDF_EXTRACT_TOKEN here>
"""
import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

ROOT_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT_DIR / "src"))

from api.routes.pdf_extract import router as pdf_extract_router

app = FastAPI(
    title="PDF extract (AnythingLLM bridge)",
    version="1.0.0",
    description="POST /integrations/chatbot-extract-pdf — multipart field 'file'",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(pdf_extract_router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "pdf_extract_bridge"}
