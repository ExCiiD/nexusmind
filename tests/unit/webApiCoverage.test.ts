/**
 * #18 (FE-4 / WSC-16): every `window.api.method(...)` the web bundle calls without a guard exists in the web adapter.
 * A missing one is a blank page on the web (the cause of the bugs fixed in f16efe7). Calls written
 * `window.api.method?.(...)`, or behind `typeof window.api.method`, are the screens' own guard for desktop-only
 * features and are allowed to be missing. The signatures themselves are checked by web/src/apiContract.ts.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { webApi } from '../../web/src/api'

const ROOT = resolve(__dirname, '../..')
const SRC = join(ROOT, 'src')
const WEB = join(ROOT, 'web', 'src')

/** Resolves an import specifier the way the web build does (`@/` → src, `@web/` → web/src, relative). */
function resolveImport(from: string, spec: string): string | null {
  let base: string
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2))
  else if (spec.startsWith('@web/')) base = join(WEB, spec.slice(5))
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec)
  else return null // a package
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (/\.(ts|tsx)$/.test(candidate) && existsSync(candidate)) return candidate
  }
  return null // an asset, JSON, CSS...
}

/** Every .ts / .tsx file reachable from the web entry point. */
function webBundleFiles(): string[] {
  const seen = new Set<string>()
  const queue = [join(WEB, 'main.tsx')]
  const IMPORT = /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g
  while (queue.length > 0) {
    const file = queue.pop()!
    if (seen.has(file)) continue
    seen.add(file)
    const text = readFileSync(file, 'utf-8')
    for (const m of text.matchAll(IMPORT)) {
      if (/^\s*(?:import|export)\s+type\s/.test(m[0])) continue // types never run
      const next = resolveImport(file, m[1] ?? m[2])
      if (next && !seen.has(next)) queue.push(next)
    }
  }
  return [...seen]
}

/** `window.api.name(` calls, i.e. not `?.(`-guarded. */
function unguardedCalls(files: string[]): Map<string, string[]> {
  const calls = new Map<string, string[]>()
  for (const file of files) {
    // Comments aside: a doc comment that names `window.api.x()` is not a call ("https://" is not a comment).
    const text = readFileSync(file, 'utf-8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
    for (const m of text.matchAll(/window\.api\.([A-Za-z0-9_]+)\s*\(/g)) {
      const where = calls.get(m[1]) ?? []
      where.push(file.slice(ROOT.length + 1).replace(/\\/g, '/'))
      calls.set(m[1], where)
    }
  }
  return calls
}

/**
 * Unguarded calls the web adapter does not implement on purpose, each read by hand (19/11/2026). Anything new
 * here needs the same look: is the call unreachable on the web, caught, or a blank page waiting to happen?
 */
const KNOWN_WEB_GAPS: Record<string, string> = {
  // Behind a component-level capability check (`if (!canRecord) return` after `typeof window.api.startCapture`).
  startCapture: 'ReviewRecorder: desktop-only, returns before any call on the web',
  stopCapture: 'ReviewRecorder: desktop-only',
  transcriptionRun: 'ReviewRecorder: desktop-only',
  youtubeGetStatus: 'ReviewRecorder: desktop-only',
  youtubeUpload: 'ReviewRecorder: desktop-only',
  // Caught by the caller, with a working fallback.
  createMistakeTag: 'TeamCodexCard: no personal library on the web, falls back to the slug (try/catch)',
  getUser: 'useUserStore: no local profile on the web, user stays null (try/catch)',
  // Desktop only by decision (WSC-04, user decision V of 19/11/2026: these team tabs are hidden on the web).
  // #41b: the web Stats collectives renders CustomGamesStatsTab with readOnly, which hides the import and delete buttons.
  importCustomGameCsv: 'CustomGamesStatsTab: the CSV import stays on the desktop (readOnly on the web, button hidden)',
  deleteCustomGame: 'CustomGamesStatsTab: deleting stays on the desktop (readOnly on the web, button hidden)',
  linkTeamToGroup: 'GroupTeamGate: the web has no local teams to link, desktop only (WSC-04, hidden on the web)',
}

describe('web adapter coverage (#18)', () => {
  const files = webBundleFiles()

  it('walks the real web bundle', () => {
    const rel = files.map((f) => f.slice(ROOT.length + 1).replace(/\\/g, '/'))
    expect(rel).toContain('web/src/main.tsx')
    expect(rel).toContain('web/src/api.ts')
    expect(rel.some((f) => f.startsWith('src/components/'))).toBe(true)
    expect(files.length).toBeGreaterThan(50)
  })

  it('every unguarded window.api call of the web bundle exists in webApi', () => {
    const implemented = new Set(Object.keys(webApi))
    const missing = [...unguardedCalls(files)]
      .filter(([name]) => !implemented.has(name) && !(name in KNOWN_WEB_GAPS))
      .map(([name, where]) => `${name} (${[...new Set(where)].join(', ')})`)
    expect(missing).toEqual([])
  })

  it('the known gaps are still gaps (remove an entry once the web implements it)', () => {
    const implemented = new Set(Object.keys(webApi))
    expect(Object.keys(KNOWN_WEB_GAPS).filter((name) => implemented.has(name))).toEqual([])
  })
})
