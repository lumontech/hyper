// Donchian Breakout 20 — Turtle Trading classic.
// Setup: chiusura sopra il high a 20 bar (long) o sotto il low a 20 bar (short).
// Filtro qualità aggiunto: breakout deve essere "significativo" (≥ 0.3×ATR oltre il livello)
// per evitare i false breakout marginali.
//
// Funziona bene in mercati TRENDING. In ranging genera molti false signal —
// per questo è "library" e va combinato con altri filtri (pattern, regime).

import type { Candle, Signal, StrategyDef } from '../../types/trading.js'
import { highestHigh, lowestLow, atr } from '../indicators.js'

function fn(candles: Candle[], i: number): Signal | null {
  if (i < 21) return null
  const c = candles[i]!
  const hi20 = highestHigh(candles, 20, i - 1)
  const lo20 = lowestLow(candles, 20, i - 1)
  const atrVal = atr(candles, 14, i)
  if (!atrVal || atrVal <= 0) return null

  // Breakout significativo: deve superare il livello di almeno 0.3×ATR
  const minMove = atrVal * 0.3

  if (c.close > hi20 + minMove) {
    return {
      direction: 'long',
      reason: `Donchian breakout 20-bar high ${hi20.toFixed(2)} (+${(c.close - hi20).toFixed(2)})`,
      strategyId: 'donchian',
    }
  }
  if (c.close < lo20 - minMove) {
    return {
      direction: 'short',
      reason: `Donchian breakdown 20-bar low ${lo20.toFixed(2)} (-${(lo20 - c.close).toFixed(2)})`,
      strategyId: 'donchian',
    }
  }
  return null
}

export const donchianBreakout: StrategyDef = {
  id: 'donchian',
  name: 'Donchian Breakout 20',
  icon: '⇅',
  style: 'breakout',
  category: 'library',
  expectedWR: '45-55%',     // breakout sono WR basso ma R:R alto
  slMul: 1.0,
  tpMul: 2.5,
  optimalTF: ['15m', '1h'],
  supportedCoins: 'all',
  desc: 'Turtle-style breakout: chiusura sopra/sotto high/low 20 bar con filtro qualità 0.3×ATR. WR basso ma R:R 2.5 (vince i trend forti).',
  fn,
}
