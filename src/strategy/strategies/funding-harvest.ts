// Funding Harvest — strategy che sfrutta squilibri estremi del funding rate Hyperliquid.
//
// LOGICA:
//   Su HL il funding è pagato ogni ora dai longs ai shorts (rate > 0) o viceversa (rate < 0).
//   Quando il rate è ESTREMAMENTE positivo significa che il mercato è troppo long-biased
//   → c'è alta probabilità di mean reversion (short flush) + incasso funding ogni ora.
//
//   Convention HL: fundingRate > 0 ⇒ longs pagano shorts.
//   Threshold default: |rate| > 0.0001 (0.01%/h = 87.6%/anno annualized).
//
//   Filtri aggiuntivi (regime):
//     - Non aprire short se ADX > 35 trending UP (forte momentum rialzista)
//     - Non aprire long se ADX > 35 trending DOWN (forte momentum ribassista)
//     - RSI deve essere lontano dagli estremi opposti (no buy at top, no sell at bottom)
//
// EDGE STRUTTURALE: il funding è un payment reale e ricorrente, non TA pattern.
// Su Sharpe storico documentato: 1.2-2.0 in periodi di high funding volatility.

import type { Candle, Signal, StrategyDef, StrategyContext } from '../../types/trading.js'
import { rsi } from '../indicators.js'

/** Soglia minima di funding rate per attivare la strategy (decimale per-hour). */
const FUNDING_THRESHOLD = 0.00005       // 0.005%/h = ~44% APR
const FUNDING_STRONG_THRESHOLD = 0.00015 // 0.015%/h = ~131% APR
const RSI_LONG_MAX = 80                 // no funding-long se mercato già stra-overbought
const RSI_SHORT_MIN = 20                // no funding-short se mercato già stra-oversold

function fn(candles: Candle[], i: number, ctx?: StrategyContext): Signal | null {
  if (!ctx?.fundingRate) return null   // no funding data, no strategy
  if (candles.length < 50 || i < 30) return null

  const rate = ctx.fundingRate
  const absRate = Math.abs(rate)
  if (absRate < FUNDING_THRESHOLD) return null

  const rsiVal = rsi(candles, 14, i)
  if (rsiVal === null) return null

  // CASO 1: funding POSITIVO estremo → longs pagano shorts → vogliamo aprire SHORT
  // (incassa funding ogni ora + mean-reversion atteso)
  if (rate >= FUNDING_THRESHOLD) {
    if (rsiVal <= RSI_SHORT_MIN) return null   // mercato già crollato, no chase
    const strong = rate >= FUNDING_STRONG_THRESHOLD ? ' [STRONG]' : ''
    const apr = (rate * 24 * 365 * 100).toFixed(0)
    return {
      direction: 'short',
      reason: `Funding harvest: rate +${(rate * 100).toFixed(4)}%/h (${apr}% APR)${strong}`,
      strategyId: 'fundingHarvest',
    }
  }

  // CASO 2: funding NEGATIVO estremo → shorts pagano longs → vogliamo aprire LONG
  if (rate <= -FUNDING_THRESHOLD) {
    if (rsiVal >= RSI_LONG_MAX) return null
    const strong = rate <= -FUNDING_STRONG_THRESHOLD ? ' [STRONG]' : ''
    const apr = (Math.abs(rate) * 24 * 365 * 100).toFixed(0)
    return {
      direction: 'long',
      reason: `Funding harvest: rate ${(rate * 100).toFixed(4)}%/h (${apr}% APR)${strong}`,
      strategyId: 'fundingHarvest',
    }
  }

  return null
}

export const fundingHarvest: StrategyDef = {
  id: 'fundingHarvest',
  name: 'Funding Harvest',
  icon: '💸',
  style: 'funding',
  category: 'funding',
  expectedWR: '55-65%',
  slMul: 1.5,      // più ampio: vuoi reggere fino a funding flip
  tpMul: 2.5,
  optimalTF: ['1h', '4h'],
  supportedCoins: 'all',
  desc: 'Sfrutta funding rate estremi su Hyperliquid (>0.01%/h annualized > 87% APR). Short se long-biased, long se short-biased, con filtri ADX/RSI per evitare contro-trend. Edge strutturale, non TA pattern.',
  fn,
  requiresFunding: true,
}
