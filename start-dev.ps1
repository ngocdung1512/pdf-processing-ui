# Wrapper: run from project root so README ".\start-dev.ps1" works
$ProjectRoot = $PSScriptRoot
Set-Location $ProjectRoot
& "$ProjectRoot\scripts\startup\start-dev.ps1"
