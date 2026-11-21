/**
 * The details of auto-detected mistakes, in the player's language (21/11/2026, beta.22 bug: they showed in English in
 * the FR UI). The detector (electron/main/mistakeDetector.ts, mistakeRules.ts) keeps writing its English note: stored
 * data is unchanged, and old rows are read the same way. Here each known English form is recognised and rendered from
 * an i18n key with its parameters (keys under `mistakes.detected.*`, FR and EN). An unknown note is shown as it is.
 *
 * Keep each pattern in step with its template in the detector (tests/unit/detectedMistakeNote.test.ts lists them all).
 */

export type Translate = (key: string, params?: Record<string, string | number>) => string

export interface NoteKey {
  key: string
  params: Record<string, string | number>
}

/** The detector's objective names (MAJOR_OBJECTIVES, and the Elder Dragon). */
const OBJECTIVES: Record<string, string> = {
  'Dragon': 'dragon',
  'Elder Dragon': 'elder',
  'Baron': 'baron',
  'Rift Herald': 'herald',
  'Void Grubs': 'grubs',
}
const objectiveKey = (name: string) => (OBJECTIVES[name] ? `mistakes.detected.objective.${OBJECTIVES[name]}` : null)

type Rule = { re: RegExp; to: (m: RegExpExecArray) => NoteKey | null }

/** Parts of a composite note ("Greed — a · b", "Rough lane opening vs X: a · b"). */
const PART_RULES: Rule[] = [
  { re: /^took a plate just before$/, to: () => ({ key: 'mistakes.detected.part.tookPlate', params: {} }) },
  { re: /^died (\d+)% into enemy territory$/, to: (m) => ({ key: 'mistakes.detected.part.deepDeath', params: { percent: Number(m[1]) } }) },
  { re: /^died at (\d+:\d{2})$/, to: (m) => ({ key: 'mistakes.detected.part.diedAt', params: { time: m[1] } }) },
  { re: /^(-?\d+) CS at 5:00$/, to: (m) => ({ key: 'mistakes.detected.part.csAt5', params: { value: Number(m[1]) } }) },
  { re: /^(-?\d+) gold at 5:00$/, to: (m) => ({ key: 'mistakes.detected.part.goldAt5', params: { value: Number(m[1]) } }) },
]

const RULES: Rule[] = [
  { re: /^Recall with (\d+)g unspent \(~([\d.]+)min since last purchase\)$/, to: (m) => ({ key: 'mistakes.detected.recallUnspent', params: { gold: Number(m[1]), minutes: m[2] } }) },
  { re: /^Died with (\d+)g unspent$/, to: (m) => ({ key: 'mistakes.detected.diedUnspent', params: { gold: Number(m[1]) } }) },
  { re: /^Died (\d+)u from an enemy turret$/, to: (m) => ({ key: 'mistakes.detected.diedNearTurret', params: { distance: Number(m[1]) } }) },
  { re: /^Died (\d+)s before the enemy took (.+)$/, to: (m) => objKey(m[2], (o) => ({ key: 'mistakes.detected.diedBeforeObjective', params: { seconds: Number(m[1]), objective: o } })) },
  { re: /^Still dead \((\d+)s left\) when the enemy took (.+) at (\d+:\d{2})$/, to: (m) => objKey(m[2], (o) => ({ key: 'mistakes.detected.stillDead', params: { seconds: Number(m[1]), objective: o, time: m[3] } })) },
  { re: /^No ward placed in the 90s before (.+) \((\d+:\d{2}), (taken by your team|lost)\)$/, to: (m) => objKey(m[1], (o) => ({ key: m[3] === 'lost' ? 'mistakes.detected.noWardBeforeLost' : 'mistakes.detected.noWardBeforeTaken', params: { objective: o, time: m[2] } })) },
  { re: /^No ward placed for (\d+) min \(from (\d+:\d{2})\)$/, to: (m) => ({ key: 'mistakes.detected.noWardFor', params: { minutes: Number(m[1]), time: m[2] } }) },
  { re: /^Died at the top-side pit with no ally nearby$/, to: () => ({ key: 'mistakes.detected.pitDeathNoAlly', params: {} }) },
  { re: /^Died at the top-side pit with only one ally nearby$/, to: () => ({ key: 'mistakes.detected.pitDeathOneAlly', params: {} }) },
  { re: /^Caught alone by (\d+) enemies, no ally within reach$/, to: (m) => ({ key: 'mistakes.detected.caughtAlone', params: { count: Number(m[1]) } }) },
  { re: /^Solo-killed by your lane opponent \((.+)\)$/, to: (m) => ({ key: 'mistakes.detected.soloKilled', params: { champion: m[1] } }) },
  { re: /^First to die in a (\d+)-kill fight$/, to: (m) => ({ key: 'mistakes.detected.firstToDie', params: { kills: Number(m[1]) } }) },
  { re: /^(-?\d+) CS behind (.+) at 10:00 \((\d+) vs (\d+)\)$/, to: (m) => ({ key: 'mistakes.detected.csBehind', params: { gap: Number(m[1]), champion: m[2], mine: Number(m[3]), theirs: Number(m[4]) } }) },
  { re: /^Level (\d+) vs (.+)'s level (\d+) at (\d+):00$/, to: (m) => ({ key: 'mistakes.detected.levelBehind', params: { mine: Number(m[1]), champion: m[2], theirs: Number(m[3]), minute: Number(m[4]) } }) },
  { re: /^Died at level (\d+) to a level-(\d+) (.+) during the early level race$/, to: (m) => ({ key: 'mistakes.detected.levelRaceDeath', params: { mine: Number(m[1]), theirs: Number(m[2]), champion: m[3] } }) },
]

/** Composite notes: the head key, and the parts translated one by one then joined. */
const COMPOSITE: Array<{ re: RegExp; key: string; params: (m: RegExpExecArray) => Record<string, string | number>; parts: (m: RegExpExecArray) => string }> = [
  { re: /^Greed — (.+)$/, key: 'mistakes.detected.greed', params: () => ({}), parts: (m) => m[1] },
  { re: /^Rough lane opening vs (.+?): (.+)$/, key: 'mistakes.detected.roughLane', params: (m) => ({ champion: m[1] }), parts: (m) => m[2] },
]

/** The objective's own key, carried as a key to translate (`@key`), or null for an unknown name. */
function objKey(name: string, make: (objective: string) => NoteKey): NoteKey | null {
  const k = objectiveKey(name)
  return k ? make(`@${k}`) : null
}

function matchPart(text: string): NoteKey | null {
  for (const r of PART_RULES) {
    const m = r.re.exec(text)
    if (m) return r.to(m)
  }
  return null
}

/**
 * The i18n form of a detector note, or null when the note is not one of the detector's (a note written by the player,
 * or a future form). Parameters starting with `@` are keys to translate themselves (objective names); a composite note
 * carries its parts in `parts`.
 */
export function detectedNoteKey(note: string | null | undefined): (NoteKey & { parts?: NoteKey[] }) | null {
  const text = note?.trim()
  if (!text) return null
  for (const r of RULES) {
    const m = r.re.exec(text)
    if (m) return r.to(m)
  }
  for (const c of COMPOSITE) {
    const m = c.re.exec(text)
    if (!m) continue
    const parts = c.parts(m).split(' · ').map(matchPart)
    if (parts.some((p) => p === null)) return null
    return { key: c.key, params: c.params(m), parts: parts as NoteKey[] }
  }
  return null
}

const resolve = (params: Record<string, string | number>, t: Translate) =>
  Object.fromEntries(Object.entries(params).map(([k, v]) => [k, typeof v === 'string' && v.startsWith('@') ? t(v.slice(1)) : v]))

/** A detector note in the UI's language (i18next's `t`); any other note is returned as it is. */
export function localizeDetectedNote(note: string | null | undefined, t: Translate): string {
  const k = detectedNoteKey(note)
  if (!k) return note ?? ''
  const params = resolve(k.params, t)
  if (k.parts) params.reasons = k.parts.map((p) => t(p.key, resolve(p.params, t))).join(' · ')
  return t(k.key, params)
}
