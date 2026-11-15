import { verifyDiscordRequest } from './verify'
import { jsonResponse, postChannelMessage } from './discordApi'
import { adminClient } from './supabaseAdmin'
import {
  handleLinkTeam, handleLinkMe, handleSetChannel, handleCalendar, handleScrims, handleCommonAvailability, handleAvailability,
  type Interaction,
} from './handlers'
import { listGuildsWithNotifyChannel, markNotifiedOnce, listRecentTeamNotifications, resolveDisplayNames } from '../../../src/lib/discordBotCore'
import { listEvents, listAvailabilityRules, listAvailabilityExceptions, findCommonAvailability } from '../../../src/lib/calendarCore'
import { listScrimsForGroup } from '../../../src/lib/scrimsCore'
import { getSharedTeam } from '../../../src/lib/teamCore'

export interface Env {
  SUPABASE_URL: string
  SUPABASE_SERVICE_ROLE_KEY: string
  DISCORD_PUBLIC_KEY: string
  DISCORD_BOT_TOKEN: string
}

const InteractionType = { PING: 1, APPLICATION_COMMAND: 2 } as const

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== 'POST') return new Response('ok')

    const rawBody = await req.text()
    const ok = await verifyDiscordRequest(req.headers.get('x-signature-ed25519'), req.headers.get('x-signature-timestamp'), rawBody, env.DISCORD_PUBLIC_KEY)
    if (!ok) return new Response('invalid request signature', { status: 401 })

    const interaction = JSON.parse(rawBody) as Interaction & { type: number }
    if (interaction.type === InteractionType.PING) return jsonResponse({ type: 1 })
    if (interaction.type !== InteractionType.APPLICATION_COMMAND || !interaction.data) return jsonResponse({ type: 4, data: { content: 'Unsupported interaction.' } })

    const sb = adminClient(env)
    try {
      switch (interaction.data.name) {
        case 'link-team': return await handleLinkTeam(interaction, sb)
        case 'link-me': return await handleLinkMe(interaction, sb)
        case 'set-channel': return await handleSetChannel(interaction, sb)
        case 'calendar': return await handleCalendar(interaction, sb)
        case 'scrims': return await handleScrims(interaction, sb)
        case 'common-availability': return await handleCommonAvailability(interaction, sb)
        case 'availability': return await handleAvailability(interaction, sb)
        default: return jsonResponse({ type: 4, data: { content: `Unknown command: ${interaction.data.name}` } })
      }
    } catch (err) {
      console.error('[discord-bot] handler failed', interaction.data.name, (err as Error)?.message)
      return jsonResponse({ type: 4, data: { content: '⚠️ Something went wrong handling that command. Try again shortly.' } })
    }
  },

  /**
   * Every 15 min (wrangler.toml): announces events/scrims starting within
   * 24h and newly-found common-availability windows, once each, to every
   * linked guild's configured channel.
   */
  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const sb = adminClient(env)
    const guilds = await listGuildsWithNotifyChannel(sb)
    const now = new Date()
    const in24h = new Date(now.getTime() + 24 * 3_600_000)
    const weekAhead = new Date(now.getTime() + 7 * 86_400_000)
    const dayAgo = new Date(now.getTime() - 24 * 3_600_000)

    for (const guild of guilds) {
      if (!guild.notifyChannelId) continue
      try {
        const [events, scrims] = await Promise.all([
          listEvents(sb, guild.groupId, now.toISOString(), in24h.toISOString()),
          listScrimsForGroup(sb, guild.groupId),
        ])
        for (const e of events) {
          if (!(await markNotifiedOnce(sb, guild.guildId, 'event', e.id))) continue
          await postChannelMessage(env.DISCORD_BOT_TOKEN, guild.notifyChannelId,
            `📅 **Starting soon:** ${e.title} — ${new Date(e.startsAt).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`)
        }
        for (const s of scrims) {
          const t = Date.parse(s.scheduledAt)
          if (t < now.getTime() || t > in24h.getTime()) continue
          if (!(await markNotifiedOnce(sb, guild.guildId, 'scrim', s.id))) continue
          await postChannelMessage(env.DISCORD_BOT_TOKEN, guild.notifyChannelId,
            `⚔️ **Scrim starting soon**${s.opponent ? ` vs ${s.opponent}` : ''} — ${new Date(s.scheduledAt).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC. Run /scrims for details.`)
        }

        const shared = await getSharedTeam(sb, guild.groupId)
        const starterUserIds = shared.roster.map((m) => m.userId).filter((id): id is string => !!id)
        if (starterUserIds.length >= 2) {
          const today = now.toISOString().slice(0, 10)
          const [rules, exceptions] = await Promise.all([
            listAvailabilityRules(sb, guild.groupId),
            listAvailabilityExceptions(sb, guild.groupId, today, weekAhead.toISOString().slice(0, 10)),
          ])
          const windows = findCommonAvailability(rules, exceptions, starterUserIds, today)
          for (const w of windows) {
            const key = `${w.date}|${w.startTime}|${w.endTime}`
            if (!(await markNotifiedOnce(sb, guild.guildId, 'common_availability', key))) continue
            await postChannelMessage(env.DISCORD_BOT_TOKEN, guild.notifyChannelId,
              `🟢 **Common availability found:** ${w.date} ${w.startTime}–${w.endTime} — everyone linked is free.`)
          }
        }

        // Relay routine team notifications (task assigned, objective
        // overdue, @mention) into the same channel — see
        // listRecentTeamNotifications for why wellbeing_alert is excluded.
        const teamNotifications = await listRecentTeamNotifications(sb, guild.groupId, dayAgo.toISOString())
        if (teamNotifications.length > 0) {
          const names = await resolveDisplayNames(sb, guild.groupId, Array.from(new Set(teamNotifications.map((n) => n.userId))))
          const seenMentionAnnouncements = new Set<string>()
          for (const n of teamNotifications) {
            if (n.type === 'mention') {
              // Fans out one notification row per mentioned teammate — collapse
              // to a single Discord post per announcement.
              const announcementId = String(n.data.announcementId ?? n.id)
              if (seenMentionAnnouncements.has(announcementId)) continue
              seenMentionAnnouncements.add(announcementId)
              if (!(await markNotifiedOnce(sb, guild.guildId, 'notification', `mention:${announcementId}`))) continue
              await postChannelMessage(env.DISCORD_BOT_TOKEN, guild.notifyChannelId,
                `📣 **${n.data.mentionedByName ?? '?'}** posted an announcement mentioning a teammate: "${n.data.title ?? ''}"`)
              continue
            }
            if (!(await markNotifiedOnce(sb, guild.guildId, 'notification', `${n.type}:${n.id}`))) continue
            const recipientName = names.get(n.userId) ?? '?'
            if (n.type === 'task_assigned') {
              await postChannelMessage(env.DISCORD_BOT_TOKEN, guild.notifyChannelId,
                `📋 **Task assigned to ${recipientName}:** ${n.data.title ?? ''} (by ${n.data.assignedByName ?? '?'})`)
            } else if (n.type === 'objective_overdue') {
              await postChannelMessage(env.DISCORD_BOT_TOKEN, guild.notifyChannelId,
                `⏰ **Objective overdue for ${recipientName}** — was due ${n.data.dueDate ?? '?'}`)
            }
          }
        }
      } catch (err) {
        console.error('[discord-bot] scheduled failed for guild', guild.guildId, (err as Error)?.message)
      }
    }
  },
}
