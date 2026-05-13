// Audit log — JSONL append-only di ogni payload firmato/inviato.
// Mai cancellare. Mai modificare. Solo append. Sopravvive alla DB se serve forensics.

import { appendFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'
import type { Logger } from 'pino'

export interface AuditLogDeps {
  path: string
  logger: Logger
}

export class AuditLog {
  constructor(private readonly deps: AuditLogDeps) {
    mkdirSync(dirname(deps.path), { recursive: true })
    if (!existsSync(deps.path)) {
      appendFileSync(deps.path, '')
    }
    deps.logger.info({ path: deps.path }, '[AUDIT] log ready')
  }

  append(action: string, payload: unknown, signature?: string, response?: unknown): string {
    const payloadStr = JSON.stringify(payload)
    const hash = createHash('sha256').update(payloadStr).digest('hex').slice(0, 16)
    const entry = {
      ts: new Date().toISOString(),
      action,
      payloadHash: hash,
      payload,
      signature: signature ?? null,
      response: response ?? null,
    }
    appendFileSync(this.deps.path, JSON.stringify(entry) + '\n')
    return hash
  }
}
