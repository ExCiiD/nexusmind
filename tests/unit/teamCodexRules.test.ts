import { describe, it, expect } from 'vitest'
import { groupCodexRules, rolesToStore, PLAYED_ROLES } from '../../src/lib/teamCodexRules'
import { foldLabel, mistakeSlug, slugAsLabel } from '../../src/lib/mistakeSlug'
import type { TeamCodexRule } from '../../src/lib/microReview/types'

const rule = (id: string, role: TeamCodexRule['role'], over: Partial<TeamCodexRule> = {}): TeamCodexRule => ({
  id, groupId: 'g1', role, mistakeSlug: 'no-ward-pre-obj', phase: 'any', fundamentalId: 'vision_control',
  headline: 'Pink dans la fosse', tacticalRule: 'Pose la pink à -1:00', drillObjective: '1 pink par objectif',
  ...over,
} as TeamCodexRule)

describe('mistakeSlug (one slug for a custom mistake, wherever it is named)', () => {
  it('folds accents instead of turning them into separators', () => {
    expect(mistakeSlug('Mauvais reset après drake')).toBe('mauvais-reset-apres-drake')
    expect(mistakeSlug('Priorité perdue')).toBe('priorite-perdue')
  })

  it('gives the slug the micro-review "Autre cause" gives (resolveTag steps)', () => {
    // Same steps as electron/main/ipc/microReview.ipc.ts resolveTag, written out.
    const resolveTagBase = (raw: string) => raw.trim().slice(0, 60).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'custom'
    for (const label of ['  Trop de temps en lane !', 'Écart de niveau (jungle)', 'ÉLÉMENTAIRE', '???', 'x'.repeat(90)]) {
      expect(mistakeSlug(label)).toBe(resolveTagBase(label))
    }
  })

  it('always fits the cloud slug shape', () => {
    for (const label of ['', '   ', '!!!', 'Ça a l’air simple — non ?', 'a'.repeat(200)]) {
      expect(mistakeSlug(label)).toMatch(/^[a-z0-9-]{1,64}$/)
    }
    expect(mistakeSlug('***')).toBe('custom')
  })

  it('reads a slug back as a sentence, and compares labels loosely', () => {
    expect(slugAsLabel('mauvais-reset-apres-drake')).toBe('Mauvais reset apres drake')
    expect(foldLabel('  Contrôle   de la VISION ')).toBe('controle de la vision')
  })
})

describe('rolesToStore', () => {
  it('stores no ticked role, or all five, as the single "any" row', () => {
    expect(rolesToStore([])).toEqual(['any'])
    expect(rolesToStore([...PLAYED_ROLES])).toEqual(['any'])
  })

  it('stores each ticked role once, in lane order', () => {
    expect(rolesToStore(['UTILITY', 'TOP', 'TOP'])).toEqual(['TOP', 'UTILITY'])
  })
})

describe('groupCodexRules (one rule for several roles is several rows)', () => {
  it('shows the rows of one rule as one entry, roles in lane order, every id kept for deletion', () => {
    const groups = groupCodexRules([rule('a', 'UTILITY'), rule('b', 'TOP'), rule('c', 'JUNGLE')])
    expect(groups).toHaveLength(1)
    expect(groups[0].roles).toEqual(['TOP', 'JUNGLE', 'UTILITY'])
    expect(groups[0].ids.sort()).toEqual(['a', 'b', 'c'])
  })

  it('keeps rules apart when anything but the role differs', () => {
    const groups = groupCodexRules([
      rule('a', 'TOP'),
      rule('b', 'TOP', { phase: 'early' }),
      rule('c', 'TOP', { headline: 'Autre titre' }),
      rule('d', 'TOP', { groupId: 'g2' }),
      rule('e', 'TOP', { mistakeSlug: 'overstay' }),
    ])
    expect(groups).toHaveLength(5)
  })

  it('reads "all roles" when one of the rows is for any role', () => {
    const [g] = groupCodexRules([rule('a', 'TOP'), rule('b', 'any')])
    expect(g.roles).toEqual(['any'])
    expect(g.ids).toEqual(['a', 'b'])
  })
})
