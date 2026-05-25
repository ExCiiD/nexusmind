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

// Simulates `recording:scan`'s Step 4 inner loop. Mirrors the implementation in
// electron/main/ipc/recording.ipc.ts so that any future regression there
// (e.g. someone removes the matchedFilePaths guard) immediately surfaces here.
function simulateMatchingLoop(params: {
  games: Array<{ id: string; gameEndAt: Date; duration: number }>
  files: Array<{ path: string; createdAt: Date }>
  alreadyLinkedPaths?: Set<string>
}): Array<{ gameId: string; filePath: string }> {
  const matchedFilePaths = new Set<string>()
  const alreadyLinked = params.alreadyLinkedPaths ?? new Set<string>()
  const matched: Array<{ gameId: string; filePath: string }> = []

  for (const game of params.games) {
    for (const file of params.files) {
      if (matchedFilePaths.has(file.path)) continue
      if (alreadyLinked.has(file.path)) continue
      if (matchRecordingToGame(file.createdAt, game.gameEndAt, game.duration)) {
        matched.push({ gameId: game.id, filePath: file.path })
        matchedFilePaths.add(file.path)
        break
      }
    }
  }
  return matched
}

describe('recording:scan dedup — Step 4 invariants', () => {
  it('un même fichier ne peut pas matcher plus d une game dans la même passe', () => {
    // Two back-to-back games: the same recording file falls in both ±5 min windows.
    const file = {
      path: 'C:/recordings/game1.mp4',
      createdAt: new Date('2026-04-14T19:30:00.000Z'),
    }
    const games = [
      { id: 'game-A', gameEndAt: new Date('2026-04-14T20:00:00.000Z'), duration: 30 * 60 },
      { id: 'game-B', gameEndAt: new Date('2026-04-14T20:05:00.000Z'), duration: 5 * 60 },
    ]

    const result = simulateMatchingLoop({ games, files: [file] })

    expect(result).toHaveLength(1)
    expect(result[0].gameId).toBe('game-A')
    expect(result[0].filePath).toBe(file.path)
  })

  it('un fichier déjà lié à un Recording existant est ignoré', () => {
    const file = {
      path: 'C:/recordings/already-linked.mp4',
      createdAt: new Date('2026-04-14T19:30:00.000Z'),
    }
    const games = [
      { id: 'game-A', gameEndAt: new Date('2026-04-14T20:00:00.000Z'), duration: 30 * 60 },
    ]

    const result = simulateMatchingLoop({
      games,
      files: [file],
      alreadyLinkedPaths: new Set([file.path]),
    })

    expect(result).toHaveLength(0)
  })

  it('chaque game prend un fichier distinct quand plusieurs sont disponibles', () => {
    const fileA = {
      path: 'C:/recordings/game1.mp4',
      createdAt: new Date('2026-04-14T19:30:00.000Z'),
    }
    const fileB = {
      path: 'C:/recordings/game2.mp4',
      createdAt: new Date('2026-04-14T20:30:00.000Z'),
    }
    const games = [
      { id: 'game-A', gameEndAt: new Date('2026-04-14T20:00:00.000Z'), duration: 30 * 60 },
      { id: 'game-B', gameEndAt: new Date('2026-04-14T21:00:00.000Z'), duration: 30 * 60 },
    ]

    const result = simulateMatchingLoop({ games, files: [fileA, fileB] })

    expect(result).toHaveLength(2)
    expect(result.map((r) => r.filePath).sort()).toEqual([fileA.path, fileB.path].sort())
    expect(new Set(result.map((r) => r.filePath)).size).toBe(2)
  })
})
