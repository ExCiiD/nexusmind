/**
 * Writes the position icons (src/lib/roleGlyphs.ts) as asset files:
 * src/assets/roles/<role>.svg (white), <role>-gold.svg and
 * <role>-gold-gradient.svg. Run after changing the drawings:
 *   npx tsx scripts/gen-role-icons.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ROLE_GLYPHS, roleGlyphSvg, type GlyphRole } from '../src/lib/roleGlyphs'

const FILE_NAMES: Record<GlyphRole, string> = { TOP: 'top', JUNGLE: 'jungle', MID: 'mid', ADC: 'bot', SUPPORT: 'support' }
const dir = join(__dirname, '..', 'src', 'assets', 'roles')
mkdirSync(dir, { recursive: true })
for (const role of Object.keys(ROLE_GLYPHS) as GlyphRole[]) {
  const name = FILE_NAMES[role]
  writeFileSync(join(dir, `${name}.svg`), roleGlyphSvg(role, 'white'))
  writeFileSync(join(dir, `${name}-gold.svg`), roleGlyphSvg(role, 'gold'))
  writeFileSync(join(dir, `${name}-gold-gradient.svg`), roleGlyphSvg(role, 'gold-gradient'))
}
console.log(`role icons written to ${dir}`)
