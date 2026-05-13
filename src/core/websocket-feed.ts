// WebSocket feed Hyperliquid — sottoscrive candle per ogni coin, allMids per prezzi,
// e userFills per i fill in tempo reale. Reconnect automatico, heartbeat pong.
//
// Niente client SDK qui: connessione raw WebSocket per controllo totale del flusso.
// L'SDK @nktkas/hyperliquid è usato solo nel signing path (live-executor).

import WebSocket from 'ws'
import type { Logger } from 'pino'
import type { Candle, Fill } from '../types/trading.js'

const WS_BASE: Record<'testnet' | 'mainnet', string> = {
  testnet: 'wss://api.hyperliquid-testnet.xyz/ws',
  mainnet: 'wss://api.hyperliquid.xyz/ws',
}

export type CandleCallback = (coin: string, candle: Candle, isClose: boolean) => void
export type FillCallback = (fill: Fill) => void
export type MidsCallback = (mids: Record<string, number>) => void

export interface WsFeedDeps {
  network: 'testnet' | 'mainnet'
  userAddress?: string         // master address per userFills
  logger: Logger
  onCandle: CandleCallback
  onFill?: FillCallback
  onMids?: MidsCallback
  onConnect?: () => void
  onDisconnect?: () => void
}

export class WebSocketFeed {
  private ws: WebSocket | null = null
  private cancelled = false
  private reconnectTimer: NodeJS.Timeout | null = null
  private pingTimer: NodeJS.Timeout | null = null
  private subscriptions: Array<{ type: string; coin?: string; interval?: string; user?: string }> = []
  // Per ogni (coin, interval) tieni l'ultimo timestamp visto per detectare close
  private lastCandleTime = new Map<string, number>()

  constructor(private readonly deps: WsFeedDeps) {}

  subscribe(coin: string, interval: string): void {
    this.subscriptions.push({ type: 'candle', coin, interval })
    this.send({ method: 'subscribe', subscription: { type: 'candle', coin, interval } })
  }

  subscribeAllMids(): void {
    this.subscriptions.push({ type: 'allMids' })
    this.send({ method: 'subscribe', subscription: { type: 'allMids' } })
  }

  subscribeUserFills(): void {
    if (!this.deps.userAddress) {
      this.deps.logger.warn('[WS] no userAddress, skipping userFills subscription')
      return
    }
    this.subscriptions.push({ type: 'userFills', user: this.deps.userAddress })
    this.send({ method: 'subscribe', subscription: { type: 'userFills', user: this.deps.userAddress } })
  }

  start(): void {
    this.connect()
  }

  stop(): void {
    this.cancelled = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    if (this.pingTimer) clearInterval(this.pingTimer)
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.close()
  }

  private connect(): void {
    if (this.cancelled) return
    const url = WS_BASE[this.deps.network]
    this.deps.logger.info({ url }, '[WS] connecting')
    this.ws = new WebSocket(url)

    this.ws.on('open', () => {
      this.deps.logger.info('[WS] connected')
      this.deps.onConnect?.()
      // Re-subscribe a tutto
      for (const sub of this.subscriptions) {
        this.send({ method: 'subscribe', subscription: sub })
      }
      this.pingTimer = setInterval(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.send(JSON.stringify({ method: 'ping' }))
        }
      }, 30000)
    })

    this.ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString())
        this.handleMessage(msg)
      } catch (err) {
        this.deps.logger.warn({ err: String(err) }, '[WS] parse error')
      }
    })

    this.ws.on('close', () => {
      if (this.pingTimer) { clearInterval(this.pingTimer); this.pingTimer = null }
      if (!this.cancelled) {
        this.deps.logger.warn('[WS] disconnected, reconnect in 3s')
        this.deps.onDisconnect?.()
        this.reconnectTimer = setTimeout(() => this.connect(), 3000)
      }
    })

    this.ws.on('error', (err) => {
      this.deps.logger.error({ err: String(err) }, '[WS] error')
    })
  }

  private send(payload: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(payload))
    }
  }

  private handleMessage(msg: { channel?: string; data?: unknown }): void {
    if (msg.channel === 'candle' && msg.data) {
      const k = msg.data as { t: number; o: string; h: string; l: string; c: string; v?: string; s: string; i: string }
      const candle: Candle = {
        time: Math.floor(k.t / 1000),
        open: parseFloat(k.o),
        high: parseFloat(k.h),
        low: parseFloat(k.l),
        close: parseFloat(k.c),
        volume: parseFloat(k.v ?? '0'),
      }
      const key = `${k.s}:${k.i}`
      const prevTs = this.lastCandleTime.get(key) ?? 0
      // Close = quando vediamo una candela con timestamp > precedente (nuova bar)
      const isClose = candle.time > prevTs
      if (isClose && prevTs > 0) {
        // Il segnale è valutato sulla candela appena chiusa (prevTs), non sulla nuova
        // ma HL invia solo l'aggiornamento running della candela attuale.
        // Strategia: notifichiamo isClose=true ad ogni transizione di time.
      }
      this.lastCandleTime.set(key, candle.time)
      this.deps.onCandle(k.s, candle, isClose)
    } else if (msg.channel === 'allMids' && msg.data) {
      const mids = (msg.data as { mids?: Record<string, string> }).mids ?? {}
      const parsed: Record<string, number> = {}
      for (const [coin, val] of Object.entries(mids)) {
        const v = parseFloat(val)
        if (!Number.isNaN(v)) parsed[coin] = v
      }
      this.deps.onMids?.(parsed)
    } else if (msg.channel === 'userFills' && msg.data) {
      const fillsData = msg.data as { fills?: Array<{ coin: string; side: string; px: string; sz: string; fee: string; oid: number; time: number; closedPnl?: string }> }
      for (const f of fillsData.fills ?? []) {
        const fill: Fill = {
          orderId: String(f.oid),
          ts: f.time,
          coin: f.coin,
          direction: f.side === 'B' ? 'long' : 'short',
          size: parseFloat(f.sz),
          price: parseFloat(f.px),
          fee: parseFloat(f.fee),
          pnl: f.closedPnl ? parseFloat(f.closedPnl) : undefined,
          isClose: f.closedPnl !== undefined && f.closedPnl !== '0.0',
        }
        this.deps.onFill?.(fill)
      }
    }
  }
}
