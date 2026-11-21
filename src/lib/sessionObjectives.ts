/**
 * A session's objectives, server side (decision of 20/11/2026): fundamentals, objectives written by the player,
 * objectives assigned by the coach, alone or together. A session needs at least one of them; with written
 * objectives only, it has no fundamental (`objectiveId` empty, `objectiveIds` "[]").
 *
 * The shape is Front-End's (src/lib/customObjectives.ts, the screens). This module validates what is stored and
 * reads sessions for the main process. Pure.
 */
import {
  MAX_CUSTOM_OBJECTIVES, MAX_OBJECTIVE_LENGTH,
  type CustomObjective, type CustomObjectiveResult, type ObjectiveResult,
} from './customObjectives'

export { MAX_CUSTOM_OBJECTIVES, MAX_OBJECTIVE_LENGTH }
export type { CustomObjective, CustomObjectiveResult, ObjectiveResult }

export const CUSTOM_RESULT_NOTE_MAX_LEN = 280

/** What the screens send for a written objective (an existing id is kept). */
export interface CustomObjectiveInput {
  id?: string
  text: string
  source: 'player' | 'coach'
  assignmentId?: string | null
  fundamentalIds?: string[]
}

const ID = /^[A-Za-z0-9_-]{1,64}$/

function parseArray(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw
  if (typeof raw !== 'string' || !raw) return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v : [] } catch { return [] }
}

/** Written objectives stored on a session (bad entries dropped). */
export function parseCustomObjectives(raw: unknown): CustomObjective[] {
  return parseArray(raw).flatMap((o: any) => {
    if (!o || typeof o.text !== 'string' || !o.text.trim() || typeof o.id !== 'string' || !ID.test(o.id)) return []
    return [{
      id: o.id, text: o.text, source: o.source === 'coach' ? 'coach' as const : 'player' as const,
      ...(typeof o.assignmentId === 'string' && o.assignmentId ? { assignmentId: o.assignmentId } : {}),
      ...(Array.isArray(o.fundamentalIds) ? { fundamentalIds: o.fundamentalIds.filter((x: unknown) => typeof x === 'string') } : {}),
    }]
  })
}

/** Results stored on a review (bad entries dropped). */
export function parseCustomObjectiveResults(raw: unknown): CustomObjectiveResult[] {
  return parseArray(raw).flatMap((r: any) => {
    if (!r || typeof r.objectiveId !== 'string' || !['yes', 'no', 'partial'].includes(r.result)) return []
    return [{ objectiveId: r.objectiveId, result: r.result as ObjectiveResult, ...(typeof r.note === 'string' && r.note ? { note: r.note } : {}) }]
  })
}

/** The fundamentals of a session: `objectiveIds` (JSON), else `objectiveId`, never an empty id. */
export function fundamentalIdsOf(s: { objectiveId?: string | null; objectiveIds?: string | null }): string[] {
  const list = parseArray(s.objectiveIds).filter((x): x is string => typeof x === 'string' && x.length > 0)
  if (list.length) return list
  return s.objectiveId ? [s.objectiveId] : []
}

export function sessionObjectivesOf(s: { objectiveId?: string | null; objectiveIds?: string | null; customObjectives?: string | null }): {
  fundamentalIds: string[]
  custom: CustomObjective[]
} {
  return { fundamentalIds: fundamentalIdsOf(s), custom: parseCustomObjectives(s.customObjectives) }
}

export function hasFundamentals(s: { objectiveId?: string | null; objectiveIds?: string | null }): boolean {
  return fundamentalIdsOf(s).length > 0
}

/** A short random id for an objective sent without one. `random` injected by the tests. */
export function newServerObjectiveId(random: () => number = Math.random): string {
  const abc = 'abcdefghijklmnopqrstuvwxyz0123456789'
  return 'obj-' + Array.from({ length: 8 }, () => abc[Math.floor(random() * abc.length)]).join('')
}

/**
 * The written objectives to store: trimmed, 1-200 characters, at most 5, ids kept or made, one objective per coach
 * assignment. Throws BAD_OBJECTIVE for an empty or too long text, TOO_MANY_OBJECTIVES beyond 5.
 */
export function normalizeCustomObjectives(input: CustomObjectiveInput[] | null | undefined, random?: () => number): CustomObjective[] {
  const list = input ?? []
  if (list.length > MAX_CUSTOM_OBJECTIVES) throw new Error('TOO_MANY_OBJECTIVES')
  const out: CustomObjective[] = []
  const used = new Set<string>()
  const assignments = new Set<string>()
  for (const o of list) {
    const text = typeof o?.text === 'string' ? o.text.trim() : ''
    if (!text || text.length > MAX_OBJECTIVE_LENGTH) throw new Error('BAD_OBJECTIVE')
    const assignmentId = typeof o.assignmentId === 'string' && o.assignmentId ? o.assignmentId : undefined
    if (assignmentId && assignments.has(assignmentId)) continue
    if (assignmentId) assignments.add(assignmentId)
    let id = typeof o.id === 'string' && ID.test(o.id) && !used.has(o.id) ? o.id : newServerObjectiveId(random)
    while (used.has(id)) id = newServerObjectiveId(random)
    used.add(id)
    const fundamentalIds = Array.isArray(o.fundamentalIds) ? o.fundamentalIds.filter((x) => typeof x === 'string').slice(0, 10) : undefined
    out.push({
      id, text, source: o.source === 'coach' ? 'coach' : 'player',
      ...(assignmentId ? { assignmentId } : {}),
      ...(fundamentalIds?.length ? { fundamentalIds } : {}),
    })
  }
  return out
}

/** At least one fundamental or one written objective; throws NO_OBJECTIVE otherwise. */
export function assertHasObjective(fundamentalIds: string[], custom: CustomObjective[]): void {
  if (fundamentalIds.length === 0 && custom.length === 0) throw new Error('NO_OBJECTIVE')
}

/** The results to store: only for the session's objectives, one per objective, notes trimmed to 280. */
export function normalizeCustomResults(input: Array<{ objectiveId: string; result: string; note?: string | null }> | null | undefined, objectives: CustomObjective[]): CustomObjectiveResult[] {
  const known = new Set(objectives.map((o) => o.id))
  const seen = new Set<string>()
  const out: CustomObjectiveResult[] = []
  for (const r of input ?? []) {
    if (!r || typeof r.objectiveId !== 'string' || !known.has(r.objectiveId) || seen.has(r.objectiveId) || !['yes', 'no', 'partial'].includes(r.result)) continue
    seen.add(r.objectiveId)
    const note = typeof r.note === 'string' ? r.note.trim().slice(0, CUSTOM_RESULT_NOTE_MAX_LEN) : ''
    out.push({ objectiveId: r.objectiveId, result: r.result as ObjectiveResult, ...(note ? { note } : {}) })
  }
  return out
}

/**
 * `Review.objectiveRespected` of a review: the player's answer when the session has fundamentals; without
 * fundamentals, true only when every written objective is answered "yes".
 */
export function objectiveRespectedOf(opts: { hasFundamentals: boolean; given?: boolean | null; results: CustomObjectiveResult[]; objectives: CustomObjective[] }): boolean {
  if (opts.hasFundamentals && typeof opts.given === 'boolean') return opts.given
  if (opts.objectives.length === 0) return typeof opts.given === 'boolean' ? opts.given : false
  return opts.objectives.every((o) => opts.results.some((r) => r.objectiveId === o.id && r.result === 'yes'))
}
