import { useEffect, useState } from 'react'
import { useCollab } from '@/hooks/useCollab'
import type { CodexEntry } from '@/lib/microReview/codex'
import { teamRuleToEntry } from '@/lib/microReviewCloudCore'

/** Team rules from the player's groups (best effort: signed out / not enabled → none). */
export function useTeamCodex(): CodexEntry[] {
  const [rules, setRules] = useState<CodexEntry[]>([])
  // Groups come from the shared store (one collabListGroups for the whole app, task I).
  const { groups } = useCollab()
  const groupKey = groups.map((g) => g.id).slice(0, 20).join(',')
  useEffect(() => {
    let alive = true
    const ids = groupKey ? groupKey.split(',') : []
    if (ids.length === 0) { setRules([]); return }
    window.api.teamCodexList(ids)
      .then((r) => { if (alive) setRules((r ?? []).map(teamRuleToEntry)) })
      .catch(() => {})
    return () => { alive = false }
  }, [groupKey])
  return rules
}
