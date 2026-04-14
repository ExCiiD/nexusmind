import { describe, it, expect } from 'vitest'
import { matchRecordingToGame } from '../../electron/main/recordingMatch'

describe('matchRecordingToGame — fichier ↔ partie (fenêtre temporelle)', () => {
  const bufferMs = 5 * 60 * 1000

  it('fichier créé au début d une partie 25 min avant la fin doit matcher', () => {
    const gameEnd = new Date('2026-04-14T20:00:00.000Z')
    const durationSec = 25 * 60
    const fileAtGameStart = new Date(gameEnd.getTime() - durationSec * 1000)
    expect(matchRecordingToGame(fileAtGameStart, gameEnd, durationSec, bufferMs)).toBe(true)
  })

  it('fichier créé 2 min avant la fin (late start) reste dans la fenêtre', () => {
    const gameEnd = new Date('2026-04-14T20:00:00.000Z')
    const durationSec = 30 * 60
    const fileLate = new Date(gameEnd.getTime() - 2 * 60 * 1000)
    expect(matchRecordingToGame(fileLate, gameEnd, durationSec, bufferMs)).toBe(true)
  })

  it('fichier trop ancien (hors fenêtre) ne doit pas matcher', () => {
    const gameEnd = new Date('2026-04-14T20:00:00.000Z')
    const durationSec = 30 * 60
    const fileTooOld = new Date(gameEnd.getTime() - durationSec * 1000 - bufferMs - 60_000)
    expect(matchRecordingToGame(fileTooOld, gameEnd, durationSec, bufferMs)).toBe(false)
  })

  it('fichier créé après la fin + buffer ne doit pas matcher', () => {
    const gameEnd = new Date('2026-04-14T20:00:00.000Z')
    const durationSec = 20 * 60
    const fileAfter = new Date(gameEnd.getTime() + bufferMs + 120_000)
    expect(matchRecordingToGame(fileAfter, gameEnd, durationSec, bufferMs)).toBe(false)
  })

  it('ancienne logique [-60s, +10min] échouait pour un enregistrement au début de partie', () => {
    const gameEnd = new Date('2026-04-14T20:00:00.000Z')
    const durationSec = 35 * 60
    const fileAtStart = new Date(gameEnd.getTime() - durationSec * 1000)
    const oldStyleWouldFail =
      fileAtStart.getTime() - gameEnd.getTime() >= -60_000 &&
      fileAtStart.getTime() - gameEnd.getTime() <= 10 * 60 * 1000
    expect(oldStyleWouldFail).toBe(false)
    expect(matchRecordingToGame(fileAtStart, gameEnd, durationSec, bufferMs)).toBe(true)
  })
})
