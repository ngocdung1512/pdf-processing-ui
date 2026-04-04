@echo off
REM Change to project root directory (parent of scripts\startup\)
cd /d "%~dp0\..\.."

echo ========================================
echo  PDF Processing UI - Development Server
echo ========================================
echo.

REM Activate virtual environment if exists
if exist "conversion_env\Scripts\activate.bat" (
    echo Activating virtual environment...
    call conversion_env\Scripts\activate.bat
)

REM Start backend in new window
echo [1/3] Starting Backend FastAPI on port 8000...
start "FastAPI Backend - Port 8000" cmd /k "cd /d %CD% && if exist conversion_env\Scripts\activate.bat (call conversion_env\Scripts\activate.bat) && uvicorn ocr_app.api:app --port 8000 --reload"

REM Wait for backend to initialize
echo [2/3] Waiting for backend to start...
timeout /t 3 /nobreak > nul

REM Start frontend in new window
echo [3/3] Starting Frontend Next.js on port 3000 (webpack mode)...
start "Next.js Frontend - Port 3000" cmd /k "cd /d %CD% && npm run dev -- --webpack && timeout /t 10"

REM Hybrid chatbot API (8010) — used for PDF / spreadsheet attachments only; Word stays on AnythingLLM
echo.
echo Starting Hybrid Chatbot API on port 8010...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8010" ^| findstr "LISTENING" 2^>nul') do (
  taskkill /PID %%a /F >nul 2>&1
)
start "Hybrid Chatbot API - Port 8010" cmd /k "cd /d %CD% && call scripts\startup\start-chatbot-api-stable.bat"

REM Also start AnythingLLM servers in background (no browser)
if exist "scripts\startup\start-chatbot-core.bat" (
    echo.
    echo Stopping any process on chatbot ports 4101, 8888, 3002, 8001 - PDF bridge...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4101 :8888 :3002 :8001" ^| findstr "LISTENING" 2^>nul') do (
      taskkill /PID %%a /F >nul 2>&1
    )
    timeout /t 2 /nobreak >nul
    echo Starting AnythingLLM OCR_LLM servers in background...
    start "AnythingLLM Startup" cmd /k "cd /d %CD% && call scripts\startup\start-chatbot-core.bat"
)

REM Wait for frontend to start
echo Waiting for frontend server to be ready...
timeout /t 8 /nobreak > nul

REM Open browser in default browser (not Cursor)
echo.
echo Opening browser in default browser...
REM Use start command to open in default browser
start "" "http://localhost:3000"

echo.
echo ========================================
echo  App servers are running!
echo  Frontend:  http://localhost:3000
echo  Backend:   http://localhost:8000
echo  Hybrid:    Chatbot API (PDF/xlsx/csv) http://127.0.0.1:8010
echo  Chatbot:   AnythingLLM auto-starts ports 3002, 4101, 8888 + PDF bridge 8001 when start-chatbot-core runs
echo ========================================
echo.
echo Both servers are running in separate windows.
echo Close those windows to stop the servers.
echo.
pause

