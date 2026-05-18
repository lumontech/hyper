// Signal Router — il cervello del bot.
// Ad ogni candle close: itera tutte le strategie abilitate compatibili con la coin,
// raccoglie segnali, applica tie-breaker (consenso, anti-conflitto), e chiama il live-executor.
//
// Regole consenso (replicate da docs/STRATEGIES.md):
// - 2+ strategie stessa direzione → execute (la prima firma decide il sizing, le altre confluenza)
// - 2+ strategie direzioni opposte → SKIP (mercato indeciso)
// - 1 sola strategia → execute solo se WR atteso ≥ 60% e strategy.style ∈ {smc, reversal}
//                     altrimenti skip (filtro qualità)

import type { Logger } from 'pino'
import type { Config } from '../utils/config.js'
import type { Candle, Signal, StrategyDef, StrategyContext } from '../types/trading.js'
import type { LiveExecutor } from '../engine/live-executor.js'
import type { PositionManager } from '../engine/position-manager.js'
import type { EventsCalendar } from '../strategy/events-calendar.js'
import type { LiveFundingPoller } from '../core/funding-history.js'
import { atr } from '../strategy/indicators.js'
import { isStrategyCompatibleWithCoin } from '../strategy/strategy-registry.js'
import { evaluateSignalConfluence } from '../strategy/patterns.js'
import { passesRegimeFilters } from '../strategy/regime-filters.js'
import { getCoinStrategyParams } from '../strategy/coin-params.js'

const HIGH_CONVICTION_STYLES = new Set(['smc', 'reversal'])

export interface SignalRouterDeps {
  config: Config
  logger: Logger
  executor: LiveExecutor
  positions: PositionManager
  strategies: StrategyDef[]
  events?: EventsCalendar
  fundingPoller?: LiveFundingPoller
}

export interface RouterStats {
  lastEvaluatedAt: number
  signalsGenerated: number
  ordersAttempted: number
  ordersAccepted: number
  ordersRejected: number
  evaluationsRun: number
  evaluationsByCoin: Record<string, number>
  strategyInvocations: Record<string, number>   // strategy.id → tot invocazioni
  strategySignals: Record<string, number>       // strategy.id → tot signal non-null
  skippedByRegime: Record<string, number>       // motivo regime-filter → count
  lastSignals: Array<{ ts: number; coin: string; strategy: string; direction: string; reason: string; status: string }>
}

export class SignalRouter {
  private candleBuffers = new Map<string, Candle[]>()    // coin → array di candele
  private stats: RouterStats = {
    lastEvaluatedAt: 0,
    signalsGenerated: 0,
    ordersAttempted: 0,
    ordersAccepted: 0,
    ordersRejected: 0,
    evaluationsRun: 0,
    evaluationsByCoin: {},
    strategyInvocations: {},
    strategySignals: {},
    skippedByRegime: {},
    lastSignals: [],
  }

  constructor(private readonly deps: SignalRouterDeps) {}

  /** Bootstrap del buffer con candele storiche fetched al boot. */
  primeBuffer(coin: string, candles: Candle[]): void {
    this.candleBuffers.set(coin, [...candles])
    this.deps.logger.info({ coin, n: candles.length }, '[ROUTER] primed buffer')
  }

  /**
   * Append della candela appena chiusa al buffer e valutazione strategie.
   * isClose: true quando arriva la prima notifica della candela successiva (chiusura della corrente).
   */
  async onCandle(coin: string, candle: Candle, isClose: boolean): Promise<void> {
    let buf = this.candleBuffers.get(coin)
    if (!buf) {
      buf = []
      this.candleBuffers.set(coin, buf)
    }

    // Update running candle o append nuova
    const last = buf[buf.length - 1]
    if (last && last.time === candle.time) {
      buf[buf.length - 1] = candle  // running update
    } else {
      buf.push(candle)
      if (buf.length > 1000) buf.shift()  // cap memoria
    }

    // Strategie valutate SOLO su close di una nuova candela
    if (!isClose) return
    // Evita evaluation se abbiamo già un'open position su questa coin
    if (this.deps.positions.get(coin)) return

    await this.evaluate(coin)
  }

  private async evaluate(coin: string): Promise<void> {
    const fullBuf = this.candleBuffers.get(coin)
    if (!fullBuf || fullBuf.length < 51) return

    // CRITICAL FIX: quando isClose=true il WS ci ha appena dato la NUOVA bar appena aperta
    // (open=high=low=close = primo tick). La bar appena CHIUSA è fullBuf[length-2].
    // Trimmiamo il buffer escludendo la bar parziale per evitare contaminazione di indicatori
    // e pattern recognition (che leggono buf[buf.length-1] implicitamente).
    const buf = fullBuf.slice(0, fullBuf.length - 1)
    const lastIdx = buf.length - 1
    if (lastIdx < 50) return
    // Build StrategyContext una volta per coin (funding rate live)
    const ctx: StrategyContext = this.deps.fundingPoller
      ? { ...this.deps.fundingPoller.contextFor(coin) }
      : {}

    const signals: Array<{ strategy: StrategyDef; signal: Signal; override?: { slMul: number; tpMul: number; tier: 'hard-robust' | 'soft-robust' | 'exploratory' } }> = []
    for (const strat of this.deps.strategies) {
      if (!isStrategyCompatibleWithCoin(strat, coin)) continue
      // Strategie funding-dependent: skip se non abbiamo funding data
      if (strat.requiresFunding && ctx.fundingRate === undefined) continue
      // Coin-strategy whitelist: solo combo robuste dal walk-forward sono autorizzate.
      const coinParams = getCoinStrategyParams(coin, strat.id)
      this.stats.strategyInvocations[strat.id] = (this.stats.strategyInvocations[strat.id] ?? 0) + 1
      try {
        const s = strat.fn(buf, lastIdx, ctx)
        if (s?.direction) {
          // Regime filters (ADX, RSI extreme, ATR floor, time-of-day) — uguale al backtest
          const rf = passesRegimeFilters({ buf, i: lastIdx, strategy: strat, direction: s.direction })
          if (!rf.pass) {
            const reason = rf.reason ?? 'unknown'
            this.stats.skippedByRegime[reason] = (this.stats.skippedByRegime[reason] ?? 0) + 1
            continue
          }
          // Strategie non whitelisted vengono raccolte SOLO per confluence (non possono firmare da sole)
          signals.push({
            strategy: strat,
            signal: { ...s, strategyId: strat.id },
            override: coinParams ? { slMul: coinParams.slMul, tpMul: coinParams.tpMul, tier: coinParams.tier } : undefined,
          })
          this.stats.strategySignals[strat.id] = (this.stats.strategySignals[strat.id] ?? 0) + 1
        }
      } catch (err) {
        this.deps.logger.warn({ coin, strategy: strat.id, err: String(err) }, '[ROUTER] strategy threw')
      }
    }

    this.stats.lastEvaluatedAt = Date.now()
    this.stats.evaluationsRun++
    this.stats.evaluationsByCoin[coin] = (this.stats.evaluationsByCoin[coin] ?? 0) + 1
    if (signals.length === 0) return

    this.stats.signalsGenerated += signals.length
    this.deps.logger.info({ coin, n: signals.length, signals: signals.map(s => `${s.strategy.id}:${s.signal.direction}`) }, '[ROUTER] signals')

    // Tie-breaker
    const longs = signals.filter(s => s.signal.direction === 'long')
    const shorts = signals.filter(s => s.signal.direction === 'short')

    let chosen: { strategy: StrategyDef; signal: Signal; override?: { slMul: number; tpMul: number; tier: 'hard-robust' | 'soft-robust' | 'exploratory' } } | null = null
    let confluence = 1
    if (longs.length > 0 && shorts.length > 0) {
      this.recordSignal(coin, signals[0]!.strategy.id, signals[0]!.signal.direction, signals[0]!.signal.reason, 'skipped:conflict')
      this.deps.logger.warn({ coin, longs: longs.length, shorts: shorts.length }, '[ROUTER] conflict, skipping')
      return
    } else if (longs.length >= 2) {
      // Confluence ≥2: preferisci la combo whitelisted (con override) come "leader" del sizing
      chosen = longs.find(s => s.override) ?? longs[0]!
      confluence = longs.length
    } else if (shorts.length >= 2) {
      chosen = shorts.find(s => s.override) ?? shorts[0]!
      confluence = shorts.length
    } else {
      // single signal — gerarchia:
      //   1. (coin, strategy) whitelisted dal walk-forward → trade pieno
      //   2. style ∈ HIGH_CONVICTION_STYLES (smc, reversal) → fallback exploratory (risk 0.5%)
      //   3. altrimenti skip
      const only = signals[0]!
      if (only.override) {
        chosen = only
        confluence = 1
      } else if (HIGH_CONVICTION_STYLES.has(only.strategy.style)) {
        // Fallback: SMC/reversal "qualified" anche senza whitelist, ma con risk dimezzato
        chosen = {
          strategy: only.strategy,
          signal: only.signal,
          override: { slMul: only.strategy.slMul, tpMul: only.strategy.tpMul, tier: 'exploratory' },
        }
        confluence = 1
      } else {
        this.recordSignal(coin, only.strategy.id, only.signal.direction, only.signal.reason, 'skipped:low-conviction')
        return
      }
    }

    // Calcola ATR per sizing
    const atrVal = atr(buf, this.deps.config.atrPeriod, lastIdx)
    const markPrice = buf[lastIdx]!.close
    if (!atrVal || atrVal <= 0) {
      this.recordSignal(coin, chosen.strategy.id, chosen.signal.direction, chosen.signal.reason, 'skipped:atr-zero')
      return
    }

    // No-trade window: skip se siamo entro ±30min da evento high impact su coin
    if (this.deps.events) {
      const guard = this.deps.events.isInNoTradeWindow(coin, 30)
      if (guard.blocked && guard.event) {
        this.recordSignal(coin, chosen.strategy.id, chosen.signal.direction, chosen.signal.reason, `skipped:event-${guard.event.id}`)
        this.deps.logger.warn({ coin, event: guard.event.title }, '[ROUTER] no-trade window event')
        return
      }
    }

    // Pattern confluence: veto se pattern dominante è opposto al signal
    const confluenceCheck = evaluateSignalConfluence(buf, chosen.signal.direction)
    if (confluenceCheck.verdict === 'conflict') {
      this.recordSignal(coin, chosen.strategy.id, chosen.signal.direction,
        `${chosen.signal.reason} | pattern conflict (${confluenceCheck.summary.dominantBias})`,
        'skipped:pattern-conflict')
      this.deps.logger.warn({ coin, dominantBias: confluenceCheck.summary.dominantBias }, '[ROUTER] pattern conflict, skipping')
      return
    }
    const patternBoost = confluenceCheck.verdict === 'align' ? ' [pattern-align]' : ''

    this.stats.ordersAttempted++
    // Passa override slMul/tpMul all'executor se la coppia è whitelisted
    const result = await this.deps.executor.execute(chosen.signal, coin, atrVal, markPrice, chosen.override)
    if (result.ok) {
      this.stats.ordersAccepted++
      const reasonLabel = `${chosen.signal.reason}${confluence > 1 ? ` [confluence ${confluence}]` : ''}${patternBoost}`
      this.recordSignal(coin, chosen.strategy.id, chosen.signal.direction, reasonLabel, `accepted:${result.orderId}`)
    } else {
      this.stats.ordersRejected++
      this.recordSignal(coin, chosen.strategy.id, chosen.signal.direction, chosen.signal.reason, `rejected:${result.reason}`)
    }
  }

  private recordSignal(coin: string, strategy: string, direction: string, reason: string, status: string): void {
    this.stats.lastSignals.unshift({ ts: Date.now(), coin, strategy, direction, reason, status })
    if (this.stats.lastSignals.length > 50) this.stats.lastSignals.pop()
  }

  snapshot(): RouterStats {
    return { ...this.stats, lastSignals: [...this.stats.lastSignals] }
  }
}
