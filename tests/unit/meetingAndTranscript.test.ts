import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { getPath: () => '.', isPackaged: false } }))
vi.mock('../../electron/main/recorder', () => ({ getFfmpegBinaryPath: () => null }))

import { joinTranscript } from '../../electron/main/transcription'
import { meetingPeople } from '@/components/TeamSession/MeetingSetupCard'

describe('joinTranscript', () => {
  it('puts one Whisper segment per line and drops empty ones', () => {
    expect(joinTranscript({ text: 'a b', chunks: [{ text: ' Bonjour ' }, { text: '' }, { text: 'on parle des waves' }] }))
      .toBe('Bonjour\non parle des waves')
  })
  it('falls back to the plain text, and joins several results', () => {
    expect(joinTranscript({ text: '  Salut  ' })).toBe('Salut')
    expect(joinTranscript([{ text: 'un' }, { chunks: [{ text: 'deux' }] }])).toBe('un\ndeux')
    expect(joinTranscript(null)).toBe('')
  })
})

describe('meetingPeople', () => {
  const members = [
    { userId: 'c', role: 'coach' }, { userId: 'p1', role: 'player' }, { userId: 'p2', role: 'player' },
  ] as never
  const ev = (attendeeScope: string, attendeeUserIds: string[] = []) => ({ attendeeScope, attendeeUserIds }) as never
  it('uses the attendee list when there is one', () => {
    expect(meetingPeople(ev('custom', ['p2']), members)).toEqual(['p2'])
  })
  it('resolves the quick-select scopes', () => {
    expect(meetingPeople(ev('all_players'), members)).toEqual(['p1', 'p2'])
    expect(meetingPeople(ev('all_staff'), members)).toEqual(['c'])
    expect(meetingPeople(ev('whole_team'), members)).toEqual(['c', 'p1', 'p2'])
  })
})
