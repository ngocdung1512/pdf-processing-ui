# Download missing models: VietOCR vgg_transformer.pth + trigger PaddleOCR download
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path $root)) { $root = "D:\pdf-processing-ui" }
Set-Location $root

Write-Host "=== 1. VietOCR: vgg_transformer.pth ===" -ForegroundColor Cyan
$vietocrUrl = "https://vocr.vn/data/vietocr/vgg_transformer.pth"
$vietocrPath = Join-Path $root "vgg_transformer.pth"
if (Test-Path $vietocrPath) {
    Write-Host "[OK] Already exists: $vietocrPath" -ForegroundColor Green
} else {
    Write-Host "Downloading to $vietocrPath ..."
    try {
        Invoke-WebRequest -Uri $vietocrUrl -OutFile $vietocrPath -UseBasicParsing
        Write-Host "[OK] Downloaded vgg_transformer.pth" -ForegroundColor Green
    } catch {
        Write-Host "[ERROR] $($_.Exception.Message)" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "=== 2. PaddleOCR (vi + angle_cls) - first-time download ===" -ForegroundColor Cyan
$venvPython = Join-Path $root "conversion_env\Scripts\python.exe"
if (-not (Test-Path $venvPython)) {
    Write-Host "[SKIP] conversion_env not found. Run: python -m venv conversion_env" -ForegroundColor Yellow
    exit 0
}
$code = @"
try:
    from paddleocr import PaddleOCR
    print('Initializing PaddleOCR (lang=vi, use_angle_cls=True)...')
    ocr = PaddleOCR(lang='vi', use_angle_cls=True)
    print('[OK] PaddleOCR models downloaded/cached.')
except Exception as e:
    print(f'[ERROR] {e}')
"@
& $venvPython -c $code
Write-Host "Done." -ForegroundColor Green
