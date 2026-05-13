import { useEffect, useState } from 'react'
import { useStore } from '../store/store'
import { api } from '../services/api'

export function Header() {
  const wsConnected = useStore(s => s.wsConnected)
  const backendConnected = useStore(s => s.backendConnected)
  const [network, setNetwork] = useState<'testnet' | 'mainnet'>('mainnet')
  const [dryRun, setDryRun] = useState(true)
  const [haltActive, setHaltActive] = useState(false)
  const [now, setNow] = useState(new Date())
  const [demoEquity, setDemoEquity] = useState<number | null>(null)
  const [demoTrades, setDemoTrades] = useState(0)
  const [demoWins, setDemoWins] = useState(0)
  const [demoLosses, setDemoLosses] = useState(0)
  const [startingBalance, setStartingBalance] = useState(1000)

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    const tick = async () => {
      try {
        const s = await api.status()
        setNetwork(s.network)
        setDryRun(s.dryRun)
        setHaltActive(s.haltActive)
        if (typeof s.risk?.demoEquity === 'number')      setDemoEquity(s.risk.demoEquity)
        if (typeof s.risk?.demoTrades === 'number')      setDemoTrades(s.risk.demoTrades)
        if (typeof s.risk?.demoWins === 'number')        setDemoWins(s.risk.demoWins)
        if (typeof s.risk?.demoLosses === 'number')      setDemoLosses(s.risk.demoLosses)
        if (typeof s.risk?.startingBalance === 'number') setStartingBalance(s.risk.startingBalance)
      } catch {}
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => clearInterval(id)
  }, [])

  const demoPnl = demoEquity !== null ? demoEquity - startingBalance : 0
  const demoPnlPct = startingBalance > 0 ? (demoPnl / startingBalance) * 100 : 0
  const winRate = demoTrades > 0 ? (demoWins / Math.max(1, demoWins + demoLosses)) * 100 : 0

  const onHalt = async () => {
    if (!confirm('Inviare HALT al bot? Tutte le posizioni verranno chiuse.')) return
    try { await api.halt(); setHaltActive(true) } catch (err) { alert(String(err)) }
  }
  const onResume = async () => {
    if (!confirm('Rimuovere HALT?')) return
    try { await api.resume(); setHaltActive(false) } catch (err) { alert(String(err)) }
  }

  return (
    <header className="h-14 border-b border-line bg-panel flex items-center px-4 gap-6 shrink-0">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full bg-gold pulse-dot" />
        <span className="font-mono font-bold tracking-wide text-gold">HYPERLIQUID</span>
        <span className="text-muted text-xs">platform · local</span>
      </div>

      <div className="flex items-center gap-3 text-xs">
        <Pill label="BACKEND" ok={backendConnected} />
        <Pill label="HL WS" ok={wsConnected} />
        <Pill label={`NET: ${network.toUpperCase()}`} ok={network === 'testnet'} warn={network === 'mainnet'} />
        <Pill label={`MODE: ${dryRun ? 'DRY' : 'LIVE'}`} ok={dryRun} warn={!dryRun} />
        {haltActive && <Pill label="HALTED" danger />}
      </div>

      <div className="flex-1" />

      {/* Demo equity tracker */}
      {demoEquity !== null && (
        <div className="flex items-center gap-3 text-xs font-mono">
          <div className="flex items-center gap-1.5">
            <span className="text-muted text-[10px]">DEMO</span>
            <span className="text-gold">€{demoEquity.toFixed(2)}</span>
            <span className={demoPnl >= 0 ? 'text-long' : 'text-short'}>
              {demoPnl >= 0 ? '+' : ''}{demoPnl.toFixed(2)} ({demoPnlPct.toFixed(2)}%)
            </span>
          </div>
          <div className="text-muted text-[10px]">
            {demoTrades} trades · {winRate.toFixed(0)}% WR
          </div>
        </div>
      )}

      <div className="font-mono text-xs text-muted">
        {now.toLocaleTimeString('it-IT', { hour12: false })}
      </div>

      {haltActive ? (
        <button onClick={onResume} className="px-3 py-1.5 rounded bg-long/20 border border-long/40 text-long text-xs hover:bg-long/30 transition">
          RESUME
        </button>
      ) : (
        <button onClick={onHalt} className="px-3 py-1.5 rounded bg-short/20 border border-short/40 text-short text-xs hover:bg-short/30 transition font-semibold">
          HALT
        </button>
      )}
    </header>
  )
}

function Pill({ label, ok, warn, danger }: { label: string; ok?: boolean; warn?: boolean; danger?: boolean }) {
  const cls = danger ? 'bg-short/15 border-short/40 text-short' :
              warn   ? 'bg-warn/15 border-warn/40 text-warn'    :
              ok     ? 'bg-long/15 border-long/40 text-long'    :
                       'bg-line border-line text-muted'
  return <div className={`px-2 py-0.5 rounded border font-mono ${cls}`}>{label}</div>
}
