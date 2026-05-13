// SMC Order Block + FVG combo — WR atteso 62-70%.
// Order block = ultima candela opposing prima di un impulse move significativo.
// Entry: pullback dentro l'order block che si sovrappone a un FVG → high-probability zone.

import type { Candle, Signal, StrategyDef } from '../../types/trading.js'

// Find last bullish OB (last bearish candle before strong up impulse) in last N bars
function findLastBullishOB(candles: Candle[], i: number, lookback: number): { idx: number; lo: number; hi: number } | null {
  const minImpulseAtr = 1.5
  // Compute simple ATR proxy: avg range last 14
  let atrSum = 0
  for (let j = i - 14; j < i; j++) atrSum += candles[j]!.high - candles[j]!.low
  const avgRange = atrSum / 14
  if (avgRange <= 0) return null

  for (let j = i - 2; j >= Math.max(2, i - lookback); j--) {
    const c = candles[j]!
    if (c.close >= c.open) continue  // need bearish candle
    // Check that within next 3 bars a strong bullish impulse formed
    const impulse = candles[j + 1]!.close - c.low
    if (impulse > avgRange * minImpulseAtr) {
      return { idx: j, lo: c.low, hi: c.high }
    }
  }
  return null
}

function findLastBearishOB(candles: Candle[], i: number, lookback: number): { idx: number; lo: number; hi: number } | null {
  const minImpulseAtr = 1.5
  let atrSum = 0
  for (let j = i - 14; j < i; j++) atrSum += candles[j]!.high - candles[j]!.low
  const avgRange = atrSum / 14
  if (avgRange <= 0) return null

  for (let j = i - 2; j >= Math.max(2, i - lookback); j--) {
    const c = candles[j]!
    if (c.close <= c.open) continue  // need bullish candle
    const impulse = c.high - candles[j + 1]!.close
    if (impulse > avgRange * minImpulseAtr) {
      return { idx: j, lo: c.low, hi: c.high }
    }
  }
  return null
}

// FVG di tipo bullish negli ultimi N bar
function findBullishFVG(candles: Candle[], i: number, lookback: number): { lo: number; hi: number } | null {
  for (let j = Math.max(2, i - lookback); j <= i; j++) {
    const c0 = candles[j - 2]!, c2 = candles[j]!
    if (c2.low > c0.high) return { lo: c0.high, hi: c2.low }
  }
  return null
}
function findBearishFVG(candles: Candle[], i: number, lookback: number): { lo: number; hi: number } | null {
  for (let j = Math.max(2, i - lookback); j <= i; j++) {
    const c0 = candles[j - 2]!, c2 = candles[j]!
    if (c2.high < c0.low) return { lo: c2.high, hi: c0.low }
  }
  return null
}

function overlap(a: { lo: number; hi: number }, b: { lo: number; hi: number }): boolean {
  return a.hi >= b.lo && b.hi >= a.lo
}

function fn(candles: Candle[], i: number): Signal | null {
  if (i < 40) return null
  const k = candles[i]!
  const lookback = 30

  // Long setup: bullish OB + bullish FVG sovrapposti + price retrace dentro la zona + close rialzista
  const bullOB = findLastBullishOB(candles, i, lookback)
  const bullFVG = bullOB ? findBullishFVG(candles, i, lookback) : null
  if (bullOB && bullFVG && overlap(bullOB, bullFVG)) {
    const zone = { lo: Math.max(bullOB.lo, bullFVG.lo), hi: Math.min(bullOB.hi, bullFVG.hi) }
    const prev = candles[i - 1]!
    // Prev candela è entrata nella zona, current chiude rialzista sopra
    if (prev.low <= zone.hi && k.close > zone.hi && k.close > k.open) {
      return { direction: 'long', reason: 'Bullish OB + bullish FVG confluence + rejection', strategyId: 'orderBlockFvg' }
    }
  }

  const bearOB = findLastBearishOB(candles, i, lookback)
  const bearFVG = bearOB ? findBearishFVG(candles, i, lookback) : null
  if (bearOB && bearFVG && overlap(bearOB, bearFVG)) {
    const zone = { lo: Math.max(bearOB.lo, bearFVG.lo), hi: Math.min(bearOB.hi, bearFVG.hi) }
    const prev = candles[i - 1]!
    if (prev.high >= zone.lo && k.close < zone.lo && k.close < k.open) {
      return { direction: 'short', reason: 'Bearish OB + bearish FVG confluence + rejection', strategyId: 'orderBlockFvg' }
    }
  }

  return null
}

export const orderBlockFvg: StrategyDef = {
  id: 'orderBlockFvg',
  name: 'Order Block + FVG',
  icon: '⊟',
  style: 'smc',
  category: 'library',
  expectedWR: '62-70%',
  slMul: 0.9,
  tpMul: 2.2,
  optimalTF: ['15m', '1h'],
  supportedCoins: 'all',
  desc: 'Confluenza Order Block + Fair Value Gap nella stessa zona prezzo + rejection con close direzionale. Setup SMC ad alta probabilità.',
  fn,
}
