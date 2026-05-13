@echo off
REM ─────────────────────────────────────────────────────────────────────
REM start-backend.bat — Avvia il backend Node + HTTP API
REM Doppio click per lanciare; resta aperto per vedere i log.
REM ─────────────────────────────────────────────────────────────────────
setlocal
cd /d "%~dp0"
echo.
echo ============================================================
echo  Hyperliquid Platform - Backend (Node + HTTP API)
echo  Folder: %CD%
echo ============================================================
echo.
if not exist ".env" (
  echo [!] .env mancante. Lo creo da .env.example...
  copy /Y ".env.example" ".env" >nul
  echo [OK] .env creato. Edita HL_MASTER_ADDRESS in .env se vuoi vedere il tuo account.
  echo.
)
if not exist "node_modules\.bin\tsx.cmd" (
  echo [!] node_modules mancante o incompleto. Eseguo npm install...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERRORE] npm install fallito. Vedi log sopra.
    pause
    exit /b 1
  )
)
echo [+] Avvio backend su http://127.0.0.1:7777
echo [+] Premi Ctrl+C per fermare
echo.
call npm run dev
echo.
echo Backend terminato. Premi un tasto per chiudere.
pause >nul
