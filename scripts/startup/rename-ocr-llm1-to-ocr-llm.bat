@echo off
REM Run this AFTER closing all CMD windows (Backend, Frontend, AnythingLLM).
REM Deletes old OCR_LLM and renames OCR_LLM1 to OCR_LLM.

cd /d "%~dp0\..\.."
set "PROJECT_ROOT=%CD%"

echo ==========================================
echo  Rename OCR_LLM1 to OCR_LLM
echo ==========================================
echo.

if not exist "%PROJECT_ROOT%\OCR_LLM1\package.json" (
    echo OCR_LLM1 not found. Nothing to rename.
    pause
    exit /b 0
)

echo [1/2] Removing old OCR_LLM folder...
if exist "%PROJECT_ROOT%\OCR_LLM" (
    rmdir /s /q "%PROJECT_ROOT%\OCR_LLM" 2>nul
    if exist "%PROJECT_ROOT%\OCR_LLM" (
        echo       Failed - folder in use. Close all CMD windows and any Node process, then run this script again.
        pause
        exit /b 1
    )
    echo       Done.
) else (
    echo       No existing OCR_LLM folder.
)

echo [2/2] Renaming OCR_LLM1 to OCR_LLM...
ren "%PROJECT_ROOT%\OCR_LLM1" "OCR_LLM"
if exist "%PROJECT_ROOT%\OCR_LLM\package.json" (
    echo       Done.
) else (
    echo       Failed. Check that no program has OCR_LLM1 open.
    pause
    exit /b 1
)

echo.
echo ==========================================
echo  Success. You can run start-dev.bat now.
echo ==========================================
pause
