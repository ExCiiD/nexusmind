/**
 * Photographs the link-preview cards with the repo's own Electron:
 *
 *   npm run site:build     writes site/.cache/og-fr.html and og-en.html
 *   npm run site:og        writes site/public/assets/og-fr.png and og-en.png
 *   npm run site:build     again, so the pages reference the new images
 *
 * Only needed when the headline, the palette or the demonstration radar
 * change. No window is shown.
 */
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const cache = path.join(__dirname, '.cache')
const out = path.join(__dirname, 'public', 'assets')

async function shoot(lang) {
  const source = path.join(cache, `og-${lang}.html`)
  if (!fs.existsSync(source)) throw new Error(`missing ${source}: run "npm run site:build" first`)
  const win = new BrowserWindow({ width: 1200, height: 630, show: false, useContentSize: true, frame: false, webPreferences: { offscreen: true, zoomFactor: 1 } })
  try {
    await win.loadFile(source)
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))')
    const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1200, height: 630 })
    const png = image.resize({ width: 1200, height: 630, quality: 'best' }).toPNG()
    fs.writeFileSync(path.join(out, `og-${lang}.png`), png)
    console.log(`og-${lang}.png  ${(png.length / 1024).toFixed(1)} kB`)
  } finally {
    win.destroy()
  }
}

app.disableHardwareAcceleration()
// Closing the first window must not end the run before the second card.
app.on('window-all-closed', () => {})
app.whenReady().then(async () => {
  let code = 0
  for (const lang of ['fr', 'en']) {
    try { await shoot(lang) } catch (error) { console.error(String(error)); code = 1 }
  }
  app.exit(code)
})
