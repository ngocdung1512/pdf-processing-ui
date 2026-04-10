#Requires -Version 5.1
# Quiet startup: no visible console windows for server processes.
# Logs: scripts\startup\logs\quiet\
# Developers: use start-dev.bat console

$ErrorActionPreference = "Stop"
# UTF-8 for Python child processes (avoids charmap errors when logs contain ✓ etc.)
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$LogDir = Join-Path $ProjectRoot "scripts\startup\logs\quiet"
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Write-LauncherLog {
  param([string]$Message)
  $line = "[{0}] {1}" -f (Get-Date -Format "o"), $Message
  Add-Content -Path (Join-Path $LogDir "launcher.log") -Value $line -Encoding utf8
}

function Stop-ListenersOnPorts {
  param([int[]]$Ports)
  foreach ($port in $Ports) {
    $pids = @()
    try {
      $pids = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique)
    } catch {}
    if (-not $pids -or $pids.Count -eq 0) {
      $raw = netstat -ano 2>$null
      foreach ($line in $raw) {
        if ($line -match ":$port\s+.*\s+LISTENING\s+(\d+)\s*$") {
          $pids += [int]$Matches[1]
        }
      }
    }
    foreach ($procId in ($pids | Select-Object -Unique)) {
      try {
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Write-LauncherLog "Stopped PID $procId (port $port)"
      } catch {}
    }
  }
}

function Start-QuietCmd {
  param(
    [string]$Name,
    [string]$Arguments,
    [string]$WorkingDirectory = $ProjectRoot
  )
  $outPath = Join-Path $LogDir "$Name.stdout.log"
  $errPath = Join-Path $LogDir "$Name.stderr.log"
  try {
    Start-Process -FilePath $env:ComSpec -ArgumentList @("/d", "/c", $Arguments) `
      -WorkingDirectory $WorkingDirectory `
      -WindowStyle Hidden `
      -RedirectStandardOutput $outPath `
      -RedirectStandardError $errPath | Out-Null
    Write-LauncherLog "Started $Name (logs: $Name.stdout.log / .stderr.log)"
  } catch {
    Write-LauncherLog "Failed to start ${Name}: $($_.Exception.Message)"
    throw
  }
}

function Wait-PdfBridgeReady {
  param([string]$Url = "http://127.0.0.1:8001/health", [int]$MaxAttempts = 35)
  for ($i = 0; $i -lt $MaxAttempts; $i++) {
    try {
      $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 3
      if ($r.StatusCode -eq 200) {
        Write-LauncherLog "PDF bridge is ready."
        return
      }
    } catch {}
    Start-Sleep -Seconds 2
  }
  Write-LauncherLog "WARNING: PDF bridge did not become ready. Check pdf-bridge logs."
}

Set-Location $ProjectRoot
Write-LauncherLog "=== Quiet start (project: $ProjectRoot) ==="

$pyMain = Join-Path $ProjectRoot "conversion_env\Scripts\python.exe"
if (-not (Test-Path $pyMain)) {
  $pyMain = "python"
}

# --- [1] Backend 8000 ---
$backendCmd = "`"$pyMain`" -m uvicorn ocr_app.api:app --port 8000 --reload"
Start-QuietCmd -Name "backend-8000" -Arguments $backendCmd

Start-Sleep -Seconds 3

# --- [2] Frontend 3000 ---
$feCmd = "npm run dev -- --webpack"
Start-QuietCmd -Name "frontend-3000" -Arguments $feCmd

# --- [3] Hybrid chatbot API 8010 (watchdog bat) ---
Stop-ListenersOnPorts @(8010)
$hybridBat = Join-Path $ProjectRoot "scripts\startup\start-chatbot-api-stable.bat"
Start-QuietCmd -Name "hybrid-8010" -Arguments "call `"$hybridBat`""

# --- [4] AnythingLLM stack (mirror start-chatbot-core.bat) ---
Stop-ListenersOnPorts @(4101, 8888, 3002, 8001)

$PP = Join-Path $ProjectRoot "services\pdf_processing"
if (-not (Test-Path (Join-Path $PP "api\extract_main.py"))) {
  $PP = Join-Path $ProjectRoot "pdf_processing"
}
if (-not (Test-Path (Join-Path $PP "api\extract_main.py"))) {
  Write-LauncherLog "ERROR: pdf extract service not found under services\pdf_processing."
  throw "PDF extract service path missing."
}

$pyBridge = Join-Path $PP ".venv\Scripts\python.exe"
if (-not (Test-Path $pyBridge)) {
  $pyBridge = Join-Path $ProjectRoot "conversion_env\Scripts\python.exe"
}
if (-not (Test-Path $pyBridge)) {
  $pyBridge = "python"
}

$env:PDF_PIPELINE_OCR_LOAD_4BIT = "true"
$env:PDF_EXTRACT_PLAIN_PAGE_CONTENT = "true"

$bridgeCmd = "`"$pyBridge`" -m uvicorn api.extract_main:app --host 0.0.0.0 --port 8001"
Start-QuietCmd -Name "pdf-bridge-8001" -Arguments $bridgeCmd -WorkingDirectory $PP

Wait-PdfBridgeReady

$OcrLlm = Join-Path $ProjectRoot "OCR_LLM"
$pdfExtractUrl = "http://127.0.0.1:8001/integrations/chatbot-extract-pdf"

$server4101 = "cd /d `"$OcrLlm`" && set SERVER_PORT=4101 && set GENERIC_OPEN_AI_MAX_TOKENS=8192 && set OLLAMA_MODEL_TOKEN_LIMIT=16384 && set OLLAMA_PREDICT_TOKENS=8192 && set HYBRID_CHATBOT_TIMEOUT_MS=600000 && set HYBRID_CHATBOT_BASE_URL=http://127.0.0.1:8010 && set HYBRID_CHATBOT_UPLOAD_BASE_URL=http://127.0.0.1:8010 && set HYBRID_CHATBOT_CHAT_BASE_URL=http://127.0.0.1:8010 && yarn dev:server"
Start-QuietCmd -Name "anythingllm-server-4101" -Arguments $server4101

$coll8888 = "cd /d `"$OcrLlm`" && set PDF_PROCESSING_EXTRACT_URL=$pdfExtractUrl && set PDF_PROCESSING_EXTRACT_REQUIRE_BRIDGE=false && set PDF_PROCESSING_EXTRACT_RETRIES=1 && set PDF_PROCESSING_EXTRACT_RETRY_DELAY_MS=3000 && yarn dev:collector"
Start-QuietCmd -Name "anythingllm-collector-8888" -Arguments $coll8888

$fe3002 = "cd /d `"$OcrLlm`" && yarn dev:frontend"
Start-QuietCmd -Name "anythingllm-frontend-3002" -Arguments $fe3002

Start-Sleep -Seconds 8

Write-LauncherLog "Opening default browser: http://localhost:3000"
try {
  Start-Process "http://localhost:3000"
} catch {
  Write-LauncherLog "Open browser failed: $($_.Exception.Message)"
}

Write-LauncherLog "Quiet start finished. To stop servers, run scripts\startup\stop-dev.bat"
