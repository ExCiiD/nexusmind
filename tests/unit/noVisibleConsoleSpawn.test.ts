import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

/**
 * 27/11/2026 (user: "terminal tabs opening and closing while nothing was running"): on Windows 11 every child process
 * started without `windowsHide: true` flashes a console window or Terminal tab (thumbnails, durations, clips were the
 * culprits). Every spawn / execFile / exec of the main process must hide its window.
 */
const MAIN = join(__dirname, '../../electron/main')
const CALL = /\b(spawn|spawnSync|execFile|execFileSync|execSync)\(/g

function filesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    return statSync(p).isDirectory() ? filesUnder(p) : p.endsWith('.ts') ? [p] : []
  })
}

describe('main-process child processes', () => {
  it('always hide their console window', () => {
    const offenders: string[] = []
    for (const file of filesUnder(MAIN)) {
      const src = readFileSync(file, 'utf8')
      for (const m of src.matchAll(CALL)) {
        // The call's own text: up to the closing parenthesis of a reasonably sized call.
        const call = src.slice(m.index!, m.index! + 400)
        const end = call.indexOf('})')
        const body = end >= 0 ? call.slice(0, end + 2) : call
        if (!/windowsHide:\s*true/.test(body)) {
          const line = src.slice(0, m.index).split('\n').length
          offenders.push(`${file.replace(MAIN, 'electron/main')}:${line}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })
})
