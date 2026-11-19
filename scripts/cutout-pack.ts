/**
 * Builds the champion cut-out pack on this PC, unattended: every champion
 * and every skin with its own splash, cut out with the app's algorithm
 * (buildCutout in src/lib/championCutoutCore.ts), saved as WebP with a
 * manifest and a review page.
 *
 *   npm run cutout:pack                          all champions, all skins (~6 h)
 *   npm run cutout:pack -- --skins default       base skins only (~30 min)
 *   npm run cutout:pack -- --champions Jinx,Ahri
 *   npm run cutout:pack -- --out D:\cutouts      other output folder
 *   npm run cutout:pack -- --redo                recompute what is already done
 *
 * Downloads the two BiRefNet models (MIT, 1.16 GB, hash-checked) once to
 * %LOCALAPPDATA%\AscendCutout\models, and caches the splashes there too.
 * Resumable: stop it any time (Ctrl+C) and run it again, it skips what is
 * done. Chromas have no splash of their own and are left out.
 *
 * Output (default: the folder next to the repository, ../cutout-pack):
 *   <Key>_<num>.webp     the cut-out, framed for the card
 *   manifest.json        Data Dragon version, and per skin: ok / refused
 *   review.html          every result on the card's violet, refused ones in red
 */
import { createHash } from 'crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join, resolve } from 'path'
import { Readable } from 'stream'
import { pipeline } from 'stream/promises'
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'
import {
  CUTOUT_MODELS, CUTOUT_VERSION, toInputTensor, maskFromLogits, buildCutout, composeRgba, type CutoutModel,
} from '../src/lib/championCutoutCore'

// ── Options ───────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const SKINS = arg('skins') === 'default' ? 'default' : 'all'
const ONLY = arg('champions')?.split(',').map((s) => s.trim()).filter(Boolean)
const REDO = process.argv.includes('--redo')
const OUT = resolve(arg('out') ?? join(__dirname, '..', '..', 'cutout-pack'))
const HOME = join(process.env.LOCALAPPDATA ?? join(homedir(), '.cache'), 'AscendCutout')
const DDRAGON = 'https://ddragon.leagueoflegends.com'

// ── Downloads ─────────────────────────────────────────────────────────────

async function fetchRetry(url: string, tries = 4): Promise<Response> {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status === 403 || res.status === 404) return res
      throw new Error(`HTTP ${res.status}`)
    } catch (err) {
      if (i >= tries) throw err
      await new Promise((r) => setTimeout(r, 2000 * i))
    }
  }
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function ensureModel(m: CutoutModel): Promise<string> {
  const dir = join(HOME, 'models')
  mkdirSync(dir, { recursive: true })
  const target = join(dir, `${m.id}.onnx`)
  if (existsSync(target)) {
    if ((await sha256(target)) === m.sha256) return target
    rmSync(target)
  }
  console.log(`Téléchargement du modèle ${m.id} (${Math.round(m.bytes / 1e6)} Mo)…`)
  const res = await fetchRetry(m.url)
  if (!res.ok || !res.body) throw new Error(`model download failed (${res.status})`)
  const part = `${target}.part`
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(part))
  if ((await sha256(part)) !== m.sha256) {
    rmSync(part, { force: true })
    throw new Error(`model checksum mismatch: ${m.id}`)
  }
  renameSync(part, target)
  return target
}

async function splash(key: string, num: number): Promise<Buffer | null> {
  const dir = join(HOME, 'splash')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `${key}_${num}.jpg`)
  if (existsSync(file)) return readFileSync(file)
  const res = await fetchRetry(`${DDRAGON}/cdn/img/champion/splash/${key}_${num}.jpg`)
  if (!res.ok) return null
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(file, buf)
  return buf
}

// ── Pack ──────────────────────────────────────────────────────────────────

interface Skin { key: string; champion: string; num: number; name: string }
interface Entry { champion: string; name: string; status: 'ok' | 'refused' | 'missing'; w?: number; h?: number; border?: number; unsure?: number }
interface Manifest { cutoutVersion: number; ddragon: string; generatedAt: string; skins: Record<string, Entry> }

async function listSkins(version: string): Promise<Skin[]> {
  const res = await fetchRetry(`${DDRAGON}/cdn/${version}/data/en_US/championFull.json`)
  const data = (await res.json()) as { data: Record<string, { id: string; name: string; skins: Array<{ num: number; name: string; parentSkin?: number }> }> }
  const out: Skin[] = []
  for (const c of Object.values(data.data)) {
    if (ONLY && !ONLY.includes(c.id)) continue
    for (const s of c.skins) {
      if (s.parentSkin !== undefined) continue // chroma: no splash of its own
      if (SKINS === 'default' && s.num !== 0) continue
      out.push({ key: c.id, champion: c.name, num: s.num, name: s.num === 0 ? c.name : s.name })
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key) || a.num - b.num)
}

function writeReview(manifest: Manifest): void {
  const cards = Object.entries(manifest.skins).map(([id, e]) => {
    const [key, num] = id.split(/_(?=\d+$)/)
    const img = e.status === 'ok'
      ? `<img src="${id}.webp" loading="lazy">`
      : `<img class="ref" src="${DDRAGON}/cdn/img/champion/loading/${key}_${num}.jpg" loading="lazy">`
    const tag = e.status === 'ok' ? '' : `<b>${e.status === 'refused' ? 'refusé : la carte garde l\'art' : 'splash introuvable'}</b>`
    return `<figure class="${e.status}">${img}<figcaption>${e.name}${tag}</figcaption></figure>`
  })
  const ok = Object.values(manifest.skins).filter((e) => e.status === 'ok').length
  writeFileSync(join(OUT, 'review.html'), `<!doctype html><meta charset="utf-8"><title>Cut-out pack ${manifest.ddragon}</title>
<style>body{margin:0;padding:16px;background:#120b19;color:#E4C285;font:13px system-ui}h1{font-size:18px}
main{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
figure{margin:0;background:radial-gradient(130% 80% at 50% 0,#432a5e,#1f1430 48%,#0c0812);border:1px solid #E4C28555;border-radius:6px;overflow:hidden}
figure img{display:block;width:100%;aspect-ratio:.75;object-fit:contain;object-position:bottom}
figure.refused,figure.missing{border-color:#ff4d4d}img.ref{opacity:.45}
figcaption{padding:4px 6px}figcaption b{display:block;color:#ff7b7b;font-weight:600}</style>
<h1>Pack ${manifest.ddragon} — ${ok} / ${Object.keys(manifest.skins).length} découpés (version ${manifest.cutoutVersion}, ${manifest.generatedAt})</h1>
<main>${cards.join('\n')}</main>`)
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true })
  const version = ((await (await fetchRetry(`${DDRAGON}/api/versions.json`)).json()) as string[])[0]
  const skins = await listSkins(version)
  console.log(`Data Dragon ${version} : ${skins.length} splash à traiter → ${OUT}`)

  const manifestFile = join(OUT, 'manifest.json')
  const manifest: Manifest = existsSync(manifestFile) ? JSON.parse(readFileSync(manifestFile, 'utf8')) : { cutoutVersion: CUTOUT_VERSION, ddragon: version, generatedAt: '', skins: {} }
  // A pack made by an older algorithm is redone.
  const stale = manifest.cutoutVersion !== CUTOUT_VERSION
  manifest.cutoutVersion = CUTOUT_VERSION
  manifest.ddragon = version
  const todo = skins.filter((s) => REDO || stale || !manifest.skins[`${s.key}_${s.num}`])
  console.log(`${skins.length - todo.length} déjà faits, ${todo.length} à faire.`)

  const paths = []
  for (const m of CUTOUT_MODELS) paths.push(await ensureModel(m))
  const opts = { graphOptimizationLevel: 'all' as const, enableCpuMemArena: false, enableMemPattern: false }
  const sessions = []
  for (const p of paths) sessions.push(await ort.InferenceSession.create(p, opts))

  const save = (): void => {
    manifest.generatedAt = new Date().toISOString()
    writeFileSync(`${manifestFile}.part`, JSON.stringify(manifest, null, 1))
    renameSync(`${manifestFile}.part`, manifestFile)
    writeReview(manifest)
  }

  const t0 = Date.now()
  let done = 0
  let refused = 0
  for (const s of todo) {
    const id = `${s.key}_${s.num}`
    const jpg = await splash(s.key, s.num)
    if (!jpg) {
      manifest.skins[id] = { champion: s.champion, name: s.name, status: 'missing' }
    } else {
      const { data, info } = await sharp(jpg).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
      const { width: w, height: h } = info
      const bgra = new Uint8Array(data.length)
      for (let i = 0; i < data.length; i += 4) { bgra[i] = data[i + 2]; bgra[i + 1] = data[i + 1]; bgra[i + 2] = data[i]; bgra[i + 3] = 255 }
      const masks: Uint8Array[] = []
      for (const [k, m] of CUTOUT_MODELS.entries()) {
        const n = m.inputSize
        const res = await sessions[k].run({ [sessions[k].inputNames[0]]: new ort.Tensor('float32', toInputTensor(bgra, w, h, { x: 0, y: 0, w, h }, n, m.mean, m.std), [1, 3, n, n]) })
        masks.push(maskFromLogits(res[sessions[k].outputNames[0]].data as Float32Array, n, w, h))
      }
      const cut = buildCutout(bgra, w, h, masks)
      const file = join(OUT, `${id}.webp`)
      if (!cut) {
        refused++
        rmSync(file, { force: true })
        manifest.skins[id] = { champion: s.champion, name: s.name, status: 'refused' }
      } else {
        const rgba = composeRgba(bgra, w, cut.rect, cut.alpha)
        await sharp(Buffer.from(rgba), { raw: { width: cut.rect.w, height: cut.rect.h, channels: 4 } })
          .webp({ quality: 85, alphaQuality: 90, effort: 5 }).toFile(`${file}.part`)
        renameSync(`${file}.part`, file)
        manifest.skins[id] = {
          champion: s.champion, name: s.name, status: 'ok', w: cut.rect.w, h: cut.rect.h,
          border: +cut.confidence.border.toFixed(3), unsure: +cut.confidence.unsure.toFixed(3),
        }
      }
    }
    done++
    if (done % 5 === 0 || done === todo.length) save()
    const per = (Date.now() - t0) / done
    const left = Math.round(((todo.length - done) * per) / 60000)
    console.log(`[${done}/${todo.length}] ${s.name.padEnd(32)} ${manifest.skins[id].status.padEnd(8)} ~${left} min restantes`)
  }
  save()
  for (const session of sessions) await session.release()
  console.log(`\nTerminé : ${done} traités, ${refused} refusés (la carte gardera l'art). Vérifier : ${join(OUT, 'review.html')}`)
}

main().catch((err) => {
  console.error('\nÉchec :', err instanceof Error ? err.message : err)
  console.error('Relancer la même commande reprend là où ça s\'est arrêté.')
  process.exit(1)
})
