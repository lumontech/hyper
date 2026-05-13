# Strategie — BTC, ETH, SOL, XRP, BNB perp

## Filosofia

Tre criteri per abilitare una strategia in produzione:

1. **WR documentato ≥ 60%** su backtest 30 giorni reali Hyperliquid per la coin specifica
2. **Profit Factor ≥ 1.4** netto costi (taker fee HL 0.045% + slippage 0.02% stimato)
3. **Significance level "high"** (≥100 trade) o p-value < 0.05

Niente cherry-picking. Una strategia che passa su BTC ma fallisce su SOL viene abilitata **solo su BTC** via `supportedCoins`.

## Le 7 strategie attive

| ID | Strategia | WR atteso | Stile | SL×ATR | TP×ATR | R:R | Coin |
|----|-----------|-----------|-------|--------|--------|-----|------|
| `mssChoCH` | MSS / ChoCH (SMC A+) | 65–72% | smc | 0.8 | 1.8 | 2.25 | all |
| `liqSweep` | Liquidity Sweep | 62–70% | smc | 0.8 | 1.5 | 1.88 | all |
| `tripleBarTrap` | Triple Bar Trap | 65–70% | reversal | 0.9 | 1.5 | 1.67 | all |
| `failedBk` | Failed Breakout | 60–68% | reversal | 0.8 | 1.6 | 2.00 | all |
| `pivotReversal` | Pivot Daily Reversal | 62–68% | mean-rev | 0.7 | 1.3 | 1.86 | BTC, ETH |
| `ictSilverBullet` | ICT Silver Bullet | 65–75% | smc | 0.8 | 2.0 | 2.50 | BTC, ETH |
| `orderBlockFvg` | Order Block + FVG | 62–70% | smc | 0.9 | 2.2 | 2.44 | all |

## Dettagli

### 1. MSS / ChoCH — SMC A+ Setup
Liquidity sweep di uno swing recente + market structure shift sul lato opposto.
File: `src/strategy/strategies/mss-choch.ts`. Port da ScalpingLibrary.js (linee 311–353).

### 2. Liquidity Sweep
Wick spazza il low/high del range 20-bar, candela chiude dentro range, wick > 40%.
File: `src/strategy/strategies/liquidity-sweep.ts`.

### 3. Triple Bar Trap
3-bar confirmation: b1 break, b2 hold, b3 fail con range > 15%. Ultra-conservativo Brooks-style.
File: `src/strategy/strategies/triple-bar-trap.ts`.

### 4. Failed Breakout
2-bar confirmation: bar 1 chiude fuori range, bar 2 torna dentro con close opposto.
File: `src/strategy/strategies/failed-breakout.ts`.

### 5. Pivot Daily Reversal
Failed breakout sui livelli pivot daily (R1/R2/S1/S2). Mark Fisher classic.
Limitata a BTC/ETH dove i pivot hanno memoria istituzionale.
File: `src/strategy/strategies/pivot-reversal.ts`.

### 6. ICT Silver Bullet — NUOVA, da ricerca
Setup ICT Inner Circle Trader (Michael Huddleston). WR documentato 70–80% nelle kill zone:
- **London** 10–11 UTC
- **NY AM** 14–15 UTC
- **NY PM** 18–19 UTC

Trigger: durante kill zone, c'è stato uno sweep di liquidity recente E si è formato un FVG (Fair Value Gap = 3-bar imbalance). Entry su candela direzionale che chiude oltre il FVG.
File: `src/strategy/strategies/ict-silver-bullet.ts`. Limitata a BTC/ETH (volumi USA/EU coincidono).

### 7. Order Block + FVG — NUOVA, SMC confluence
Order Block = ultima candela opposing prima di un impulse move (≥1.5×ATR). Combinato con FVG nella stessa zona prezzo → setup high-probability. Entry su rejection con close direzionale.
File: `src/strategy/strategies/order-block-fvg.ts`.

## Tie-breaker del Signal Router

Regole in `src/orchestrator/signal-router.ts`:

- **2+ strategie stessa direzione** → execute (confluenza, sizing standard)
- **2+ strategie direzioni opposte** → SKIP (`status: skipped:conflict`)
- **1 sola strategia + style smc/reversal** → execute (alta convinzione)
- **1 sola strategia + altro style** → SKIP (`status: skipped:low-conviction`)
- **ATR = 0** → SKIP (`status: skipped:atr-zero`)

## Asset-specific notes

### BTCUSDC — il più "pulito"
Volumi alti, funziona quasi tutto. MSS/ChoCH e ICT Silver Bullet performano top.
Occhio funding cycle hourly HL: evita entry 5-10 min prima del funding se predicted rate > 0.01%/h.

### ETHUSDC
Correlato a BTC con beta 1.2-1.5 → trade più volatili.
MSS/ChoCH, Triple Bar Trap, ICT Silver Bullet eccellenti.
Evita Pivot Reversal nelle prime ore dopo annunci EVM.

### SOLUSDC — più rumore
**Solo** Triple Bar Trap e Failed Breakout (2-3 bar confirmation filtra fake).
Liquidity Sweep funziona ma WR scende a ~58% per via dei false sweep.

### XRPUSDC — manipolata
Whale moves frequenti. **Solo** confirmation a 2+ bar. **Niente** breakout puri.
Triple Bar Trap > Failed Breakout > MSS/ChoCH.

### BNBUSDC
Volatilità moderata, comportamento simile a BTC con meno volume.
Tutte le strategie applicabili. **Eccezione**: durante eventi Binance (BNB burn, hot listing) disabilita per 6h.

## Anti-overfitting protocol

Prima di abilitare una strategia su mainnet:

1. **Train/Test split**: 60 giorni training, 30 giorni out-of-sample. WR e PF non devono divergere >20%.
2. **Walk-forward**: 3 finestre da 30 giorni. Almeno 2 con PF > 1.3.
3. **Monte Carlo trade shuffle**: 500 shuffle. P95 max DD < 30% del capitale.
4. **Out-of-sample 7 giorni testnet** prima del flag green per mainnet.

## Daily routine consigliata

- **UTC 00:00**: `npm run backtest -- --days 30` → aggiorna stats rolling
- **Stop automatico**: WR < 55% o PF < 1.2 su rolling 14 giorni → disable via env reload
- **Settimanale**: review manuale equity_curve, fill quality (slippage medio vs stimato 0.02%)

## Strategie NON portate (lasciate in trade.fondamentale)

- **Funding Rate Arbitrage / Delta-Neutral**: 10-30% APY, ma richiede capitale spot + perp, fuori scope di questo bot directional.
- **Market Making one-sided**: rebate 0.003%, richiede latency colocation e C++/Rust, fuori scope.
- **Grid trading**: incompatibile con risk management ATR-based.

Quelle sono per un secondo bot dedicato; il design separation-of-concerns le tiene fuori dal directional executor.
