import { useCallback } from 'react'
import { useLocalizedFundamentals } from '@/lib/constants/useFundamentals'
import { formatGameTime, formatKDA } from '@/lib/utils'
import type { TimelineNote } from '@/components/ReviewForm/TimelineNoteInput'

export interface ShareReviewData {
  /** e.g. "Yone TOP vs Nasut" or external review title */
  title: string
  /** ISO string */
  gameEndAt?: string
  win?: boolean
  champion?: string
  opponentChampion?: string
  kills?: number
  deaths?: number
  assists?: number
  cs?: number
  visionScore?: number
  duration?: number
  objectiveIds: string[]
  selectedKpiIds: string[]
  kpiScores: Record<string, number>
  kpiNotes?: Record<string, string>
  timelineNotes: TimelineNote[]
  freeText?: string
  aiSummary?: string
  /** For external reviews */
  playerName?: string
}

/** Hex colour used for the Discord embed sidebar */
const EMBED_COLOR_WIN  = 0x22c55e  // green-500
const EMBED_COLOR_LOSS = 0xef4444  // red-500
const EMBED_COLOR_NEUTRAL = 0xc89b3c  // hextech-gold

function scoreBar(score: number): string {
  const filled = Math.round(score)
  return '█'.repeat(filled) + '░'.repeat(10 - filled) + ` ${score}/10`
}

export function useShareReview() {
  const categories = useLocalizedFundamentals()
  const allFundamentals = categories.flatMap((c) => c.fundamentals)
  const allKpis = allFundamentals.flatMap((f) => f.kpis ?? [])

  const getObjectiveLabels = useCallback(
    (ids: string[]) =>
      ids
        .map((id) => allFundamentals.find((f) => f.id === id)?.label ?? id)
        .join(' · '),
    [allFundamentals],
  )

  const getKpiLabel = useCallback(
    (id: string) => allKpis.find((k) => k.id === id)?.label ?? id,
    [allKpis],
  )

  /** Builds a Discord rich-embed object from the review data. */
  const buildEmbed = useCallback(
    (data: ShareReviewData): object => {
      const color =
        data.win === true  ? EMBED_COLOR_WIN  :
        data.win === false ? EMBED_COLOR_LOSS :
        EMBED_COLOR_NEUTRAL

      const fields: Array<{ name: string; value: string; inline?: boolean }> = []

      // Game stats
      if (data.kills !== undefined && data.deaths !== undefined && data.assists !== undefined) {
        fields.push({ name: 'KDA',      value: formatKDA(data.kills, data.deaths, data.assists), inline: true })
      }
      if (data.cs !== undefined)          fields.push({ name: 'CS',       value: String(data.cs),                  inline: true })
      if (data.visionScore !== undefined) fields.push({ name: 'Vision',   value: String(data.visionScore),         inline: true })
      if (data.duration !== undefined)    fields.push({ name: 'Duration', value: formatGameTime(data.duration),    inline: true })

      // Objectives
      if (data.objectiveIds.length > 0) {
        fields.push({ name: '🎯 Objective', value: getObjectiveLabels(data.objectiveIds) })
      }

      // KPI scores
      const scoredKpis = data.selectedKpiIds
        .map((id) => ({ id, label: getKpiLabel(id), score: data.kpiScores[id] }))
        .filter((k) => k.score !== undefined)

      if (scoredKpis.length > 0) {
        const kpiText = scoredKpis
          .map((k) => {
            const note = data.kpiNotes?.[k.id]
            return `**${k.label}**\n${scoreBar(k.score)}${note ? `\n_${note}_` : ''}`
          })
          .join('\n')
        fields.push({ name: '📊 KPI Scores', value: kpiText.slice(0, 1024) })
      }

      // Timeline notes
      if (data.timelineNotes.length > 0) {
        const notesText = data.timelineNotes
          .filter((n) => n.time && n.note)
          .map((n) => `\`${n.time}\` ${n.note}`)
          .slice(0, 15)          // Discord field cap
          .join('\n')
        if (notesText) fields.push({ name: '📝 Timeline Notes', value: notesText.slice(0, 1024) })
      }

      // Free text
      if (data.freeText?.trim()) {
        fields.push({ name: '💬 Thoughts & Feelings', value: data.freeText.trim().slice(0, 1024) })
      }

      // AI summary
      if (data.aiSummary?.trim()) {
        fields.push({ name: '🤖 AI Summary', value: data.aiSummary.trim().slice(0, 1024) })
      }

      const description = [
        data.champion && data.opponentChampion
          ? `**${data.champion}** vs **${data.opponentChampion}**`
          : data.champion ? `**${data.champion}**` : null,
        data.playerName ? `Player: ${data.playerName}` : null,
        data.gameEndAt
          ? new Date(data.gameEndAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
          : null,
      ].filter(Boolean).join('  ·  ')

      return {
        title: data.title,
        description: description || undefined,
        color,
        fields,
        footer: { text: 'Shared via NexusMind' },
        timestamp: new Date().toISOString(),
      }
    },
    [getObjectiveLabels, getKpiLabel],
  )

  /** Builds a Markdown-friendly plain-text version of the review (for clipboard). */
  const buildText = useCallback(
    (data: ShareReviewData): string => {
      const lines: string[] = []
      const result = data.win === true ? '✅ Victory' : data.win === false ? '❌ Defeat' : ''

      lines.push(`**${data.title}**${result ? `  ${result}` : ''}`)

      if (data.champion) {
        const matchup = data.opponentChampion ? `${data.champion} vs ${data.opponentChampion}` : data.champion
        const stats = [
          data.kills !== undefined ? formatKDA(data.kills, data.deaths!, data.assists!) : null,
          data.cs !== undefined ? `${data.cs} CS` : null,
          data.visionScore !== undefined ? `${data.visionScore} vis` : null,
          data.duration !== undefined ? formatGameTime(data.duration) : null,
        ].filter(Boolean).join('  ·  ')
        lines.push(`${matchup}${stats ? `  —  ${stats}` : ''}`)
      }

      if (data.playerName) lines.push(`Player: ${data.playerName}`)
      if (data.objectiveIds.length > 0) lines.push(`🎯 Objective: ${getObjectiveLabels(data.objectiveIds)}`)

      const scoredKpis = data.selectedKpiIds
        .map((id) => ({ id, label: getKpiLabel(id), score: data.kpiScores[id] }))
        .filter((k) => k.score !== undefined)

      if (scoredKpis.length > 0) {
        lines.push('\n📊 KPI Scores')
        scoredKpis.forEach((k) => {
          const note = data.kpiNotes?.[k.id]
          lines.push(`  • ${k.label}: ${k.score}/10${note ? ` — ${note}` : ''}`)
        })
      }

      if (data.timelineNotes.length > 0) {
        lines.push('\n📝 Timeline Notes')
        data.timelineNotes.filter((n) => n.time && n.note).forEach((n) => lines.push(`  • ${n.time} — ${n.note}`))
      }

      if (data.freeText?.trim()) {
        lines.push(`\n💬 Thoughts & Feelings\n${data.freeText.trim()}`)
      }

      if (data.aiSummary?.trim()) {
        lines.push(`\n🤖 AI Summary\n${data.aiSummary.trim()}`)
      }

      lines.push('\n*Shared via NexusMind*')
      return lines.join('\n')
    },
    [getObjectiveLabels, getKpiLabel],
  )

  return { buildEmbed, buildText }
}
