// Backtest mensile — esegue il simulator su 30 giorni di dati HL reali per ogni
// combinazione (strategia × coin). Output console + JSON in data/results/.

import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { loadConfig } from '../src/utils/config.js'
import { createLogger } from '../src/utils/logger.js'
import { HyperliquidClient } from '../src/core/hyperliquid-client.js'
import { simulateAccount } from '../src/engine/simulator.js'
import { ALL_STRATEGIES } from '../src/strategy/strategy-registry.js'

async function main() {
  const config = loadConfig()
  const logger = createLogger(config.logLevel, config.logPretty)
  const client = new HyperliquidClient({ config, logger })

  const tf = config.strategyTimeframe   // es. '15m'
  // 30 giorni in 15m = 2880 candele
  const tfSeconds: Record<string, number> = { '1m': 60, '5m': 300, '15m': 900, '1h': 3600, '4h': 14400, '1D': 86400 }
  const sec = tfSeconds[tf] ?? 900
  const need = Math.ceil((30 * 86400) / sec) + 300   // 30 giorni + warmup buffer

  logger.info({ tf, coins: config.allowedCoins, candlesPerCoin: need }, '[BACKTEST] starting')

  const allResults: Array<{ symbol: string; strategy: string; result: ReturnType<typeof simulateAccount> }> = []

  for (const coin of config.allowedCoins) {
    logger.info({ coin }, '[BACKTEST] fetching candles')
    let candles
    try {
      candles = await client.fetchCandles(coin, tf, need)
    } catch (err) {
      logger.error({ coin, err: String(err) }, '[BACKTEST] candle fetch failed')
      continue
    }
    logger.info({ coin, n: candles.length, first: new Date(candles[0]!.time * 1000).toISOString(), last: new Date(candles[candles.length - 1]!.time * 1000).toISOString() }, '[BACKTEST] candles ready')

    for (const strategy of ALL_STRATEGIES) {
      const result = simulateAccount(strategy, candles, {
        symbol:         coin,
        startingBalance: 1000,
        riskPerTrade:    config.riskPerTradePct / 100,
        slMul:           config.slAtrMult,
        tpMul:           config.tpAtrMult,
        maxBars:         config.maxBarsInTrade,
        minWarmup:       250,
      })
      allResults.push({ symbol: coin, strategy: strategy.id, result })
      if ('error' in result) {
        logger.warn({ coin, strategy: strategy.id, err: result.error }, '[BACKTEST] sim failed')
        continue
      }
      const s = result.summary
      logger.info({
        coin,
        strategy: strategy.id,
        trades: s.total,
        wr: (s.winRate * 100).toFixed(1) + '%',
        pf: s.profitFactor.toFixed(2),
        pnl: result.pnlPct + '%',
        dd: result.maxDrawdownPct + '%',
        blown: result.blown,
      }, '[BACKTEST] result')
    }
  }

  // Salva JSON
  const outPath = resolve(`./data/results/backtest-${new Date().toISOString().slice(0, 10)}.json`)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(allResults, null, 2))
  logger.info({ outPath }, '[BACKTEST] results saved')

  // Console summary table
  console.log('\n┌─ BACKTEST 30d SUMMARY ─────────────────────────────────────┐')
  console.log('│ Coin   │ Strategy        │ Trades │ WR     │ PF    │ PnL%   │')
  console.log('├────────┼─────────────────┼────────┼────────┼───────┼────────┤')
  for (const r of allResults) {
    if ('error' in r.result) continue
    const s = r.result.summary
    console.log(
      `│ ${r.symbol.padEnd(6)} │ ${r.strategy.padEnd(15)} │ ${String(s.total).padStart(6)} │ ${(s.winRate * 100).toFixed(1).padStart(5)}% │ ${s.profitFactor.toFixed(2).padStart(5)} │ ${String(r.result.pnlPct).padStart(6)} │`,
    )
  }
  console.log('└────────┴─────────────────┴────────┴────────┴───────┴────────┘\n')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
