$ErrorActionPreference = "Stop"

$targetName = "D:\pagefile.sys"
$targetInitial = [uint32]65536
$targetMaximum = [uint32]65536

$cs = Get-CimInstance Win32_ComputerSystem
if ($cs.AutomaticManagedPagefile) {
  Set-CimInstance -InputObject $cs -Property @{ AutomaticManagedPagefile = $false } | Out-Null
}

$existing = Get-CimInstance Win32_PageFileSetting -ErrorAction SilentlyContinue |
  Where-Object { $_.Name -ieq $targetName -or $_.Name -like "*pagefile.sys" } |
  Select-Object -First 1
if ($existing) {
  Set-CimInstance -InputObject $existing -Property @{
    InitialSize = $targetInitial
    MaximumSize = $targetMaximum
  } | Out-Null
} else {
  New-CimInstance -ClassName Win32_PageFileSetting -Property @{
    Name = $targetName
    InitialSize = $targetInitial
    MaximumSize = $targetMaximum
  } | Out-Null
}

Get-CimInstance Win32_PageFileSetting |
  Select-Object Name, InitialSize, MaximumSize |
  Format-Table -AutoSize
