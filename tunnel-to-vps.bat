@echo off
REM ─────────────────────────────────────────────────────────────────────
REM tunnel-to-vps.bat — Apre tunnel SSH dal tuo PC alla VPS.
REM
REM Forwarda 127.0.0.1:7777 (locale) → 127.0.0.1:7777 (remoto sulla VPS).
REM Il backend Docker sulla VPS bind 127.0.0.1:7777, quindi raggiungibile
REM SOLO via questo tunnel.
REM
REM Uso:
REM   1. Doppio click sul file (o lancia da cmd con: tunnel-to-vps.bat)
REM   2. Inserisci IP della VPS e utente SSH al primo lancio
REM   3. Inserisci password SSH (o usa key auth — vedi sotto)
REM   4. Apri browser: http://127.0.0.1:7777/
REM   5. Ctrl+C per chiudere tunnel
REM
REM Per autenticazione con chiave SSH (no password ogni volta):
REM   ssh-keygen -t ed25519 -f %USERPROFILE%\.ssh\hyperliquid-vps
REM   ssh-copy-id -i %USERPROFILE%\.ssh\hyperliquid-vps.pub user@vps_ip
REM   poi modifica VPS_KEY sotto con il path della chiave
REM ─────────────────────────────────────────────────────────────────────
setlocal
cd /d "%~dp0"

set "CONFIG_FILE=%~dp0vps-config.txt"

REM Carica config esistente se presente
if exist "%CONFIG_FILE%" (
  for /f "tokens=1,2 delims==" %%a in (%CONFIG_FILE%) do (
    if "%%a"=="VPS_IP"   set "VPS_IP=%%b"
    if "%%a"=="VPS_USER" set "VPS_USER=%%b"
    if "%%a"=="VPS_KEY"  set "VPS_KEY=%%b"
    if "%%a"=="VPS_PORT" set "VPS_PORT=%%b"
  )
)

REM Prompt se mancanti
if "%VPS_IP%"=="" (
  set /p "VPS_IP=IP della VPS Contabo: "
)
if "%VPS_USER%"=="" (
  set /p "VPS_USER=Utente SSH (es. root): "
)
if "%VPS_PORT%"=="" (
  set "VPS_PORT=22"
)

REM Salva config per le prossime volte
(
  echo VPS_IP=%VPS_IP%
  echo VPS_USER=%VPS_USER%
  echo VPS_PORT=%VPS_PORT%
  if not "%VPS_KEY%"=="" echo VPS_KEY=%VPS_KEY%
) > "%CONFIG_FILE%"

echo.
echo ============================================================
echo  Hyperliquid Platform - SSH Tunnel
echo ============================================================
echo  VPS:        %VPS_USER%@%VPS_IP%:%VPS_PORT%
echo  Forward:    localhost:7777 -^> VPS:127.0.0.1:7777
echo  Browser:    http://127.0.0.1:7777/
echo ============================================================
echo.
echo  Premi Ctrl+C per chiudere il tunnel.
echo  Apri il browser SUBITO DOPO che vedi "tunnel opened".
echo.

REM Costruisci comando ssh
set "SSH_OPTS=-N -L 7777:127.0.0.1:7777 -p %VPS_PORT% -o ServerAliveInterval=30 -o ServerAliveCountMax=3 -o ExitOnForwardFailure=yes"

if not "%VPS_KEY%"=="" (
  set "SSH_OPTS=%SSH_OPTS% -i ""%VPS_KEY%"""
)

echo [+] tunnel opened (puoi aprire il browser ora)
ssh %SSH_OPTS% %VPS_USER%@%VPS_IP%

echo.
echo [!] tunnel chiuso
pause
