import { describe, it, expect, vi } from 'vitest'

const { sessions, endSessionCore, deleteSessionCore } = vi.hoisted(() => ({
  sessions: [] as any[],
  endSessionCore: vi.fn(async (..._a: unknown[]) => ({})),
  deleteSessionCore: vi.fn(async (..._a: unknown[]) => {}),
}))
vi.mock('electron', () => ({ ipcMain: { handle: () => {}, on: () => {} } }))
vi.mock('../../electron/main/database', () => ({ getPrisma: () => ({ session: { findMany: async () => sessions } }) }))
vi.mock('../../electron/main/ipc/session.ipc', () => ({ endSessionCore, deleteSessionCore }))

import {
  autoCloseAction, hasObjectiveOrKpi, needsObjectivePrompt, AUTO_SESSION_IDLE_MINUTES as N, EMPTY_AUTO_SESSION_GRACE_MINUTES as GRACE,
} from '../../src/lib/autoSession'
import { autoCloseIdleSessions } from '../../electron/main/sessionAutoClose'

const MIN = 60_000
const T0 = 10 * 3_600_000
const auto = (over: Partial<Parameters<typeof autoCloseAction>[0]> = {}) => ({
  autoStarted: true, date: T0, lastGameEndAt: null, gamesPlayed: 0, hasObjectiveOrKpi: false, ...over,
})

describe('autoCloseAction: when a playing session ends', () => {
  it('back-to-back games stay in one session: each new game pushes the end back', () => {
    // games ended at +30, +65, +100 min: at each of these moments, 20 min later, the session is still open
    for (const end of [30, 65, 100]) {
      const info = auto({ gamesPlayed: 1, lastGameEndAt: T0 + end * MIN })
      expect(autoCloseAction(info, T0 + (end + 20) * MIN, false)).toBe('keep')
    }
  })

  it('closes once no game started within N minutes after the last one ended', () => {
    const info = auto({ gamesPlayed: 3, lastGameEndAt: T0 + 100 * MIN })
    expect(autoCloseAction(info, T0 + (100 + N) * MIN - 1, false)).toBe('keep')
    expect(autoCloseAction(info, T0 + (100 + N) * MIN, false)).toBe('close')
  })

  it('a game in progress keeps the session open however long it lasts', () => {
    const info = auto({ gamesPlayed: 1, lastGameEndAt: T0 + 10 * MIN })
    expect(autoCloseAction(info, T0 + 10 * MIN + 3 * N * MIN, true)).toBe('keep')
    expect(autoCloseAction(auto(), T0 + 5 * GRACE * MIN, true)).toBe('keep')
  })

  it('after an app restart it reads the end of the last game, not the time the app opened', () => {
    const lastEnd = T0 + 50 * MIN
    const info = auto({ gamesPlayed: 2, lastGameEndAt: lastEnd })
    // the app was closed for 5 hours and is just reopened: the first check closes the session at once
    expect(autoCloseAction(info, lastEnd + 5 * 3_600_000, false)).toBe('close')
    // reopened 10 minutes after the last game: still open
    expect(autoCloseAction(info, lastEnd + 10 * MIN, false)).toBe('keep')
  })

  it('a cancelled game or a remake that left no game: the empty session is deleted after the grace period', () => {
    expect(autoCloseAction(auto(), T0 + N * MIN, false)).toBe('keep') // a catch-up import may still come
    expect(autoCloseAction(auto(), T0 + GRACE * MIN - 1, false)).toBe('keep')
    expect(autoCloseAction(auto(), T0 + GRACE * MIN, false)).toBe('delete')
  })

  it('an empty auto session whose player wrote an objective or a KPI is closed, never deleted', () => {
    expect(autoCloseAction(auto({ hasObjectiveOrKpi: true }), T0 + GRACE * MIN, false)).toBe('close')
  })

  it('a session the player started keeps the old rule (closed after N minutes, even with no game)', () => {
    expect(autoCloseAction(auto({ autoStarted: false }), T0 + N * MIN, false)).toBe('close')
  })
})

describe('autoCloseIdleSessions (database side, mocked)', () => {
  const row = (over: any) => ({
    id: 's', date: new Date(T0), autoStarted: true, objectiveId: '', objectiveIds: '[]', customObjectives: '[]', selectedKpiIds: '[]', games: [], ...over,
  })

  it('closes a played session through endSessionCore (XP, badges) and deletes an empty auto one', async () => {
    sessions.length = 0
    sessions.push(
      row({ id: 'played', games: [{ gameEndAt: new Date(T0 + 30 * MIN), win: true }] }),
      row({ id: 'empty' }),
      row({ id: 'fresh', date: new Date(T0 + 200 * MIN) }),
    )
    const closed = await autoCloseIdleSessions(T0 + 4 * 3_600_000, false)
    expect(closed).toBe(2)
    expect(endSessionCore).toHaveBeenCalledTimes(1)
    expect((endSessionCore.mock.calls[0] as any[])[0]).toBe('played')
    expect(deleteSessionCore).toHaveBeenCalledWith('empty')
  })

  it('does nothing while a game is running', async () => {
    endSessionCore.mockClear(); deleteSessionCore.mockClear()
    expect(await autoCloseIdleSessions(T0 + 9 * 3_600_000, true)).toBe(0)
    expect(endSessionCore).not.toHaveBeenCalled()
    expect(deleteSessionCore).not.toHaveBeenCalled()
  })
})

describe('the "add an objective" bubble', () => {
  const base = { status: 'active', objectiveId: '', objectiveIds: '[]', customObjectives: '[]', selectedKpiIds: '[]', objectivePromptDismissed: false }
  it('shows for an active session with neither objective nor KPI', () => {
    expect(needsObjectivePrompt(base)).toBe(true)
  })
  it('hides once an objective, a written objective or a KPI exists', () => {
    expect(needsObjectivePrompt({ ...base, objectiveIds: '["vision"]' })).toBe(false)
    expect(needsObjectivePrompt({ ...base, customObjectives: '[{"id":"a","text":"x","source":"player"}]' })).toBe(false)
    expect(needsObjectivePrompt({ ...base, selectedKpiIds: '["cs"]' })).toBe(false)
  })
  it('hides once dismissed, and for a session that is not active', () => {
    expect(needsObjectivePrompt({ ...base, objectivePromptDismissed: true })).toBe(false)
    expect(needsObjectivePrompt({ ...base, status: 'completed' })).toBe(false)
  })
})
