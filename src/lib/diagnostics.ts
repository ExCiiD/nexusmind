/**
 * Small in-memory journal of recent renderer errors, attached to a bug report
 * only when the user ticks "attach technical info". Nothing is stored or
 * sent otherwise.
 */

interface LoggedError {
  at: string
  kind: 'error' | 'unhandledrejection' | 'console'
  message: string
}

const MAX = 30
const buffer: LoggedError[] = []
let installed = false

function push(kind: LoggedError['kind'], message: unknown): void {
  const text = message instanceof Error ? `${message.name}: ${message.message}\n${message.stack ?? ''}` : String(message)
  buffer.push({ at: new Date().toISOString(), kind, message: scrub(text).slice(0, 2000) })
  if (buffer.length > MAX) buffer.shift()
}

/** Removes things that look like secrets, e-mails or local user paths. */
export function scrub(text: string): string {
  return text
    .replace(/eyJ[\w-]{10,}\.[\w-]{10,}\.[\w-]{10,}/g, '<jwt>')
    .replace(/(RGAPI|sk|ghp|sb_secret)[-_][\w-]{8,}/gi, '<secret>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, '<email>')
    .replace(/([A-Za-z]:\\Users\\)[^\\\s"']+/g, '$1<user>')
    .replace(/(\/(?:home|Users)\/)[^/\s"']+/g, '$1<user>')
}

export function installDiagnostics(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('error', (e) => push('error', e.error ?? e.message))
  window.addEventListener('unhandledrejection', (e) => push('unhandledrejection', e.reason))
  const original = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    push('console', args.map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : safeJson(a))).join(' '))
    original(...args)
  }
}

function safeJson(v: unknown): string {
  try { return JSON.stringify(v) } catch { return String(v) }
}

export function collectDiagnostics(): Record<string, unknown> {
  return {
    userAgent: navigator.userAgent,
    language: navigator.language,
    screen: `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio}`,
    online: navigator.onLine,
    recentErrors: [...buffer],
  }
}

/** Current route without query strings (they may contain ids). */
export function currentRoute(): string {
  const hash = window.location.hash.replace(/^#/, '')
  return (hash || window.location.pathname).split('?')[0]
}
