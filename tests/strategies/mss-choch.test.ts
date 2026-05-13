// Smoke test per la strategia MSS/ChoCH — assicura che la pure function abbia firma corretta
// e che generi segnali su candele costruite ad-hoc.

import { describe, it, expect } from 'vitest'
import { mssChoCH } from '../../src/strategy/strategies/mss-choch.js'
import type { Candle } from '../../src/types/trading.js'

function makeCandle(time: number, open: number, high: number, low: number, close: number): Candle {
  return { time, open, high, low, close, volume: 100 }
}

describe('mssChoCH strategy', () => {
  it('returns null on insufficient history', () => {
    const candles: Candle[] = [makeCandle(0, 100, 101, 99, 100)]
    expect(mssChoCH.fn(candles, 0)).toBeNull()
  })

  it('detects bullish MSS (sweep low + recovery + close above range high)', () => {
    const candles: Candle[] = []
    // 30 candele in range 100-110
    for (let i = 0; i < 30; i++) {
      candles.push(makeCandle(i * 60, 105, 110, 100, 105))
    }
    // candle i-1: sweep sotto 100, recovery sopra
    candles.push(makeCandle(30 * 60, 102, 103, 95, 101))
    // candle i: close sopra 110 con close > open
    candles.push(makeCandle(31 * 60, 105, 115, 104, 114))

    const signal = mssChoCH.fn(candles, 31)
    expect(signal).not.toBeNull()
    expect(signal?.direction).toBe('long')
    expect(signal?.strategyId).toBe('mssChoCH')
  })

  it('exposes config metadata', () => {
    expect(mssChoCH.expectedWR).toBe('65-72%')
    expect(mssChoCH.slMul).toBe(0.8)
    expect(mssChoCH.tpMul).toBe(1.8)
  })
})
