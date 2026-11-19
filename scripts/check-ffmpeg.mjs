#!/usr/bin/env node
// @ts-check
/**
 * Refuses to package an installer unless resources/ffmpeg-bin/win-x64/ffmpeg.exe is the pinned binary (#13, S19-04).
 * The expected SHA-256 is read from scripts/download-ffmpeg.mjs (EXE_SHA256), its single source. Run by
 * `npm run dist`, `npm run dist:dir` (predist hooks) and scripts/release.ps1. Exit 1 on any doubt.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bin = process.env.NXM_FFMPEG_CHECK_BIN || join(root, 'resources', 'ffmpeg-bin', 'win-x64', 'ffmpeg.exe')

const pin = readFileSync(join(root, 'scripts', 'download-ffmpeg.mjs'), 'utf-8').match(/const EXE_SHA256 = '([0-9a-f]{64})'/)
if (!pin) {
  console.error('[ffmpeg-check] EXE_SHA256 not found in scripts/download-ffmpeg.mjs. Nothing will be packaged.')
  process.exit(1)
}
if (!existsSync(bin)) {
  console.error(`[ffmpeg-check] ${bin} is missing: run "node scripts/download-ffmpeg.mjs" first. Nothing will be packaged.`)
  process.exit(1)
}
const actual = createHash('sha256').update(readFileSync(bin)).digest('hex')
if (actual !== pin[1]) {
  console.error(`[ffmpeg-check] ffmpeg.exe has SHA-256 ${actual}, not the pinned ${pin[1]}. Nothing will be packaged.`)
  process.exit(1)
}
console.log('[ffmpeg-check] ffmpeg.exe matches its pinned SHA-256.')
