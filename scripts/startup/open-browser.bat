@echo off
REM Wait a bit for server to be ready
timeout /t 12 /nobreak > nul

REM Open browser using multiple methods
echo Opening browser...
start http://localhost:3000/chatbot
timeout /t 1 /nobreak > nul
rundll32 url.dll,FileProtocolHandler http://localhost:3000/chatbot

