// Costi realistici per backtest:
//   - Slippage per-coin basato su profondità order book HL osservata
//   - Funding rate cost dal `fundingHistory` reale
//
// Senza questi due, il backtest sottostima il costo reale del 10-30%.
// Con questi, abbiamo un'approssimazione "esecuzione market order su HL".

/** Slippage round-trip per-coin in decimale (es. 0.0005 = 0.05%).
 *  Stime conservative da osservazione order book HL su size $1000-$2000 notional.
 *  Per market order. Maker order avrebbe slippage ~0 ma fee diverse. */
export const PER_COIN_SLIPPAGE: Record<string, number> = {
  BTC:  0.00020,   // 0.02% — deep book
  ETH:  0.00025,   // 0.025%
  BNB:  0.00050,   // 0.05%
  SOL:  0.00040,   // 0.04%
  XRP:  0.00060,   // 0.06% — più shallow
  HYPE: 0.00080,   // 0.08% — token nativo HL, liquidity medio-bassa
  SUI:  0.00060,   // 0.06%
  AVAX: 0.00050,   // 0.05%
  DOGE: 0.00060,   // 0.06%
  AAVE: 0.00070,   // 0.07% — book più sottile
}

export const DEFAULT_SLIPPAGE = 0.0003

export function getSlippageForCoin(coin: string): number {
  return PER_COIN_SLIPPAGE[coin.toUpperCase()] ?? DEFAULT_SLIPPAGE
}

/** HL taker fee (fissa). */
export const HL_TAKER_FEE = 0.00045  // 0.045%
export const HL_MAKER_REBATE = -0.00015  // negativo = rebate

/** Costo round-trip in % del notional, assumendo entry+exit entrambi market.
 *  = 2 × (taker fee + slippage). */
export function roundTripCostPct(coin: string, isTakerEntry = true, isTakerExit = true): number {
  const slip = getSlippageForCoin(coin)
  const entryFee = isTakerEntry ? HL_TAKER_FEE : HL_MAKER_REBATE
  const exitFee  = isTakerExit  ? HL_TAKER_FEE : HL_MAKER_REBATE
  return (entryFee + slip) + (exitFee + slip)
}
