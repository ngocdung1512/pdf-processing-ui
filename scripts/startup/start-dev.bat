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
echo  Both servers are running!
echo  Frontend: http://localhost:3000
echo  Backend:  http://localhost:8000
echo ========================================
echo.
echo Both servers are running in separate windows.
echo Close those windows to stop the servers.
echo.
pause

