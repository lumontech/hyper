// SQLite persistence — orders, fills, equity_curve, audit.
// Usa node:sqlite (built-in da Node 22.5+, stable da Node 24).
// Zero dipendenze native esterne, niente node-gyp, niente Visual Studio Build Tools.

import { DatabaseSync } from 'node:sqlite'
import { dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import type { Logger } from 'pino'
import type { OrderRequest, Fill } from '../types/trading.js'

export interface DbDeps {
  path: string
  logger: Logger
}

export class BotDb {
  private db: DatabaseSync

  constructor(private readonly deps: DbDeps) {
    mkdirSync(dirname(deps.path), { recursive: true })
    this.db = new DatabaseSync(deps.path)
    this.db.exec('PRAGMA journal_mode = WAL')
    this.db.exec('PRAGMA foreign_keys = ON')
    this.migrate()
    deps.logger.info({ path: deps.path }, '[DB] initialized (node:sqlite)')
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS orders (
        id              TEXT PRIMARY KEY,
        ts              INTEGER NOT NULL,
        coin            TEXT NOT NULL,
        direction       TEXT NOT NULL,
        type            TEXT NOT NULL,
        size            REAL NOT NULL,
        limit_price     REAL,
        sl_price        REAL,
        tp_price        REAL,
        strategy_id     TEXT NOT NULL,
        signal_reason   TEXT,
        status          TEXT NOT NULL DEFAULT 'sent',
        dry_run         INTEGER NOT NULL DEFAULT 1,
        hl_response     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_orders_ts ON orders(ts);
      CREATE INDEX IF NOT EXISTS idx_orders_coin ON orders(coin);

      CREATE TABLE IF NOT EXISTS fills (
        id              TEXT PRIMARY KEY,
        order_id        TEXT,
        ts              INTEGER NOT NULL,
        coin            TEXT NOT NULL,
        direction       TEXT NOT NULL,
        size            REAL NOT NULL,
        price           REAL NOT NULL,
        fee             REAL NOT NULL,
        pnl             REAL,
        is_close        INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_fills_ts ON fills(ts);
      CREATE INDEX IF NOT EXISTS idx_fills_coin ON fills(coin);

      CREATE TABLE IF NOT EXISTS equity_curve (
        ts              INTEGER PRIMARY KEY,
        equity_usd      REAL NOT NULL,
        margin_used_usd REAL NOT NULL,
        n_open          INTEGER NOT NULL,
        daily_pnl_usd   REAL
      );

      CREATE TABLE IF NOT EXISTS audit (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        ts              INTEGER NOT NULL,
        action          TEXT NOT NULL,
        payload_hash    TEXT,
        signature       TEXT,
        response        TEXT,
        notes           TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_audit_ts ON audit(ts);
    `)
  }

  insertOrder(o: OrderRequest, id: string, dryRun: boolean, hlResponse?: unknown): void {
    const stmt = this.db.prepare(`
      INSERT INTO orders (id, ts, coin, direction, type, size, limit_price, sl_price, tp_price, strategy_id, signal_reason, status, dry_run, hl_response)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      id,
      o.generatedAt,
      o.coin,
      o.direction,
      o.type,
      o.size,
      o.limitPrice ?? null,
      o.stopLoss ?? null,
      o.takeProfit ?? null,
      o.strategyId,
      o.signalReason,
      'sent',
      dryRun ? 1 : 0,
      hlResponse ? JSON.stringify(hlResponse) : null,
    )
  }

  insertFill(f: Fill): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO fills (id, order_id, ts, coin, direction, size, price, fee, pnl, is_close)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      f.orderId + '-fill-' + f.ts,
      f.orderId,
      f.ts,
      f.coin,
      f.direction,
      f.size,
      f.price,
      f.fee,
      f.pnl ?? null,
      f.isClose ? 1 : 0,
    )
  }

  recordEquity(ts: number, equityUsd: number, marginUsedUsd: number, nOpen: number, dailyPnlUsd: number): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO equity_curve (ts, equity_usd, margin_used_usd, n_open, daily_pnl_usd)
      VALUES (?, ?, ?, ?, ?)
    `)
    stmt.run(ts, equityUsd, marginUsedUsd, nOpen, dailyPnlUsd)
  }

  recordAudit(action: string, payloadHash?: string, signature?: string, response?: unknown, notes?: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO audit (ts, action, payload_hash, signature, response, notes)
      VALUES (?, ?, ?, ?, ?, ?)
    `)
    stmt.run(
      Date.now(),
      action,
      payloadHash ?? null,
      signature ?? null,
      response ? JSON.stringify(response).slice(0, 4000) : null,
      notes ?? null,
    )
  }

  getEquityCurve(limit = 500): Array<{ ts: number; equity_usd: number; margin_used_usd: number; n_open: number; daily_pnl_usd: number | null }> {
    const stmt = this.db.prepare(`
      SELECT ts, equity_usd, margin_used_usd, n_open, daily_pnl_usd
      FROM equity_curve
      ORDER BY ts DESC
      LIMIT ?
    `)
    return (stmt.all(limit) as Array<{ ts: number; equity_usd: number; margin_used_usd: number; n_open: number; daily_pnl_usd: number | null }>).reverse()
  }

  getRecentOrders(limit = 100): Array<Record<string, unknown>> {
    const stmt = this.db.prepare('SELECT * FROM orders ORDER BY ts DESC LIMIT ?')
    return stmt.all(limit) as Array<Record<string, unknown>>
  }

  getRecentFills(limit = 100): Array<Record<string, unknown>> {
    const stmt = this.db.prepare('SELECT * FROM fills ORDER BY ts DESC LIMIT ?')
    return stmt.all(limit) as Array<Record<string, unknown>>
  }

  /** Ricostruisce lo stato demo dai fill: equity finale, trade count, wins, losses. */
  getDemoStateFromFills(startingBalance: number): {
    demoEquity: number
    demoTrades: number
    demoWins: number
    demoLosses: number
  } {
    const stmt = this.db.prepare(`
      SELECT COALESCE(SUM(pnl), 0) AS total_pnl,
             COUNT(*) AS n_close,
             SUM(CASE WHEN pnl > 0 THEN 1 ELSE 0 END) AS wins,
             SUM(CASE WHEN pnl < 0 THEN 1 ELSE 0 END) AS losses
      FROM fills WHERE is_close = 1
    `)
    const r = stmt.get() as { total_pnl: number; n_close: number; wins: number; losses: number }
    return {
      demoEquity: startingBalance + (r.total_pnl ?? 0),
      demoTrades: r.n_close ?? 0,
      demoWins: r.wins ?? 0,
      demoLosses: r.losses ?? 0,
    }
  }

  /** Stats aggregate per strategia (join fills × orders). */
  getStatsByStrategy(): Array<{
    strategy_id: string
    trades: number
    wins: number
    losses: number
    total_pnl: number
    gross_win: number
    gross_loss: number
  }> {
    const stmt = this.db.prepare(`
      SELECT o.strategy_id,
             COUNT(f.id) AS trades,
             SUM(CASE WHEN f.pnl > 0 THEN 1 ELSE 0 END) AS wins,
             SUM(CASE WHEN f.pnl < 0 THEN 1 ELSE 0 END) AS losses,
             COALESCE(SUM(f.pnl), 0) AS total_pnl,
             COALESCE(SUM(CASE WHEN f.pnl > 0 THEN f.pnl ELSE 0 END), 0) AS gross_win,
             COALESCE(SUM(CASE WHEN f.pnl < 0 THEN ABS(f.pnl) ELSE 0 END), 0) AS gross_loss
      FROM fills f
      JOIN orders o ON o.id = f.order_id
      WHERE f.is_close = 1
      GROUP BY o.strategy_id
      ORDER BY total_pnl DESC
    `)
    return stmt.all() as never
  }

  /** Max drawdown osservato sulla equity curve. */
  getMaxDrawdown(): { peak: number; trough: number; ddPct: number; ddUsd: number } {
    const curve = this.getEquityCurve(10000)
    let peak = 0, trough = 0, maxDD = 0
    let currentPeak = -Infinity
    for (const p of curve) {
      if (p.equity_usd > currentPeak) currentPeak = p.equity_usd
      const dd = currentPeak - p.equity_usd
      if (dd > maxDD) {
        maxDD = dd
        peak = currentPeak
        trough = p.equity_usd
      }
    }
    return { peak, trough, ddPct: peak > 0 ? (maxDD / peak) * 100 : 0, ddUsd: maxDD }
  }

  close(): void {
    this.db.close()
  }
}
