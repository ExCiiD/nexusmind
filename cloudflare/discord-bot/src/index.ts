import { verifyDiscordRequest } from './verify'
import { jsonResponse, postChannelMessage, sendDirectMessage } from './discordApi'
import { adminClient } from './supabaseAdmin'
import {
  handleLinkTeam, handleLinkMe, handleSetChannel, handleCalendar, handleScrims, handleCommonAvailability, handleAvailability,
  type Interaction,
} from './handlers'
import {
  listGuildsWithNotifyChannel, markNotifiedOnce, listRecentTeamNotifications, resolveDisplayNames, listRecentAnnouncements,
  listPendingDirectNotifications, markDirectMessageSent, directMessageText,
} from '../../../src/lib/discordBotCore'
import { listEvents, listAvailabilityRules, listAvailabilityExceptions, findCommonAvailability } from '../../../src/lib/calendarCore'
import { describeMatch, listScrimsForGroup } from '../../../src/lib/scrimsCore'
import { getGroupRosterUserIds } from '../../../src/lib/teamCore'

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

    // Direct messages (18 November 2026): a player's absence to an event
    // (or their return) reaches every staff member who linked Discord with
    // /link-me, once, whether or not the team linked a server.
    try {
      for (const n of await listPendingDirectNotifications(sb, dayAgo.toISOString())) {
        if (!(await markDirectMessageSent(sb, n.id))) continue
        if (n.discordUserId) await sendDirectMessage(env.DISCORD_BOT_TOKEN, n.discordUserId, directMessageText(n))
      }
    } catch (err) {
      console.error('[discord-bot] direct messages failed', (err as Error)?.message)
    }

    for (const guild of guilds) {
      if (!guild.notifyChannelId) continue
      try {
        const [events, scrims] = await Promise.all([
          listEvents(sb, guild.groupId, now.toISOString(), in24h.toISOString()),
          listScrimsForGroup(sb, guild.groupId),
        ])
        const at = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })
        for (const e of events) {
          if (!(await markNotifiedOnce(sb, guild.guildId, 'event', e.id))) continue
          // #49: a Scrim / Officiel slot is announced as the match it is, once (its scrim is skipped below).
          await postChannelMessage(env.DISCORD_BOT_TOKEN, guild.notifyChannelId, e.match
            ? `⚔️ **Starting soon:** ${describeMatch(e.match)} — ${at(e.startsAt)} UTC. Run /scrims for details.`
            : `📅 **Starting soon:** ${e.title} — ${at(e.startsAt)} UTC`)
        }
        for (const s of scrims) {
          if (s.calendarEventId) continue
          const t = Date.parse(s.scheduledAt)
          if (t < now.getTime() || t > in24h.getTime()) continue
          if (!(await markNotifiedOnce(sb, guild.guildId, 'scrim', s.id))) continue
          await postChannelMessage(env.DISCORD_BOT_TOKEN, guild.notifyChannelId,
            `⚔️ **Starting soon:** ${describeMatch(s)} — ${at(s.scheduledAt)} UTC. Run /scrims for details.`)
        }

        // Announcements (Phase 2, Planning rework) — broadcast, not tied to
        // a specific recipient, so queried directly like events/scrims
        // above rather than through listRecentTeamNotifications.
        const announcements = await listRecentAnnouncements(sb, guild.groupId, dayAgo.toISOString())
        for (const a of announcements) {
          if (!(await markNotifiedOnce(sb, guild.guildId, 'notification', `announcement:${a.id}`))) continue
          await postChannelMessage(env.DISCORD_BOT_TOKEN, guild.notifyChannelId, `📣 **${a.title}**\n${a.body}`)
        }

        // WSC-06: only the roster's linked accounts (service role: no RLS here).
        const starterUserIds = await getGroupRosterUserIds(sb, guild.groupId)
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

        // Relay routine team notifications (task assigned, objective/review
        // overdue, @mention, scrim availability — E2 v2's C3/C4 alerts) into
        // the same channel — see listRecentTeamNotifications for why
        // wellbeing_alert is excluded.
        const teamNotifications = await listRecentTeamNotifications(sb, guild.groupId, dayAgo.toISOString())
        if (teamNotifications.length > 0) {
          const names = await resolveDisplayNames(sb, guild.groupId, Array.from(new Set(teamNotifications.map((n) => n.userId))))
          const seenMentionAnnouncements = new Set<string>()
          const seenLowAvailabilityScrims = new Set<string>()
          const seenEndingPlans = new Set<string>()
          const seenEventRequests = new Set<string>()
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
            if (n.type === 'scrim_low_availability') {
              // Fans out one notification row per staff member — collapse to
              // a single Discord post per scrim.
              const scrimId = String(n.data.scrimId ?? n.id)
              if (seenLowAvailabilityScrims.has(scrimId)) continue
              seenLowAvailabilityScrims.add(scrimId)
              if (!(await markNotifiedOnce(sb, guild.guildId, 'notification', `scrim_low_availability:${scrimId}`))) continue
              await postChannelMessage(env.DISCORD_BOT_TOKEN, guild.notifyChannelId,
                `⚠️ **Low availability** for "${n.data.title ?? ''}" — only ${n.data.yesCount ?? '?'}/5 confirmed, scrim is within 48h.`)
              continue
            }
            if (n.type === 'dev_plan_period_ending') {
              // Fans out to the player + every staff member — collapse to a
              // single Discord post per plan.
              const planId = String(n.data.planId ?? n.id)
              if (seenEndingPlans.has(planId)) continue
              seenEndingPlans.add(planId)
              if (!(await markNotifiedOnce(sb, guild.guildId, 'notification', `dev_plan_period_ending:${planId}`))) continue
              await postChannelMessage(env.DISCORD_BOT_TOKEN, guild.notifyChannelId,
                `🎯 **Dev plan period ending soon:** "${n.data.title ?? ''}" — ends ${n.data.periodEnd ?? '?'}.`)
              continue
            }
            if (n.type === 'calendar_event_request') {
              // Fans out to every staff member — collapse to a single
              // Discord post per request.
              const requestId = String(n.data.requestId ?? n.id)
              if (seenEventRequests.has(requestId)) continue
              seenEventRequests.add(requestId)
              if (!(await markNotifiedOnce(sb, guild.guildId, 'notification', `calendar_event_request:${requestId}`))) continue
              await postChannelMessage(env.DISCORD_BOT_TOKEN, guild.notifyChannelId,
                `🗓️ **${n.data.requestedByName ?? '?'}** requested an event: "${n.data.eventName ?? ''}"`)
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
            } else if (n.type === 'review_pending') {
              await postChannelMessage(env.DISCORD_BOT_TOKEN, guild.notifyChannelId,
                `💬 **${recipientName}** has an unanswered coach comment waiting (3+ days).`)
            } else if (n.type === 'scrim_availability_missing') {
              await postChannelMessage(env.DISCORD_BOT_TOKEN, guild.notifyChannelId,
                `❓ **${recipientName}** hasn't responded yet to "${n.data.title ?? ''}" (within 48h).`)
            }
          }
        }
      } catch (err) {
        console.error('[discord-bot] scheduled failed for guild', guild.guildId, (err as Error)?.message)
      }
    }
  },
}
