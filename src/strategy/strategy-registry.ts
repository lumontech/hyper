// Registry centrale strategie. Aggiungi qui ogni nuova strategia importandola.

import type { StrategyDef } from '../types/trading.js'
import { mssChoCH } from './strategies/mss-choch.js'
import { liquiditySweep } from './strategies/liquidity-sweep.js'
import { tripleBarTrap } from './strategies/triple-bar-trap.js'
import { failedBreakout } from './strategies/failed-breakout.js'
import { pivotReversal } from './strategies/pivot-reversal.js'
import { ictSilverBullet } from './strategies/ict-silver-bullet.js'
import { orderBlockFvg } from './strategies/order-block-fvg.js'

export const ALL_STRATEGIES: StrategyDef[] = [
  mssChoCH,
  liquiditySweep,
  tripleBarTrap,
  failedBreakout,
  pivotReversal,
  ictSilverBullet,
  orderBlockFvg,
]

export function getEnabledStrategies(ids: string[]): StrategyDef[] {
  return ALL_STRATEGIES.filter(s => ids.includes(s.id))
}

export function findStrategy(id: string): StrategyDef | undefined {
  return ALL_STRATEGIES.find(s => s.id === id)
}

export function isStrategyCompatibleWithCoin(strategy: StrategyDef, coin: string): boolean {
  if (strategy.supportedCoins === 'all') return true
  return strategy.supportedCoins.includes(coin)
}
