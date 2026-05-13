// Indicatori tecnici — port da frontend/src/utils/indicators.js + ScalpingLibrary helpers.
// Pure functions, tutti operano su slice fino a indice i.

import type { Candle } from '../types/trading.js'

export function ema(candles: Candle[], period: number, i: number): number | null {
  if (i < period) return null
  const k = 2 / (period + 1)
  let s = 0
  for (let j = 0; j < period; j++) s += candles[j]!.close
  let v = s / period
  for (let j = period; j <= i; j++) v = candles[j]!.close * k + v * (1 - k)
  return v
}

export function rsi(candles: Candle[], period: number, i: number): number | null {
  if (i < period) return null
  let g = 0, l = 0
  for (let j = 1; j <= period; j++) {
    const d = candles[j]!.close - candles[j - 1]!.close
    if (d > 0) g += d
    else l -= d
  }
  let aG = g / period, aL = l / period
  for (let j = period + 1; j <= i; j++) {
    const d = candles[j]!.close - candles[j - 1]!.close
    aG = (aG * (period - 1) + Math.max(0, d)) / period
    aL = (aL * (period - 1) + Math.max(0, -d)) / period
  }
  if (aL === 0) return 100
  return 100 - 100 / (1 + aG / aL)
}

export function atr(candles: Candle[], period: number, i: number): number | null {
  if (i < period) return null
  let s = 0
  for (let j = i - period + 1; j <= i; j++) {
    const c = candles[j]!, p = candles[j - 1]!
    s += Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close))
  }
  return s / period
}

export function highestHigh(candles: Candle[], lookback: number, i: number): number {
  let h = -Infinity
  for (let j = Math.max(0, i - lookback + 1); j <= i; j++) {
    if (candles[j]!.high > h) h = candles[j]!.high
  }
  return h
}

export function lowestLow(candles: Candle[], lookback: number, i: number): number {
  let l = Infinity
  for (let j = Math.max(0, i - lookback + 1); j <= i; j++) {
    if (candles[j]!.low < l) l = candles[j]!.low
  }
  return l
}

/**
 * ADX (Average Directional Index) — misura forza del trend, 0..100.
 *   < 20  = no trend (ranging)
 *   20-25 = trend debole
 *   > 25  = trend forte
 */
export function adx(candles: Candle[], period: number, i: number): number | null {
  if (i < period * 2) return null
  let trSum = 0, dmPlusSum = 0, dmMinusSum = 0
  for (let j = i - period + 1; j <= i; j++) {
    const c = candles[j]!, p = candles[j - 1]!
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close))
    const upMove = c.high - p.high
    const dnMove = p.low - c.low
    const dmPlus = upMove > dnMove && upMove > 0 ? upMove : 0
    const dmMinus = dnMove > upMove && dnMove > 0 ? dnMove : 0
    trSum += tr; dmPlusSum += dmPlus; dmMinusSum += dmMinus
  }
  if (trSum === 0) return null
  const diPlus = 100 * dmPlusSum / trSum
  const diMinus = 100 * dmMinusSum / trSum
  const dx = 100 * Math.abs(diPlus - diMinus) / Math.max(diPlus + diMinus, 1e-9)
  return dx
}

export function bb(
  candles: Candle[],
  period: number,
  mult: number,
  i: number,
): { upper: number; middle: number; lower: number } | null {
  if (i < period - 1) return null
  let sum = 0
  for (let j = i - period + 1; j <= i; j++) sum += candles[j]!.close
  const mean = sum / period
  let varSum = 0
  for (let j = i - period + 1; j <= i; j++) varSum += (candles[j]!.close - mean) ** 2
  const std = Math.sqrt(varSum / period)
  return { upper: mean + mult * std, middle: mean, lower: mean - mult * std }
}
