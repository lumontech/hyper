import { useEffect, useState } from 'react'
import { api, type StrategyMeta } from '../services/api'
import { ONLINE_STRATEGIES, type OnlineStrategy } from '../data/online-strategies'

type Tab = 'adaptive' | 'library' | 'online'

export function Strategies() {
  const [items, setItems] = useState<StrategyMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('adaptive')

  useEffect(() => {
    api.strategies()
      .then(r => setItems(r.all))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const adaptive = items.filter(s => s.category === 'adaptive')
  const library = items.filter(s => s.category === 'library')

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-wide">Strategies</h1>
        <p className="text-xs text-muted mt-1">
          <strong className="text-gold">Adaptive</strong> = meta-strategie scritte da Claude (implementate).{' '}
          <strong className="text-text">Library</strong> = strategie atomiche (implementate).{' '}
          <strong className="text-blue-400">Online</strong> = knowledge base curata dai principali forum/repo Hyperliquid (reference, non implementate).
        </p>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-line">
        <TabBtn active={tab === 'adaptive'} onClick={() => setTab('adaptive')}>
          🤖 Adaptive <Count>{adaptive.length}</Count>
        </TabBtn>
        <TabBtn active={tab === 'library'} onClick={() => setTab('library')}>
          📚 Library <Count>{library.length}</Count>
        </TabBtn>
        <TabBtn active={tab === 'online'} onClick={() => setTab('online')}>
          🌐 Online <Count>{ONLINE_STRATEGIES.length}</Count>
        </TabBtn>
      </div>

      {error && <div className="p-3 rounded border border-short/40 bg-short/10 text-short text-xs">{error}</div>}
      {loading && tab !== 'online' && <div className="text-muted text-sm">caricamento…</div>}

      {tab === 'adaptive' && (
        <CategorySection
          subtitle="Meta-strategie che combinano regime detection + pattern + multi-confluence"
          items={adaptive}
          accent="border-gold/40 bg-gold/5"
        />
      )}

      {tab === 'library' && (
        <CategorySection
          subtitle="Strategie classiche di letteratura crypto: SMC, reversal, pivot, breakout, momentum"
          items={library}
          accent="border-line bg-panel"
        />
      )}

      {tab === 'online' && <OnlineCatalog />}
    </div>
  )
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
        active
          ? 'border-gold text-gold'
          : 'border-transparent text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

function Count({ children }: { children: React.ReactNode }) {
  return <span className="ml-1.5 px-1.5 py-0.5 rounded bg-bg border border-line text-[10px] font-mono text-muted">{children}</span>
}

// ────────────────────────────────────────────────────────────────────
// ADAPTIVE / LIBRARY (strategie implementate)
// ────────────────────────────────────────────────────────────────────

function CategorySection({ subtitle, items, accent }: { subtitle: string; items: StrategyMeta[]; accent: string }) {
  if (items.length === 0) return null
  return (
    <div className={`rounded-lg border ${accent} p-4`}>
      <p className="text-xs text-muted mb-4">{subtitle}</p>
      <div className="grid grid-cols-2 gap-3">
        {items.map(s => (
          <div key={s.id} className="rounded-lg border border-line bg-bg/50 p-4 fade-in">
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
    <div className="bg-panel rounded px-2 py-1.5 border border-line">
      <div className="text-muted text-[9px] uppercase tracking-wider">{label}</div>
      <div className={`mt-0.5 ${hi ? 'text-gold' : 'text-text'}`}>{value}</div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────
// ONLINE CATALOG (knowledge base curata)
// ────────────────────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, { label: string; color: string }> = {
  arbitrage:       { label: 'Arbitrage',      color: 'border-blue-400/40 bg-blue-400/10 text-blue-400' },
  'market-making': { label: 'Market Making',  color: 'border-purple-400/40 bg-purple-400/10 text-purple-400' },
  'mean-reversion':{ label: 'Mean Reversion', color: 'border-cyan-400/40 bg-cyan-400/10 text-cyan-400' },
  'delta-neutral': { label: 'Delta Neutral',  color: 'border-green-400/40 bg-green-400/10 text-green-400' },
  directional:     { label: 'Directional',    color: 'border-orange-400/40 bg-orange-400/10 text-orange-400' },
  specialty:       { label: 'Specialty',      color: 'border-pink-400/40 bg-pink-400/10 text-pink-400' },
}

const COMPLEXITY_COLOR: Record<string, string> = {
  low:     'text-green-400',
  medium:  'text-yellow-400',
  high:    'text-orange-400',
  extreme: 'text-red-400',
}

function OnlineCatalog() {
  const [categoryFilter, setCategoryFilter] = useState<string | 'all'>('all')
  const filtered = categoryFilter === 'all'
    ? ONLINE_STRATEGIES
    : ONLINE_STRATEGIES.filter(s => s.category === categoryFilter)

  const categories = Array.from(new Set(ONLINE_STRATEGIES.map(s => s.category)))

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-blue-400/30 bg-blue-400/5 p-4">
        <p className="text-xs text-muted leading-relaxed">
          📚 Strategie documentate sui principali forum, repo GitHub e blog di trading quantitativo per Hyperliquid.
          Questa è una <strong className="text-text">knowledge base reference</strong> — non sono implementate nel bot,
          servono per orientare i prossimi sviluppi. Ogni voce indica edge type, complessità, capitale tipico, pro/contro e fonti primarie.
        </p>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2">
        <FilterChip active={categoryFilter === 'all'} onClick={() => setCategoryFilter('all')}>
          Tutte ({ONLINE_STRATEGIES.length})
        </FilterChip>
        {categories.map(c => {
          const count = ONLINE_STRATEGIES.filter(s => s.category === c).length
          return (
            <FilterChip key={c} active={categoryFilter === c} onClick={() => setCategoryFilter(c)} colorClass={CATEGORY_LABEL[c]?.color}>
              {CATEGORY_LABEL[c]?.label ?? c} ({count})
            </FilterChip>
          )
        })}
      </div>

      {/* Cards */}
      <div className="space-y-3">
        {filtered.map(s => <OnlineCard key={s.id} s={s} />)}
      </div>
    </div>
  )
}

function FilterChip({ active, onClick, children, colorClass }: { active: boolean; onClick: () => void; children: React.ReactNode; colorClass?: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded-full text-[11px] font-medium transition-all border ${
        active
          ? (colorClass ?? 'border-gold/60 bg-gold/15 text-gold')
          : 'border-line bg-bg text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

function OnlineCard({ s }: { s: OnlineStrategy }) {
  const [expanded, setExpanded] = useState(false)
  const catStyle = CATEGORY_LABEL[s.category]

  return (
    <div className="rounded-lg border border-line bg-panel overflow-hidden fade-in">
      <div className="p-4 cursor-pointer hover:bg-bg/30 transition-colors" onClick={() => setExpanded(e => !e)}>
        <div className="flex items-start gap-3">
          <span className="text-3xl">{s.icon}</span>
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between gap-3 flex-wrap">
              <div className="font-semibold text-sm text-text">{s.name}</div>
              <div className="flex gap-2 flex-wrap items-center">
                {catStyle && (
                  <span className={`px-2 py-0.5 rounded text-[10px] font-mono border ${catStyle.color}`}>
                    {catStyle.label}
                  </span>
                )}
                <span className={`text-[10px] font-mono ${COMPLEXITY_COLOR[s.complexity]}`}>
                  {s.complexity.toUpperCase()}
                </span>
                <span className="text-[10px] text-muted">{expanded ? '▼' : '▶'}</span>
              </div>
            </div>
            <p className="text-xs text-muted mt-1.5 leading-relaxed">{s.shortDesc}</p>
            <div className="flex flex-wrap gap-3 mt-3 text-[10px] font-mono">
              <KV label="Return atteso" value={s.expectedReturn} hi />
              {s.expectedWR && <KV label="WR" value={s.expectedWR} />}
              <KV label="Edge" value={s.edgeType} />
              <KV label="Capitale" value={s.capital} />
              {s.recommendedTF && <KV label="TF" value={s.recommendedTF} />}
            </div>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-line bg-bg/30 p-4 space-y-3">
          <p className="text-xs text-text leading-relaxed">{s.longDesc}</p>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-green-400 mb-1">✓ Pro</div>
              <ul className="text-xs text-muted space-y-1">
                {s.pros.map((p, i) => <li key={i}>• {p}</li>)}
              </ul>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-red-400 mb-1">✗ Contro</div>
              <ul className="text-xs text-muted space-y-1">
                {s.cons.map((c, i) => <li key={i}>• {c}</li>)}
              </ul>
            </div>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-gold mb-1">Best for</div>
            <p className="text-xs text-text">{s.bestFor}</p>
          </div>

          <div>
            <div className="text-[10px] uppercase tracking-wider text-blue-400 mb-1">📎 Fonti</div>
            <div className="flex flex-col gap-1">
              {s.sources.map((src, i) => (
                <a key={i} href={src.url} target="_blank" rel="noopener noreferrer"
                   className="text-xs text-blue-400 hover:underline truncate">
                  → {src.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function KV({ label, value, hi }: { label: string; value: string; hi?: boolean }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted">{label}:</span>
      <span className={hi ? 'text-gold' : 'text-text'}>{value}</span>
    </div>
  )
}
