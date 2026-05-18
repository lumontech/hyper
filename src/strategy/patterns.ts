// Pattern recognition — candlestick + chart patterns più affidabili per crypto.
// Usato dal signal-router come "confluence booster": se pattern bias = signal direction
// entro ultime 3 candele → +bonus; pattern opposto → veto/skip.
//
// Riferimenti: Bulkowski "Encyclopedia of Candlestick Charts" + studi su BTC/ETH 2020-2025.
// Filosofia: pochi pattern, ben filtrati. Niente Doji isolati (rumore), niente armonic
// pattern (richiedono pivot detection costoso).

import type { Candle } from '../types/trading.js'

export type PatternBias = 'bullish' | 'bearish' | 'neutral'
export type PatternReliability = 'high' | 'medium' | 'low'

export interface Pattern {
  type: 'candlestick' | 'chart'
  id: string
  name: string
  italian: string
  candleIndex: number
  time: number
  bias: PatternBias
  reliability: PatternReliability
  description: string
}

// ── Helpers ──────────────────────────────────────────────────────────
function anatomy(c: Candle) {
  const body = Math.abs(c.close - c.open)
  const range = c.high - c.low
  const upperWick = c.high - Math.max(c.open, c.close)
  const lowerWick = Math.min(c.open, c.close) - c.low
  return {
    body, range, upperWick, lowerWick,
    bodyPct: range > 0 ? body / range : 0,
    upperPct: range > 0 ? upperWick / range : 0,
    lowerPct: range > 0 ? lowerWick / range : 0,
    bullish: c.close > c.open,
    bearish: c.close < c.open,
  }
}

function avgBody(candles: Candle[], period = 14): number {
  const n = Math.min(period, candles.length)
  if (n === 0) return 0
  let sum = 0
  for (let i = candles.length - n; i < candles.length; i++) {
    sum += Math.abs(candles[i]!.close - candles[i]!.open)
  }
  return sum / n
}

function highestHigh(candles: Candle[], from: number, to: number): number {
  let h = -Infinity
  for (let j = from; j <= to && j < candles.length; j++) {
    if (candles[j]!.high > h) h = candles[j]!.high
  }
  return h
}
function lowestLow(candles: Candle[], from: number, to: number): number {
  let l = Infinity
  for (let j = from; j <= to && j < candles.length; j++) {
    if (candles[j]!.low < l) l = candles[j]!.low
  }
  return l
}

// ── CANDLESTICK ──────────────────────────────────────────────────────
export function detectCandlestickPatterns(candles: Candle[], lookback = 20): Pattern[] {
  if (!candles || candles.length < 4) return []
  const out: Pattern[] = []
  const start = Math.max(3, candles.length - lookback)
  const avgB = avgBody(candles, 20)
  if (avgB <= 0) return []

  for (let i = start; i < candles.length; i++) {
    const c = candles[i]!, prev = candles[i - 1]!, prev2 = candles[i - 2]!
    const a = anatomy(c), ap = anatomy(prev), ap2 = anatomy(prev2)
    const trend5 = i >= 5 ? candles[i - 1]!.close - candles[i - 5]!.close : 0

    // Bullish Engulfing
    if (ap.bearish && a.bullish && c.open <= prev.close && c.close >= prev.open && a.body > avgB * 0.8) {
      out.push({ type: 'candlestick', id: 'bullEngulf', name: 'Bullish Engulfing', italian: 'Engulfing Rialzista',
        candleIndex: i, time: c.time, bias: 'bullish', reliability: 'high',
        description: 'Candela rialzista inghiotte completamente la precedente ribassista. Reversal forte su supporto.' })
    }
    // Bearish Engulfing
    if (ap.bullish && a.bearish && c.open >= prev.close && c.close <= prev.open && a.body > avgB * 0.8) {
      out.push({ type: 'candlestick', id: 'bearEngulf', name: 'Bearish Engulfing', italian: 'Engulfing Ribassista',
        candleIndex: i, time: c.time, bias: 'bearish', reliability: 'high',
        description: 'Candela ribassista inghiotte completamente la precedente rialzista. Reversal forte su resistenza.' })
    }
    // Hammer (in downtrend)
    if (a.lowerPct > 0.5 && a.upperPct < 0.15 && a.bodyPct < 0.4 && a.body > avgB * 0.2 && trend5 < 0) {
      out.push({ type: 'candlestick', id: 'hammer', name: 'Hammer', italian: 'Martello',
        candleIndex: i, time: c.time, bias: 'bullish', reliability: 'medium',
        description: 'Wick inferiore lungo in downtrend: i compratori respingono il push ribassista.' })
    }
    // Shooting Star (in uptrend)
    if (a.upperPct > 0.5 && a.lowerPct < 0.15 && a.bodyPct < 0.4 && a.body > avgB * 0.2 && trend5 > 0) {
      out.push({ type: 'candlestick', id: 'shootingStar', name: 'Shooting Star', italian: 'Stella Cadente',
        candleIndex: i, time: c.time, bias: 'bearish', reliability: 'medium',
        description: 'Wick superiore lungo in uptrend: i venditori respingono il push rialzista.' })
    }
    // Bullish Pin Bar
    if (a.lowerPct > 0.6 && a.upperPct < 0.2 && a.body > avgB * 0.15) {
      out.push({ type: 'candlestick', id: 'pinBarBull', name: 'Bullish Pin Bar', italian: 'Pin Bar Rialzista',
        candleIndex: i, time: c.time, bias: 'bullish', reliability: 'medium',
        description: 'Wick inferiore >60% del range: rejection netto sopra il low.' })
    }
    // Bearish Pin Bar
    if (a.upperPct > 0.6 && a.lowerPct < 0.2 && a.body > avgB * 0.15) {
      out.push({ type: 'candlestick', id: 'pinBarBear', name: 'Bearish Pin Bar', italian: 'Pin Bar Ribassista',
        candleIndex: i, time: c.time, bias: 'bearish', reliability: 'medium',
        description: 'Wick superiore >60% del range: rejection netto sotto il high.' })
    }
    // Inside Bar (compressione)
    if (prev.high > c.high && prev.low < c.low && a.body < ap.body * 0.7) {
      out.push({ type: 'candlestick', id: 'insideBar', name: 'Inside Bar', italian: 'Inside Bar',
        candleIndex: i, time: c.time, bias: 'neutral', reliability: 'low',
        description: 'Compressione volatilità: range dentro la mother bar. Precede spesso espansione.' })
    }
    // Morning Star (bullish reversal, 3 candele)
    if (i >= 2 && ap2.bearish && ap2.body > avgB * 0.7 &&
        Math.abs(prev.close - prev.open) < avgB * 0.4 &&
        a.bullish && a.body > avgB * 0.5 && c.close > (prev2.open + prev2.close) / 2) {
      out.push({ type: 'candlestick', id: 'morningStar', name: 'Morning Star', italian: 'Stella del Mattino',
        candleIndex: i, time: c.time, bias: 'bullish', reliability: 'high',
        description: 'Pattern 3-bar: ribassista forte → piccola/doji → rialzista che recupera mid-range. Reversal classico.' })
    }
    // Evening Star (bearish reversal, 3 candele)
    if (i >= 2 && ap2.bullish && ap2.body > avgB * 0.7 &&
        Math.abs(prev.close - prev.open) < avgB * 0.4 &&
        a.bearish && a.body > avgB * 0.5 && c.close < (prev2.open + prev2.close) / 2) {
      out.push({ type: 'candlestick', id: 'eveningStar', name: 'Evening Star', italian: 'Stella della Sera',
        candleIndex: i, time: c.time, bias: 'bearish', reliability: 'high',
        description: 'Pattern 3-bar: rialzista forte → piccola/doji → ribassista che rompe mid-range. Reversal classico.' })
    }
    const cRange = c.high - c.low
    // Tweezer Bottom
    if (Math.abs(c.low - prev.low) / Math.max(cRange, 1e-9) < 0.05 && ap.bearish && a.bullish && trend5 < 0) {
      out.push({ type: 'candlestick', id: 'tweezerBottom', name: 'Tweezer Bottom', italian: 'Tweezer Bottom',
        candleIndex: i, time: c.time, bias: 'bullish', reliability: 'medium',
        description: 'Due low identici in downtrend: doppio rifiuto sul supporto.' })
    }
    // Tweezer Top
    if (Math.abs(c.high - prev.high) / Math.max(cRange, 1e-9) < 0.05 && ap.bullish && a.bearish && trend5 > 0) {
      out.push({ type: 'candlestick', id: 'tweezerTop', name: 'Tweezer Top', italian: 'Tweezer Top',
        candleIndex: i, time: c.time, bias: 'bearish', reliability: 'medium',
        description: 'Due high identici in uptrend: doppio rifiuto sulla resistenza.' })
    }
  }
  return out
}

// ── CHART PATTERNS ───────────────────────────────────────────────────
// Detection semplificata su swing high/low. Per crypto 15m sono significativi
// pattern formati su 20-50 candele.

interface Swing { idx: number; price: number; type: 'high' | 'low' }

function findSwings(candles: Candle[], window = 3): Swing[] {
  const swings: Swing[] = []
  for (let i = window; i < candles.length - window; i++) {
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

export function detectChartPatterns(candles: Candle[], lookback = 60): Pattern[] {
  if (!candles || candles.length < 25) return []
  const out: Pattern[] = []
  const sliceStart = Math.max(0, candles.length - lookback)
  const slice = candles.slice(sliceStart)
  const swings = findSwings(slice)
  if (swings.length < 4) return []

  const recentHighs = swings.filter(s => s.type === 'high').slice(-3)
  const recentLows = swings.filter(s => s.type === 'low').slice(-3)
  const last = candles[candles.length - 1]!

  // Double Top: 2 high simili (entro 1%), low intermedio sotto, current torna sotto neckline
  if (recentHighs.length >= 2) {
    const [h1, h2] = recentHighs.slice(-2)
    const diff = Math.abs(h1!.price - h2!.price) / h1!.price
    if (diff < 0.01 && h2!.idx > h1!.idx) {
      const neckline = lowestLow(slice, h1!.idx, h2!.idx)
      if (last.close < neckline && last.close < h2!.price * 0.99) {
        out.push({ type: 'chart', id: 'doubleTop', name: 'Double Top', italian: 'Doppio Massimo',
          candleIndex: candles.length - 1, time: last.time, bias: 'bearish', reliability: 'high',
          description: `Due massimi su ${h2!.price.toFixed(2)} e neckline ${neckline.toFixed(2)} rotta. Target proiettato verso il basso.` })
      }
    }
  }

  // Double Bottom: speculare
  if (recentLows.length >= 2) {
    const [l1, l2] = recentLows.slice(-2)
    const diff = Math.abs(l1!.price - l2!.price) / l1!.price
    if (diff < 0.01 && l2!.idx > l1!.idx) {
      const neckline = highestHigh(slice, l1!.idx, l2!.idx)
      if (last.close > neckline && last.close > l2!.price * 1.01) {
        out.push({ type: 'chart', id: 'doubleBottom', name: 'Double Bottom', italian: 'Doppio Minimo',
          candleIndex: candles.length - 1, time: last.time, bias: 'bullish', reliability: 'high',
          description: `Due minimi su ${l2!.price.toFixed(2)} e neckline ${neckline.toFixed(2)} rotta. Target proiettato verso l'alto.` })
      }
    }
  }

  // Head & Shoulders: high1 < high2 (head) > high3, low1 ≈ low2
  if (recentHighs.length >= 3) {
    const [s1, h, s2] = recentHighs.slice(-3)
    if (h!.price > s1!.price && h!.price > s2!.price &&
        Math.abs(s1!.price - s2!.price) / s1!.price < 0.02) {
      const neckline = Math.min(lowestLow(slice, s1!.idx, h!.idx), lowestLow(slice, h!.idx, s2!.idx))
      if (last.close < neckline) {
        out.push({ type: 'chart', id: 'headShoulders', name: 'Head & Shoulders', italian: 'Testa e Spalle',
          candleIndex: candles.length - 1, time: last.time, bias: 'bearish', reliability: 'high',
          description: `H&S confermato (testa ${h!.price.toFixed(2)}, neckline ${neckline.toFixed(2)} rotta).` })
      }
    }
  }

  // Inverse Head & Shoulders
  if (recentLows.length >= 3) {
    const [s1, h, s2] = recentLows.slice(-3)
    if (h!.price < s1!.price && h!.price < s2!.price &&
        Math.abs(s1!.price - s2!.price) / s1!.price < 0.02) {
      const neckline = Math.max(highestHigh(slice, s1!.idx, h!.idx), highestHigh(slice, h!.idx, s2!.idx))
      if (last.close > neckline) {
        out.push({ type: 'chart', id: 'invHeadShoulders', name: 'Inverse H&S', italian: 'Testa e Spalle Rovesciato',
          candleIndex: candles.length - 1, time: last.time, bias: 'bullish', reliability: 'high',
          description: `H&S rovesciato confermato (testa ${h!.price.toFixed(2)}, neckline ${neckline.toFixed(2)} rotta).` })
      }
    }
  }

  // Ascending Triangle: highs costanti, lows in salita
  if (recentHighs.length >= 2 && recentLows.length >= 2) {
    const [h1, h2] = recentHighs.slice(-2)
    const [l1, l2] = recentLows.slice(-2)
    const hFlat = Math.abs(h1!.price - h2!.price) / h1!.price < 0.01
    const lUp = l2!.price > l1!.price && l2!.idx > l1!.idx
    if (hFlat && lUp && last.close > h2!.price * 0.998) {
      out.push({ type: 'chart', id: 'ascTriangle', name: 'Ascending Triangle', italian: 'Triangolo Ascendente',
        candleIndex: candles.length - 1, time: last.time, bias: 'bullish', reliability: 'medium',
        description: `Resistenza piatta a ${h2!.price.toFixed(2)} e minimi crescenti. Breakout in corso.` })
    }
    const lFlat = Math.abs(l1!.price - l2!.price) / l1!.price < 0.01
    const hDown = h2!.price < h1!.price && h2!.idx > h1!.idx
    if (lFlat && hDown && last.close < l2!.price * 1.002) {
      out.push({ type: 'chart', id: 'descTriangle', name: 'Descending Triangle', italian: 'Triangolo Discendente',
        candleIndex: candles.length - 1, time: last.time, bias: 'bearish', reliability: 'medium',
        description: `Supporto piatto a ${l2!.price.toFixed(2)} e massimi decrescenti. Breakdown in corso.` })
    }
  }

  return out
}

// ── AGGREGATOR ────────────────────────────────────────────────────────
export interface PatternSummary {
  patterns: Pattern[]
  dominantBias: PatternBias
  bullishCount: number
  bearishCount: number
  highReliability: Pattern[]
}

export function detectAllPatterns(candles: Candle[]): PatternSummary {
  const all = [...detectCandlestickPatterns(candles), ...detectChartPatterns(candles)]
  let bull = 0, bear = 0
  for (const p of all) {
    if (p.bias === 'bullish') bull += p.reliability === 'high' ? 3 : p.reliability === 'medium' ? 2 : 1
    if (p.bias === 'bearish') bear += p.reliability === 'high' ? 3 : p.reliability === 'medium' ? 2 : 1
  }
  const dominantBias: PatternBias = bull > bear * 1.3 ? 'bullish' : bear > bull * 1.3 ? 'bearish' : 'neutral'
  return {
    patterns: all,
    dominantBias,
    bullishCount: bull,
    bearishCount: bear,
    highReliability: all.filter(p => p.reliability === 'high'),
  }
}

/**
 * Pattern booster per signal-router.
 * Restituisce:
 *  - 'align': pattern dominante stesso bias del signal → +20% confidence
 *  - 'conflict': pattern dominante opposto → veto
 *  - 'neutral': no pattern significativo → no change
 */
export function evaluateSignalConfluence(
  candles: Candle[],
  signalDirection: 'long' | 'short',
): { verdict: 'align' | 'conflict' | 'neutral'; summary: PatternSummary } {
  const summary = detectAllPatterns(candles)
  const signalBias: PatternBias = signalDirection === 'long' ? 'bullish' : 'bearish'
  if (summary.dominantBias === signalBias) return { verdict: 'align', summary }
  if (summary.dominantBias === 'neutral') return { verdict: 'neutral', summary }
  return { verdict: 'conflict', summary }
}
