// Registry centrale strategie.
// Due categorie:
//   - 'adaptive': meta-strategie scritte da Claude (combinano regime + pattern + multi-confluenza)
//   - 'library':  strategie atomiche portate da trade.fondamentale

import type { StrategyDef } from '../types/trading.js'
import { adaptive } from './strategies/adaptive.js'
import { mssChoCH } from './strategies/mss-choch.js'
import { liquiditySweep } from './strategies/liquidity-sweep.js'
import { tripleBarTrap } from './strategies/triple-bar-trap.js'
import { failedBreakout } from './strategies/failed-breakout.js'
import { pivotReversal } from './strategies/pivot-reversal.js'
import { ictSilverBullet } from './strategies/ict-silver-bullet.js'
import { orderBlockFvg } from './strategies/order-block-fvg.js'

export const ALL_STRATEGIES: StrategyDef[] = [
  // ── Adaptive (scritta da Claude) ──
  adaptive,
  // ── Library (port da trade.fondamentale) ──
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

export function strategiesByCategory(): { adaptive: StrategyDef[]; library: StrategyDef[] } {
  return {
    adaptive: ALL_STRATEGIES.filter(s => s.category === 'adaptive'),
    library:  ALL_STRATEGIES.filter(s => s.category === 'library'),
  }
}
