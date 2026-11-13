/**
 * R1 — timestamped notes pre-filled from the game's own data: deaths,
 * multi-kills, objectives taken/lost, turrets lost, and auto-detected
 * mistakes. Pure and deterministic; the review page only uses this when the
 * player has not typed anything yet, and the player can edit or delete
 * every line — this never touches a saved review.
 */

import type { GameEvent, GameEventType } from './eventExtractor'

export interface PrefilledNote {
  time: string
  note: string
  auto: true
}

export interface MistakeForNotes {
  tagSlug: string
  tagLabel: string
  gameTimeSec: number
  severity: number
}

export const MAX_NOTES = 12
/** Kills within this window of each other count as one multi-kill. */
const MULTI_KILL_WINDOW_MS = 10_000
const OBJECTIVE_TYPES: ReadonlySet<GameEventType> = new Set(['dragon', 'baron', 'herald', 'voidgrub', 'atakhan'])

function fmt(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** The player's own team, read off any event they were directly involved in. */
function playerTeamId(events: GameEvent[]): 100 | 200 | undefined {
  const e = events.find((ev) => ev.isPlayer && (ev.type === 'kill' || ev.type === 'death' || ev.type === 'assist') && ev.teamId != null)
  return e?.teamId as 100 | 200 | undefined
}

interface Draft { ms: number; note: string }

/**
 * Builds up to `MAX_NOTES` draft notes, oldest first. `events` are the same
 * ones already cached for the video player timeline (eventExtractor.ts);
 * `mistakes` only contributes severity-3 (critical) entries — lower
 * severities are too numerous to be useful as review prompts.
 */
export function buildPrefilledNotes(events: GameEvent[], mistakes: MistakeForNotes[] = []): PrefilledNote[] {
  const myTeam = playerTeamId(events)
  const drafts: Draft[] = []

  for (const e of events) {
    if (e.type === 'death' && e.isPlayer) {
      drafts.push({ ms: e.gameTimeMs, note: e.label })
    } else if (myTeam != null && OBJECTIVE_TYPES.has(e.type) && e.teamId != null) {
      drafts.push({ ms: e.gameTimeMs, note: `${e.teamId === myTeam ? 'Objective taken' : 'Objective lost'}: ${e.label}` })
    } else if (myTeam != null && e.type === 'turret' && e.teamId != null && e.teamId !== myTeam) {
      // teamId here is the KILLER's team; the enemy killing a turret means it was ours.
      drafts.push({ ms: e.gameTimeMs, note: `Turret lost: ${e.label}` })
    }
  }

  // Multi-kills: 2+ of the player's own kills within the window collapse into one note.
  const playerKillTimes = events.filter((e) => e.type === 'kill' && e.isPlayer).map((e) => e.gameTimeMs).sort((a, b) => a - b)
  let i = 0
  while (i < playerKillTimes.length) {
    let j = i
    while (j + 1 < playerKillTimes.length && playerKillTimes[j + 1] - playerKillTimes[i] <= MULTI_KILL_WINDOW_MS) j++
    const count = j - i + 1
    if (count >= 2) drafts.push({ ms: playerKillTimes[i], note: `${count}-kill` })
    i = j + 1
  }

  for (const m of mistakes) {
    if (m.severity < 3) continue
    drafts.push({ ms: m.gameTimeSec * 1000, note: `Mistake: ${m.tagLabel}` })
  }

  drafts.sort((a, b) => a.ms - b.ms)
  return drafts.slice(0, MAX_NOTES).map((d) => ({ time: fmt(d.ms), note: d.note, auto: true }))
}
