/**
 * Team Codex rules and roles (pure helpers of the staff form).
 *
 * A rule can target several roles, but the cloud table keeps one role per
 * row and released versions of the app read it that way. A rule written for
 * three roles is therefore three rows with the same content: every client,
 * old or new, applies it to the right roles, and the staff list shows and
 * deletes the rows as one rule.
 */
import type { TeamCodexRule, TeamCodexRuleInput } from './microReview/types'

export type CodexRole = TeamCodexRuleInput['role']
export type PlayedRole = Exclude<CodexRole, 'any'>

export const PLAYED_ROLES: PlayedRole[] = ['TOP', 'JUNGLE', 'MIDDLE', 'BOTTOM', 'UTILITY']

export interface CodexRuleGroup {
  key: string
  /** Every row of the rule, to delete it as a whole. */
  ids: string[]
  /** `['any']`, or the targeted roles in lane order. */
  roles: CodexRole[]
  rule: TeamCodexRule
}

/** Roles to store for a selection: none ticked, or all five, is the single "any" row. */
export function rolesToStore(selected: readonly PlayedRole[]): CodexRole[] {
  const picked = PLAYED_ROLES.filter((r) => selected.includes(r))
  return picked.length === 0 || picked.length === PLAYED_ROLES.length ? ['any'] : picked
}

/** Rows with the same content (same group, mistake, phase, fundamental and wording) are one rule. */
export function groupCodexRules(rules: readonly TeamCodexRule[]): CodexRuleGroup[] {
  const by = new Map<string, CodexRuleGroup>()
  for (const r of rules) {
    const key = JSON.stringify([r.groupId, r.mistakeSlug, r.phase, r.fundamentalId, r.headline, r.tacticalRule, r.drillObjective])
    const g = by.get(key)
    if (!g) by.set(key, { key, ids: [r.id], roles: [r.role], rule: r })
    else {
      g.ids.push(r.id)
      if (!g.roles.includes(r.role)) g.roles.push(r.role)
    }
  }
  const order = (role: CodexRole) => (role === 'any' ? -1 : PLAYED_ROLES.indexOf(role))
  return [...by.values()].map((g) => ({
    ...g,
    // An "any" row already covers every role: the others add nothing to read.
    roles: g.roles.includes('any') ? ['any'] : [...g.roles].sort((a, b) => order(a) - order(b)),
  }))
}
