// Backtest "pipeline-realistic" — replica esattamente il SignalRouter live:
//   1. Tutte le strategie compatibili valutano ogni bar chiusa
//   2. Tie-breaker: confluence ≥ 2 stessa direzione  OR  single signal in HIGH_CONVICTION_STYLES
//   3. Conflict (long+short) → skip
//   4. evaluateSignalConfluence: veto se pattern dominante oppposto
//   5. Solo i signal sopravvissuti diventano trade reali
//
// Risultato: stima onesta di cosa avrebbe fatto il bot in produzione su N giorni
// con la sua effettiva logica di filtro multi-strategia.

import type { Candle, StrategyDef, Signal, Direction, SimulationTrade } from '../types/trading.js'
import { atr } from '../strategy/indicators.js'
import { isStrategyCompatibleWithCoin } from '../strategy/strategy-registry.js'
import { evaluateSignalConfluence } from '../strategy/patterns.js'
import { passesRegimeFilters } from '../strategy/regime-filters.js'
import { getCoinStrategyParams } from '../strategy/coin-params.js'
import { simulateTrade, calcCostInR } from './simulator.js'
import { getSlippageForCoin, HL_TAKER_FEE } from './realistic-costs.js'
import type { FundingPayment } from '../core/funding-history.js'
import { buildFundingIndex, cumulativeFundingCostIndexed } from '../core/funding-history.js'

const HIGH_CONVICTION_STYLES = new Set(['smc', 'reversal'])

export interface PipelineBacktestOpts {
  symbol: string
  startingBalance?: number
  riskPerTrade?: number       // 0.01 = 1%
  maxBars?: number
  minWarmup?: number
  ruinThresholdPct?: number
  feeRate?: number
  slippageRate?: number       // override; default = per-coin map
  compounding?: boolean
  maxPositionUsd?: number     // se notional naturale > cap → scale; null = no cap
  fundingSeries?: FundingPayment[]   // se passato, simula costo funding cumulato per trade
}

export interface PipelineBacktestResult {
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
    significance: 'low' | 'medium' | 'high'
  }
  pipeline: {
    barsEvaluated: number
    rawSignals: number
    rawByStrategy: Record<string, number>
    skippedConflict: number
    skippedLowConviction: number
    skippedPatternConflict: number
    skippedPositionOpen: number
    skippedByRegime: Record<string, number>
    accepted: number
    confluenceDistribution: Record<string, number>   // "1" → count, "2" → count, etc.
    acceptedByStrategy: Record<string, number>       // strategia che ha innescato il trade
    acceptedDirection: { long: number; short: number }
  }
}

export function backtestPipeline(
  strategies: StrategyDef[],
  candles: Candle[],
  opts: PipelineBacktestOpts,
): PipelineBacktestResult | { error: string } {
  const cfg = {
    startingBalance:  opts.startingBalance ?? 1000,
    riskPerTrade:     opts.riskPerTrade ?? 0.01,
    minWarmup:        opts.minWarmup ?? 250,
    maxBars:          opts.maxBars ?? 30,
    ruinThresholdPct: opts.ruinThresholdPct ?? 50,
    feeRate:          opts.feeRate ?? HL_TAKER_FEE,
    slippageRate:     opts.slippageRate ?? getSlippageForCoin(opts.symbol),
    compounding:      opts.compounding ?? true,
    maxPositionUsd:   opts.maxPositionUsd ?? Infinity,
  }
  const fundingIndex = opts.fundingSeries && opts.fundingSeries.length > 0
    ? buildFundingIndex(opts.fundingSeries)
    : null

  if (!candles || candles.length < cfg.minWarmup + cfg.maxBars + 10) {
    return { error: 'Candele insufficienti' }
  }

  const compat = strategies.filter(s => isStrategyCompatibleWithCoin(s, opts.symbol))
  if (compat.length === 0) return { error: 'Nessuna strategia compatibile con coin' }

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

  // Pipeline stats
  let barsEvaluated = 0, rawSignals = 0
  const rawByStrategy: Record<string, number> = {}
  let skippedConflict = 0, skippedLowConviction = 0, skippedPatternConflict = 0, skippedPositionOpen = 0
  const skippedByRegime: Record<string, number> = {}
  let accepted = 0
  const confluenceDistribution: Record<string, number> = {}
  const acceptedByStrategy: Record<string, number> = {}
  const acceptedDirection = { long: 0, short: 0 }

  // Simulazione: una posizione alla volta su questa coin (come il router live).
  // Quando entriamo in trade, salta il signal sampling fino al close (i + bars).
  let busyUntilBar = -1

  for (let i = cfg.minWarmup; i < candles.length - cfg.maxBars; i++) {
    if (blown) break
    barsEvaluated++

    if (i < busyUntilBar) {
      skippedPositionOpen++
      continue
    }

    // Trim buffer: passa alle strategie solo le bar fino a i (incluse) → bar "chiusa"
    // (in live questo è il fix che abbiamo applicato al router)
    const buf = candles.slice(0, i + 1)

    // Build StrategyContext: lookup funding rate al timestamp della candela i
    let ctx: import('../types/trading.js').StrategyContext = {}
    if (opts.fundingSeries && opts.fundingSeries.length > 0) {
      const tNow = candles[i]!.time
      // Binary search dell'ultimo funding rate ≤ tNow
      let lo = 0, hi = opts.fundingSeries.length
      while (lo < hi) {
        const mid = (lo + hi) >>> 1
        if (opts.fundingSeries[mid]!.time <= tNow) lo = mid + 1
        else hi = mid
      }
      const lastIdx = lo - 1
      if (lastIdx >= 0) {
        const fp = opts.fundingSeries[lastIdx]!
        ctx = { fundingRate: fp.rate, premium: fp.premium }
      }
    }

    // 1. Raccogli signal da tutte le strategie compatibili + applica filtri regime + whitelist
    const signals: Array<{ strategy: StrategyDef; signal: Signal; override?: { slMul: number; tpMul: number; tier: 'hard-robust' | 'soft-robust' | 'exploratory' } }> = []
    for (const strat of compat) {
      // Strategie funding-dependent: skip se non abbiamo funding data nel backtest
      if (strat.requiresFunding && ctx.fundingRate === undefined) continue
      try {
        const s = strat.fn(buf, i, ctx)
        if (s?.direction) {
          rawSignals++
          rawByStrategy[strat.id] = (rawByStrategy[strat.id] ?? 0) + 1
          // Regime filters: ADX/RSI/ATR/time-of-day
          const rf = passesRegimeFilters({ buf, i, strategy: strat, direction: s.direction })
          if (!rf.pass) {
            const reason = rf.reason ?? 'unknown'
            skippedByRegime[reason] = (skippedByRegime[reason] ?? 0) + 1
            continue
          }
          const coinParams = getCoinStrategyParams(opts.symbol, strat.id)
          signals.push({
            strategy: strat,
            signal: { ...s, strategyId: strat.id },
            override: coinParams ? { slMul: coinParams.slMul, tpMul: coinParams.tpMul, tier: coinParams.tier } : undefined,
          })
        }
      } catch { /* ignore strat throw */ }
    }
    if (signals.length === 0) continue

    // 2. Tie-breaker identico al router live
    const longs = signals.filter(s => s.signal.direction === 'long')
    const shorts = signals.filter(s => s.signal.direction === 'short')

    let chosen: { strategy: StrategyDef; signal: Signal; override?: { slMul: number; tpMul: number; tier: 'hard-robust' | 'soft-robust' | 'exploratory' } } | null = null
    let confluence = 1
    if (longs.length > 0 && shorts.length > 0) {
      skippedConflict++
      continue
    } else if (longs.length >= 2) {
      chosen = longs.find(s => s.override) ?? longs[0]!
      confluence = longs.length
    } else if (shorts.length >= 2) {
      chosen = shorts.find(s => s.override) ?? shorts[0]!
      confluence = shorts.length
    } else {
      // single signal:
      //   1. whitelisted (coin, strategy) → trade pieno con override
      //   2. style SMC/reversal → fallback exploratory (risk dimezzato)
      //   3. altrimenti skip
      const only = signals[0]!
      if (only.override) {
        chosen = only
        confluence = 1
      } else if (HIGH_CONVICTION_STYLES.has(only.strategy.style)) {
        chosen = {
          strategy: only.strategy,
          signal: only.signal,
          override: { slMul: only.strategy.slMul, tpMul: only.strategy.tpMul, tier: 'exploratory' },
        }
        confluence = 1
      } else {
        skippedLowConviction++
        continue
      }
    }

    // 3. Pattern confluence veto
    const confluenceCheck = evaluateSignalConfluence(buf, chosen.signal.direction)
    if (confluenceCheck.verdict === 'conflict') {
      skippedPatternConflict++
      continue
    }

    // 4. ATR + sizing + simulate trade (usa override se whitelisted, altrimenti default strategia)
    const a = atr(buf, 14, i)
    if (!a || a === 0) continue
    const slMulUsed = chosen.override?.slMul ?? chosen.strategy.slMul
    const tpMulUsed = chosen.override?.tpMul ?? chosen.strategy.tpMul
    const slDist = a * slMulUsed
    const entry = candles[i]!.close
    const costInR = calcCostInR(slDist, entry, cfg.feeRate, cfg.slippageRate)
    const trade = simulateTrade(candles, i, chosen.signal.direction as Direction,
                                slMulUsed, tpMulUsed, cfg.maxBars, costInR)
    if (!trade) continue

    // Funding cost (in % notional) accumulato durante l'holding period
    let fundingPctCost = 0
    if (fundingIndex) {
      fundingPctCost = cumulativeFundingCostIndexed(fundingIndex, candles[i]!.time, trade.exitTime, chosen.signal.direction)
    }
    const fundingInR = slDist > 0 ? fundingPctCost * (entry / slDist) : 0

    // Position sizing: rischio target × scale (cap-and-resize)
    const riskBase = cfg.compounding ? balance : cfg.startingBalance
    let riskUsd = riskBase * cfg.riskPerTrade
    const sizeBase = riskUsd / slDist
    const notional = sizeBase * entry
    if (notional > cfg.maxPositionUsd) {
      const scale = cfg.maxPositionUsd / notional
      riskUsd *= scale
    }
    // Sottrai funding cost dal PnL (può essere negativo = funding income)
    const pnlUsd = (trade.rr - fundingInR) * riskUsd
    balance += pnlUsd

    accepted++
    acceptedByStrategy[chosen.strategy.id] = (acceptedByStrategy[chosen.strategy.id] ?? 0) + 1
    acceptedDirection[chosen.signal.direction]++
    confluenceDistribution[String(confluence)] = (confluenceDistribution[String(confluence)] ?? 0) + 1

    trades.push({
      time:         candles[i]!.time,
      direction:    chosen.signal.direction,
      reason:       `${chosen.signal.reason}${confluence > 1 ? ` [conf ${confluence}]` : ''}${confluenceCheck.verdict === 'align' ? ' [pattern-align]' : ''}`,
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
    busyUntilBar = i + trade.bars   // no nuovi signal finché il trade non chiude
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
    pipeline: {
      barsEvaluated,
      rawSignals,
      rawByStrategy,
      skippedConflict,
      skippedLowConviction,
      skippedPatternConflict,
      skippedPositionOpen,
      skippedByRegime,
      accepted,
      confluenceDistribution,
      acceptedByStrategy,
      acceptedDirection,
    },
  }
}
