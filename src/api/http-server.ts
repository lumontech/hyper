// HTTP API server — espone status/backtest/strategies/router/positions al frontend locale.
// Bind di default 127.0.0.1, mai 0.0.0.0 senza auth in front.

import Fastify, { type FastifyInstance } from 'fastify'
import fastifyStatic from '@fastify/static'
import { writeFileSync, existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Logger } from 'pino'
import type { Config } from '../utils/config.js'
import type { HyperliquidClient } from '../core/hyperliquid-client.js'
import type { RiskManager } from '../engine/risk-manager.js'
import type { PositionManager } from '../engine/position-manager.js'
import type { BotDb } from '../persistence/db.js'
import type { Heartbeat } from '../guardian/heartbeat.js'
import type { SignalRouter } from '../orchestrator/signal-router.js'
import type { EventsCalendar } from '../strategy/events-calendar.js'
import { ALL_STRATEGIES } from '../strategy/strategy-registry.js'
import { simulateAccount } from '../engine/simulator.js'
import { detectAllPatterns } from '../strategy/patterns.js'
import { calculateVolumeProfile, fetchFundingRates } from '../strategy/volume-profile.js'

export interface HttpServerDeps {
  config: Config
  logger: Logger
  client: HyperliquidClient
  risk: RiskManager
  startedAt: number
  // optional in autonomous mode
  router?: SignalRouter
  positions?: PositionManager
  db?: BotDb
  heartbeat?: Heartbeat
  events?: EventsCalendar
}

const HALT_FILE = resolve('.HALT')

export async function startHttpServer(deps: HttpServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: false })

  app.addHook('onSend', async (req, reply, payload) => {
    const origin = req.headers.origin
    if (origin === 'http://localhost:5174' || origin === 'http://127.0.0.1:5174') {
      reply.header('Access-Control-Allow-Origin', origin)
      reply.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
      reply.header('Access-Control-Allow-Headers', 'Content-Type,X-Confirm')
    }
    return payload
  })
  app.options('/*', async (_req, reply) => { reply.code(204).send() })

  // ── Frontend statici (build di Vite copiati in /app/web-dist) ─────
  // In dev mode il frontend gira separatamente su :5174; in prod (Docker) li serviamo qui.
  const webDistPath = resolve(process.env.WEB_DIST_PATH ?? './web-dist')
  if (existsSync(webDistPath)) {
    await app.register(fastifyStatic, {
      root: webDistPath,
      prefix: '/',
      decorateReply: false,
    })
    // SPA fallback: qualsiasi rotta non-API ritorna index.html
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/status') || req.url.startsWith('/strategies') ||
          req.url.startsWith('/candles') || req.url.startsWith('/backtest') ||
          req.url.startsWith('/halt') || req.url.startsWith('/resume') ||
          req.url.startsWith('/positions') || req.url.startsWith('/equity') ||
          req.url.startsWith('/orders') || req.url.startsWith('/fills') ||
          req.url.startsWith('/router')) {
        reply.code(404).send({ error: 'API route not found' })
        return
      }
      reply.sendFile('index.html')
    })
    deps.logger.info({ webDistPath }, '[API] serving static frontend')
  } else {
    deps.logger.info({ webDistPath }, '[API] no web-dist directory, static serving disabled (dev mode)')
  }

  // ── GET /status ─────────────────────────────────────────────────
  app.get('/status', async () => ({
    ok: true,
    network: deps.config.network,
    dryRun: deps.config.dryRun,
    allowedCoins: deps.config.allowedCoins,
    strategiesEnabled: deps.config.strategyEnabled,
    timeframe: deps.config.strategyTimeframe,
    uptimeSec: Math.floor((Date.now() - deps.startedAt) / 1000),
    haltActive: existsSync(HALT_FILE),
    risk: deps.risk.snapshot(),
    heartbeat: deps.heartbeat?.snapshot(),
    router: deps.router?.snapshot(),
    events: deps.events?.snapshot(),
    autonomous: Boolean(deps.router && deps.positions),
  }))

  // ── GET /strategies ─────────────────────────────────────────────
  app.get('/strategies', async () => ({
    all: ALL_STRATEGIES.map(s => ({
      id: s.id, name: s.name, icon: s.icon, style: s.style,
      expectedWR: s.expectedWR, slMul: s.slMul, tpMul: s.tpMul,
      optimalTF: s.optimalTF, desc: s.desc,
      enabled: deps.config.strategyEnabled.includes(s.id),
      supportedCoins: s.supportedCoins,
    })),
  }))

  // ── GET /candles/:coin ──────────────────────────────────────────
  app.get<{ Params: { coin: string }; Querystring: { tf?: string; limit?: string } }>(
    '/candles/:coin', async (req, reply) => {
      const coin = req.params.coin.toUpperCase()
      if (!deps.config.allowedCoins.includes(coin)) return reply.code(400).send({ error: `Coin ${coin} not in allowlist` })
      const tf = req.query.tf ?? deps.config.strategyTimeframe
      const limit = Math.min(parseInt(req.query.limit ?? '500'), 2000)
      try {
        const candles = await deps.client.fetchCandles(coin, tf, limit)
        return { coin, tf, n: candles.length, candles }
      } catch (err) {
        return reply.code(500).send({ error: String(err) })
      }
    },
  )

  // ── POST /backtest ──────────────────────────────────────────────
  app.post<{ Body: { coin: string; strategyId: string; days: number; slMul?: number; tpMul?: number; maxBars?: number } }>(
    '/backtest', async (req, reply) => {
      const { coin, strategyId, days } = req.body
      const upperCoin = coin.toUpperCase()
      if (!deps.config.allowedCoins.includes(upperCoin)) return reply.code(400).send({ error: `Coin ${upperCoin} not in allowlist` })
      const strategy = ALL_STRATEGIES.find(s => s.id === strategyId)
      if (!strategy) return reply.code(404).send({ error: `Unknown strategy ${strategyId}` })
      const tf = deps.config.strategyTimeframe
      const tfSeconds: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1D': 86400 }
      const sec = tfSeconds[tf] ?? 900
      const need = Math.ceil((days * 86400) / sec) + 300
      try {
        const candles = await deps.client.fetchCandles(upperCoin, tf, need)
        const result = simulateAccount(strategy, candles, {
          symbol: upperCoin, startingBalance: 1000,
          riskPerTrade: deps.config.riskPerTradePct / 100,
          slMul: req.body.slMul ?? strategy.slMul,
          tpMul: req.body.tpMul ?? strategy.tpMul,
          maxBars: req.body.maxBars ?? deps.config.maxBarsInTrade,
          minWarmup: 250,
        })
        return { coin: upperCoin, strategy: strategyId, days, tf, result }
      } catch (err) {
        return reply.code(500).send({ error: String(err) })
      }
    },
  )

  // ── POST /backtest/all ──────────────────────────────────────────
  app.post<{ Body: { days: number } }>('/backtest/all', async (req, reply) => {
    const days = req.body.days ?? 30
    const tf = deps.config.strategyTimeframe
    const tfSeconds: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1D': 86400 }
    const sec = tfSeconds[tf] ?? 900
    const need = Math.ceil((days * 86400) / sec) + 300
    const out: Array<{ coin: string; strategy: string; result: ReturnType<typeof simulateAccount> }> = []
    for (const coin of deps.config.allowedCoins) {
      try {
        const candles = await deps.client.fetchCandles(coin, tf, need)
        for (const strategy of ALL_STRATEGIES) {
          if (strategy.supportedCoins !== 'all' && !strategy.supportedCoins.includes(coin)) continue
          const result = simulateAccount(strategy, candles, {
            symbol: coin, startingBalance: 1000,
            riskPerTrade: deps.config.riskPerTradePct / 100,
            slMul: strategy.slMul, tpMul: strategy.tpMul,
            maxBars: deps.config.maxBarsInTrade, minWarmup: 250,
          })
          out.push({ coin, strategy: strategy.id, result })
        }
      } catch (err) {
        deps.logger.error({ coin, err: String(err) }, '[API] backtest/all failed')
      }
    }
    return reply.send({ days, tf, n: out.length, results: out })
  })

  // ── POST /halt ──────────────────────────────────────────────────
  app.post('/halt', async (req, reply) => {
    if (req.headers['x-confirm'] !== 'yes') return reply.code(400).send({ error: 'missing X-Confirm: yes header' })
    writeFileSync(HALT_FILE, new Date().toISOString())
    deps.logger.error('[API] HALT via HTTP')
    return { halted: true, at: new Date().toISOString() }
  })
  app.post('/resume', async (req, reply) => {
    if (req.headers['x-confirm'] !== 'yes') return reply.code(400).send({ error: 'missing X-Confirm: yes header' })
    if (existsSync(HALT_FILE)) rmSync(HALT_FILE)
    return { halted: false }
  })

  // ── GET /positions ──────────────────────────────────────────────
  app.get('/positions', async () => {
    if (!deps.positions) return { positions: [], note: 'autonomous mode not active' }
    return { positions: deps.positions.list() }
  })

  // ── GET /equity ─────────────────────────────────────────────────
  app.get('/equity', async () => {
    if (!deps.db) return { curve: [], note: 'DB not active' }
    return { curve: deps.db.getEquityCurve(500) }
  })

  // ── GET /orders ─────────────────────────────────────────────────
  app.get('/orders', async () => {
    if (!deps.db) return { orders: [], note: 'DB not active' }
    return { orders: deps.db.getRecentOrders(100) }
  })

  // ── GET /fills ──────────────────────────────────────────────────
  app.get('/fills', async () => {
    if (!deps.db) return { fills: [], note: 'DB not active' }
    return { fills: deps.db.getRecentFills(100) }
  })

  // ── GET /router ─────────────────────────────────────────────────
  app.get('/router', async () => {
    if (!deps.router) return { note: 'router not active' }
    return deps.router.snapshot()
  })

  // ── GET /patterns/:coin ─────────────────────────────────────────
  app.get<{ Params: { coin: string }; Querystring: { tf?: string } }>(
    '/patterns/:coin', async (req, reply) => {
      const coin = req.params.coin.toUpperCase()
      if (!deps.config.allowedCoins.includes(coin)) return reply.code(400).send({ error: `Coin ${coin} not allowed` })
      const tf = req.query.tf ?? deps.config.strategyTimeframe
      try {
        const candles = await deps.client.fetchCandles(coin, tf, 200)
        const summary = detectAllPatterns(candles)
        return { coin, tf, ...summary }
      } catch (err) {
        return reply.code(500).send({ error: String(err) })
      }
    },
  )

  // ── GET /events ─────────────────────────────────────────────────
  app.get('/events', async () => {
    if (!deps.events) return { upcoming: [], recent: [], note: 'events calendar not active' }
    return {
      upcoming: deps.events.upcoming(14),
      recent: deps.events.recent(24),
      snapshot: deps.events.snapshot(),
    }
  })

  // ── GET /volume/:coin ───────────────────────────────────────────
  app.get<{ Params: { coin: string }; Querystring: { tf?: string; limit?: string } }>(
    '/volume/:coin', async (req, reply) => {
      const coin = req.params.coin.toUpperCase()
      if (!deps.config.allowedCoins.includes(coin)) return reply.code(400).send({ error: 'coin not allowed' })
      const tf = req.query.tf ?? deps.config.strategyTimeframe
      const limit = Math.min(parseInt(req.query.limit ?? '200'), 500)
      try {
        const candles = await deps.client.fetchCandles(coin, tf, limit)
        const profile = calculateVolumeProfile(candles)
        return { coin, tf, profile }
      } catch (err) {
        return reply.code(500).send({ error: String(err) })
      }
    },
  )

  // ── GET /funding ────────────────────────────────────────────────
  let fundingCache: { ts: number; data: unknown } = { ts: 0, data: null }
  app.get('/funding', async (_req, reply) => {
    // Cache 60s per non ddosare HL
    if (Date.now() - fundingCache.ts < 60_000 && fundingCache.data) {
      return { cached: true, data: fundingCache.data }
    }
    try {
      const rates = await fetchFundingRates(deps.config.network)
      const filtered = rates.filter(r => deps.config.allowedCoins.includes(r.coin))
      fundingCache = { ts: Date.now(), data: filtered }
      return { cached: false, data: filtered }
    } catch (err) {
      return reply.code(500).send({ error: String(err) })
    }
  })

  // ── GET /demo ───────────────────────────────────────────────────
  // Stato demo trading dettagliato: equity, trades, stats, equity curve
  app.get('/demo', async () => {
    const r = deps.risk.snapshot()
    const curve = deps.db?.getEquityCurve(500) ?? []
    const fills = deps.db?.getRecentFills(100) ?? []
    const startBal = (r as { startingBalance?: number }).startingBalance ?? 1000
    const demoEq = (r as { demoEquity?: number }).demoEquity ?? startBal
    const trades = (r as { demoTrades?: number }).demoTrades ?? 0
    const wins = (r as { demoWins?: number }).demoWins ?? 0
    const losses = (r as { demoLosses?: number }).demoLosses ?? 0
    const closed = wins + losses
    const pnl = demoEq - startBal
    const pnlPct = startBal > 0 ? (pnl / startBal) * 100 : 0
    return {
      startingBalance: startBal,
      currentEquity: demoEq,
      pnl,
      pnlPct,
      trades, wins, losses,
      winRate: closed > 0 ? (wins / closed) * 100 : 0,
      equityCurve: curve,
      recentFills: fills,
    }
  })

  await app.listen({ port: deps.config.apiPort, host: deps.config.apiBind })
  deps.logger.info({ port: deps.config.apiPort, bind: deps.config.apiBind }, '[API] HTTP server listening')
  return app
}
