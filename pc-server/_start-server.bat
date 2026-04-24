@echo off
REM Wrapper qui lance "npm start" et redirige la sortie vers logs\server.log
cd /d "%~dp0"
if not exist logs mkdir logs
call npm start > logs\server.log 2>&1
