@echo off
REM ─────────────────────────────────────────────────────────────────────
REM start-frontend.bat — Avvia il frontend Vite (React)
REM Doppio click per lanciare; resta aperto per vedere i log.
REM ─────────────────────────────────────────────────────────────────────
setlocal
cd /d "%~dp0"
echo.
echo ============================================================
echo  Hyperliquid Platform - Frontend (Vite + React)
echo  Folder: %CD%
echo ============================================================
echo.
if not exist "web\node_modules\.bin\vite.cmd" (
  echo [!] web\node_modules mancante. Eseguo npm install...
  call npm --prefix web install
  if errorlevel 1 (
    echo.
    echo [ERRORE] npm install web fallito. Vedi log sopra.
    pause
    exit /b 1
  )
)
echo [+] Avvio frontend su http://127.0.0.1:5174
echo [+] Apri http://127.0.0.1:5174 nel browser
echo [+] Premi Ctrl+C per fermare
echo.
call npm run web:dev
echo.
echo Frontend terminato. Premi un tasto per chiudere.
pause >nul
