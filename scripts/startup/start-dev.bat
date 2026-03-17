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
echo [1/3] Starting Backend (FastAPI) on port 8000...
start "FastAPI Backend - Port 8000" cmd /k "cd /d %CD% && if exist conversion_env\Scripts\activate.bat (call conversion_env\Scripts\activate.bat) && uvicorn api:app --port 8000 --reload"

REM Wait for backend to initialize
echo [2/3] Waiting for backend to start...
timeout /t 3 /nobreak > nul

REM Start frontend in new window
echo [3/3] Starting Frontend (Next.js) on port 3000...
start "Next.js Frontend - Port 3000" cmd /k "cd /d %CD% && npm run dev && timeout /t 10"

REM Also start AnythingLLM servers in background (no browser)
if exist "scripts\startup\start-chatbot-core.bat" (
    echo.
    echo Stopping any process on chatbot ports 4101, 8888, 3002...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4101 :8888 :3002" ^| findstr "LISTENING" 2^>nul') do (
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
echo  Chatbot:   (optional) run start-chatbot.bat, then open http://localhost:3002
echo ========================================
echo.
echo Both servers are running in separate windows.
echo Close those windows to stop the servers.
echo.
pause

