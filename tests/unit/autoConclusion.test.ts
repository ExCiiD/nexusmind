import { describe, expect, it } from 'vitest'
import { localizeConclusion } from '@/lib/autoConclusion'
import { buildAutoConclusion } from '../../electron/main/sessionAutoClose'

const t = ((k: string, o: Record<string, string>) => `${k}|${Object.values(o).join(',')}`) as never

describe('localizeConclusion', () => {
  it('recognises what buildAutoConclusion writes', () => {
    expect(localizeConclusion(buildAutoConclusion({ gamesPlayed: 2, wins: 1 }), t)).toBe('history.autoConclusion.idle|45,2,1,1')
    expect(localizeConclusion(buildAutoConclusion({ gamesPlayed: 0, wins: 0 }), t)).toBe('history.autoConclusion.none|45')
  })
  it('leaves a written conclusion alone', () => {
    expect(localizeConclusion('Bonne session', t)).toBe('Bonne session')
  })
})
