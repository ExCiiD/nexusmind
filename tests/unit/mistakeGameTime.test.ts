import { describe, expect, it } from 'vitest'
import { END_SCREEN_TOLERANCE_SEC, resolveMistakeGameTime } from '../../electron/main/mistakeWindowCore'

describe('resolveMistakeGameTime', () => {
  it('keeps a time inside the game', () => {
    expect(resolveMistakeGameTime(347, null, null, 930)).toBe(347)
  })

  it('sets a note taken on the end screen to the last second of the game', () => {
    expect(resolveMistakeGameTime(935, null, null, 930)).toBe(930)
    expect(resolveMistakeGameTime(930 + END_SCREEN_TOLERANCE_SEC, null, null, 930)).toBe(930)
  })

  it('still refuses a time well past the end, a negative time, or no time at all', () => {
    expect(() => resolveMistakeGameTime(930 + END_SCREEN_TOLERANCE_SEC + 1, null, null, 930)).toThrow('BAD_GAME_TIME')
    expect(() => resolveMistakeGameTime(-1, null, null, 930)).toThrow('BAD_GAME_TIME')
    expect(() => resolveMistakeGameTime(null, null, null, 930)).toThrow('BAD_GAME_TIME')
  })
})
