/**
 * Small helpers shared by the build (server-side rendering of every page)
 * and by the browser script (re-rendering an exhibit after an interaction).
 * No Node API, no DOM API: plain strings in, plain strings out.
 */

const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }
export const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ENTITIES[c])

const NNBSP = ' '

/**
 * Typography applied to every text the site prints: curly apostrophes, and in
 * French a narrow no-break space before : ; ? ! and inside « ».
 */
export function typo(text, lang) {
  let s = String(text ?? '')
  s = s.replace(/(\p{L})'(\p{L})/gu, '$1’$2').replace(/(\p{L})'(?=[\s.,)]|$)/gu, '$1’')
  // English closes the gap before a percent sign; French keeps it, unbreakable.
  if (lang !== 'fr') s = s.replace(/(\d) %/g, '$1%')
  if (lang === 'fr') {
    s = s.replace(/ ([:;?!»])/g, NNBSP + '$1').replace(/« /g, '«' + NNBSP).replace(/(\d) %/g, '$1' + NNBSP + '%')
  }
  return s
}

/** Escaped, typographically correct text. */
export const tx = (text, lang) => esc(typo(text, lang))

/** Fills `{{var}}` slots; a slot with no value is a build error, never an empty hole in a sentence. */
export function fill(template, params = {}) {
  return String(template).replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    if (params[k] == null) throw new Error(`no value for {{${k}}} in "${template}"`)
    return String(params[k])
  })
}

/**
 * i18next-compatible lookup: dotted keys, `{{var}}`, plural suffixes (`_zero`
 * first when present), `defaultValue`. A missing key throws: the build must
 * never print a key name where a sentence was meant.
 */
export function makeT(dict, lang) {
  const get = (key) => key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), dict)
  const rules = new Intl.PluralRules(lang)
  return (key, params = {}) => {
    let v
    if (typeof params.count === 'number') {
      if (params.count === 0) v = get(`${key}_zero`)
      if (typeof v !== 'string') v = get(`${key}_${rules.select(params.count)}`)
      if (typeof v !== 'string') v = get(`${key}_other`)
    }
    if (typeof v !== 'string') v = get(key)
    if (typeof v !== 'string') v = params.defaultValue
    if (typeof v !== 'string') throw new Error(`missing text: ${key} (${lang})`)
    return fill(v, params)
  }
}

/** Number in the page's locale (French uses a comma and thin spaces). */
export function num(value, locale, digits = 0) {
  return new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value)
}

/** Signed number: +12 / −4 (a real minus sign, never a hyphen). */
export function signed(value, locale, digits = 0) {
  const abs = num(Math.abs(value), locale, digits)
  return value > 0 ? `+${abs}` : value < 0 ? `−${abs}` : abs
}

export const cls = (...names) => names.filter(Boolean).join(' ')
