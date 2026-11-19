#!/usr/bin/env node
// @ts-check

/**
 * Downloads FFmpeg 8.1 (Gyan Windows essentials build) into resources/ffmpeg-bin/win-x64/.
 *
 * Why bundle our own: `ffmpeg-static@5.3.0` ships FFmpeg 6.1.1, which predates
 * the February 2024 upstream patch (`21c6d12449`) that made `ddagrab` recover
 * from `DXGI_ERROR_ACCESS_LOST`. Without that patch, any alt-tab, Windows
 * notification, or display mode transition is fatal to the capture.
 *
 * Integrity (#13 point 2, S3 / SEC-4 / S19-04): the zip comes from a third party's GitHub
 * release and its ffmpeg.exe ships inside every installer. So nothing is extracted or run
 * before the zip's SHA-256 matches the pinned value below, and an existing ffmpeg.exe is
 * only trusted (never run first) when its SHA-256 matches the pinned EXE_SHA256. A
 * mismatch stops the script; an unreachable download only warns (release.ps1 checks the binary).
 *
 * Overrides, for tests and offline machines: NXM_FFMPEG_ZIP (a local zip instead of the
 * download), NXM_FFMPEG_DEST (another destination folder) and NXM_FFMPEG_URL (another
 * source: the pinned hashes still apply to whatever it serves).
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync, copyFileSync, rmSync, readdirSync, statSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import https from 'node:https'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = join(__dirname, '..')

const TARGET_VERSION = '8.1'
const DOWNLOAD_URL = process.env.NXM_FFMPEG_URL || 'https://github.com/GyanD/codexffmpeg/releases/download/8.1/ffmpeg-8.1-essentials_build.zip'
/**
 * SHA-256 of ffmpeg-8.1-essentials_build.zip (108 771 139 bytes), as published by GitHub for
 * that release asset (`digest`, computed by GitHub when the publisher uploaded it on
 * 2026-03-17), read on 2026-11-19 with `gh api repos/GyanD/codexffmpeg/releases/tags/8.1`.
 * gyan.dev only lists checksums for its current release (9.0.2 that day). Changing the
 * version means changing the URL, this hash and its source together.
 */
const ZIP_SHA256 = '8748283d821613d930b0e7be685aaa9df4ca6f0ad4d0c42fd02622b3623463c6'
/**
 * SHA-256 of bin/ffmpeg.exe inside that zip. Pinned here, not in a file next to the binary
 * (which anyone able to swap the binary could rewrite too). Read on 19/11/2026 from the copy
 * already installed in resources/ (CyberSecurity, S19-04): it is confirmed the first time the
 * script extracts the pinned zip, since an extracted ffmpeg.exe that differs is refused.
 * scripts/release.ps1 reads this line and refuses to build with any other binary.
 */
const EXE_SHA256 = '1a65d5b0b10d8d9a81d2824a3538046a40ed3607c906b335a166add87613f705'

const DEST_DIR = process.env.NXM_FFMPEG_DEST || join(PROJECT_ROOT, 'resources', 'ffmpeg-bin', 'win-x64')
const DEST_BIN = join(DEST_DIR, 'ffmpeg.exe')

const isWindowsHost = process.platform === 'win32'
if (!isWindowsHost && !process.env.NXM_FFMPEG_ZIP) {
  console.log('[ffmpeg-dl] Skipping: host is not Windows (bundle only required for win-x64 builds)')
  process.exit(0)
}

/** SHA-256 (hex) of a file, streamed. */
function sha256Of(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    createReadStream(path).on('data', (chunk) => hash.update(chunk)).on('end', () => resolve(hash.digest('hex'))).on('error', reject)
  })
}

/** Single quotes doubled, for a path inside a PowerShell single-quoted string. */
const psQuote = (s) => `'${String(s).replace(/'/g, "''")}'`

// An existing binary is trusted on its pinned hash alone: nothing runs before that check.
if (existsSync(DEST_BIN)) {
  const actual = await sha256Of(DEST_BIN)
  if (actual === EXE_SHA256) {
    console.log(`[ffmpeg-dl] Already present, SHA-256 matches the pinned value: ${DEST_BIN} (ffmpeg ${TARGET_VERSION})`)
    process.exit(0)
  }
  console.log(`[ffmpeg-dl] Existing ffmpeg.exe has SHA-256 ${actual}, not the pinned one: re-downloading`)
}

mkdirSync(DEST_DIR, { recursive: true })

const tmpDir = join(tmpdir(), `nexusmind-ffmpeg-${Date.now()}`)
mkdirSync(tmpDir, { recursive: true })
const zipPath = join(tmpDir, 'ffmpeg.zip')
const cleanUp = () => { try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* best effort */ } }

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

if (process.env.NXM_FFMPEG_ZIP) {
  console.log(`[ffmpeg-dl] Using local zip ${process.env.NXM_FFMPEG_ZIP}`)
  copyFileSync(process.env.NXM_FFMPEG_ZIP, zipPath)
} else {
  console.log(`[ffmpeg-dl] Downloading ${DOWNLOAD_URL}`)
  try {
    await download(DOWNLOAD_URL, zipPath)
  } catch (err) {
    // Offline or GitHub down: `npm install` must not fail for that. Nothing was installed, and
    // scripts/release.ps1 refuses to build without the pinned binary, so no build can ship without it.
    console.warn(`[ffmpeg-dl] WARNING: download failed (${err?.message ?? err}). ffmpeg was not installed: run "node scripts/download-ffmpeg.mjs" once online. Recording and releases need it.`)
    cleanUp()
    process.exit(0)
  }
}

const { size } = statSync(zipPath)
console.log(`[ffmpeg-dl] Downloaded ${Math.round(size / 1024 / 1024)} MB → ${zipPath}`)

// Before anything is extracted or run.
const zipSha = await sha256Of(zipPath)
if (zipSha !== ZIP_SHA256) {
  console.error(`[ffmpeg-dl] REFUSED: SHA-256 of the zip is ${zipSha}, expected ${ZIP_SHA256}.`)
  console.error('[ffmpeg-dl] Nothing was extracted or run. The release file changed, or the download was tampered with.')
  cleanUp()
  process.exit(1)
}
console.log('[ffmpeg-dl] SHA-256 of the zip matches the pinned value')

console.log('[ffmpeg-dl] Extracting with PowerShell Expand-Archive')
const extracted = spawnSync(
  'powershell.exe',
  ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(tmpDir)} -Force`],
  { stdio: 'inherit' },
)
if (extracted.status !== 0) {
  console.error('[ffmpeg-dl] Extraction failed')
  cleanUp()
  process.exit(1)
}

const rootEntries = readdirSync(tmpDir).filter((e) => e.startsWith('ffmpeg-') && statSync(join(tmpDir, e)).isDirectory())
if (rootEntries.length === 0) {
  console.error('[ffmpeg-dl] Could not find extracted ffmpeg-* folder')
  cleanUp()
  process.exit(1)
}
const sourceBin = join(tmpDir, rootEntries[0], 'bin', 'ffmpeg.exe')
if (!existsSync(sourceBin)) {
  console.error(`[ffmpeg-dl] ffmpeg.exe not found at expected path: ${sourceBin}`)
  cleanUp()
  process.exit(1)
}

// The extracted binary must be the pinned one too, before it is installed or run.
const exeSha = await sha256Of(sourceBin)
if (exeSha !== EXE_SHA256) {
  console.error(`[ffmpeg-dl] REFUSED: SHA-256 of the extracted ffmpeg.exe is ${exeSha}, expected ${EXE_SHA256}.`)
  console.error('[ffmpeg-dl] The zip matched but its binary did not: nothing was installed or run. Check the pinned values.')
  cleanUp()
  process.exit(1)
}

// Use copy + remove instead of rename: tmpdir and project may be on different
// drives on Windows (EXDEV: cross-device link not permitted).
copyFileSync(sourceBin, DEST_BIN)
cleanUp()
console.log(`[ffmpeg-dl] Installed → ${DEST_BIN} (SHA-256 ${exeSha}, pinned)`)

// The binary now comes from the verified zip: running it is the last check.
const verify = spawnSync(DEST_BIN, ['-version'], { encoding: 'utf-8' })
const verifyOutput = (verify.stdout || '') + (verify.stderr || '')
if (verifyOutput.includes(`ffmpeg version ${TARGET_VERSION}`)) {
  console.log(`[ffmpeg-dl] OK — ffmpeg ${TARGET_VERSION} ready`)
} else {
  console.error('[ffmpeg-dl] Version mismatch after install:')
  console.error(verifyOutput.split('\n')[0])
  process.exit(1)
}
