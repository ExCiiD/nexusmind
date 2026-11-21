/**
 * « Erreurs détectées » (21/11/2026): one mistake at a time, removed or retagged; the detection never brings it back;
 * every correction is logged locally (layer 1 of "the engine learns from corrections").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  mistakes: new Map<string, any>(),
  ignored: [] as any[],
  corrections: [] as any[],
}))
vi.mock('../../electron/main/ipc/microReview.ipc', () => ({ ANALYSIS_VERSION: 13 }))
vi.mock('../../electron/main/database', () => ({
  getPrisma: () => ({
    mistake: {
      findUnique: async ({ where }: any) => { const m = h.mistakes.get(where.id); return m ? { ...m, tag: { slug: m.tagSlug } } : null },
      delete: ({ where }: any) => ({ run: () => h.mistakes.delete(where.id) }),
      update: ({ where, data }: any) => ({ run: () => Object.assign(h.mistakes.get(where.id), data, data.tagId ? { tagSlug: data.tagId.replace('id-', '') } : {}) }),
      findMany: async () => [...h.mistakes.values()].filter((m) => m.autoDetected).map((m) => ({ tag: { slug: m.tagSlug } })),
      create: ({ data }: any) => ({ run: () => h.mistakes.set(data.id, { ...data }) }),
    },
    ignoredMistake: {
      create: ({ data }: any) => ({ run: () => h.ignored.push(data) }),
      deleteMany: ({ where }: any) => ({ run: () => { h.ignored = h.ignored.filter((r) => r.id !== where.id) } }),
    },
    mistakeCorrection: {
      create: ({ data }: any) => ({ run: () => h.corrections.push(data) }),
      deleteMany: ({ where }: any) => ({ run: () => { h.corrections = h.corrections.filter((r) => r.id !== where.id) } }),
      findMany: async () => h.corrections,
    },
    game: { findUnique: async () => ({ role: 'TOP', queueType: 'soloq' }) },
    $transaction: async (ops: any[]) => { for (const o of ops) o.run() },
  }),
}))

import { correctionStatsByRule, removeMistake, retagMistake, undoMistakeCorrection } from '../../electron/main/mistakeCorrections'
import { summarizeCorrections } from '../../electron/main/mistakeCorrectionsCore'

const auto = (id: string, tagSlug: string, gameTimeSec = 372) => h.mistakes.set(id, { id, gameId: 'g1', tagId: `id-${tagSlug}`, tagSlug, gameTimeSec, autoDetected: true })

beforeEach(() => { h.mistakes.clear(); h.ignored = []; h.corrections = [] })

describe('removing one detected mistake', () => {
  it('removes it, remembers it, logs the correction with the optional reason and the context', async () => {
    auto('m1', 'bad-trade')
    expect(await removeMistake('m1', { reason: 'not_a_mistake', note: '  I traded on purpose  ' })).toMatchObject({ autoDetected: true })
    expect(h.mistakes.has('m1')).toBe(false)
    expect(h.ignored).toMatchObject([{ gameId: 'g1', tagSlug: 'bad-trade', gameTimeSec: 372 }])
    expect(h.corrections[0]).toMatchObject({ mistakeId: 'm1', ruleTag: 'bad-trade', action: 'removed', reason: 'not_a_mistake', note: 'I traded on purpose', analysisVersion: 13, role: 'TOP', queueType: 'soloq' })
  })
  it('the reason never blocks: absent or unknown, the removal goes through without one', async () => {
    auto('m2', 'caught-out')
    await removeMistake('m2', { reason: 'nonsense' as any })
    expect(h.corrections[0].reason).toBeNull()
  })
  it('a manual mistake is just deleted: nothing remembered, no correction', async () => {
    h.mistakes.set('m3', { id: 'm3', gameId: 'g1', tagId: 'id-x', tagSlug: 'x', gameTimeSec: 10, autoDetected: false })
    await removeMistake('m3')
    expect(h.ignored).toHaveLength(0)
    expect(h.corrections).toHaveLength(0)
  })
})

describe('retagging one detected mistake', () => {
  it('takes the player\'s tag, becomes theirs (never overwritten), the rule\'s tag is remembered', async () => {
    auto('m4', 'bad-trade')
    await retagMistake('m4', 'id-bad-positioning', 'bad-positioning', { reason: 'wrong_tag' })
    expect(h.mistakes.get('m4')).toMatchObject({ tagSlug: 'bad-positioning', autoDetected: false, gameTimeSec: 372 })
    expect(h.ignored).toMatchObject([{ gameId: 'g1', tagSlug: 'bad-trade', gameTimeSec: 372 }])
    expect(h.corrections[0]).toMatchObject({ ruleTag: 'bad-trade', action: 'retagged', newTag: 'bad-positioning', reason: 'wrong_tag' })
  })
})

describe('per-rule summary (for the future registry)', () => {
  it('removal and retag rates over what the rule produced, and the most frequent retags', () => {
    const stats = summarizeCorrections(
      [
        { ruleTag: 'bad-trade', action: 'removed', newTag: null, reason: 'not_a_mistake' },
        { ruleTag: 'bad-trade', action: 'retagged', newTag: 'bad-positioning', reason: 'wrong_tag' },
        { ruleTag: 'bad-trade', action: 'retagged', newTag: 'bad-positioning', reason: null },
        { ruleTag: 'bad-trade', action: 'retagged', newTag: 'caught-out', reason: null },
      ],
      [{ tagSlug: 'bad-trade', count: 6 }, { tagSlug: 'unused-gold', count: 4 }],
    )
    expect(stats[0]).toEqual({
      ruleTag: 'bad-trade', detected: 10, removed: 1, retagged: 3, removalRate: 0.1, retagRate: 0.3,
      topRetags: [{ to: 'bad-positioning', count: 2 }, { to: 'caught-out', count: 1 }],
      reasons: { not_a_mistake: 1, wrong_tag: 1 },
    })
    expect(stats[1]).toMatchObject({ ruleTag: 'unused-gold', detected: 4, removalRate: 0, retagRate: 0 })
  })
  it('reads this PC\'s data', async () => {
    auto('m5', 'bad-trade')
    auto('m6', 'bad-trade', 500)
    await removeMistake('m5')
    const stats = await correctionStatsByRule()
    expect(stats.find((s) => s.ruleTag === 'bad-trade')).toMatchObject({ detected: 2, removed: 1, removalRate: 0.5 })
  })
})

describe('« Annuler » a correction (21/11/2026)', () => {
  it('a removed mistake comes back as it was, without its ignore and its correction row', async () => {
    h.mistakes.set('u1', { id: 'u1', gameId: 'g1', tagId: 'id-bad-trade', tagSlug: 'bad-trade', gameTimeSec: 372, severity: 3, note: 'n', videoTimeMs: 1000, recordingId: null, autoDetected: true })
    await removeMistake('u1', { reason: 'not_a_mistake' })
    expect(h.mistakes.has('u1')).toBe(false)
    await undoMistakeCorrection('u1')
    expect(h.mistakes.get('u1')).toMatchObject({ id: 'u1', tagId: 'id-bad-trade', gameTimeSec: 372, severity: 3, note: 'n', autoDetected: true })
    expect(h.ignored).toHaveLength(0)
    expect(h.corrections).toHaveLength(0)
  })
  it('a retagged mistake gets its first tag back, even after two retags', async () => {
    auto('u2', 'bad-trade')
    await retagMistake('u2', 'id-bad-positioning', 'bad-positioning')
    await retagMistake('u2', 'id-caught-out', 'caught-out')
    await undoMistakeCorrection('u2')
    expect(h.mistakes.get('u2')).toMatchObject({ tagId: 'id-bad-trade', autoDetected: true })
    expect(h.ignored).toHaveLength(0)
    expect(h.corrections).toHaveLength(0)
  })
  it('a manual mistake removed by mistake comes back too', async () => {
    h.mistakes.set('u3', { id: 'u3', gameId: 'g1', tagId: 'id-x', tagSlug: 'x', gameTimeSec: 10, autoDetected: false })
    await removeMistake('u3')
    await undoMistakeCorrection('u3')
    expect(h.mistakes.get('u3')).toMatchObject({ id: 'u3', autoDetected: false })
  })
  it('nothing to undo: NOT_UNDOABLE, and only once', async () => {
    await expect(undoMistakeCorrection('never')).rejects.toThrow('NOT_UNDOABLE')
    auto('u4', 'bad-trade')
    await removeMistake('u4')
    await undoMistakeCorrection('u4')
    await expect(undoMistakeCorrection('u4')).rejects.toThrow('NOT_UNDOABLE')
  })
})
