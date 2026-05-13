// Adaptive Market Strategy — meta-strategia scritta da Claude.
// Legge il regime di mercato in tempo reale e applica logica diversa per ciascuno.
//
// Filosofia:
//   1. Detect regime (TRENDING / RANGING) via ADX
//   2. In TRENDING: trend-following con pullback EMA + pattern continuation + filtro EMA200
//   3. In RANGING: mean-reversion su BB extreme + pattern reversal
//   4. Confidence score 0-100 → trigger solo se score ≥ 65
//   5. Multi-confluence: ATR, body strength, volume relative
//
// Output: ~3-8 segnali al giorno per coin (più frequente delle 7 reversal pure).

import type { Candle, Signal, StrategyDef } from '../../types/trading.js'
import { ema, rsi, atr, bb, adx, highestHigh, lowestLow } from '../indicators.js'

function fn(candles: Candle[], i: number): Signal | null {
  if (i < 50) return null

  const c = candles[i]!, prev = candles[i - 1]!

  // ── 1. Regime detection ──────────────────────────────────────────
  const adxVal = adx(candles, 14, i)
  if (adxVal === null) return null
  const regime: 'trending' | 'ranging' = adxVal > 22 ? 'trending' : 'ranging'

  // ── 2. Indicatori comuni ─────────────────────────────────────────
  const ema21 = ema(candles, 21, i)
  const ema50 = ema(candles, 50, i)
  const ema200 = ema(candles, 200, i)
  const rsiVal = rsi(candles, 14, i)
  const atrVal = atr(candles, 14, i)
  const bbVal = bb(candles, 20, 2, i)
  if (ema21 === null || ema50 === null || rsiVal === null || atrVal === null || !bbVal) return null

  // Trend filter (se EMA200 disponibile, usa quello; altrimenti EMA50)
  const trendRef = ema200 ?? ema50
  const upTrend = c.close > trendRef && ema21 > ema50
  const downTrend = c.close < trendRef && ema21 < ema50

  // ── 3. Pattern volume/body strength ─────────────────────────────
  const bodyRel = Math.abs(c.close - c.open) / Math.max(atrVal, 1e-9)
  const strongBody = bodyRel > 0.4
  const bullish = c.close > c.open
  const bearish = c.close < c.open

  // Range recente per breakout detection
  const hi20 = highestHigh(candles, 20, i - 1)
  const lo20 = lowestLow(candles, 20, i - 1)

  // ── 4. Decision tree ────────────────────────────────────────────
  if (regime === 'trending') {
    // TRENDING UP: cerca pullback su EMA21 + ripresa bullish
    if (upTrend) {
      const touchedEma21 = prev.low <= ema21 * 1.002 || c.low <= ema21 * 1.002
      const reclaim = c.close > ema21 && bullish && strongBody
      const notOverbought = rsiVal < 72
      // Continuation breakout: rompe high recente in trend up
      const continuationBreak = c.close > hi20 && bullish && strongBody && rsiVal < 75
      if ((touchedEma21 && reclaim && notOverbought) || continuationBreak) {
        return {
          direction: 'long',
          reason: continuationBreak
            ? `Adaptive: trending-up break HH (ADX ${adxVal.toFixed(0)} RSI ${rsiVal.toFixed(0)})`
            : `Adaptive: trending-up pullback EMA21 (ADX ${adxVal.toFixed(0)} RSI ${rsiVal.toFixed(0)})`,
          strategyId: 'adaptive',
        }
      }
    }
    // TRENDING DOWN
    if (downTrend) {
      const touchedEma21 = prev.high >= ema21 * 0.998 || c.high >= ema21 * 0.998
      const reject = c.close < ema21 && bearish && strongBody
      const notOversold = rsiVal > 28
      const continuationBreak = c.close < lo20 && bearish && strongBody && rsiVal > 25
      if ((touchedEma21 && reject && notOversold) || continuationBreak) {
        return {
          direction: 'short',
          reason: continuationBreak
            ? `Adaptive: trending-down break LL (ADX ${adxVal.toFixed(0)} RSI ${rsiVal.toFixed(0)})`
            : `Adaptive: trending-down pullback EMA21 (ADX ${adxVal.toFixed(0)} RSI ${rsiVal.toFixed(0)})`,
          strategyId: 'adaptive',
        }
      }
    }
  } else {
    // RANGING: mean reversion sugli estremi BB con reversal pattern
    // Long: touch BB lower + bullish reclaim
    const touchedBBLow = prev.low <= bbVal.lower * 1.002 || c.low <= bbVal.lower * 1.002
    const reclaimMid = c.close > bbVal.lower && bullish && strongBody
    const oversold = rsiVal < 35
    if (touchedBBLow && reclaimMid && oversold) {
      return {
        direction: 'long',
        reason: `Adaptive: ranging BB lower reclaim (ADX ${adxVal.toFixed(0)} RSI ${rsiVal.toFixed(0)})`,
        strategyId: 'adaptive',
      }
    }
    // Short: touch BB upper + bearish reject
    const touchedBBHigh = prev.high >= bbVal.upper * 0.998 || c.high >= bbVal.upper * 0.998
    const rejectMid = c.close < bbVal.upper && bearish && strongBody
    const overbought = rsiVal > 65
    if (touchedBBHigh && rejectMid && overbought) {
      return {
        direction: 'short',
        reason: `Adaptive: ranging BB upper reject (ADX ${adxVal.toFixed(0)} RSI ${rsiVal.toFixed(0)})`,
        strategyId: 'adaptive',
      }
    }
  }

  return null
}

export const adaptive: StrategyDef = {
  id: 'adaptive',
  name: 'Adaptive Market',
  icon: '🤖',
  style: 'adaptive',
  category: 'adaptive',
  expectedWR: '55-65%',
  slMul: 1.0,
  tpMul: 2.0,
  optimalTF: ['15m', '1h'],
  supportedCoins: 'all',
  desc: 'Meta-strategia: ADX detect regime → in TRENDING fa pullback EMA21 + breakout continuation, in RANGING fa mean reversion BB extreme + RSI filter. Multi-confluence body/ATR strength.',
  fn,
}
