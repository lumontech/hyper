// Live Executor — calcola size dinamico, sottopone al risk-manager, firma e invia.
// In dryRun NON firma: logga payload come se fosse stato inviato, salva in DB con dry_run=1.
//
// Signing path: viem privateKeyToAccount → @nktkas/hyperliquid ExchangeClient.
// L'import dell'SDK è dinamico per non rompere boot in dev quando le dipendenze non sono installate.

import type { Logger } from 'pino'
import type { Config } from '../utils/config.js'
import type { HyperliquidClient } from '../core/hyperliquid-client.js'
import type { AccountStateService } from '../core/account-state.js'
import type { RiskManager } from '../engine/risk-manager.js'
import type { PositionManager } from '../engine/position-manager.js'
import type { BotDb } from '../persistence/db.js'
import type { AuditLog } from '../persistence/audit-log.js'
import type { Signal, OrderRequest } from '../types/trading.js'

export interface LiveExecutorDeps {
  config: Config
  logger: Logger
  client: HyperliquidClient
  account: AccountStateService
  risk: RiskManager
  positions: PositionManager
  db: BotDb
  audit: AuditLog
}

export class LiveExecutor {
  private exchangeClient: unknown = null

  constructor(private readonly deps: LiveExecutorDeps) {}

  /**
   * Lazy init dell'SDK — solo se davvero serve firmare e abbiamo le chiavi.
   */
  private async initExchange(): Promise<unknown> {
    if (this.exchangeClient) return this.exchangeClient
    if (!this.deps.config.apiPrivateKey || !this.deps.config.masterAddress) {
      throw new Error('Cannot init exchange: missing apiPrivateKey or masterAddress')
    }
    try {
      // Lazy import — l'SDK è opzionale finché non si esegue il primo ordine.
      const sdk = await import('@nktkas/hyperliquid').catch(() => null)
      const viem = await import('viem/accounts').catch(() => null)
      if (!sdk || !viem) {
        throw new Error('@nktkas/hyperliquid or viem not installed — run `npm install`')
      }
      const pk = this.deps.config.apiPrivateKey.startsWith('0x')
        ? this.deps.config.apiPrivateKey
        : '0x' + this.deps.config.apiPrivateKey
      const wallet = (viem as { privateKeyToAccount: (pk: `0x${string}`) => unknown }).privateKeyToAccount(pk as `0x${string}`)
      const Transport = (sdk as { HttpTransport?: new (...args: unknown[]) => unknown }).HttpTransport
      const ExchangeClient = (sdk as { ExchangeClient?: new (cfg: unknown) => unknown }).ExchangeClient
      if (!Transport || !ExchangeClient) {
        throw new Error('SDK shape unexpected — check @nktkas/hyperliquid version')
      }
      const transport = new Transport({ isTestnet: this.deps.config.network === 'testnet' })
      this.exchangeClient = new ExchangeClient({
        wallet,
        transport,
        isTestnet: this.deps.config.network === 'testnet',
        defaultVaultAddress: this.deps.config.masterAddress,
      })
      this.deps.logger.info('[EXEC] exchange client initialized')
      return this.exchangeClient
    } catch (err) {
      this.deps.logger.error({ err: String(err) }, '[EXEC] init exchange failed')
      throw err
    }
  }

  /**
   * Pipeline completa: signal → size sizing → risk check → mark price → SL/TP → place → log.
   * @param override Se la combo (coin, strategy) è whitelisted dal walk-forward, contiene gli sl/tp ottimizzati.
   *                 Il `tier` modula il risk: hard/soft-robust = 100%, exploratory = 50%.
   */
  async execute(signal: Signal, coin: string, atrValue: number, markPrice: number, override?: { slMul: number; tpMul: number; tier?: 'hard-robust' | 'soft-robust' | 'exploratory' }): Promise<{ ok: boolean; reason?: string; orderId?: string }> {
    const cfg = this.deps.config
    const account = this.deps.account.current() ?? this.deps.account.placeholder(1000)

    // 1. Position sizing — in dry-run usa equity demo (compounding), altrimenti account reale
    const equity = cfg.dryRun ? this.deps.risk.effectiveEquity() : account.equityUsd
    // Tier-based risk multiplier: exploratory sizing dimezzato per controllare rumore
    const tierMul = override?.tier === 'exploratory' ? 0.5 : 1.0
    const riskUsd = equity * (cfg.riskPerTradePct / 100) * tierMul
    // Override SL/TP multipliers se la combo è walk-forward-optimized per questo coin
    const slMul = override?.slMul ?? cfg.slAtrMult
    const tpMul = override?.tpMul ?? cfg.tpAtrMult
    const slDistAbs = atrValue * slMul
    if (slDistAbs <= 0) return { ok: false, reason: 'ATR zero' }
    // size base units: tale che SL distance corrisponda a riskUsd
    let sizeBase = riskUsd / slDistAbs
    let notional = sizeBase * markPrice

    // 1b. Position cap-and-resize: invece di rifiutare un trade che eccede maxPositionUsd,
    // riduciamo la size proporzionalmente. Il rischio reale scenderà sotto il target, ma
    // il segnale viene comunque eseguito. Su asset volatili (BNB, SOL) con ATR stretto
    // questo evita di lasciare i signal "morti" per cap notionale.
    if (notional > cfg.maxPositionUsd) {
      const scale = cfg.maxPositionUsd / notional
      sizeBase *= scale
      notional = cfg.maxPositionUsd
      this.deps.logger.info({ coin, strategy: signal.strategyId, scale: scale.toFixed(3), scaledRiskUsd: (riskUsd * scale).toFixed(2) }, '[EXEC] position scaled to cap')
    }

    // 2. Determina SL/TP a prezzi assoluti
    const sl = signal.direction === 'long' ? markPrice - slDistAbs : markPrice + slDistAbs
    const tp = signal.direction === 'long' ? markPrice + atrValue * tpMul : markPrice - atrValue * tpMul

    // 3. Build order request
    const orderId = `${signal.strategyId ?? 'unknown'}-${coin}-${Date.now()}`
    const order: OrderRequest = {
      coin,
      direction: signal.direction,
      size: roundSize(sizeBase, coin),
      type: 'market',
      stopLoss: roundPrice(sl, coin),
      takeProfit: roundPrice(tp, coin),
      reduceOnly: false,
      tif: 'Ioc',
      strategyId: signal.strategyId ?? 'unknown',
      signalReason: signal.reason,
      generatedAt: Date.now(),
      candleTime: Math.floor(Date.now() / 1000),
    }

    // 4. Risk check
    const check = this.deps.risk.shouldAllowOrder(order, account, notional)
    if (!check.allow) {
      this.deps.logger.warn({ coin, strategy: order.strategyId, reason: check.reason, notional }, '[EXEC] risk blocked')
      this.deps.audit.append('risk_block', { order, reason: check.reason, notional })
      return { ok: false, reason: check.reason ?? 'risk_block' }
    }

    // 5. Send (dry-run or real)
    if (cfg.dryRun || !cfg.apiPrivateKey) {
      const hash = this.deps.audit.append('place_order_dry', order)
      this.deps.db.insertOrder(order, orderId, true, { dryRun: true, hash })
      this.deps.risk.markOrderSent()
      this.deps.positions.track({
        coin,
        direction: signal.direction,
        entryPrice: markPrice,
        size: order.size,
        stopLoss: order.stopLoss!,
        takeProfit: order.takeProfit!,
        strategyId: order.strategyId,
        openedAt: Date.now(),
      })
      this.deps.logger.info({ orderId, coin, dir: signal.direction, size: order.size, notional: notional.toFixed(2), sl: order.stopLoss, tp: order.takeProfit, strategy: order.strategyId }, '[EXEC][DRY] order recorded')
      return { ok: true, orderId }
    }

    // 6. Real execution
    try {
      const ex = await this.initExchange() as { order: (req: unknown) => Promise<unknown> }
      const isBuy = signal.direction === 'long'
      const payload = {
        orders: [{
          a: 0,                              // asset index resolved dall'SDK via coin name
          b: isBuy,
          p: '0',                            // market: HL accetta "0" come limit price
          s: String(order.size),
          r: false,
          t: { limit: { tif: 'Ioc' } },
        }],
        grouping: 'normalTpsl' as const,
      }
      const hash = this.deps.audit.append('place_order_live', { order, payload })
      const response = await ex.order(payload)
      this.deps.audit.append('place_order_response', { orderId, response, hash })
      this.deps.db.insertOrder(order, orderId, false, response)
      this.deps.risk.markOrderSent()
      this.deps.positions.track({
        coin,
        direction: signal.direction,
        entryPrice: markPrice,
        size: order.size,
        stopLoss: order.stopLoss!,
        takeProfit: order.takeProfit!,
        strategyId: order.strategyId,
        openedAt: Date.now(),
      })
      this.deps.logger.info({ orderId, coin, dir: signal.direction, response }, '[EXEC][LIVE] order sent')
      return { ok: true, orderId }
    } catch (err) {
      const msg = String(err)
      this.deps.audit.append('place_order_error', { orderId, error: msg })
      this.deps.logger.error({ err: msg, orderId }, '[EXEC][LIVE] order failed')
      return { ok: false, reason: msg }
    }
  }

  /** Force close di una coin (market reduce-only). Usato da position-manager failsafe e da emergencyFlatten. */
  async forceClose(coin: string, reason: string): Promise<void> {
    const p = this.deps.positions.get(coin)
    if (!p) return
    const cfg = this.deps.config

    const closeOrder: OrderRequest = {
      coin,
      direction: p.direction === 'long' ? 'short' : 'long',
      size: p.size,
      type: 'market',
      reduceOnly: true,
      tif: 'Ioc',
      strategyId: 'failsafe',
      signalReason: reason,
      generatedAt: Date.now(),
      candleTime: Math.floor(Date.now() / 1000),
    }
    const hash = this.deps.audit.append('force_close', { coin, reason, position: p })
    const orderId = `close-${coin}-${Date.now()}`

    if (cfg.dryRun || !cfg.apiPrivateKey) {
      // === DEMO TRADING (dry-run) ===
      // Simula fill al last mid price + calcola P&L netto fee (HL taker 0.045% × 2 round-trip)
      const exitPrice = this.deps.positions.getLastMid(coin) ?? p.entryPrice
      const grossPnl = p.direction === 'long'
        ? (exitPrice - p.entryPrice) * p.size
        : (p.entryPrice - exitPrice) * p.size
      const feeRate = 0.00045   // HL taker
      const fees = (p.entryPrice + exitPrice) * p.size * feeRate
      const netPnl = grossPnl - fees

      this.deps.db.insertOrder(closeOrder, orderId, true, { dryRun: true, hash, reason, exitPrice, netPnl })
      this.deps.db.insertFill({
        orderId,
        ts: Date.now(),
        coin,
        direction: closeOrder.direction,
        size: p.size,
        price: exitPrice,
        fee: fees,
        pnl: netPnl,
        isClose: true,
      })

      // Aggiorna equity demo + stats
      this.deps.risk.recordDemoFill(netPnl)
      this.deps.audit.append('demo_close', { coin, entry: p.entryPrice, exit: exitPrice, size: p.size, netPnl, reason })

      this.deps.positions.untrack(coin)
      this.deps.logger.warn({ coin, reason, entry: p.entryPrice, exit: exitPrice, netPnl: netPnl.toFixed(2) }, '[EXEC][DRY] DEMO close')
      return
    }

    try {
      const ex = await this.initExchange() as { order: (req: unknown) => Promise<unknown> }
      const isBuy = closeOrder.direction === 'long'
      const response = await ex.order({
        orders: [{ a: 0, b: isBuy, p: '0', s: String(closeOrder.size), r: true, t: { limit: { tif: 'Ioc' } } }],
        grouping: 'na' as const,
      })
      this.deps.db.insertOrder(closeOrder, orderId, false, response)
      this.deps.audit.append('force_close_response', { coin, response, hash })
      this.deps.positions.untrack(coin)
      this.deps.logger.warn({ coin, reason, response }, '[EXEC][LIVE] force close sent')
    } catch (err) {
      this.deps.audit.append('force_close_error', { coin, error: String(err) })
      this.deps.logger.error({ coin, err: String(err) }, '[EXEC][LIVE] force close failed')
    }
  }

  /** Chiamato dal kill-switch. Itera tutte le posizioni e le chiude. */
  async emergencyFlatten(): Promise<void> {
    const all = this.deps.positions.list()
    this.deps.logger.error({ n: all.length }, '[EXEC] emergency flatten initiated')
    this.deps.audit.append('emergency_flatten', { positions: all.map(p => p.coin) })
    for (const p of all) {
      try { await this.forceClose(p.coin, 'emergency-flatten') }
      catch (err) { this.deps.logger.error({ coin: p.coin, err: String(err) }, '[EXEC] flatten error') }
    }
  }
}

// ── Helpers di rounding ─────────────────────────────────────────────────
// HL ha decimal precision diverso per ogni coin. Conservativo: usa precision standard.
function roundSize(s: number, coin: string): number {
  const decimals: Record<string, number> = { BTC: 5, ETH: 4, SOL: 2, XRP: 0, BNB: 3 }
  const d = decimals[coin] ?? 3
  return parseFloat(s.toFixed(d))
}

function roundPrice(p: number, coin: string): number {
  const decimals: Record<string, number> = { BTC: 1, ETH: 2, SOL: 3, XRP: 4, BNB: 2 }
  const d = decimals[coin] ?? 2
  return parseFloat(p.toFixed(d))
}
