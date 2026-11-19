/**
 * The release the download button points at.
 *
 * The version comes from the app's package.json, so the site follows each
 * `npm run release` without a manual edit. The installer's size and sha512
 * come from release/latest.yml when it describes that same version (it is
 * written by the release build); otherwise from PUBLISHED below, the last
 * release known to be on GitHub. If package.json is ahead of every known
 * release (version bumped, installer not built yet), the button keeps
 * pointing at PUBLISHED and the build prints a note (site/build.mjs).
 * After publishing a release from another machine, update PUBLISHED from the
 * release's latest.yml on GitHub.
 *
 * The page also asks GitHub for a newer release once loaded and, if there is
 * one, points the button at it (site/src/client/main.js). Without script, or
 * if GitHub does not answer, the link below is the one that is followed.
 */
import { existsSync, readFileSync } from 'node:fs'

const REPO = 'ExCiiD/nexusmind'
const root = new URL('../../', import.meta.url)

/** Last release published on GitHub (beta.9, from its latest.yml, 19/11/2026). */
const PUBLISHED = {
  version: '1.0.0-beta.9',
  bytes: 266933392,
  sha512: '+xe83gVkI6/yOU5Vm3AIlUJC/Mqw8xbwJQK782M3DEa26oswXrAcCKEuenXpqMctCbC9R+b4lcf0CI9YkVZCFg==',
}

const appVersion = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')).version

/** Size and sha512 from release/latest.yml, if it describes `version`. */
function builtMeta(version) {
  const file = new URL('release/latest.yml', root)
  if (!existsSync(file)) return null
  const yml = readFileSync(file, 'utf8')
  const field = (re) => (yml.match(re) ?? [])[1]?.trim()
  if (field(/^version:\s*(.+)$/m) !== version) return null
  const bytes = Number(field(/^\s*size:\s*(\d+)\s*$/m))
  const sha512 = field(/^sha512:\s*(.+)$/m)
  return bytes && sha512 ? { version, bytes, sha512 } : null
}

const meta = builtMeta(appVersion) ?? PUBLISHED

export const RELEASE = {
  repo: REPO,
  version: meta.version,
  file: `Ascend-Setup-${meta.version}.exe`,
  bytes: meta.bytes,
  sha512: meta.sha512,
}

export const releaseUrls = (r = RELEASE) => ({
  download: `https://github.com/${r.repo}/releases/download/v${r.version}/${r.file}`,
  page: `https://github.com/${r.repo}/releases/tag/v${r.version}`,
  all: `https://github.com/${r.repo}/releases`,
  api: `https://api.github.com/repos/${r.repo}/releases?per_page=5`,
})

/** The coach / team web app (web/, deployed as a Cloudflare Worker). */
export const WEB_APP_URL = 'https://app.asc3nd.app'

export const megabytes = (bytes) => Math.round(bytes / 1048576)
