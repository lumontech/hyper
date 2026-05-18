// Funding rate history fetcher per Hyperliquid.
// Storia funding payments orari, usata dal backtester per simulare il vero costo carry.
//
// Hyperliquid paga funding ogni ora basandosi su (perp price - oracle price).
// Funding può essere positivo (longs pagano shorts) o negativo (shorts pagano longs).
// Storicamente HL ha funding rate in range ±0.001-0.05% / hour.
// Su 365gg di hold = 8760 ore × 0.01% medio = ±88% APR di costo. IMPATTO DRAMMATICO.
//
// Endpoint: POST {api}/info { type: 'fundingHistory', coin: 'BTC', startTime, endTime }
// Response: Array<{ coin, fundingRate: string (decimale, NON percentuale), premium, time }>
// Limit: 500 record per call → paginazione necessaria per 365gg = 8760 ore.

import type { Logger } from 'pino'

const API_BASE: Record<'testnet' | 'mainnet', string> = {
  testnet: 'https://api.hyperliquid-testnet.xyz',
  mainnet: 'https://api.hyperliquid.xyz',
}

const COIN_MAP: Record<string, string> = {
  BTC: 'BTC', ETH: 'ETH', SOL: 'SOL', XRP: 'XRP', BNB: 'BNB',
}

export interface FundingPayment {
  /** Unix timestamp in SECONDS (HL returns ms) */
  time: number
  /** Funding rate per hour as decimal (es. 0.00012 = 0.012% / h, positivo significa long paga short) */
  rate: number
  /** Premium (perp price / oracle - 1), as decimal */
  premium: number
}

export interface FundingHistoryDeps {
  network: 'testnet' | 'mainnet'
  logger?: Logger
}

const CHUNK = 500
const RATE_LIMIT_MS = 120

export class FundingHistory {
  constructor(private readonly deps: FundingHistoryDeps) {}

  /**
   * Fetch funding history paginated. Returns hourly payments, ascending by time.
   * @param coin BTC | ETH | SOL | XRP | BNB
   * @param startMs Inclusive (ms epoch). Default: now - 365gg.
   * @param endMs Exclusive (ms epoch). Default: now.
   */
  async fetch(coin: string, startMs?: number, endMs?: number): Promise<FundingPayment[]> {
    const hlCoin = COIN_MAP[coin.toUpperCase()]
    if (!hlCoin) throw new Error(`Funding: unknown coin ${coin}`)
    const end = endMs ?? Date.now()
    const start = startMs ?? (end - 365 * 86400 * 1000)

    const collected: FundingPayment[] = []
    let cursorStart = start
    const maxIters = Math.ceil((end - start) / (CHUNK * 3600_000)) + 5  // safety cap
    for (let iter = 0; iter < maxIters; iter++) {
      const part = await this.fetchChunk(hlCoin, cursorStart, end)
      if (part.length === 0) break
      for (const p of part) {
        if (collected.length === 0 || p.time > collected[collected.length - 1]!.time) collected.push(p)
      }
      if (part.length < CHUNK) break
      // Avanza cursore di 1h dopo l'ultimo ricevuto
      const lastTimeMs = part[part.length - 1]!.time * 1000
      if (lastTimeMs >= end) break
      cursorStart = lastTimeMs + 3600_000   // +1h (granularità funding)
      await new Promise(r => setTimeout(r, RATE_LIMIT_MS))
    }
    return collected
  }

  private async fetchChunk(coin: string, startTime: number, endTime: number): Promise<FundingPayment[]> {
    const url = `${API_BASE[this.deps.network]}/info`
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'fundingHistory', coin, startTime, endTime }),
    })
    if (!res.ok) throw new Error(`HL fundingHistory ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = (await res.json()) as Array<{ coin: string; fundingRate: string; premium: string; time: number }>
    if (!Array.isArray(data)) throw new Error('HL fundingHistory: unexpected response shape')
    return data.map(p => ({
      time: Math.floor(p.time / 1000),
      rate: parseFloat(p.fundingRate),
      premium: parseFloat(p.premium ?? '0'),
    }))
  }
}

/**
 * Calcola il costo cumulato di funding (in % del notional) per una posizione mantenuta
 * da `entryTimeSec` a `exitTimeSec` in una `direction` data.
 *
 * Convention: rate positivo significa LONG paga SHORT. Quindi:
 *   - long  → costo = +Σ rate negli intervalli (perdo)
 *   - short → costo = -Σ rate negli intervalli (guadagno se rate positivo)
 *
 * Return: numero (positivo = costo per la posizione, negativo = profit funding).
 */
export function cumulativeFundingCost(
  series: FundingPayment[],
  entryTimeSec: number,
  exitTimeSec: number,
  direction: 'long' | 'short',
): number {
  let sum = 0
  for (const p of series) {
    if (p.time < entryTimeSec) continue
    if (p.time >= exitTimeSec) break
    sum += p.rate
  }
  return direction === 'long' ? sum : -sum
}

/** Indicizza la serie per binary-search rapido in backtest hot loop. */
export function buildFundingIndex(series: FundingPayment[]): {
  cumRates: number[]   // cumulative sum at each point
  times: number[]      // parallel time array
} {
  const cumRates = new Array<number>(series.length)
  const times = new Array<number>(series.length)
  let cum = 0
  for (let i = 0; i < series.length; i++) {
    cum += series[i]!.rate
    cumRates[i] = cum
    times[i] = series[i]!.time
  }
  return { cumRates, times }
}

/**
 * Calcola costo funding O(log n) usando indice precomputato.
 */
export function cumulativeFundingCostIndexed(
  index: { cumRates: number[]; times: number[] },
  entryTimeSec: number,
  exitTimeSec: number,
  direction: 'long' | 'short',
): number {
  const { cumRates, times } = index
  if (times.length === 0) return 0
  // Binary search: trova il più piccolo i tale che times[i] >= entryTimeSec
  const iStart = lowerBound(times, entryTimeSec)
  const iEnd = lowerBound(times, exitTimeSec)
  if (iStart >= iEnd) return 0
  const sumAtEnd = iEnd > 0 ? cumRates[iEnd - 1]! : 0
  const sumBeforeStart = iStart > 0 ? cumRates[iStart - 1]! : 0
  const sum = sumAtEnd - sumBeforeStart
  return direction === 'long' ? sum : -sum
}

function lowerBound(arr: number[], target: number): number {
  let lo = 0, hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid]! < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

// ─────────────────────────────────────────────────────────────────
// LIVE FUNDING RATES CACHE
// ─────────────────────────────────────────────────────────────────

export interface LiveFundingSnapshot {
  /** rate corrente per coin (decimale, es. 0.0001 = 0.01%/h) */
  rates: Record<string, number>
  /** premium perp/oracle per coin */
  premiums: Record<string, number>
  /** open interest per coin (number, in coin units) */
  openInterest: Record<string, number>
  /** mark price per coin */
  markPrices: Record<string, number>
  /** ms epoch dell'ultimo aggiornamento */
  updatedAt: number
}

/**
 * Live funding rate poller. Fetcha periodicamente `metaAndAssetCtxs` da HL
 * e mantiene una cache in memory accessibile dalle strategie via StrategyContext.
 *
 * Endpoint: POST /info { type: 'metaAndAssetCtxs' }
 * Response: [meta, [ctxs]] dove ctxs[i] = { funding, openInterest, markPx, premium, ... }
 * Frequenza poll: ogni 60s (funding payments sono orari, no urgency tick).
 */
export class LiveFundingPoller {
  private snapshot: LiveFundingSnapshot = { rates: {}, premiums: {}, openInterest: {}, markPrices: {}, updatedAt: 0 }
  private timer: NodeJS.Timeout | null = null
  private cancelled = false

  constructor(private readonly opts: {
    network: 'testnet' | 'mainnet'
    pollMs?: number   // default 60000
    coins: string[]   // mapping interno (BTC, ETH, ...) — ritorna solo questi
    logger?: { info: (o: unknown, m: string) => void; warn: (o: unknown, m: string) => void }
  }) {}

  start(): void {
    this.poll()  // fire subito
    this.timer = setInterval(() => this.poll(), this.opts.pollMs ?? 60000)
  }

  stop(): void {
    this.cancelled = true
    if (this.timer) { clearInterval(this.timer); this.timer = null }
  }

  current(): LiveFundingSnapshot {
    return this.snapshot
  }

  /** Snapshot per un coin specifico — usato dalla pipeline router per build StrategyContext. */
  contextFor(coin: string): { fundingRate?: number; premium?: number } {
    const r = this.snapshot.rates[coin]
    const p = this.snapshot.premiums[coin]
    return { fundingRate: r, premium: p }
  }

  private async poll(): Promise<void> {
    if (this.cancelled) return
    try {
      const url = `${API_BASE[this.opts.network]}/info`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
      })
      if (!res.ok) throw new Error(`HL metaAndAssetCtxs ${res.status}`)
      const data = (await res.json()) as [
        { universe: Array<{ name: string }> },
        Array<{ funding: string; openInterest: string; markPx: string; premium?: string }>
      ]
      if (!Array.isArray(data) || data.length !== 2) throw new Error('unexpected shape')
      const [meta, ctxs] = data
      const newRates: Record<string, number> = {}
      const newPrem: Record<string, number> = {}
      const newOI: Record<string, number> = {}
      const newMark: Record<string, number> = {}
      for (let i = 0; i < meta.universe.length; i++) {
        const name = meta.universe[i]!.name
        if (!this.opts.coins.includes(name)) continue
        const ctx = ctxs[i]
        if (!ctx) continue
        newRates[name] = parseFloat(ctx.funding ?? '0')
        newPrem[name] = parseFloat(ctx.premium ?? '0')
        newOI[name] = parseFloat(ctx.openInterest ?? '0')
        newMark[name] = parseFloat(ctx.markPx ?? '0')
      }
      this.snapshot = {
        rates: newRates,
        premiums: newPrem,
        openInterest: newOI,
        markPrices: newMark,
        updatedAt: Date.now(),
      }
      this.opts.logger?.info({ coins: Object.keys(newRates).length }, '[FUND-LIVE] snapshot refreshed')
    } catch (err) {
      this.opts.logger?.warn({ err: String(err) }, '[FUND-LIVE] poll failed')
    }
  }
}
