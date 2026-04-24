@echo off
REM Lance GCBTP Manager (wrapper qui contourne la politique d'execution PowerShell)
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0manager.ps1"
