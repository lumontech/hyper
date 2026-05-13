// Account State — fetch e cache dello stato account da HL info endpoint.
// Polled ogni 5s come fallback al WS userFills. Snapshot consumato da risk-manager.

import type { Logger } from 'pino'
import type { Config } from '../utils/config.js'
import type { AccountState, Position } from '../types/trading.js'

const API_BASE: Record<'testnet' | 'mainnet', string> = {
  testnet: 'https://api.hyperliquid-testnet.xyz',
  mainnet: 'https://api.hyperliquid.xyz',
}

interface HLClearinghouseState {
  marginSummary: {
    accountValue: string
    totalMarginUsed: string
    totalNtlPos: string
    totalRawUsd: string
  }
  assetPositions: Array<{
    position: {
      coin: string
      szi: string                 // signed size; positive=long
      entryPx: string
      positionValue: string
      unrealizedPnl: string
      marginUsed: string
      liquidationPx?: string
      maxLeverage?: number
    }
    type: string
  }>
  withdrawable?: string
}

export class AccountStateService {
  private state: AccountState | null = null
  private pollTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly config: Config,
    private readonly logger: Logger,
  ) {}

  current(): AccountState | null {
    return this.state
  }

  start(intervalMs = 5000): void {
    this.refresh()
    this.pollTimer = setInterval(() => this.refresh(), intervalMs)
  }

  stop(): void {
    if (this.pollTimer) clearInterval(this.pollTimer)
  }

  async refresh(): Promise<AccountState | null> {
    if (!this.config.masterAddress) {
      this.logger.debug('[ACCT] no masterAddress, skipping refresh')
      return null
    }
    try {
      const res = await fetch(`${API_BASE[this.config.network]}/info`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'clearinghouseState', user: this.config.masterAddress }),
      })
      if (!res.ok) throw new Error(`HL ${res.status}`)
      const data = await res.json() as HLClearinghouseState
      this.state = this.parseState(data)
      return this.state
    } catch (err) {
      this.logger.warn({ err: String(err) }, '[ACCT] refresh failed')
      return null
    }
  }

  private parseState(data: HLClearinghouseState): AccountState {
    const equity = parseFloat(data.marginSummary.accountValue)
    const marginUsed = parseFloat(data.marginSummary.totalMarginUsed)
    const totalNotional = parseFloat(data.marginSummary.totalNtlPos)
    const free = equity - marginUsed
    const positions: Position[] = data.assetPositions
      .filter(ap => parseFloat(ap.position.szi) !== 0)
      .map(ap => {
        const szi = parseFloat(ap.position.szi)
        return {
          coin: ap.position.coin,
          direction: szi > 0 ? 'long' : 'short',
          size: Math.abs(szi),
          entryPrice: parseFloat(ap.position.entryPx),
          markPrice: parseFloat(ap.position.entryPx),     // TODO usare allMids
          unrealizedPnl: parseFloat(ap.position.unrealizedPnl),
          margin: parseFloat(ap.position.marginUsed),
          leverage: ap.position.maxLeverage ?? 1,
          liquidationPrice: ap.position.liquidationPx ? parseFloat(ap.position.liquidationPx) : null,
          openedAt: Date.now(),                            // info endpoint non dà open time
          stopLoss: null,                                  // tracked separately da position-manager
          takeProfit: null,
          strategyId: 'unknown',
        }
      })
    return {
      equityUsd: equity,
      marginUsedUsd: marginUsed,
      freeMarginUsd: free,
      totalNotionalUsd: totalNotional,
      positions,
      updatedAt: Date.now(),
    }
  }

  /** Placeholder usato finché non c'è masterAddress configurato. */
  placeholder(equityUsd: number): AccountState {
    return {
      equityUsd,
      marginUsedUsd: 0,
      freeMarginUsd: equityUsd,
      totalNotionalUsd: 0,
      positions: [],
      updatedAt: Date.now(),
    }
  }
}
