import { useEffect } from 'react'
import { Header } from './components/Header'
import { Sidebar } from './components/Sidebar'
import { Dashboard } from './panels/Dashboard'
import { Health } from './panels/Health'
import { AutoTrader } from './panels/AutoTrader'
import { DemoAccount } from './panels/DemoAccount'
import { Backtest } from './panels/Backtest'
import { Strategies } from './panels/Strategies'
import { Positions } from './panels/Positions'
import { Events } from './panels/Events'
import { useStore } from './store/store'
import { api } from './services/api'
import { subscribeAllMids } from './services/hl-feed'

export default function App() {
  const activePanel = useStore(s => s.activePanel)
  const setMid = useStore(s => s.setMid)
  const setWsConnected = useStore(s => s.setWsConnected)
  const setBackendConnected = useStore(s => s.setBackendConnected)

  // Poll /status ogni 5s per sapere se il backend è vivo
  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        await api.status()
        if (!cancelled) setBackendConnected(true)
      } catch {
        if (!cancelled) setBackendConnected(false)
      }
    }
    tick()
    const id = setInterval(tick, 5000)
    return () => { cancelled = true; clearInterval(id) }
  }, [setBackendConnected])

  // WebSocket Hyperliquid: prezzi live per i 5 coin
  useEffect(() => {
    const network = (window.localStorage.getItem('hl_network') ?? 'mainnet') as 'testnet' | 'mainnet'
    const unsub = subscribeAllMids(
      network,
      (mids) => {
        for (const coin of ['BTC', 'ETH', 'SOL', 'XRP', 'BNB']) {
          const v = parseFloat(mids[coin] ?? '')
          if (!Number.isNaN(v)) setMid(coin, v)
        }
      },
      () => setWsConnected(true),
      () => setWsConnected(false),
    )
    return () => unsub()
  }, [setMid, setWsConnected])

  return (
    <div className="h-screen flex flex-col bg-bg text-text">
      <Header />
      <div className="flex-1 flex overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-auto p-4 fade-in" key={activePanel}>
          {activePanel === 'dashboard'  && <Dashboard />}
          {activePanel === 'autotrader' && <AutoTrader />}
          {activePanel === 'demo'       && <DemoAccount />}
          {activePanel === 'backtest'   && <Backtest />}
          {activePanel === 'strategies' && <Strategies />}
          {activePanel === 'positions'  && <Positions />}
          {activePanel === 'events'     && <Events />}
        </main>
      </div>
    </div>
  )
}
