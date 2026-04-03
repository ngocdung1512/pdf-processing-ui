@echo off
setlocal

REM Start standalone chatbot API + open web UI
cd /d "%~dp0"

if not exist "api\main.py" (
  echo [ERROR] Run this script inside chatbot folder.
  pause
  exit /b 1
)

set "PY_EXE=%~dp0..\conversion_env\Scripts\python.exe"
if not exist "%PY_EXE%" set "PY_EXE=python"

echo Starting chatbot API at http://127.0.0.1:8010 ...
start "Chatbot API" /D "%~dp0" cmd /k ""%PY_EXE%" -m uvicorn api.main:app --host 127.0.0.1 --port 8010"

echo Waiting for API boot...
timeout /t 6 /nobreak > nul

echo Opening chatbot UI...
start "" "http://127.0.0.1:8010/chatbot"

echo Done.
exit /b 0

