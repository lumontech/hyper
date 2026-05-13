// Failed Breakout — WR atteso 60-68%.
// Port da trade.fondamentale ScalpingLibrary.js strat_failed_breakout.
// 2-bar bull/bear trap: bar 1 chiude fuori range, bar 2 torna dentro con close opposto.

import type { Candle, Signal, StrategyDef } from '../../types/trading.js'
import { highestHigh, lowestLow } from '../indicators.js'

function fn(candles: Candle[], i: number): Signal | null {
  if (i < 22) return null
  const k = candles[i]!, prev = candles[i - 1]!
  const hi = highestHigh(candles, 20, i - 2)
  const lo = lowestLow(candles, 20, i - 2)
  const range = hi - lo
  if (range <= 0) return null

  // Bull trap → short
  if (prev.close > hi && k.close < hi && k.close < k.open && k.close < prev.close) {
    if ((prev.close - k.close) / range > 0.1) {
      return { direction: 'short', reason: 'Failed breakout — bull trap', strategyId: 'failedBk' }
    }
  }
  // Bear trap → long
  if (prev.close < lo && k.close > lo && k.close > k.open && k.close > prev.close) {
    if ((k.close - prev.close) / range > 0.1) {
      return { direction: 'long', reason: 'Failed breakdown — bear trap', strategyId: 'failedBk' }
    }
  }
  return null
}

export const failedBreakout: StrategyDef = {
  id: 'failedBk',
  name: 'Failed Breakout',
  icon: '🚫',
  style: 'reversal',
  category: 'library',
  expectedWR: '60-68%',
  slMul: 0.8,
  tpMul: 1.6,
  optimalTF: ['15m'],
  supportedCoins: 'all',
  desc: '2-bar confirmation: bar 1 chiude fuori range 20-bar, bar 2 torna dentro con close opposto e move > 10% range.',
  fn,
}
