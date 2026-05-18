import { useEffect, useState } from 'react'
import { api } from '../services/api'

interface FundingRow {
  coin: string
  rate: number          // decimal per-hour
  annualizedPct: number // %
  premium: number       // decimal
  openInterest: number  // coin units
  markPrice: number     // USD
  apr: 'extreme-pos' | 'high-pos' | 'normal' | 'high-neg' | 'extreme-neg'
}

const THRESHOLDS = {
  extreme: 50,   // ±50% APR
  high:    20,   // ±20% APR
}

function categorize(annPct: number): FundingRow['apr'] {
  if (annPct >= THRESHOLDS.extreme) return 'extreme-pos'
  if (annPct >= THRESHOLDS.high)    return 'high-pos'
  if (annPct <= -THRESHOLDS.extreme) return 'extreme-neg'
  if (annPct <= -THRESHOLDS.high)    return 'high-neg'
  return 'normal'
}

const APR_STYLE: Record<FundingRow['apr'], { bg: string; tag: string; chip: string }> = {
  'extreme-pos': { bg: 'bg-red-500/20 border-red-500/50',   tag: 'SHORT-SIGNAL', chip: 'text-red-300' },
  'high-pos':    { bg: 'bg-red-500/10 border-red-500/30',   tag: 'tilt short',    chip: 'text-red-300' },
  'normal':      { bg: 'bg-bg/40 border-line',              tag: 'normal',        chip: 'text-muted' },
  'high-neg':    { bg: 'bg-green-500/10 border-green-500/30', tag: 'tilt long',  chip: 'text-green-300' },
  'extreme-neg': { bg: 'bg-green-500/20 border-green-500/50', tag: 'LONG-SIGNAL', chip: 'text-green-300' },
}

export function FundingLive() {
  const [data, setData] = useState<Awaited<ReturnType<typeof api.fundingLive>> | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    const tick = async () => {
      try {
        const d = await api.fundingLive()
        setData(d)
        setErr(null)
      } catch (e) { setErr(String(e)) }
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => clearInterval(id)
  }, [])

  if (err) return <div className="p-4 text-red-400 text-sm">Errore: {err}</div>
  if (!data || !data.rates) return <div className="p-4 text-muted text-sm">caricamento funding live…</div>
  if (Object.keys(data.rates).length === 0) {
    return <div className="p-4 text-muted text-sm">Nessun dato funding disponibile. {data.note ?? ''}</div>
  }

  const rows: FundingRow[] = Object.entries(data.rates).map(([coin, rate]) => {
    const annualizedPct = data.annualizedPct[coin] ?? 0
    return {
      coin,
      rate,
      annualizedPct,
      premium: data.premiums[coin] ?? 0,
      openInterest: data.openInterest[coin] ?? 0,
      markPrice: data.markPrices[coin] ?? 0,
      apr: categorize(annualizedPct),
    }
  }).sort((a, b) => Math.abs(b.annualizedPct) - Math.abs(a.annualizedPct))

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-wide">Funding Live</h1>
          <p className="text-xs text-muted mt-1">
            Funding rate corrente HL — pagamenti orari. Strategia <strong className="text-gold">fundingHarvest</strong>{' '}
            attiva signal a |APR| ≥ <strong className="text-red-300">87.6%</strong> (rate ±0.0001/h).
          </p>
        </div>
        <div className="text-right text-xs">
          <div className="text-muted uppercase tracking-wider">Aggiornato</div>
          <div className="font-mono text-text">
            {data.ageSec !== null ? `${data.ageSec}s fa` : '—'}
          </div>
          <div className="text-[10px] text-muted">poll 60s</div>
        </div>
      </div>

      <div className="rounded-lg border border-line bg-panel overflow-hidden">
        <table className="w-full text-xs">
          <thead className="text-muted uppercase tracking-wider border-b border-line">
            <tr>
              <th className="text-left py-2 px-3">Coin</th>
              <th className="text-right py-2 px-3">Mark $</th>
              <th className="text-right py-2 px-3">Rate /h</th>
              <th className="text-right py-2 px-3">APR %</th>
              <th className="text-right py-2 px-3">Premium</th>
              <th className="text-right py-2 px-3">Open Int.</th>
              <th className="text-left py-2 px-3">Stato</th>
            </tr>
          </thead>
          <tbody className="font-mono">
            {rows.map(r => {
              const s = APR_STYLE[r.apr]
              const aprStr = `${r.annualizedPct >= 0 ? '+' : ''}${r.annualizedPct.toFixed(2)}%`
              return (
                <tr key={r.coin} className={`border-b border-line/50 ${s.bg}`}>
                  <td className="py-2 px-3 font-semibold">{r.coin}</td>
                  <td className="text-right py-2 px-3">${r.markPrice < 1 ? r.markPrice.toFixed(5) : r.markPrice.toFixed(2)}</td>
                  <td className="text-right py-2 px-3 text-muted">{(r.rate * 100).toFixed(5)}%</td>
                  <td className={`text-right py-2 px-3 font-semibold ${r.annualizedPct >= 0 ? 'text-red-300' : 'text-green-300'}`}>
                    {aprStr}
                  </td>
                  <td className="text-right py-2 px-3 text-muted">{(r.premium * 100).toFixed(3)}%</td>
                  <td className="text-right py-2 px-3 text-muted">
                    {r.openInterest >= 1e6 ? `${(r.openInterest / 1e6).toFixed(2)}M` : r.openInterest >= 1e3 ? `${(r.openInterest / 1e3).toFixed(1)}k` : r.openInterest.toFixed(0)}
                  </td>
                  <td className={`py-2 px-3 text-[10px] font-medium ${s.chip}`}>{s.tag}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-blue-400/30 bg-blue-400/5 p-4 text-xs text-muted leading-relaxed">
        <strong className="text-blue-300">Come funziona:</strong> Hyperliquid paga funding ogni ora.
        Se rate è <strong className="text-red-300">positivo</strong>, i long pagano i short — vuol dire
        che il mercato è troppo long-biased e c'è opportunità di shortare incassando il funding ogni ora
        (mean-reversion atteso). Vice versa se <strong className="text-green-300">negativo</strong>.
        La strategia <strong className="text-gold">fundingHarvest</strong> si attiva solo a estremi
        (|APR| ≥ 87.6%) per evitare di tradare contro trend forti con funding modesto.
      </div>
    </div>
  )
}
