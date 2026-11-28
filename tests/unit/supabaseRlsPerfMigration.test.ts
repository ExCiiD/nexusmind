/**
 * Health check of 28/11/2026: the generated Supabase performance migration keeps its promises
 * (scripts/gen-rls-perf-migration.mjs, docs/audits/SUPABASE_RLS_PERF_2026-11-28.md).
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const sql = readFileSync(resolve(__dirname, '../../supabase/migrations/20261128120000_rls_performance.sql'), 'utf8')
const rollback = readFileSync(resolve(__dirname, '../../supabase/rollback/20261128120000_rollback.sql'), 'utf8')
const code = sql.split('\n').filter((l) => !l.trimStart().startsWith('--')).join('\n')
const statements = code.split(';').map((s) => s.trim()).filter(Boolean)

// The 45 multiple_permissive_policies and 18 auth_rls_initplan findings of 28/11 (policy names).
const OVERLAPPING = [
  'announcements_read', 'announcements_write', 'availability_exceptions_read', 'availability_exceptions_write',
  'availability_rules_read', 'availability_rules_write', 'calendar_event_attendees_read', 'calendar_event_attendees_write',
  'calendar_events_read', 'calendar_events_write', 'dev_plan_axes_read', 'dev_plan_axes_write_staff',
  'dev_plan_checkins_read', 'dev_plan_checkins_write_staff', 'dev_plan_progress_read', 'dev_plan_progress_write_own',
  'dev_plans_read', 'dev_plans_write_staff', 'discord_guild_links_read', 'discord_guild_links_write_staff',
  'group_fundamentals_read', 'group_fundamentals_write', 'sharing_own_rows', 'sharing_staff_read',
  'micro_verdicts_delete_orphaned', 'micro_verdicts_delete_own', 'availability_read_members', 'availability_write_own',
  'staff_notes_read_staff', 'staff_notes_write_staff', 'sync_records_read_shared', 'sync_records_select_own',
  'tasks_read', 'tasks_write_staff', 'tasks_update_own_assignment', 'team_codex_read', 'team_codex_write_staff',
  'team_custom_games_read', 'team_custom_games_write_staff', 'team_drafts_read', 'team_drafts_write_staff',
  'team_pool_read', 'team_pool_write', 'team_rosters_read', 'team_rosters_write_staff', 'team_scouting_read',
  'team_scouting_write_staff', 'team_session_attendance_read', 'team_session_attendance_write',
  'team_session_drafts_read', 'team_session_drafts_write', 'team_session_objectives_read', 'team_session_objectives_write',
  'team_session_player_objectives_read', 'team_session_player_objectives_write', 'team_session_prep_notes_read',
  'team_session_prep_notes_write', 'team_session_reviews_read', 'team_session_reviews_write', 'vod_assignments_read',
  'vod_assignments_write_staff', 'vod_assignments_update_own_status', 'vod_sessions_read', 'vod_sessions_write_staff',
]
const INITPLAN = [
  'team_discussion_insert', 'team_discussion_delete', 'calendar_event_requests_insert', 'calendar_event_requests_read',
  'calendar_event_requests_delete', 'announcement_dismissals_own', 'team_session_feedback_write', 'team_session_feedback_update',
  'micro_answers_read', 'micro_answers_insert_own', 'micro_answers_update_own', 'micro_answers_delete_own',
  'micro_verdicts_read', 'micro_verdicts_write_staff', 'micro_verdicts_update_own',
]

describe('20261128120000_rls_performance', () => {
  it('drops every overlapping policy and its rollback recreates it', () => {
    for (const n of OVERLAPPING) {
      expect(code, n).toMatch(new RegExp(`drop policy if exists ${n} on `))
      expect(rollback, n).toMatch(new RegExp(`create policy ${n} on `))
    }
  })

  it('leaves at most one permissive policy per table and command among the new ones', () => {
    const created = statements.filter((s) => s.startsWith('create policy'))
      .map((s) => s.match(/^create policy \w+ on public\.(\w+) for (\w+) to (\w+)/)!)
    const keys = created.map((m) => `${m[1]}:${m[2]}`)
    expect(new Set(keys).size).toBe(keys.length)
    // Merged policies are for signed-in users only, never anon or public.
    expect(created.every((m) => m[3] === 'authenticated')).toBe(true)
  })

  it('rewrites the initplan policies in place, and leaves no bare auth.uid()', () => {
    for (const n of INITPLAN) expect(code, n).toMatch(new RegExp(`alter policy ${n} on `))
    expect(code.replace(/\(select auth\.uid\(\)\)/g, '')).not.toMatch(/auth\.uid\(\)/)
  })

  it('creates the 70 foreign key indexes and drops no index', () => {
    expect(statements.filter((s) => s.startsWith('create index if not exists'))).toHaveLength(70)
    expect(code).not.toMatch(/drop index/)
    expect(rollback.match(/drop index if exists/g)).toHaveLength(70)
  })

  it('Cyber R1: aborts first if any reviewed policy is missing (every dropped or rewritten one is checked)', () => {
    const guardAt = code.indexOf('do $guard$')
    expect(guardAt).toBeGreaterThanOrEqual(0)
    expect(guardAt).toBeLessThan(code.indexOf('drop policy'))
    expect(code).toContain('raise exception')
    const guard = code.slice(guardAt, code.indexOf('$guard$;', guardAt + 10))
    for (const n of [...OVERLAPPING, ...INITPLAN]) expect(guard, n).toContain(`'${n}')`)
    expect(guard.match(/^\s+\('\w+', '\w+'\)/gm)).toHaveLength(79)
  })

  it('Cyber R2: the rollback runs in one transaction', () => {
    const body = rollback.split('\n').filter((l) => l.trim() && !l.trimStart().startsWith('--'))
    expect(body[0]).toBe('begin;')
    expect(body[body.length - 1]).toBe('commit;')
  })

  it('merges by OR only: each merged SELECT keeps the read expression it replaces', () => {
    const select = statements.find((s) => s.startsWith('create policy tasks_select'))!
    expect(select).toContain('(private.group_role(group_id) IS NOT NULL)')
    expect(select).toContain('private.is_group_staff(group_id)')
    const update = statements.find((s) => s.startsWith('create policy tasks_update'))!
    expect(update).toMatch(/using \(\(private\.is_group_staff\(group_id\)\)\s+OR \(\(assignee_id = \(select auth\.uid\(\)\)\)\)\)/)
  })
})
