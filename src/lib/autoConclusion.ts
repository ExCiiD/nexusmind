import type { TFunction } from 'i18next'

/**
 * The idle auto-close (electron/main/sessionAutoClose.ts) stores its conclusion as an English sentence. Recognise it
 * and render it in the UI language; anything the player or the AI wrote is returned untouched.
 */
const IDLE = /^Session closed automatically after (\d+) minutes of inactivity — (\d+) game\(s\) \((\d+)W-(\d+)L\)\.$/
const NONE = /^Session closed automatically after (\d+) minutes with no game played\.$/

export function localizeConclusion(text: string, t: TFunction): string {
  const idle = IDLE.exec(text)
  if (idle) return t('history.autoConclusion.idle', { minutes: idle[1], games: idle[2], wins: idle[3], losses: idle[4] })
  const none = NONE.exec(text)
  if (none) return t('history.autoConclusion.none', { minutes: none[1] })
  return text
}
