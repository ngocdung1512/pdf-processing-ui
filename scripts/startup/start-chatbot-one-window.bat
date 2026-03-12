@echo off
setlocal
REM Run chatbot like upstream: all 3 processes in ONE terminal (concurrently).
REM Server=4101, Collector=8888, Frontend=3002. Keeps Collector running so drag-drop works.

cd /d "%~dp0\..\.."
set "PROJECT_ROOT=%CD%"

if not exist "%PROJECT_ROOT%\OCR_LLM\package.json" (
    echo OCR_LLM not found.
    pause
    exit /b 1
)
if not exist "%PROJECT_ROOT%\OCR_LLM\frontend\node_modules" (
    echo Chatbot chua cai dat. Chay: npm run chatbot:setup
    pause
    exit /b 1
)

echo ==========================================
echo  Chatbot - 1 cua so (giong code goc AnythingLLM)
echo  Server 4101, Collector 8888, Frontend 3002
echo ==========================================
echo.
set SERVER_PORT=4101
cd /d "%PROJECT_ROOT%\OCR_LLM"
call yarn dev:all
