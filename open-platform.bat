@echo off
REM ─────────────────────────────────────────────────────────────────────
REM open-platform.bat — Apre il browser sulla piattaforma via SSH tunnel.
REM
REM Avvia tunnel-to-vps.bat in nuova finestra, aspetta 3s, apre browser.
REM ─────────────────────────────────────────────────────────────────────
setlocal
cd /d "%~dp0"

echo [+] Apro tunnel SSH in finestra separata...
start "Hyperliquid SSH Tunnel" cmd /c "tunnel-to-vps.bat"

echo [+] Attendo 4 secondi per stabilizzazione tunnel...
timeout /t 4 /nobreak >nul

echo [+] Apro browser su http://127.0.0.1:7777/
start "" "http://127.0.0.1:7777/"

echo.
echo Tunnel attivo nella finestra "Hyperliquid SSH Tunnel".
echo Chiudi quella finestra per chiudere il tunnel.
echo.
pause
