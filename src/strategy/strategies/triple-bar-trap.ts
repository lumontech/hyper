// Triple Bar Trap — WR atteso 65-70%, ultra-conservativo Brooks-style.
// Port da trade.fondamentale ScalpingLibrary.js strat_triple_bar_trap.
// 3-bar confirmation: b1 break, b2 hold (sembra confermato), b3 fail.

import type { Candle, Signal, StrategyDef } from '../../types/trading.js'
import { highestHigh, lowestLow } from '../indicators.js'

function fn(candles: Candle[], i: number): Signal | null {
  if (i < 23) return null
  const b1 = candles[i - 2]!, b2 = candles[i - 1]!, b3 = candles[i]!
  const hi = highestHigh(candles, 20, i - 3)
  const lo = lowestLow(candles, 20, i - 3)
  const range = hi - lo
  if (range <= 0) return null

  // Bear trap (bull → short): b1+b2 close > hi, b3 fail con close < hi e < b2.close
  if (b1.close > hi && b2.close > hi &&
      b3.close < hi && b3.close < b3.open && b3.close < b2.close) {
    if ((b2.close - b3.close) / range > 0.15) {
      return { direction: 'short', reason: 'Triple bar bull trap', strategyId: 'tripleBarTrap' }
    }
  }
  // Bear trap reverse (bear → long)
  if (b1.close < lo && b2.close < lo &&
      b3.close > lo && b3.close > b3.open && b3.close > b2.close) {
    if ((b3.close - b2.close) / range > 0.15) {
      return { direction: 'long', reason: 'Triple bar bear trap', strategyId: 'tripleBarTrap' }
    }
  }
  return null
}

export const tripleBarTrap: StrategyDef = {
  id: 'tripleBarTrap',
  name: 'Triple Bar Trap',
  icon: '🪤',
  style: 'reversal',
  expectedWR: '65-70%',
  slMul: 0.9,
  tpMul: 1.5,
  optimalTF: ['15m'],
  supportedCoins: 'all',
  desc: 'Confirmation 3-bar: b1 break, b2 hold, b3 fail con range > 15%. Ultra-conservativo Brooks-style.',
  fn,
}
