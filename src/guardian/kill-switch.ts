// Kill-Switch — il guardiano supremo.
// Polla `.HALT` ogni 500ms. Se appare, scatena flatten + exit.
// Funziona anche se tutto il resto del bot è in crash loop o blocked.

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Logger } from 'pino'

export interface KillSwitchDeps {
  haltFilePath?: string
  pollIntervalMs?: number
  logger: Logger
  onHalt: (reason: string) => Promise<void>
}

export class KillSwitch {
  private readonly haltFile: string
  private readonly pollMs: number
  private timer: NodeJS.Timeout | null = null
  private triggered = false

  constructor(private readonly deps: KillSwitchDeps) {
    this.haltFile = resolve(deps.haltFilePath ?? '.HALT')
    this.pollMs = deps.pollIntervalMs ?? 500
  }

  start(): void {
    if (this.timer) return
    this.deps.logger.info({ file: this.haltFile, every: this.pollMs }, '[KILL] watcher started')
    this.timer = setInterval(() => this.poll(), this.pollMs)
    // Anche su SIGTERM/SIGINT
    process.on('SIGTERM', () => this.trigger('SIGTERM'))
    process.on('SIGINT', () => this.trigger('SIGINT'))
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  private poll(): void {
    if (this.triggered) return
    if (existsSync(this.haltFile)) {
      let content = ''
      try { content = readFileSync(this.haltFile, 'utf8').slice(0, 200) } catch {}
      this.trigger(`HALT_FILE: ${content || '(empty)'}`)
    }
  }

  async trigger(reason: string): Promise<void> {
    if (this.triggered) return
    this.triggered = true
    this.deps.logger.error({ reason }, '[KILL] HALT triggered')
    try {
      await this.deps.onHalt(reason)
    } catch (err) {
      this.deps.logger.error({ err: String(err) }, '[KILL] onHalt() threw')
    } finally {
      this.deps.logger.error('[KILL] exiting process')
      process.exit(0)
    }
  }

  isTriggered(): boolean {
    return this.triggered
  }
}
