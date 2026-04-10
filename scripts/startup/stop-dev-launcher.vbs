' Stops dev servers without a console window (same ports as stop-dev.ps1).
Option Explicit
Dim shell, fso, scriptDir, ps1
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
ps1 = scriptDir & "\stop-dev.ps1"
shell.Run "powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File """ & ps1 & """", 0, False
