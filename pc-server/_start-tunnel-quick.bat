@echo off
REM Wrapper qui lance un tunnel "quick" (trycloudflare.com) et redirige la sortie
cd /d "%~dp0"
if not exist logs mkdir logs
cloudflared tunnel --url http://localhost:3000 > logs\tunnel.log 2>&1
