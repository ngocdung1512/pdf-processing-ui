@echo off
REM Wrapper script to start chatbot servers
REM This script calls the actual script in scripts\startup\

cd /d "%~dp0"
call "%~dp0scripts\startup\start-chatbot.bat"

