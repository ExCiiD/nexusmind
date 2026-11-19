/**
 * Sends the announcement shown in the preview to the main process, which
 * renders it off screen at its exact size (electron/main/lftPoster.ts) and
 * saves or copies the PNG. What goes: the announcement's markup, with every
 * picture's absolute address, and the app's stylesheet with absolute url()s
 * (its fonts), so the off-screen page draws exactly what the preview shows.
 */
import { LFT_FORMATS, lftFileName, type LftFormat } from '@/lib/lftCore'

const ABSOLUTE = /^(?:data|https?|blob|file):/i

/** url(...) in a stylesheet made absolute against the sheet's address. */
export function absoluteCssUrls(css: string, base: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g, (match, _q: string, url: string) => {
    if (ABSOLUTE.test(url) || url.startsWith('#')) return match
    try {
      return `url("${new URL(url, base).href}")`
    } catch {
      return match
    }
  })
}

/** The app's stylesheets as one text (sheets it can't read are skipped). */
export function appStylesheet(doc: Document = document): string {
  const out: string[] = []
  for (const sheet of Array.from(doc.styleSheets)) {
    let rules: CSSRuleList
    try {
      rules = sheet.cssRules
    } catch {
      continue // another origin's sheet
    }
    const base = sheet.href ?? doc.baseURI
    for (const rule of Array.from(rules)) out.push(absoluteCssUrls(rule.cssText, base))
  }
  return out.join('\n')
}

/** The announcement's markup, pictures with absolute addresses. */
export function posterMarkup(node: HTMLElement): string {
  const clone = node.cloneNode(true) as HTMLElement
  const live = node.querySelectorAll('img')
  clone.querySelectorAll('img').forEach((img, i) => {
    const src = live[i]?.currentSrc || live[i]?.src
    if (src) img.setAttribute('src', src)
    img.removeAttribute('srcset')
    img.removeAttribute('loading')
  })
  return clone.outerHTML
}

export async function exportPoster(node: HTMLElement, opts: { format: LftFormat; names: string[]; action: 'save' | 'copy' }) {
  if (!window.api.lftExportPng) throw new Error('Export is only available in the desktop app')
  const { width, height } = LFT_FORMATS[opts.format]
  return window.api.lftExportPng({
    markup: posterMarkup(node),
    css: appStylesheet(),
    width,
    height,
    fileName: lftFileName(opts.names, opts.format),
    action: opts.action,
  })
}
