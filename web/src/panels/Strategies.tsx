import { useEffect, useState } from 'react'
import { api, type StrategyMeta } from '../services/api'

export function Strategies() {
  const [items, setItems] = useState<StrategyMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.strategies()
      .then(r => setItems(r.all))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-wide">Strategies</h1>
        <p className="text-xs text-muted mt-1">
          Strategie registrate. L'enable/disable si controlla via env <code className="text-gold">STRATEGY_ENABLED</code> (riavvio backend richiesto).
        </p>
      </div>

      {error && <div className="p-3 rounded border border-short/40 bg-short/10 text-short text-xs">{error}</div>}
      {loading && <div className="text-muted text-sm">caricamento…</div>}

      <div className="grid grid-cols-2 gap-3">
        {items.map(s => (
          <div key={s.id} className="rounded-lg border border-line bg-panel p-4 fade-in">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">{s.icon}</span>
                <div>
                  <div className="font-mono text-sm">{s.name}</div>
                  <div className="text-[10px] text-muted">{s.id} · {s.style}</div>
                </div>
              </div>
              <Badge enabled={s.enabled} />
            </div>

            <p className="text-xs text-muted mt-3 leading-relaxed">{s.desc}</p>

            <div className="grid grid-cols-4 gap-2 mt-4 text-[10px] font-mono">
              <Metric label="WR atteso" value={s.expectedWR} hi />
              <Metric label="SL ×ATR"   value={s.slMul.toString()} />
              <Metric label="TP ×ATR"   value={s.tpMul.toString()} />
              <Metric label="R:R"       value={(s.tpMul / s.slMul).toFixed(2)} />
            </div>

            <div className="mt-3 flex flex-wrap gap-1">
              {s.optimalTF.map(tf => (
                <span key={tf} className="px-1.5 py-0.5 rounded bg-bg border border-line text-[10px] font-mono text-muted">
                  {tf}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Badge({ enabled }: { enabled: boolean }) {
  return enabled
    ? <span className="px-2 py-0.5 rounded border border-long/40 bg-long/10 text-long text-[10px] font-mono">ENABLED</span>
    : <span className="px-2 py-0.5 rounded border border-line bg-bg text-muted text-[10px] font-mono">disabled</span>
}

function Metric({ label, value, hi }: { label: string; value: string; hi?: boolean }) {
  return (
    <div className="bg-bg rounded px-2 py-1.5 border border-line">
      <div className="text-muted text-[9px] uppercase tracking-wider">{label}</div>
      <div className={`mt-0.5 ${hi ? 'text-gold' : 'text-text'}`}>{value}</div>
    </div>
  )
}
