@echo off
REM ─────────────────────────────────────────────────────────────────────
REM scp-to-vps.bat — Trasferisce sorgenti dal PC Windows alla VPS.
REM
REM Crea archivio tar.gz (escludendo node_modules e data) e lo invia
REM su /opt/hyperliquid-bot via scp.
REM
REM Uso:
REM   1. Doppio click (oppure da cmd: scp-to-vps.bat)
REM   2. Riusa vps-config.txt creato da tunnel-to-vps.bat
REM   3. Dopo il transfer, lancia auto-deploy-c.sh sulla VPS via ssh:
REM        ssh user@VPS "cd /opt/hyperliquid-bot && sudo bash deploy/auto-deploy-c.sh"
REM ─────────────────────────────────────────────────────────────────────
setlocal
cd /d "%~dp0"

set "CONFIG_FILE=%~dp0vps-config.txt"

if exist "%CONFIG_FILE%" (
  for /f "tokens=1,2 delims==" %%a in (%CONFIG_FILE%) do (
    if "%%a"=="VPS_IP"   set "VPS_IP=%%b"
    if "%%a"=="VPS_USER" set "VPS_USER=%%b"
    if "%%a"=="VPS_KEY"  set "VPS_KEY=%%b"
    if "%%a"=="VPS_PORT" set "VPS_PORT=%%b"
  )
)

if "%VPS_IP%"==""   set /p "VPS_IP=IP della VPS: "
if "%VPS_USER%"=="" set /p "VPS_USER=Utente SSH: "
if "%VPS_PORT%"=="" set "VPS_PORT=22"

(
  echo VPS_IP=%VPS_IP%
  echo VPS_USER=%VPS_USER%
  echo VPS_PORT=%VPS_PORT%
  if not "%VPS_KEY%"=="" echo VPS_KEY=%VPS_KEY%
) > "%CONFIG_FILE%"

echo.
echo ============================================================
echo  Trasferimento sorgenti -^> %VPS_USER%@%VPS_IP%:/opt/hyperliquid-bot
echo ============================================================
echo.

REM Crea archivio temporaneo
set "ARCHIVE=%TEMP%\hyperliquid.bot.tar.gz"

echo [.] Creo archivio (escludo node_modules, data, log)...
tar -czf "%ARCHIVE%" ^
  --exclude="node_modules" ^
  --exclude="web/node_modules" ^
  --exclude="data" ^
  --exclude=".HALT" ^
  --exclude="out.log" ^
  --exclude="vps-config.txt" ^
  --exclude="dist" ^
  --exclude="web/dist" ^
  -C .. hyperliquid.bot

if errorlevel 1 (
  echo [ERRORE] tar fallito.
  pause
  exit /b 1
)

for %%I in ("%ARCHIVE%") do echo [+] Archivio: %%~zI bytes
echo.

REM SCP upload
set "SCP_OPTS=-P %VPS_PORT%"
if not "%VPS_KEY%"=="" set "SCP_OPTS=%SCP_OPTS% -i ""%VPS_KEY%"""

echo [.] Upload via scp...
scp %SCP_OPTS% "%ARCHIVE%" %VPS_USER%@%VPS_IP%:/tmp/hyperliquid.bot.tar.gz

if errorlevel 1 (
  echo [ERRORE] scp fallito.
  del "%ARCHIVE%" 2>nul
  pause
  exit /b 1
)
echo [+] Upload completato.
echo.

REM Estrazione lato VPS
echo [.] Estrazione su VPS in /opt/hyperliquid-bot...
set "SSH_OPTS=-p %VPS_PORT%"
if not "%VPS_KEY%"=="" set "SSH_OPTS=%SSH_OPTS% -i ""%VPS_KEY%"""

ssh %SSH_OPTS% %VPS_USER%@%VPS_IP% "sudo mkdir -p /opt/hyperliquid-bot && sudo chown -R %VPS_USER%:%VPS_USER% /opt/hyperliquid-bot && cd /opt && tar -xzf /tmp/hyperliquid.bot.tar.gz && cp -rn hyperliquid.bot/. hyperliquid-bot/ && rm -rf hyperliquid.bot /tmp/hyperliquid.bot.tar.gz && echo OK"

if errorlevel 1 (
  echo [ERRORE] estrazione lato VPS fallita.
  del "%ARCHIVE%" 2>nul
  pause
  exit /b 1
)

del "%ARCHIVE%" 2>nul
echo.
echo ============================================================
echo  [+] Trasferimento completato.
echo ============================================================
echo.
echo  Prossimo step: deploy sulla VPS
echo.
echo     ssh %VPS_USER%@%VPS_IP%
echo     cd /opt/hyperliquid-bot
echo     sudo bash deploy/auto-deploy-c.sh
echo.
echo  Oppure tutto in una riga:
echo.
echo     ssh %SSH_OPTS% %VPS_USER%@%VPS_IP% "cd /opt/hyperliquid-bot ^&^& sudo bash deploy/auto-deploy-c.sh"
echo.
pause
