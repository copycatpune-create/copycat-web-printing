@echo off
title Copycat Copiers - Local Windows Print Bridge
cd /d "%~dp0"

:loop
echo ========================================================
echo   Copycat Copiers - Local Windows Print Bridge
echo   Connecting your Canon & Advance printers to Cloud Web App
echo ========================================================
"C:\Program Files\nodejs\node.exe" print-bridge.js
echo.
echo [Print Bridge stopped at %TIME%]
echo Auto-reconnecting bridge in 5 seconds...
timeout /t 5 /nobreak >nul
goto loop
