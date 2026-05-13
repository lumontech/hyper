// Circuit Breakers — controlli periodici. Se uno scatta, crea .HALT.

import { writeFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Logger } from 'pino'
import type { AccountStateService } from '../core/account-state.js'
import type { RiskManager } from '../engine/risk-manager.js'

const HALT_FILE = resolve('.HALT')

export interface CircuitBreakersDeps {
  account: AccountStateService
  risk: RiskManager
  logger: Logger
  startingEquity: number
  ruinThresholdPct: number              // es. 50 → halt se equity < 50% start
  maxDailyLossPct: number               // es. 5 → halt se daily PnL < -5%
  intervalMs?: number
}

export class CircuitBreakers {
  private timer: NodeJS.Timeout | null = null
  private equityStartOfDay: number
  private dayKey: string

  constructor(private readonly deps: CircuitBreakersDeps) {
    this.equityStartOfDay = deps.startingEquity
    this.dayKey = new Date().toISOString().slice(0, 10)
  }

  start(): void {
    if (this.timer) return
    const ms = this.deps.intervalMs ?? 5000
    this.timer = setInterval(() => this.check(), ms)
    this.deps.logger.info({ intervalMs: ms, ruin: this.deps.ruinThresholdPct, daily: this.deps.maxDailyLossPct }, '[CB] started')
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private check(): void {
    const acct = this.deps.account.current()
    if (!acct) return

    // Daily rollover
    const today = new Date().toISOString().slice(0, 10)
    if (today !== this.dayKey) {
      this.dayKey = today
      this.equityStartOfDay = acct.equityUsd
      this.deps.risk.rolloverDay(acct.equityUsd)
      this.deps.logger.info({ equity: acct.equityUsd }, '[CB] daily rollover')
    }

    // Ruin
    const ruinFloor = this.deps.startingEquity * (1 - this.deps.ruinThresholdPct / 100)
    if (acct.equityUsd < ruinFloor) {
      this.trip(`RUIN: equity ${acct.equityUsd.toFixed(2)} < floor ${ruinFloor.toFixed(2)}`)
      return
    }

    // Daily loss
    if (this.equityStartOfDay > 0) {
      const dailyLossPct = -100 * (acct.equityUsd - this.equityStartOfDay) / this.equityStartOfDay
      if (dailyLossPct >= this.deps.maxDailyLossPct) {
        this.trip(`DAILY_LOSS: ${dailyLossPct.toFixed(2)}% >= ${this.deps.maxDailyLossPct}%`)
        return
      }
    }
  }

  private trip(reason: string): void {
    if (existsSync(HALT_FILE)) return
    writeFileSync(HALT_FILE, `Circuit breaker tripped: ${reason} @ ${new Date().toISOString()}`)
    this.deps.logger.error({ reason }, '[CB] HALT tripped')
  }
}
