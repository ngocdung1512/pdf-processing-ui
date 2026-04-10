#Requires -Version 5.1
# Stops dev servers started by start-dev (typical ports: 3000, 3002, 8000, 8001, 8010, 4101, 8888).

$ports = @(3000, 3002, 8000, 8001, 8010, 4101, 8888)
foreach ($port in $ports) {
  try {
    $pids = @(Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique)
  } catch {
    $pids = @()
  }
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
      Write-Host "Stopped PID $procId (port $port)"
    } catch {}
  }
}
Write-Host "Done."
