// Pivot Daily Reversal — WR atteso 62-68%, Mark Fisher classic.
// Port da trade.fondamentale ScalpingLibrary.js strat_pivot_reversal.
// Failed breakout sui livelli pivot daily (R1/R2/S1/S2).

import type { Candle, Signal, StrategyDef } from '../../types/trading.js'

function fn(candles: Candle[], i: number): Signal | null {
  const dayBars = i >= 192 ? 96 : 24  // 15m → 96/day, 1h → 24/day
  if (i < dayBars * 2) return null

  let h = -Infinity, l = Infinity
  for (let j = i - dayBars * 2; j < i - dayBars; j++) {
    if (candles[j]!.high > h) h = candles[j]!.high
    if (candles[j]!.low < l) l = candles[j]!.low
  }
  const c0 = candles[i - dayBars - 1]!.close
  const P = (h + l + c0) / 3
  const R1 = 2 * P - l, S1 = 2 * P - h
  const R2 = P + (h - l), S2 = P - (h - l)
  const tol = (h - l) * 0.05

  const k = candles[i]!, prev = candles[i - 1]!

  // Failed breakout sopra R1 o R2 → short
  for (const lvl of [R1, R2]) {
    if (prev.high > lvl + tol && k.close < lvl && k.close < k.open) {
      return { direction: 'short', reason: `Failed breakout pivot R (${lvl.toFixed(2)})`, strategyId: 'pivotReversal' }
    }
  }
  // Failed breakdown sotto S1 o S2 → long
  for (const lvl of [S1, S2]) {
    if (prev.low < lvl - tol && k.close > lvl && k.close > k.open) {
      return { direction: 'long', reason: `Failed breakdown pivot S (${lvl.toFixed(2)})`, strategyId: 'pivotReversal' }
    }
  }
  return null
}

export const pivotReversal: StrategyDef = {
  id: 'pivotReversal',
  name: 'Pivot Daily Reversal',
  icon: '◇',
  style: 'mean-reversion',
  category: 'library',
  expectedWR: '62-68%',
  slMul: 0.7,
  tpMul: 1.3,
  optimalTF: ['15m', '1h'],
  supportedCoins: ['BTC', 'ETH'],
  desc: 'Failed breakout sui livelli pivot daily R1/R2/S1/S2. Zone istituzionali rispettate, Mark Fisher classic.',
  fn,
}
