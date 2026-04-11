import { useCallback } from 'react'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { formatGameTime, formatKDA } from '@/lib/utils'

export interface ShareSessionGame {
  champion: string
  opponentChampion: string | null
  win: boolean
  kills: number
  deaths: number
  assists: number
  cs: number
  visionScore: number
  duration: number
  gameEndAt: string
  review?: {
    kpiScores: string   // JSON Record<string, number>
    freeText: string | null
    aiSummary: string | null
    timelineNotes: string  // JSON Array<{time:string; note:string}>
  } | null
}

export interface ShareSessionData {
  objectiveId: string
  /** Parsed objective IDs — falls back to [objectiveId] */
  objectiveIds?: string[]
  /** Parsed KPI IDs tracked across the session */
  selectedKpiIds?: string[]
  subObjective?: string | null
  customNote?: string | null
  date: string
  wins: number
  losses: number
  gamesPlayed: number
  avgKDA?: number
  avgCSPerMin?: number
  objectiveSuccessRate?: number | null
  aiSummary?: string | null
  sessionConclusion?: string | null
  games: ShareSessionGame[]
}

const EMBED_WIN     = 0x22c55e  // green-500
const EMBED_LOSS    = 0xef4444  // red-500
const EMBED_NEUTRAL = 0xc89b3c  // hextech-gold

type EmbedField = { name: string; value: string; inline?: boolean }

function scoreBar(score: number): string {
  const filled = Math.round(score)
  return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${score.toFixed(1)}/10`
}

export function useShareSession() {
  const categories = useLocalizedFundamentals()
  const allFundamentals = categories.flatMap((c) => c.fundamentals)
  const allKpis = allFundamentals.flatMap((f) => f.kpis ?? [])

  const getObjectiveLabels = useCallback(
    (ids: string[]) =>
      ids.map((id) => allFundamentals.find((f) => f.id === id)?.label ?? id).join(' · '),
    [allFundamentals],
  )

  const getKpiLabel = useCallback(
    (id: string) => allKpis.find((k) => k.id === id)?.label ?? id,
    [allKpis],
  )

  /** Build a single game's review fields (timeline, feelings, KPI scores). */
  const buildGameFields = useCallback(
    (review: ShareSessionGame['review']): EmbedField[] => {
      if (!review) return []
      const fields: EmbedField[] = []

      // Timeline notes
      let notes: Array<{ time: string; note: string }> = []
      try { notes = JSON.parse(review.timelineNotes) } catch { /* ignore */ }
      const validNotes = notes.filter((n) => n.time && n.note)
      if (validNotes.length > 0) {
        const text = validNotes.slice(0, 12).map((n) => `\`${n.time}\` ${n.note}`).join('\n')
        fields.push({ name: '📝 Timeline Notes', value: text.slice(0, 1024) })
      }

      // Feelings / free text
      if (review.freeText?.trim()) {
        fields.push({ name: '💬 Feelings', value: `"${review.freeText.trim()}"`.slice(0, 1024) })
      }

      // KPI scores
      let kpiMap: Record<string, number> = {}
      try { kpiMap = JSON.parse(review.kpiScores) } catch { /* ignore */ }
      const kpiEntries = Object.entries(kpiMap)
      if (kpiEntries.length > 0) {
        const text = kpiEntries
          .map(([id, score]) => `**${getKpiLabel(id)}**\n${scoreBar(score)}`)
          .join('\n')
        fields.push({ name: '📊 KPI Scores', value: text.slice(0, 1024) })
      }

      return fields
    },
    [getKpiLabel],
  )

  /**
   * Builds the full Discord payload as an array of embeds:
   * - Embed 0: session overview (stats, objective, avg KPIs, AI summary)
   * - Embeds 1..N: one per game (matchup + review details)
   * Discord allows up to 10 embeds per message.
   */
  const buildEmbeds = useCallback(
    (data: ShareSessionData): object[] => {
      const winRate = data.gamesPlayed > 0 ? Math.round((data.wins / data.gamesPlayed) * 100) : 0
      const overviewColor =
        winRate >= 60 ? EMBED_WIN :
        winRate <= 40 ? EMBED_LOSS :
        EMBED_NEUTRAL

      const objectiveIds = data.objectiveIds?.length ? data.objectiveIds : [data.objectiveId]
      const objectiveLabel = getObjectiveLabels(objectiveIds)
      const dateStr = new Date(data.date).toLocaleDateString(undefined, {
        day: 'numeric', month: 'short', year: 'numeric',
      })

      const descParts = [
        `${dateStr} · ${data.gamesPlayed} game${data.gamesPlayed !== 1 ? 's' : ''} · ${data.wins}W ${data.losses}L · ${winRate}% WR`,
        data.subObjective ? `Sub-objective: ${data.subObjective}` : null,
        data.customNote?.trim() ? `"${data.customNote.trim()}"` : null,
      ].filter(Boolean)

      const overviewFields: EmbedField[] = []
      if (data.avgKDA !== undefined)       overviewFields.push({ name: 'Avg KDA',    value: data.avgKDA.toFixed(2),    inline: true })
      if (data.avgCSPerMin !== undefined)  overviewFields.push({ name: 'Avg CS/min', value: data.avgCSPerMin.toFixed(1), inline: true })
      if (data.objectiveSuccessRate != null)
        overviewFields.push({ name: 'Obj. Success', value: `${data.objectiveSuccessRate}%`, inline: true })

      overviewFields.push({ name: '🎯 Objective', value: objectiveLabel })

      const conclusionText = data.sessionConclusion?.trim() || data.aiSummary?.trim()
      if (conclusionText) {
        overviewFields.push({ name: '📝 Session Conclusion', value: conclusionText.slice(0, 1024) })
      }

      const embeds: object[] = [
        {
          title: `📋 Session — ${objectiveLabel}`,
          description: descParts.join('\n') || undefined,
          color: overviewColor,
          fields: overviewFields,
          footer: { text: 'Shared via NexusMind' },
          timestamp: new Date(data.date).toISOString(),
        },
      ]

      // One embed per game (Discord max 10 embeds, so up to 9 games)
      const gamesToEmbed = data.games.slice(0, 9)
      gamesToEmbed.forEach((g, idx) => {
        const matchup = g.opponentChampion
          ? `${g.champion} vs ${g.opponentChampion}`
          : g.champion
        const statsLine = `${formatKDA(g.kills, g.deaths, g.assists)} · ${g.cs} CS · ${g.visionScore} Vision · ${formatGameTime(g.duration)}`

        const gameFields: EmbedField[] = buildGameFields(g.review)

        embeds.push({
          title: `${g.win ? '✅' : '❌'} #${idx + 1} — ${matchup}`,
          description: statsLine,
          color: g.win ? EMBED_WIN : EMBED_LOSS,
          fields: gameFields.length > 0 ? gameFields : undefined,
        })
      })

      return embeds
    },
    [getObjectiveLabels, buildGameFields],
  )

  const buildText = useCallback(
    (data: ShareSessionData): string => {
      const winRate = data.gamesPlayed > 0 ? Math.round((data.wins / data.gamesPlayed) * 100) : 0
      const objectiveIds = data.objectiveIds?.length ? data.objectiveIds : [data.objectiveId]
      const objectiveLabel = getObjectiveLabels(objectiveIds)
      const dateStr = new Date(data.date).toLocaleDateString(undefined, {
        day: 'numeric', month: 'short', year: 'numeric',
      })

      const lines: string[] = []
      lines.push(`**📋 Session — ${objectiveLabel}**`)
      lines.push(`${dateStr} · ${data.gamesPlayed} games · ${data.wins}W ${data.losses}L · ${winRate}% WR`)
      if (data.subObjective) lines.push(`Sub-objective: ${data.subObjective}`)
      if (data.customNote?.trim()) lines.push(`"${data.customNote.trim()}"`)

      const statParts = [
        data.avgKDA !== undefined ? `Avg KDA: ${data.avgKDA.toFixed(2)}` : null,
        data.avgCSPerMin !== undefined ? `Avg CS/min: ${data.avgCSPerMin.toFixed(1)}` : null,
        data.objectiveSuccessRate != null ? `Obj. Success: ${data.objectiveSuccessRate}%` : null,
      ].filter(Boolean)
      if (statParts.length > 0) lines.push(statParts.join('  ·  '))

      data.games.forEach((g, idx) => {
        const matchup = g.opponentChampion ? `${g.champion} vs ${g.opponentChampion}` : g.champion
        lines.push(`\n${g.win ? '✅' : '❌'} #${idx + 1} — ${matchup}`)
        lines.push(`  ${formatKDA(g.kills, g.deaths, g.assists)} · ${g.cs} CS · ${g.visionScore} Vision · ${formatGameTime(g.duration)}`)

        if (g.review) {
          let notes: Array<{ time: string; note: string }> = []
          try { notes = JSON.parse(g.review.timelineNotes) } catch { /* ignore */ }
          const validNotes = notes.filter((n) => n.time && n.note)
          if (validNotes.length > 0) {
            lines.push('  📝 Timeline:')
            validNotes.forEach((n) => lines.push(`    • ${n.time} — ${n.note}`))
          }

          if (g.review.freeText?.trim()) {
            lines.push(`  💬 "${g.review.freeText.trim()}"`)
          }

          let kpiMap: Record<string, number> = {}
          try { kpiMap = JSON.parse(g.review.kpiScores) } catch { /* ignore */ }
          const kpiEntries = Object.entries(kpiMap)
          if (kpiEntries.length > 0) {
            lines.push('  📊 KPI Scores:')
            kpiEntries.forEach(([id, score]) => lines.push(`    • ${getKpiLabel(id)}: ${score.toFixed(1)}/10`))
          }
        }
      })

      const conclusionTxt = data.sessionConclusion?.trim() || data.aiSummary?.trim()
      if (conclusionTxt) {
        lines.push(`\n📝 Session Conclusion\n${conclusionTxt}`)
      }

      lines.push('\n*Shared via NexusMind*')
      return lines.join('\n')
    },
    [getObjectiveLabels, getKpiLabel],
  )

  return { buildEmbeds, buildText }
}
