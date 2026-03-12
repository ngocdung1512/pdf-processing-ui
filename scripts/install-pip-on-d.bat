@echo off
REM Install Python deps with pip cache on same drive as repo (e.g. D:)
cd /d "%~dp0\.."

set "PIP_CACHE_DIR=%CD%\.pip-cache"
echo PIP cache: %PIP_CACHE_DIR%
echo.

if not exist "conversion_env\Scripts\activate.bat" (
    echo ERROR: conversion_env not found. Run first:
    echo   python -m venv conversion_env
    echo   conversion_env\Scripts\activate.bat
    pause
    exit /b 1
)

call conversion_env\Scripts\activate.bat
pip install --upgrade pip
pip install patch-ng
REM lmdb wheel (1.7.5) avoids building lmdb==1.0.0 on Windows; then vietocr --no-deps uses it
pip install lmdb
pip install -r requirements.txt
pip install vietocr --no-deps
echo.
echo Done. Pip cache and packages are under this project folder (same drive).
pause
