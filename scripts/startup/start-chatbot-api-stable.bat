@echo off
setlocal

REM Change to project root directory (parent of scripts\startup\)
cd /d "%~dp0\..\.."
set "PROJECT_ROOT=%CD%"

set "PY_EXE=%PROJECT_ROOT%\conversion_env\Scripts\python.exe"
if not exist "%PY_EXE%" set "PY_EXE=python"

echo ==========================================
echo  Hybrid Chatbot API watchdog - 8010
echo ==========================================
echo Using Python: %PY_EXE%
echo.
echo If startup fails with Hugging Face 429 (rate limit^):
echo   1^) Create a token: https://huggingface.co/settings/tokens
echo   2^) Put it in scripts\startup\hf-token.env (see hf-token.env.example^)
echo   3^) After BGE-M3 is cached once, optional: CHATBOT_EMBED_LOCAL_ONLY=1
echo.

REM Load HF_TOKEN from local file (gitignored *.env^) — do not commit secrets.
if exist "%~dp0hf-token.env" (
  for /f "usebackq eol=# tokens=1,* delims==" %%a in ("%~dp0hf-token.env") do (
    if not "%%a"=="" set "%%a=%%b"
  )
)

:loop
REM If another instance already owns 8010, do not spawn another uvicorn.
set "PORT8010_BUSY=0"
for /f "tokens=5" %%a in ('netstat -ano ^| findstr /R /C:"127.0.0.1:8010 .*LISTENING" 2^>nul') do (
  set "PORT8010_BUSY=1"
)
if "%PORT8010_BUSY%"=="1" (
  echo [%date% %time%] Port 8010 is already in use. Skipping duplicate start.
  timeout /t 20 /nobreak >nul
  goto loop
)

echo [%date% %time%] Starting chatbot API on 127.0.0.1:8010 ...
cd /d "%PROJECT_ROOT%\services\chatbot"
set CHATBOT_SERVICE_ROLE=all
set CHATBOT_LLM_DEVICE=auto
set CHATBOT_EMBED_DEVICE=cpu
set CHATBOT_PRELOAD_LLM=false
set CHATBOT_DOCX_PARSE_MODE=full
REM Output length: raise/lower if your local LLM or API caps differ
set CHATBOT_CHAT_MAX_NEW_TOKENS=8192
set CHATBOT_SUMMARY_MAX_NEW_TOKENS=4096
set CHATBOT_AGENT_MAX_NEW_TOKENS=8192
REM PDF-only (8010): larger full-text floor + extra RAG chunks — Word flow unchanged
set CHATBOT_PDF_FULLTEXT_MAX_CHARS=1200000
set CHATBOT_PDF_FULLTEXT_MAX_CHARS_MULTI=600000
set CHATBOT_PDF_RAG_TOPK_EXTRA=24
"%PY_EXE%" -m uvicorn api.main:app --host 127.0.0.1 --port 8010
set "EXIT_CODE=%ERRORLEVEL%"
echo.
echo [%date% %time%] Chatbot API exited with code %EXIT_CODE%.
echo Restarting in 45 seconds (reduces Hugging Face rate-limit when embedding fails^)...
timeout /t 45 /nobreak >nul
goto loop

