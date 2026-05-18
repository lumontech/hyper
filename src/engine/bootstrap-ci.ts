// Block bootstrap confidence interval per PF.
// Riferimento: López de Prado "Advances in Financial Machine Learning" cap. 12.
//
// Perché block bootstrap e non i.i.d.: i trade returns sono autocorrelati
// (regime markets, momentum/mean-reversion). Block size = 30 trade è un
// trade-off conservativo per crypto 1h.

export interface BootstrapResult {
  pfMean: number
  pfMedian: number
  pfLower95: number     // 2.5% quantile
  pfUpper95: number     // 97.5% quantile
  /** Pct di samples con PF > 1 — proxy della probabilità che l'edge sia reale. */
  probEdge: number
  nSamples: number
  nIterations: number
}

/**
 * @param tradeReturns Array di R-multiples per trade (positivi vincenti, negativi perdenti)
 * @param iterations Numero ricampionamenti (default 1000)
 * @param blockSize Lunghezza del blocco contiguo per preservare autocorrelazione (default 30)
 */
export function blockBootstrapPF(
  tradeReturns: number[],
  iterations = 1000,
  blockSize = 30,
): BootstrapResult {
  if (tradeReturns.length < blockSize * 2) {
    return { pfMean: 0, pfMedian: 0, pfLower95: 0, pfUpper95: 0, probEdge: 0, nSamples: tradeReturns.length, nIterations: 0 }
  }

  const n = tradeReturns.length
  const pfs: number[] = []
  let edgeCount = 0
  const numBlocks = Math.ceil(n / blockSize)

  for (let it = 0; it < iterations; it++) {
    // Ricampiona `numBlocks` blocchi contigui con replacement
    const resample: number[] = []
    for (let b = 0; b < numBlocks; b++) {
      const start = Math.floor(Math.random() * (n - blockSize + 1))
      for (let i = 0; i < blockSize; i++) {
        if (resample.length >= n) break
        resample.push(tradeReturns[start + i]!)
      }
    }
    // Calcola PF sul resample
    let grossWin = 0, grossLoss = 0
    for (const r of resample) {
      if (r > 0) grossWin += r
      else if (r < 0) grossLoss += -r
    }
    const pf = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? Infinity : 0)
    if (Number.isFinite(pf)) {
      pfs.push(pf)
      if (pf > 1.0) edgeCount++
    }
  }
  pfs.sort((a, b) => a - b)
  const q = (p: number) => pfs[Math.floor(p * pfs.length)] ?? 0
  const pfMean = pfs.reduce((s, x) => s + x, 0) / pfs.length
  return {
    pfMean,
    pfMedian: q(0.5),
    pfLower95: q(0.025),
    pfUpper95: q(0.975),
    probEdge: edgeCount / pfs.length,
    nSamples: n,
    nIterations: pfs.length,
  }
}
