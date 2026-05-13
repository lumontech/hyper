// Core trading types. Mirror della shape utilizzata in trade.fondamentale per garantire
// parità di logica tra simulator e live-executor.

export interface Candle {
  time: number      // Unix seconds (UTC)
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export type Direction = 'long' | 'short'

export interface Signal {
  direction: Direction
  reason: string
  strategyId?: string
  confidence?: number   // 0..1 opzionale
}

export type OrderType = 'market' | 'limit'
export type TimeInForce = 'Gtc' | 'Ioc' | 'Alo'

export interface OrderRequest {
  coin: string                  // 'BTC' | 'ETH' | 'SOL' | 'XRP' | 'BNB'
  direction: Direction
  size: number                  // base units (es. 0.01 BTC)
  type: OrderType
  limitPrice?: number           // required if type='limit'
  stopLoss?: number             // absolute price
  takeProfit?: number           // absolute price
  reduceOnly?: boolean
  tif?: TimeInForce
  strategyId: string
  signalReason: string
  // metadata per audit
  generatedAt: number           // ms epoch
  candleTime: number            // candle che ha generato il signal
}

export interface Fill {
  orderId: string
  ts: number                    // ms epoch
  coin: string
  direction: Direction
  size: number
  price: number
  fee: number
  pnl?: number                  // realized only se chiusura
  isClose: boolean
}

export interface Position {
  coin: string
  direction: Direction
  size: number                  // base units (sempre positivo, direction porta il segno)
  entryPrice: number
  markPrice: number
  unrealizedPnl: number
  margin: number                // USD
  leverage: number
  liquidationPrice: number | null
  openedAt: number              // ms epoch
  stopLoss: number | null
  takeProfit: number | null
  strategyId: string
}

export interface AccountState {
  equityUsd: number
  marginUsedUsd: number
  freeMarginUsd: number
  totalNotionalUsd: number
  positions: Position[]
  updatedAt: number
}

export interface RiskCheckResult {
  allow: boolean
  reason: string | null
  appliedSize?: number          // se size è stata clamped
}

export interface SimulationTrade {
  time: number
  direction: Direction
  reason: string
  entry: number
  outcome: 'tp' | 'sl' | 'timeout'
  rr: number                    // R-multiple netto costi
  rawRR: number                 // R-multiple lordo
  costInR: number
  bars: number
  exitTime: number
  riskUsd: number
  pnlUsd: number
  balanceAfter: number
}

export interface SimulationResult {
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
  trades: SimulationTrade[]
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

export type StrategyFn = (candles: Candle[], i: number) => Signal | null

export interface StrategyDef {
  id: string
  name: string
  icon: string
  style: 'trend' | 'mean-reversion' | 'breakout' | 'reversal' | 'smc' | 'pa' | 'momentum'
  expectedWR: string            // human-readable es. '65-72%'
  slMul: number
  tpMul: number
  optimalTF: string[]
  supportedCoins: string[] | 'all'
  desc: string
  fn: StrategyFn
}
