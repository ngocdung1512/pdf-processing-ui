@echo off

REM Convenience wrapper to start AnythingLLM servers AND open browser.
cd /d "%~dp0"
call "%~dp0start-chatbot-core.bat"

REM Wait then open browser to chatbot UI
echo Waiting a few seconds before opening the browser...
timeout /t 10 /nobreak > nul
start "" "http://localhost:3002"

exit /b 0

