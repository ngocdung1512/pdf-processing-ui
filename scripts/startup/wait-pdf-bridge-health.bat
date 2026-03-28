@echo off
REM Wait until PDF extract bridge answers GET /health (avoids Collector "fetch failed" race).
setlocal
set "URL=http://127.0.0.1:8001/health"
set /a MAX=35
set /a N=0

echo Waiting for PDF bridge %URL% ...
:loop
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri '%URL%' -UseBasicParsing -TimeoutSec 3; if ($r.StatusCode -eq 200) { exit 0 } } catch { }; exit 1" >nul 2>&1
if %errorlevel%==0 (
  echo PDF bridge is up.
  exit /b 0
)
set /a N+=1
if %N% GEQ %MAX% (
  echo.
  echo ERROR: PDF bridge did not become ready after %MAX% attempts (~70s).
  echo Open the "PDF extract bridge - 8001" window and fix any Python error, then retry.
  echo Manual start: scripts\startup\start-pdf-extract-bridge.bat
  exit /b 1
)
echo   ... attempt %N%/%MAX%
timeout /t 2 /nobreak > nul
goto loop
