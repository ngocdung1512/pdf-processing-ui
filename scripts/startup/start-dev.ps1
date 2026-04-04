# PowerShell script to start both frontend and backend
# Project root = parent of parent of this script (scripts/startup)
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $ProjectRoot

Write-Host "Starting PDF Processing UI Development Server..." -ForegroundColor Green
Write-Host ""

# Check if virtual environment is activated
$envPath = $env:VIRTUAL_ENV
if (-not $envPath) {
    Write-Host "Warning: Virtual environment not detected. Activating conversion_env..." -ForegroundColor Yellow
    if (Test-Path "$ProjectRoot\conversion_env\Scripts\Activate.ps1") {
        & "$ProjectRoot\conversion_env\Scripts\Activate.ps1"
    }
}

# Start backend in new window (ensure it runs in project root)
Write-Host "Starting Backend (FastAPI) on port 8000..." -ForegroundColor Yellow
$backendCmd = "Set-Location '$ProjectRoot'; if (Test-Path '$ProjectRoot\conversion_env\Scripts\Activate.ps1') { & '$ProjectRoot\conversion_env\Scripts\Activate.ps1' }; uvicorn ocr_app.api:app --port 8000 --reload"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd

# Wait a bit for backend to start
Start-Sleep -Seconds 3

# Start OCR_LLM chatbot in new window (if exists)
if (Test-Path "$ProjectRoot\OCR_LLM\package.json") {
    Write-Host "Starting OCR_LLM Chatbot (AnythingLLM) on port 3002..." -ForegroundColor Yellow
    $chatbotCmd = "Set-Location '$ProjectRoot'; npm run dev:chatbot"
    Start-Process powershell -ArgumentList "-NoExit", "-Command", $chatbotCmd
}

# Start frontend
Write-Host "Starting Frontend (Next.js) on port 3000..." -ForegroundColor Yellow
Write-Host "Backend is running in separate window. Press Ctrl+C to stop frontend only." -ForegroundColor Cyan
Write-Host ""

# Wait a bit then open browser
Start-Job -ScriptBlock {
    Start-Sleep -Seconds 8
    Start-Process "http://localhost:3000"
} | Out-Null

npm run dev

