import { useEffect, useState } from 'react'
import { api, type CryptoEvent } from '../services/api'

export function Events() {
  const [upcoming, setUpcoming] = useState<CryptoEvent[]>([])
  const [recent, setRecent] = useState<CryptoEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const tick = async () => {
      try {
        const r = await api.events()
        setUpcoming(r.upcoming)
        setRecent(r.recent)
        setError(null)
      } catch (e) {
        setError(String(e))
      } finally {
        setLoading(false)
      }
    }
    tick()
    const id = setInterval(tick, 60000)
    return () => clearInterval(id)
  }, [])

  const fmt = (ts: number) => new Date(ts).toLocaleString('it-IT', { hour12: false, dateStyle: 'short', timeStyle: 'short' })
  const inFromNow = (ts: number) => {
    const diff = ts - Date.now()
    if (diff < 0) return `-${Math.abs(diff / 3600_000).toFixed(1)}h`
    if (diff < 3600_000) return `in ${(diff / 60_000).toFixed(0)}m`
    if (diff < 86400_000) return `in ${(diff / 3600_000).toFixed(1)}h`
    return `in ${(diff / 86400_000).toFixed(1)}d`
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-wide">Calendario Eventi</h1>
        <p className="text-xs text-muted mt-1">
          Eventi macro + crypto che impattano BTC/ETH/SOL/XRP/BNB. <strong>Il bot blocca trades nelle finestre ±30 min da eventi high-impact</strong>.
          Sorgenti: seed (FOMC, CPI) + CoinGecko (auto-fetch ogni 6h).
        </p>
      </div>

      {loading && <div className="text-muted text-sm">caricamento…</div>}
      {error && <div className="p-3 rounded border border-short/40 bg-short/10 text-short text-xs">{error}</div>}

      <Section title={`In arrivo (${upcoming.length})`}>
        {upcoming.length === 0 ? (
          <Empty msg="Nessun evento programmato nei prossimi 14 giorni." />
        ) : (
          <div className="space-y-2">
            {upcoming.map(e => (
              <div key={e.id} className={`p-3 rounded border ${impactBorder(e.impact)} bg-bg/40`}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <ImpactBadge impact={e.impact} />
                    <CategoryBadge category={e.category} />
                    <span className="font-mono text-sm">{e.title}</span>
                  </div>
                  <div className="text-right text-xs font-mono">
                    <div className="text-gold">{inFromNow(e.ts)}</div>
                    <div className="text-muted">{fmt(e.ts)} UTC</div>
                  </div>
                </div>
                <p className="text-xs text-muted mt-1.5">{e.description}</p>
                <div className="flex gap-1 mt-1.5">
                  {e.affects.map(a => (
                    <span key={a} className="px-1.5 py-0.5 rounded bg-line text-[10px] font-mono">
                      {a === '*' ? 'ALL' : a}
                    </span>
                  ))}
                  <span className="ml-auto text-[10px] text-muted">{e.source}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Section>

      <Section title={`Recenti 24h (${recent.length})`}>
        {recent.length === 0 ? (
          <Empty msg="Nessun evento nelle ultime 24h." />
        ) : (
          <div className="space-y-2">
            {recent.map(e => (
              <div key={e.id} className="p-3 rounded border border-line bg-bg/30 opacity-75">
                <div className="flex items-start justify-between">
                  <span className="font-mono text-xs">
                    <ImpactBadge impact={e.impact} /> {e.title}
                  </span>
                  <span className="text-[10px] text-muted">{fmt(e.ts)}</span>
                </div>
                <p className="text-[11px] text-muted mt-1">{e.description}</p>
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-panel">
      <div className="px-4 py-2 border-b border-line">
        <h2 className="text-xs uppercase tracking-wider text-muted">{title}</h2>
      </div>
      <div className="p-3">{children}</div>
    </div>
  )
}
function Empty({ msg }: { msg: string }) {
  return <div className="text-muted text-xs italic py-3 text-center">{msg}</div>
}
function ImpactBadge({ impact }: { impact: 'high' | 'medium' | 'low' }) {
  const cls = impact === 'high' ? 'bg-short/20 border-short/40 text-short'
            : impact === 'medium' ? 'bg-warn/20 border-warn/40 text-warn'
            : 'bg-line border-line text-muted'
  return <span className={`px-1.5 py-0.5 rounded border text-[10px] font-mono uppercase ${cls}`}>{impact}</span>
}
function CategoryBadge({ category }: { category: string }) {
  return <span className="px-1.5 py-0.5 rounded border border-line text-[10px] font-mono text-muted uppercase">{category}</span>
}
function impactBorder(impact: 'high' | 'medium' | 'low'): string {
  if (impact === 'high') return 'border-short/30'
  if (impact === 'medium') return 'border-warn/30'
  return 'border-line'
}
