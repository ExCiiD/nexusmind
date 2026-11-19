import type { SupabaseClient } from '@supabase/supabase-js'
import {
  redeemGuildLinkCode, redeemUserLinkCode, resolveGuild, resolveDiscordUser, setNotifyChannel,
  setAvailabilityExceptionAs, clearAvailabilityExceptionAs, getMyRosterRole, findRoleReplacements,
  getGroupMemberRole, getGroupMemberRoles, canManageDiscordServer, isChannelStaffRole,
} from '../../../src/lib/discordBotCore'
import { listEvents, listAvailabilityRules, listAvailabilityExceptions, findCommonAvailability } from '../../../src/lib/calendarCore'
import { listScrimsForGroup } from '../../../src/lib/scrimsCore'
import { getSharedTeam, getGroupRosterUserIds } from '../../../src/lib/teamCore'
import { buildOpggUrl } from '../../../src/lib/opgg'
import { ephemeralReply, publicReply } from './discordApi'

/** Minimal slice of a Discord Interaction payload — only what the handlers below read. */
export interface Interaction {
  guild_id?: string
  channel_id?: string
  /** `permissions`: the member's resolved permissions in this channel, as a decimal bit string. */
  member?: { user?: { id: string }; permissions?: string }
  user?: { id: string }
  data?: { name: string; options?: InteractionOption[] }
}
interface InteractionOption { name: string; value?: string; options?: InteractionOption[] }

const userIdOf = (i: Interaction): string | null => i.member?.user?.id ?? i.user?.id ?? null
const optValue = (options: InteractionOption[] | undefined, name: string): string | undefined =>
  options?.find((o) => o.name === name)?.value

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const fmtDate = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }) + ' UTC'

export async function handleLinkTeam(i: Interaction, sb: SupabaseClient) {
  if (!i.guild_id) return ephemeralReply('Run this inside a server, not a DM.')
  // S19-03 review: linking the server is for its admins.
  if (!canManageDiscordServer(i.member?.permissions)) {
    return ephemeralReply('Only server admins (Manage Server) can link this server to a team.')
  }
  const code = optValue(i.data?.options, 'code')?.trim().toUpperCase()
  if (!code) return ephemeralReply('Missing code.')
  let groupId: string | null
  try {
    groupId = await redeemGuildLinkCode(sb, code, i.guild_id)
  } catch (err) {
    if ((err as Error).message === 'GUILD_LINKED_ELSEWHERE') {
      return ephemeralReply('This server is already linked to another Ascend team, so it was not changed.')
    }
    throw err
  }
  if (!groupId) return ephemeralReply("That code is invalid or expired — generate a new one in the app's Account page.")
  return ephemeralReply('✅ This server is now linked to your Ascend team. Run **/set-channel** in the channel where you want reminders posted.')
}

export async function handleLinkMe(i: Interaction, sb: SupabaseClient) {
  const discordUserId = userIdOf(i)
  if (!discordUserId) return ephemeralReply('Could not read your Discord user id.')
  const code = optValue(i.data?.options, 'code')?.trim().toUpperCase()
  if (!code) return ephemeralReply('Missing code.')
  const userId = await redeemUserLinkCode(sb, code, discordUserId)
  if (!userId) return ephemeralReply("That code is invalid or expired — generate a new one in the app's Account page.")
  return ephemeralReply('✅ Your Discord account is now linked to your Ascend account.')
}

export async function handleSetChannel(i: Interaction, sb: SupabaseClient) {
  if (!i.guild_id || !i.channel_id) return ephemeralReply('Run this inside a server channel.')
  const link = await resolveGuild(sb, i.guild_id)
  if (!link) return ephemeralReply('This server isn\'t linked yet — run **/link-team** first.')
  // S19-03: redirecting the team's reminders is for the server's admins or
  // the group's staff, not any member of the server.
  if (!canManageDiscordServer(i.member?.permissions)) {
    const discordUserId = userIdOf(i)
    const userId = discordUserId ? await resolveDiscordUser(sb, discordUserId) : null
    // #39: a player who is also manager or coach counts.
    const roles = userId ? await getGroupMemberRoles(sb, link.groupId, userId) : null
    if (!isChannelStaffRole(roles)) {
      return ephemeralReply('Only server admins (Manage Server) or the team\'s staff can choose the reminder channel.')
    }
  }
  await setNotifyChannel(sb, i.guild_id, i.channel_id)
  return publicReply('✅ Reminders and availability alerts will be posted in this channel from now on.')
}

export async function handleCalendar(i: Interaction, sb: SupabaseClient) {
  if (!i.guild_id) return ephemeralReply('Run this inside a server.')
  const link = await resolveGuild(sb, i.guild_id)
  if (!link) return ephemeralReply('This server isn\'t linked — ask staff to run **/link-team**.')
  const now = new Date()
  const horizon = new Date(now.getTime() + 14 * 86_400_000)
  const [events, scrims] = await Promise.all([
    listEvents(sb, link.groupId, now.toISOString(), horizon.toISOString()),
    listScrimsForGroup(sb, link.groupId),
  ])
  const upcomingScrims = scrims.filter((s) => {
    const t = Date.parse(s.scheduledAt)
    return t >= now.getTime() && t <= horizon.getTime()
  })
  const lines: string[] = []
  for (const e of events) lines.push(`📅 **${fmtDate(e.startsAt)}** — ${e.title} _(${e.kind.replace('_', ' ')})_`)
  for (const s of upcomingScrims) lines.push(`⚔️ **${fmtDate(s.scheduledAt)}** — Scrim${s.opponent ? ` vs ${s.opponent}` : ''}${s.boFormat ? ` (${s.boFormat.toUpperCase()})` : ''}`)
  if (lines.length === 0) return publicReply('Nothing on the calendar in the next 14 days.')
  lines.sort()
  return publicReply(`**Next 14 days:**\n${lines.join('\n')}`)
}

export async function handleScrims(i: Interaction, sb: SupabaseClient) {
  if (!i.guild_id) return ephemeralReply('Run this inside a server.')
  const link = await resolveGuild(sb, i.guild_id)
  if (!link) return ephemeralReply('This server isn\'t linked — ask staff to run **/link-team**.')
  const now = Date.now()
  const scrims = (await listScrimsForGroup(sb, link.groupId))
    .filter((s) => Date.parse(s.scheduledAt) >= now)
    .sort((a, b) => Date.parse(a.scheduledAt) - Date.parse(b.scheduledAt))
    .slice(0, 5)
  if (scrims.length === 0) return publicReply('No upcoming scrims.')

  // Roster and scouted opponents only: no pools, no drafts.
  const shared = await getSharedTeam(sb, link.groupId, { pools: false, drafts: false })
  const blocks: string[] = []
  for (const s of scrims) {
    const parts = [`⚔️ **${fmtDate(s.scheduledAt)}**${s.opponent ? ` vs ${s.opponent}` : ''}${s.boFormat ? ` — ${s.boFormat.toUpperCase()}` : ''}`]
    const scouted = shared.scouting.find((sc) => sc.id === s.opponentScoutingId)
    if (scouted) {
      const links = scouted.roster
        .map((m) => ({ role: m.role, url: buildOpggUrl(m.ign, m.tagLine, m.region) }))
        .filter((r) => r.url)
        .map((r) => `${r.role}: [OP.GG](${r.url})`)
      if (links.length > 0) parts.push(`   Opponent (${scouted.name}): ${links.join(' · ')}`)
    }
    const myRoles = shared.roster.map((m) => `${m.role}: ${m.displayName}`)
    if (myRoles.length > 0) parts.push(`   Our lineup: ${myRoles.join(' · ')}`)
    blocks.push(parts.join('\n'))
  }
  return publicReply(blocks.join('\n\n'))
}

export async function handleCommonAvailability(i: Interaction, sb: SupabaseClient) {
  if (!i.guild_id) return ephemeralReply('Run this inside a server.')
  const link = await resolveGuild(sb, i.guild_id)
  if (!link) return ephemeralReply('This server isn\'t linked — ask staff to run **/link-team**.')
  const starterUserIds = await getGroupRosterUserIds(sb, link.groupId)
  if (starterUserIds.length < 2) return publicReply('Not enough linked roster members to compare availability.')

  const today = new Date().toISOString().slice(0, 10)
  const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10)
  const [rules, exceptions] = await Promise.all([
    listAvailabilityRules(sb, link.groupId),
    listAvailabilityExceptions(sb, link.groupId, today, weekAhead),
  ])
  const windows = findCommonAvailability(rules, exceptions, starterUserIds, today)
  if (windows.length === 0) return publicReply('No common free windows found for the whole roster in the next 7 days.')
  const lines = windows.slice(0, 10).map((w) => `🟢 **${w.date}** ${w.startTime}–${w.endTime}`)
  return publicReply(`**Common availability (all ${starterUserIds.length} linked roster members):**\n${lines.join('\n')}`)
}

export async function handleAvailability(i: Interaction, sb: SupabaseClient) {
  const sub = i.data?.options?.[0]
  if (!sub) return ephemeralReply('Missing subcommand.')
  if (!i.guild_id) return ephemeralReply('Run this inside a server.')
  const discordUserId = userIdOf(i)
  if (!discordUserId) return ephemeralReply('Could not read your Discord user id.')
  const userId = await resolveDiscordUser(sb, discordUserId)
  if (!userId) return ephemeralReply('Link your account first with **/link-me**.')
  const link = await resolveGuild(sb, i.guild_id)
  if (!link) return ephemeralReply('This server isn\'t linked — ask staff to run **/link-team**.')
  // S19-03: written with the service role (no RLS): only the group's own
  // members may mark themselves away in its planning.
  if (!(await getGroupMemberRole(sb, link.groupId, userId))) {
    return ephemeralReply('You are not a member of the team linked to this server.')
  }

  const date = optValue(sub.options, 'date')
  if (!date || !DATE_RE.test(date)) return ephemeralReply('Give a date as YYYY-MM-DD.')

  if (sub.name === 'back') {
    await clearAvailabilityExceptionAs(sb, link.groupId, userId, date)
    return ephemeralReply(`✅ Cleared your "away" marking for ${date}.`)
  }

  if (sub.name === 'away') {
    const endDateRaw = optValue(sub.options, 'end_date')
    const endDate = endDateRaw && DATE_RE.test(endDateRaw) ? endDateRaw : date
    const note = optValue(sub.options, 'note') ?? null
    const dates = enumerateDates(date, endDate).slice(0, 31) // sanity cap
    for (const d of dates) await setAvailabilityExceptionAs(sb, link.groupId, userId, { date: d, available: false, note })

    // "si absence sur un scrim prévu, chercher un remplaçant"
    const scrims = (await listScrimsForGroup(sb, link.groupId)).filter((s) => {
      const d = s.scheduledAt.slice(0, 10)
      return dates.includes(d)
    })
    if (scrims.length === 0) return ephemeralReply(`✅ Marked you away ${date}${endDate !== date ? ` → ${endDate}` : ''}.`)

    const role = await getMyRosterRole(sb, link.groupId, userId)
    const lines = [`✅ Marked you away ${date}${endDate !== date ? ` → ${endDate}` : ''}.`, '', '⚠️ This clashes with:']
    for (const s of scrims) {
      lines.push(`- ${fmtDate(s.scheduledAt)}${s.opponent ? ` vs ${s.opponent}` : ''}`)
      if (role) {
        const subs = await findRoleReplacements(sb, link.groupId, role, s.scheduledAt.slice(0, 10), userId)
        lines.push(subs.length > 0
          ? `  Possible sub (${role}): ${subs.map((c) => c.displayName).join(', ')}`
          : `  No other ${role} on the roster is free that day.`)
      }
    }
    return ephemeralReply(lines.join('\n'))
  }

  return ephemeralReply('Unknown subcommand.')
}

function enumerateDates(from: string, to: string): string[] {
  const out: string[] = []
  const d = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (d.getTime() <= end.getTime()) {
    out.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return out
}
