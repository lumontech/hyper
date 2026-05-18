import { useEffect, useRef, useState } from 'react'
import { createChart, type IChartApi, type ISeriesApi } from 'lightweight-charts'
import { api, type Position, type FillRow } from '../services/api'
import { useStore } from '../store/store'

export function Positions() {
  const [positions, setPositions] = useState<Position[]>([])
  const [equity, setEquity] = useState<Array<{ ts: number; equity_usd: number }>>([])
  const [fills, setFills] = useState<FillRow[]>([])
  const [demoEquity, setDemoEquity] = useState<number | null>(null)
  const [startingBalance, setStartingBalance] = useState(1000)
  const mids = useStore(s => s.mids)

  useEffect(() => {
    const tick = async () => {
      try {
        const [p, e, f, d] = await Promise.all([
          api.positions(),
          api.equity(),
          api.fills(),
          api.demo(),
        ])
        setPositions(p.positions ?? [])
        setEquity(e.curve ?? [])
        setFills(f.fills ?? [])
        setDemoEquity(d.currentEquity)
        setStartingBalance(d.startingBalance)
      } catch { /* ignore transient */ }
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => clearInterval(id)
  }, [])

  const totalUnrealized = positions.reduce((sum, p) => {
    const mid = mids[p.coin]
    if (!mid) return sum
    const pnl = p.direction === 'long'
      ? (mid - p.entryPrice) * p.size
      : (p.entryPrice - mid) * p.size
    return sum + pnl
  }, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-lg font-semibold tracking-wide">Positions &amp; Equity</h1>
          <p className="text-xs text-muted mt-1">
            Posizioni aperte in tempo reale, equity curve demo e ultimi fill registrati.
          </p>
        </div>
        <div className="text-right text-xs">
          <div className="text-muted uppercase tracking-wider">Demo Equity</div>
          <div className="text-lg font-mono text-gold">
            ${demoEquity !== null ? demoEquity.toFixed(2) : '—'}
          </div>
          {demoEquity !== null && (
            <div className={`font-mono ${demoEquity >= startingBalance ? 'text-green' : 'text-red'}`}>
              {demoEquity >= startingBalance ? '+' : ''}
              {((demoEquity - startingBalance) / startingBalance * 100).toFixed(2)}%
            </div>
          )}
        </div>
      </div>

      <Section title={`Open Positions (${positions.length})`}>
        {positions.length === 0 ? (
          <Empty msg="Nessuna posizione aperta. Il bot apre solo quando il signal supera tie-breaker + pattern check." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-muted uppercase tracking-wider border-b border-line">
                <tr>
                  <th className="text-left py-2 px-3">Coin</th>
                  <th className="text-left py-2 px-3">Side</th>
                  <th className="text-right py-2 px-3">Size</th>
                  <th className="text-right py-2 px-3">Entry</th>
                  <th className="text-right py-2 px-3">Mid</th>
                  <th className="text-right py-2 px-3">SL</th>
                  <th className="text-right py-2 px-3">TP</th>
                  <th className="text-right py-2 px-3">uPnL</th>
                  <th className="text-left py-2 px-3">Strategia</th>
                  <th className="text-right py-2 px-3">Età</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {positions.map(p => {
                  const mid = mids[p.coin]
                  const upnl = mid
                    ? (p.direction === 'long' ? (mid - p.entryPrice) : (p.entryPrice - mid)) * p.size
                    : null
                  const ageMin = Math.floor((Date.now() - p.openedAt) / 60000)
                  return (
                    <tr key={p.coin} className="border-b border-line/50">
                      <td className="py-2 px-3 font-semibold">{p.coin}</td>
                      <td className={`py-2 px-3 ${p.direction === 'long' ? 'text-green' : 'text-red'}`}>
                        {p.direction.toUpperCase()}
                      </td>
                      <td className="text-right py-2 px-3">{p.size.toFixed(4)}</td>
                      <td className="text-right py-2 px-3">${p.entryPrice.toFixed(2)}</td>
                      <td className="text-right py-2 px-3">{mid ? `$${mid.toFixed(2)}` : '—'}</td>
                      <td className="text-right py-2 px-3 text-red/80">${p.stopLoss.toFixed(2)}</td>
                      <td className="text-right py-2 px-3 text-green/80">${p.takeProfit.toFixed(2)}</td>
                      <td className={`text-right py-2 px-3 ${upnl === null ? 'text-muted' : upnl >= 0 ? 'text-green' : 'text-red'}`}>
                        {upnl !== null ? `${upnl >= 0 ? '+' : ''}$${upnl.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-2 px-3 text-muted">{p.strategyId}</td>
                      <td className="text-right py-2 px-3 text-muted">{ageMin}m</td>
                    </tr>
                  )
                })}
              </tbody>
              {positions.length > 1 && (
                <tfoot>
                  <tr>
                    <td colSpan={7} className="text-right py-2 px-3 text-muted text-xs uppercase">Total uPnL</td>
                    <td className={`text-right py-2 px-3 font-mono ${totalUnrealized >= 0 ? 'text-green' : 'text-red'}`}>
                      {totalUnrealized >= 0 ? '+' : ''}${totalUnrealized.toFixed(2)}
                    </td>
                    <td colSpan={2}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </Section>

      <Section title="Equity Curve (snapshot 1/min)">
        {equity.length === 0 ? (
          <Empty msg="Equity curve ancora vuota — primo snapshot tra ≤60s dal boot." />
        ) : (
          <EquityChart data={equity} startingBalance={startingBalance} />
        )}
      </Section>

      <Section title={`Recent Fills (${fills.length})`}>
        {fills.length === 0 ? (
          <Empty msg="Nessun fill ancora registrato." />
        ) : (
          <div className="overflow-x-auto max-h-[400px]">
            <table className="w-full text-xs">
              <thead className="text-muted uppercase tracking-wider border-b border-line sticky top-0 bg-panel">
                <tr>
                  <th className="text-left py-2 px-3">Quando</th>
                  <th className="text-left py-2 px-3">Coin</th>
                  <th className="text-left py-2 px-3">Side</th>
                  <th className="text-right py-2 px-3">Size</th>
                  <th className="text-right py-2 px-3">Price</th>
                  <th className="text-right py-2 px-3">Fee</th>
                  <th className="text-right py-2 px-3">PnL</th>
                  <th className="text-left py-2 px-3">Close?</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {fills.slice(0, 50).map(f => {
                  const when = new Date(f.ts).toLocaleString()
                  const pnl = f.pnl
                  return (
                    <tr key={f.id} className="border-b border-line/50">
                      <td className="py-1.5 px-3 text-muted">{when}</td>
                      <td className="py-1.5 px-3 font-semibold">{f.coin}</td>
                      <td className={`py-1.5 px-3 ${f.direction === 'long' ? 'text-green' : 'text-red'}`}>
                        {f.direction.toUpperCase()}
                      </td>
                      <td className="text-right py-1.5 px-3">{f.size.toFixed(4)}</td>
                      <td className="text-right py-1.5 px-3">${f.price.toFixed(2)}</td>
                      <td className="text-right py-1.5 px-3 text-muted">${f.fee.toFixed(2)}</td>
                      <td className={`text-right py-1.5 px-3 ${pnl === null ? 'text-muted' : pnl >= 0 ? 'text-green' : 'text-red'}`}>
                        {pnl !== null ? `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-1.5 px-3">{f.is_close ? '✓' : ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
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
      <div className="p-4">{children}</div>
    </div>
  )
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="text-muted text-xs italic py-4 text-center">{msg}</div>
  )
}

function EquityChart({ data, startingBalance }: { data: Array<{ ts: number; equity_usd: number }>; startingBalance: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const areaRef = useRef<ISeriesApi<'Area'> | null>(null)
  const baselineRef = useRef<ISeriesApi<'Line'> | null>(null)

  useEffect(() => {
    if (!ref.current) return
    const chart = createChart(ref.current, {
      width: ref.current.clientWidth,
      height: 320,
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
      lineStyle: 2,
    })
    chartRef.current = chart
    areaRef.current = area
    baselineRef.current = baseline
    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth })
    })
    ro.observe(ref.current)
    return () => { ro.disconnect(); chart.remove() }
  }, [])

  useEffect(() => {
    if (!areaRef.current || !baselineRef.current || data.length === 0) return
    const pts = data.map(p => ({ time: Math.floor(p.ts / 1000) as never, value: p.equity_usd }))
    areaRef.current.setData(pts)
    baselineRef.current.setData(pts.map(p => ({ time: p.time, value: startingBalance })))
    chartRef.current?.timeScale().fitContent()
  }, [data, startingBalance])

  return <div ref={ref} className="w-full" />
}
