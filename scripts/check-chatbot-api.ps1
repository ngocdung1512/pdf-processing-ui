# Check if Chatbot Server (4101) responds. Page 3002 stays blank if this fails.
$ErrorActionPreference = "Stop"
$api = "http://localhost:4101/api/ping"
Write-Host "Checking Chatbot API at $api ..." -ForegroundColor Cyan
try {
  $r = Invoke-WebRequest -Uri $api -Method GET -UseBasicParsing -TimeoutSec 3
  if ($r.StatusCode -eq 200) {
    Write-Host "OK: Chatbot Server (4101) is running. Open http://localhost:3002" -ForegroundColor Green
    exit 0
  }
} catch {
  Write-Host "FAIL: Cannot reach $api" -ForegroundColor Red
  Write-Host ""
  Write-Host "Trang 3002 se trang neu Server (4101) chua chay. Lam lan luot:" -ForegroundColor Yellow
  Write-Host "  1. Dong het cua so CMD cua chatbot (Server, Collector, Frontend)."
  Write-Host "  2. Tu thu muc goc du an chay:  .\scripts\startup\start-dev.bat"
  Write-Host "  3. Giu 5 cua so CMD mo; doi cua so 'Chatbot Server - 4101' in dong 'listening on port 4101'."
  Write-Host "  4. Mo lai http://localhost:3002"
  Write-Host ""
  Write-Host "Neu cua so 'Chatbot Server - 4101' tu dong ngay: chay tay de xem loi:"
  Write-Host "  cd OCR_LLM"
  Write-Host "  `$env:SERVER_PORT=4101; yarn dev:server"
  exit 1
}
