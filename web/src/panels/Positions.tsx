import { useEffect, useState } from 'react'
import { api } from '../services/api'

export function Positions() {
  const [positions, setPositions] = useState<unknown[]>([])
  const [equity, setEquity] = useState<unknown[]>([])
  const [note, setNote] = useState<string | null>(null)

  useEffect(() => {
    const tick = async () => {
      try {
        const p = await api.positions()
        const e = await api.equity()
        setPositions(p.positions)
        setEquity(e.curve)
        setNote(p.note ?? e.note ?? null)
      } catch {}
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-wide">Positions & Equity</h1>
        <p className="text-xs text-muted mt-1">
          Real-time positions + equity curve. Wiring completo in Sprint 3 (live-executor + DB).
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Section title="Open Positions">
          {positions.length === 0 ? (
            <Empty msg={note ?? 'Nessuna posizione aperta.'} />
          ) : (
            <pre className="text-xs font-mono text-text">{JSON.stringify(positions, null, 2)}</pre>
          )}
        </Section>

        <Section title="Equity Curve">
          {equity.length === 0 ? (
            <Empty msg={note ?? 'Equity curve vuota — nessun trade ancora chiuso.'} />
          ) : (
            <pre className="text-xs font-mono text-text">{JSON.stringify(equity.slice(-10), null, 2)}</pre>
          )}
        </Section>
      </div>

      <Section title="Sprint 3 — Cosa arriva">
        <ul className="text-xs text-muted space-y-1.5 list-disc list-inside">
          <li>Sottoscrizione WebSocket <code className="text-gold">userFills</code> Hyperliquid → fill in tempo reale</li>
          <li>Persistenza SQLite (tabelle <code>orders</code>, <code>fills</code>, <code>equity_curve</code>, <code>audit</code>)</li>
          <li>Position manager con SL/TP trigger nativi HL <code className="text-gold">tpsl</code></li>
          <li>Equity curve renderizzata in chart con DD highlight</li>
          <li>Audit log immutabile dei payload firmati (<code>data/audit/signed-payloads.log</code>)</li>
        </ul>
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
      <div className="p-4">{children}</div>
    </div>
  )
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="text-muted text-xs italic py-4 text-center">{msg}</div>
  )
}
