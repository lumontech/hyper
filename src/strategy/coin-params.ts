// Per-coin strategy parameter overrides — AUDIT-DRIVEN con TIER system.
//
// Dopo audit statistico onesto (5-fold rolling walk-forward + funding + slippage + bootstrap CI):
//   - 420 combo testate, 6 robust + 35 marginal
//
// TIER A (production-ready, risk 1% equity per trade):
//   Solo combo con bootstrap CI lower ≥ 0.9 + folds ≥ 4/5 + probEdge ≥ 89%
//   Sono i candidati per il LIVE reale un giorno.
//
// TIER B (exploratory, risk 0.5% equity per trade — DIMEZZATO):
//   Combo con folds ≥ 3/5 + probEdge ≥ 75% (statisticamente promettenti ma non certificate)
//   Servono per validare in dati live se l'edge si materializza.
//   Posizioni più piccole limitano rischio se rumore.
//
// Coin non in whitelist: la combo è completamente disabilitata (single-signal). Le strategie
// restano nel router e possono firmare solo se confluence ≥ 2.

export type Tier = 'hard-robust' | 'soft-robust' | 'exploratory'

export interface CoinStrategyParams {
  enabled: boolean
  slMul: number
  tpMul: number
  tier: Tier
}

/** Moltiplicatore di risk per tier (applied a riskPerTradePct base). */
export const TIER_RISK_MULTIPLIER: Record<Tier, number> = {
  'hard-robust':  1.0,    // risk pieno (1% se config = 1%)
  'soft-robust':  1.0,    // risk pieno (statisticamente quasi certificate)
  'exploratory':  0.5,    // risk dimezzato (sample collection in modo controllato)
}

export const COIN_STRATEGY_PARAMS: Record<string, Record<string, CoinStrategyParams>> = {
  BTC: {
    failedBk:       { enabled: true, slMul: 1.0, tpMul: 3.5, tier: 'exploratory' },
    fundingHarvest: { enabled: true, slMul: 1.5, tpMul: 2.5, tier: 'exploratory' },
  },
  ETH: {
    pivotReversal:  { enabled: true, slMul: 1.2, tpMul: 3.5, tier: 'exploratory' },
    fundingHarvest: { enabled: true, slMul: 1.5, tpMul: 2.5, tier: 'exploratory' },
  },
  XRP: {
    failedBk:       { enabled: true, slMul: 1.2, tpMul: 2.5, tier: 'hard-robust' },
  },
  BNB: {
    tripleBarTrap:  { enabled: true, slMul: 1.2, tpMul: 2.0, tier: 'hard-robust' },
    pivotReversal:  { enabled: true, slMul: 1.2, tpMul: 2.5, tier: 'exploratory' },
  },
  SOL: {
    fundingHarvest: { enabled: true, slMul: 1.5, tpMul: 2.5, tier: 'exploratory' },
  },
  HYPE: {
    // Coin nuovo, data-collection. Audit dedicato in arrivo. Solo confluence ≥2.
  },
  SUI: {
    // Coin nuovo, data-collection.
  },
  AVAX: {
    // Coin nuovo, data-collection.
  },
  DOGE: {
    // Audit nuovi coin: DOGE/failedBk con tp=3.0 è robusto su 3 livelli sl (0.8/1.0/1.2).
    // Choice: sl=1.0 tp=3.0 — la combo con probEdge 100% e CI [1.08, 1.70].
    failedBk: { enabled: true, slMul: 1.0, tpMul: 3.0, tier: 'hard-robust' },
  },
  AAVE: {
    // Coin nuovo, data-collection.
  },
}

export function getCoinStrategyParams(coin: string, strategyId: string): CoinStrategyParams | null {
  const c = COIN_STRATEGY_PARAMS[coin.toUpperCase()]
  if (!c) return null
  const s = c[strategyId]
  if (!s || !s.enabled) return null
  return s
}

export function listWhitelistedCombos(): Array<{ coin: string; strategy: string; slMul: number; tpMul: number; tier: Tier }> {
  const out: Array<{ coin: string; strategy: string; slMul: number; tpMul: number; tier: Tier }> = []
  for (const [coin, strategies] of Object.entries(COIN_STRATEGY_PARAMS)) {
    for (const [strategy, params] of Object.entries(strategies)) {
      if (params.enabled) out.push({ coin, strategy, slMul: params.slMul, tpMul: params.tpMul, tier: params.tier })
    }
  }
  return out
}
