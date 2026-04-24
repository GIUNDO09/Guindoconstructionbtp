@echo off
REM Wrapper qui lance un tunnel nommé (config dans ~/.cloudflared/config.yml)
cd /d "%~dp0"
if not exist logs mkdir logs
cloudflared tunnel run gcbtp-files > logs\tunnel.log 2>&1
