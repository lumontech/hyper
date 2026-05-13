// Volume Profile — distribuzione del volume per price level (POC, VAH, VAL).
// Standard quant: 70% del volume è la "Value Area" (VAH=Value Area High, VAL=Value Area Low).
// POC = Point of Control = price level con max volume.
//
// Usato dal signal-router come bias supplementare: trade attorno a POC/VAH/VAL
// (zone istituzionali) ha probabilità di rejection più alta.

import type { Candle } from '../types/trading.js'

export interface VolumeNode {
  price: number
  volume: number
}

export interface VolumeProfileResult {
  poc: number              // Point of Control
  vah: number              // Value Area High (top 70%)
  val: number              // Value Area Low (bottom 70%)
  totalVolume: number
  buckets: VolumeNode[]    // distribuzione per price bucket
  hvn: number[]            // High Volume Nodes (top 3)
  lvn: number[]            // Low Volume Nodes (bottom 3)
}

/**
 * Calcola Volume Profile su una finestra di candele.
 * Approccio standard: divide range [low..high] in N bucket, ogni candela aggiunge
 * il proprio volume distribuito uniformemente sui bucket che attraversa.
 */
export function calculateVolumeProfile(candles: Candle[], nBuckets = 30): VolumeProfileResult | null {
  if (!candles || candles.length < 10) return null
  let globalLow = Infinity, globalHigh = -Infinity
  for (const c of candles) {
    if (c.low < globalLow) globalLow = c.low
    if (c.high > globalHigh) globalHigh = c.high
  }
  if (globalHigh <= globalLow) return null

  const bucketSize = (globalHigh - globalLow) / nBuckets
  const buckets: VolumeNode[] = []
  for (let i = 0; i < nBuckets; i++) {
    buckets.push({ price: globalLow + (i + 0.5) * bucketSize, volume: 0 })
  }

  // Distribuisce il volume di ogni candela uniformemente sui bucket coperti dal range
  for (const c of candles) {
    const fromBucket = Math.max(0, Math.floor((c.low - globalLow) / bucketSize))
    const toBucket = Math.min(nBuckets - 1, Math.floor((c.high - globalLow) / bucketSize))
    const span = toBucket - fromBucket + 1
    const perBucket = c.volume / span
    for (let j = fromBucket; j <= toBucket; j++) {
      buckets[j]!.volume += perBucket
    }
  }

  const totalVolume = buckets.reduce((s, b) => s + b.volume, 0)
  if (totalVolume <= 0) return null

  // POC = bucket con max volume
  let pocIdx = 0
  for (let i = 1; i < buckets.length; i++) {
    if (buckets[i]!.volume > buckets[pocIdx]!.volume) pocIdx = i
  }
  const poc = buckets[pocIdx]!.price

  // Value Area: espandi da POC verso alto/basso finché copre 70% del totale
  const target = totalVolume * 0.7
  let lo = pocIdx, hi = pocIdx
  let cumulative = buckets[pocIdx]!.volume
  while (cumulative < target && (lo > 0 || hi < buckets.length - 1)) {
    const upVol = hi < buckets.length - 1 ? buckets[hi + 1]!.volume : 0
    const downVol = lo > 0 ? buckets[lo - 1]!.volume : 0
    if (upVol >= downVol && hi < buckets.length - 1) {
      hi++
      cumulative += buckets[hi]!.volume
    } else if (lo > 0) {
      lo--
      cumulative += buckets[lo]!.volume
    } else if (hi < buckets.length - 1) {
      hi++
      cumulative += buckets[hi]!.volume
    } else break
  }
  const vah = buckets[hi]!.price
  const val = buckets[lo]!.price

  // High/Low Volume Nodes
  const sorted = [...buckets].sort((a, b) => b.volume - a.volume)
  const hvn = sorted.slice(0, 3).map(n => n.price)
  const lvn = sorted.slice(-3).map(n => n.price)

  return { poc, vah, val, totalVolume, buckets, hvn, lvn }
}

// ── Funding Rate Hyperliquid ─────────────────────────────────────────
// HL settle funding ogni 1h. Tipico: ±0.001% / 8h annualizzato.
// Fetch da `/info {type:metaAndAssetCtxs}` che ritorna funding rate per ogni asset.

const HL_API_BASE = {
  testnet: 'https://api.hyperliquid-testnet.xyz',
  mainnet: 'https://api.hyperliquid.xyz',
} as const

export interface FundingRate {
  coin: string
  funding: number          // current funding rate (%/h, e.g. 0.0001 = 0.01%/h)
  openInterest: number
  markPrice: number
  premium: number
}

/**
 * Fetch funding rates correnti per tutti i perp. Cache 60s.
 */
export async function fetchFundingRates(network: 'testnet' | 'mainnet' = 'mainnet'): Promise<FundingRate[]> {
  const res = await fetch(`${HL_API_BASE[network]}/info`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'metaAndAssetCtxs' }),
  })
  if (!res.ok) throw new Error(`HL funding ${res.status}`)
  const data = await res.json() as [
    { universe: Array<{ name: string }> },
    Array<{ funding: string; openInterest: string; markPx: string; premium?: string }>
  ]
  const universe = data[0]?.universe ?? []
  const ctxs = data[1] ?? []
  const out: FundingRate[] = []
  for (let i = 0; i < universe.length && i < ctxs.length; i++) {
    const u = universe[i]!, ctx = ctxs[i]!
    out.push({
      coin: u.name,
      funding: parseFloat(ctx.funding ?? '0'),
      openInterest: parseFloat(ctx.openInterest ?? '0'),
      markPrice: parseFloat(ctx.markPx ?? '0'),
      premium: parseFloat(ctx.premium ?? '0'),
    })
  }
  return out
}

/**
 * Stima costo funding per una posizione aperta per N ore.
 * Long paga funding quando funding > 0; short riceve.
 * @returns funding cost in USD (può essere negativo se long paga)
 */
export function estimateFundingCost(
  fundingRate: number,
  direction: 'long' | 'short',
  notionalUsd: number,
  hoursHeld: number,
): number {
  const sign = direction === 'long' ? -1 : 1   // long paga se funding positivo
  return sign * fundingRate * notionalUsd * hoursHeld
}
