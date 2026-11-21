import { describe, it, expect } from 'vitest'
import { addObjective, allObjectivesAnswered, canStartSession, completedAssignmentIds, cleanObjectives, objectiveFromAssignment, parseObjectives, parseResults, type CustomObjective } from '../../src/lib/customObjectives'

const o = (id: string, text: string, extra: Partial<CustomObjective> = {}): CustomObjective => ({ id, text, source: 'player', ...extra })

// User decision 20/11: a session with no fundamental, only written or coach objectives.
describe('written session objectives', () => {
  it('a session starts with a fundamental or a written objective', () => {
    expect(canStartSession([], [])).toBe(false)
    expect(canStartSession([], [o('a', '   ')])).toBe(false)
    expect(canStartSession([], [o('a', 'Ward avant chaque drake')])).toBe(true)
    expect(canStartSession(['vision_control'], [])).toBe(true)
  })

  it('cleans what is sent: trimmed, no empty, no duplicate, at most 5, at most 200 characters', () => {
    const list = [o('a', ' Trade niveau 2 '), o('b', ''), o('c', 'trade niveau 2'), o('d', 'x'.repeat(250)), o('e', '3'), o('f', '4'), o('g', '5'), o('h', '6')]
    const out = cleanObjectives(list)
    expect(out.map((x) => x.id)).toEqual(['a', 'd', 'e', 'f', 'g'])
    expect(out[0].text).toBe('Trade niveau 2')
    expect(out[1].text).toHaveLength(200)
  })

  it('a coach objective: its note, else its fundamentals; never twice', () => {
    const c = objectiveFromAssignment({ id: 'as1', note: 'Pas de face-check', objectiveIds: ['vision_control'] }, (id) => id)!
    expect(c).toMatchObject({ text: 'Pas de face-check', source: 'coach', assignmentId: 'as1', fundamentalIds: ['vision_control'] })
    expect(objectiveFromAssignment({ id: 'as2', note: null, objectiveIds: ['wave'] }, () => 'Wave management')!.text).toBe('Wave management')
    expect(objectiveFromAssignment({ id: 'as3', note: ' ', objectiveIds: [] }, (id) => id)).toBeNull()
    const once = addObjective([], c)
    expect(addObjective(once, { ...c, id: 'other' })).toBe(once)
    expect(addObjective([o('a', 'Pas de face-check')], o('b', 'pas de face-check'))).toHaveLength(1)
  })

  it('sends only the coach objectives ticked « Objectif atteint » (never automatic)', () => {
    const objs = [o('a', 'Moi'), o('b', 'Coach 1', { source: 'coach', assignmentId: 'as1' }), o('c', 'Coach 2', { source: 'coach', assignmentId: 'as2' }), o('d', 'Coach sans id', { source: 'coach' })]
    expect(completedAssignmentIds(objs, new Set())).toEqual([])
    expect(completedAssignmentIds(objs, new Set(['as2', 'zz']))).toEqual(['as2'])
  })

  it('reads the server shapes and the review results', () => {
    const objs = parseObjectives(JSON.stringify([o('a', 'A'), { id: 'b' }, o('c', 'C')]))
    expect(objs.map((x) => x.id)).toEqual(['a', 'c'])
    expect(parseObjectives(null)).toEqual([])
    const res = parseResults([{ objectiveId: 'a', result: 'partial', note: 'mieux' }, { objectiveId: 'zz', result: 'yes' }, { objectiveId: 'c', result: 'maybe' }], objs)
    expect(res).toEqual([{ objectiveId: 'a', result: 'partial', note: 'mieux' }])
    expect(allObjectivesAnswered(objs, res)).toBe(false)
    expect(allObjectivesAnswered(objs, [...res, { objectiveId: 'c', result: 'no' }])).toBe(true)
  })
})
