/**
 * Local preview of the built site (site/public), with the same response
 * headers (site/public/_headers) and the same page addresses as Cloudflare,
 * so a Content-Security-Policy slip or a link that would go through a
 * redirect shows up here and not after a deploy.
 *
 *   npm run site:preview            http://localhost:4321
 *   node site/serve.mjs 5000        another port
 *
 * Cloudflare's own emulator gives the exact production behaviour when in
 * doubt: `npx wrangler dev` inside site/.
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

const isFile = async (file) => (await stat(file).catch(() => null))?.isFile() ?? false

/**
 * Page addresses, as Cloudflare's static assets serve them by default:
 * /conditions answers with conditions.html, a folder with its index.html, and
 * the addresses that name the file (/conditions.html, /en/index.html) or miss
 * the folder's trailing slash (/en) redirect to the short one.
 * Returns { file }, { redirect } or {} for a miss.
 */
async function route(urlPath) {
  const clean = path.normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '')
  const file = path.join(root, clean)
  if (!file.startsWith(root) || clean === '_headers') return {}
  if (urlPath.endsWith('/')) return (await isFile(path.join(file, 'index.html'))) ? { file: path.join(file, 'index.html') } : {}
  if (await isFile(file)) {
    if (urlPath.endsWith('/index.html')) return { redirect: urlPath.slice(0, -'index.html'.length) }
    if (urlPath.endsWith('.html')) return { redirect: urlPath.slice(0, -'.html'.length) }
    return { file }
  }
  if (await isFile(`${file}.html`)) return { file: `${file}.html` }
  if (await isFile(path.join(file, 'index.html'))) return { redirect: `${urlPath}/` }
  return {}
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost')
    const headers = await siteHeaders()
    const { file, redirect } = await route(url.pathname).catch(() => ({}))
    if (redirect) {
      res.writeHead(307, { ...headers, Location: redirect + url.search })
      res.end()
      return
    }
    const target = file ?? path.join(root, '404.html')
    const body = await readFile(target)
    res.writeHead(file ? 200 : 404, { ...headers, 'Content-Type': TYPES[path.extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
    res.end(req.method === 'HEAD' ? undefined : body)
  } catch {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
    res.end('Build the site first: npm run site:build')
  }
}).listen(port, () => console.log(`Ascend site preview: http://localhost:${port}`))
