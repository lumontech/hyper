import pino from 'pino'

export function createLogger(level: string, pretty: boolean) {
  return pino({
    level,
    transport: pretty
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' } }
      : undefined,
  })
}
