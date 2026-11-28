import { app } from 'electron'
import { existsSync, readdirSync, rmdirSync, rmSync } from 'fs'
import { join } from 'path'

/**
 * Health check of 28/11/2026: files earlier versions left in userData that nothing reads any more.
 *
 * - `models/birefnet-*.onnx` (897 MB + 214 MB): the two background-removal models of the on-device champion
 *   cut-outs. The player cards show the hosted cut-outs (`ascend-cutouts`, 1,608 reviewed WebP) since 21/11, and the
 *   on-device pipeline is gone; the pack itself is built by scripts/cutout-pack.ts, which keeps its own copy of
 *   the models under %LOCALAPPDATA%\AscendCutout.
 * - `champion-cutouts/`: the PNGs that pipeline produced.
 * Anything else in `models/` is left alone, and the folder is removed only when empty.
 */
export const OBSOLETE_MODEL = /^birefnet-.+\.onnx(\.part)?$/

export function removeObsoleteFiles(userData: string = app.getPath('userData')): string[] {
  const removed: string[] = []
  const models = join(userData, 'models')
  if (existsSync(models)) {
    for (const name of readdirSync(models)) {
      if (!OBSOLETE_MODEL.test(name)) continue
      try { rmSync(join(models, name), { force: true }); removed.push(`models/${name}`) } catch { /* in use: next launch */ }
    }
    try { if (readdirSync(models).length === 0) rmdirSync(models) } catch { /* not empty */ }
  }
  const cutouts = join(userData, 'champion-cutouts')
  if (existsSync(cutouts)) {
    try { rmSync(cutouts, { recursive: true, force: true }); removed.push('champion-cutouts/') } catch { /* next launch */ }
  }
  return removed
}
