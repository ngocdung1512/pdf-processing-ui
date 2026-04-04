@echo off
REM PDF extract API for AnythingLLM Collector (port 8001).
REM Uses services\pdf_processing\.venv python directly — avoids "call activate" CMD quirks.

setlocal
cd /d "%~dp0\..\.."
set "ROOT=%CD%"
set "PP=%ROOT%\services\pdf_processing"
if not exist "%PP%\api\extract_main.py" set "PP=%ROOT%\pdf_processing"

if not exist "%PP%\api\extract_main.py" (
  echo ERROR: pdf extract service not found. Expected "%ROOT%\services\pdf_processing" ^(or legacy "%ROOT%\pdf_processing"^).
  exit /b 1
)

cd /d "%PP%"

REM Default 4-bit Qwen OCR (much lower VRAM than float16; reduces silent GPU OOM kills)
if not defined PDF_PIPELINE_OCR_LOAD_4BIT set "PDF_PIPELINE_OCR_LOAD_4BIT=true"

REM Plain text for Collector embed (no [Para_N] in chunks). Set false to keep ID-prefixed text.
if not defined PDF_EXTRACT_PLAIN_PAGE_CONTENT set "PDF_EXTRACT_PLAIN_PAGE_CONTENT=true"

set "PY="
if exist "%PP%\.venv\Scripts\python.exe" set "PY=%PP%\.venv\Scripts\python.exe"
if not defined PY if exist "%ROOT%\conversion_env\Scripts\python.exe" set "PY=%ROOT%\conversion_env\Scripts\python.exe"
if not defined PY set "PY=python"

echo Using Python: %PY%
echo PDF_PIPELINE_OCR_LOAD_4BIT=%PDF_PIPELINE_OCR_LOAD_4BIT%
echo Starting uvicorn api.extract_main:app on 0.0.0.0:8001 ...

"%PY%" -m uvicorn api.extract_main:app --host 0.0.0.0 --port 8001
