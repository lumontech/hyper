import { useState } from 'react'
import { api, type BacktestResult } from '../services/api'

interface Row {
  coin: string
  strategy: string
  result: BacktestResult | { error: string }
}

export function Backtest() {
  const [days, setDays] = useState(30)
  const [running, setRunning] = useState(false)
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState<string | null>(null)

  const runAll = async () => {
    setRunning(true); setError(null); setRows([])
    try {
      const out = await api.backtestAll(days)
      setRows(out.results)
    } catch (e) {
      setError(String(e))
    } finally {
      setRunning(false)
    }
  }

  const valid = rows.filter(r => !('error' in r.result)) as Array<{ coin: string; strategy: string; result: BacktestResult }>
  const sorted = [...valid].sort((a, b) => b.result.summary.profitFactor - a.result.summary.profitFactor)

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-wide">Backtest Lab</h1>
          <p className="text-xs text-muted mt-1">
            Esegue ogni strategia abilitata su ogni coin con dati Hyperliquid reali.
            Stessa logica del Simulator: 1% risk per trade compounding, SL/TP ATR-based, fee HL 0.045% + slippage 0.02%.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex bg-panel border border-line rounded overflow-hidden">
            {[30, 60, 90].map(d => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 text-xs font-mono transition
                  ${d === days ? 'bg-gold/20 text-gold' : 'text-muted hover:text-text'}`}
              >
                {d}d
              </button>
            ))}
          </div>
          <button
            onClick={runAll}
            disabled={running}
            className="px-4 py-1.5 rounded bg-gold/20 border border-gold/50 text-gold text-xs font-semibold hover:bg-gold/30 transition disabled:opacity-40"
          >
            {running ? 'Running…' : `RUN ${days}d`}
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded border border-short/40 bg-short/10 text-short text-xs">{error}</div>
      )}

      {sorted.length > 0 && (
        <div className="rounded-lg border border-line bg-panel overflow-hidden">
          <table className="w-full text-xs font-mono">
            <thead className="bg-bg/50 text-muted">
              <tr>
                <Th>Rank</Th>
                <Th>Coin</Th>
                <Th>Strategy</Th>
                <Th right>Trades</Th>
                <Th right>WR</Th>
                <Th right>PF</Th>
                <Th right>avg R</Th>
                <Th right>PnL %</Th>
                <Th right>Max DD</Th>
                <Th>Sig</Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r, i) => {
                const s = r.result.summary
                const pfClass = s.profitFactor >= 1.4 ? 'text-long' : s.profitFactor >= 1.0 ? 'text-warn' : 'text-short'
                const pnlClass = r.result.pnlPct >= 0 ? 'text-long' : 'text-short'
                const wrClass = s.winRate >= 0.6 ? 'text-long' : s.winRate >= 0.5 ? 'text-warn' : 'text-short'
                return (
                  <tr key={`${r.coin}-${r.strategy}`} className="border-t border-line hover:bg-bg/40">
                    <Td>#{i + 1}</Td>
                    <Td><span className="text-gold">{r.coin}</span></Td>
                    <Td>{r.strategy}</Td>
                    <Td right>{s.total}</Td>
                    <Td right><span className={wrClass}>{(s.winRate * 100).toFixed(1)}%</span></Td>
                    <Td right><span className={pfClass}>{Number.isFinite(s.profitFactor) ? s.profitFactor.toFixed(2) : '∞'}</span></Td>
                    <Td right>{s.avgRR.toFixed(2)}</Td>
                    <Td right><span className={pnlClass}>{r.result.pnlPct.toFixed(1)}</span></Td>
                    <Td right>{r.result.maxDrawdownPct.toFixed(1)}</Td>
                    <Td><span className="text-muted">{s.significance}</span></Td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length === 0 && !running && (
        <div className="rounded-lg border border-dashed border-line p-8 text-center text-muted text-sm">
          Premi <span className="text-gold">RUN {days}d</span> per eseguire il backtest su tutte le combinazioni strategia × coin.
        </div>
      )}

      {running && (
        <div className="rounded-lg border border-line bg-panel p-6 flex items-center gap-3 text-sm">
          <div className="w-2 h-2 rounded-full bg-gold pulse-dot" />
          <span className="text-muted">Fetching {days}d × 5 coin × strategie attive…</span>
        </div>
      )}
    </div>
  )
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 ${right ? 'text-right' : 'text-left'} font-normal`}>{children}</th>
}
function Td({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <td className={`px-3 py-2 ${right ? 'text-right tabular-nums' : ''}`}>{children}</td>
}
