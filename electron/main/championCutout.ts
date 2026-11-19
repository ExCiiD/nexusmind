import { app, nativeImage, net } from 'electron'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { deflateSync } from 'zlib'
import {
  CUTOUT_MODELS, CUTOUT_VERSION, cutoutCacheKey, toInputTensor, maskFromLogits, buildCutout,
  composeRgba, encodePng, cutoutArtUrl, type CutoutModel,
} from '../../src/lib/championCutoutCore'

/**
 * Champion cut-outs for the player cards (Team → Roster): the champion of a
 * Data Dragon splash without its scene, so the card's own background shows
 * behind it. Runs fully on-device with two BiRefNet models (MIT) through
 * onnxruntime-node, already shipped (and asar-unpacked) for Whisper. The
 * algorithm, the same for every champion, is `buildCutout` in
 * src/lib/championCutoutCore.ts: both masks fused, a confidence check that
 * refuses a mask that kept the scene, edges snapped to the painting by a
 * guided filter, then a portrait framing on the champion's body.
 *
 * The models (224 MB + 940 MB) are not bundled: they are downloaded once,
 * on the first card that needs them, to userData/models and checked against
 * their SHA-256. Each champion is then cut out once (~10 s on CPU) and kept
 * as a PNG under userData/champion-cutouts/v<CUTOUT_VERSION>. A refused
 * cut-out leaves a `.none` marker and the card keeps its full art. Network
 * or model failures are only remembered in memory, for 10 minutes, so
 * offline users retry on a later visit.
 *
 * Memory: ONNX Runtime's arena is off (it held 12 GB for the 1024 px model;
 * without it ~0.5 GB and ~1.2 GB), and both sessions are released as soon
 * as no card is waiting.
 */

type Ort = typeof import('onnxruntime-node')
type Session = import('onnxruntime-node').InferenceSession

const RETRY_AFTER_MS = 10 * 60_000
const IDLE_RELEASE_MS = 15_000

const modelDir = (): string => join(app.getPath('userData'), 'models')
const modelPath = (m: CutoutModel): string => join(modelDir(), `${m.id}.onnx`)
const cacheDir = (): string => join(app.getPath('userData'), 'champion-cutouts', `v${CUTOUT_VERSION}`)

const modelReady = new Map<string, Promise<string>>()
const sessions = new Map<string, Promise<Session>>()
let idleTimer: NodeJS.Timeout | null = null
/** One cut-out at a time: each model already uses every core. */
let queue: Promise<unknown> = Promise.resolve()
let pending = 0
const inFlight = new Map<string, Promise<string | null>>()
const failedAt = new Map<string, number>()

async function sha256File(path: string): Promise<string> {
  const hash = createHash('sha256')
  const handle = await fs.open(path, 'r')
  try {
    for await (const chunk of handle.createReadStream()) hash.update(chunk as Buffer)
  } finally {
    await handle.close().catch(() => undefined)
  }
  return hash.digest('hex')
}

/** Downloads a model once, streaming it through SHA-256. */
async function downloadModel(m: CutoutModel): Promise<string> {
  const target = modelPath(m)
  if (existsSync(target)) return target
  await fs.mkdir(modelDir(), { recursive: true })
  const part = `${target}.part`
  const res = await net.fetch(m.url)
  if (!res.ok || !res.body) throw new Error(`model download failed (${res.status})`)
  const hash = createHash('sha256')
  const out = createWriteStream(part)
  let bytes = 0
  try {
    const reader = res.body.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      hash.update(value)
      bytes += value.length
      if (!out.write(value)) await new Promise<void>((r) => out.once('drain', () => r()))
    }
    await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
  } catch (err) {
    out.destroy()
    await fs.rm(part, { force: true })
    throw err
  }
  const digest = hash.digest('hex')
  if (bytes !== m.bytes || digest !== m.sha256) {
    await fs.rm(part, { force: true })
    throw new Error(`model checksum mismatch (${m.id})`)
  }
  await fs.rename(part, target)
  return target
}

function ensureModel(m: CutoutModel): Promise<string> {
  let ready = modelReady.get(m.id)
  if (!ready) {
    ready = (async () => {
      const target = modelPath(m)
      // A file left by an older, interrupted or tampered run is checked once per launch.
      if (existsSync(target) && (await sha256File(target)) !== m.sha256) await fs.rm(target, { force: true })
      return downloadModel(m)
    })()
    ready.catch(() => modelReady.delete(m.id))
    modelReady.set(m.id, ready)
  }
  return ready
}

let ortModule: Promise<Ort> | null = null
const loadOrt = (): Promise<Ort> => (ortModule ??= import('onnxruntime-node'))

function getSession(m: CutoutModel): Promise<Session> {
  let s = sessions.get(m.id)
  if (!s) {
    s = (async () => {
      const path = await ensureModel(m)
      const ort = await loadOrt()
      return ort.InferenceSession.create(path, { graphOptimizationLevel: 'all', enableCpuMemArena: false, enableMemPattern: false })
    })()
    s.catch(() => sessions.delete(m.id))
    sessions.set(m.id, s)
  }
  return s
}

/** Frees the models' memory shortly after the last card got its cut-out. */
function scheduleRelease(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    if (pending > 0) return
    const all = [...sessions.values()]
    sessions.clear()
    for (const s of all) void s.then((session) => session.release()).catch(() => undefined)
  }, IDLE_RELEASE_MS)
}

/** One model's mask of the whole splash, at the splash's size. */
async function modelMask(m: CutoutModel, bgra: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const [ort, session] = await Promise.all([loadOrt(), getSession(m)])
  const size = m.inputSize
  const input = new ort.Tensor('float32', toInputTensor(bgra, width, height, { x: 0, y: 0, w: width, h: height }, size, m.mean, m.std), [1, 3, size, size])
  const out = await session.run({ [session.inputNames[0]]: input })
  return maskFromLogits(out[session.outputNames[0]].data as Float32Array, size, width, height)
}

/** Cuts the champion out and writes the PNG (or the `.none` marker). */
async function produce(championKey: string, skin: number, file: string): Promise<string | null> {
  // Both downloads start at once; the art is small.
  const models = Promise.all(CUTOUT_MODELS.map(ensureModel))
  const res = await net.fetch(cutoutArtUrl(championKey, skin))
  if (!res.ok) throw new Error(`art download failed (${res.status})`)
  const image = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()))
  if (image.isEmpty()) throw new Error('art could not be decoded')
  const { width, height } = image.getSize()
  const bgra = new Uint8Array(image.toBitmap())
  await models

  const masks: Uint8Array[] = []
  for (const m of CUTOUT_MODELS) masks.push(await modelMask(m, bgra, width, height))
  const cut = buildCutout(bgra, width, height, masks)

  await fs.mkdir(cacheDir(), { recursive: true })
  if (!cut) {
    await fs.writeFile(`${file}.none`, '')
    return null
  }
  const png = encodePng(composeRgba(bgra, width, cut.rect, cut.alpha), cut.rect.w, cut.rect.h, (b) => deflateSync(b))
  await fs.writeFile(`${file}.png.part`, png)
  await fs.rename(`${file}.png.part`, `${file}.png`)
  return `${file}.png`
}

async function readCached(file: string): Promise<string | null | undefined> {
  if (existsSync(`${file}.none`)) return null
  if (existsSync(`${file}.png`)) return `${file}.png`
  return undefined
}

const toDataUrl = async (path: string | null): Promise<string | null> =>
  path ? `data:image/png;base64,${(await fs.readFile(path)).toString('base64')}` : null

/**
 * The champion cut out of its splash, as a PNG data URL, or null when there
 * is none to show (refused cut-out, offline, models unavailable): the card
 * then keeps the full art.
 */
export async function getChampionCutout(championKey: string, skin = 0): Promise<{ dataUrl: string | null }> {
  const key = cutoutCacheKey(championKey, skin)
  if (!key) return { dataUrl: null }
  const file = join(cacheDir(), key)
  const cached = await readCached(file)
  if (cached !== undefined) return { dataUrl: await toDataUrl(cached) }
  const failed = failedAt.get(key)
  if (failed && Date.now() - failed < RETRY_AFTER_MS) return { dataUrl: null }

  let job = inFlight.get(key)
  if (!job) {
    pending++
    job = queue.then(async () => {
      try {
        return await produce(championKey, skin, file)
      } finally {
        pending--
        scheduleRelease()
      }
    })
    queue = job.catch(() => undefined)
    inFlight.set(key, job)
  }
  try {
    return { dataUrl: await toDataUrl(await job) }
  } catch (err) {
    failedAt.set(key, Date.now())
    console.warn('[champion-cutout]', key, err instanceof Error ? err.message : err)
    return { dataUrl: null }
  } finally {
    inFlight.delete(key)
  }
}
