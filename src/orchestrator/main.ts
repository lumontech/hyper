// Bot entrypoint — boot order conservativo, fail-closed.
// Modalità: dryRun (default) o live. Le strategie girano sempre; cambia solo se firma.

import { loadConfig } from '../utils/config.js'
import { createLogger } from '../utils/logger.js'
import { HyperliquidClient } from '../core/hyperliquid-client.js'
import { AccountStateService } from '../core/account-state.js'
import { WebSocketFeed } from '../core/websocket-feed.js'
import { RiskManager } from '../engine/risk-manager.js'
import { PositionManager } from '../engine/position-manager.js'
import { LiveExecutor } from '../engine/live-executor.js'
import { KillSwitch } from '../guardian/kill-switch.js'
import { Heartbeat } from '../guardian/heartbeat.js'
import { CircuitBreakers } from '../guardian/circuit-breakers.js'
import { BotDb } from '../persistence/db.js'
import { AuditLog } from '../persistence/audit-log.js'
import { SignalRouter } from './signal-router.js'
import { getEnabledStrategies } from '../strategy/strategy-registry.js'
import { EventsCalendar } from '../strategy/events-calendar.js'
import { startHttpServer } from '../api/http-server.js'

async function main() {
  const startedAt = Date.now()

  // 1. Config
  const config = loadConfig()
  const logger = createLogger(config.logLevel, config.logPretty)
  logger.info({ network: config.network, dryRun: config.dryRun, coins: config.allowedCoins, strategies: config.strategyEnabled }, '[BOOT] config loaded')

  // 2. Strategies
  const strategies = getEnabledStrategies(config.strategyEnabled)
  if (strategies.length === 0) {
    logger.error({ requested: config.strategyEnabled }, '[BOOT] no strategies matched, aborting')
    process.exit(1)
  }
  logger.info({ enabled: strategies.map(s => s.id) }, '[BOOT] strategies loaded')

  // 3. Persistence
  const db = new BotDb({ path: config.dbPath, logger })
  const audit = new AuditLog({ path: config.auditLogPath, logger })
  audit.append('boot', { config: { ...config, apiPrivateKey: config.apiPrivateKey ? '***' : null } })

  // 4. HL client + account state
  const client = new HyperliquidClient({ config, logger })
  const account = new AccountStateService(config, logger)

  let initialEquity = 1000   // placeholder
  if (config.masterAddress) {
    await account.refresh()
    const curr = account.current()
    if (curr) {
      initialEquity = curr.equityUsd
      logger.info({ equity: initialEquity, n_positions: curr.positions.length }, '[BOOT] account state fetched')
    } else {
      logger.warn('[BOOT] could not fetch account state, using placeholder equity')
    }
    account.start(5000)
  } else {
    logger.warn('[BOOT] HL_MASTER_ADDRESS not set — running in placeholder mode')
  }

  // 5. Risk manager
  const risk = new RiskManager({ config, logger })
  risk.initializeFromAccount(account.current() ?? account.placeholder(initialEquity))

  // 6. Position manager + live executor
  // Definiamo le ref forward per il closure di onForceClose
  let executor: LiveExecutor
  const positions = new PositionManager({
    logger,
    onForceClose: async (coin, reason) => { await executor.forceClose(coin, reason) },
    graceMs: 5000,
  })
  executor = new LiveExecutor({ config, logger, client, account, risk, positions, db, audit })

  // 6b. Events calendar (macro + crypto-specific)
  const events = new EventsCalendar({ logger, fetchExternal: true, fetchIntervalMin: 360 })
  events.start()

  // 7. Signal router (con pattern booster + event guard)
  const router = new SignalRouter({ config, logger, executor, positions, strategies, events })

  // 8. Heartbeat per coin
  const heartbeat = new Heartbeat({
    coins: config.allowedCoins,
    timeoutSec: config.heartbeatTimeoutSec,
    logger,
    onStale: async (coin, age) => {
      if (!positions.get(coin)) {
        logger.warn({ coin, ageMs: age }, '[MAIN] stale feed but no open position, ignoring')
        return
      }
      logger.error({ coin, ageMs: age }, '[MAIN] stale feed, force closing coin')
      await executor.forceClose(coin, `stale-feed-${age}ms`)
    },
  })

  // 9. Circuit breakers
  const cb = new CircuitBreakers({
    account, risk, logger,
    startingEquity: initialEquity,
    ruinThresholdPct: config.ruinThresholdPct,
    maxDailyLossPct: config.maxDailyLossPct,
  })

  // 10. Kill-switch (poll .HALT + SIGTERM)
  const killSwitch = new KillSwitch({
    logger,
    onHalt: async (reason) => {
      logger.error({ reason }, '[MAIN] HALT — flattening all positions')
      audit.append('halt', { reason, positions: positions.list().map(p => p.coin) })
      await executor.emergencyFlatten()
    },
  })
  killSwitch.start()
  heartbeat.start()
  cb.start()

  // 11. Bootstrap candle buffers da REST per ogni coin
  logger.info('[BOOT] priming candle buffers')
  for (const coin of config.allowedCoins) {
    try {
      const candles = await client.fetchCandles(coin, config.strategyTimeframe, 500)
      router.primeBuffer(coin, candles)
    } catch (err) {
      logger.error({ coin, err: String(err) }, '[BOOT] candle prime failed')
    }
  }

  // 12. WebSocket feed live
  const ws = new WebSocketFeed({
    network: config.network,
    userAddress: config.masterAddress,
    logger,
    onCandle: async (coin, candle, isClose) => {
      heartbeat.onTick(coin)
      await router.onCandle(coin, candle, isClose)
    },
    onMids: (mids) => {
      for (const coin of config.allowedCoins) {
        const mid = mids[coin]
        if (mid !== undefined) {
          heartbeat.onTick(coin)
          positions.onMid(coin, mid)
        }
      }
    },
    onFill: (fill) => {
      db.insertFill(fill)
      if (fill.pnl !== undefined) risk.recordFillPnl(fill.pnl)
      if (fill.isClose) positions.untrack(fill.coin)
      logger.info({ coin: fill.coin, dir: fill.direction, price: fill.price, pnl: fill.pnl }, '[FILL]')
      audit.append('fill', fill)
    },
    onConnect: () => logger.info('[BOOT] WS connected'),
    onDisconnect: () => logger.warn('[BOOT] WS disconnected'),
  })

  ws.subscribeAllMids()
  for (const coin of config.allowedCoins) {
    ws.subscribe(coin, config.strategyTimeframe)
  }
  if (config.masterAddress) ws.subscribeUserFills()
  ws.start()

  // 13. Equity recorder loop (1/min)
  setInterval(() => {
    const acct = account.current()
    if (!acct) return
    const dailyPnl = risk.snapshot().dailyPnlUsd
    db.recordEquity(Date.now(), acct.equityUsd, acct.marginUsedUsd, acct.positions.length, dailyPnl)
  }, 60000)

  // 14. HTTP API
  await startHttpServer({
    config, logger, client, risk, startedAt,
    router, positions, db, heartbeat, events,
  })

  logger.info({ webUI: `http://${config.apiBind}:${config.apiPort}` }, '[BOOT] startup complete — autonomous trading loop active')
  process.stdin.resume()
}

main().catch(err => {
  console.error('[FATAL]', err)
  process.exit(1)
})
