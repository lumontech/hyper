import { useEffect, useRef, useState } from 'react'
import { useStore, COINS } from '../store/store'
import { api, type Candle } from '../services/api'
import { createChart, type IChartApi, type ISeriesApi } from 'lightweight-charts'

export function Dashboard() {
  const mids = useStore(s => s.mids)
  const selectedCoin = useStore(s => s.selectedCoin)
  const setSelectedCoin = useStore(s => s.setSelectedCoin)

  const [prev, setPrev] = useState<Record<string, number>>({})
  useEffect(() => {
    const id = setInterval(() => setPrev({ ...mids }), 5000)
    return () => clearInterval(id)
  }, [mids])

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold tracking-wide">Live Dashboard</h1>

      <div className="grid grid-cols-5 gap-3">
        {COINS.map(coin => {
          const price = mids[coin]
          const prevPrice = prev[coin]
          const delta = price && prevPrice ? ((price - prevPrice) / prevPrice) * 100 : 0
          const isSelected = selectedCoin === coin
          return (
            <button
              key={coin}
              onClick={() => setSelectedCoin(coin)}
              className={`p-4 rounded-lg border bg-panel text-left transition
                ${isSelected ? 'border-gold' : 'border-line hover:border-line/60'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted font-mono">{coin}USDC</span>
                {price ? <span className="w-1.5 h-1.5 rounded-full bg-long pulse-dot" /> : null}
              </div>
              <div className="font-mono text-xl mt-1">
                {price ? formatPrice(price, coin) : <span className="text-muted">—</span>}
              </div>
              <div className={`text-xs font-mono mt-1 ${delta > 0 ? 'text-long' : delta < 0 ? 'text-short' : 'text-muted'}`}>
                {delta > 0 ? '▲' : delta < 0 ? '▼' : '·'} {Math.abs(delta).toFixed(3)}%
              </div>
            </button>
          )
        })}
      </div>

      <ChartPanel coin={selectedCoin} />
    </div>
  )
}

function ChartPanel({ coin }: { coin: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [tf, setTf] = useState('15m')

  useEffect(() => {
    if (!ref.current) return
    const chart = createChart(ref.current, {
      width: ref.current.clientWidth,
      height: 380,
      layout: { background: { color: '#0a0e16' }, textColor: '#e5e9f0' },
      grid:   { vertLines: { color: '#1a2030' }, horzLines: { color: '#1a2030' } },
      timeScale: { borderColor: '#1a2030', timeVisible: true },
      rightPriceScale: { borderColor: '#1a2030' },
      crosshair: { mode: 1 },
    })
    const series = chart.addCandlestickSeries({
      upColor: '#00e096', downColor: '#ff3355',
      borderUpColor: '#00e096', borderDownColor: '#ff3355',
      wickUpColor: '#00e096', wickDownColor: '#ff3355',
    })
    chartRef.current = chart
    seriesRef.current = series

    const ro = new ResizeObserver(() => {
      if (ref.current) chart.applyOptions({ width: ref.current.clientWidth })
    })
    ro.observe(ref.current)

    return () => { ro.disconnect(); chart.remove() }
  }, [])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr(null)
    api.candles(coin, tf, 300)
      .then(r => {
        if (cancelled) return
        seriesRef.current?.setData(r.candles.map(c => ({
          time: c.time as never,
          open: c.open, high: c.high, low: c.low, close: c.close,
        })))
        chartRef.current?.timeScale().fitContent()
      })
      .catch(e => { if (!cancelled) setErr(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [coin, tf])

  return (
    <div className="rounded-lg border border-line bg-panel p-3">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-mono text-sm">{coin}USDC · {tf}</h2>
        <div className="flex gap-1">
          {['5m', '15m', '1h', '4h', '1D'].map(t => (
            <button
              key={t}
              onClick={() => setTf(t)}
              className={`px-2 py-1 text-xs font-mono rounded transition
                ${t === tf ? 'bg-gold/20 text-gold border border-gold/40' : 'text-muted hover:text-text'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div ref={ref} className="w-full relative">
        {loading && <div className="absolute inset-0 flex items-center justify-center text-muted text-sm">caricamento…</div>}
        {err && <div className="absolute inset-0 flex items-center justify-center text-short text-sm">{err}</div>}
      </div>
    </div>
  )
}

function formatPrice(p: number, coin: string): string {
  if (coin === 'BTC') return p.toFixed(1)
  if (coin === 'ETH' || coin === 'BNB') return p.toFixed(2)
  if (coin === 'SOL') return p.toFixed(3)
  return p.toFixed(4)
}
