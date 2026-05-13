# Hyperliquid Platform

Piattaforma locale **esclusivamente** per Hyperliquid perpetuals.
Asset: **BTC, ETH, SOL, XRP, BNB** (perp USDC).
Stessa logica della simulazione mensile in `trade.fondamentale`: 1% risk per trade, compounding, SL/TP ATR-based, strategie già backtestate.

## Stato

`v0.2.0` — autonomous trading loop attivo (dry-run di default).
**Non firmare ordini reali su mainnet finché non hai testato 30+ giorni in `EXEC_DRY_RUN=true`.**

## Deploy su VPS — Opzione C (SSH tunnel, zero esposizione)

Piattaforma gira sulla VPS Contabo accanto a `trade.fondamentale` **senza toccare nulla** di esistente.
Accesso via SSH port-forward dal tuo PC. Niente DNS, niente HTTPS pubblico, niente porte aperte.

**3 step**, ~15 minuti:
1. Doppio click su `scp-to-vps.bat` → trasferisce sorgenti a `/opt/hyperliquid-bot` sulla VPS
2. Sulla VPS: `sudo bash deploy/auto-deploy-c.sh` → installa Docker, build, up
3. Doppio click su `open-platform.bat` → tunnel SSH + browser → http://127.0.0.1:7777/

Guida completa: [`deploy/OPZIONE-C-QUICKSTART.md`](deploy/OPZIONE-C-QUICKSTART.md).

## Requirements

- **Node.js ≥ 22.5** (richiesto per `node:sqlite` built-in). Testato su Node 24.14.1.
- npm 10+
- Nessun native addon (niente Visual Studio Build Tools, niente node-gyp).

## Architettura della piattaforma

Due processi locali, un solo repo:

```
┌─────────────────────────────┐         ┌─────────────────────────────┐
│  Backend Bot (Node/TS)      │ ◀─HTTP─▶│  Web Frontend (React/Vite)  │
│  port 7777                  │   JSON  │  port 5174                  │
│                             │         │                             │
│  • HL client + WS feed      │         │  • Dashboard live           │
│  • Strategy engine          │         │  • Backtest Lab             │
│  • Risk manager (hard)      │         │  • Strategies               │
│  • Kill-switch (.HALT)      │         │  • Positions & Equity       │
│  • SQLite persistence       │         │  • Header HALT/RESUME       │
└─────────────────────────────┘         └─────────────────────────────┘
              │                                       │
              └───────────── browser ─────────────────┘
                    (entrambi bind 127.0.0.1)
```

## Setup

```powershell
cd C:\Users\Stefano\.claude\hyperliquid.bot

# 1. Backend
npm install
copy .env.example .env
# (opzionale) edita .env per impostare HL_MASTER_ADDRESS (read-only) o API key

# 2. Frontend
npm --prefix web install
```

Note Windows: NO Visual Studio Build Tools richiesti. La persistence usa `node:sqlite` built-in.

## Run — modo facile (raccomandato Windows)

Doppio click sui launcher `.bat` nella cartella del progetto. Gestiscono `cd` + `npm install` automaticamente.

| File | Cosa fa |
|------|---------|
| `start-backend.bat` | Avvia backend + HTTP API (port 7777). Crea `.env` se manca, installa deps se mancano. |
| `start-frontend.bat` | Avvia frontend Vite (port 5174). |
| `smoke-test.bat` | Verifica che `GET /status` risponda. |

## Run — modo manuale (due terminali)

Devi essere **nella cartella del progetto**, non in `C:\WINDOWS\system32` (errore tipico):

```powershell
# Terminale 1 - backend
cd C:\Users\Stefano\.claude\hyperliquid.bot
npm run dev
# > [BOOT] startup complete - autonomous trading loop active
# > HTTP listening on 127.0.0.1:7777

# Terminale 2 - frontend
cd C:\Users\Stefano\.claude\hyperliquid.bot
npm run web:dev
# > Vite dev server: http://127.0.0.1:5174
```

### Errori comuni

| Errore | Causa | Fix |
|--------|-------|-----|
| `ENOENT C:\WINDOWS\system32\package.json` | npm lanciato fuori dal progetto | `cd C:\Users\Stefano\.claude\hyperliquid.bot` PRIMA di `npm` |
| `'tsx' non è riconosciuto` | `npm install` non completato | Rilancia `npm install` dalla cartella progetto |
| `'#' non è riconosciuto` | Hai copiato un commento markdown come comando | I `#` sono commenti, non lanciarli |

### Smoke test rapido

```powershell
# Verifica che il backend risponda
curl http://127.0.0.1:7777/status
# > {"ok":true,"network":"mainnet","autonomous":true, ...}
```

Apri http://127.0.0.1:5174 nel browser.

## Comandi

| Comando | Cosa fa |
|---------|---------|
| `npm run dev` | Avvia backend bot + HTTP API |
| `npm run web:dev` | Avvia frontend Vite dev |
| `npm run web:build` | Build statico frontend per produzione |
| `npm run backtest` | CLI backtest 30 giorni su tutti i coin/strategie |
| `npm run optimize` | Grid search parametri SL/TP/MaxBars |
| `npm run dry-run` | Connessione live testnet, segnali generati ma NON eseguiti |
| `npm run halt` | Crea `.HALT` → bot flatten e si ferma entro 1s |
| `npm run resume` | Rimuove `.HALT` |
| `npm test` | Test suite (strategie, risk, integration) |

## La piattaforma web

4 pannelli accessibili dalla sidebar:

| Pannello | Cosa fa |
|----------|---------|
| **Dashboard** | Prezzi live 5 perp via WS Hyperliquid (allMids) + chart candlestick selezionabile (5m/15m/1h/4h/1D) |
| **Backtest Lab** | Esegue simulazione 30/60/90 giorni su tutte le combinazioni strategia × coin, ordinate per Profit Factor |
| **Strategies** | Card per ogni strategia: WR atteso, SL×ATR, TP×ATR, R:R, timeframe ottimali, stato enabled |
| **Positions** | Posizioni aperte + equity curve (wiring completo in Sprint 3) |

Header con: stato BACKEND, stato HL WS, network (TESTNET/MAINNET), mode (DRY/LIVE), bottone HALT/RESUME globale.

## API HTTP (per integrazioni custom)

Base URL `http://127.0.0.1:7777`.

| Endpoint | Metodo | Cosa restituisce |
|----------|--------|-------------------|
| `/status` | GET | health, network, dryRun, risk snapshot |
| `/strategies` | GET | tutte le strategie registrate con metadata |
| `/candles/:coin?tf=15m&limit=500` | GET | candele HL per un perp |
| `/backtest` | POST `{coin,strategyId,days}` | risultato simulazione singola |
| `/backtest/all` | POST `{days}` | tutte le strategie × tutti i coin |
| `/halt` | POST + header `X-Confirm: yes` | crea `.HALT` |
| `/resume` | POST + header `X-Confirm: yes` | rimuove `.HALT` |
| `/positions` | GET | (Sprint 3) posizioni aperte |
| `/equity` | GET | (Sprint 3) equity curve |

## Strategie attive

Vedi [docs/STRATEGIES.md](docs/STRATEGIES.md). Shortlist con WR backtestato:

| Strategia | WR atteso | Stile |
|-----------|-----------|-------|
| MSS / ChoCH (SMC A+) | 65–72% | Reversal istituzionale |
| Liquidity Sweep | 62–70% | SMC |
| Triple Bar Trap | 65–70% | Reversal 3-bar confirmed (Sprint 2) |
| Failed Breakout | 60–68% | Bull/bear trap 2-bar (Sprint 2) |
| Pivot Daily Reversal | 62–68% | Mean reversion su pivot (Sprint 2) |

## Sicurezza

- **Mai** mettere la chiave del wallet master nel `.env`. Usa una **API Wallet** Hyperliquid dedicata.
- Default `HL_NETWORK=testnet`, `EXEC_DRY_RUN=true`, `RISK_MAX_POSITION_USD=500`.
- Backend bind di default `127.0.0.1:7777` — mai esporre su `0.0.0.0` senza auth in front.
- Frontend bind `127.0.0.1:5174` — la piattaforma è locale-only.
- `.HALT` file = kill-switch hardware. Tutti i processi lo controllano prima di firmare.
- Audit log immutable di ogni payload firmato in `data/audit/`.
- Hard limits in `src/engine/risk-manager.ts` NON sovrascrivibili da `.env`: leverage 5×, daily loss 5%, notional/trade $5k, total $20k.

## Relazione con `trade.fondamentale`

Repo separato. `trade.fondamentale` rimane piattaforma di analisi multi-asset (forex, oro, indici, crypto) senza execution. Questa platform è dedicata SOLO a Hyperliquid con execution. Le strategie e la logica del Simulator sono state portate da `trade.fondamentale` per garantire parità simulazione/live.
