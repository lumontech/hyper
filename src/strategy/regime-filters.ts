// Regime filters — secondo strato di filtro applicato DOPO la generazione dei signal
// e PRIMA del tie-breaker. Lo scopo è ridurre i trade in contesti di mercato
// statisticamente sfavorevoli per quel tipo di strategia.
//
// Background: il backtest pipeline-Binance 365gg ha mostrato WR 30-35% strutturale,
// con tutti i 5 account blown up in 60-90gg. Cause:
//   1. Strategie trending applicate in ranging (whipsaw)
//   2. Strategie reversal applicate in trend forte (fail)
//   3. Entry su RSI estremi (top/bottom buying)
//   4. Trade in mercati troppo morti (fee mangia tutto)
//   5. Trade in ore di basso volume (slippage maggiore)
//
// I 5 filtri sotto sono i più letterature-validated nel discretionary trading.
// Usati identicamente da SignalRouter live e da backtestPipeline per evitare drift.

import type { Candle, StrategyDef } from '../types/trading.js'
import { adx, rsi, atr } from './indicators.js'

export interface RegimeFilterResult {
  pass: boolean
  reason?: string  // motivo skip se pass=false
}

export interface RegimeFilterContext {
  buf: Candle[]
  i: number
  strategy: StrategyDef
  direction: 'long' | 'short'
  /** ora UTC del momento di valutazione (0-23). Se omessa, deriva da candles[i].time */
  hourUtc?: number
}

/**
 * Configurazione filtri. I valori di default sono basati sulla letteratura quant trading +
 * il pattern visto nei backtest precedenti. Tutti tunabili.
 */
export const REGIME_CONFIG = {
  // ADX thresholds per regime
  adxTrendMin:        25,   // breakout/trending: serve trend forte
  adxRangeMax:        22,   // mean-reversion: serve range vero (no trend)
  adxSmcMin:          18,   // smc: serve struttura attiva (non flat)

  // RSI extremes
  rsiLongMaxEntry:    68,   // no buy se RSI già stra-overbought
  rsiShortMinEntry:   32,   // no sell se RSI già stra-oversold

  // ATR floor (in % del prezzo): mercato troppo morto = fee dominante
  atrPctMinPerCoin:   0.30,

  // Skip orario UTC (Asia-late + EU-pre-open: ridotto volume su crypto)
  skipHoursUtc:       new Set([22, 23, 0, 1, 2, 3]),
}

/** Mappa style → tipologia di regime richiesto */
function regimeTypeFor(style: string): 'trending' | 'ranging' | 'smc' | 'any' {
  switch (style) {
    case 'breakout':       return 'trending'
    case 'momentum':       return 'trending'
    case 'adaptive':       return 'any'        // adaptive sceglie da sola
    case 'mean-reversion': return 'ranging'
    case 'reversal':       return 'any'        // reversal funziona in entrambi se setup forte
    case 'smc':            return 'smc'
    default:               return 'any'
  }
}

/**
 * Applica tutti i filtri. Ritorna pass=false al PRIMO che fallisce.
 * Ordine: time-of-day → ATR floor → ADX-by-style → RSI extreme.
 */
export function passesRegimeFilters(ctx: RegimeFilterContext): RegimeFilterResult {
  const { buf, i, strategy, direction } = ctx
  const c = buf[i]!

  // 1. Time-of-day (UTC)
  const hourUtc = ctx.hourUtc ?? new Date(c.time * 1000).getUTCHours()
  if (REGIME_CONFIG.skipHoursUtc.has(hourUtc)) {
    return { pass: false, reason: `time-of-day-${hourUtc}h-UTC` }
  }

  // 2. ATR floor
  const atrVal = atr(buf, 14, i)
  if (!atrVal || atrVal <= 0) {
    return { pass: false, reason: 'atr-zero' }
  }
  const atrPct = (atrVal / c.close) * 100
  if (atrPct < REGIME_CONFIG.atrPctMinPerCoin) {
    return { pass: false, reason: `atr-too-low-${atrPct.toFixed(2)}%` }
  }

  // 3. ADX by regime type
  const adxVal = adx(buf, 14, i)
  if (adxVal === null) {
    return { pass: false, reason: 'adx-null' }
  }
  const regimeType = regimeTypeFor(strategy.style)
  if (regimeType === 'trending' && adxVal < REGIME_CONFIG.adxTrendMin) {
    return { pass: false, reason: `adx-${adxVal.toFixed(0)}-not-trending` }
  }
  if (regimeType === 'ranging' && adxVal > REGIME_CONFIG.adxRangeMax) {
    return { pass: false, reason: `adx-${adxVal.toFixed(0)}-not-ranging` }
  }
  if (regimeType === 'smc' && adxVal < REGIME_CONFIG.adxSmcMin) {
    return { pass: false, reason: `adx-${adxVal.toFixed(0)}-flat` }
  }

  // 4. RSI no-extreme
  const rsiVal = rsi(buf, 14, i)
  if (rsiVal === null) {
    return { pass: false, reason: 'rsi-null' }
  }
  if (direction === 'long' && rsiVal >= REGIME_CONFIG.rsiLongMaxEntry) {
    return { pass: false, reason: `rsi-${rsiVal.toFixed(0)}-overbought` }
  }
  if (direction === 'short' && rsiVal <= REGIME_CONFIG.rsiShortMinEntry) {
    return { pass: false, reason: `rsi-${rsiVal.toFixed(0)}-oversold` }
  }

  return { pass: true }
}
