@echo off
setlocal

REM Change to project root directory (parent of scripts\startup\)
cd /d "%~dp0\..\.."
set "PROJECT_ROOT=%CD%"

echo ==========================================
echo  AnythingLLM OCR_LLM - Dev Servers
echo ==========================================
echo.

REM PDF extract bridge (pdf_processing) — Collector uses PDF_PROCESSING_EXTRACT_URL
set "PDF_EXTRACT_URL=http://127.0.0.1:8001/integrations/chatbot-extract-pdf"
echo [1/4] Starting PDF extract bridge pdf_processing on port 8001...
start "PDF extract bridge - 8001" cmd /k "call ""%PROJECT_ROOT%\scripts\startup\start-pdf-extract-bridge.bat"""

call "%PROJECT_ROOT%\scripts\startup\wait-pdf-bridge-health.bat"
if errorlevel 1 (
  echo.
  echo WARNING: PDF bridge not ready. Fix the "PDF extract bridge - 8001" window, then retry upload.
)

REM Window 2: AnythingLLM server (API) on 4101 (must set SERVER_PORT so frontend .env 4101 matches)
echo [2/4] Starting AnythingLLM server API on port 4101...
start "AnythingLLM Server - 4101" cmd /k "cd /d ""%PROJECT_ROOT%\OCR_LLM"" && set SERVER_PORT=4101 && yarn dev:server"

REM Window 3: Collector on 8888 (inline URL so chat PDF uses pdf_processing without editing .env)
echo [3/4] Starting document collector on port 8888 - PDF bridge %PDF_EXTRACT_URL%
REM REQUIRE_BRIDGE=true: PDFs use only pdf_processing full pipeline; no Tesseract fallback
start "AnythingLLM Collector - 8888" cmd /k "cd /d ""%PROJECT_ROOT%\OCR_LLM"" && set PDF_PROCESSING_EXTRACT_URL=%PDF_EXTRACT_URL% && set PDF_PROCESSING_EXTRACT_REQUIRE_BRIDGE=true && set PDF_PROCESSING_EXTRACT_RETRIES=5 && set PDF_PROCESSING_EXTRACT_RETRY_DELAY_MS=3000 && yarn dev:collector"

REM Window 4: Frontend on 3002
echo [4/4] Starting AnythingLLM frontend on port 3002...
start "AnythingLLM Frontend - 3002" cmd /k "cd /d ""%PROJECT_ROOT%\OCR_LLM"" && yarn dev:frontend"

echo.
echo AnythingLLM dev servers started - no browser auto-open.
echo PDF in chat: Collector -^> %PDF_EXTRACT_URL% - ensure Python deps in pdf_processing
echo.
exit /b 0

