// Connessione diretta WebSocket Hyperliquid per prezzi live (allMids).
// Niente backend in mezzo: il frontend si collega direttamente alla DEX.
// Port nativo da trade.fondamentale/frontend/src/services/HyperliquidService.js subscribeHyperliquidAllMidsWS.

const HL_WS_MAINNET = 'wss://api.hyperliquid.xyz/ws'
const HL_WS_TESTNET = 'wss://api.hyperliquid-testnet.xyz/ws'

export type MidsCallback = (mids: Record<string, string>) => void
export type StatusCallback = () => void

export function subscribeAllMids(
  network: 'testnet' | 'mainnet',
  onMids: MidsCallback,
  onConnect?: StatusCallback,
  onDisconnect?: StatusCallback,
): () => void {
  const url = network === 'mainnet' ? HL_WS_MAINNET : HL_WS_TESTNET
  let ws: WebSocket | null = null
  let cancelled = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null

  const connect = () => {
    if (cancelled) return
    ws = new WebSocket(url)

    ws.addEventListener('open', () => {
      onConnect?.()
      ws?.send(JSON.stringify({ method: 'subscribe', subscription: { type: 'allMids' } }))
    })

    ws.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.channel === 'allMids' && msg.data?.mids) {
          onMids(msg.data.mids)
        }
      } catch {}
    })

    ws.addEventListener('close', () => {
      if (!cancelled) {
        onDisconnect?.()
        reconnectTimer = setTimeout(connect, 3000)
      }
    })

    ws.addEventListener('error', () => { /* close handler reconnects */ })
  }

  connect()

  return () => {
    cancelled = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (ws?.readyState === WebSocket.OPEN) ws.close()
  }
}

export interface CandleMsg {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export function subscribeCandle(
  network: 'testnet' | 'mainnet',
  coin: string,
  interval: string,
  onCandle: (c: CandleMsg) => void,
  onConnect?: StatusCallback,
  onDisconnect?: StatusCallback,
): () => void {
  const url = network === 'mainnet' ? HL_WS_MAINNET : HL_WS_TESTNET
  let ws: WebSocket | null = null
  let cancelled = false
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let pingTimer: ReturnType<typeof setInterval> | null = null

  const connect = () => {
    if (cancelled) return
    ws = new WebSocket(url)
    ws.addEventListener('open', () => {
      onConnect?.()
      ws?.send(JSON.stringify({
        method: 'subscribe',
        subscription: { type: 'candle', coin, interval },
      }))
      pingTimer = setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ method: 'ping' }))
        }
      }, 30000)
    })
    ws.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.channel === 'candle' && msg.data) {
          const k = msg.data
          onCandle({
            time:   Math.floor(k.t / 1000),
            open:   parseFloat(k.o),
            high:   parseFloat(k.h),
            low:    parseFloat(k.l),
            close:  parseFloat(k.c),
            volume: parseFloat(k.v ?? '0'),
          })
        }
      } catch {}
    })
    ws.addEventListener('close', () => {
      if (pingTimer) { clearInterval(pingTimer); pingTimer = null }
      if (!cancelled) {
        onDisconnect?.()
        reconnectTimer = setTimeout(connect, 3000)
      }
    })
  }
  connect()
  return () => {
    cancelled = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    if (pingTimer) clearInterval(pingTimer)
    if (ws?.readyState === WebSocket.OPEN) ws.close()
  }
}
