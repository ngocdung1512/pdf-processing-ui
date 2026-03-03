@echo off
echo ========================================
echo  PDF Processing UI - Chatbot Server
echo ========================================
echo.

REM Change to root directory (parent of scripts/startup)
cd /d "%~dp0\..\.."

REM Activate virtual environment if exists
if exist "conversion_env\Scripts\activate.bat" (
    echo Activating virtual environment...
    call conversion_env\Scripts\activate.bat
)

REM Start backend in new window
echo [1/3] Starting Backend (FastAPI) on port 8000...
echo   Opening new window for Backend...
start "FastAPI Backend - Port 8000" cmd /k "cd /d %CD% && echo [Backend] Starting FastAPI server... && if exist conversion_env\Scripts\activate.bat (call conversion_env\Scripts\activate.bat) && uvicorn api:app --port 8000 --reload || echo [ERROR] Failed to start backend! Check if uvicorn is installed."

REM Wait for backend to initialize
echo [2/3] Waiting for backend to start...
timeout /t 3 /nobreak > nul

REM Start frontend in new window
echo [3/3] Starting Frontend (Next.js) on port 3000...
echo   Opening new window for Frontend...
start "Next.js Frontend - Port 3000" cmd /k "cd /d %CD% && echo [Frontend] Starting Next.js server... && npm run dev || echo [ERROR] Failed to start frontend! Check if npm is installed and node_modules exists."

REM Start browser opener in background
start /B "" "%~dp0open-browser.bat"

REM Wait for frontend to start
echo Waiting for frontend server to be ready...
echo Browser will open automatically in ~12 seconds...

echo.
echo ========================================
echo  Servers are starting!
echo ========================================
echo.
echo Check the two new CMD windows:
echo   - "FastAPI Backend - Port 8000" (Backend)
echo   - "Next.js Frontend - Port 3000" (Frontend)
echo.
echo URLs:
echo   Chatbot: http://localhost:3000/chatbot
echo   Frontend: http://localhost:3000
echo   Backend:  http://localhost:8000/docs
echo.
echo Browser will open automatically in ~12 seconds.
echo If it doesn't, manually open: http://localhost:3000/chatbot
echo.
echo To stop servers: Close the two CMD windows above.
echo.
pause

