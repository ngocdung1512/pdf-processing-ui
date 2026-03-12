@echo off
REM Quick check: chatbot needs Server on 4101 and Frontend on 3002. Server default is 3001 if SERVER_PORT not set.
cd /d "%~dp0\.."
echo Checking chatbot ports (Server=4101, Frontend=3002)...
echo.
netstat -an | findstr ":4101 :3002 :3001" 2>nul
if %errorlevel% neq 0 (
    echo No process found on 4101, 3002 or 3001.
    echo Start with: scripts\startup\start-dev.bat  OR  scripts\startup\start-chatbot-core.bat
    echo Both scripts set SERVER_PORT=4101 so the API is on 4101. If you run "yarn dev:server" by hand, set SERVER_PORT=4101 first.
) else (
    echo If 4101 LISTENING = Chatbot Server OK. If 3002 LISTENING = Frontend OK.
    echo If only 3001 LISTENING (no 4101): Server is on wrong port. Restart with start-dev.bat or: set SERVER_PORT=4101 ^&^& yarn dev:server
)
echo.
pause
