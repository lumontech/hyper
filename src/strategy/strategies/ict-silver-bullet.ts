// ICT Silver Bullet — WR atteso 65-75%.
// Setup: durante kill zone (London 10-11 GMT, NY AM 14-15 GMT, NY PM 18-19 GMT),
// cerca un FVG (Fair Value Gap, 3-bar imbalance) appena formato dopo una liquidity sweep recente,
// entra al ritest del FVG nella direzione opposta allo sweep.
//
// Riferimenti: Michael Huddleston (ICT). Su crypto adattato — Hyperliquid è 24/7 ma le kill zone
// coincidono con i volumi USA/EU.

import type { Candle, Signal, StrategyDef } from '../../types/trading.js'
import { highestHigh, lowestLow } from '../indicators.js'

// Kill zones in UTC seconds-of-day
const KILL_ZONES: Array<[number, number, string]> = [
  [10 * 3600, 11 * 3600, 'London'],
  [14 * 3600, 15 * 3600, 'NY AM'],
  [18 * 3600, 19 * 3600, 'NY PM'],
]

function inKillZone(timeSec: number): string | null {
  const sod = timeSec % 86400
  for (const [s, e, label] of KILL_ZONES) {
    if (sod >= s && sod < e) return label
  }
  return null
}

/**
 * Detecta un bullish FVG: gap tra high di candle[i-2] e low di candle[i].
 * Restituisce { gapLo, gapHi } se presente.
 */
function bullishFVG(candles: Candle[], i: number): { lo: number; hi: number } | null {
  if (i < 2) return null
  const c0 = candles[i - 2]!, c2 = candles[i]!
  if (c2.low > c0.high) return { lo: c0.high, hi: c2.low }
  return null
}

function bearishFVG(candles: Candle[], i: number): { lo: number; hi: number } | null {
  if (i < 2) return null
  const c0 = candles[i - 2]!, c2 = candles[i]!
  if (c2.high < c0.low) return { lo: c2.high, hi: c0.low }
  return null
}

function fn(candles: Candle[], i: number): Signal | null {
  if (i < 30) return null
  const k = candles[i]!
  const zone = inKillZone(k.time)
  if (!zone) return null

  // 1. Sweep recente: nelle ultime 20 bar (escluso current) c'è stata una candela
  //    che ha violato il low/high del range precedente e poi è rientrata.
  const lookback = 20
  const lo = lowestLow(candles, lookback, i - 5)
  const hi = highestHigh(candles, lookback, i - 5)

  let sweptLow = false, sweptHigh = false
  for (let j = i - 5; j < i; j++) {
    const b = candles[j]!
    if (b.low < lo && b.close > lo) sweptLow = true
    if (b.high > hi && b.close < hi) sweptHigh = true
  }

  // 2. FVG formato di recente (ultime 3 bar, incluso current)
  let bullFvg = bullishFVG(candles, i) ?? bullishFVG(candles, i - 1) ?? bullishFVG(candles, i - 2)
  let bearFvg = bearishFVG(candles, i) ?? bearishFVG(candles, i - 1) ?? bearishFVG(candles, i - 2)

  // 3. Entry: dopo sweep low + bullish FVG, candela current è bullish → long
  //    Inverso per sweep high + bearish FVG → short
  if (sweptLow && bullFvg && k.close > k.open && k.close > bullFvg.hi) {
    return { direction: 'long', reason: `ICT Silver Bullet ${zone}: sweep low + bullish FVG entry`, strategyId: 'ictSilverBullet' }
  }
  if (sweptHigh && bearFvg && k.close < k.open && k.close < bearFvg.lo) {
    return { direction: 'short', reason: `ICT Silver Bullet ${zone}: sweep high + bearish FVG entry`, strategyId: 'ictSilverBullet' }
  }
  return null
}

export const ictSilverBullet: StrategyDef = {
  id: 'ictSilverBullet',
  name: 'ICT Silver Bullet',
  icon: '🥈',
  style: 'smc',
  expectedWR: '65-75%',
  slMul: 0.8,
  tpMul: 2.0,
  optimalTF: ['15m'],
  supportedCoins: ['BTC', 'ETH'],
  desc: 'Kill zone (London/NY AM/NY PM) + liquidity sweep recente + FVG come entry trigger. ICT Inner Circle Trader setup.',
  fn,
}
