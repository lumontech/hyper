import { useEffect, useState } from 'react'
import { api } from '../services/api'

interface HealthData {
  score: number
  color: 'green' | 'yellow' | 'red'
  label: 'HEALTHY' | 'WARNING' | 'CRITICAL' | 'COLLECTING_DATA'
  uptime: number
  demoEquity: number
  startingBalance: number
  pnl: number
  pnlPct: number
  trades: number
  wins: number
  losses: number
  winRate: number
  profitFactor: number
  maxDrawdown: { peak: number; trough: number; ddPct: number; ddUsd: number }
  router: { signalsGenerated: number; ordersAttempted: number; ordersAccepted: number; acceptRate: number }
  perStrategy: Array<{ strategy_id: string; trades: number; wins: number; losses: number; total_pnl: number; win_rate: number; profit_factor: number }>
  checks: Array<{ name: string; ok: boolean; value: string; target: string }>
}

export function Health() {
  const [h, setH] = useState<HealthData | null>(null)

  useEffect(() => {
    const tick = async () => {
      try { setH(await api.health()) } catch {}
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => clearInterval(id)
  }, [])

  if (!h) return <div className="text-muted text-sm">caricamento health...</div>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-wide">Bot Health</h1>
        <p className="text-xs text-muted mt-1">
          Dashboard "sta andando bene?" — score globale + breakdown per strategia + check pre-LIVE.
          Aggiornato ogni 5s.
        </p>
      </div>

      {/* Health Score globale (semaforo) */}
      <div className={`rounded-lg border-2 p-6 ${borderClass(h.color)}`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-wider text-muted">Health Score</div>
            <div className={`text-5xl font-mono font-bold mt-1 ${textClass(h.color)}`}>
              {h.score}/100
            </div>
            <div className={`text-sm font-mono mt-1 ${textClass(h.color)}`}>
              {labelEmoji(h.color)} {h.label}
            </div>
          </div>
          <div className="text-right text-xs font-mono text-muted">
            <div>Uptime: {formatUptime(h.uptime)}</div>
            <div className="mt-1">Strategie attive: 10 (1 adaptive + 9 library)</div>
          </div>
        </div>
      </div>

      {/* Top-level KPI row */}
      <div className="grid grid-cols-6 gap-3">
        <Kpi label="Equity demo" value={`€${h.demoEquity.toFixed(2)}`} color="text-gold" big />
        <Kpi label="P&L totale" value={`${h.pnl >= 0 ? '+' : ''}€${h.pnl.toFixed(2)}`} color={h.pnl >= 0 ? 'text-long' : 'text-short'} />
        <Kpi label="P&L %" value={`${h.pnlPct >= 0 ? '+' : ''}${h.pnlPct.toFixed(2)}%`} color={h.pnl >= 0 ? 'text-long' : 'text-short'} />
        <Kpi label="Trade chiusi" value={String(h.trades)} />
        <Kpi label="Win rate" value={`${h.winRate.toFixed(0)}%`} color={h.winRate >= 50 ? 'text-long' : 'text-warn'} />
        <Kpi label="Profit Factor" value={h.profitFactor === 99 ? '∞' : h.profitFactor.toFixed(2)} color={h.profitFactor >= 1.4 ? 'text-long' : h.profitFactor >= 1 ? 'text-warn' : 'text-short'} />
      </div>

      {/* Checks pre-LIVE (criteri "go live") */}
      <Section title="Criteri 'GO LIVE' (a fine M3)">
        <p className="text-xs text-muted mb-3">5 check da superare per passare in LIVE. Più verdi = pronto.</p>
        <div className="grid grid-cols-5 gap-2">
          {h.checks.map(c => (
            <div key={c.name} className={`p-2 rounded border ${c.ok ? 'border-long/40 bg-long/5' : 'border-line bg-bg/30'}`}>
              <div className={`text-[10px] uppercase tracking-wider ${c.ok ? 'text-long' : 'text-muted'}`}>
                {c.ok ? '✓' : '○'} {c.name}
              </div>
              <div className="font-mono text-sm mt-1">{c.value}</div>
              <div className="text-[10px] text-muted">target {c.target}</div>
            </div>
          ))}
        </div>
      </Section>

      {/* Activity Router */}
      <Section title="Attività router (signal pipeline)">
        <div className="grid grid-cols-4 gap-3">
          <Kpi label="Signals" value={String(h.router.signalsGenerated)} />
          <Kpi label="Orders attempted" value={String(h.router.ordersAttempted)} />
          <Kpi label="Orders accepted" value={String(h.router.ordersAccepted)} color="text-long" />
          <Kpi label="Accept rate" value={`${h.router.acceptRate.toFixed(0)}%`} color={h.router.acceptRate >= 50 ? 'text-long' : 'text-warn'} />
        </div>
      </Section>

      {/* Max Drawdown */}
      <Section title="Max Drawdown osservato">
        <div className="grid grid-cols-4 gap-3">
          <Kpi label="Peak equity" value={`€${h.maxDrawdown.peak.toFixed(2)}`} color="text-gold" />
          <Kpi label="Trough equity" value={`€${h.maxDrawdown.trough.toFixed(2)}`} color="text-short" />
          <Kpi label="DD USD" value={`€${h.maxDrawdown.ddUsd.toFixed(2)}`} color={h.maxDrawdown.ddPct < 20 ? 'text-long' : 'text-short'} />
          <Kpi label="DD %" value={`${h.maxDrawdown.ddPct.toFixed(2)}%`} color={h.maxDrawdown.ddPct < 20 ? 'text-long' : 'text-short'} />
        </div>
      </Section>

      {/* Per Strategy breakdown */}
      <Section title={`Breakdown per strategia (${h.perStrategy.length})`}>
        {h.perStrategy.length === 0 ? (
          <div className="text-muted text-xs italic py-3 text-center">
            Nessun trade chiuso ancora. Compari qui dopo i primi fill su SL/TP.
          </div>
        ) : (
          <table className="w-full text-xs font-mono">
            <thead className="bg-bg/50 text-muted">
              <tr>
                <Th>Strategia</Th>
                <Th right>Trades</Th>
                <Th right>W</Th>
                <Th right>L</Th>
                <Th right>WR</Th>
                <Th right>PF</Th>
                <Th right>P&L Tot</Th>
              </tr>
            </thead>
            <tbody>
              {h.perStrategy.map(s => {
                const pnlCls = s.total_pnl > 0 ? 'text-long' : s.total_pnl < 0 ? 'text-short' : 'text-muted'
                const wrCls = s.win_rate >= 60 ? 'text-long' : s.win_rate >= 50 ? 'text-warn' : 'text-short'
                const pfCls = s.profit_factor >= 1.4 ? 'text-long' : s.profit_factor >= 1 ? 'text-warn' : 'text-short'
                return (
                  <tr key={s.strategy_id} className="border-t border-line">
                    <Td><span className="text-gold">{s.strategy_id}</span></Td>
                    <Td right>{s.trades}</Td>
                    <Td right className="text-long">{s.wins}</Td>
                    <Td right className="text-short">{s.losses}</Td>
                    <Td right className={wrCls}>{s.win_rate.toFixed(0)}%</Td>
                    <Td right className={pfCls}>{s.profit_factor === 99 ? '∞' : s.profit_factor.toFixed(2)}</Td>
                    <Td right className={pnlCls}>{s.total_pnl >= 0 ? '+' : ''}€{s.total_pnl.toFixed(2)}</Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  )
}

function borderClass(c: 'green' | 'yellow' | 'red'): string {
  return c === 'green' ? 'border-long/60 bg-long/5' : c === 'yellow' ? 'border-warn/60 bg-warn/5' : 'border-short/60 bg-short/5'
}
function textClass(c: 'green' | 'yellow' | 'red'): string {
  return c === 'green' ? 'text-long' : c === 'yellow' ? 'text-warn' : 'text-short'
}
function labelEmoji(c: 'green' | 'yellow' | 'red'): string {
  return c === 'green' ? '🟢' : c === 'yellow' ? '🟡' : '🔴'
}
function formatUptime(s: number): string {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}
function Kpi({ label, value, color, big }: { label: string; value: string; color?: string; big?: boolean }) {
  return (
    <div className="bg-panel border border-line rounded p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 font-mono ${big ? 'text-2xl' : 'text-lg'} ${color ?? ''}`}>{value}</div>
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
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-2 py-1.5 ${right ? 'text-right' : 'text-left'} font-normal`}>{children}</th>
}
function Td({ children, right, className }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={`px-2 py-1.5 ${right ? 'text-right tabular-nums' : ''} ${className ?? ''}`}>{children}</td>
}
