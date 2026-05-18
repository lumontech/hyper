// Hyperliquid client — wrapper sopra @nktkas/hyperliquid.
// Modalità info-only fino a quando l'API key non è configurata. NON firma a vuoto.

import type { Logger } from 'pino'
import type { Config } from '../utils/config.js'
import type { Candle, OrderRequest } from '../types/trading.js'

// Mappa simboli interni → coin Hyperliquid
export const COIN_MAP: Record<string, string> = {
  BTC: 'BTC', BTCUSDC: 'BTC',
  ETH: 'ETH', ETHUSDC: 'ETH',
  SOL: 'SOL', SOLUSDC: 'SOL',
  XRP: 'XRP', XRPUSDC: 'XRP',
  BNB: 'BNB', BNBUSDC: 'BNB',
  HYPE: 'HYPE',
  SUI: 'SUI',
  AVAX: 'AVAX',
  DOGE: 'DOGE',
  AAVE: 'AAVE',
}

// TF interno → label HL
export const TF_MAP: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m',
  '1h': '1h', '4h': '4h', '1D': '1d',
}

const HL_API_BASE: Record<'testnet' | 'mainnet', string> = {
  testnet: 'https://api.hyperliquid-testnet.xyz',
  mainnet: 'https://api.hyperliquid.xyz',
}

const HL_WS_BASE: Record<'testnet' | 'mainnet', string> = {
  testnet: 'wss://api.hyperliquid-testnet.xyz/ws',
  mainnet: 'wss://api.hyperliquid.xyz/ws',
}

export interface HyperliquidClientDeps {
  config: Config
  logger: Logger
}

/**
 * Client Hyperliquid. Tre modalità:
 *   - info-only: fetch candles/ticker, no signing. Default se mancano le chiavi.
 *   - dry-run: signing dei payload ma NON invio (audit log only). Da usare prima del mainnet.
 *   - live: signing + invio.
 *
 * Lo switch è guidato da config.dryRun e dalla presenza di apiPrivateKey.
 */
export class HyperliquidClient {
  private readonly apiBase: string
  private readonly wsBase: string
  private readonly canSign: boolean

  constructor(private readonly deps: HyperliquidClientDeps) {
    this.apiBase = HL_API_BASE[deps.config.network]
    this.wsBase = HL_WS_BASE[deps.config.network]
    this.canSign = Boolean(deps.config.apiPrivateKey && deps.config.apiWalletAddress)
    if (!this.canSign) {
      deps.logger.warn('[HL] API key not configured — info-only mode. No orders can be sent.')
    }
    deps.logger.info({ network: deps.config.network, dryRun: deps.config.dryRun, canSign: this.canSign }, '[HL] client initialized')
  }

  get wsUrl(): string {
    return this.wsBase
  }

  /** Fetch candles via /info endpoint. Auto-paginazione se limit > 5000 (HL hard cap per call). */
  async fetchCandles(coin: string, interval: string, limit = 500): Promise<Candle[]> {
    const hlCoin = COIN_MAP[coin]
    if (!hlCoin) throw new Error(`Unknown coin: ${coin}`)
    const tf = TF_MAP[interval]
    if (!tf) throw new Error(`Unknown interval: ${interval}`)
    const tfSec: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }
    const sec = tfSec[tf] ?? 3600

    const CHUNK = 5000   // HL massimo per chiamata
    const endTime = Date.now()
    const startTime = endTime - limit * sec * 1000

    // Single-call se entro il limite
    if (limit <= CHUNK) return this.fetchCandleChunk(hlCoin, tf, startTime, endTime)

    // Paginazione: HL ignora startTime se troppo lontano e ritorna le ULTIME 5000 candele.
    // Quindi paginiamo all'indietro: cursore = endTime, scende ogni iterazione.
    const collected: Candle[] = []
    let cursorEnd = endTime
    const oldestNeeded = startTime
    const maxIterations = Math.ceil(limit / CHUNK) + 2
    for (let iter = 0; iter < maxIterations; iter++) {
      const chunkStart = Math.max(cursorEnd - CHUNK * sec * 1000, oldestNeeded)
      const part = await this.fetchCandleChunk(hlCoin, tf, chunkStart, cursorEnd)
      if (part.length === 0) break
      // Prepend del chunk (sono cronologici ascendenti); dedup su time
      for (let i = part.length - 1; i >= 0; i--) {
        const c = part[i]!
        if (collected.length === 0 || c.time < collected[0]!.time) collected.unshift(c)
      }
      // Se HL ha ritornato meno di CHUNK candele, abbiamo raggiunto il bordo
      if (part.length < CHUNK) break
      // Avanza cursor all'inizio del chunk appena ricevuto (-1s per evitare duplicati)
      const oldestInChunk = part[0]!.time * 1000
      if (oldestInChunk <= oldestNeeded) break
      cursorEnd = oldestInChunk - 1
      await new Promise(r => setTimeout(r, 120))
    }
    return collected
  }

  private async fetchCandleChunk(hlCoin: string, tf: string, startTime: number, endTime: number): Promise<Candle[]> {
    const body = {
      type: 'candleSnapshot',
      req: { coin: hlCoin, interval: tf, startTime, endTime },
    }
    const res = await fetch(`${this.apiBase}/info`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) throw new Error(`HL /info ${res.status}: ${await res.text()}`)
    const data = (await res.json()) as Array<{ t: number; o: string; h: string; l: string; c: string; v?: string }>
    if (!Array.isArray(data)) throw new Error('HL: unexpected response shape')
    return data.map(k => ({
      time: Math.floor(k.t / 1000),
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v ?? '0'),
    }))
  }

  /** Stub: place order. Implementazione completa nello Sprint 3 (signing path con viem). */
  async placeOrder(_req: OrderRequest): Promise<{ ok: boolean; reason?: string; orderId?: string }> {
    if (!this.canSign) {
      return { ok: false, reason: 'API key not configured' }
    }
    if (this.deps.config.dryRun) {
      this.deps.logger.info({ req: _req }, '[HL][DRY] would place order')
      return { ok: true, orderId: `dry-${Date.now()}` }
    }
    // TODO Sprint 3: integrazione @nktkas/hyperliquid ExchangeClient + viem signer
    throw new Error('Live signing not implemented yet — set EXEC_DRY_RUN=true')
  }

  /** Stub: cancel + flatten. Sprint 3. */
  async emergencyFlatten(): Promise<void> {
    this.deps.logger.warn('[HL] emergencyFlatten() called — not yet implemented')
    // TODO Sprint 3
  }
}
