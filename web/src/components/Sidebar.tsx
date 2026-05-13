import { useStore, type Panel } from '../store/store'

interface Item {
  id: Panel
  label: string
  icon: string
  desc: string
}

const ITEMS: Item[] = [
  { id: 'dashboard',  label: 'Dashboard',   icon: '◎', desc: 'Live prices + chart' },
  { id: 'autotrader', label: 'Auto-Trader', icon: '⚡', desc: 'Signals + orders live' },
  { id: 'backtest',   label: 'Backtest',    icon: '⊞', desc: '30/60/90 days sim' },
  { id: 'strategies', label: 'Strategies',  icon: '⚙', desc: 'WR, SL/TP, params' },
  { id: 'positions',  label: 'Positions',   icon: '◇', desc: 'Open + equity curve' },
]

export function Sidebar() {
  const activePanel = useStore(s => s.activePanel)
  const setPanel = useStore(s => s.setPanel)

  return (
    <aside className="w-56 border-r border-line bg-panel flex flex-col py-3 shrink-0">
      {ITEMS.map(it => {
        const active = activePanel === it.id
        return (
          <button
            key={it.id}
            onClick={() => setPanel(it.id)}
            className={`flex items-center gap-3 px-4 py-3 transition border-l-2
              ${active
                ? 'bg-bg border-gold text-text'
                : 'border-transparent text-muted hover:bg-bg/40 hover:text-text'}`}
          >
            <span className={`text-lg ${active ? 'text-gold' : ''}`}>{it.icon}</span>
            <div className="flex flex-col items-start text-left">
              <span className="text-sm font-medium">{it.label}</span>
              <span className="text-[10px] text-muted">{it.desc}</span>
            </div>
          </button>
        )
      })}

      <div className="mt-auto px-4 py-3 border-t border-line">
        <div className="text-[10px] text-muted">
          Local platform · v0.2.0<br />
          <a href="http://127.0.0.1:7777/status" target="_blank" rel="noreferrer" className="text-gold hover:underline">
            API status →
          </a>
        </div>
      </div>
    </aside>
  )
}
