// Binance public klines client — read-only, no auth, no signing.
// Usato esclusivamente come fonte dati STORICA per i backtest (Binance ha anni di storia
// su BTCUSDT/ETHUSDT/SOLUSDT/XRPUSDT/BNBUSDT, mentre HL public API ne ha solo ~52gg).
//
// L'esecuzione live continua a passare per HyperliquidClient — questo file NON tocca ordini.

import type { Candle } from '../types/trading.js'

const BINANCE_BASE = 'https://api.binance.com/api/v3'

// I 5 coin del bot mappati ai simboli Binance USDT-pair (Binance non ha perp USDC liquidi).
// USDT/USDC sono ~1:1 pegged, quindi i price action sono praticamente identici sul TF 15m.
const COIN_TO_SYMBOL: Record<string, string> = {
  BTC: 'BTCUSDT',
  ETH: 'ETHUSDT',
  SOL: 'SOLUSDT',
  XRP: 'XRPUSDT',
  BNB: 'BNBUSDT',
  // HYPE non è su Binance (token nativo HL) — niente backtest storico, solo live
  SUI:  'SUIUSDT',
  AVAX: 'AVAXUSDT',
  DOGE: 'DOGEUSDT',
  AAVE: 'AAVEUSDT',
}

const INTERVAL_MAP: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m',
  '1h': '1h', '4h': '4h',
  '1d': '1d', '1D': '1d',
}

const INTERVAL_SEC: Record<string, number> = {
  '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400,
}

const CHUNK = 1000  // Binance hard limit per call
const RATE_LIMIT_MS = 80  // pubblico ~1200 req/min, restiamo conservativi

export class BinanceClient {
  /**
   * Fetch candele storiche con auto-paginazione.
   * Binance onora correttamente startTime/endTime (non come HL che taglia a 5000 più recenti).
   *
   * @param coin     "BTC" | "ETH" | "SOL" | "XRP" | "BNB"
   * @param interval "15m" etc.
   * @param limit    numero di candele desiderato. Per 365gg @15m = 35040 candele = ~35 chunk.
   */
  async fetchCandles(coin: string, interval: string, limit: number): Promise<Candle[]> {
    const symbol = COIN_TO_SYMBOL[coin.toUpperCase()]
    if (!symbol) throw new Error(`Binance: unknown coin ${coin}`)
    const tf = INTERVAL_MAP[interval]
    if (!tf) throw new Error(`Binance: unknown interval ${interval}`)
    const sec = INTERVAL_SEC[tf]!

    const endTime = Date.now()
    const startTime = endTime - limit * sec * 1000

    if (limit <= CHUNK) {
      return this.fetchChunk(symbol, tf, startTime, endTime, CHUNK)
    }

    // Paginazione forward: cursore avanza da startTime verso endTime
    const collected: Candle[] = []
    let cursor = startTime
    const maxIterations = Math.ceil(limit / CHUNK) + 4
    for (let iter = 0; iter < maxIterations; iter++) {
      const part = await this.fetchChunk(symbol, tf, cursor, endTime, CHUNK)
      if (part.length === 0) break
      for (const c of part) {
        if (collected.length === 0 || c.time > collected[collected.length - 1]!.time) collected.push(c)
      }
      if (part.length < CHUNK) break
      const lastTime = part[part.length - 1]!.time * 1000
      cursor = lastTime + sec * 1000
      if (cursor >= endTime) break
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS))
    }
    return collected
  }

  private async fetchChunk(symbol: string, interval: string, startTime: number, endTime: number, limit: number): Promise<Candle[]> {
    const url = `${BINANCE_BASE}/klines?symbol=${symbol}&interval=${interval}&startTime=${startTime}&endTime=${endTime}&limit=${limit}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Binance /klines ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = (await res.json()) as Array<[number, string, string, string, string, string, number, string, number, string, string, string]>
    if (!Array.isArray(data)) throw new Error('Binance: unexpected response shape')
    return data.map(k => ({
      time: Math.floor(k[0] / 1000),   // openTime ms → sec
      open: parseFloat(k[1]),
      high: parseFloat(k[2]),
      low: parseFloat(k[3]),
      close: parseFloat(k[4]),
      volume: parseFloat(k[5]),
    }))
  }
}
