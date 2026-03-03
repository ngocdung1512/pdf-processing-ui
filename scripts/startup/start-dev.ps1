# PowerShell script to start both frontend and backend
Write-Host "Starting PDF Processing UI Development Server..." -ForegroundColor Green
Write-Host ""

# Check if virtual environment is activated
$envPath = $env:VIRTUAL_ENV
if (-not $envPath) {
    Write-Host "Warning: Virtual environment not detected. Activating conversion_env..." -ForegroundColor Yellow
    if (Test-Path ".\conversion_env\Scripts\Activate.ps1") {
        & .\conversion_env\Scripts\Activate.ps1
    }
}

# Start backend in new window
Write-Host "Starting Backend (FastAPI) on port 8000..." -ForegroundColor Yellow
$backendCmd = "cd '$PSScriptRoot'; if (Test-Path '.\conversion_env\Scripts\Activate.ps1') { .\conversion_env\Scripts\Activate.ps1 }; uvicorn api:app --port 8000 --reload"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd

# Wait a bit for backend to start
Start-Sleep -Seconds 3

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

