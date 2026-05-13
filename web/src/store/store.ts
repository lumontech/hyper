import { create } from 'zustand'

export type Coin = 'BTC' | 'ETH' | 'SOL' | 'XRP' | 'BNB'
export const COINS: Coin[] = ['BTC', 'ETH', 'SOL', 'XRP', 'BNB']

export type Panel = 'dashboard' | 'health' | 'autotrader' | 'demo' | 'backtest' | 'strategies' | 'positions' | 'events'

interface AppState {
  activePanel: Panel
  setPanel: (p: Panel) => void

  mids: Record<string, number>
  setMid: (coin: string, price: number) => void

  wsConnected: boolean
  setWsConnected: (v: boolean) => void

  backendConnected: boolean
  setBackendConnected: (v: boolean) => void

  selectedCoin: Coin
  setSelectedCoin: (c: Coin) => void
}

export const useStore = create<AppState>((set) => ({
  activePanel: 'dashboard',
  setPanel: (p) => set({ activePanel: p }),

  mids: {},
  setMid: (coin, price) => set((s) => ({ mids: { ...s.mids, [coin]: price } })),

  wsConnected: false,
  setWsConnected: (v) => set({ wsConnected: v }),

  backendConnected: false,
  setBackendConnected: (v) => set({ backendConnected: v }),

  selectedCoin: 'BTC',
  setSelectedCoin: (c) => set({ selectedCoin: c }),
}))
