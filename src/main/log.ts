/**
 * Minimal structured logger for the main process.
 *
 * Cross-cutting requirement: structured logs, viewable in dev, and NEVER
 * logging auth material or full file contents. Keep payloads to metadata
 * (ids, counts, statuses) — not file bodies or tokens.
 *
 * This is intentionally tiny for now; it can be swapped for electron-log or
 * pino later without changing call sites.
 */
type Level = 'debug' | 'info' | 'warn' | 'error'

function emit(level: Level, event: string, data?: Record<string, unknown>): void {
  const entry = {
    t: new Date().toISOString(),
    level,
    event,
    ...(data ? { data } : {})
  }
  const line = JSON.stringify(entry)
  if (level === 'error') {
    process.stderr.write(line + '\n')
  } else {
    process.stdout.write(line + '\n')
  }
}

export const log = {
  debug: (event: string, data?: Record<string, unknown>) => emit('debug', event, data),
  info: (event: string, data?: Record<string, unknown>) => emit('info', event, data),
  warn: (event: string, data?: Record<string, unknown>) => emit('warn', event, data),
  error: (event: string, data?: Record<string, unknown>) => emit('error', event, data)
}
