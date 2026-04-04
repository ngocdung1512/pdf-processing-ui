@echo off
REM Remove leftover root folders chatbot\ and pdf_processing\ after move to services\.
REM Close all uvicorn/Python/Chroma windows first, or removal may fail (file in use).

setlocal
cd /d "%~dp0\..\.."
set "ROOT=%CD%"

echo This will try to DELETE (if present):
echo   "%ROOT%\chatbot"
echo   "%ROOT%\pdf_processing"
echo Only empty or leftover chroma/.venv dirs should remain there.
echo.
set /p OK=Type YES to continue: 
if /I not "%OK%"=="YES" (
  echo Cancelled.
  exit /b 1
)

if exist "%ROOT%\chatbot" (
  rmdir /s /q "%ROOT%\chatbot" 2>nul
  if exist "%ROOT%\chatbot" (
    echo FAILED: "%ROOT%\chatbot" — stop Chroma/Python using it, then delete manually.
  ) else (
    echo Removed "%ROOT%\chatbot"
  )
) else (
  echo No "%ROOT%\chatbot" — skip.
)

if exist "%ROOT%\pdf_processing" (
  rmdir /s /q "%ROOT%\pdf_processing" 2>nul
  if exist "%ROOT%\pdf_processing" (
    echo FAILED: "%ROOT%\pdf_processing" — stop Python using .venv there, then delete manually.
  ) else (
    echo Removed "%ROOT%\pdf_processing"
  )
) else (
  echo No "%ROOT%\pdf_processing" — skip.
)

echo Done.
exit /b 0
