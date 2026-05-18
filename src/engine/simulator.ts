// Simulator — port di trade.fondamentale/frontend/src/services/Simulator.js.
// Stessa identica logica: 1% risk per trade compounding, R-multiple ATR-based, ruin 50%.
// Usato da scripts/backtest-month.ts per validare strategie su dati storici HL.

import { atr } from '../strategy/indicators.js'
import type { Candle, StrategyDef, SimulationResult, SimulationTrade, Direction } from '../types/trading.js'
import { getSlippageForCoin, HL_TAKER_FEE } from './realistic-costs.js'
import type { FundingPayment } from '../core/funding-history.js'
import { buildFundingIndex, cumulativeFundingCostIndexed } from '../core/funding-history.js'

export interface SimOpts {
  startingBalance?: number    // USD
  riskPerTrade?: number       // 0.01 = 1%
  symbol: string              // coin id (BTC, ETH, ...)
  slMul?: number
  tpMul?: number
  maxBars?: number
  minWarmup?: number
  ruinThresholdPct?: number   // 50 = -50% del balance
  feeRate?: number            // taker fee es. 0.00045 (HL 0.045%)
  slippageRate?: number       // override opzionale; default = per-coin map
  compounding?: boolean
  fundingSeries?: FundingPayment[]   // se passato, simula costo funding ora-per-ora
}

export interface TradeOutcome {
  outcome: 'tp' | 'sl' | 'timeout'
  rr: number
  rawRR: number
  costInR: number
  bars: number
  exitTime: number
}

/** Cost in R-multiple: (fee + slippage) round-trip diviso per il risk-distance in % */
export function calcCostInR(slDist: number, entry: number, feeRate = 0.00045, slippageRate = 0.0002): number {
  const slDistPct = slDist / entry
  const costPct = (feeRate + slippageRate) * 2
  return slDistPct > 0 ? costPct / slDistPct : 0
}

export function simulateTrade(
  candles: Candle[],
  i: number,
  direction: Direction,
  slMul: number,
  tpMul: number,
  maxBars: number,
  costInR: number,
): TradeOutcome | null {
  const a = atr(candles, 14, i)
  if (!a || a === 0) return null
  const entry = candles[i]!.close
  const slDist = a * slMul
  const tpDist = a * tpMul
  const sl = direction === 'long' ? entry - slDist : entry + slDist
  const tp = direction === 'long' ? entry + tpDist : entry - tpDist

  for (let j = i + 1; j <= i + maxBars && j < candles.length; j++) {
    const bar = candles[j]!
    if (direction === 'long') {
      if (bar.low <= sl) return { outcome: 'sl', rr: -1 - costInR, rawRR: -1, costInR, bars: j - i, exitTime: bar.time }
      if (bar.high >= tp) return { outcome: 'tp', rr: tpMul / slMul - costInR, rawRR: tpMul / slMul, costInR, bars: j - i, exitTime: bar.time }
    } else {
      if (bar.high >= sl) return { outcome: 'sl', rr: -1 - costInR, rawRR: -1, costInR, bars: j - i, exitTime: bar.time }
      if (bar.low <= tp) return { outcome: 'tp', rr: tpMul / slMul - costInR, rawRR: tpMul / slMul, costInR, bars: j - i, exitTime: bar.time }
    }
  }
  const j = Math.min(i + maxBars, candles.length - 1)
  const exit = candles[j]!.close
  const pnl = direction === 'long' ? exit - entry : entry - exit
  const rawRR = pnl / slDist
  return { outcome: 'timeout', rr: rawRR - costInR, rawRR, costInR, bars: j - i, exitTime: candles[j]!.time }
}

/** Cost in R-multiple: (fee + slippage) round-trip diviso per il risk-distance in % */
function calculateCostInR(slDist: number, entry: number, feeRate: number, slippageRate: number): number {
  const slDistPct = slDist / entry
  const costPct = (feeRate + slippageRate) * 2  // round-trip
  return slDistPct > 0 ? costPct / slDistPct : 0
}

export function simulateAccount(
  strategy: StrategyDef,
  candles: Candle[],
  opts: SimOpts,
): SimulationResult | { error: string } {
  const cfg = {
    startingBalance:  opts.startingBalance ?? 1000,
    riskPerTrade:     opts.riskPerTrade ?? 0.01,
    minWarmup:        opts.minWarmup ?? 250,
    maxBars:          opts.maxBars ?? 30,
    slMul:            opts.slMul ?? strategy.slMul,
    tpMul:            opts.tpMul ?? strategy.tpMul,
    fundingSeries:    opts.fundingSeries,
    ruinThresholdPct: opts.ruinThresholdPct ?? 50,
    feeRate:          opts.feeRate ?? HL_TAKER_FEE,
    slippageRate:     opts.slippageRate ?? getSlippageForCoin(opts.symbol),
    compounding:      opts.compounding ?? true,
  }
  const fundingIndex = cfg.fundingSeries && cfg.fundingSeries.length > 0
    ? buildFundingIndex(cfg.fundingSeries)
    : null

  if (!candles || candles.length < cfg.minWarmup + cfg.maxBars + 10) {
    return { error: 'Candele insufficienti' }
  }

  let balance = cfg.startingBalance
  let peak = balance
  let maxDD = 0
  let blown = false
  let blownAt: number | null = null
  const trades: SimulationTrade[] = []
  const equityCurve: Array<{ time: number; balance: number }> = [
    { time: candles[cfg.minWarmup]!.time, balance },
  ]
  const ruinFloor = cfg.startingBalance * (1 - cfg.ruinThresholdPct / 100)

  for (let i = cfg.minWarmup; i < candles.length - cfg.maxBars; i++) {
    if (blown) break
    // Build StrategyContext con funding rate al timestamp della candela i (per fundingHarvest etc)
    let ctx: import('../types/trading.js').StrategyContext = {}
    if (cfg.fundingSeries && cfg.fundingSeries.length > 0) {
      const tNow = candles[i]!.time
      let lo = 0, hi = cfg.fundingSeries.length
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (cfg.fundingSeries[mid]!.time <= tNow) lo = mid + 1
        else hi = mid
      }
      const lastIdx = lo - 1
      if (lastIdx >= 0) {
        const fp = cfg.fundingSeries[lastIdx]!
        ctx = { fundingRate: fp.rate, premium: fp.premium }
      }
    }
    if (strategy.requiresFunding && ctx.fundingRate === undefined) continue
    const sig = strategy.fn(candles, i, ctx)
    if (!sig?.direction) continue

    const a = atr(candles, 14, i)
    if (!a || a === 0) continue
    const slDist = a * cfg.slMul
    const entry = candles[i]!.close
    const costInR = calculateCostInR(slDist, entry, cfg.feeRate, cfg.slippageRate)

    const trade = simulateTrade(candles, i, sig.direction, cfg.slMul, cfg.tpMul, cfg.maxBars, costInR)
    if (!trade) continue

    // Funding cost (in % notional) accumulato durante l'holding period
    let fundingPctCost = 0
    if (fundingIndex) {
      fundingPctCost = cumulativeFundingCostIndexed(fundingIndex, candles[i]!.time, trade.exitTime, sig.direction)
    }
    // Convert funding % notional → R-multiple: fundingR = fundingPct × (entry / slDist)
    const fundingInR = slDist > 0 ? fundingPctCost * (entry / slDist) : 0

    const riskBase = cfg.compounding ? balance : cfg.startingBalance
    const riskUsd = riskBase * cfg.riskPerTrade
    const pnlUsd = (trade.rr - fundingInR) * riskUsd   // sottrai funding cost
    balance += pnlUsd

    trades.push({
      time:         candles[i]!.time,
      direction:    sig.direction,
      reason:       sig.reason,
      entry,
      outcome:      trade.outcome,
      rr:           trade.rr,
      rawRR:        trade.rawRR,
      costInR:      trade.costInR,
      bars:         trade.bars,
      exitTime:     trade.exitTime,
      riskUsd:      Math.round(riskUsd * 100) / 100,
      pnlUsd:       Math.round(pnlUsd * 100) / 100,
      balanceAfter: Math.round(balance * 100) / 100,
    })

    if (balance > peak) peak = balance
    const dd = peak > 0 ? (peak - balance) / peak : 0
    if (dd > maxDD) maxDD = dd
    equityCurve.push({ time: candles[i]!.time, balance: Math.round(balance * 100) / 100 })

    if (balance < ruinFloor) {
      blown = true
      blownAt = candles[i]!.time
    }
  }

  const total = trades.length
  const wins = trades.filter(t => t.outcome === 'tp').length
  const losses = trades.filter(t => t.outcome === 'sl').length
  const closed = wins + losses
  const winRate = closed > 0 ? wins / closed : 0
  const grossWin = trades.filter(t => t.rr > 0).reduce((s, t) => s + t.rr, 0)
  const grossLoss = Math.abs(trades.filter(t => t.rr < 0).reduce((s, t) => s + t.rr, 0))
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0
  const avgRR = total > 0 ? trades.reduce((s, t) => s + t.rr, 0) / total : 0

  const periodSec = (candles[candles.length - 1]!.time - candles[cfg.minWarmup]!.time)
  const days = Math.max(1, periodSec / 86400)
  const tradesPerDay = total / days

  return {
    strategyId:      strategy.id,
    strategyName:    strategy.name,
    symbol:          opts.symbol,
    startingBalance: cfg.startingBalance,
    finalBalance:    Math.round(balance * 100) / 100,
    pnlUsd:          Math.round((balance - cfg.startingBalance) * 100) / 100,
    pnlPct:          Math.round((balance - cfg.startingBalance) / cfg.startingBalance * 10000) / 100,
    peakBalance:     Math.round(peak * 100) / 100,
    maxDrawdownPct:  Math.round(maxDD * 10000) / 100,
    blown,
    blownAt,
    trades,
    equityCurve,
    summary: {
      total, wins, losses,
      winRate,
      profitFactor,
      avgRR,
      tradesPerDay,
      significance: total < 30 ? 'low' : total < 100 ? 'medium' : 'high',
    },
  }
}
