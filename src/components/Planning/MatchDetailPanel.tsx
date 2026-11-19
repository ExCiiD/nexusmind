import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarCheck, Check, ExternalLink, Pencil, Plus, Swords, Trash2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { MatchDetailPatch, MatchEventDetail, OpponentRole } from '@/lib/matchEvent'
import { OPPONENT_ROLES, ROLE_SHORT, opponentRoleChange } from '@/lib/matchEventView'

/** One of our players on the slot, with their answer (calendarRespond). */
export interface MatchPlayerLine { userId: string; name: string; role: OpponentRole | null; response: 'confirmed' | 'declined' | null; note: string | null }

const Block = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="space-y-2 border-t border-hextech-border-dim pt-3">
    <h4 className="text-[11px] font-semibold uppercase tracking-wider text-hextech-text-dim">{title}</h4>
    {children}
  </section>
)

/**
 * #49 (docs/DESIGN_STATE.md § 13.2): the Planning inspector for a Scrim / Officiel slot, in 8 blocks — header, our
 * players, the opponent, links, preparation, linked drafts, after the match (+ the discussion thread), edit / delete.
 * Rights (contract § 3): `canEditSlot` (canEditCalendar) edits the slot and its opponent; `canEditPrep` (that, or
 * legacy staff) writes the preparation, the review, the status and the drafts. Players read.
 */
export function MatchDetailPanel({ detail, players, myUserId, canEditSlot, canEditPrep, drafts, discussion, onRespond, onPatch, onOpenScouting, onPrepareDraft, onEdit, onDelete, onClose }: {
  detail: MatchEventDetail
  players: MatchPlayerLine[]
  myUserId: string | null
  canEditSlot: boolean
  canEditPrep: boolean
  /** The group's drafts (team_drafts), to name the linked ones and offer the others. */
  drafts: Array<{ id: string; name: string }>
  discussion?: ReactNode
  onRespond?: (present: boolean) => void
  onPatch?: (patch: MatchDetailPatch) => void
  onOpenScouting?: () => void
  onPrepareDraft?: () => void
  onEdit?: () => void
  onDelete?: () => void
  onClose?: () => void
}) {
  const { t, i18n } = useTranslation()
  const [newItem, setNewItem] = useState('')
  const [prep, setPrep] = useState(detail.prepNotes ?? '')
  const [review, setReview] = useState(detail.reviewNotes ?? '')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const ev = detail.event
  const day = new Date(ev.startsAt).toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long' })
  const hour = (iso: string) => new Date(iso).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit' })
  const me = players.find((p) => p.userId === myUserId)
  const linked = detail.draftIds.map((id) => drafts.find((d) => d.id === id)).filter((d): d is { id: string; name: string } => !!d)
  const missing = detail.draftIds.filter((id) => !drafts.some((d) => d.id === id))
  const linkable = drafts.filter((d) => !detail.draftIds.includes(d.id))
  const patch = (p: MatchDetailPatch) => onPatch?.(p)

  return (
    <div className="space-y-3 text-sm">
      {/* 1. Header */}
      <header className="space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-hextech-gold/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-hextech-gold">{t(`planning.match.kind.${detail.kind}`)}</span>
            <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold',
              detail.status === 'done' ? 'bg-hextech-green/15 text-hextech-green' : detail.status === 'cancelled' ? 'bg-hextech-red/15 text-hextech-red' : 'bg-hextech-elevated text-hextech-text')}>
              {t(`planning.match.status.${detail.status}`)}
            </span>
          </div>
          {onClose && <button type="button" onClick={onClose} aria-label={t('common.close')} className="text-hextech-text-dim hover:text-hextech-text-bright"><X className="h-3.5 w-3.5" /></button>}
        </div>
        <h3 className="font-display text-lg text-hextech-text-bright">
          {detail.opponent
            ? <>{t('planning.match.vs', { name: detail.opponent.name })}{detail.opponent.tag && <span className="text-hextech-text-dim"> ({detail.opponent.tag})</span>}</>
            : ev.title}
        </h3>
        <p className="text-xs text-hextech-text">{day} · {hour(ev.startsAt)}–{hour(ev.endsAt)}{detail.boFormat && ` · ${detail.boFormat.toUpperCase()}`}</p>
      </header>

      {/* 2. Our players */}
      <Block title={t('planning.match.ourPlayers')}>
        <ul className="space-y-1">
          {players.map((p) => (
            <li key={p.userId} className="flex items-center gap-2 text-xs">
              <span className="w-8 font-mono text-[10px] text-hextech-text-dim">{p.role ? ROLE_SHORT[p.role] : ''}</span>
              <span className="min-w-0 flex-1 truncate text-hextech-text-bright">{p.name}</span>
              <span className={cn('text-[11px]', p.response === 'confirmed' ? 'text-hextech-green' : p.response === 'declined' ? 'text-hextech-red' : 'text-hextech-text-dim')}
                title={p.note ?? undefined}>
                {t(p.response === 'confirmed' ? 'planning.match.present' : p.response === 'declined' ? 'planning.match.absent' : 'planning.match.noAnswer')}
              </span>
            </li>
          ))}
        </ul>
        {me && onRespond && (
          <div className="flex gap-2">
            <Button size="sm" variant={me.response === 'confirmed' ? 'default' : 'outline'} className="h-7 gap-1 text-xs" onClick={() => onRespond(true)}><Check className="h-3 w-3" />{t('planning.match.iWillBeThere')}</Button>
            <Button size="sm" variant={me.response === 'declined' ? 'default' : 'outline'} className="h-7 gap-1 text-xs" onClick={() => onRespond(false)}><X className="h-3 w-3" />{t('planning.match.iCannot')}</Button>
          </div>
        )}
      </Block>

      {/* 3. Opponent */}
      {detail.opponent && (
        <Block title={t('planning.match.opponent')}>
          {detail.opponent.opggUrl && (
            <a href={detail.opponent.opggUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border border-hextech-border px-2 py-1 text-xs text-hextech-text-bright hover:border-hextech-gold">
              {t('planning.match.opggMulti')}<ExternalLink className="h-3 w-3" aria-hidden />
            </a>
          )}
          <ul className="space-y-1">
            {[...detail.opponent.players].sort((x, y) => OPPONENT_ROLES.indexOf(x.role) - OPPONENT_ROLES.indexOf(y.role)).map((o) => (
              <li key={o.riotId ?? o.role} className="flex items-center gap-2 text-xs">
                {canEditPrep && onPatch && o.riotId ? (
                  // Picking a role another opponent holds swaps the two, in one call (contract § 2, opponentRoles).
                  <Select value={o.role} onValueChange={(role) => { const roles = opponentRoleChange(detail.opponent!.players, o.riotId!, role as OpponentRole); if (roles.length) patch({ opponentRoles: roles }) }}>
                    <SelectTrigger className="h-6 w-[4.5rem] px-1.5 font-mono text-[10px]" aria-label={t('planning.match.opponentRoleOf', { riotId: o.riotId })}><SelectValue /></SelectTrigger>
                    <SelectContent>{OPPONENT_ROLES.map((r) => <SelectItem key={r} value={r} className="font-mono text-xs">{ROLE_SHORT[r]}</SelectItem>)}</SelectContent>
                  </Select>
                ) : <span className="w-8 font-mono text-[10px] text-hextech-text-dim">{ROLE_SHORT[o.role]}</span>}
                <span className="min-w-0 flex-1 truncate text-hextech-text-bright">{o.riotId ?? '—'}</span>
                {o.opggUrl
                  ? <a href={o.opggUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[11px] text-hextech-text-dim hover:text-hextech-text-bright"
                      aria-label={t('planning.match.opggOf', { riotId: o.riotId })}>OP.GG<ExternalLink className="h-3 w-3" aria-hidden /></a>
                  : canEditSlot && onEdit && <button type="button" onClick={onEdit} className="text-[11px] text-hextech-gold hover:underline">{t('planning.match.fix')}</button>}
              </li>
            ))}
            {detail.opponent.players.length === 0 && <li className="text-xs text-hextech-text-dim">{t('planning.match.noPlayers')}</li>}
          </ul>
        </Block>
      )}

      {/* 4. Links */}
      {(onOpenScouting || onPrepareDraft) && (
        <Block title={t('planning.match.links')}>
          <div className="flex flex-wrap gap-2">
            {onOpenScouting && detail.opponent && <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onOpenScouting}>{t('planning.match.openScouting')}</Button>}
            {onPrepareDraft && <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={onPrepareDraft}><Swords className="h-3 w-3" />{t('planning.match.prepareDraft')}</Button>}
          </div>
        </Block>
      )}

      {/* 5. Preparation */}
      <Block title={t('planning.match.prep')}>
        <ul className="space-y-1">
          {detail.checklist.map((item, i) => (
            <li key={i}>
              <label className="flex items-center gap-2 text-xs text-hextech-text">
                <input type="checkbox" className="h-3.5 w-3.5 accent-hextech-gold" checked={item.done} disabled={!canEditPrep}
                  onChange={(e) => patch({ checklist: detail.checklist.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) })} />
                <span className={cn(item.done && 'text-hextech-text-dim line-through')}>{item.label}</span>
              </label>
            </li>
          ))}
        </ul>
        {canEditPrep && (
          <form className="flex gap-1" onSubmit={(e) => { e.preventDefault(); if (newItem.trim()) { patch({ checklist: [...detail.checklist, { label: newItem.trim(), done: false }] }); setNewItem('') } }}>
            <Input value={newItem} maxLength={200} onChange={(e) => setNewItem(e.target.value)} placeholder={t('planning.match.addItem')} aria-label={t('planning.match.addItem')} className="h-7 text-xs" />
            <Button type="submit" size="sm" variant="outline" className="h-7" aria-label={t('planning.match.addItem')}><Plus className="h-3 w-3" /></Button>
          </form>
        )}
        {canEditPrep ? (
          <Textarea value={prep} rows={3} maxLength={8000} onChange={(e) => setPrep(e.target.value)} placeholder={t('planning.match.prepPlaceholder')}
            aria-label={t('planning.match.prepNotes')} onBlur={() => prep !== (detail.prepNotes ?? '') && patch({ prepNotes: prep.trim() ? prep : null })} />
        ) : detail.prepNotes && <p className="whitespace-pre-wrap text-xs text-hextech-text">{detail.prepNotes}</p>}
      </Block>

      {/* 6. Linked drafts */}
      <Block title={t('planning.match.drafts')}>
        {missing.length > 0 && (
          <div role="status" className="rounded-md border border-amber-400/40 bg-amber-400/10 p-2 text-[11px] text-amber-200">
            {t('web.scrims.missingDrafts', { count: missing.length })}
            {canEditPrep && (
              <button type="button" onClick={() => patch({ draftIds: detail.draftIds.filter((id) => !missing.includes(id)) })} className="ml-2 font-semibold hover:underline">
                {t('web.scrims.clearMissing', { count: missing.length })}
              </button>
            )}
          </div>
        )}
        {linked.length === 0 && missing.length === 0 && <p className="text-xs text-hextech-text-dim">{t('web.scrims.noDraft')}</p>}
        <ul className="space-y-1">
          {linked.map((d) => (
            <li key={d.id} className="flex items-center justify-between text-xs">
              <span className="truncate text-hextech-text-bright">{d.name}</span>
              {canEditPrep && <button type="button" onClick={() => patch({ draftIds: detail.draftIds.filter((x) => x !== d.id) })} className="text-[11px] text-hextech-text-dim hover:text-hextech-red">{t('web.scrims.unlink')}</button>}
            </li>
          ))}
        </ul>
        {canEditPrep && linkable.length > 0 && (
          <Select value="" onValueChange={(id) => patch({ draftIds: [...detail.draftIds, id].slice(0, 10) })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={t('web.scrims.linkDraft')} /></SelectTrigger>
            <SelectContent>{linkable.map((d) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
          </Select>
        )}
      </Block>

      {/* 7. After the match */}
      <Block title={t('planning.match.after')}>
        {canEditPrep ? (
          <Textarea value={review} rows={3} maxLength={8000} onChange={(e) => setReview(e.target.value)} placeholder={t('web.scrims.reviewPlaceholder')}
            aria-label={t('web.scrims.review')} onBlur={() => review !== (detail.reviewNotes ?? '') && patch({ reviewNotes: review.trim() ? review : null })} />
        ) : <p className="whitespace-pre-wrap text-xs text-hextech-text">{detail.reviewNotes || t('web.scrims.noReview')}</p>}
        {canEditPrep && detail.status === 'planned' && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 gap-1 text-xs" onClick={() => patch({ status: 'done' })}><CalendarCheck className="h-3 w-3" />{t('web.scrims.markDone')}</Button>
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => patch({ status: 'cancelled' })}>{t('web.scrims.cancel')}</Button>
          </div>
        )}
        {discussion && <section aria-label={t('planning.match.discussionLabel')}>{discussion}</section>}
      </Block>

      {/* 8. Footer */}
      {canEditSlot && (onEdit || onDelete) && (
        <footer className="flex justify-between border-t border-hextech-border-dim pt-3">
          {onEdit && <Button size="sm" variant="outline" className="gap-1" onClick={onEdit}><Pencil className="h-3.5 w-3.5" />{t('planning.match.edit')}</Button>}
          {onDelete && <Button size="sm" variant="outline" className="gap-1 text-hextech-red hover:bg-hextech-red/10" onClick={() => setConfirmDelete(true)}><Trash2 className="h-3.5 w-3.5" />{t('common.delete')}</Button>}
        </footer>
      )}
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={t('planning.match.deleteTitle')} description={t('planning.match.deleteDesc')}
        confirmLabel={t('common.delete')} onConfirm={() => onDelete?.()} />
    </div>
  )
}
