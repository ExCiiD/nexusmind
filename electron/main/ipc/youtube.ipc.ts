/**
 * YouTube OAuth 2.0 + Upload IPC handlers.
 *
 * Setup required by the user:
 *  1. Go to https://console.cloud.google.com/
 *  2. Create a project, enable "YouTube Data API v3"
 *  3. Create OAuth 2.0 credentials (Desktop app type)
 *  4. Add client_id / client_secret to .env as:
 *     MAIN_VITE_GOOGLE_CLIENT_ID=...
 *     MAIN_VITE_GOOGLE_CLIENT_SECRET=...
 *
 * Installed app (21/11/2026, decision "client Desktop app + PKCE", replaces option A of 19/11): the project's only
 * OAuth client is of type Desktop. Google treats a Desktop client's secret as not confidential (it ships in every
 * installed copy); the flow's security rests on PKCE S256 and the state check. Both values are inlined at BUILD time
 * from MAIN_VITE_GOOGLE_CLIENT_ID / MAIN_VITE_GOOGLE_CLIENT_SECRET (the git-ignored .env or the environment of
 * scripts/release.ps1). Never committed, never logged. Without them, the upload is off (youtubeUploadAvailable()).
 */
import { ipcMain, shell, app, safeStorage } from 'electron'
import { createServer } from 'http'
import { AddressInfo } from 'net'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { createReadStream, statSync } from 'fs'
import { z } from 'zod'
import { validatedHandle, localPath, id } from './validate'
import { youtubeErrorCode, clipVideoText, pkcePair, uploadVerdict, YOUTUBE_SCOPE } from '../youtubeCore'
import { recordingVideoText } from '../youtubeQueueCore'
import { isInsideDirs } from '../clipCore'
import { getPrisma } from '../database'
import { recordingManager } from '../recorder'
import { isMediaPathAllowed } from '../mediaAccess'
import { stripAudioCopy } from '../recorder'
import { randomBytes } from 'crypto'

// ── Token persistence (encrypted with OS keychain via safeStorage) ────────────

function getTokenFilePath(): string {
  return join(app.getPath('userData'), '.yt_tokens')
}

interface YoutubeTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  channelName: string | null
}

function saveTokens(tokens: YoutubeTokens): void {
  // Encrypted or not at all (21/11/2026, security review): no plaintext fallback, the connection is refused instead.
  if (!safeStorage.isEncryptionAvailable()) throw new Error('ENCRYPTION_UNAVAILABLE')
  writeFileSync(getTokenFilePath(), safeStorage.encryptString(JSON.stringify(tokens)))
}

function loadTokens(): YoutubeTokens | null {
  const encPath = getTokenFilePath()
  // A plaintext file left by an older version is deleted, never read: the player connects again.
  const plainPath = encPath + '.plain'
  if (existsSync(plainPath)) try { unlinkSync(plainPath) } catch { /* ok */ }
  try {
    if (existsSync(encPath) && safeStorage.isEncryptionAvailable()) {
      const enc = readFileSync(encPath)
      const dec = safeStorage.decryptString(enc)
      return JSON.parse(dec) as YoutubeTokens
    }
  } catch { /* ignore */ }
  return null
}

function clearTokens(): void {
  const encPath = getTokenFilePath()
  const plainPath = encPath + '.plain'
  if (existsSync(encPath)) try { unlinkSync(encPath) } catch { /* ok */ }
  if (existsSync(plainPath)) try { unlinkSync(plainPath) } catch { /* ok */ }
}

/** Whether a YouTube account is connected on this PC. */
export function youtubeConnected(): boolean {
  return loadTokens() !== null
}

/** Called after a connection or a disconnection (the automatic upload queue resumes or stops on it). */
const connectionListeners = new Set<(connected: boolean) => void>()
export function onYoutubeConnectionChange(cb: (connected: boolean) => void): () => void {
  connectionListeners.add(cb)
  return () => connectionListeners.delete(cb)
}
function notifyConnection(connected: boolean): void {
  for (const cb of connectionListeners) try { cb(connected) } catch { /* a listener never breaks the flow */ }
}

/** Videos being uploaded right now, by "kind:id": a manual share never runs alongside the queue's upload of the same clip. */
const inFlight = new Set<string>()

// ── OAuth helpers ─────────────────────────────────────────────────────────────

function getClientId(): string {
  return ((import.meta.env.MAIN_VITE_GOOGLE_CLIENT_ID as string | undefined) || process.env.MAIN_VITE_GOOGLE_CLIENT_ID || '').trim()
}
function getClientSecret(): string {
  return ((import.meta.env.MAIN_VITE_GOOGLE_CLIENT_SECRET as string | undefined) || process.env.MAIN_VITE_GOOGLE_CLIENT_SECRET || '').trim()
}

/**
 * YouTube upload is on wherever the build carries the Desktop client's id and secret (21/11/2026, "client Desktop app
 * + PKCE": in the installed app too). Off without them. Links pasted by hand keep working.
 */
export function youtubeUploadAvailable(): boolean {
  return !!getClientId() && !!getClientSecret()
}

async function refreshAccessToken(tokens: YoutubeTokens): Promise<YoutubeTokens> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: getClientId(),
      client_secret: getClientSecret(),
      refresh_token: tokens.refreshToken,
      grant_type: 'refresh_token',
    }).toString(),
  })
  if (!res.ok) throw new Error(youtubeErrorCode(res.status === 400 ? 401 : res.status, await res.text().catch(() => '')) === 'YOUTUBE_ERROR' ? `Token refresh failed: ${res.status}` : 'AUTH_EXPIRED')
  const data = await res.json() as any
  const updated: YoutubeTokens = {
    ...tokens,
    accessToken: data.access_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  }
  saveTokens(updated)
  return updated
}

async function getValidAccessToken(): Promise<string> {
  let tokens = loadTokens()
  if (!tokens) throw new Error('NOT_AUTHENTICATED')

  // Refresh if within 5 minutes of expiry
  if (Date.now() > tokens.expiresAt - 5 * 60 * 1000) {
    tokens = await refreshAccessToken(tokens)
  }
  return tokens.accessToken
}

/** Revokes the grant at Google (best effort: the local tokens are deleted whatever the answer). */
async function revokeAtGoogle(tokens: YoutubeTokens | null): Promise<void> {
  const token = tokens?.refreshToken || tokens?.accessToken
  if (!token) return
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    })
  } catch { /* offline: the grant can still be removed from the Google account's permissions page */ }
}

// ── IPC Registration ──────────────────────────────────────────────────────────

export function registerYoutubeHandlers(): void {
  /**
   * Starts the OAuth 2.0 Desktop flow:
   *  1. Starts a local HTTP server on a random port to receive the callback
   *  2. Opens the Google consent URL in the user's browser
   *  3. Waits for the callback code
   *  4. Exchanges the code for tokens and persists them
   */
  ipcMain.handle('youtube:auth-start', async () => {
    if (!youtubeUploadAvailable()) throw new Error('YOUTUBE_UNAVAILABLE')
    // Tokens are only ever stored encrypted: without Windows' keychain, no connection at all.
    if (!safeStorage.isEncryptionAvailable()) throw new Error('ENCRYPTION_UNAVAILABLE')
    const clientId = getClientId()
    const clientSecret = getClientSecret()
    if (!clientId || !clientSecret) {
      throw new Error('YOUTUBE_UNAVAILABLE')
    }

    return new Promise<{ connected: boolean; channelName: string | null }>((resolve, reject) => {
      const server = createServer()

      server.listen(0, '127.0.0.1', async () => {
        const port = (server.address() as AddressInfo).port
        const redirectUri = `http://127.0.0.1:${port}/oauth2callback`

        // PKCE and state (21/11/2026): Google's flow for installed apps, where the client secret is not a secret.
        const { verifier, challenge, state } = pkcePair()
        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        authUrl.searchParams.set('client_id', clientId)
        authUrl.searchParams.set('code_challenge', challenge)
        authUrl.searchParams.set('code_challenge_method', 'S256')
        authUrl.searchParams.set('state', state)
        authUrl.searchParams.set('redirect_uri', redirectUri)
        authUrl.searchParams.set('response_type', 'code')
        // Upload only (21/11/2026, Google verification): the app never reads anything from the player's YouTube account,
        // so no channel name either (the settings show "connected"); no YouTube API data is kept but the uploaded video's URL.
        authUrl.searchParams.set('scope', YOUTUBE_SCOPE)
        authUrl.searchParams.set('access_type', 'offline')
        authUrl.searchParams.set('prompt', 'consent')

        // Open browser
        await shell.openExternal(authUrl.toString())

        // Timeout after 5 minutes
        const timeout = setTimeout(() => {
          server.close()
          reject(new Error('OAuth timeout — please try again'))
        }, 5 * 60 * 1000)

        server.on('request', async (req, res) => {
          clearTimeout(timeout)
          try {
            const url = new URL(req.url!, `http://127.0.0.1:${port}`)
            const code = url.searchParams.get('code')

            // Another page hitting the loopback port (or a forged callback) never completes the sign-in.
            if (url.searchParams.get('state') !== state) {
              res.writeHead(400)
              res.end('Invalid state')
              server.close()
              reject(new Error('OAUTH_STATE_MISMATCH'))
              return
            }

            if (!code) {
              res.writeHead(400)
              res.end('Missing authorization code')
              server.close()
              reject(new Error('Missing authorization code'))
              return
            }

            // Exchange code for tokens
            const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
                code_verifier: verifier,
              }).toString(),
            })

            if (!tokenRes.ok) {
              const txt = await tokenRes.text()
              res.writeHead(500)
              res.end('Token exchange failed')
              server.close()
              reject(new Error(`Token exchange failed: ${txt.slice(0, 200)}`))
              return
            }

            const tokenData = await tokenRes.json() as any
            const channelName = null

            const tokens: YoutubeTokens = {
              accessToken: tokenData.access_token,
              refreshToken: tokenData.refresh_token,
              expiresAt: Date.now() + (tokenData.expires_in ?? 3600) * 1000,
              channelName,
            }
            saveTokens(tokens)

            // Send success page to browser
            res.writeHead(200, { 'Content-Type': 'text/html' })
            res.end(`<html><body style="font-family:sans-serif;text-align:center;padding:40px">
              <h2 style="color:#1DB954">✓ YouTube Connected</h2>
              <p>You can close this tab and return to Ascend.</p>
            </body></html>`)

            server.close()
            resolve({ connected: true, channelName })
            notifyConnection(true)
          } catch (err) {
            res.writeHead(500)
            res.end('Internal error')
            server.close()
            reject(err)
          }
        })
      })

      server.on('error', (err) => reject(err))
    })
  })

  /** Returns current YouTube connection status. */
  ipcMain.handle('youtube:get-status', () => {
    const tokens = loadTokens()
    return {
      connected: tokens !== null,
      channelName: tokens?.channelName ?? null,
      /** False in the installed app, or without OAuth credentials: hide the upload controls. */
      available: youtubeUploadAvailable(),
    }
  })

  /** Removes stored YouTube tokens. */
  // Disconnect = revoke the grant at Google, then forget the tokens (21/11/2026, the player's revocation).
  ipcMain.handle('youtube:disconnect', async () => {
    await revokeAtGoogle(loadTokens())
    clearTokens()
    notifyConnection(false)
    return { success: true }
  })

  /**
   * Uploads a video file to YouTube using the resumable upload API.
   * Emits `youtube:upload-progress` events with { jobId, percent } during upload.
   */
  validatedHandle('youtube:upload', z.tuple([z.object({
    filePath: localPath,
    // YouTube's own limits; truncate rather than reject a long clip title.
    title: z.string().max(10_000).transform((s) => s.slice(0, 100)),
    description: z.string().max(100_000).transform((s) => s.slice(0, 5000)).optional(),
    visibility: z.enum(['public', 'unlisted', 'private']).optional(),
  })]), async (event, opts) => {
    return uploadVideo(event.sender, opts)
  })

  /**
   * 21/11/2026 « Partage des clips »: shares a clip to YouTube in one step when an account is connected. The clip's
   * file must be in the recordings folders; title = the clip's (or its times), description = the clip and its game.
   * Unlisted unless told otherwise. The URL is kept on the clip. Errors: YOUTUBE_UNAVAILABLE, NOT_AUTHENTICATED,
   * AUTH_EXPIRED, QUOTA_EXCEEDED, FILE_NOT_FOUND, FILE_NOT_ALLOWED, YOUTUBE_ERROR.
   */
  validatedHandle('youtube:upload-clip', z.tuple([id, z.object({ visibility: z.enum(['public', 'unlisted', 'private']).optional() }).strict().optional()]), async (event, clipId, opts) => {
    return uploadClipToYoutube(clipId, { visibility: opts?.visibility, sender: event.sender })
  })
}

type Visibility = 'public' | 'unlisted' | 'private'
interface UploadRun {
  visibility?: Visibility
  /** 'none' = upload a copy without any audio track (automatic upload's setting). Default: as recorded. */
  audio?: 'all' | 'none'
  sender?: Electron.WebContents | null
  signal?: AbortSignal
  onProgress?: (percent: number) => void
}

/**
 * Uploads one clip and keeps its URL on the clip (shared by the manual share and the automatic queue). A clip that
 * already has a URL is never uploaded again. Throws the codes of youtubeCore.ts, NOT_FOUND, UPLOAD_IN_PROGRESS.
 */
export async function uploadClipToYoutube(clipId: string, run: UploadRun = {}): Promise<{ videoId: string; url: string; reused: boolean }> {
    if (!youtubeUploadAvailable()) throw new Error('YOUTUBE_UNAVAILABLE')
    if (!loadTokens()) throw new Error('NOT_AUTHENTICATED')
    const key = `clip:${clipId}`
    if (inFlight.has(key)) throw new Error('UPLOAD_IN_PROGRESS')
    inFlight.add(key)
    try {
    const prisma = getPrisma()
    const rows: any[] = await prisma.$queryRawUnsafe(
      `SELECT c."id", c."filePath", c."title", c."startMs", c."endMs", c."youtubeUrl", r."gameId" FROM "Clip" c LEFT JOIN "Recording" r ON r."id" = c."recordingId" WHERE c."id" = ?`,
      clipId,
    )
    const clip = rows[0]
    if (!clip) throw new Error('NOT_FOUND')
    // Already on YouTube: the same link, no second upload (each upload costs 1600 of the 10000 daily quota units).
    if (clip.youtubeUrl) return { videoId: String(clip.youtubeUrl).split('v=')[1] ?? '', url: clip.youtubeUrl, reused: true }
    const user = await prisma.user.findFirst({ where: { isActive: true } })
    const allowed = [recordingManager.getRecordingsDir(user?.recordingPath), user?.externalRecordingPath]
    if (!clip.filePath || !existsSync(clip.filePath)) throw new Error('FILE_NOT_FOUND')
    if (!isInsideDirs(clip.filePath, allowed)) throw new Error('FILE_NOT_ALLOWED')
    const game = clip.gameId ? await prisma.game.findUnique({ where: { id: clip.gameId }, select: { champion: true, opponentChampion: true, win: true, gameEndAt: true } }) : null
    const text = clipVideoText({ title: clip.title, startMs: Number(clip.startMs), endMs: Number(clip.endMs) }, game)
    const result = await uploadVideo(run.sender ?? null, { filePath: clip.filePath, title: text.title, description: text.description, visibility: run.visibility }, run)
    await prisma.$executeRawUnsafe(`UPDATE "Clip" SET "youtubeUrl" = ? WHERE "id" = ?`, result.url, clipId)
    return { ...result, reused: false }
    } finally {
      inFlight.delete(key)
    }
}

/**
 * Uploads a game's whole recording (automatic upload, 21/11/2026) and keeps its URL on the recording. A recording
 * that already has a URL is never uploaded again. Same errors as uploadClipToYoutube.
 */
export async function uploadRecordingToYoutube(recordingId: string, run: UploadRun = {}): Promise<{ videoId: string; url: string; reused: boolean }> {
  if (!youtubeUploadAvailable()) throw new Error('YOUTUBE_UNAVAILABLE')
  if (!loadTokens()) throw new Error('NOT_AUTHENTICATED')
  const key = `recording:${recordingId}`
  if (inFlight.has(key)) throw new Error('UPLOAD_IN_PROGRESS')
  inFlight.add(key)
  try {
    const prisma = getPrisma()
    const rec = await prisma.recording.findUnique({ where: { id: recordingId }, select: { filePath: true, youtubeUrl: true, gameId: true } })
    if (!rec) throw new Error('NOT_FOUND')
    if (rec.youtubeUrl) return { videoId: rec.youtubeUrl.split('v=')[1] ?? '', url: rec.youtubeUrl, reused: true }
    if (!rec.filePath || !existsSync(rec.filePath)) throw new Error('FILE_NOT_FOUND')
    const game = rec.gameId ? await prisma.game.findUnique({ where: { id: rec.gameId }, select: { champion: true, opponentChampion: true, win: true, gameEndAt: true } }) : null
    const text = recordingVideoText(game)
    const result = await uploadVideo(run.sender ?? null, { filePath: rec.filePath, title: text.title, description: text.description, visibility: run.visibility }, run)
    await prisma.recording.update({ where: { id: recordingId }, data: { youtubeUrl: result.url } })
    return { ...result, reused: false }
  } finally {
    inFlight.delete(key)
  }
}

/** The resumable upload (shared by youtube:upload and youtube:upload-clip). Throws the codes of youtubeCore.ts. */
/**
 * Uploads a copy of the (already checked) file without any audio track: made in the system's temp folder (never in the
 * recordings folders, so the library never sees it), deleted after the upload whatever happens.
 */
async function uploadWithoutAudio(sender: Electron.WebContents | null, opts: { filePath: string; title: string; description?: string; visibility?: Visibility }, run: UploadRun): Promise<{ videoId: string; url: string }> {
  const tmp = join(app.getPath('temp'), `ascend-yt-${randomBytes(8).toString('hex')}.mp4`)
  try {
    await stripAudioCopy(opts.filePath, tmp)
    if (run.signal?.aborted) throw new Error('UPLOAD_CANCELLED')
    return await uploadVideo(sender, { ...opts, filePath: tmp }, { ...run, audio: 'all' }, true)
  } finally {
    if (existsSync(tmp)) try { unlinkSync(tmp) } catch { /* the system cleans its temp folder */ }
  }
}

async function uploadVideo(sender: Electron.WebContents | null, opts: { filePath: string; title: string; description?: string; visibility?: Visibility }, run: UploadRun = {}, preparedCopy = false): Promise<{ videoId: string; url: string }> {
    const progress = (percent: number) => {
      if (sender && !sender.isDestroyed()) sender.send('youtube:upload-progress', { jobId, percent })
      run.onProgress?.(percent)
    }
    if (!youtubeUploadAvailable()) throw new Error('YOUTUBE_UNAVAILABLE')
    if (!existsSync(opts.filePath)) throw new Error('FILE_NOT_FOUND')
    // Only recordings/clips known to the app may leave the machine.
    if (!preparedCopy && !(await isMediaPathAllowed(opts.filePath))) throw new Error('FILE_NOT_ALLOWED')
    if (run.audio === 'none') return uploadWithoutAudio(sender, opts, run)

    const accessToken = await getValidAccessToken()
    const jobId = `yt_${Date.now()}`
    const fileSize = statSync(opts.filePath).size
    const visibility = opts.visibility ?? 'unlisted'

    // Step 1: Initiate resumable upload session
    const initRes = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        signal: run.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': String(fileSize),
        },
        body: JSON.stringify({
          snippet: {
            title: opts.title.slice(0, 100),
            description: (opts.description ?? 'Uploaded by Ascend').slice(0, 5000),
          },
          status: {
            privacyStatus: visibility,
            selfDeclaredMadeForKids: false,
          },
        }),
      },
    )

    if (!initRes.ok) {
      const txt = await initRes.text()
      const code = youtubeErrorCode(initRes.status, txt)
      throw new Error(code === 'YOUTUBE_ERROR' ? `YouTube upload init failed ${initRes.status}: ${txt.slice(0, 300)}` : code)
    }

    const uploadUrl = initRes.headers.get('location')
    if (!uploadUrl) throw new Error('No upload URL returned by YouTube API')

    // Step 2: Stream-upload in chunks (5 MB each) to track progress
    const CHUNK_SIZE = 5 * 1024 * 1024 // 5 MB
    const fileStream = createReadStream(opts.filePath, { highWaterMark: CHUNK_SIZE })
    let uploadedBytes = 0

    for await (const chunk of fileStream) {
      const start = uploadedBytes
      const end = start + chunk.length - 1

      // Turned off mid-upload: stop here. An unfinished resumable upload is never published by YouTube.
      if (run.signal?.aborted) throw new Error('UPLOAD_CANCELLED')
      const chunkRes = await fetch(uploadUrl, {
        method: 'PUT',
        signal: run.signal,
        headers: {
          'Content-Length': String(chunk.length),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        },
        body: chunk,
      })

      uploadedBytes += chunk.length
      const percent = Math.round((uploadedBytes / fileSize) * 100)

      // Emit progress (308 = Resume Incomplete, 200/201 = done)
      if (chunkRes.status === 308 || chunkRes.ok) progress(percent)

      if (!chunkRes.ok && chunkRes.status !== 308) {
        const txt = await chunkRes.text()
        const code = youtubeErrorCode(chunkRes.status, txt)
        throw new Error(code === 'YOUTUBE_ERROR' ? `YouTube upload chunk failed ${chunkRes.status}: ${txt.slice(0, 300)}` : code)
      }

      if (chunkRes.ok) {
        const data = await chunkRes.json() as any
        // Refused at once (too long for an unverified channel, duplicate…): no link is kept, the caller gets the code.
        const verdict = uploadVerdict(data)
        if (verdict) throw new Error(verdict)
        const videoId: string = data.id
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
        progress(100)
        return { videoId, url: videoUrl }
      }
    }

    throw new Error('Upload stream ended without completion')
}

