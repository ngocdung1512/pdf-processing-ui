@echo off
setlocal

REM Usage: start-chatbot-service-stable.bat <role> <port>
set "ROLE=%~1"
set "PORT=%~2"
if "%ROLE%"=="" set "ROLE=chat"
if "%PORT%"=="" set "PORT=8011"

cd /d "%~dp0\..\.."
set "PROJECT_ROOT=%CD%"

set "PY_EXE=%PROJECT_ROOT%\conversion_env\Scripts\python.exe"
if not exist "%PY_EXE%" set "PY_EXE=python"

echo ==========================================
echo  Chatbot %ROLE% watchdog - %PORT%
echo ==========================================
echo.

:loop
echo [%date% %time%] Starting chatbot service role=%ROLE% port=%PORT% ...
cd /d "%PROJECT_ROOT%\chatbot"
set CHATBOT_SERVICE_ROLE=%ROLE%
set CHATBOT_EMBED_DEVICE=cpu
if /I "%ROLE%"=="chat" (
  set CHATBOT_LLM_DEVICE=cpu
  set CHATBOT_PRELOAD_LLM=false
) else (
  set CHATBOT_PRELOAD_LLM=false
)
"%PY_EXE%" -m uvicorn api.main:app --host 127.0.0.1 --port %PORT%
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo [%date% %time%] Chatbot %ROLE% exited with code %EXIT_CODE%.
echo Restarting in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop

