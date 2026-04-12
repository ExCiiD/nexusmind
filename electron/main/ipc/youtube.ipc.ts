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
 */
import { ipcMain, shell, app, safeStorage } from 'electron'
import { createServer } from 'http'
import { AddressInfo } from 'net'
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs'
import { join } from 'path'
import { createReadStream, statSync } from 'fs'

// ── Token persistence (encrypted with OS keychain via safeStorage) ────────────

function getTokenFilePath(): string {
  return join(app.getPath('userData'), '.yt_tokens')
}

interface YoutubeTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  channelName: string
}

function saveTokens(tokens: YoutubeTokens): void {
  const json = JSON.stringify(tokens)
  if (safeStorage.isEncryptionAvailable()) {
    const enc = safeStorage.encryptString(json)
    writeFileSync(getTokenFilePath(), enc)
  } else {
    // Fallback: store in plaintext if OS keychain is unavailable (rare)
    writeFileSync(getTokenFilePath() + '.plain', json, 'utf-8')
  }
}

function loadTokens(): YoutubeTokens | null {
  const encPath = getTokenFilePath()
  const plainPath = encPath + '.plain'
  try {
    if (existsSync(encPath)) {
      const enc = readFileSync(encPath)
      const dec = safeStorage.decryptString(enc)
      return JSON.parse(dec) as YoutubeTokens
    }
    if (existsSync(plainPath)) {
      return JSON.parse(readFileSync(plainPath, 'utf-8')) as YoutubeTokens
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

// ── OAuth helpers ─────────────────────────────────────────────────────────────

function getClientId(): string {
  return process.env.MAIN_VITE_GOOGLE_CLIENT_ID ?? ''
}
function getClientSecret(): string {
  return process.env.MAIN_VITE_GOOGLE_CLIENT_SECRET ?? ''
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
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)
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

async function fetchChannelName(accessToken: string): Promise<string> {
  try {
    const res = await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return 'Unknown Channel'
    const data = await res.json() as any
    return data.items?.[0]?.snippet?.title ?? 'Unknown Channel'
  } catch {
    return 'Unknown Channel'
  }
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
    const clientId = getClientId()
    const clientSecret = getClientSecret()
    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth credentials not configured. Set MAIN_VITE_GOOGLE_CLIENT_ID and MAIN_VITE_GOOGLE_CLIENT_SECRET in .env')
    }

    return new Promise<{ connected: boolean; channelName: string }>((resolve, reject) => {
      const server = createServer()

      server.listen(0, '127.0.0.1', async () => {
        const port = (server.address() as AddressInfo).port
        const redirectUri = `http://127.0.0.1:${port}/oauth2callback`

        const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
        authUrl.searchParams.set('client_id', clientId)
        authUrl.searchParams.set('redirect_uri', redirectUri)
        authUrl.searchParams.set('response_type', 'code')
        authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly')
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
            const channelName = await fetchChannelName(tokenData.access_token)

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
              <p>You can close this tab and return to NexusMind.</p>
            </body></html>`)

            server.close()
            resolve({ connected: true, channelName })
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
    }
  })

  /** Removes stored YouTube tokens. */
  ipcMain.handle('youtube:disconnect', () => {
    clearTokens()
    return { success: true }
  })

  /**
   * Uploads a video file to YouTube using the resumable upload API.
   * Emits `youtube:upload-progress` events with { jobId, percent } during upload.
   */
  ipcMain.handle('youtube:upload', async (event, opts: {
    filePath: string
    title: string
    description?: string
    visibility?: 'public' | 'unlisted' | 'private'
  }) => {
    if (!existsSync(opts.filePath)) throw new Error('FILE_NOT_FOUND')

    const accessToken = await getValidAccessToken()
    const jobId = `yt_${Date.now()}`
    const fileSize = statSync(opts.filePath).size
    const visibility = opts.visibility ?? 'unlisted'

    // Step 1: Initiate resumable upload session
    const initRes = await fetch(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Type': 'video/mp4',
          'X-Upload-Content-Length': String(fileSize),
        },
        body: JSON.stringify({
          snippet: {
            title: opts.title.slice(0, 100),
            description: (opts.description ?? 'Uploaded by NexusMind').slice(0, 5000),
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
      throw new Error(`YouTube upload init failed ${initRes.status}: ${txt.slice(0, 300)}`)
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

      const chunkRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Length': String(chunk.length),
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        },
        body: chunk,
      })

      uploadedBytes += chunk.length
      const percent = Math.round((uploadedBytes / fileSize) * 100)

      // Emit progress (308 = Resume Incomplete, 200/201 = done)
      if (chunkRes.status === 308 || chunkRes.ok) {
        event.sender.send('youtube:upload-progress', { jobId, percent })
      }

      if (!chunkRes.ok && chunkRes.status !== 308) {
        const txt = await chunkRes.text()
        throw new Error(`YouTube upload chunk failed ${chunkRes.status}: ${txt.slice(0, 300)}`)
      }

      if (chunkRes.ok) {
        const data = await chunkRes.json() as any
        const videoId: string = data.id
        const videoUrl = `https://www.youtube.com/watch?v=${videoId}`
        event.sender.send('youtube:upload-progress', { jobId, percent: 100 })
        return { videoId, url: videoUrl }
      }
    }

    throw new Error('Upload stream ended without completion')
  })
}
