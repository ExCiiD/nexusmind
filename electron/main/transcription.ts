import { spawn } from 'child_process'
import { existsSync, readFileSync, unlinkSync } from 'fs'
import { app } from 'electron'
import { join } from 'path'
import { getFfmpegBinaryPath } from './recorder'

/**
 * Local Whisper transcription (Phase 5, Planning rework §9 — team session
 * reviews/meetings). Runs fully on-device via @huggingface/transformers
 * (ONNX Runtime, CPU) — no per-request cloud API call, consistent with
 * this app's "no paid AI" rules-engine philosophy. The one network touch
 * is the model weights themselves (~145MB for whisper-base, multilingual),
 * downloaded once on first use and cached under userData/whisper-cache —
 * every transcription after that is fully offline. Bundling that model
 * inside the installer for every user, even the ones who never touch team
 * sessions, was judged disproportionate (see the Phase 5 note in
 * docs/PLAN_GESTION_EQUIPE.md) — a deliberate scope call, not an oversight.
 *
 * `@huggingface/transformers` is ESM-only; this file compiles into the
 * (CJS) main bundle, so the package is loaded via a runtime `import()`
 * rather than a static import, which Node's CJS loader supports natively.
 */

const MODEL_ID = 'Xenova/whisper-base'

// transformers.js ships its own types, not worth importing just for this cached handle
let pipelinePromise: Promise<any> | null = null

async function getTranscriber(): Promise<any> {
  if (!pipelinePromise) {
    pipelinePromise = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers')
      env.cacheDir = join(app.getPath('userData'), 'whisper-cache')
      return pipeline('automatic-speech-recognition', MODEL_ID)
    })()
  }
  return pipelinePromise
}

/** Extracts 16kHz mono PCM (Whisper's required input) from any video/audio
 *  file ffmpeg can read, to a temp .wav file the caller must clean up. */
function extractAudioWav(sourcePath: string): Promise<string> {
  const ffmpegBin = getFfmpegBinaryPath()
  if (!ffmpegBin || !existsSync(ffmpegBin)) return Promise.reject(new Error('ffmpeg not available'))
  const outPath = join(app.getPath('temp'), `nxm-transcribe-${Date.now()}.wav`)
  return new Promise((resolve, reject) => {
    const args = ['-i', sourcePath, '-ar', '16000', '-ac', '1', '-f', 'wav', '-y', outPath]
    const proc = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    proc.stderr?.on('data', (d: Buffer) => { if (!app.isPackaged) process.stdout.write('[transcribe] ' + d.toString()) })
    proc.on('exit', (code) => {
      if (code === 0 && existsSync(outPath)) resolve(outPath)
      else reject(new Error(`ffmpeg audio extraction failed (code ${code})`))
    })
    proc.on('error', reject)
    setTimeout(() => { try { proc.kill() } catch { /* ignore */ } }, 120_000)
  })
}

/** Decodes a 16kHz mono WAV into the Float32 PCM samples the Whisper
 *  pipeline expects. */
async function readWavSamples(wavPath: string): Promise<Float32Array> {
  const { WaveFile } = await import('wavefile')
  const wav = new WaveFile(readFileSync(wavPath))
  wav.toBitDepth('32f')
  const samples = wav.getSamples(false, Float32Array)
  return samples instanceof Float32Array ? samples : Float32Array.from(samples as unknown as number[])
}

export interface TranscriptionResult {
  text: string
}

/**
 * Transcribes any recording ffmpeg can read (video or audio) — extracts
 * 16kHz mono audio, runs it through the local Whisper pipeline, and cleans
 * up the temp WAV either way. `language` is required, not auto-detected:
 * transformers.js 4.x has no language detection implemented yet (its own
 * source says so — `modeling_whisper.js`'s `_retrieve_init_tokens` has a
 * literal `// TODO: Implement language detection` and silently defaults to
 * English otherwise), so skipping it would mis-transcribe French audio as
 * English. The caller passes the app's current UI language.
 */
export async function transcribeFile(sourcePath: string, language: string): Promise<TranscriptionResult> {
  const wavPath = await extractAudioWav(sourcePath)
  try {
    const samples = await readWavSamples(wavPath)
    const transcriber = await getTranscriber()
    const result = await transcriber(samples, { language, task: 'transcribe', chunk_length_s: 30, stride_length_s: 5 })
    const text = Array.isArray(result) ? result.map((r: { text: string }) => r.text).join(' ') : ((result as { text?: string })?.text ?? '')
    return { text: String(text).trim() }
  } finally {
    try { unlinkSync(wavPath) } catch { /* best-effort cleanup */ }
  }
}
