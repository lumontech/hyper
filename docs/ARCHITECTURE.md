# Hyperliquid Bot — Architettura

## Obiettivo

Eseguire automaticamente le strategie già backtestate in `trade.fondamentale` su Hyperliquid perpetuals (BTC, ETH, SOL, XRP, BNB USDC), mantenendo **identica** la logica della simulazione mensile (1% risk, compounding, ATR-based SL/TP) ma su capitale reale on-chain.

## Principi di design

1. **Parità simulazione/live**. Lo stesso modulo strategia che ha generato il P&L simulato genera il segnale live. Niente "versione live diversa". Se diverge, è un bug.
2. **Separation of concerns hardware**. Il bot è separato dalla piattaforma `trade.fondamentale`. Niente browser, niente React, niente localStorage. Headless Node.js process.
3. **Fail closed**. Ogni dubbio = non si firma. Heartbeat lost = flatten. `.HALT` presente = stop immediato.
4. **Audit everything**. Ogni payload firmato è loggato append-only su disco prima dell'invio.
5. **Defensive sizing**. Limiti hard-coded a livello di codice, non solo `.env`. Anche se `.env` viene compromesso, i limiti ultimi sono nel sorgente.

## Layer

```
┌─────────────────────────────────────────────────────────────┐
│                      ORCHESTRATOR (main)                     │
│  bootstrap → load config → init layers → start event loop    │
└──────┬──────────────────────┬────────────────────────┬──────┘
       │                      │                        │
┌──────▼─────┐         ┌──────▼──────┐          ┌──────▼──────┐
│    CORE    │         │  STRATEGY   │          │   ENGINE    │
│            │         │             │          │             │
│ HL client  │ candles │ pure-fn     │ signals  │ simulator   │
│ WS feed    │────────▶│ strategies  │─────────▶│ live-exec   │
│ acct state │         │ + indic     │          │ pos-mgr     │
└────────────┘         └─────────────┘          └──────┬──────┘
       ▲                                                │
       │                                          orders/fills
       │                                                ▼
       │        ┌─────────────────────────────────────────┐
       │        │            GUARDIAN                      │
       │        │  kill-switch (.HALT)                     │
       │        │  daily-loss limit                        │
       │        └────────heartbeat──monitor─────risk──────┘
       │                            │
       │                            │ block/flatten
       └────────────────────────────┘

                    ┌─────────────────────────┐
                    │     PERSISTENCE         │
                    │ SQLite: orders, fills,  │
                    │ equity_curve, audit log │
                    └─────────────────────────┘

                    ┌─────────────────────────┐
                    │     API (read-only)     │
                    │ GET /status             │
                    │ POST /halt   /resume    │
                    │ GET /positions /equity  │
                    └─────────────────────────┘
```

## Moduli

### `src/core/`
- **`hyperliquid-client.ts`** — wrapper SDK `@nktkas/hyperliquid` (info + exchange + ws). Gestisce reconnect, nonce, error mapping.
- **`websocket-feed.ts`** — sottoscrive `candle` per ogni coin attivo + `allMids` + `userFills`. Emette eventi `onCandle`, `onFill`, `onPrice`. Heartbeat 30s.
- **`account-state.ts`** — equity, margin used, free margin, open positions. Sincronizzato via WS `webData2` o polling 5s.
- **`nonce-manager.ts`** — monotonic nonce su disco (`data/nonce`). Resync on startup contro `info` endpoint.

### `src/strategy/`
- **`indicators.ts`** — EMA, RSI, BB, ATR, MACD, Stoch, VWAP. Port da `frontend/src/utils/indicators.js` e `IndicatorsExtended.js`.
- **`strategies/*.ts`** — una strategia per file. Pure function. Stesso registry pattern.
- **`strategy-registry.ts`** — mappa `id → strategy`. Filtra per env `STRATEGY_ENABLED`.

### `src/engine/`
- **`simulator.ts`** — port di `Simulator.js`. Usato da `scripts/backtest-month.ts`.
- **`live-executor.ts`** — riceve signal, chiede approvazione a `risk-manager`, firma ordine via `hyperliquid-client`, scrive in DB.
- **`position-manager.ts`** — traccia SL/TP server-side (Hyperliquid supporta `tpsl` triggers). Aggiorna trailing se configurato.
- **`risk-manager.ts`** — `shouldAllowOrder(order, state) → { allow, reason }`. Hard limits: daily loss, max position USD, max total exposure, max leverage, max open positions, per-trade risk %.

### `src/guardian/`
- **`kill-switch.ts`** — poll `.HALT` ogni 500ms. Se appare → flatten tutto via `live-executor.emergencyFlatten()` → exit(0).
- **`heartbeat.ts`** — monitora ultimo prezzo ricevuto per coin. Se >`EXEC_HEARTBEAT_TIMEOUT_SEC` senza tick → flatten quella coin + alert.
- **`circuit-breakers.ts`** — ruin check (equity < 50% start → `.HALT` auto), daily loss check.

### `src/persistence/`
- **`db.ts`** — schema:
  - `orders`(id, ts, coin, side, type, size, price, sl, tp, strategy_id, status)
  - `fills`(id, order_id, ts, price, size, fee, pnl)
  - `equity_curve`(ts, equity_usd, margin_used, n_open)
  - `audit`(ts, action, payload_hash, signature, response)
- **`audit-log.ts`** — append `data/audit/signed-payloads.log` (JSONL).

### `src/orchestrator/`
- **`signal-router.ts`** — fan-out: per ogni coin, per ogni strategia abilitata, chiama `strategy.fn(candles, lastIdx)`. Se più strategie firmano → priority o consenso.
- **`main.ts`** — entrypoint. Boot order:
  1. Load env, validate con `zod`
  2. Open DB, init audit log
  3. Init hyperliquid client (testnet by default)
  4. Start guardian (kill-switch listener)
  5. Connect WS feed
  6. Subscribe each coin in `HL_ALLOWED_COINS`
  7. Start HTTP API
  8. Event loop: on new candle close → run signal-router → maybe execute

### `src/api/`
- **`http-server.ts`** — fastify, bind `127.0.0.1` di default. Endpoints:
  - `GET /status` — uptime, network, dry-run, n positions
  - `GET /positions` — lista open
  - `GET /equity` — last 1000 punti equity_curve
  - `POST /halt` — touch `.HALT` (con header `X-Confirm: yes`)
  - `POST /resume` — rimuove `.HALT` (con header `X-Confirm: yes`)

## Flusso esecutivo (happy path)

```
WS candle close (BTC, 15m)
    │
    ▼
core/websocket-feed → emit onCandleClose(BTC, candle)
    │
    ▼
orchestrator/signal-router.onCandle(BTC, candle)
    │  per ogni strategia abilitata:
    ▼
strategy.mssChoCH.fn(candles, lastIdx) → { direction: 'long', reason: '...' }
    │
    ▼
engine/risk-manager.shouldAllowOrder(coin, dir, size)
    │  check: dailyLoss, maxPosition, maxExposure, maxLeverage,
    │         maxOpenPositions, perTradeRisk, kill-switch
    ▼  { allow: true }
engine/live-executor.execute(signal)
    │  1. calcola size da risk %: size = (equity * 0.01) / (atr * slMul / entry)
    │  2. determina SL/TP a prezzi assoluti
    │  3. core/hyperliquid-client.placeOrder({ coin, isBuy, sz, limitPx, tpsl })
    │  4. audit-log.append(signed_payload)
    │  5. persistence/db.insertOrder(...)
    ▼
HL returns fill via WS userFills
    │
    ▼
engine/position-manager.onFill → update DB, push equity point
```

## Flusso flatten (kill-switch)

```
.HALT file appears
    │
    ▼
guardian/kill-switch (poll 500ms) detects
    │
    ▼  emit panicEvent('HALT_FILE_PRESENT')
engine/live-executor.emergencyFlatten()
    │  for each open position: market close (reduce-only)
    ▼
core/hyperliquid-client.placeOrders([ ...close orders ])
    │
    ▼  await all fills (timeout 10s)
process.exit(0)
```

## Roadmap

### Sprint 1 (settimana 1) — Foundation
- [x] Scaffold + tsconfig + env
- [ ] `src/types/*` (Candle, Signal, Order, Position, RiskCheck)
- [ ] `src/core/hyperliquid-client.ts` (info-only, no signing yet)
- [ ] `src/core/websocket-feed.ts` (subscribe candles)
- [ ] `src/strategy/indicators.ts` + `strategies/ema-cross.ts` (smoke test)
- [ ] `src/engine/simulator.ts` (port da Simulator.js)
- [ ] `scripts/backtest-month.ts` — esegue su 30 giorni dati HL reali per 5 perp
- [ ] Output: tabella WR/PF/PnL per (strategia × coin)

### Sprint 2 (settimana 2) — Strategies + Optimize
- [ ] Port `mssChoCH`, `liquidity-sweep`, `triple-bar-trap`, `failed-breakout`, `pivot-reversal` da `ScalpingLibrary.js`
- [ ] `scripts/optimize-params.ts` (grid search SL/TP/MaxBars per coin)
- [ ] Test suite con candele sintetiche + golden cases
- [ ] Shortlist top-3 strategie per ogni coin

### Sprint 3 (settimana 3) — Execution
- [ ] `nonce-manager.ts`
- [ ] `hyperliquid-client.ts` signing path (viem + privateKeyToAccount)
- [ ] `live-executor.ts` con `dry-run` flag default true
- [ ] `risk-manager.ts` full check matrix
- [ ] `position-manager.ts` con SL/TP triggers nativi HL
- [ ] Dry-run 7 giorni testnet, confronto vs simulator

### Sprint 4 (settimana 4) — Guardian + Deploy
- [ ] `kill-switch.ts` polling `.HALT`
- [ ] `heartbeat.ts` per ogni coin attivo
- [ ] `circuit-breakers.ts` daily-loss + ruin
- [ ] `http-server.ts` API read-only
- [ ] `Dockerfile` + `docker-compose.yml`
- [ ] Deploy Contabo VPS, monitor 30 giorni testnet
- [ ] Solo dopo: switch mainnet con `RISK_MAX_POSITION_USD=100`

## Costanti hard-coded (non sovrascrivibili da .env)

In `src/engine/risk-manager.ts`:
```ts
const ABSOLUTE_MAX_LEVERAGE = 5
const ABSOLUTE_MAX_DAILY_LOSS_PCT = 5.0
const ABSOLUTE_MIN_TIME_BETWEEN_ORDERS_MS = 500
const ABSOLUTE_MAX_NOTIONAL_PER_TRADE_USD = 5000   // anche se .env dice 10000
```

Anche se l'`.env` permette valori più alti, il codice clamp-a al hard limit. Se vuoi superarli serve un PR esplicito al codice.
