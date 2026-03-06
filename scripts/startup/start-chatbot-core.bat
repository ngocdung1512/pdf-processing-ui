@echo off
setlocal

REM Change to project root directory (parent of scripts\startup\)
cd /d "%~dp0\..\.."
set "PROJECT_ROOT=%CD%"

echo ==========================================
echo  AnythingLLM (OCR_LLM) - Dev Servers
echo ==========================================
echo.

REM Window 1: AnythingLLM server (API) on 4101
echo [1/3] Starting AnythingLLM server (API) on port 4101...
start "AnythingLLM Server - 4101" cmd /k "cd /d ""%PROJECT_ROOT%\OCR_LLM"" && yarn dev:server"

REM Window 2: Collector on 8888
echo [2/3] Starting document collector on port 8888...
start "AnythingLLM Collector - 8888" cmd /k "cd /d ""%PROJECT_ROOT%\OCR_LLM"" && yarn dev:collector"

REM Window 3: Frontend on 3002
echo [3/3] Starting AnythingLLM frontend on port 3002...
start "AnythingLLM Frontend - 3002" cmd /k "cd /d ""%PROJECT_ROOT%\OCR_LLM"" && yarn dev:frontend"

echo.
echo AnythingLLM dev servers started (no browser auto-open).
echo.
exit /b 0

