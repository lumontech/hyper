// ZigZag + RSI — strategia momentum-reversion ispirata alla top-voted TradingView
// per ETHUSDT 15m. Sintesi:
//   1. ZigZag swing detection: ultimi swing high (SH) e swing low (SL)
//   2. RSI(14) deve fare crossover: ≤30 → torna sopra 30 = bullish trigger
//                                   ≥70 → torna sotto 70 = bearish trigger
//   3. Conferma struttura zigzag:
//      - Long: stiamo facendo higher-low (SL2 > SL1) o break sopra ultimo SH
//      - Short: lower-high (SH2 < SH1) o break sotto ultimo SL
//
// Funziona meglio in TF medio-bassi (5m/15m) su crypto major liquidi.

import type { Candle, Signal, StrategyDef } from '../../types/trading.js'
import { rsi } from '../indicators.js'

interface Swing { idx: number; price: number; type: 'high' | 'low' }

function findSwings(candles: Candle[], window: number, lookback: number): Swing[] {
  const swings: Swing[] = []
  const start = Math.max(window, candles.length - lookback)
  for (let i = start; i < candles.length - window; i++) {
    const c = candles[i]!
    let isHigh = true, isLow = true
    for (let j = i - window; j <= i + window; j++) {
      if (j === i) continue
      if (candles[j]!.high >= c.high) isHigh = false
      if (candles[j]!.low <= c.low) isLow = false
    }
    if (isHigh) swings.push({ idx: i, price: c.high, type: 'high' })
    if (isLow) swings.push({ idx: i, price: c.low, type: 'low' })
  }
  return swings
}

function fn(candles: Candle[], i: number): Signal | null {
  if (i < 25) return null
  const rsiNow = rsi(candles, 14, i)
  const rsiPrev = rsi(candles, 14, i - 1)
  if (rsiNow === null || rsiPrev === null) return null

  const c = candles[i]!
  const slice = candles.slice(0, i + 1)
  const swings = findSwings(slice, 3, 50)
  if (swings.length < 3) return null

  const highs = swings.filter(s => s.type === 'high')
  const lows = swings.filter(s => s.type === 'low')

  // ── Long trigger: RSI cross sopra 30 + struttura higher-low o break ultimo SH ──
  const rsiCrossedUp = rsiPrev <= 30 && rsiNow > 30
  if (rsiCrossedUp) {
    const lastTwoLows = lows.slice(-2)
    const lastHigh = highs[highs.length - 1]
    const higherLow = lastTwoLows.length === 2 && lastTwoLows[1]!.price > lastTwoLows[0]!.price
    const breakLastSh = lastHigh && c.close > lastHigh.price
    if (higherLow || breakLastSh) {
      return {
        direction: 'long',
        reason: `ZigZag RSI: cross-up 30 ${rsiNow.toFixed(0)} + ${higherLow ? 'higher-low' : 'break-SH'}`,
        strategyId: 'zigzagRsi',
      }
    }
  }

  // ── Short trigger: RSI cross sotto 70 + struttura lower-high o break ultimo SL ──
  const rsiCrossedDown = rsiPrev >= 70 && rsiNow < 70
  if (rsiCrossedDown) {
    const lastTwoHighs = highs.slice(-2)
    const lastLow = lows[lows.length - 1]
    const lowerHigh = lastTwoHighs.length === 2 && lastTwoHighs[1]!.price < lastTwoHighs[0]!.price
    const breakLastSl = lastLow && c.close < lastLow.price
    if (lowerHigh || breakLastSl) {
      return {
        direction: 'short',
        reason: `ZigZag RSI: cross-down 70 ${rsiNow.toFixed(0)} + ${lowerHigh ? 'lower-high' : 'break-SL'}`,
        strategyId: 'zigzagRsi',
      }
    }
  }

  return null
}

export const zigzagRsi: StrategyDef = {
  id: 'zigzagRsi',
  name: 'ZigZag RSI',
  icon: '⤧',
  style: 'momentum',
  category: 'library',
  expectedWR: '55-62%',
  slMul: 0.9,
  tpMul: 1.8,
  optimalTF: ['5m', '15m'],
  supportedCoins: 'all',
  desc: 'Momentum-reversion: RSI(14) crossover 30/70 + conferma struttura zigzag (higher-low o break SH per long, lower-high o break SL per short). Top-voted TradingView ETHUSDT 15m.',
  fn,
}
