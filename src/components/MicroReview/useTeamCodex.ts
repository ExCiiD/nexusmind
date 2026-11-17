import { useEffect, useState } from 'react'
import type { CodexEntry } from '@/lib/microReview/codex'
import { teamRuleToEntry } from '@/lib/microReviewCloudCore'

/** Team rules from the player's groups (best effort: signed out / not enabled → none). */
export function useTeamCodex(): CodexEntry[] {
  const [rules, setRules] = useState<CodexEntry[]>([])
  useEffect(() => {
    let alive = true
    window.api.collabListGroups?.()
      .then((groups: Array<{ id: string }>) => (groups?.length ? window.api.teamCodexList(groups.map((g) => g.id).slice(0, 20)) : []))
      .then((r) => { if (alive) setRules((r ?? []).map(teamRuleToEntry)) })
      .catch(() => {})
    return () => { alive = false }
  }, [])
  return rules
}
