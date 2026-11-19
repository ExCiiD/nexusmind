import { describe, expect, it } from 'vitest'
import { parseRiotIdInput, planGroupTeamSync, splitRiotId } from '@/lib/groupTeamSyncCore'

const player = (riotId: string | null, displayName: string | null = null, role = 'player') => ({ role, riotId, displayName })

describe('planGroupTeamSync', () => {
  it('adds every player of an empty team on the free lanes, in order', () => {
    const plan = planGroupTeamSync([player('A#EUW', 'Alpha'), player('B#EUW'), player('Coachy#1', null, 'coach')], [])
    expect(plan.remove).toEqual([])
    expect(plan.add).toEqual([
      { displayName: 'Alpha', ign: 'A', tagLine: 'EUW', role: 'TOP' },
      { displayName: 'B', ign: 'B', tagLine: 'EUW', role: 'JUNGLE' },
    ])
  })

  it('skips members without a Riot account and non-players', () => {
    const plan = planGroupTeamSync([player(null, 'Ghost'), player('S#1', null, 'analyst')], [])
    expect(plan.add).toEqual([])
  })

  it('keeps matching members (case/space-insensitive) and their lanes, removes the rest', () => {
    const plan = planGroupTeamSync(
      [player('Big Name#EUW'), player('New#EUW')],
      [
        { id: 'm1', ign: 'bigname', tagLine: 'euw', role: 'TOP' },
        { id: 'old', ign: 'Jade', tagLine: 'EUW', role: 'MID' },
        { id: 'manual', ign: null, tagLine: null, role: 'ADC' },
      ],
    )
    expect(plan.remove).toEqual(['old', 'manual'])
    expect(plan.add).toEqual([{ displayName: 'New', ign: 'New', tagLine: 'EUW', role: 'JUNGLE' }])
  })

  it('uses the published lane when it is free, else the first free one', () => {
    const lanes: Record<string, string> = { 'a#euw': 'SUPPORT', 'b#euw': 'SUPPORT' }
    const plan = planGroupTeamSync([player('A#EUW'), player('B#EUW')], [], (k) => lanes[k])
    expect(plan.add.map((a) => a.role)).toEqual(['SUPPORT', 'TOP'])
  })

  it('removes a duplicate of the same player', () => {
    const plan = planGroupTeamSync([player('A#EUW')], [
      { id: 'x', ign: 'A', tagLine: 'EUW', role: 'TOP' },
      { id: 'y', ign: 'A', tagLine: 'EUW', role: 'MID' },
    ])
    expect(plan).toEqual({ add: [], remove: ['y'] })
  })
})

describe('Riot ID helpers', () => {
  it('splits at the last #', () => {
    expect(splitRiotId('a#b#EUW')).toEqual(['a#b', 'EUW'])
    expect(splitRiotId('Solo')).toEqual(['Solo', undefined])
  })
  it('validates typed Riot IDs', () => {
    expect(parseRiotIdInput('  ExCiiD#AIGRI ')).toBe('ExCiiD#AIGRI')
    expect(parseRiotIdInput('ExCiiD')).toBeNull()
    expect(parseRiotIdInput('#EUW')).toBeNull()
    expect(parseRiotIdInput('Ab#E')).toBeNull()
  })
})
