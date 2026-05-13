// Client HTTP per il backend Node.
// In dev: BASE = 'http://127.0.0.1:7777' (chiamate CORS al backend separato).
// In prod: usa window.location.origin (URL assoluto) per bypassare baseURI bug Chrome
// quando la pagina è caricata con credentials inline (user:pwd@host).

declare const __API_BASE__: string
// In prod (build) __API_BASE__ è stringa vuota → usa origin runtime con URL assoluto.
const BASE = __API_BASE__ && __API_BASE__.startsWith('http')
  ? __API_BASE__
  : (typeof window !== 'undefined' ? window.location.origin : '') + (__API_BASE__ || '')

async function jsonFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    credentials: 'include',   // include basic auth header automaticamente per stesso origine
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status}: ${text}`)
  }
  return res.json() as Promise<T>
}

export interface StatusResponse {
  ok: boolean
  network: 'testnet' | 'mainnet'
  dryRun: boolean
  allowedCoins: string[]
  strategiesEnabled: string[]
  timeframe: string
  uptimeSec: number
  haltActive: boolean
  risk: {
    demoEquity?: number
    demoTrades?: number
    demoWins?: number
    demoLosses?: number
    startingBalance?: number
    dailyPnlUsd?: number
    [k: string]: unknown
  }
  heartbeat?: Record<string, { lastSeenMsAgo: number; stale: boolean }>
  router?: RouterSnapshot
  events?: { total: number; upcomingCount: number; lastFetchAgo: number | null }
  autonomous?: boolean
}

export interface CryptoEvent {
  id: string
  ts: number
  title: string
  description: string
  impact: 'high' | 'medium' | 'low'
  category: 'macro' | 'crypto' | 'regulatory' | 'protocol'
  affects: string[]
  source: 'seed' | 'coingecko'
}

export interface Pattern {
  type: 'candlestick' | 'chart'
  id: string
  name: string
  italian: string
  candleIndex: number
  time: number
  bias: 'bullish' | 'bearish' | 'neutral'
  reliability: 'high' | 'medium' | 'low'
  description: string
}

export interface PatternsResponse {
  coin: string
  tf: string
  patterns: Pattern[]
  dominantBias: 'bullish' | 'bearish' | 'neutral'
  bullishCount: number
  bearishCount: number
  highReliability: Pattern[]
}

export interface StrategyMeta {
  id: string
  name: string
  icon: string
  style: string
  category: 'adaptive' | 'library'
  expectedWR: string
  slMul: number
  tpMul: number
  optimalTF: string[]
  desc: string
  enabled: boolean
  supportedCoins?: string[] | 'all'
}

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface RouterSignal {
  ts: number
  coin: string
  strategy: string
  direction: string
  reason: string
  status: string
}

export interface RouterSnapshot {
  lastEvaluatedAt: number
  signalsGenerated: number
  ordersAttempted: number
  ordersAccepted: number
  ordersRejected: number
  lastSignals: RouterSignal[]
}

export interface Position {
  coin: string
  direction: 'long' | 'short'
  entryPrice: number
  size: number
  stopLoss: number
  takeProfit: number
  strategyId: string
  openedAt: number
}

export interface OrderRow {
  id: string
  ts: number
  coin: string
  direction: 'long' | 'short'
  type: string
  size: number
  strategy_id: string
  status: string
  dry_run: number | boolean
}

export interface FillRow {
  id: string
  order_id: string | null
  ts: number
  coin: string
  direction: 'long' | 'short'
  size: number
  price: number
  fee: number
  pnl: number | null
  is_close: number | boolean
}

export interface BacktestResult {
  strategyId: string
  strategyName: string
  symbol: string
  startingBalance: number
  finalBalance: number
  pnlUsd: number
  pnlPct: number
  peakBalance: number
  maxDrawdownPct: number
  blown: boolean
  blownAt: number | null
  trades: Array<{
    time: number
    direction: 'long' | 'short'
    reason: string
    entry: number
    outcome: 'tp' | 'sl' | 'timeout'
    rr: number
    bars: number
    exitTime: number
    riskUsd: number
    pnlUsd: number
    balanceAfter: number
  }>
  equityCurve: Array<{ time: number; balance: number }>
  summary: {
    total: number
    wins: number
    losses: number
    winRate: number
    profitFactor: number
    avgRR: number
    tradesPerDay: number
    significance: string
  }
}

export const api = {
  status:     () => jsonFetch<StatusResponse>('/status'),
  strategies: () => jsonFetch<{ all: StrategyMeta[] }>('/strategies'),
  candles:    (coin: string, tf = '15m', limit = 500) =>
                jsonFetch<{ coin: string; tf: string; n: number; candles: Candle[] }>(`/candles/${coin}?tf=${tf}&limit=${limit}`),
  backtest:   (coin: string, strategyId: string, days: number, opts?: { slMul?: number; tpMul?: number; maxBars?: number }) =>
                jsonFetch<{ coin: string; strategy: string; days: number; tf: string; result: BacktestResult | { error: string } }>('/backtest', {
                  method: 'POST',
                  body: JSON.stringify({ coin, strategyId, days, ...opts }),
                }),
  backtestAll: (days: number) =>
                jsonFetch<{ days: number; tf: string; n: number; results: Array<{ coin: string; strategy: string; result: BacktestResult | { error: string } }> }>('/backtest/all', {
                  method: 'POST',
                  body: JSON.stringify({ days }),
                }),
  positions:  () => jsonFetch<{ positions: Position[]; note?: string }>('/positions'),
  equity:     () => jsonFetch<{ curve: Array<{ ts: number; equity_usd: number }>; note?: string }>('/equity'),
  orders:     () => jsonFetch<{ orders: OrderRow[]; note?: string }>('/orders'),
  fills:      () => jsonFetch<{ fills: FillRow[]; note?: string }>('/fills'),
  router:     () => jsonFetch<RouterSnapshot>('/router'),
  patterns:   (coin: string, tf = '15m') => jsonFetch<PatternsResponse>(`/patterns/${coin}?tf=${tf}`),
  events:     () => jsonFetch<{ upcoming: CryptoEvent[]; recent: CryptoEvent[]; snapshot: { total: number } }>('/events'),
  volume:     (coin: string, tf = '15m') => jsonFetch<{ coin: string; tf: string; profile: { poc: number; vah: number; val: number; totalVolume: number; hvn: number[]; lvn: number[]; buckets: { price: number; volume: number }[] } | null }>(`/volume/${coin}?tf=${tf}`),
  funding:    () => jsonFetch<{ cached: boolean; data: Array<{ coin: string; funding: number; openInterest: number; markPrice: number; premium: number }> }>('/funding'),
  demo:       () => jsonFetch<{ startingBalance: number; currentEquity: number; pnl: number; pnlPct: number; trades: number; wins: number; losses: number; winRate: number; equityCurve: Array<{ ts: number; equity_usd: number; daily_pnl_usd: number | null }>; recentFills: Array<Record<string, unknown>> }>('/demo'),
  health:     () => jsonFetch<{
    score: number
    color: 'green' | 'yellow' | 'red'
    label: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'COLLECTING_DATA'
    uptime: number
    demoEquity: number
    startingBalance: number
    pnl: number
    pnlPct: number
    trades: number
    wins: number
    losses: number
    winRate: number
    profitFactor: number
    maxDrawdown: { peak: number; trough: number; ddPct: number; ddUsd: number }
    router: { signalsGenerated: number; ordersAttempted: number; ordersAccepted: number; acceptRate: number }
    perStrategy: Array<{ strategy_id: string; trades: number; wins: number; losses: number; total_pnl: number; gross_win: number; gross_loss: number; win_rate: number; profit_factor: number }>
    checks: Array<{ name: string; ok: boolean; value: string; target: string }>
  }>('/health'),
  halt:       () => jsonFetch<{ halted: boolean }>('/halt',   { method: 'POST', headers: { 'X-Confirm': 'yes' } }),
  resume:     () => jsonFetch<{ halted: boolean }>('/resume', { method: 'POST', headers: { 'X-Confirm': 'yes' } }),
}
