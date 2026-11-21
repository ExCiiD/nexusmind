/**
 * Written session objectives (user decision 20/11/2026): a session can start with no fundamental, only with objectives
 * the player writes or a coach assigned. Fundamentals stay possible, alone or in addition. Contract with Back-end:
 * `Session.customObjectives`, `saveReview.customObjectiveResults`. Pure, tested.
 */

export const MAX_CUSTOM_OBJECTIVES = 5
export const MAX_OBJECTIVE_LENGTH = 200

export interface CustomObjective {
  id: string
  text: string
  source: 'player' | 'coach'
  assignmentId?: string | null
  fundamentalIds?: string[]
}

export type ObjectiveResult = 'yes' | 'no' | 'partial'

export interface CustomObjectiveResult {
  objectiveId: string
  result: ObjectiveResult
  note?: string | null
}

let seq = 0
export function newObjectiveId(): string {
  seq += 1
  return `obj-${Date.now().toString(36)}-${seq}`
}

/** What is sent: trimmed, the empty ones dropped, at most 5, each at most 200 characters, no duplicate text. */
export function cleanObjectives(list: CustomObjective[]): CustomObjective[] {
  const seen = new Set<string>()
  const out: CustomObjective[] = []
  for (const o of list) {
    const text = o.text.trim().slice(0, MAX_OBJECTIVE_LENGTH)
    const key = text.toLowerCase()
    if (!text || seen.has(key)) continue
    seen.add(key)
    out.push({ ...o, text })
    if (out.length >= MAX_CUSTOM_OBJECTIVES) break
  }
  return out
}

/** A session needs at least one fundamental or one written objective. */
export function canStartSession(fundamentalIds: string[], objectives: CustomObjective[]): boolean {
  return fundamentalIds.length > 0 || cleanObjectives(objectives).length > 0
}

/** A coach's assigned objective, used for the session: its note is the text (else its fundamentals' labels). */
export function objectiveFromAssignment(
  a: { id: string; note: string | null; objectiveIds: string[] },
  labelOf: (fundamentalId: string) => string,
): CustomObjective | null {
  const text = (a.note ?? '').trim() || a.objectiveIds.map(labelOf).join(', ')
  if (!text) return null
  return { id: newObjectiveId(), text: text.slice(0, MAX_OBJECTIVE_LENGTH), source: 'coach', assignmentId: a.id, fundamentalIds: a.objectiveIds }
}

/** Adds an objective unless it is already there (same assignment, or same text) or the list is full. */
export function addObjective(list: CustomObjective[], o: CustomObjective): CustomObjective[] {
  if (list.length >= MAX_CUSTOM_OBJECTIVES) return list
  if (o.assignmentId && list.some((x) => x.assignmentId === o.assignmentId)) return list
  if (o.text.trim() && list.some((x) => x.text.trim().toLowerCase() === o.text.trim().toLowerCase())) return list
  return [...list, o]
}

/** The session's objectives as the server returns them (JSON text, array, or missing). */
export function parseObjectives(raw: unknown): CustomObjective[] {
  let v = raw
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return [] } }
  if (!Array.isArray(v)) return []
  return v.filter((o): o is CustomObjective => !!o && typeof o.id === 'string' && typeof o.text === 'string' && o.text.trim() !== '')
}

/** The results of a review, one per objective (results of objectives no longer in the session are dropped). */
export function parseResults(raw: unknown, objectives: CustomObjective[]): CustomObjectiveResult[] {
  let v = raw
  if (typeof v === 'string') { try { v = JSON.parse(v) } catch { return [] } }
  if (!Array.isArray(v)) return []
  const ids = new Set(objectives.map((o) => o.id))
  return v.filter((r): r is CustomObjectiveResult => !!r && ids.has(r.objectiveId) && ['yes', 'no', 'partial'].includes(r.result))
}

/** The coach objectives of a session that can be marked as reached at its end (they come from an assignment). */
export function coachObjectivesOf(objectives: CustomObjective[]): Array<CustomObjective & { assignmentId: string }> {
  return objectives.filter((o): o is CustomObjective & { assignmentId: string } => o.source === 'coach' && !!o.assignmentId)
}

/** What endSession sends (20/11: never automatic): only the ticked ones that are still coach objectives of the session. */
export function completedAssignmentIds(objectives: CustomObjective[], ticked: ReadonlySet<string>): string[] {
  return [...new Set(coachObjectivesOf(objectives).map((o) => o.assignmentId).filter((id) => ticked.has(id)))]
}

/** The review can be saved once every written objective has a result. */
export function allObjectivesAnswered(objectives: CustomObjective[], results: CustomObjectiveResult[]): boolean {
  return objectives.every((o) => results.some((r) => r.objectiveId === o.id))
}
