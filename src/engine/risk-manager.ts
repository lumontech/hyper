// Risk Manager — l'ultima linea di difesa prima di firmare un ordine.
// I limiti hard-coded sotto sono SOPRA quelli di .env: anche se l'env è compromesso,
// questi clamp limitano il danno. Modificarli richiede una PR esplicita al codice.

import type { Logger } from 'pino'
import type { Config } from '../utils/config.js'
import type { OrderRequest, AccountState, RiskCheckResult } from '../types/trading.js'

// ──────────────────────────────────────────────────────────────────
// HARD LIMITS — DO NOT TOUCH WITHOUT REVIEW
// ──────────────────────────────────────────────────────────────────
const HARD = {
  MAX_LEVERAGE: 5,                       // mai oltre 5x anche se env dice di più
  MAX_DAILY_LOSS_PCT: 5.0,               // halt auto a 5% loss giornaliero
  MIN_TIME_BETWEEN_ORDERS_MS: 500,
  MAX_NOTIONAL_PER_TRADE_USD: 5000,
  MAX_TOTAL_NOTIONAL_USD: 20000,
  MAX_OPEN_POSITIONS: 10,
  MIN_FREE_MARGIN_USD: 10,
}

export interface RiskManagerDeps {
  config: Config
  logger: Logger
}

export interface RiskState {
  equityStartOfDay: number
  dailyPnlUsd: number
  lastOrderAtMs: number
  ruinTriggered: boolean
  startingBalance: number   // first observed equity, snapshot at boot
  /** Equity simulato per modalità DRY_RUN (parte da startingBalance, aggiornato dai fill sintetici). */
  demoEquity: number
  demoTrades: number
  demoWins: number
  demoLosses: number
}

export class RiskManager {
  private state: RiskState = {
    equityStartOfDay: 0,
    dailyPnlUsd: 0,
    lastOrderAtMs: 0,
    ruinTriggered: false,
    startingBalance: 0,
    demoEquity: 0,
    demoTrades: 0,
    demoWins: 0,
    demoLosses: 0,
  }

  constructor(private readonly deps: RiskManagerDeps) {}

  initializeFromAccount(account: AccountState): void {
    this.state.equityStartOfDay = account.equityUsd
    this.state.startingBalance = account.equityUsd
    this.state.demoEquity = account.equityUsd
    this.deps.logger.info({ equity: account.equityUsd, demoEquity: this.state.demoEquity }, '[RISK] initialized')
  }

  /** Da chiamare ogni UTC midnight */
  rolloverDay(currentEquity: number): void {
    this.state.equityStartOfDay = currentEquity
    this.state.dailyPnlUsd = 0
    this.deps.logger.info({ equity: currentEquity }, '[RISK] daily rollover')
  }

  recordFillPnl(pnlUsd: number): void {
    this.state.dailyPnlUsd += pnlUsd
  }

  /** Demo fill (dry-run): aggiorna equity simulato + stats. */
  recordDemoFill(pnlUsd: number): void {
    this.state.demoEquity += pnlUsd
    this.state.dailyPnlUsd += pnlUsd
    this.state.demoTrades += 1
    if (pnlUsd > 0) this.state.demoWins += 1
    else if (pnlUsd < 0) this.state.demoLosses += 1
  }

  /** Equity corrente da usare per sizing: demo in dry-run, reale altrimenti. */
  effectiveEquity(): number {
    return this.deps.config.dryRun ? this.state.demoEquity : this.state.startingBalance
  }

  /** Effective limits: min(env_value, hard_limit) */
  private effectiveLimits() {
    const c = this.deps.config
    return {
      maxLeverage:         Math.min(c.maxLeverage, HARD.MAX_LEVERAGE),
      maxDailyLossPct:     Math.min(c.maxDailyLossPct, HARD.MAX_DAILY_LOSS_PCT),
      maxPositionUsd:      Math.min(c.maxPositionUsd, HARD.MAX_NOTIONAL_PER_TRADE_USD),
      maxTotalExposureUsd: Math.min(c.maxTotalExposureUsd, HARD.MAX_TOTAL_NOTIONAL_USD),
      maxOpenPositions:    Math.min(c.maxOpenPositions, HARD.MAX_OPEN_POSITIONS),
      minTimeBetweenMs:    Math.max(c.minTimeBetweenOrdersMs, HARD.MIN_TIME_BETWEEN_ORDERS_MS),
      ruinThresholdPct:    c.ruinThresholdPct,
      riskPerTradePct:     c.riskPerTradePct,
    }
  }

  /** Core check. Tutti i limiti devono passare. */
  shouldAllowOrder(
    order: OrderRequest,
    account: AccountState,
    notionalUsd: number,
  ): RiskCheckResult {
    const L = this.effectiveLimits()

    if (this.state.ruinTriggered) {
      return { allow: false, reason: 'RUIN_TRIGGERED' }
    }

    // Time between orders
    const now = Date.now()
    if (now - this.state.lastOrderAtMs < L.minTimeBetweenMs) {
      return { allow: false, reason: 'RATE_LIMITED' }
    }

    // Daily loss
    if (this.state.equityStartOfDay > 0) {
      const lossPct = -100 * this.state.dailyPnlUsd / this.state.equityStartOfDay
      if (lossPct >= L.maxDailyLossPct) {
        return { allow: false, reason: `DAILY_LOSS_LIMIT (${lossPct.toFixed(2)}% >= ${L.maxDailyLossPct}%)` }
      }
    }

    // Ruin
    if (this.state.startingBalance > 0) {
      const equityPctOfStart = 100 * account.equityUsd / this.state.startingBalance
      if (equityPctOfStart < (100 - L.ruinThresholdPct)) {
        this.state.ruinTriggered = true
        return { allow: false, reason: `RUIN_THRESHOLD (${equityPctOfStart.toFixed(1)}% < ${100 - L.ruinThresholdPct}%)` }
      }
    }

    // Free margin
    if (account.freeMarginUsd < HARD.MIN_FREE_MARGIN_USD) {
      return { allow: false, reason: 'INSUFFICIENT_FREE_MARGIN' }
    }

    // Per-trade notional
    if (notionalUsd > L.maxPositionUsd) {
      return { allow: false, reason: `POSITION_TOO_LARGE (${notionalUsd.toFixed(0)} > ${L.maxPositionUsd})` }
    }

    // Total exposure
    if (account.totalNotionalUsd + notionalUsd > L.maxTotalExposureUsd) {
      return { allow: false, reason: `EXPOSURE_LIMIT (${(account.totalNotionalUsd + notionalUsd).toFixed(0)} > ${L.maxTotalExposureUsd})` }
    }

    // Concurrent positions
    if (account.positions.length >= L.maxOpenPositions) {
      return { allow: false, reason: `MAX_OPEN_POSITIONS (${account.positions.length})` }
    }

    // Already open on this coin? Allow only if same direction & adding (configurable, default no pyramid)
    const existing = account.positions.find(p => p.coin === order.coin)
    if (existing) {
      return { allow: false, reason: `ALREADY_OPEN_${order.coin}` }
    }

    // Leverage implicit check
    const impliedLeverage = notionalUsd / Math.max(account.freeMarginUsd, 1)
    if (impliedLeverage > L.maxLeverage) {
      return { allow: false, reason: `LEVERAGE_TOO_HIGH (${impliedLeverage.toFixed(1)}x > ${L.maxLeverage}x)` }
    }

    return { allow: true, reason: null }
  }

  markOrderSent(): void {
    this.state.lastOrderAtMs = Date.now()
  }

  /** Per /status endpoint */
  snapshot() {
    return {
      ...this.state,
      effectiveLimits: this.effectiveLimits(),
      hardLimits: HARD,
    }
  }
}
