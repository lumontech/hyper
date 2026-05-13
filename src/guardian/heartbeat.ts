// Heartbeat — monitora se il feed prezzi è vivo per ogni coin attiva.
// Se un coin non riceve tick da > timeoutSec → trigger flatten di quella coin.

import type { Logger } from 'pino'

export interface HeartbeatDeps {
  coins: string[]
  timeoutSec: number
  logger: Logger
  onStale: (coin: string, lastSeenAgoMs: number) => Promise<void>
}

export class Heartbeat {
  private lastTick = new Map<string, number>()
  private timer: NodeJS.Timeout | null = null
  private triggered = new Set<string>()

  constructor(private readonly deps: HeartbeatDeps) {
    for (const c of deps.coins) this.lastTick.set(c, Date.now())
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.check(), 1000)
    this.deps.logger.info({ coins: this.deps.coins, timeoutSec: this.deps.timeoutSec }, '[HEART] started')
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  onTick(coin: string): void {
    this.lastTick.set(coin, Date.now())
    if (this.triggered.has(coin)) {
      this.triggered.delete(coin)
      this.deps.logger.info({ coin }, '[HEART] feed recovered')
    }
  }

  private check(): void {
    const now = Date.now()
    const timeoutMs = this.deps.timeoutSec * 1000
    for (const coin of this.deps.coins) {
      const t = this.lastTick.get(coin) ?? 0
      const age = now - t
      if (age > timeoutMs && !this.triggered.has(coin)) {
        this.triggered.add(coin)
        this.deps.logger.error({ coin, ageMs: age }, '[HEART] stale feed, triggering onStale')
        this.deps.onStale(coin, age).catch(err => {
          this.deps.logger.error({ coin, err: String(err) }, '[HEART] onStale failed')
        })
      }
    }
  }

  snapshot() {
    const now = Date.now()
    return Object.fromEntries(
      [...this.lastTick.entries()].map(([c, t]) => [c, { lastSeenMsAgo: now - t, stale: this.triggered.has(c) }]),
    )
  }
}
