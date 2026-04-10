@echo off
REM Stop dev servers (ports 3000, 3002, 8000, 8001, 8010, 4101, 8888).
cd /d "%~dp0"
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop-dev.ps1"
pause
