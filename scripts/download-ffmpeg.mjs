#!/usr/bin/env node
// @ts-check

/**
 * Downloads FFmpeg 8.1 (Gyan Windows essentials build) into resources/ffmpeg-bin/win-x64/.
 *
 * Idempotent: if the binary already exists and reports a matching version, we skip.
 *
 * Why bundle our own: `ffmpeg-static@5.3.0` ships FFmpeg 6.1.1, which predates
 * the February 2024 upstream patch (`21c6d12449`) that made `ddagrab` recover
 * from `DXGI_ERROR_ACCESS_LOST`. Without that patch, any alt-tab, Windows
 * notification, or display mode transition is fatal to the capture.
 */

import { createWriteStream, existsSync, mkdirSync, copyFileSync, rmSync, readdirSync, statSync, createReadStream } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import https from 'node:https'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')

const TARGET_VERSION = '8.1'
const DOWNLOAD_URL = 'https://github.com/GyanD/codexffmpeg/releases/download/8.1/ffmpeg-8.1-essentials_build.zip'

const DEST_DIR = join(PROJECT_ROOT, 'resources', 'ffmpeg-bin', 'win-x64')
const DEST_BIN = join(DEST_DIR, 'ffmpeg.exe')

const isWindowsHost = process.platform === 'win32'
if (!isWindowsHost) {
  console.log('[ffmpeg-dl] Skipping: host is not Windows (bundle only required for win-x64 builds)')
  process.exit(0)
}

if (existsSync(DEST_BIN)) {
  const existing = spawnSync(DEST_BIN, ['-version'], { encoding: 'utf-8' })
  const stdout = (existing.stdout || '') + (existing.stderr || '')
  if (stdout.includes(`ffmpeg version ${TARGET_VERSION}`)) {
    console.log(`[ffmpeg-dl] Already present: ${DEST_BIN} (ffmpeg ${TARGET_VERSION})`)
    process.exit(0)
  }
  console.log(`[ffmpeg-dl] Existing binary does not match version ${TARGET_VERSION}, re-downloading`)
}

mkdirSync(DEST_DIR, { recursive: true })

const tmpDir = join(tmpdir(), `nexusmind-ffmpeg-${Date.now()}`)
mkdirSync(tmpDir, { recursive: true })
const zipPath = join(tmpDir, 'ffmpeg.zip')

console.log(`[ffmpeg-dl] Downloading ${DOWNLOAD_URL}`)

/**
 * Downloads a URL to a local file, following HTTPS redirects up to `maxRedirects`.
 */
function download(url, destPath, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) {
      reject(new Error('Too many redirects'))
      return
    }
    https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume()
        download(res.headers.location, destPath, maxRedirects - 1).then(resolve, reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`))
        return
      }
      const out = createWriteStream(destPath)
      res.pipe(out)
      out.on('finish', () => out.close(() => resolve(undefined)))
      out.on('error', reject)
    }).on('error', reject)
  })
}

await download(DOWNLOAD_URL, zipPath)

const { size } = statSync(zipPath)
console.log(`[ffmpeg-dl] Downloaded ${Math.round(size / 1024 / 1024)} MB → ${zipPath}`)

console.log('[ffmpeg-dl] Extracting with PowerShell Expand-Archive')
const extracted = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmpDir}' -Force`],
  { stdio: 'inherit' },
)
if (extracted.status !== 0) {
  console.error('[ffmpeg-dl] Extraction failed')
  process.exit(1)
}

const rootEntries = readdirSync(tmpDir).filter((e) => e.startsWith('ffmpeg-') && statSync(join(tmpDir, e)).isDirectory())
if (rootEntries.length === 0) {
  console.error('[ffmpeg-dl] Could not find extracted ffmpeg-* folder')
  process.exit(1)
}
const sourceBin = join(tmpDir, rootEntries[0], 'bin', 'ffmpeg.exe')
if (!existsSync(sourceBin)) {
  console.error(`[ffmpeg-dl] ffmpeg.exe not found at expected path: ${sourceBin}`)
  process.exit(1)
}

// Use copy + remove instead of rename: tmpdir and project may be on different
// drives on Windows (EXDEV: cross-device link not permitted).
copyFileSync(sourceBin, DEST_BIN)
console.log(`[ffmpeg-dl] Installed → ${DEST_BIN}`)

try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* cleanup best-effort */ }

const verify = spawnSync(DEST_BIN, ['-version'], { encoding: 'utf-8' })
const verifyOutput = (verify.stdout || '') + (verify.stderr || '')
if (verifyOutput.includes(`ffmpeg version ${TARGET_VERSION}`)) {
  console.log(`[ffmpeg-dl] OK — ffmpeg ${TARGET_VERSION} ready`)
} else {
  console.error('[ffmpeg-dl] Version mismatch after install:')
  console.error(verifyOutput.split('\n')[0])
  process.exit(1)
}
