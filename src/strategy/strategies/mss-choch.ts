// MSS / ChoCH (SMC A+) — WR atteso 65-72%.
// Port 1:1 da trade.fondamentale/frontend/src/services/ScalpingLibrary.js strat_mss_choch.
// Setup: liquidity sweep di uno swing recente + market structure shift sul lato opposto.

import type { Candle, Signal, StrategyDef } from '../../types/trading.js'

function fn(candles: Candle[], i: number): Signal | null {
  if (i < 30) return null

  let lastHigh = -Infinity
  let lastLow = Infinity
  for (let j = i - 30; j < i - 2; j++) {
    if (candles[j]!.high > lastHigh) lastHigh = candles[j]!.high
    if (candles[j]!.low < lastLow) lastLow = candles[j]!.low
  }

  const prev = candles[i - 1]!
  const k = candles[i]!

  // Bullish MSS: prev sweep sotto last low + recovery, current chiude sopra last high
  if (prev.low < lastLow && prev.close > lastLow && k.close > lastHigh && k.close > k.open) {
    return { direction: 'long', reason: 'SMC sweep + bullish MSS', strategyId: 'mssChoCH' }
  }
  // Bearish MSS
  if (prev.high > lastHigh && prev.close < lastHigh && k.close < lastLow && k.close < k.open) {
    return { direction: 'short', reason: 'SMC sweep + bearish MSS', strategyId: 'mssChoCH' }
  }
  return null
}

export const mssChoCH: StrategyDef = {
  id: 'mssChoCH',
  name: 'MSS / ChoCH (SMC A+)',
  icon: '🎯',
  style: 'smc',
  expectedWR: '65-72%',
  slMul: 0.8,
  tpMul: 1.8,
  optimalTF: ['15m'],
  supportedCoins: 'all',
  desc: 'Liquidity sweep di uno swing + market structure shift opposto. Setup SMC istituzionale, il più affidabile dei reversal.',
  fn,
}
