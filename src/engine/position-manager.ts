// Position Manager — tiene traccia di SL/TP per ogni posizione aperta.
// Hyperliquid supporta TP/SL nativi (trigger orders) ma li gestiamo ANCHE lato bot
// come failsafe: se il mark price tocca SL/TP e non c'è stato fill in 5s → forza chiusura.

import type { Logger } from 'pino'
import type { Direction } from '../types/trading.js'

export interface TrackedPosition {
  coin: string
  direction: Direction
  entryPrice: number
  size: number
  stopLoss: number
  takeProfit: number
  strategyId: string
  openedAt: number
}

export interface PositionManagerDeps {
  logger: Logger
  onForceClose: (coin: string, reason: string) => Promise<void>
  /** ms tolleranza dopo aver toccato SL/TP prima di forzare chiusura via market. */
  graceMs?: number
}

export class PositionManager {
  private positions = new Map<string, TrackedPosition>()  // key: coin
  /** Per ogni coin, timestamp del primo "tocco" di SL/TP non ancora soddisfatto. */
  private touchedAt = new Map<string, { ts: number; reason: string }>()
  private readonly graceMs: number

  constructor(private readonly deps: PositionManagerDeps) {
    this.graceMs = deps.graceMs ?? 5000
  }

  track(p: TrackedPosition): void {
    this.positions.set(p.coin, p)
    this.touchedAt.delete(p.coin)
    this.deps.logger.info({ coin: p.coin, dir: p.direction, sl: p.stopLoss, tp: p.takeProfit }, '[POS] tracking')
  }

  untrack(coin: string): void {
    this.positions.delete(coin)
    this.touchedAt.delete(coin)
    this.deps.logger.info({ coin }, '[POS] untracked')
  }

  list(): TrackedPosition[] {
    return [...this.positions.values()]
  }

  get(coin: string): TrackedPosition | undefined {
    return this.positions.get(coin)
  }

  /**
   * Da chiamare ad ogni tick di mid price per ogni coin con posizione attiva.
   * Se mark tocca SL/TP, avvia il grace timer. Allo scadere forza la chiusura.
   */
  onMid(coin: string, mid: number): void {
    const p = this.positions.get(coin)
    if (!p) return

    let triggered: 'sl' | 'tp' | null = null
    if (p.direction === 'long') {
      if (mid <= p.stopLoss) triggered = 'sl'
      else if (mid >= p.takeProfit) triggered = 'tp'
    } else {
      if (mid >= p.stopLoss) triggered = 'sl'
      else if (mid <= p.takeProfit) triggered = 'tp'
    }

    if (triggered) {
      const existing = this.touchedAt.get(coin)
      if (!existing) {
        this.touchedAt.set(coin, { ts: Date.now(), reason: triggered })
        this.deps.logger.warn({ coin, mid, sl: p.stopLoss, tp: p.takeProfit, triggered }, '[POS] SL/TP touched, grace timer started')
      } else if (Date.now() - existing.ts >= this.graceMs) {
        // Grace scaduta — forza chiusura
        this.deps.logger.error({ coin, reason: existing.reason, sinceMs: Date.now() - existing.ts }, '[POS] grace expired, force closing')
        this.touchedAt.delete(coin)
        this.deps.onForceClose(coin, `failsafe-${existing.reason}`).catch(err => {
          this.deps.logger.error({ err: String(err) }, '[POS] force close failed')
        })
      }
    } else {
      // Mid è uscito dalla zona SL/TP → reset grace
      if (this.touchedAt.has(coin)) {
        this.touchedAt.delete(coin)
        this.deps.logger.info({ coin }, '[POS] grace timer cleared (price moved away)')
      }
    }
  }
}
