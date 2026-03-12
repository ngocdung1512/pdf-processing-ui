@echo off
setlocal
cd /d "%~dp0\..\.."
set "PROJECT_ROOT=%CD%"
set "OCR_LLM=%PROJECT_ROOT%\OCR_LLM"
set "FRONTEND=%OCR_LLM%\frontend"

echo ==========================================
echo  Chatbot - Clear cache and start
echo ==========================================
echo.

REM Kill existing node on 4101, 8888, 3002 to avoid EADDRINUSE
echo [0] Stopping any process on ports 4101, 8888, 3002...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":4101 :8888 :3002" ^| findstr "LISTENING" 2^>nul') do (
  taskkill /PID %%a /F >nul 2>&1
)
timeout /t 2 /nobreak >nul

REM Clear Vite cache (frontend)
if exist "%FRONTEND%\node_modules\.vite" (
  echo [1] Clearing Vite cache...
  rmdir /s /q "%FRONTEND%\node_modules\.vite"
)
if exist "%FRONTEND%\.vite" (
  rmdir /s /q "%FRONTEND%\.vite"
)
echo [2] Starting Chatbot Server (4101)...
start "Chatbot Server - 4101" cmd /k "cd /d ""%OCR_LLM"" && set SERVER_PORT=4101 && yarn dev:server"
timeout /t 3 /nobreak >nul

echo [3] Starting Chatbot Collector (8888)...
start "Chatbot Collector - 8888" cmd /k "cd /d ""%OCR_LLM"" && yarn dev:collector"
timeout /t 2 /nobreak >nul

echo [4] Starting Chatbot Frontend (3002)...
start "Chatbot Frontend - 3002" cmd /k "cd /d ""%OCR_LLM"" && yarn dev:frontend"

echo.
echo Waiting for servers...
timeout /t 10 /nobreak >nul

echo Opening http://localhost:3002
start "" "http://localhost:3002"

echo.
echo ==========================================
echo  Giu 3 cua so CMD mo. Mo http://localhost:3002
echo ==========================================
pause
