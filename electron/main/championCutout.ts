import { app, nativeImage, net } from 'electron'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, promises as fs } from 'fs'
import { join } from 'path'
import { deflateSync } from 'zlib'
import {
  CUTOUT_MODEL, CUTOUT_VERSION, cutoutCacheKey, artCrop, toInputTensor, maskFromLogits, refineMask, isUsableMask,
  composeRgba, encodePng, cutoutArtUrl,
} from '../../src/lib/championCutoutCore'


/**
 * Champion cut-outs for the player cards (Team → Roster): the champion of a
 * Data Dragon loading art without its scene, so the card's own background
 * shows behind it. Runs fully on-device with BiRefNet-lite (MIT) through
 * onnxruntime-node, already shipped (and asar-unpacked) for Whisper.
 *
 * The 224 MB model is not bundled: it is downloaded once, on the first card
 * that needs it, to userData/models and checked against its SHA-256. Each
 * champion is then cut out once (~5 s on CPU) and kept as a PNG under
 * userData/champion-cutouts/v<CUTOUT_VERSION>. A cut-out the model got
 * wrong (too little kept, e.g. Thresh's art is mostly effects) leaves a
 * `.none` marker and the card keeps its full art. Network or model failures
 * are only remembered in memory, for 10 minutes, so offline users retry on
 * a later visit. Pure logic: src/lib/championCutoutCore.ts.
 */

type Ort = typeof import('onnxruntime-node')
type Session = import('onnxruntime-node').InferenceSession

const RETRY_AFTER_MS = 10 * 60_000
const IDLE_RELEASE_MS = 60_000

const modelDir = (): string => join(app.getPath('userData'), 'models')
const modelPath = (): string => join(modelDir(), `${CUTOUT_MODEL.id}.onnx`)
const cacheDir = (): string => join(app.getPath('userData'), 'champion-cutouts', `v${CUTOUT_VERSION}`)

let modelReady: Promise<string> | null = null
let sessionPromise: Promise<{ ort: Ort; session: Session }> | null = null
let idleTimer: NodeJS.Timeout | null = null
/** One cut-out at a time: the model already uses every core. */
let queue: Promise<unknown> = Promise.resolve()
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

/** Downloads the model once, streaming it through SHA-256. */
async function downloadModel(): Promise<string> {
  const target = modelPath()
  if (existsSync(target)) return target
  await fs.mkdir(modelDir(), { recursive: true })
  const part = `${target}.part`
  const res = await net.fetch(CUTOUT_MODEL.url)
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
  if (bytes !== CUTOUT_MODEL.bytes || digest !== CUTOUT_MODEL.sha256) {
    await fs.rm(part, { force: true })
    throw new Error('model checksum mismatch')
  }
  await fs.rename(part, target)
  return target
}

function ensureModel(): Promise<string> {
  if (!modelReady) {
    modelReady = (async () => {
      const target = modelPath()
      // A file left by an older, interrupted or tampered run is checked once per launch.
      if (existsSync(target) && (await sha256File(target)) !== CUTOUT_MODEL.sha256) await fs.rm(target, { force: true })
      return downloadModel()
    })()
    modelReady.catch(() => { modelReady = null })
  }
  return modelReady
}

function getSession(): Promise<{ ort: Ort; session: Session }> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const path = await ensureModel()
      const ort = await import('onnxruntime-node')
      const session = await ort.InferenceSession.create(path, { graphOptimizationLevel: 'all' })
      return { ort, session }
    })()
    sessionPromise.catch(() => { sessionPromise = null })
  }
  return sessionPromise
}

/** Frees the model's ~400 MB of memory once the cards stop asking. */
function scheduleRelease(): void {
  if (idleTimer) clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    idleTimer = null
    const p = sessionPromise
    sessionPromise = null
    void p?.then(({ session }) => session.release()).catch(() => undefined)
  }, IDLE_RELEASE_MS)
}

/** Cuts the champion out and writes the PNG (or the `.none` marker). */
async function produce(championKey: string, skin: number, file: string): Promise<string | null> {
  const res = await net.fetch(cutoutArtUrl(championKey, skin))
  if (!res.ok) throw new Error(`art download failed (${res.status})`)
  const image = nativeImage.createFromBuffer(Buffer.from(await res.arrayBuffer()))
  if (image.isEmpty()) throw new Error('art could not be decoded')
  const { width, height } = image.getSize()
  const bgra = new Uint8Array(image.toBitmap())
  const rect = artCrop(width, height)
  const size = CUTOUT_MODEL.inputSize

  const { ort, session } = await getSession()
  const input = new ort.Tensor('float32', toInputTensor(bgra, width, height, rect), [1, 3, size, size])
  const out = await session.run({ [session.inputNames[0]]: input })
  const logits = out[session.outputNames[0]].data as Float32Array
  const alpha = refineMask(maskFromLogits(logits, size, rect.w, rect.h), rect.w, rect.h)

  await fs.mkdir(cacheDir(), { recursive: true })
  if (!isUsableMask(alpha)) {
    await fs.writeFile(`${file}.none`, '')
    return null
  }
  const png = encodePng(composeRgba(bgra, width, rect, alpha), rect.w, rect.h, (b) => deflateSync(b))
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
 * The champion cut out of its loading art, as a PNG data URL, or null when
 * there is none to show (unusable mask, offline, model unavailable): the
 * card then keeps the full art.
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
    job = queue.then(async () => {
      try {
        return await produce(championKey, skin, file)
      } finally {
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
