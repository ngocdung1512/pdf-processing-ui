# PowerShell script to start chatbot and open in default browser
Write-Host "========================================" -ForegroundColor Green
Write-Host " PDF Processing UI - Chatbot Server" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
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
Write-Host "[1/3] Starting Backend (FastAPI) on port 8000..." -ForegroundColor Yellow
$backendCmd = "cd '$PSScriptRoot'; if (Test-Path '.\conversion_env\Scripts\Activate.ps1') { .\conversion_env\Scripts\Activate.ps1 }; uvicorn api:app --port 8000 --reload"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendCmd

# Wait a bit for backend to start
Write-Host "[2/3] Waiting for backend to start..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

# Start frontend in new window
Write-Host "[3/3] Starting Frontend (Next.js) on port 3000..." -ForegroundColor Yellow
$frontendCmd = "cd '$PSScriptRoot'; npm run dev"
Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendCmd

# Wait for frontend to start
Write-Host "Waiting for frontend server to be ready..." -ForegroundColor Yellow
Start-Sleep -Seconds 8

# Open browser to chatbot page in default browser (not Cursor)
Write-Host ""
Write-Host "Opening chatbot in default browser..." -ForegroundColor Green
Start-Process "http://localhost:3000/chatbot"

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " Both servers are running!" -ForegroundColor Green
Write-Host " Chatbot: http://localhost:3000/chatbot" -ForegroundColor Cyan
Write-Host " Frontend: http://localhost:3000" -ForegroundColor Cyan
Write-Host " Backend:  http://localhost:8000" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Both servers are running in separate windows." -ForegroundColor Yellow
Write-Host "Close those windows to stop the servers." -ForegroundColor Yellow
Write-Host ""
Write-Host "Press any key to exit this window (servers will continue running)..."
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")

