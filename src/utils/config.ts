// Config loader + validator. Single source of truth per ogni env var.
// Validato con zod al boot — se manca qualcosa il bot rifiuta di partire.

import 'dotenv/config'
import { z } from 'zod'

const num = (def?: number) =>
  z.coerce.number().default(def ?? 0)

const bool = (def: boolean) =>
  z.preprocess(v => v === 'true' || v === true, z.boolean()).default(def)

const csv = (def: string[] = []) =>
  z.string().default(def.join(',')).transform(s => s.split(',').map(x => x.trim()).filter(Boolean))

const ConfigSchema = z.object({
  network: z.enum(['testnet', 'mainnet']).default('mainnet'),

  // Wallet
  apiPrivateKey: z.string().min(64, 'HL_API_PRIVATE_KEY missing or too short').optional(),
  apiWalletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid HL_API_WALLET_ADDRESS').optional(),
  masterAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'invalid HL_MASTER_ADDRESS').optional(),

  allowedCoins: csv(['BTC', 'ETH', 'SOL', 'XRP', 'BNB']),

  // Risk (soft — clamped against hard limits in risk-manager.ts)
  maxDailyLossPct: num(2.0),
  maxPositionUsd: num(500),
  maxTotalExposureUsd: num(1500),
  maxLeverage: num(3),
  maxOpenPositions: num(3),
  riskPerTradePct: num(1.0),
  ruinThresholdPct: num(50),

  // Execution
  dryRun: bool(true),
  heartbeatTimeoutSec: num(30),
  minTimeBetweenOrdersMs: num(1000),
  useReduceOnlyForCloses: bool(true),
  defaultTif: z.enum(['Gtc', 'Ioc', 'Alo']).default('Gtc'),

  // Strategy
  strategyEnabled: csv(['mssChoCH', 'liqSweep', 'tripleBarTrap', 'failedBk', 'pivotReversal']),
  strategyTimeframe: z.string().default('15m'),
  slAtrMult: num(1.0),
  tpAtrMult: num(1.8),
  maxBarsInTrade: num(30),
  atrPeriod: num(14),

  // Persistence
  dbPath: z.string().default('./data/bot.db'),
  auditLogPath: z.string().default('./data/audit/signed-payloads.log'),

  // API
  apiPort: num(7777),
  apiBind: z.string().default('127.0.0.1'),

  // Logging
  logLevel: z.enum(['trace', 'debug', 'info', 'warn', 'error']).default('info'),
  logPretty: bool(true),
})

export type Config = z.infer<typeof ConfigSchema>

/** Empty string → undefined: così `KEY=` in .env è trattato come "non impostato" e i campi opzionali funzionano correttamente con zod. */
const e = (v: string | undefined): string | undefined => (v && v.trim().length > 0 ? v : undefined)

export function loadConfig(): Config {
  const raw = {
    network:             process.env.HL_NETWORK,
    apiPrivateKey:       e(process.env.HL_API_PRIVATE_KEY),
    apiWalletAddress:    e(process.env.HL_API_WALLET_ADDRESS),
    masterAddress:       e(process.env.HL_MASTER_ADDRESS),
    allowedCoins:        process.env.HL_ALLOWED_COINS,
    maxDailyLossPct:     process.env.RISK_MAX_DAILY_LOSS_PCT,
    maxPositionUsd:      process.env.RISK_MAX_POSITION_USD,
    maxTotalExposureUsd: process.env.RISK_MAX_TOTAL_EXPOSURE_USD,
    maxLeverage:         process.env.RISK_MAX_LEVERAGE,
    maxOpenPositions:    process.env.RISK_MAX_OPEN_POSITIONS,
    riskPerTradePct:     process.env.RISK_PER_TRADE_PCT,
    ruinThresholdPct:    process.env.RISK_RUIN_THRESHOLD_PCT,
    dryRun:              process.env.EXEC_DRY_RUN,
    heartbeatTimeoutSec: process.env.EXEC_HEARTBEAT_TIMEOUT_SEC,
    minTimeBetweenOrdersMs: process.env.EXEC_MIN_TIME_BETWEEN_ORDERS_MS,
    useReduceOnlyForCloses: process.env.EXEC_USE_REDUCE_ONLY_FOR_CLOSES,
    defaultTif:          process.env.EXEC_DEFAULT_TIF,
    strategyEnabled:     process.env.STRATEGY_ENABLED,
    strategyTimeframe:   process.env.STRATEGY_TIMEFRAME,
    slAtrMult:           process.env.STRATEGY_SL_ATR_MULT,
    tpAtrMult:           process.env.STRATEGY_TP_ATR_MULT,
    maxBarsInTrade:      process.env.STRATEGY_MAX_BARS_IN_TRADE,
    atrPeriod:           process.env.STRATEGY_ATR_PERIOD,
    dbPath:              process.env.DB_PATH,
    auditLogPath:        process.env.AUDIT_LOG_PATH,
    apiPort:             process.env.API_PORT,
    apiBind:             process.env.API_BIND,
    logLevel:            process.env.LOG_LEVEL,
    logPretty:           process.env.LOG_PRETTY,
  }
  const parsed = ConfigSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues.map(i => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Config validation failed:\n${issues}`)
  }
  return parsed.data
}
