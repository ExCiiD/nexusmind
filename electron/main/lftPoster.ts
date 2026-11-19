import { BrowserWindow, type NativeImage } from 'electron'
import { lftPosterDocument } from '../../src/lib/lftCore'

/**
 * Renders a looking-for-team announcement into a picture of its exact size,
 * whatever the size of the app window: the announcement's markup and the
 * app's stylesheet are loaded in a hidden off-screen window of that size,
 * then captured. JavaScript is off in that window; it can't navigate or
 * open anything, and its page allows pictures only from the app and the
 * Riot art hosts (lftPosterDocument).
 */
export interface PosterRender {
  markup: string
  css: string
  width: number
  height: number
  /** Where the app's own files are served from (its fonts, its logo): the
   *  page is loaded as if it lived there. */
  baseUrl: string
}

const LOAD_TIMEOUT_MS = 20_000
/** After the load: the web fonts and the last frame. */
const SETTLE_MS = 300

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${what} timed out`)), ms)
    p.then((v) => { clearTimeout(timer); resolve(v) }, (e) => { clearTimeout(timer); reject(e) })
  })
}

/** The `self` source of the page's policy for the app's base URL. */
export function selfSource(baseUrl: string): string {
  const u = new URL(baseUrl)
  return u.protocol === 'file:' ? 'file:' : u.origin
}

export async function renderPoster(req: PosterRender): Promise<NativeImage> {
  const { width, height } = req
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      offscreen: true,
      javascript: false,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
      backgroundThrottling: false,
    },
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  try {
    const html = lftPosterDocument({ markup: req.markup, css: req.css, width, height, self: selfSource(req.baseUrl) })
    const url = `data:text/html;charset=utf-8;base64,${Buffer.from(html, 'utf-8').toString('base64')}`
    // Resolves once the page and its pictures are loaded (or failed).
    await withTimeout(win.loadURL(url, { baseURLForDataURL: req.baseUrl }), LOAD_TIMEOUT_MS, 'Rendering the announcement')
    await delay(SETTLE_MS)
    let image = await win.webContents.capturePage()
    if (image.isEmpty()) {
      await delay(SETTLE_MS * 2)
      image = await win.webContents.capturePage()
    }
    if (image.isEmpty()) throw new Error('The announcement could not be rendered')
    const size = image.getSize()
    // A display scale other than 100 % gives a bigger capture: back to the
    // format's size, sharp.
    if (size.width !== width || size.height !== height) image = image.resize({ width, height, quality: 'best' })
    return image
  } finally {
    win.destroy()
  }
}
