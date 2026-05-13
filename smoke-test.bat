@echo off
REM ─────────────────────────────────────────────────────────────────────
REM smoke-test.bat — Verifica che il backend risponda su /status
REM Lancia DOPO aver avviato start-backend.bat
REM ─────────────────────────────────────────────────────────────────────
setlocal
cd /d "%~dp0"
echo.
echo ============================================================
echo  Hyperliquid Platform - Smoke Test
echo ============================================================
echo.
echo [.] Test GET http://127.0.0.1:7777/status
echo.
curl -s -m 5 http://127.0.0.1:7777/status
echo.
echo.
if errorlevel 1 (
  echo [ERRORE] Il backend non risponde. Hai gia' avviato start-backend.bat?
) else (
  echo [OK] Backend risponde.
)
echo.
pause
