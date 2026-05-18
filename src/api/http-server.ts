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
import { ALL_STRATEGIES, getEnabledStrategies } from '../strategy/strategy-registry.js'
import { simulateAccount } from '../engine/simulator.js'
import { backtestPipeline } from '../engine/backtest-pipeline.js'
import { BinanceClient } from '../core/binance-client.js'
import { FundingHistory, type FundingPayment, type LiveFundingPoller } from '../core/funding-history.js'
import { blockBootstrapPF } from '../engine/bootstrap-ci.js'
import { getSlippageForCoin } from '../engine/realistic-costs.js'
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
  fundingPoller?: LiveFundingPoller
  wsStats?: Record<string, unknown>
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
      category: s.category,
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
  app.post<{ Body: { coin: string; strategyId: string; days: number; slMul?: number; tpMul?: number; maxBars?: number; tf?: string; source?: 'hl' | 'binance' } }>(
    '/backtest', async (req, reply) => {
      const { coin, strategyId, days } = req.body
      const upperCoin = coin.toUpperCase()
      if (!deps.config.allowedCoins.includes(upperCoin)) return reply.code(400).send({ error: `Coin ${upperCoin} not in allowlist` })
      const strategy = ALL_STRATEGIES.find(s => s.id === strategyId)
      if (!strategy) return reply.code(404).send({ error: `Unknown strategy ${strategyId}` })
      const tf = req.body.tf ?? deps.config.strategyTimeframe
      const tfSeconds: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1D': 86400, '1d': 86400 }
      const sec = tfSeconds[tf] ?? 900
      const need = Math.ceil((days * 86400) / sec) + 300
      const source = req.body.source ?? 'hl'
      try {
        const candles = source === 'binance'
          ? await binance.fetchCandles(upperCoin, tf, need)
          : await deps.client.fetchCandles(upperCoin, tf, need)
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

  // Binance client singleton — solo per backtest storici (>52gg)
  const binance = new BinanceClient()
  const fundingClient = new FundingHistory({ network: deps.config.network, logger: deps.logger })

  // ── POST /backtest/rolling-walk-forward ────────────────────────
  // Audit statistico onesto:
  //   - 5 finestre rolling train/test (non più single split)
  //   - Funding rate cost simulato da HL fundingHistory reale
  //   - Slippage per-coin realistico (BTC 0.02% / ETH 0.025% / SOL 0.04% / XRP 0.06% / BNB 0.05%)
  //   - Block bootstrap CI sulle combo che superano le 5 finestre
  // Combo "veramente robust" = PF_test > 1 in ≥4/5 finestre AND bootstrap PF_lower_95% > 1.0
  app.post<{ Body: {
    coin: string; strategyId: string; tf?: string;
    totalDays?: number; nFolds?: number; testPctPerFold?: number;
    slMuls?: number[]; tpMuls?: number[];
    includeFunding?: boolean;
    bootstrapIterations?: number;
  } }>(
    '/backtest/rolling-walk-forward', async (req, reply) => {
      const upperCoin = req.body.coin.toUpperCase()
      if (!deps.config.allowedCoins.includes(upperCoin)) return reply.code(400).send({ error: `Coin ${upperCoin} not allowed` })
      const strategy = ALL_STRATEGIES.find(s => s.id === req.body.strategyId)
      if (!strategy) return reply.code(404).send({ error: `Unknown strategy ${req.body.strategyId}` })
      const tf = req.body.tf ?? '1h'
      const tfSeconds: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400 }
      const sec = tfSeconds[tf] ?? 3600
      const totalDays = req.body.totalDays ?? 365
      const nFolds = req.body.nFolds ?? 5
      const testPctPerFold = req.body.testPctPerFold ?? 0.20
      const slMuls = req.body.slMuls ?? [0.8, 1.0, 1.2]
      const tpMuls = req.body.tpMuls ?? [1.5, 2.0, 2.5, 3.0, 3.5]
      const includeFunding = req.body.includeFunding ?? true
      const bootstrapIters = req.body.bootstrapIterations ?? 1000

      try {
        // 1. Fetch candele + funding history
        const need = Math.ceil((totalDays * 86400) / sec) + 300
        const t0 = Date.now()
        const candles = await binance.fetchCandles(upperCoin, tf, need)
        let fundingSeries: FundingPayment[] = []
        if (includeFunding) {
          try {
            fundingSeries = await fundingClient.fetch(upperCoin, candles[0]!.time * 1000, Date.now())
            deps.logger.info({ coin: upperCoin, funding_n: fundingSeries.length }, '[WF] funding history loaded')
          } catch (e) {
            deps.logger.warn({ coin: upperCoin, err: String(e) }, '[WF] funding fetch failed, skipping')
          }
        }

        // 2. Crea N folds rolling train/test
        const totalBars = candles.length
        const testSize = Math.floor(totalBars * testPctPerFold)
        // Sliding train+test windows
        const folds: Array<{ trainStart: number; trainEnd: number; testStart: number; testEnd: number }> = []
        const trainSize = Math.floor((totalBars - testSize) / nFolds) * nFolds + testSize  // approssimazione
        // Schema più semplice: divido in nFolds blocks, each fold = [previous as train, this as test]
        const blockSize = Math.floor(totalBars / (nFolds + 1))  // 6 blocchi: 1 warmup + 5 fold
        for (let f = 0; f < nFolds; f++) {
          const trainStart = 0
          const trainEnd = blockSize * (f + 1)
          const testStart = trainEnd
          const testEnd = Math.min(trainEnd + blockSize, totalBars)
          if (testEnd - testStart < 50) continue
          folds.push({ trainStart, trainEnd, testStart, testEnd })
        }

        const t1 = Date.now()

        // 3. Per ogni combo (slMul, tpMul): simula su ogni fold (train+test) e raccogli stats
        type ComboResult = {
          slMul: number; tpMul: number
          perFold: Array<{
            trainTrades: number; trainPF: number; trainPnl: number
            testTrades: number; testPF: number; testPnl: number; testReturns: number[]
          }>
          foldsPassedOnTest: number   // n folds dove test PF > 1.0
          combinedTestReturns: number[]
          bootstrap?: ReturnType<typeof blockBootstrapPF>
          aggregateTestPF: number
          aggregateTestPnl: number
        }
        const combos: ComboResult[] = []

        for (const slMul of slMuls) {
          for (const tpMul of tpMuls) {
            const perFold: ComboResult['perFold'] = []
            const combinedTestReturns: number[] = []
            for (const fold of folds) {
              const trainSlice = candles.slice(fold.trainStart, fold.trainEnd)
              const testSlice = candles.slice(fold.testStart, fold.testEnd)
              const trainRes = simulateAccount(strategy, trainSlice, {
                symbol: upperCoin, startingBalance: 1000,
                riskPerTrade: deps.config.riskPerTradePct / 100,
                slMul, tpMul, maxBars: deps.config.maxBarsInTrade, minWarmup: 250,
                fundingSeries: includeFunding ? fundingSeries : undefined,
              })
              const testRes = simulateAccount(strategy, testSlice, {
                symbol: upperCoin, startingBalance: 1000,
                riskPerTrade: deps.config.riskPerTradePct / 100,
                slMul, tpMul, maxBars: deps.config.maxBarsInTrade, minWarmup: 250,
                fundingSeries: includeFunding ? fundingSeries : undefined,
              })
              if ('error' in trainRes || 'error' in testRes) {
                perFold.push({
                  trainTrades: 0, trainPF: 0, trainPnl: 0,
                  testTrades: 0, testPF: 0, testPnl: 0, testReturns: [],
                })
                continue
              }
              const testReturns = testRes.trades.map(t => t.rr)
              for (const r of testReturns) combinedTestReturns.push(r)
              perFold.push({
                trainTrades: trainRes.summary.total,
                trainPF: trainRes.summary.profitFactor,
                trainPnl: trainRes.pnlPct,
                testTrades: testRes.summary.total,
                testPF: testRes.summary.profitFactor,
                testPnl: testRes.pnlPct,
                testReturns,
              })
            }
            const foldsPassedOnTest = perFold.filter(f => f.testPF > 1.0 && f.testTrades > 5).length
            // Aggregate PF su tutti i test returns combinati
            let gw = 0, gl = 0
            for (const r of combinedTestReturns) { if (r > 0) gw += r; else if (r < 0) gl += -r }
            const aggregateTestPF = gl > 0 ? gw / gl : (gw > 0 ? Infinity : 0)
            const aggregateTestPnl = combinedTestReturns.reduce((s, r) => s + r, 0)
            const result: ComboResult = { slMul, tpMul, perFold, foldsPassedOnTest, combinedTestReturns, aggregateTestPF, aggregateTestPnl }
            // Bootstrap solo se combo passa ≥3/5 folds
            if (foldsPassedOnTest >= 3 && combinedTestReturns.length >= 30) {
              result.bootstrap = blockBootstrapPF(combinedTestReturns, bootstrapIters, 20)
            }
            combos.push(result)
          }
        }

        const t2 = Date.now()

        // 4. Filtra "truly robust" = ≥4/5 folds passed AND bootstrap PF_lower_95% > 1.0
        const trulyRobust = combos.filter(c =>
          c.foldsPassedOnTest >= 4 &&
          c.bootstrap !== undefined &&
          c.bootstrap.pfLower95 > 1.0
        )
        // "Marginal" = ≥3/5 folds passed AND bootstrap probEdge > 0.5
        const marginal = combos.filter(c =>
          c.foldsPassedOnTest >= 3 &&
          c.bootstrap !== undefined &&
          c.bootstrap.probEdge > 0.5 &&
          !trulyRobust.includes(c)
        )

        // Rank per aggregateTestPF
        combos.sort((a, b) => b.aggregateTestPF - a.aggregateTestPF)

        return {
          coin: upperCoin,
          strategyId: req.body.strategyId,
          tf,
          totalDays,
          totalBars,
          nFolds: folds.length,
          fundingPoints: fundingSeries.length,
          slippageUsed: getSlippageForCoin(upperCoin),
          fetchMs: t1 - t0,
          simMs: t2 - t1,
          gridSize: slMuls.length * tpMuls.length,
          trulyRobustCount: trulyRobust.length,
          marginalCount: marginal.length,
          trulyRobust: trulyRobust.map(c => ({
            slMul: c.slMul, tpMul: c.tpMul,
            foldsPassedOnTest: c.foldsPassedOnTest,
            aggregateTestPF: c.aggregateTestPF,
            aggregateTestPnlR: c.aggregateTestPnl,
            nTradesTotal: c.combinedTestReturns.length,
            bootstrap: c.bootstrap,
            perFoldPF: c.perFold.map(f => ({ testTrades: f.testTrades, testPF: f.testPF, testPnlPct: f.testPnl })),
          })),
          marginal: marginal.map(c => ({
            slMul: c.slMul, tpMul: c.tpMul,
            foldsPassedOnTest: c.foldsPassedOnTest,
            aggregateTestPF: c.aggregateTestPF,
            bootstrap: c.bootstrap,
          })),
          topCombos: combos.slice(0, 10).map(c => ({
            slMul: c.slMul, tpMul: c.tpMul,
            foldsPassedOnTest: c.foldsPassedOnTest,
            aggregateTestPF: c.aggregateTestPF,
            bootstrap: c.bootstrap ?? null,
          })),
        }
      } catch (err) {
        deps.logger.error({ coin: upperCoin, err: String(err) }, '[API] rolling-walk-forward failed')
        return reply.code(500).send({ error: String(err) })
      }
    },
  )

  // ── POST /backtest/walk-forward ─────────────────────────────────
  // Grid search tpMul × slMul su candele Binance con train/test split out-of-sample.
  // Per ogni combo: simula su train, poi valida su test. Mantieni combo con PF_test > 1.0
  // Risultato: lista delle combo che hanno superato il filtro out-of-sample.
  app.post<{ Body: {
    coin: string; strategyId: string; days: number; tf?: string;
    trainDays?: number; testDays?: number;
    slMuls?: number[]; tpMuls?: number[];
  } }>(
    '/backtest/walk-forward', async (req, reply) => {
      const upperCoin = req.body.coin.toUpperCase()
      if (!deps.config.allowedCoins.includes(upperCoin)) return reply.code(400).send({ error: `Coin ${upperCoin} not allowed` })
      const strategy = ALL_STRATEGIES.find(s => s.id === req.body.strategyId)
      if (!strategy) return reply.code(404).send({ error: `Unknown strategy ${req.body.strategyId}` })
      const tf = req.body.tf ?? '1h'
      const tfSeconds: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }
      const sec = tfSeconds[tf] ?? 3600
      const totalDays = req.body.days ?? 365
      const trainDays = req.body.trainDays ?? 240
      const testDays = req.body.testDays ?? Math.max(30, totalDays - trainDays)
      const slMuls = req.body.slMuls ?? [0.8, 1.0, 1.2]
      const tpMuls = req.body.tpMuls ?? [1.5, 2.0, 2.5, 3.0, 3.5]

      try {
        const need = Math.ceil((totalDays * 86400) / sec) + 300
        const allCandles = await deps.client.fetchCandles(upperCoin, tf, need)  // Will fail to >52gg on HL
        // Use Binance for proper history
        const binanceCandles = await binance.fetchCandles(upperCoin, tf, need)
        const candles = binanceCandles.length > allCandles.length ? binanceCandles : allCandles

        const splitTime = candles[candles.length - 1]!.time - testDays * 86400
        const trainCandles = candles.filter(c => c.time < splitTime)
        const testCandles = candles.filter(c => c.time >= splitTime - (trainCandles.length > 250 ? 250 * sec : 0))  // overlap warmup

        const results: Array<{
          slMul: number; tpMul: number;
          train: { trades: number; wr: number; pf: number; pnlPct: number };
          test:  { trades: number; wr: number; pf: number; pnlPct: number };
          robust: boolean;
        }> = []

        for (const slMul of slMuls) {
          for (const tpMul of tpMuls) {
            const trainResult = simulateAccount(strategy, trainCandles, {
              symbol: upperCoin, startingBalance: 1000,
              riskPerTrade: deps.config.riskPerTradePct / 100,
              slMul, tpMul, maxBars: deps.config.maxBarsInTrade, minWarmup: 250,
            })
            const testResult = simulateAccount(strategy, testCandles, {
              symbol: upperCoin, startingBalance: 1000,
              riskPerTrade: deps.config.riskPerTradePct / 100,
              slMul, tpMul, maxBars: deps.config.maxBarsInTrade, minWarmup: 250,
            })
            if ('error' in trainResult || 'error' in testResult) continue
            const robust = testResult.summary.profitFactor > 1.0 && trainResult.summary.profitFactor > 1.0
            results.push({
              slMul, tpMul,
              train: {
                trades: trainResult.summary.total,
                wr: trainResult.summary.winRate,
                pf: trainResult.summary.profitFactor,
                pnlPct: trainResult.pnlPct,
              },
              test: {
                trades: testResult.summary.total,
                wr: testResult.summary.winRate,
                pf: testResult.summary.profitFactor,
                pnlPct: testResult.pnlPct,
              },
              robust,
            })
          }
        }

        // Rank by test.pf descending
        results.sort((a, b) => b.test.pf - a.test.pf)
        const robustOnly = results.filter(r => r.robust)
        return {
          coin: upperCoin,
          strategyId: req.body.strategyId,
          tf,
          totalDays, trainDays, testDays,
          gridSize: slMuls.length * tpMuls.length,
          robustCount: robustOnly.length,
          topCombos: results.slice(0, 10),
          robustCombos: robustOnly,
        }
      } catch (err) {
        deps.logger.error({ coin: upperCoin, err: String(err) }, '[API] backtest/walk-forward failed')
        return reply.code(500).send({ error: String(err) })
      }
    },
  )

  // ── POST /backtest/pipeline-binance ─────────────────────────────
  // Stessa logica del pipeline backtest ma con dati Binance Klines (storia multi-anno).
  // Supporta override del timeframe via body.tf (default: config.strategyTimeframe).
  app.post<{ Body: { coin: string; days: number; strategyIds?: string[]; maxPositionUsd?: number; tf?: string } }>(
    '/backtest/pipeline-binance', async (req, reply) => {
      const upperCoin = req.body.coin.toUpperCase()
      if (!deps.config.allowedCoins.includes(upperCoin)) return reply.code(400).send({ error: `Coin ${upperCoin} not allowed` })
      const days = req.body.days ?? 365
      const tf = req.body.tf ?? deps.config.strategyTimeframe
      const tfSeconds: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1D': 86400, '1d': 86400 }
      const sec = tfSeconds[tf] ?? 900
      const need = Math.ceil((days * 86400) / sec) + 300
      const strategyIds = req.body.strategyIds ?? deps.config.strategyEnabled
      const strategies = getEnabledStrategies(strategyIds)
      if (strategies.length === 0) return reply.code(400).send({ error: 'no strategies match' })
      try {
        const t0 = Date.now()
        deps.logger.info({ coin: upperCoin, days, need, n_strategies: strategies.length }, '[API] backtest/pipeline-binance fetching')
        const candles = await binance.fetchCandles(upperCoin, tf, need)
        const fetchMs = Date.now() - t0
        deps.logger.info({ coin: upperCoin, candlesFetched: candles.length, fetchMs }, '[API] backtest/pipeline-binance candles ready')
        const result = backtestPipeline(strategies, candles, {
          symbol: upperCoin,
          startingBalance: 1000,
          riskPerTrade: deps.config.riskPerTradePct / 100,
          maxBars: deps.config.maxBarsInTrade,
          minWarmup: 250,
          maxPositionUsd: req.body.maxPositionUsd ?? deps.config.maxPositionUsd,
        })
        return { coin: upperCoin, days, tf, n_strategies: strategies.length, candles: candles.length, fetchMs, source: 'binance', result }
      } catch (err) {
        deps.logger.error({ coin: upperCoin, err: String(err) }, '[API] backtest/pipeline-binance failed')
        return reply.code(500).send({ error: String(err) })
      }
    },
  )

  // ── POST /backtest/pipeline ─────────────────────────────────────
  // Backtest che replica la pipeline live: tutte le strategie compete, tie-breaker confluence,
  // pattern veto, no-trade events (skipped per ora — il calendar è seed leggero).
  app.post<{ Body: { coin: string; days: number; strategyIds?: string[]; maxPositionUsd?: number } }>(
    '/backtest/pipeline', async (req, reply) => {
      const upperCoin = req.body.coin.toUpperCase()
      if (!deps.config.allowedCoins.includes(upperCoin)) return reply.code(400).send({ error: `Coin ${upperCoin} not allowed` })
      const days = req.body.days ?? 90
      const tf = deps.config.strategyTimeframe
      const tfSeconds: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1D': 86400 }
      const sec = tfSeconds[tf] ?? 900
      const need = Math.ceil((days * 86400) / sec) + 300
      const strategyIds = req.body.strategyIds ?? deps.config.strategyEnabled
      const strategies = getEnabledStrategies(strategyIds)
      if (strategies.length === 0) return reply.code(400).send({ error: 'no strategies match' })
      try {
        deps.logger.info({ coin: upperCoin, days, need, n_strategies: strategies.length }, '[API] backtest/pipeline start')
        const candles = await deps.client.fetchCandles(upperCoin, tf, need)
        deps.logger.info({ coin: upperCoin, candlesFetched: candles.length }, '[API] backtest/pipeline candles ready')
        const result = backtestPipeline(strategies, candles, {
          symbol: upperCoin,
          startingBalance: 1000,
          riskPerTrade: deps.config.riskPerTradePct / 100,
          maxBars: deps.config.maxBarsInTrade,
          minWarmup: 250,
          maxPositionUsd: req.body.maxPositionUsd ?? deps.config.maxPositionUsd,
        })
        return { coin: upperCoin, days, tf, n_strategies: strategies.length, candles: candles.length, result }
      } catch (err) {
        deps.logger.error({ coin: upperCoin, err: String(err) }, '[API] backtest/pipeline failed')
        return reply.code(500).send({ error: String(err) })
      }
    },
  )

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

  // ── GET /funding-live ───────────────────────────────────────────
  // Snapshot funding rate corrente per ogni coin (poll 60s).
  // Mostra a frontend chi sta pagando chi e quanto.
  app.get('/funding-live', async () => {
    if (!deps.fundingPoller) return { note: 'fundingPoller not active', rates: {} }
    const snap = deps.fundingPoller.current()
    // Calcola APR annualizzato per ogni coin
    const annualized: Record<string, number> = {}
    for (const [coin, rate] of Object.entries(snap.rates)) {
      annualized[coin] = rate * 24 * 365 * 100   // % APR
    }
    return {
      updatedAt: snap.updatedAt,
      ageSec: snap.updatedAt > 0 ? Math.round((Date.now() - snap.updatedAt) / 1000) : null,
      rates: snap.rates,
      annualizedPct: annualized,
      premiums: snap.premiums,
      openInterest: snap.openInterest,
      markPrices: snap.markPrices,
    }
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

  // ── GET /debug ──────────────────────────────────────────────────
  // Diagnostica: stato counter interni router + WS feed
  app.get('/debug', async () => {
    // wsStats viene iniettato da main.ts se disponibile
    const wsStats = (deps as { wsStats?: Record<string, unknown> }).wsStats
    const routerSnap = deps.router?.snapshot()
    const dbHasOrders = deps.db?.getRecentOrders(5).length ?? 0
    const dbHasFills = deps.db?.getRecentFills(5).length ?? 0
    return {
      uptime: Math.floor((Date.now() - deps.startedAt) / 1000),
      ws: wsStats ?? { note: 'wsStats not wired' },
      router: routerSnap,
      db: { orders_last5: dbHasOrders, fills_last5: dbHasFills },
      heartbeat: deps.heartbeat?.snapshot(),
    }
  })

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

  // ── GET /health ─────────────────────────────────────────────────
  // Score globale + per-strategy + signal rate. Risposta in un colpo per pannello health.
  app.get('/health', async () => {
    const r = deps.risk.snapshot() as { startingBalance?: number; demoEquity?: number; demoTrades?: number; demoWins?: number; demoLosses?: number }
    const startBal = r.startingBalance ?? 1000
    const demoEq = r.demoEquity ?? startBal
    const trades = r.demoTrades ?? 0
    const wins = r.demoWins ?? 0
    const losses = r.demoLosses ?? 0
    const closed = wins + losses
    const winRate = closed > 0 ? (wins / closed) * 100 : 0
    const pnl = demoEq - startBal
    const pnlPct = startBal > 0 ? (pnl / startBal) * 100 : 0

    // Per-strategy + max DD da DB
    const perStrategy = deps.db?.getStatsByStrategy() ?? []
    const dd = deps.db?.getMaxDrawdown() ?? { peak: startBal, trough: startBal, ddPct: 0, ddUsd: 0 }

    // Profit factor globale
    let totalGW = 0, totalGL = 0
    for (const s of perStrategy) { totalGW += s.gross_win; totalGL += s.gross_loss }
    const profitFactor = totalGL > 0 ? totalGW / totalGL : totalGW > 0 ? 99 : 0

    // Signal rate (24h dal router se disponibile)
    const router = deps.router?.snapshot()
    const signalsGenerated = router?.signalsGenerated ?? 0
    const ordersAttempted = router?.ordersAttempted ?? 0
    const ordersAccepted = router?.ordersAccepted ?? 0
    const acceptRate = ordersAttempted > 0 ? (ordersAccepted / ordersAttempted) * 100 : 0

    // Health score 0..100 — semaforo
    //   PF >= 1.4 e DD < 20 e WR >= 50 → verde (>=70)
    //   PF >= 1.0 e DD < 30 → giallo (40-70)
    //   altrimenti rosso (<40)
    let healthScore = 50
    const checks: Array<{ name: string; ok: boolean; value: string; target: string }> = [
      { name: 'Profit Factor', ok: profitFactor >= 1.4, value: profitFactor.toFixed(2), target: '≥ 1.4' },
      { name: 'Win Rate', ok: winRate >= 50, value: winRate.toFixed(0) + '%', target: '≥ 50%' },
      { name: 'Max Drawdown', ok: dd.ddPct < 20, value: dd.ddPct.toFixed(1) + '%', target: '< 20%' },
      { name: 'Trade Count', ok: trades >= 30, value: String(trades), target: '≥ 30 (M2), ≥ 150 (M3)' },
      { name: 'Equity vs start', ok: pnl >= 0, value: (pnl >= 0 ? '+' : '') + pnlPct.toFixed(2) + '%', target: '> 0%' },
    ]
    const passed = checks.filter(c => c.ok).length
    healthScore = (passed / checks.length) * 100
    const healthColor = healthScore >= 70 ? 'green' : healthScore >= 40 ? 'yellow' : 'red'
    const healthLabel = trades < 5
      ? 'COLLECTING_DATA'
      : healthScore >= 70 ? 'HEALTHY'
      : healthScore >= 40 ? 'WARNING'
      : 'CRITICAL'

    return {
      score: Math.round(healthScore),
      color: healthColor,
      label: healthLabel,
      uptime: Math.floor((Date.now() - deps.startedAt) / 1000),
      demoEquity: demoEq,
      startingBalance: startBal,
      pnl, pnlPct,
      trades, wins, losses, winRate,
      profitFactor,
      maxDrawdown: dd,
      router: { signalsGenerated, ordersAttempted, ordersAccepted, acceptRate },
      perStrategy: perStrategy.map(s => ({
        ...s,
        win_rate: (s.wins + s.losses) > 0 ? (s.wins / (s.wins + s.losses)) * 100 : 0,
        profit_factor: s.gross_loss > 0 ? s.gross_win / s.gross_loss : (s.gross_win > 0 ? 99 : 0),
      })),
      checks,
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
