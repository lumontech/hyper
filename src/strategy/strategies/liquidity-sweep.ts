// Liquidity Sweep + Reversal — WR atteso 62-70%.
// Port 1:1 da trade.fondamentale ScalpingLibrary.js strat_liquidity_sweep.

import type { Candle, Signal, StrategyDef } from '../../types/trading.js'
import { highestHigh, lowestLow } from '../indicators.js'

function fn(candles: Candle[], i: number): Signal | null {
  if (i < 25) return null
  const hi = highestHigh(candles, 20, i - 1)
  const lo = lowestLow(candles, 20, i - 1)
  const c = candles[i]!

  if (c.low < lo && c.close > lo && c.close > c.open) {
    const wickRatio = (Math.min(c.open, c.close) - c.low) / (c.high - c.low + 1e-9)
    if (wickRatio > 0.4) {
      return { direction: 'long', reason: 'Sweep below SSL + bullish reversal', strategyId: 'liqSweep' }
    }
  }
  if (c.high > hi && c.close < hi && c.close < c.open) {
    const wickRatio = (c.high - Math.max(c.open, c.close)) / (c.high - c.low + 1e-9)
    if (wickRatio > 0.4) {
      return { direction: 'short', reason: 'Sweep above BSL + bearish reversal', strategyId: 'liqSweep' }
    }
  }
  return null
}

export const liquiditySweep: StrategyDef = {
  id: 'liqSweep',
  name: 'Liquidity Sweep',
  icon: '⚡',
  style: 'smc',
  category: 'library',
  expectedWR: '62-70%',
  slMul: 0.8,
  tpMul: 1.5,
  optimalTF: ['5m', '15m'],
  supportedCoins: 'all',
  desc: 'Wick spazza il low/high del range 20-bar e chiude dentro, wick > 40% del range candela.',
  fn,
}
