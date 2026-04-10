' Double-click friendly: no console window. Runs start-dev-quiet.ps1 via PowerShell hidden.
Option Explicit
Dim shell, fso, scriptDir, ps1
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = scriptDir & "\start-dev-quiet.ps1"
shell.Run "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """", 0, False
