import { useTranslation } from 'react-i18next'
import { Check, Loader2, Link2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Segmented } from '@/components/analyst/shared'
import type { KnownOpponent } from '@/lib/matchEvent'
import {
  OPPONENT_ROLES, ROLE_SHORT, availableCount, isRiotIdShape, matchDraftErrors, opponentsFromMultiLink,
  type BoFormat, type MatchDraft, type OpponentRole, type OpponentRow,
} from '@/lib/matchEventView'

/**
 * #49 (docs/DESIGN_STATE.md § 13.1): what the « Nouvel événement » pop-up adds for a Scrim or an Officiel — the
 * format, the opposing team (known or new, OP.GG multi link, the 5 opponents) and our five slots. Controlled: the
 * pop-up keeps the MatchDraft and saves it (calendarSaveMatchEvent).
 */
export function MatchEventFields({ draft, onChange, onFormatChange, knownOpponents, members, onCheckRiotId, disabled }: {
  draft: MatchDraft
  /** A value, or an update applied to the latest draft (an async Riot ID check lands after other edits). */
  onChange: (d: MatchDraft | ((prev: MatchDraft) => MatchDraft)) => void
  /** The pop-up recomputes the end time (Bo1 1 h, Bo3 2 h 30, Bo5 4 h). */
  onFormatChange?: (bo: BoFormat) => void
  knownOpponents: KnownOpponent[]
  /** Who can fill one of our slots (the group's players), with their availability on this slot. */
  members: Array<{ userId: string; name: string; available: boolean | null }>
  /**
   * Riot ID check through the relay (account-v1): true found, false no such account, null could not tell (rate limit,
   * offline: shows « — », never « Introuvable »). Without it, only the "Name#TAG" shape is checked.
   */
  onCheckRiotId?: (riotId: string, region: string | null) => Promise<boolean | null>
  disabled?: boolean
}) {
  const { t, i18n } = useTranslation()
  const errors = matchDraftErrors(draft)
  const set = (patch: Partial<MatchDraft>) => onChange({ ...draft, ...patch })
  const setRow = (i: number, patch: Partial<OpponentRow>) => set({ opponents: draft.opponents.map((r, j) => (j === i ? { ...r, ...patch } : r)) })

  const pickKnown = (key: string) => {
    const k = knownOpponents.find((o) => o.key === key)
    if (!k) return
    const opponents = OPPONENT_ROLES.map((role) => {
      const p = k.players.find((x) => x.role === role)
      return { role, riotId: p?.riotId ?? '', region: p?.region ?? null, status: p?.riotId ? 'found' as const : 'empty' as const }
    })
    set({ knownKey: key, name: k.name, tag: k.tag ?? '', multiLink: k.opggUrl ?? '', opponents })
  }
  const pasteLink = (link: string) => {
    const filled = opponentsFromMultiLink(link, draft.opponents)
    set({ multiLink: link, ...(filled ? { opponents: filled } : {}) })
  }
  const check = async (i: number) => {
    const row = draft.opponents[i]
    const riotId = row.riotId.trim()
    if (!riotId) { setRow(i, { status: 'empty' }); return }
    if (!isRiotIdShape(riotId)) { setRow(i, { status: 'not_found' }); return }
    if (!onCheckRiotId) { setRow(i, { status: 'empty' }); return }
    setRow(i, { status: 'checking' })
    const found = await onCheckRiotId(riotId, row.region).catch(() => null)
    const status = found === true ? 'found' as const : found === false ? 'not_found' as const : 'empty' as const
    // Applied to the latest draft, and only if that line still holds the checked Riot ID.
    onChange((prev) => ({
      ...prev,
      opponents: prev.opponents.map((r, j) => (j === i && r.riotId.trim() === riotId ? { ...r, status } : r)),
    }))
  }
  const setSlot = (i: number, userId: string) => {
    const m = members.find((x) => x.userId === userId)
    set({ roster: draft.roster.map((s, j) => (j === i ? { ...s, userId: m?.userId ?? null, name: m?.name ?? null, available: m?.available ?? null } : s)) })
  }
  const availabilityText = (a: boolean | null) => t(a === true ? 'planning.match.available' : a === false ? 'planning.match.unavailable' : 'planning.match.availabilityUnknown')

  return (
    <div className="space-y-4">
      <Segmented
        label={t('planning.match.format')}
        value={draft.bo}
        onChange={(bo) => { set({ bo }); onFormatChange?.(bo) }}
        options={(['bo1', 'bo3', 'bo5'] as const).map((id) => ({ id, label: id.toUpperCase() }))}
      />

      {/* Opposing team */}
      <fieldset disabled={disabled} className="space-y-3 rounded-lg border border-hextech-border-dim bg-hextech-black p-3">
        <legend className="px-1 text-xs font-semibold uppercase tracking-wider text-hextech-gold">{t('planning.match.opponent')}</legend>
        <Segmented
          label={t('planning.match.opponent')}
          value={draft.opponentMode}
          onChange={(opponentMode) => set({ opponentMode, ...(opponentMode === 'new' ? { knownKey: null } : {}) })}
          options={[{ id: 'known', label: t('planning.match.known') }, { id: 'new', label: t('planning.match.new') }]}
        />
        {draft.opponentMode === 'known' && (
          knownOpponents.length === 0
            ? <p className="text-xs text-hextech-text-dim">{t('planning.match.noKnown')}</p>
            : (
              <Select value={draft.knownKey ?? ''} onValueChange={pickKnown}>
                <SelectTrigger aria-label={t('planning.match.pickKnown')}><SelectValue placeholder={t('planning.match.pickKnown')} /></SelectTrigger>
                <SelectContent>
                  {knownOpponents.map((o) => (
                    <SelectItem key={o.key} value={o.key}>
                      {o.name}{o.tag ? ` [${o.tag}]` : ''}
                      {o.lastMatchAt && ` · ${t('planning.match.lastMatch', { date: new Date(o.lastMatchAt).toLocaleDateString(i18n.language, { day: 'numeric', month: 'short' }) })}`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )
        )}
        <div className="grid grid-cols-[1fr_7rem] gap-2">
          <label className="space-y-1 text-xs text-hextech-text">
            <span>{t('planning.match.name')} <span aria-hidden className="text-hextech-red">*</span></span>
            <Input value={draft.name} required aria-invalid={!!errors.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="space-y-1 text-xs text-hextech-text">
            <span>{t('planning.match.tag')}</span>
            <Input value={draft.tag} maxLength={5} aria-invalid={!!errors.tag} onChange={(e) => set({ tag: e.target.value.toUpperCase() })}
              className={cn(errors.tag && 'border-hextech-red')} />
          </label>
        </div>
        <label className="block space-y-1 text-xs text-hextech-text">
          <span className="flex items-center gap-1"><Link2 className="h-3 w-3" aria-hidden />{t('planning.match.multiLink')}</span>
          <Input value={draft.multiLink} onChange={(e) => pasteLink(e.target.value)} placeholder="https://www.op.gg/multisearch/euw?summoners=…" />
        </label>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-hextech-text">{t('planning.match.opponents')}</p>
          {draft.opponents.map((row, i) => (
            <div key={i} className="grid grid-cols-[5.5rem_1fr_6.5rem] items-center gap-2">
              <Select value={row.role} onValueChange={(v) => setRow(i, { role: v as OpponentRole })}>
                <SelectTrigger className="h-8 text-xs" aria-label={t('planning.match.roleOf', { n: i + 1 })}><SelectValue /></SelectTrigger>
                <SelectContent>{OPPONENT_ROLES.map((r) => <SelectItem key={r} value={r}>{ROLE_SHORT[r]}</SelectItem>)}</SelectContent>
              </Select>
              <Input
                value={row.riotId}
                placeholder="Nom#TAG"
                aria-label={t('planning.match.riotIdOf', { n: i + 1 })}
                aria-invalid={row.status === 'not_found'}
                onChange={(e) => setRow(i, { riotId: e.target.value, status: 'empty' })}
                onBlur={() => { void check(i) }}
                className={cn('h-8 text-xs', row.status === 'not_found' && 'border-hextech-red')}
              />
              <span className="text-right text-[11px]" aria-live="polite">
                {row.status === 'checking' && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-hextech-text-dim" aria-label={t('common.loading')} />}
                {row.status === 'found' && <span className="inline-flex items-center gap-1 text-hextech-green"><Check className="h-3 w-3" aria-hidden />{t('planning.match.found')}</span>}
                {row.status === 'not_found' && <span className="text-hextech-red">{t('planning.match.notFound')}</span>}
                {row.status === 'empty' && <span className="text-hextech-text-dim">—</span>}
              </span>
            </div>
          ))}
        </div>
      </fieldset>

      {/* Our roster and roles: these players become the event's attendees */}
      <fieldset disabled={disabled} className="space-y-2">
        <legend className="flex w-full items-center justify-between text-xs">
          <span className="font-semibold uppercase tracking-wider text-hextech-gold">{t('planning.match.roster')}</span>
          <span className="text-hextech-text-dim">{t('planning.match.rosterHeader', { available: availableCount(draft.roster), total: draft.roster.length })}</span>
        </legend>
        <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-5">
          {draft.roster.map((slot, i) => (
            <div key={slot.role} className="space-y-1 rounded-md border border-hextech-border-dim p-1.5">
              <p className="flex items-center justify-between text-[10px] font-semibold text-hextech-text-dim">
                {ROLE_SHORT[slot.role]}
                {slot.userId && (
                  <span className={cn('h-2 w-2 rounded-full', slot.available === true ? 'bg-hextech-green' : slot.available === false ? 'bg-hextech-red' : 'bg-hextech-text-dim')}
                    title={availabilityText(slot.available)} />
                )}
              </p>
              <Select value={slot.userId ?? 'none'} onValueChange={(v) => setSlot(i, v === 'none' ? '' : v)}>
                <SelectTrigger className="h-7 text-xs" aria-label={t('planning.match.slotOf', { role: ROLE_SHORT[slot.role] })}><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">—</SelectItem>
                  {members.map((m) => <SelectItem key={m.userId} value={m.userId}>{m.name}</SelectItem>)}
                </SelectContent>
              </Select>
              {slot.userId && <span className="sr-only">{availabilityText(slot.available)}</span>}
            </div>
          ))}
        </div>
      </fieldset>

      <p className="text-xs text-hextech-gold">{t('planning.match.footer')}</p>
    </div>
  )
}
