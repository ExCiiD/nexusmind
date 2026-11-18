/**
 * Local preview of the built site (site/public), with the same response
 * headers as production (site/public/_headers), so a Content-Security-Policy
 * slip shows up here and not after a deploy.
 *
 *   npm run site:preview            http://localhost:4321
 *   node site/serve.mjs 5000        another port
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public')
const port = Number(process.argv[2] ?? process.env.PORT ?? 4321)

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp',
  '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
}

/** Headers of the `/*` block of _headers (the only block that applies to every response). */
async function siteHeaders() {
  const text = await readFile(path.join(root, '_headers'), 'utf8').catch(() => '')
  const headers = {}
  let on = false
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(' ')) { on = line.trim() === '/*'; continue }
    const at = line.indexOf(':')
    if (on && at > 0) headers[line.slice(0, at).trim()] = line.slice(at + 1).trim()
  }
  delete headers['Strict-Transport-Security'] // plain http on localhost
  return headers
}

async function resolve(urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '')
  const file = path.join(root, clean)
  if (!file.startsWith(root)) return null
  const info = await stat(file).catch(() => null)
  if (info?.isFile()) return file
  if (info?.isDirectory()) {
    const index = path.join(file, 'index.html')
    if ((await stat(index).catch(() => null))?.isFile()) return index
  }
  return null
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const headers = await siteHeaders()
  const file = await resolve(url.pathname)
  const target = file ?? path.join(root, '404.html')
  try {
    const body = await readFile(target)
    res.writeHead(file ? 200 : 404, { ...headers, 'Content-Type': TYPES[path.extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Build the site first: npm run site:build')
  }
}).listen(port, () => console.log(`Ascend site preview: http://localhost:${port}`))
