/**
 * #13 point 2 (S3 / SEC-4 / S19-04): scripts/download-ffmpeg.mjs extracts and runs nothing before the zip's SHA-256
 * matches the pinned value, trusts an existing ffmpeg.exe on its pinned hash alone, and only warns when offline.
 * Runs the real script on a temp folder (NXM_FFMPEG_DEST) with a local zip or an unreachable URL: no real download.
 */
import { describe, it, expect, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const SCRIPT = resolve(__dirname, '../../scripts/download-ffmpeg.mjs')
const REAL_BIN = resolve(__dirname, '../../resources/ffmpeg-bin/win-x64/ffmpeg.exe')
const roots: string[] = []

function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'nxm-ffmpeg-test-'))
  roots.push(root)
  const dest = join(root, 'bin')
  const zip = join(root, "it's a fake.zip") // an apostrophe in the path, for the PowerShell quoting
  writeFileSync(zip, 'not the ffmpeg release')
  return { root, dest, zip }
}
const run = (env: Record<string, string>) => {
  const r = spawnSync(process.execPath, [SCRIPT], { env: { ...process.env, ...env }, encoding: 'utf-8' })
  return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? '') }
}

afterAll(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }) })

describe('download-ffmpeg integrity', () => {
  it('pins both hashes in the script itself', () => {
    const text = readFileSync(SCRIPT, 'utf-8')
    expect(text).toMatch(/const ZIP_SHA256 = '8748283d821613d930b0e7be685aaa9df4ca6f0ad4d0c42fd02622b3623463c6'/)
    expect(text).toMatch(/const EXE_SHA256 = '1a65d5b0b10d8d9a81d2824a3538046a40ed3607c906b335a166add87613f705'/)
    expect(text).not.toMatch(/verified\.json/)
  })

  it('refuses a zip whose SHA-256 is not the pinned one, before extracting anything', () => {
    const { dest, zip } = sandbox()
    const { code, out } = run({ NXM_FFMPEG_ZIP: zip, NXM_FFMPEG_DEST: dest })
    expect(code).toBe(1)
    expect(out).toMatch(/REFUSED: SHA-256 of the zip is [0-9a-f]{64}, expected 8748283d/)
    expect(out).not.toMatch(/Extracting/)
    expect(existsSync(join(dest, 'ffmpeg.exe'))).toBe(false)
  })

  it('an existing ffmpeg.exe with another hash is not trusted nor run (re-download, refused here)', () => {
    const { dest, zip } = sandbox()
    mkdirSync(dest, { recursive: true })
    writeFileSync(join(dest, 'ffmpeg.exe'), 'planted binary')
    const { code, out } = run({ NXM_FFMPEG_ZIP: zip, NXM_FFMPEG_DEST: dest })
    expect(out).toMatch(/not the pinned one: re-downloading/)
    expect(code).toBe(1)
    expect(out).toMatch(/REFUSED/)
  })

  it.runIf(existsSync(REAL_BIN))('the pinned ffmpeg.exe is kept without being run or re-downloaded', () => {
    const { dest } = sandbox()
    mkdirSync(dest, { recursive: true })
    copyFileSync(REAL_BIN, join(dest, 'ffmpeg.exe'))
    const { code, out } = run({ NXM_FFMPEG_DEST: dest, NXM_FFMPEG_ZIP: '', NXM_FFMPEG_URL: 'https://127.0.0.1:9/never' })
    expect(code).toBe(0)
    expect(out).toMatch(/Already present, SHA-256 matches the pinned value/)
    expect(out).not.toMatch(/Downloading|Extracting|ffmpeg version/)
    expect(readdirSync(dest)).toEqual(['ffmpeg.exe'])
  })

  it('offline: warns and exits 0, installs nothing (npm install must not fail)', () => {
    const { dest } = sandbox()
    const { code, out } = run({ NXM_FFMPEG_DEST: dest, NXM_FFMPEG_ZIP: '', NXM_FFMPEG_URL: 'https://127.0.0.1:9/never' })
    expect(code).toBe(0)
    expect(out).toMatch(/WARNING: download failed/)
    expect(existsSync(join(dest, 'ffmpeg.exe'))).toBe(false)
  })
})
