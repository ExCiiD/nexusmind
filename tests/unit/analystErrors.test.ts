import { describe, it, expect } from 'vitest'
import { analystErrorText, isMissingTableError } from '../../src/components/analyst/analystErrors'

// #40: before the production migration, the analyst tables are missing; the screens must say so plainly.
const t = ((key: string, o?: { count?: number }) => (o?.count != null ? `${key}:${o.count}` : key)) as never

describe('isMissingTableError', () => {
  it('recognises PostgREST and Postgres "table missing" errors', () => {
    expect(isMissingTableError({ code: 'PGRST205', message: 'Could not find the table \'public.draft_log\' in the schema cache' })).toBe(true)
    expect(isMissingTableError({ code: '42P01', message: 'relation "opponent_dossiers" does not exist' })).toBe(true)
    expect(isMissingTableError(new Error('list drafts: relation "draft_log" does not exist'))).toBe(true)
    expect(isMissingTableError(new Error('Error invoking remote method \'analyst:draft-log-list\': Error: Could not find the table'))).toBe(true)
  })
  it('leaves other errors alone', () => {
    expect(isMissingTableError(new Error('FORBIDDEN'))).toBe(false)
    expect(isMissingTableError(null)).toBe(false)
  })
})

describe('analystErrorText', () => {
  it('missing table, Riot rate limit, else the message', () => {
    expect(analystErrorText({ code: '42P01', message: 'x' }, t)).toBe('analyst.common.notDeployed')
    expect(analystErrorText(new Error('RIOT_RATE_LIMITED: too many Riot requests right now. Try again in about 40 seconds.'), t)).toBe('riotErrors.rateLimited:40')
    expect(analystErrorText(new Error('Network down'), t)).toBe('Network down')
  })
})
