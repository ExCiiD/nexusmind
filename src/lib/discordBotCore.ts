import type { SupabaseClient } from '@supabase/supabase-js'
import type { DiscordGuildLink, DiscordUserLink } from './discord'
import { generateLinkCode } from './discord'
import type { NewAvailabilityExceptionInput } from './calendar'
import type { Announcement } from './announcements'
import { fail } from './supabaseErrors'

/**
 * Discord bot integration (E11), same pure-function-over-a-client pattern
 * as teamCore.ts/calendarCore.ts. Two very different callers:
 *
 *   - The APP (desktop/web), with the signed-in user's own session —
 *     generating/reading link codes and link status. RLS enforces "only
 *     your own codes/links, only your own group's staff-only codes".
 *   - The BOT (Cloudflare Worker), with the Supabase SERVICE ROLE key —
 *     no per-request user session exists (a Discord interaction carries
 *     no Ascend auth), so RLS is bypassed entirely and this file's bot-
 *     facing functions take an explicit userId/groupId and must get the
 *     "who may act as whom" check right themselves: every bot function
 *     here either (a) only ever reads/writes rows already scoped to a
 *     resolved discord_user_links/discord_guild_links row, or (b) passes
 *     the resolved id explicitly in the write payload (these tables'
 *     *_id columns default to auth.uid(), which is null for the service
 *     role — omitting it would violate a not-null constraint, not
 *     silently default to someone else).
 */

const CODE_TTL_MIN_GUILD = 15
const CODE_TTL_MIN_USER = 10

// ── App-side: generate codes, read link status (user's own session) ───────

/** Staff generates this in-app, then redeems it with "/link-team <code>"
 *  in the target Discord server. RLS (discord_guild_link_codes_staff)
 *  rejects this for a non-staff caller or someone else's group. */
export async function generateGuildLinkCode(sb: SupabaseClient, groupId: string): Promise<{ code: string; expiresAt: string }> {
  const code = generateLinkCode()
  const expiresAt = new Date(Date.now() + CODE_TTL_MIN_GUILD * 60_000).toISOString()
  const { error } = await sb.from('discord_guild_link_codes').insert({ code, group_id: groupId, expires_at: expiresAt })
  if (error) fail(error, 'generate guild link code')
  return { code, expiresAt }
}

/** Any user generates this in-app for themselves, then redeems it with
 *  "/link-me <code>". RLS (discord_user_link_codes_own) forces user_id to
 *  the caller's own — no groupId needed, a Discord identity links to the
 *  Ascend ACCOUNT, not to one group. */
export async function generateUserLinkCode(sb: SupabaseClient): Promise<{ code: string; expiresAt: string }> {
  const code = generateLinkCode()
  const expiresAt = new Date(Date.now() + CODE_TTL_MIN_USER * 60_000).toISOString()
  const { error } = await sb.from('discord_user_link_codes').insert({ code, expires_at: expiresAt })
  if (error) fail(error, 'generate user link code')
  return { code, expiresAt }
}

export async function getGroupDiscordLink(sb: SupabaseClient, groupId: string): Promise<DiscordGuildLink | null> {
  const { data, error } = await sb.from('discord_guild_links')
    .select('guild_id, group_id, notify_channel_id, linked_by, linked_at').eq('group_id', groupId).maybeSingle()
  if (error) fail(error, 'read guild link')
  if (!data) return null
  return { guildId: data.guild_id, groupId: data.group_id, notifyChannelId: data.notify_channel_id, linkedBy: data.linked_by, linkedAt: data.linked_at }
}

export async function getMyDiscordLink(sb: SupabaseClient, userId: string): Promise<DiscordUserLink | null> {
  const { data, error } = await sb.from('discord_user_links').select('discord_user_id, user_id, linked_at').eq('user_id', userId).maybeSingle()
  if (error) fail(error, 'read user link')
  if (!data) return null
  return { discordUserId: data.discord_user_id, userId: data.user_id, linkedAt: data.linked_at }
}

export async function unlinkMyDiscord(sb: SupabaseClient, userId: string): Promise<void> {
  const { error } = await sb.from('discord_user_links').delete().eq('user_id', userId)
  if (error) fail(error, 'unlink discord')
}

// ── Bot-side: redeem codes, resolve identities (service-role client) ──────

/** Redeems a "/link-team" code: consumes it (one-time use) and upserts the
 *  guild↔group link. Returns the linked groupId, or null if the code is
 *  missing/expired. Throws GUILD_LINKED_ELSEWHERE when the server is
 *  already linked to another group: a code from any group must not take
 *  over a team's server (S19-03 review). Re-linking the same group is fine. */
export async function redeemGuildLinkCode(sb: SupabaseClient, code: string, guildId: string): Promise<string | null> {
  const { data: row, error } = await sb.from('discord_guild_link_codes').select('group_id, expires_at, created_by').eq('code', code).maybeSingle()
  if (error) fail(error, 'redeem guild code')
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return null
  const existing = await resolveGuild(sb, guildId)
  if (existing && existing.groupId !== row.group_id) throw new Error('GUILD_LINKED_ELSEWHERE')
  await sb.from('discord_guild_link_codes').delete().eq('code', code)
  const { error: upsertErr } = await sb.from('discord_guild_links')
    .upsert({ guild_id: guildId, group_id: row.group_id, linked_by: row.created_by }, { onConflict: 'guild_id' })
  if (upsertErr) fail(upsertErr, 'link guild')
  return row.group_id as string
}

/** Redeems a "/link-me" code the same way, for a Discord USER identity. */
export async function redeemUserLinkCode(sb: SupabaseClient, code: string, discordUserId: string): Promise<string | null> {
  const { data: row, error } = await sb.from('discord_user_link_codes').select('user_id, expires_at').eq('code', code).maybeSingle()
  if (error) fail(error, 'redeem user code')
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return null
  await sb.from('discord_user_link_codes').delete().eq('code', code)
  const { error: upsertErr } = await sb.from('discord_user_links')
    .upsert({ discord_user_id: discordUserId, user_id: row.user_id }, { onConflict: 'discord_user_id' })
  if (upsertErr) fail(upsertErr, 'link user')
  return row.user_id as string
}

export async function resolveGuild(sb: SupabaseClient, guildId: string): Promise<{ groupId: string; notifyChannelId: string | null } | null> {
  const { data, error } = await sb.from('discord_guild_links').select('group_id, notify_channel_id').eq('guild_id', guildId).maybeSingle()
  if (error) fail(error, 'resolve guild')
  return data ? { groupId: data.group_id, notifyChannelId: data.notify_channel_id } : null
}

export async function resolveDiscordUser(sb: SupabaseClient, discordUserId: string): Promise<string | null> {
  const { data, error } = await sb.from('discord_user_links').select('user_id').eq('discord_user_id', discordUserId).maybeSingle()
  if (error) fail(error, 'resolve discord user')
  return data?.user_id ?? null
}

/**
 * S19-03: the bot writes with the service role (no RLS), so "is this
 * Ascend user in the group the server is linked to?" is checked here.
 * Returns their role in the group, or null when they are not a member.
 */
/**
 * #39: a member's effective roles (main role plus staff_roles), null when not a member. Before the
 * member_staff_roles migration the column is missing: the main role alone.
 */
export async function getGroupMemberRoles(sb: SupabaseClient, groupId: string, userId: string): Promise<string[] | null> {
  let res = await sb.from('group_members').select('role, staff_roles').eq('group_id', groupId).eq('user_id', userId).maybeSingle()
  if (res.error?.code === '42703') res = await sb.from('group_members').select('role').eq('group_id', groupId).eq('user_id', userId).maybeSingle()
  if (res.error) fail(res.error, 'read group membership')
  const row = res.data as { role?: string; staff_roles?: string[] | null } | null
  if (!row?.role) return null
  return [row.role, ...(row.staff_roles ?? [])]
}

export async function getGroupMemberRole(sb: SupabaseClient, groupId: string, userId: string): Promise<string | null> {
  const { data, error } = await sb.from('group_members').select('role').eq('group_id', groupId).eq('user_id', userId).maybeSingle()
  if (error) fail(error, 'read group membership')
  return (data as { role?: string } | null)?.role ?? null
}

/** Discord permission bits (https://discord.com/developers/docs/topics/permissions). */
export const DISCORD_ADMINISTRATOR = 1n << 3n
export const DISCORD_MANAGE_GUILD = 1n << 5n

/** True when the interaction member may manage the server (Manage Server or Administrator). */
export function canManageDiscordServer(permissions: string | undefined | null): boolean {
  if (!permissions || !/^\d+$/.test(permissions)) return false
  const bits = BigInt(permissions)
  return (bits & DISCORD_ADMINISTRATOR) !== 0n || (bits & DISCORD_MANAGE_GUILD) !== 0n
}

/**
 * The group roles that manage the team's Discord link: point the bot at a channel (/set-channel, without Discord
 * admin rights) and unlink the server (#34). One list on both sides: the server's private.is_discord_manager
 * (supabase/migrations/20261119230000_discord_unlink_guild.sql) uses the same roles, and a test keeps them equal.
 */
export const DISCORD_MANAGER_ROLES = ['owner', 'coach', 'manager'] as const

/** A role, or a member's effective roles (#39): true when one of them manages the Discord server. */
export function isChannelStaffRole(role: string | readonly string[] | null): boolean {
  if (role === null) return false
  const roles = typeof role === 'string' ? [role] : role
  return roles.some((r) => (DISCORD_MANAGER_ROLES as readonly string[]).includes(r))
}

export async function setNotifyChannel(sb: SupabaseClient, guildId: string, channelId: string): Promise<void> {
  const { error } = await sb.from('discord_guild_links').update({ notify_channel_id: channelId }).eq('guild_id', guildId)
  if (error) fail(error, 'set notify channel')
}

/** All guilds with a notify channel configured — the reminder cron's
 *  iteration list. */
export async function listGuildsWithNotifyChannel(sb: SupabaseClient): Promise<DiscordGuildLink[]> {
  const { data, error } = await sb.from('discord_guild_links')
    .select('guild_id, group_id, notify_channel_id, linked_by, linked_at').not('notify_channel_id', 'is', null)
  if (error) fail(error, 'list guilds')
  return (data ?? []).map((r) => ({ guildId: r.guild_id, groupId: r.group_id, notifyChannelId: r.notify_channel_id, linkedBy: r.linked_by, linkedAt: r.linked_at }))
}

/**
 * `calendarCore.setAvailabilityException` relies on `user_id`'s DB default
 * (auth.uid()) — null for the service role, which would violate the
 * not-null constraint. This explicit-userId variant is the bot-safe
 * equivalent; same upsert, just with user_id in the payload.
 */
export async function setAvailabilityExceptionAs(sb: SupabaseClient, groupId: string, userId: string, input: NewAvailabilityExceptionInput): Promise<void> {
  const { error } = await sb.from('availability_exceptions').upsert({
    group_id: groupId, user_id: userId, date: input.date, available: input.available,
    start_time: input.startTime ?? null, end_time: input.endTime ?? null, note: input.note ?? null,
  }, { onConflict: 'group_id,user_id,date' })
  if (error) fail(error, 'set availability')
}

export type RelayedNotificationType =
  | 'task_assigned' | 'objective_overdue' | 'mention'
  | 'review_pending' | 'scrim_low_availability' | 'scrim_availability_missing'
  | 'dev_plan_period_ending' | 'calendar_event_request'

export interface TeamNotification {
  id: string
  type: RelayedNotificationType
  userId: string
  data: Record<string, unknown>
  createdAt: string
}

const RELAYED_TYPES: RelayedNotificationType[] = [
  'task_assigned', 'objective_overdue', 'mention',
  'review_pending', 'scrim_low_availability', 'scrim_availability_missing',
  'dev_plan_period_ending', 'calendar_event_request',
]

/**
 * Team-relevant in-app notifications from the last `sinceIso` worth of
 * history, for the cron to relay into the linked Discord channel. Scoped to
 * types that are already routine, team-visible information in-app (a task
 * was assigned, an objective/review is overdue, someone was @mentioned, a
 * scrim needs more confirmations — E2 v2's C3/C4 alerts) — NOT
 * `wellbeing_alert`: that one is opt-in-shared with staff only (E6,
 * `group_sharing.share_wellbeing`) and broadcasting a player's declining
 * mood to a Discord channel (which may have a wider audience than the
 * staff who can see it in-app) would exceed that consent. Stays in-app.
 */
export async function listRecentTeamNotifications(sb: SupabaseClient, groupId: string, sinceIso: string): Promise<TeamNotification[]> {
  const { data, error } = await sb.from('notifications')
    .select('id, type, user_id, data, created_at')
    .in('type', RELAYED_TYPES)
    .filter('data->>groupId', 'eq', groupId)
    .gte('created_at', sinceIso)
  if (error) fail(error, 'list team notifications')
  return (data ?? []).map((r) => ({ id: r.id, type: r.type, userId: r.user_id, data: r.data as Record<string, unknown>, createdAt: r.created_at }))
}

// ── Direct messages (18 November 2026) ─────────────────────────────────────

/** In-app notifications the bot also sends as a Discord direct message to
 *  their recipient: a player who can't come to an event (or who finally
 *  can), for the management — see respond_to_calendar_event. */
export const DIRECT_MESSAGE_TYPES = ['event_declined', 'event_confirmed'] as const
export type DirectMessageType = (typeof DIRECT_MESSAGE_TYPES)[number]

export interface DirectNotification {
  id: string
  type: DirectMessageType
  userId: string
  data: Record<string, unknown>
  createdAt: string
  /** The recipient's Discord account (/link-me), null when they never linked one. */
  discordUserId: string | null
}

/** Direct-message notifications since `sinceIso` the bot hasn't handled yet
 *  (discord_dm_sent), with each recipient's linked Discord account. */
export async function listPendingDirectNotifications(sb: SupabaseClient, sinceIso: string): Promise<DirectNotification[]> {
  const { data, error } = await sb.from('notifications')
    .select('id, type, user_id, data, created_at')
    .in('type', [...DIRECT_MESSAGE_TYPES])
    .gte('created_at', sinceIso)
    .order('created_at')
  if (error) fail(error, 'list direct notifications')
  const rows = data ?? []
  if (rows.length === 0) return []
  const [sent, links] = await Promise.all([
    sb.from('discord_dm_sent').select('notification_id').in('notification_id', rows.map((r) => r.id)),
    sb.from('discord_user_links').select('user_id, discord_user_id').in('user_id', [...new Set(rows.map((r) => r.user_id as string))]),
  ])
  if (sent.error) fail(sent.error, 'list sent direct messages')
  if (links.error) fail(links.error, 'list discord links')
  const done = new Set((sent.data ?? []).map((r) => r.notification_id as string))
  const discordOf = new Map((links.data ?? []).map((r) => [r.user_id as string, r.discord_user_id as string]))
  return rows
    .filter((r) => !done.has(r.id))
    .map((r) => ({
      id: r.id, type: r.type as DirectMessageType, userId: r.user_id, data: r.data as Record<string, unknown>,
      createdAt: r.created_at, discordUserId: discordOf.get(r.user_id) ?? null,
    }))
}

/** Claims a notification for its direct message: false when a previous run
 *  already did (the primary key does the work, as in markNotifiedOnce). */
export async function markDirectMessageSent(sb: SupabaseClient, notificationId: string): Promise<boolean> {
  const { error } = await sb.from('discord_dm_sent').insert({ notification_id: notificationId })
  if (!error) return true
  if (error.code === '23505') return false
  fail(error, 'mark direct message sent')
}

/** The direct message itself — English and UTC like the bot's other posts. */
export function directMessageText(n: Pick<DirectNotification, 'type' | 'data'>): string {
  const name = String(n.data.playerName ?? '?')
  const title = String(n.data.eventTitle ?? '')
  const at = typeof n.data.scheduledAt === 'string' ? new Date(n.data.scheduledAt) : null
  const when = at && !Number.isNaN(at.getTime())
    ? ` — ${at.toLocaleString('en-US', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`
    : ''
  if (n.type === 'event_declined') {
    const reason = typeof n.data.note === 'string' && n.data.note ? `\nReason: ${n.data.note}` : ''
    return `❌ **${name}** can't make it to "${title}"${when}.${reason}`
  }
  return `✅ **${name}** will be at "${title}" after all${when}.`
}

/**
 * New announcements for a group since `sinceIso` (Phase 2, Planning
 * rework). Unlike `listRecentTeamNotifications`, announcements aren't
 * per-recipient rows in `notifications` — they're broadcast, team-wide —
 * so this queries `announcements` directly, the same way the cron already
 * queries `calendar_events`/`scrims` rather than going through a
 * per-user notification. Same ~15-min cadence as everything else this
 * cron relays; "instant" in the product sense refers to in-app/web
 * publishing (no scheduling, a persistent bubble), not Discord delivery.
 */
export async function listRecentAnnouncements(sb: SupabaseClient, groupId: string, sinceIso: string): Promise<Announcement[]> {
  const { data, error } = await sb.from('announcements')
    .select('id, group_id, title, body, pinned, created_by, created_at, updated_at')
    .eq('group_id', groupId).gte('created_at', sinceIso)
  if (error) fail(error, 'list recent announcements')
  return (data ?? []).map((r) => ({
    id: r.id, groupId: r.group_id, title: r.title, body: r.body, pinned: r.pinned,
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at,
  }))
}

/** Bulk display-name lookup for a group's members — used to name the
 *  notified player in a relayed Discord message (the notification payload
 *  itself only carries the ACTOR's name, e.g. who assigned the task, not
 *  the recipient's). */
export async function resolveDisplayNames(sb: SupabaseClient, groupId: string, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map()
  const { data, error } = await sb.from('group_members').select('user_id, display_name').eq('group_id', groupId).in('user_id', userIds)
  if (error) fail(error, 'resolve display names')
  return new Map((data ?? []).map((r) => [r.user_id as string, (r.display_name as string | null) ?? '?']))
}

/**
 * Marks a calendar item as announced, returning false if it was already
 * sent (so the cron can skip it) — the dedupe primary key does the actual
 * work, this just turns the unique-violation into a clean boolean instead
 * of a thrown error the caller has to special-case.
 */
export async function markNotifiedOnce(sb: SupabaseClient, guildId: string, itemType: 'event' | 'scrim' | 'common_availability' | 'notification', itemId: string): Promise<boolean> {
  const { error } = await sb.from('discord_notifications_sent').insert({ guild_id: guildId, item_type: itemType, item_id: itemId })
  if (!error) return true
  if (error.code === '23505') return false // already notified
  fail(error, 'mark notified')
}

/** Reverts "/availability back" to the recurring rule by deleting the
 *  exception row entirely, rather than setting available=true with no
 *  time window (which findCommonAvailability would read as "free all
 *  day", silently widening the player's actual recurring hours). */
export async function clearAvailabilityExceptionAs(sb: SupabaseClient, groupId: string, userId: string, date: string): Promise<void> {
  const { error } = await sb.from('availability_exceptions').delete().eq('group_id', groupId).eq('user_id', userId).eq('date', date)
  if (error) fail(error, 'clear availability')
}

/** This user's role on the group's OWN roster (not a scouted opponent),
 *  or null if they have no roster row — used to find a same-role sub. */
export async function getMyRosterRole(sb: SupabaseClient, groupId: string, userId: string): Promise<string | null> {
  const { data, error } = await sb.from('team_rosters').select('role').eq('group_id', groupId).eq('user_id', userId).is('scouting_id', null).maybeSingle()
  if (error) fail(error, 'read roster role')
  return data?.role ?? null
}

export interface RoleReplacementCandidate {
  rosterId: string
  userId: string
  displayName: string
}

/**
 * Same-role roster members (own team, team_rosters.scouting_id is null)
 * other than `excludeUserId` who are free on `date` — used by "/availability
 * away" to suggest a sub, per the plan's explicit ask ("si absence sur un
 * scrim prévu, chercher un remplaçant"). Only considers roster rows linked
 * to a real signed-in account (user_id set) since availability is tracked
 * per Ascend user, not per roster row.
 */
export async function findRoleReplacements(
  sb: SupabaseClient, groupId: string, role: string, date: string, excludeUserId: string,
): Promise<RoleReplacementCandidate[]> {
  const { data: rosterRows, error } = await sb.from('team_rosters')
    .select('id, user_id, display_name, role').eq('group_id', groupId).is('scouting_id', null).eq('role', role)
  if (error) fail(error, 'list roster for replacement')
  const candidates = (rosterRows ?? []).filter((r) => r.user_id && r.user_id !== excludeUserId) as Array<{ id: string; user_id: string; display_name: string }>
  if (candidates.length === 0) return []

  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  const [{ data: rules, error: rulesErr }, { data: exceptions, error: excErr }] = await Promise.all([
    sb.from('availability_rules').select('user_id, weekday').eq('group_id', groupId).eq('weekday', weekday),
    sb.from('availability_exceptions').select('user_id, available').eq('group_id', groupId).eq('date', date),
  ])
  if (rulesErr) fail(rulesErr, 'list rules for replacement')
  if (excErr) fail(excErr, 'list exceptions for replacement')
  const exceptionByUser = new Map((exceptions ?? []).map((e) => [e.user_id as string, e.available as boolean]))
  const ruleUsers = new Set((rules ?? []).map((r) => r.user_id as string))

  return candidates
    .filter((c) => {
      const exception = exceptionByUser.get(c.user_id)
      if (exception !== undefined) return exception
      return ruleUsers.has(c.user_id)
    })
    .map((c) => ({ rosterId: c.id, userId: c.user_id, displayName: c.display_name }))
}
