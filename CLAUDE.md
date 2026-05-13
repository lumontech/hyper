# Hyperliquid Platform — Claude Code Instructions

## ⚠️ REGOLA OPERATIVA — WORK ONLY ON VPS

A partire dal 2026-05-13, **tutto il lavoro si fa solo sulla VPS** Contabo `81.17.100.112`.
**Non eseguire mai `npm run dev` o `docker compose up` in locale.** Locale serve solo come repo editing + git push.

## ⏱️ ROADMAP TEST → LIVE (3 mesi paper trading)

Aggiornato 2026-05-13 dopo ricerca su forum/community (Reddit r/Daytrading raccomanda 6 mesi minimo, noi puntiamo a **3 mesi conservativi**).

| Periodo | Cosa monitorare | Criteri "go" |
|---------|-----------------|--------------|
| **M1 (week 1-4)** | Frequenza signal totale, distribuzione adaptive vs library, primi 30-50 trade demo, max DD osservato | nessuno — fase di osservazione, dataset raw |
| **M2 (week 5-8)** | Win rate per strategia, profit factor (PF), drawdown distribution, pattern-conflict skip rate, no-trade window event respect | PF rolling 14gg ≥ 1.2, max DD < 25% |
| **M3 (week 9-12)** | Stabilità metriche, Sharpe ratio mentale, equity curve smooth, ≥150 trade campionati | **Criteri "GO LIVE":** PF ≥ 1.4, max DD < 20%, WR ≥ 50%, ≥150 trade, Sharpe annualizzato ≥ 1.0 |

Se i criteri non passano al mese 3 → si riparte con tweak (disabilita strategie weak, abbassa risk, aggiungi filtri).

**LIVE GO**: cambiare `EXEC_DRY_RUN=false`, configurare HL API Wallet (non master!), iniziare con `RISK_MAX_POSITION_USD=100`. Scalare gradualmente.

**Workflow di deploy** (single comando):
```bash
git push origin main
ssh -i ~/.ssh/hyperliquid-vps root@81.17.100.112 "cd /opt/hyperliquid-bot && git pull && docker compose up -d --build"
```

Accesso piattaforma: **https://hyperliquid-81-17-100-112.nip.io** (Caddy + HTTPS + basic auth, credenziali in `/root/hyperliquid-credentials.txt` sulla VPS).

`trade.fondamentale` (`impact-81-17-100-112.nip.io`) rimane intoccato.

## Struttura del repo

```
hyperliquid.bot/
├── src/         ← BACKEND bot Node/TS (headless, signs orders, runs strategies)
├── scripts/     ← CLI backtest/optimize
├── tests/       ← vitest backend
└── web/         ← FRONTEND React/Vite/Tailwind (local-only platform UI)
```

Backend e frontend sono **due processi separati** che comunicano via HTTP localhost.
- Backend (Node) gestisce HL connection, signing, risk, kill-switch. **Nessun browser code qui.**
- Frontend (React) è solo UI di controllo/monitoring. **Nessuna chiave privata mai nel frontend.**

## Regole non-negoziabili

1. **MAI** committare `.env`, chiavi private, mnemonics, master addresses
2. **MAI** disabilitare risk limits hard-coded in `src/engine/risk-manager.ts`
3. **MAI** rimuovere il check `.HALT` da `src/guardian/kill-switch.ts`
4. **MAI** cambiare `HL_NETWORK=mainnet` senza esplicita conferma utente
5. **MAI** modificare `EXEC_DRY_RUN=true` senza esplicita conferma utente
6. **MAI** scrivere strategie nuove senza prima un test in `tests/strategies/`
7. **SEMPRE** loggare ogni payload firmato in `data/audit/signed-payloads.log`
8. **SEMPRE** validare input con `zod` ai confini (env, WS messages, HTTP)

## Architettura — invarianti

- Strategie sono **pure functions**: `(candles, i) => { direction, reason } | null`.
  Identica firma del progetto `trade.fondamentale/frontend/src/services/ScalpingLibrary.js`.
- Simulator e Live-Executor condividono **stessa interfaccia di entry/exit**.
  Se il simulator dice TP @ +1.8R, il live-executor piazza ordine equivalente.
- Guardian è un processo separato. Non condivide memoria con executor.
  Comunicazione via file (`.HALT`) e DB (read-only su equity_curve).
- **`src/` è headless server only**. Niente React, niente DOM API, niente browser code in `src/`.
- **`web/` è browser only**. Niente Node-only API (fs, crypto, signing) nel frontend. Le chiavi private NON devono nemmeno transitare in HTTP.

## Stack

**Backend (`src/`)**:
- Node.js 20+, TypeScript strict mode
- `@nktkas/hyperliquid` (SDK ufficiale TS, supporta exchange + info + WS)
- `viem` per signing (privateKeyToAccount)
- `better-sqlite3` per orders/fills/equity
- `fastify` per HTTP server (status, candles, backtest, halt, resume)
- `pino` per logging strutturato JSON
- `vitest` per test
- `zod` per validation

**Frontend (`web/`)**:
- React 18 + TypeScript
- Vite 5 (dev server :5174)
- Tailwind CSS 3 (palette dark Bloomberg-style in `tailwind.config.js`)
- Zustand per stato globale
- `lightweight-charts` v4 per i chart candlestick
- WebSocket diretto a `wss://api.hyperliquid.xyz/ws` per prezzi live (allMids)
- HTTP fetch al backend locale `http://127.0.0.1:7777` per backtest/status

## Convenzioni file

- File <500 righe sempre
- Niente classi quando una pure function basta
- Niente `any`. Mai. (`noImplicitAny: true` in tsconfig)
- Niente `console.log`. Solo `logger.info/warn/error` (pino)
- Async/await only. Niente callback hell.

## Workflow con Ruflo

Per task complessi multi-file, usare swarm Ruflo già inizializzato (`swarm-1778448222554-ddp32u`, hierarchical, 6 agent max).

Pattern: spawn agenti named con `run_in_background: true`, comms via `SendMessage`.

```
researcher → architect → coder → tester → reviewer
```

## Mapping strategie da JS a TS

Le strategie in `trade.fondamentale/frontend/src/services/ScalpingLibrary.js` sono già ESM e pure. Port quasi 1:1 in `src/strategy/strategies/*.ts`:

- Rinomina `strat_*` → camelCase export
- Type signature: `(candles: Candle[], i: number) => Signal | null`
- Aggiungi `import type { Candle, Signal } from '@types/trading'`
- Mantieni IDENTICA la logica per garantire parità simulazione/live

## Cosa NON fare

- Non aggiungere webhook esterni (Telegram, Discord) finché il bot non è stabile testnet 30 giorni
- Non implementare leverage > 3x prima di una review esplicita
- Non chiamare API CEX (Binance, Kraken) — questo bot vive **solo** su Hyperliquid
- Non bypassare il `risk-manager.shouldAllowOrder()` mai
