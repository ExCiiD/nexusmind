/**
 * The release the download button points at. After each `npm run release`,
 * copy the version, file name, size and sha512 from release/latest.yml, then
 * rebuild the site (`npm run site:build`). When release/latest.yml is present
 * the build cross-checks these values against it.
 *
 * The page also asks GitHub for a newer release once loaded and, if there is
 * one, points the button at it (site/src/client/main.js). Without script, or
 * if GitHub does not answer, the link below is the one that is followed.
 */
export const RELEASE = {
  repo: 'ExCiiD/nexusmind',
  version: '1.0.0-beta.2',
  file: 'Ascend-Setup-1.0.0-beta.2.exe',
  bytes: 346182736,
  sha512: 'Li09CEJ+ih/IZVZUg111QpG1+IGTMlIzhdzxzKxuaR9Y6q+edITGmtsgEQf5g8MTTU+dxmtLk0PSS2D8BD0p0g==',
}

export const releaseUrls = (r = RELEASE) => ({
  download: `https://github.com/${r.repo}/releases/download/v${r.version}/${r.file}`,
  page: `https://github.com/${r.repo}/releases/tag/v${r.version}`,
  all: `https://github.com/${r.repo}/releases`,
  api: `https://api.github.com/repos/${r.repo}/releases?per_page=5`,
})

/** The coach / team web app (web/, deployed as a Cloudflare Worker). */
export const WEB_APP_URL = 'https://nexusmind-web.nexusmind-riot-proxy.workers.dev'

export const megabytes = (bytes) => Math.round(bytes / 1048576)
