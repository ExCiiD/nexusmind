/**
 * The app's theme tokens (src/index.css, src/lib/theme.ts) → the `--app-*`
 * variables the previews are painted with. One table, used by the build (the
 * built-in themes) and by the browser (the custom theme, derived live by the
 * app's own `deriveCustomTokens`).
 */
const MAP = [
  ['black', 'bg'], ['dark', 'surface'], ['panel', 'panel'],
  ['border-dim', 'line'], ['border', 'line-strong'],
  ['gold', 'accent'], ['gold-bright', 'accent-hi'], ['cyan', 'second'],
  ['text', 'text'], ['text-bright', 'text-hi'],
]

export const APP_TOKEN_PREFIX = '--hextech-'

/** → [['--app-bg', '#0D0A06'], …]; a token the theme does not define is a build error. */
export function appVars(tokens) {
  return MAP.map(([from, to]) => {
    const value = tokens[APP_TOKEN_PREFIX + from]
    if (!/^#[0-9a-f]{6}$/i.test(value ?? '')) throw new Error(`theme token ${from} is not a colour: ${value}`)
    return [`--app-${to}`, value.toUpperCase()]
  })
}

export const styleOf = (vars) => vars.map(([k, v]) => `${k}:${v}`).join(';')
