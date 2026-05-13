import { useEffect, useRef, useState } from 'react'
import { api } from '../services/api'
import { createChart, type IChartApi, type ISeriesApi } from 'lightweight-charts'

interface DemoData {
  startingBalance: number
  currentEquity: number
  pnl: number
  pnlPct: number
  trades: number
  wins: number
  losses: number
  winRate: number
  equityCurve: Array<{ ts: number; equity_usd: number; daily_pnl_usd: number | null }>
  recentFills: Array<Record<string, unknown>>
}

export function DemoAccount() {
  const [d, setD] = useState<DemoData | null>(null)
  const [funding, setFunding] = useState<Array<{ coin: string; funding: number; markPrice: number }>>([])

  useEffect(() => {
    const tick = async () => {
      try {
        const [demo, fr] = await Promise.all([api.demo(), api.funding()])
        setD(demo)
        setFunding(fr.data)
      } catch {}
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-semibold tracking-wide">Demo Trading €1000</h1>
        <p className="text-xs text-muted mt-1">
          Account simulato che parte da €1000. Ogni signal accettato dal bot apre una posizione virtuale.
          Posizione chiusa quando il mark price tocca SL/TP. P&L netto fee HL (0.045% taker × 2 round-trip) + slippage stimato.
        </p>
      </div>

      {!d ? (
        <div className="text-muted text-sm">caricamento...</div>
      ) : (
        <>
          {/* KPI cards */}
          <div className="grid grid-cols-6 gap-3">
            <Kpi label="Equity" value={`€${d.currentEquity.toFixed(2)}`} color="text-gold" big />
            <Kpi label="P&L" value={`${d.pnl >= 0 ? '+' : ''}€${d.pnl.toFixed(2)}`} color={d.pnl >= 0 ? 'text-long' : 'text-short'} />
            <Kpi label="P&L %" value={`${d.pnlPct >= 0 ? '+' : ''}${d.pnlPct.toFixed(2)}%`} color={d.pnlPct >= 0 ? 'text-long' : 'text-short'} />
            <Kpi label="Trades" value={String(d.trades)} />
            <Kpi label="Win rate" value={`${d.winRate.toFixed(0)}%`} color={d.winRate >= 50 ? 'text-long' : 'text-warn'} />
            <Kpi label="W/L" value={`${d.wins}/${d.losses}`} />
          </div>

          {/* Equity curve chart */}
          <Section title="Equity curve">
            {d.equityCurve.length < 2 ? (
              <Empty msg="Equity curve si popola appena il primo trade chiude (mark price tocca SL/TP)." />
            ) : (
              <EquityChart data={d.equityCurve} startingBalance={d.startingBalance} />
            )}
          </Section>

          {/* Recent fills */}
          <Section title={`Recent fills (${d.recentFills.length})`}>
            {d.recentFills.length === 0 ? (
              <Empty msg="Nessun fill ancora registrato. Il bot aspetta il primo signal accettato + chiusura su SL/TP." />
            ) : (
              <table className="w-full text-xs font-mono">
                <thead className="bg-bg/50 text-muted">
                  <tr>
                    <Th>Time</Th><Th>Coin</Th><Th>Dir</Th><Th right>Size</Th><Th right>Price</Th><Th right>Fee</Th><Th right>P&L</Th>
                  </tr>
                </thead>
                <tbody>
                  {d.recentFills.slice(0, 20).map((f, i) => {
                    const pnl = typeof f.pnl === 'number' ? f.pnl : null
                    return (
                      <tr key={String(f.id ?? i)} className="border-t border-line">
                        <Td>{new Date(Number(f.ts)).toLocaleTimeString('it-IT', { hour12: false })}</Td>
                        <Td><span className="text-gold">{String(f.coin)}</span></Td>
                        <Td><DirChip dir={String(f.direction)} /></Td>
                        <Td right>{Number(f.size).toFixed(4)}</Td>
                        <Td right>{Number(f.price).toFixed(2)}</Td>
                        <Td right className="text-muted">{Number(f.fee ?? 0).toFixed(3)}</Td>
                        <Td right className={pnl !== null && pnl > 0 ? 'text-long' : pnl !== null && pnl < 0 ? 'text-short' : 'text-muted'}>
                          {pnl !== null ? (pnl >= 0 ? '+' : '') + pnl.toFixed(2) : '·'}
                        </Td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </Section>

          {/* Funding rates HL — le "tasse orarie" su posizioni aperte */}
          <Section title="Funding Rates Hyperliquid (live)">
            <p className="text-xs text-muted mb-2">
              Costo orario per posizione aperta. <strong>Long paga</strong> se funding {'>'} 0; <strong>short riceve</strong>.
              HL settle ogni 1h. Il bot include queste fee nel P&L se la posizione resta aperta {'>'} 1h.
            </p>
            {funding.length === 0 ? (
              <Empty msg="Caricamento funding rates..." />
            ) : (
              <div className="grid grid-cols-5 gap-2">
                {funding.map(f => {
                  const pct = (f.funding * 100).toFixed(4)
                  const annualized = (f.funding * 24 * 365 * 100).toFixed(1)
                  const isHigh = Math.abs(f.funding) > 0.0001
                  return (
                    <div key={f.coin} className={`p-2 rounded border ${isHigh ? 'border-warn/40' : 'border-line'} bg-bg/40`}>
                      <div className="text-xs font-mono text-gold">{f.coin}</div>
                      <div className="mt-1 text-[10px] text-muted">funding/h</div>
                      <div className={`font-mono text-sm ${f.funding > 0 ? 'text-short' : f.funding < 0 ? 'text-long' : 'text-muted'}`}>
                        {pct}%
                      </div>
                      <div className="text-[10px] text-muted">~{annualized}%/y</div>
                    </div>
                  )
                })}
              </div>
            )}
          </Section>
        </>
      )}
    </div>
  )
}

function EquityChart({ data, startingBalance }: { data: Array<{ ts: number; equity_usd: number }>; startingBalance: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Area'> | null>(null)
  const baselineRef = useRef<ISeriesApi<'Line'> | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = createChart(ref.current, {
      width: ref.current.clientWidth,
      height: 280,
      layout: { background: { color: '#0a0e16' }, textColor: '#e5e9f0', attributionLogo: false } as never,
      grid: { vertLines: { color: '#1a2030' }, horzLines: { color: '#1a2030' } },
      timeScale: { borderColor: '#1a2030', timeVisible: true },
      rightPriceScale: { borderColor: '#1a2030' },
    })
    const area = chart.addAreaSeries({
      lineColor: '#f5c842',
      topColor: 'rgba(245, 200, 66, 0.3)',
      bottomColor: 'rgba(245, 200, 66, 0.0)',
      lineWidth: 2,
    })
    const baseline = chart.addLineSeries({
      color: '#7a8398',
      lineWidth: 1,
      lineStyle: 2,   // dashed
    })
    chartRef.current = chart
    seriesRef.current = area
    baselineRef.current = baseline

    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth })
    })
    ro.observe(ref.current)
    return () => { ro.disconnect(); chart.remove() }
  }, [])

  useEffect(() => {
    if (!seriesRef.current || !baselineRef.current || data.length === 0) return
    const pts = data.map(p => ({ time: Math.floor(p.ts / 1000) as never, value: p.equity_usd }))
    seriesRef.current.setData(pts)
    baselineRef.current.setData(pts.map(p => ({ time: p.time, value: startingBalance })))
    chartRef.current?.timeScale().fitContent()
  }, [data, startingBalance])

  return <div ref={ref} className="w-full" />
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
function Empty({ msg }: { msg: string }) { return <div className="text-muted text-xs italic py-3 text-center">{msg}</div> }
function DirChip({ dir }: { dir: string }) {
  const cls = dir === 'long' ? 'bg-long/15 border-long/40 text-long' : 'bg-short/15 border-short/40 text-short'
  return <span className={`px-1.5 py-0.5 rounded border text-[10px] ${cls}`}>{dir.toUpperCase()}</span>
}
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-2 py-1.5 ${right ? 'text-right' : 'text-left'} font-normal`}>{children}</th>
}
function Td({ children, right, className }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={`px-2 py-1.5 ${right ? 'text-right tabular-nums' : ''} ${className ?? ''}`}>{children}</td>
}
