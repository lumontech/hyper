import { useEffect, useState } from 'react'
import { api, type RouterSnapshot, type Position, type OrderRow, type FillRow } from '../services/api'

export function AutoTrader() {
  const [router, setRouter] = useState<RouterSnapshot | null>(null)
  const [positions, setPositions] = useState<Position[]>([])
  const [orders, setOrders] = useState<OrderRow[]>([])
  const [fills, setFills] = useState<FillRow[]>([])
  const [autonomous, setAutonomous] = useState(false)

  useEffect(() => {
    const tick = async () => {
      try {
        const [r, p, o, f, s] = await Promise.all([
          api.router(), api.positions(), api.orders(), api.fills(), api.status(),
        ])
        setRouter(r as RouterSnapshot)
        setPositions((p.positions ?? []) as Position[])
        setOrders((o.orders ?? []) as OrderRow[])
        setFills((f.fills ?? []) as FillRow[])
        setAutonomous(s.autonomous ?? false)
      } catch {}
    }
    tick()
    const id = setInterval(tick, 3000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-wide">Auto-Trader</h1>
          <p className="text-xs text-muted mt-1">
            Loop autonomo: ad ogni close di candela il router valuta tutte le strategie attive su tutti i coin, applica risk-manager, e firma se passa.
          </p>
        </div>
        <div className={`px-3 py-1.5 rounded border text-xs font-mono ${autonomous ? 'border-long/40 bg-long/10 text-long' : 'border-warn/40 bg-warn/10 text-warn'}`}>
          {autonomous ? '● ACTIVE' : '○ INACTIVE'}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-5 gap-3">
        <Kpi label="Signals 24h" value={router?.signalsGenerated ?? 0} />
        <Kpi label="Orders attempted" value={router?.ordersAttempted ?? 0} />
        <Kpi label="Accepted" value={router?.ordersAccepted ?? 0} color="text-long" />
        <Kpi label="Rejected" value={router?.ordersRejected ?? 0} color="text-warn" />
        <Kpi label="Open positions" value={positions.length} color="text-gold" />
      </div>

      {/* Live signals feed */}
      <Section title="Signals feed (last 50)">
        {(!router?.lastSignals || router.lastSignals.length === 0) ? (
          <Empty msg="Nessun segnale ancora. Il router valuta ad ogni close di candela." />
        ) : (
          <div className="max-h-[280px] overflow-auto">
            <table className="w-full text-xs font-mono">
              <thead className="bg-bg/50 text-muted sticky top-0">
                <tr>
                  <Th>Time</Th><Th>Coin</Th><Th>Strategy</Th><Th>Dir</Th><Th>Reason</Th><Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {router.lastSignals.map((s, i) => (
                  <tr key={i} className="border-t border-line hover:bg-bg/40">
                    <Td>{new Date(s.ts).toLocaleTimeString('it-IT', { hour12: false })}</Td>
                    <Td><span className="text-gold">{s.coin}</span></Td>
                    <Td>{s.strategy}</Td>
                    <Td><DirChip dir={s.direction} /></Td>
                    <Td className="text-muted truncate max-w-[280px]">{s.reason}</Td>
                    <Td><StatusChip status={s.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Positions live */}
      <Section title="Open positions">
        {positions.length === 0 ? (
          <Empty msg="Nessuna posizione aperta." />
        ) : (
          <table className="w-full text-xs font-mono">
            <thead className="bg-bg/50 text-muted">
              <tr>
                <Th>Coin</Th><Th>Dir</Th><Th right>Size</Th><Th right>Entry</Th><Th right>SL</Th><Th right>TP</Th><Th>Strategy</Th><Th>Opened</Th>
              </tr>
            </thead>
            <tbody>
              {positions.map(p => (
                <tr key={p.coin} className="border-t border-line">
                  <Td><span className="text-gold">{p.coin}</span></Td>
                  <Td><DirChip dir={p.direction} /></Td>
                  <Td right>{p.size}</Td>
                  <Td right>{p.entryPrice}</Td>
                  <Td right className="text-short">{p.stopLoss}</Td>
                  <Td right className="text-long">{p.takeProfit}</Td>
                  <Td>{p.strategyId}</Td>
                  <Td>{new Date(p.openedAt).toLocaleTimeString('it-IT', { hour12: false })}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      {/* Orders + Fills */}
      <div className="grid grid-cols-2 gap-3">
        <Section title="Recent orders">
          {orders.length === 0 ? <Empty msg="Nessun ordine registrato." /> : (
            <div className="max-h-[240px] overflow-auto">
              <table className="w-full text-[11px] font-mono">
                <thead className="bg-bg/50 text-muted sticky top-0">
                  <tr><Th>Time</Th><Th>Coin</Th><Th>Dir</Th><Th right>Size</Th><Th>Strat</Th><Th>Status</Th></tr>
                </thead>
                <tbody>
                  {orders.map(o => (
                    <tr key={String(o.id)} className="border-t border-line">
                      <Td>{new Date(o.ts).toLocaleTimeString('it-IT', { hour12: false })}</Td>
                      <Td><span className="text-gold">{o.coin}</span></Td>
                      <Td><DirChip dir={o.direction} /></Td>
                      <Td right>{o.size}</Td>
                      <Td>{o.strategy_id}</Td>
                      <Td>{o.dry_run ? <span className="text-warn">DRY</span> : <span className="text-long">LIVE</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Recent fills">
          {fills.length === 0 ? <Empty msg="Nessun fill ricevuto." /> : (
            <div className="max-h-[240px] overflow-auto">
              <table className="w-full text-[11px] font-mono">
                <thead className="bg-bg/50 text-muted sticky top-0">
                  <tr><Th>Time</Th><Th>Coin</Th><Th>Dir</Th><Th right>Price</Th><Th right>PnL</Th></tr>
                </thead>
                <tbody>
                  {fills.map(f => (
                    <tr key={String(f.id)} className="border-t border-line">
                      <Td>{new Date(f.ts).toLocaleTimeString('it-IT', { hour12: false })}</Td>
                      <Td><span className="text-gold">{f.coin}</span></Td>
                      <Td><DirChip dir={f.direction} /></Td>
                      <Td right>{f.price}</Td>
                      <Td right className={f.pnl && f.pnl > 0 ? 'text-long' : f.pnl && f.pnl < 0 ? 'text-short' : 'text-muted'}>
                        {f.pnl !== null && f.pnl !== undefined ? f.pnl.toFixed(2) : '·'}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}

function Kpi({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div className="bg-panel border border-line rounded p-3">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`mt-1 text-2xl font-mono ${color ?? ''}`}>{value}</div>
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

function DirChip({ dir }: { dir: string }) {
  const cls = dir === 'long' ? 'bg-long/15 border-long/40 text-long' : 'bg-short/15 border-short/40 text-short'
  return <span className={`px-1.5 py-0.5 rounded border text-[10px] ${cls}`}>{dir.toUpperCase()}</span>
}

function StatusChip({ status }: { status: string }) {
  let cls = 'bg-line border-line text-muted'
  if (status.startsWith('accepted')) cls = 'bg-long/15 border-long/40 text-long'
  else if (status.startsWith('rejected')) cls = 'bg-warn/15 border-warn/40 text-warn'
  else if (status.startsWith('skipped')) cls = 'bg-line border-line text-muted'
  return <span className={`px-1.5 py-0.5 rounded border text-[10px] ${cls}`}>{status}</span>
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-2 py-1.5 ${right ? 'text-right' : 'text-left'} font-normal`}>{children}</th>
}
function Td({ children, right, className }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={`px-2 py-1.5 ${right ? 'text-right tabular-nums' : ''} ${className ?? ''}`}>{children}</td>
}
