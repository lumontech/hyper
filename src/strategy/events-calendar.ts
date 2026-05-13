// Crypto Events Calendar — eventi macro + crypto-specific che impattano BTC/ETH/SOL/XRP/BNB.
// Sorgenti:
//  - Seed file di eventi noti (halving, ETF deadlines, FOMC dates ricorrenti)
//  - Fetch opzionale CoinGecko events API (gratuita, no auth)
//
// Usato dal signal-router come "no-trade window" (es. ±30 min da FOMC release).

import type { Logger } from 'pino'

export type EventImpact = 'high' | 'medium' | 'low'
export type EventCategory = 'macro' | 'crypto' | 'regulatory' | 'protocol'

export interface CryptoEvent {
  id: string
  ts: number              // unix ms
  title: string
  description: string
  impact: EventImpact
  category: EventCategory
  affects: string[]       // coin tickers, ['*'] = tutti
  source: 'seed' | 'coingecko'
}

// ── Eventi seed (noti, ricorrenti o fissi) ───────────────────────────
// Aggiornati al 2026-05-13. Manualmente da estendere quando emergono dates.
const SEED_EVENTS: CryptoEvent[] = [
  // FOMC 2026 (mese in cui escono decisioni tassi, 18:00 UTC tipico)
  // Le date 2026 sono indicative — verifica federalreserve.gov
  { id: 'fomc-2026-06', ts: Date.UTC(2026, 5, 17, 18, 0),  title: 'FOMC Meeting Decision', description: 'Federal Reserve interest rate decision. Volatilità estrema BTC/ETH 30min prima/dopo.', impact: 'high',   category: 'macro', affects: ['*'], source: 'seed' },
  { id: 'fomc-2026-07', ts: Date.UTC(2026, 6, 29, 18, 0),  title: 'FOMC Meeting Decision', description: 'Federal Reserve interest rate decision.', impact: 'high',   category: 'macro', affects: ['*'], source: 'seed' },
  { id: 'fomc-2026-09', ts: Date.UTC(2026, 8, 16, 18, 0),  title: 'FOMC Meeting Decision', description: 'Federal Reserve interest rate decision.', impact: 'high',   category: 'macro', affects: ['*'], source: 'seed' },
  { id: 'fomc-2026-11', ts: Date.UTC(2026, 10, 4, 18, 0),  title: 'FOMC Meeting Decision', description: 'Federal Reserve interest rate decision.', impact: 'high',   category: 'macro', affects: ['*'], source: 'seed' },
  { id: 'fomc-2026-12', ts: Date.UTC(2026, 11, 16, 18, 0), title: 'FOMC Meeting Decision', description: 'Federal Reserve interest rate decision.', impact: 'high',   category: 'macro', affects: ['*'], source: 'seed' },

  // CPI release USA (tipico 2° martedì del mese, 12:30 UTC)
  { id: 'cpi-2026-06', ts: Date.UTC(2026, 5, 11, 12, 30), title: 'US CPI Release', description: 'Consumer Price Index. Crypto reagisce al dato vs forecast.', impact: 'high', category: 'macro', affects: ['*'], source: 'seed' },
  { id: 'cpi-2026-07', ts: Date.UTC(2026, 6, 15, 12, 30), title: 'US CPI Release', description: 'Consumer Price Index.', impact: 'high', category: 'macro', affects: ['*'], source: 'seed' },

  // BTC ETF inflows reports (settimanali, indicativo)
  // Halving: prossimo previsto 2028 — niente in calendario per ora

  // Eventi crypto-specific
  { id: 'eth-shapella-anniv', ts: Date.UTC(2026, 3, 12, 14, 0), title: 'ETH Shapella Anniversary', description: 'Anniversario dell\'attivazione withdrawals ETH staking.', impact: 'low', category: 'protocol', affects: ['ETH'], source: 'seed' },
]

export interface EventsCalendarDeps {
  logger: Logger
  /** Se true, fetch CoinGecko events ogni X minuti per aggiornare. */
  fetchExternal?: boolean
  fetchIntervalMin?: number
}

export class EventsCalendar {
  private events: CryptoEvent[] = [...SEED_EVENTS]
  private lastFetch = 0
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly deps: EventsCalendarDeps) {}

  start(): void {
    if (this.deps.fetchExternal) {
      this.fetchCoinGecko().catch(() => {})  // first attempt
      const ms = (this.deps.fetchIntervalMin ?? 360) * 60 * 1000
      this.timer = setInterval(() => this.fetchCoinGecko().catch(() => {}), ms)
    }
    this.deps.logger.info({ n_seed: SEED_EVENTS.length }, '[EVENTS] calendar started')
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
  }

  /** Eventi futuri dal momento corrente, ordinati per ts crescente. */
  upcoming(maxDays = 30): CryptoEvent[] {
    const now = Date.now()
    const cutoff = now + maxDays * 86400_000
    return this.events
      .filter(e => e.ts > now && e.ts <= cutoff)
      .sort((a, b) => a.ts - b.ts)
  }

  /** Eventi recenti (ultimi N ore). */
  recent(hoursBack = 24): CryptoEvent[] {
    const now = Date.now()
    const cutoff = now - hoursBack * 3600_000
    return this.events
      .filter(e => e.ts <= now && e.ts >= cutoff)
      .sort((a, b) => b.ts - a.ts)
  }

  /**
   * "No-trade window": ±windowMin minuti da un evento high-impact che affects la coin.
   * Usato dal signal-router per skippare segnali in finestre pericolose.
   */
  isInNoTradeWindow(coin: string, windowMin = 30): { blocked: boolean; event?: CryptoEvent } {
    const now = Date.now()
    const halfMs = windowMin * 60 * 1000
    for (const e of this.events) {
      if (e.impact !== 'high') continue
      if (!e.affects.includes('*') && !e.affects.includes(coin)) continue
      if (Math.abs(now - e.ts) <= halfMs) return { blocked: true, event: e }
    }
    return { blocked: false }
  }

  async fetchCoinGecko(): Promise<void> {
    const url = 'https://api.coingecko.com/api/v3/events'
    try {
      const res = await fetch(url, { headers: { 'Accept': 'application/json' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json() as { data?: Array<{ type?: string; title?: string; description?: string; start_date?: string; end_date?: string }> }
      const arr = data.data ?? []
      let added = 0
      for (const e of arr) {
        if (!e.start_date) continue
        const ts = Date.parse(e.start_date)
        if (isNaN(ts)) continue
        const id = `cg-${(e.title ?? 'event').slice(0, 30)}-${ts}`
        if (this.events.find(x => x.id === id)) continue
        this.events.push({
          id, ts,
          title: e.title ?? 'Event',
          description: (e.description ?? '').slice(0, 200),
          impact: 'medium',
          category: 'crypto',
          affects: ['*'],
          source: 'coingecko',
        })
        added++
      }
      this.lastFetch = Date.now()
      this.deps.logger.info({ added, total: this.events.length }, '[EVENTS] coingecko fetch')
    } catch (err) {
      this.deps.logger.warn({ err: String(err) }, '[EVENTS] coingecko fetch failed (no-op)')
    }
  }

  snapshot() {
    return {
      total: this.events.length,
      upcomingCount: this.upcoming(7).length,
      lastFetchAgo: this.lastFetch ? Date.now() - this.lastFetch : null,
    }
  }
}
