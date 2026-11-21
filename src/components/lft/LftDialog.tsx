/**
 * Looking-for-team announcement builder (Espace d'équipe): pick one roster
 * player (solo) or several searching together (multi search, a lobby with
 * the searched seats marked "+"), fill what the announcement says, see it,
 * then copy it or save it as a PNG at its full size.
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, Copy, Download, Loader2, Plus, RefreshCw, User, Users, X } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { RoleGlyph } from '@/components/team/RoleGlyph'
import { useToast } from '@/hooks/useToast'
import { useDdragonVersion } from '@/hooks/useChampionIconUrl'
import type { Team, TeamMember } from '@/lib/ipc'
import {
  asLftRole, assignSeat, cleanLine, cleanTraits, pickTrait, toggleTrait, LFT_TRAITS, type TraitPicks, commonRegion, joinLobby, leaveLobby, parseTags, toggleTag, wantedRoles,
  LFT_FORMATS, LFT_LIMITS, LFT_ROLES, MAX_SEARCHERS,
  type LftFormat, type LftMode, type LftRole, type SeatRoles,
} from '@/lib/lftCore'
import { displayRank, rankLabel, type MemberRankResult } from '@/lib/rankCore'
import { cn } from '@/lib/utils'
import { LftPoster } from './LftPoster'
import { accentOf, LFT_ACCENTS, type LftAccentId } from './theme'
import { exportPoster } from './exportPoster'
import { playerView, useChampionNames, useLookSources, useMemberRanks, type SkinChoice } from './useLftData'
import type { LftContent, LftDesign, LftPlayerView } from './types'
import { Slider } from '@/components/ui/slider'
import { CardPatternThumb } from '@/components/team/CardLookButton'
import { CARD_BACKGROUNDS, CARD_LOOK_LIMITS, DEFAULT_CARD_LOOK, sanitizeCardLook, type CardLook } from '@/lib/cardLookCore'
import { fundamentalCatalog, fundamentalLabel, isFundamentalId } from './fundamentals'
import { LftCardPicker, hostedCutouts } from './LftCardPicker'
import { skinLocale } from '@/lib/cardChampionView'
import type { CardSkin } from '@/lib/collab'

type PosterLang = 'fr' | 'en'

interface Draft {
  mode: LftMode
  format: LftFormat
  accent: LftAccentId
  lang: PosterLang
  soloId: string | null
  /** Multi search: seat of each searching player. */
  seats: SeatRoles
  /** Free seats the user doesn't search. */
  unwanted: LftRole[]
  /** Skin of each player's first champion, by member id. */
  skins: Record<string, SkinChoice>
  /** Strengths / weaknesses of each player (fundamental ids), by member id. */
  traits: Record<string, TraitPicks>
  /** Multi search: strengths wanted and minimum required (fundamental ids). */
  profile: { strengths: string[]; required: string[] }
  design: LftDesign
  lookingFor: string
  languages: string
  discord: string
  tags: string[]
  message: string
}

const TAG_PRESETS = ['team5', 'tryhard', 'tournaments', 'scrims', 'duo', 'clash'] as const

const draftKey = (teamId: string) => `ascend_lft_draft:${teamId}`
const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : undefined)

/** The last announcement of this team, so the next one starts from it.
 *  Per device only (a convenience). */
function loadDraft(teamId: string, fallback: Draft): Draft {
  try {
    const raw = JSON.parse(localStorage.getItem(draftKey(teamId)) ?? 'null') as Record<string, unknown> | null
    if (!raw || typeof raw !== 'object') return fallback
    const seats: SeatRoles = {}
    if (raw.seats && typeof raw.seats === 'object') {
      for (const [id, r] of Object.entries(raw.seats as Record<string, unknown>)) {
        const role = asLftRole(typeof r === 'string' ? r : null)
        if (role) seats[id] = role
      }
    }
    return {
      mode: raw.mode === 'multi' ? 'multi' : 'solo',
      format: raw.format === 'card' ? 'card' : 'banner',
      accent: accentOf(str(raw.accent, 20)).id,
      lang: raw.lang === 'en' || raw.lang === 'fr' ? raw.lang : fallback.lang,
      soloId: str(raw.soloId, 64) ?? fallback.soloId,
      seats,
      skins: readSkins(raw.skins),
      design: readDesign(raw.design),
      traits: readTraits(raw.traits),
      profile: {
        strengths: cleanTraits((raw.profile as { strengths?: unknown } | undefined)?.strengths, isFundamentalId, LFT_TRAITS.wanted),
        required: cleanTraits((raw.profile as { required?: unknown } | undefined)?.required, isFundamentalId, LFT_TRAITS.required),
      },
      unwanted: Array.isArray(raw.unwanted) ? raw.unwanted.map((r) => asLftRole(typeof r === 'string' ? r : null)).filter((r): r is LftRole => !!r) : [],
      lookingFor: str(raw.lookingFor, 200) ?? fallback.lookingFor,
      languages: str(raw.languages, 200) ?? fallback.languages,
      discord: str(raw.discord, 100) ?? fallback.discord,
      tags: parseTags(Array.isArray(raw.tags) ? raw.tags.filter((x): x is string => typeof x === 'string') : []),
      message: str(raw.message, 600) ?? fallback.message,
    }
  } catch {
    return fallback
  }
}

function readSkins(v: unknown): Record<string, SkinChoice> {
  const out: Record<string, SkinChoice> = {}
  if (!v || typeof v !== 'object') return out
  for (const [id, c] of Object.entries(v as Record<string, unknown>)) {
    const { key, num } = (c ?? {}) as { key?: unknown; num?: unknown }
    if (typeof key === 'string' && /^[A-Za-z0-9]{1,40}$/.test(key) && typeof num === 'number' && Number.isInteger(num) && num >= 0) out[id] = { key, num }
  }
  return out
}

const DEFAULT_DESIGN: LftDesign = {
  art: 'splash',
  look: DEFAULT_CARD_LOOK,
  show: { rankDetails: true, mains: true, champStats: true, frame: true, region: true },
  kicker: '',
  title: '',
  championCount: 5,
}
const SHOW_KEYS = Object.keys(DEFAULT_DESIGN.show) as Array<keyof LftDesign['show']>

function readDesign(v: unknown): LftDesign {
  const r = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof LftDesign, unknown>>
  const show = (r.show && typeof r.show === 'object' ? r.show : {}) as Record<string, unknown>
  const count = typeof r.championCount === 'number' ? Math.round(r.championCount) : 5
  return {
    art: r.art === 'pattern' ? 'pattern' : 'splash',
    look: sanitizeCardLook(r.look),
    show: Object.fromEntries(SHOW_KEYS.map((k) => [k, typeof show[k] === 'boolean' ? show[k] : true])) as LftDesign['show'],
    kicker: cleanLine(typeof r.kicker === 'string' ? r.kicker : '', LFT_LIMITS.lookingFor),
    title: cleanLine(typeof r.title === 'string' ? r.title : '', LFT_LIMITS.lookingFor),
    championCount: Math.min(5, Math.max(3, count)),
  }
}

function readTraits(v: unknown): Record<string, TraitPicks> {
  const out: Record<string, TraitPicks> = {}
  if (!v || typeof v !== 'object') return out
  for (const [id, p] of Object.entries(v as Record<string, unknown>)) {
    const { strengths, weaknesses } = (p ?? {}) as { strengths?: unknown; weaknesses?: unknown }
    out[id] = { strengths: cleanTraits(strengths, isFundamentalId, LFT_TRAITS.strengths), weaknesses: cleanTraits(weaknesses, isFundamentalId, LFT_TRAITS.weaknesses) }
  }
  return out
}

function saveDraft(teamId: string, draft: Draft) {
  try {
    localStorage.setItem(draftKey(teamId), JSON.stringify(draft))
  } catch {
    /* private mode or full storage: the next announcement starts blank */
  }
}

const roleRank = (m: TeamMember) => {
  const r = asLftRole(m.role)
  return r ? LFT_ROLES.indexOf(r) : LFT_ROLES.length
}

interface LftDialogProps {
  team: Team
  open: boolean
  onOpenChange: (open: boolean) => void
  /** § 18.2, a player without a group (lftMySolo): their rank, read by the main process — no roster ranks request. */
  soloRank?: MemberRankResult
  /** Pre-fills « Looking for » (the player's role). */
  lookingFor?: string
}

export function LftDialog({ team, open, onOpenChange, soloRank, lookingFor }: LftDialogProps) {
  const { t, i18n } = useTranslation()
  const { toast } = useToast()
  const version = useDdragonVersion()
  const nameOf = useChampionNames()
  const looks = useLookSources(open)
  const fetchedRanks = useMemberRanks(team.id, open && !soloRank)
  const soloId = team.members?.[0]?.id
  const ranks = soloRank && soloId ? { ...fetchedRanks, results: { [soloId]: soloRank }, loading: false, available: false } : fetchedRanks

  const members = useMemo(
    () => [...(team.members ?? [])].sort((a, b) => roleRank(a) - roleRank(b) || a.displayName.localeCompare(b.displayName)),
    [team.members],
  )
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members])

  const [draft, setDraft] = useState<Draft>(() => {
    const lang: PosterLang = i18n.language?.startsWith('fr') ? 'fr' : 'en'
    const fallback: Draft = {
      mode: 'solo', format: 'banner', accent: 'gold', lang, soloId: members[0]?.id ?? null, seats: {}, unwanted: [], skins: {}, traits: {}, profile: { strengths: [], required: [] }, design: DEFAULT_DESIGN,
      lookingFor: lookingFor ?? '', languages: lang === 'fr' ? 'Français' : 'English', discord: '', tags: [], message: '',
    }
    const d = loadDraft(team.id, fallback)
    // Players that left the roster since.
    const seats = Object.fromEntries(Object.entries(d.seats).filter(([id]) => memberById.has(id)))
    return { ...d, soloId: d.soloId && memberById.has(d.soloId) ? d.soloId : fallback.soloId, seats }
  })
  useEffect(() => saveDraft(team.id, draft), [team.id, draft])
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }))
  // 21/11 (spec § 22): the hosted cut-outs of the art champions, so the poster draws them over the card background.
  const [cutouts, setCutouts] = useState<Record<string, CardSkin[]>>({})

  const posterT = useMemo(() => i18n.getFixedT(draft.lang), [i18n, draft.lang])
  const accent = accentOf(draft.accent)

  const basePlayers: LftPlayerView[] = useMemo(() => {
    const ctx = (m: TeamMember) => ({ rank: ranks.results[m.id], ranksLoading: ranks.loading, looks, nameOf, skin: draft.skins[m.id], traits: draft.traits[m.id], lang: draft.lang })
    if (draft.mode === 'solo') {
      const m = draft.soloId ? memberById.get(draft.soloId) : undefined
      return m ? [playerView(m, asLftRole(m.role) ?? 'MID', ctx(m))] : []
    }
    return Object.entries(draft.seats)
      .map(([id, seat]) => {
        const m = memberById.get(id)
        return m ? playerView(m, seat, ctx(m)) : null
      })
      .filter((p): p is LftPlayerView => !!p)
      .sort((a, b) => LFT_ROLES.indexOf(a.role) - LFT_ROLES.indexOf(b.role))
  }, [draft.mode, draft.soloId, draft.seats, draft.skins, draft.traits, draft.lang, memberById, ranks.results, ranks.loading, looks, nameOf])
  const artKeys = basePlayers.map((p) => p.artKey).filter((k): k is string => !!k).join(',')
  useEffect(() => {
    let alive = true
    const locale = skinLocale(i18n.language)
    for (const key of artKeys ? artKeys.split(',') : []) {
      if (cutouts[key]) continue
      void hostedCutouts(key, locale).then((list) => { if (alive) setCutouts((c) => ({ ...c, [key]: list })) })
    }
    return () => { alive = false }
  }, [artKeys, i18n.language]) // eslint-disable-line react-hooks/exhaustive-deps -- once per champion
  const players: LftPlayerView[] = useMemo(() => basePlayers.map((p) => ({
    ...p,
    artCutoutUrl: p.artKey ? cutouts[p.artKey]?.find((s) => s.num === p.skin)?.url ?? null : null,
  })), [basePlayers, cutouts])

  const wanted = draft.mode === 'multi' ? wantedRoles(draft.seats, draft.unwanted) : []
  const content: LftContent = {
    lookingFor: cleanLine(draft.lookingFor, LFT_LIMITS.lookingFor),
    languages: cleanLine(draft.languages, LFT_LIMITS.languages),
    discord: cleanLine(draft.discord, LFT_LIMITS.discord),
    tags: draft.tags,
    message: cleanLine(draft.message, LFT_LIMITS.message),
  }
  const region = commonRegion(players.map((p) => p.region))
  const profile = draft.mode === 'multi'
    ? { strengths: draft.profile.strengths.map((f) => fundamentalLabel(f, draft.lang)), required: draft.profile.required.map((f) => fundamentalLabel(f, draft.lang)) }
    : { strengths: [], required: [] }
  const traitsOf = (id: string): TraitPicks => draft.traits[id] ?? { strengths: [], weaknesses: [] }
  const setTrait = (id: string, kind: keyof TraitPicks, f: string) => setDraft((d) => ({ ...d, traits: { ...d.traits, [id]: pickTrait(d.traits[id] ?? { strengths: [], weaknesses: [] }, kind, f) } }))
  const { width, height } = LFT_FORMATS[draft.format]

  const setMode = (mode: LftMode) => setDraft((d) => {
    if (mode === d.mode) return d
    // The solo player starts the multi search, and the other way round.
    if (mode === 'multi' && Object.keys(d.seats).length === 0 && d.soloId) {
      const m = memberById.get(d.soloId)
      return { ...d, mode, seats: m ? joinLobby({}, m) : {} }
    }
    if (mode === 'solo' && !d.soloId) return { ...d, mode, soloId: Object.keys(d.seats)[0] ?? members[0]?.id ?? null }
    return { ...d, mode }
  })

  const pickMember = (m: TeamMember) => setDraft((d) => {
    if (d.mode === 'solo') return { ...d, soloId: m.id }
    if (d.seats[m.id]) return { ...d, seats: leaveLobby(d.seats, m.id) }
    if (Object.keys(d.seats).length >= MAX_SEARCHERS) return d
    return { ...d, seats: joinLobby(d.seats, m) }
  })

  const posterBox = useRef<HTMLDivElement>(null)
  const [busy, setBusy] = useState<'save' | 'copy' | null>(null)
  const runExport = async (action: 'save' | 'copy') => {
    const node = posterBox.current?.querySelector<HTMLElement>('[data-lft-poster]')
    if (!node || players.length === 0) return
    setBusy(action)
    try {
      const res = await exportPoster(node, { format: draft.format, names: players.map((p) => p.name), action })
      if (action === 'copy') toast({ title: t('team.lft.copied'), description: t('team.lft.copiedDesc') })
      else if (res.filePath) toast({ title: t('team.lft.saved'), description: t('team.lft.savedDesc', { path: res.filePath }) })
      else toast({ title: t('team.lft.copied'), description: t('team.lft.saveCancelled') })
    } catch (err) {
      toast({ title: t('team.lft.exportFailed'), description: (err as Error).message, variant: 'destructive' })
    } finally {
      setBusy(null)
    }
  }

  const notices = noticesFor(players, ranks, t)
  const canExport = players.length > 0 && !!window.api.lftExportPng

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92vh] w-[96vw] max-w-[1240px] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-hextech-border-dim px-6 py-4 pr-12">
          <DialogTitle>{t('team.lft.title')}</DialogTitle>
          <DialogDescription>{t('team.lft.desc')}</DialogDescription>
        </DialogHeader>

        {members.length === 0 ? (
          <p className="px-6 py-10 text-center text-sm text-hextech-text-dim">{t('team.lft.noPlayers')}</p>
        ) : (
          <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[340px_minmax(0,1fr)]">
            <aside className="min-h-0 space-y-5 overflow-y-auto border-b border-hextech-border-dim p-5 md:border-b-0 md:border-r">
              <Segmented
                label={t('team.lft.modeLabel')}
                value={draft.mode}
                onChange={(v) => setMode(v)}
                options={[
                  { value: 'solo', label: t('team.lft.mode.solo'), icon: <User className="h-3.5 w-3.5" /> },
                  { value: 'multi', label: t('team.lft.mode.multi'), icon: <Users className="h-3.5 w-3.5" /> },
                ]}
              />
              <p className="-mt-3 text-xs leading-relaxed text-hextech-text-dim">{t(draft.mode === 'solo' ? 'team.lft.mode.soloHint' : 'team.lft.mode.multiHint')}</p>

              <Section title={t('team.lft.players')} hint={draft.mode === 'multi' ? t('team.lft.playersHintMulti', { max: MAX_SEARCHERS }) : undefined}>
                <ul className="space-y-1.5">
                  {members.map((m) => (
                    <MemberRow
                      key={m.id}
                      member={m}
                      mode={draft.mode}
                      selected={draft.mode === 'solo' ? draft.soloId === m.id : !!draft.seats[m.id]}
                      full={Object.keys(draft.seats).length >= MAX_SEARCHERS}
                      seat={draft.seats[m.id]}
                      rank={ranks.results[m.id]}
                      ranksLoading={ranks.loading}
                      onPick={() => pickMember(m)}
                      onSeat={(r) => set({ seats: assignSeat(draft.seats, m.id, r) })}
                      skinPicker={(() => {
                        const p = players.find((x) => x.id === m.id)
                        if (!p?.champions.length) return null
                        // 21/11 (spec § 22): like the Lobby card: « Auto » or one of the player's top champions, then its cut-out skin.
                        return (
                          <LftCardPicker player={p} value={draft.skins[m.id] ?? null} version={version}
                            onChange={(next) => { const skins = { ...draft.skins }; if (next) skins[m.id] = next; else delete skins[m.id]; set({ skins }) }} />
                        )
                      })()}
                      traitPicker={
                        <div className="ml-7 mt-1.5 space-y-1.5">
                          <TraitPicker label={t('team.lft.traits.strengths', { max: LFT_TRAITS.strengths })} value={traitsOf(m.id).strengths} max={LFT_TRAITS.strengths} lang={draft.lang} onToggle={(f) => setTrait(m.id, 'strengths', f)} />
                          <TraitPicker label={t('team.lft.traits.weaknesses', { max: LFT_TRAITS.weaknesses })} value={traitsOf(m.id).weaknesses} max={LFT_TRAITS.weaknesses} lang={draft.lang} onToggle={(f) => setTrait(m.id, 'weaknesses', f)} weak />
                        </div>
                      }
                    />
                  ))}
                </ul>
              </Section>

              {draft.mode === 'multi' && (
                <Section title={t('team.lft.wanted')} hint={t('team.lft.wantedHint')}>
                  <div className="grid grid-cols-5 gap-1.5">
                    {LFT_ROLES.map((r) => {
                      const takenBy = Object.entries(draft.seats).find(([, seat]) => seat === r)?.[0]
                      const on = !takenBy && !draft.unwanted.includes(r)
                      const label = t(`team.roster.roles.${r}`)
                      return (
                        <button
                          key={r}
                          type="button"
                          disabled={!!takenBy}
                          aria-pressed={on}
                          title={takenBy ? t('team.lft.seatOf', { name: memberById.get(takenBy)?.displayName ?? '' }) : label}
                          onClick={() => set({ unwanted: on ? [...draft.unwanted, r] : draft.unwanted.filter((x) => x !== r) })}
                          className={cn(
                            'relative flex flex-col items-center gap-1 rounded-md border px-1 py-2 text-[10px] font-semibold uppercase tracking-wide transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hextech-gold',
                            takenBy
                              ? 'cursor-default border-hextech-border-dim bg-hextech-black/30 text-hextech-text-dim'
                              : on
                                ? 'border-hextech-gold/80 bg-hextech-gold/10 text-hextech-gold-bright'
                                : 'border-dashed border-hextech-border-dim text-hextech-text-dim hover:border-hextech-border',
                          )}
                        >
                          <RoleGlyph role={r} className="h-5 w-5" />
                          <span className="max-w-full truncate">{label}</span>
                          {on && <Plus className="absolute right-1 top-1 h-3 w-3" aria-hidden />}
                          {takenBy && <Check className="absolute right-1 top-1 h-3 w-3" aria-hidden />}
                        </button>
                      )
                    })}
                  </div>
                </Section>
              )}

              {draft.mode === 'multi' && (
                <Section title={t('team.lft.traits.profile')} hint={t('team.lft.traits.profileHint')}>
                  <div className="space-y-2">
                    <TraitPicker
                      label={t('team.lft.traits.wantedStrengths', { max: LFT_TRAITS.wanted })}
                      value={draft.profile.strengths}
                      max={LFT_TRAITS.wanted}
                      lang={draft.lang}
                      onToggle={(f) => set({ profile: { ...draft.profile, strengths: toggleTrait(draft.profile.strengths, f, LFT_TRAITS.wanted) } })}
                    />
                    <TraitPicker
                      label={t('team.lft.traits.required', { max: LFT_TRAITS.required })}
                      value={draft.profile.required}
                      max={LFT_TRAITS.required}
                      lang={draft.lang}
                      onToggle={(f) => set({ profile: { ...draft.profile, required: toggleTrait(draft.profile.required, f, LFT_TRAITS.required) } })}
                    />
                  </div>
                </Section>
              )}

              <Section title={t('team.lft.format')}>
                <div className="grid grid-cols-2 gap-2">
                  {(['banner', 'card'] as const).map((f) => (
                    <button
                      key={f}
                      type="button"
                      aria-pressed={draft.format === f}
                      onClick={() => set({ format: f })}
                      className={cn(
                        'flex items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hextech-gold',
                        draft.format === f ? 'border-hextech-gold/80 bg-hextech-gold/10' : 'border-hextech-border-dim hover:border-hextech-border',
                      )}
                    >
                      <span className={cn('shrink-0 rounded-sm border', draft.format === f ? 'border-hextech-gold bg-hextech-gold/20' : 'border-hextech-border')} style={{ width: 32, height: f === 'banner' ? 18 : 16 }} aria-hidden />
                      <span className="min-w-0">
                        <span className="block text-xs font-semibold text-hextech-text-bright">{t(`team.lft.formats.${f}`)}</span>
                        <span className="block font-mono text-[10px] text-hextech-text-dim">{LFT_FORMATS[f].width}×{LFT_FORMATS[f].height}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </Section>

              <div className="grid grid-cols-[1fr_auto] items-end gap-4">
                <Section title={t('team.lft.accent')}>
                  <div className="flex gap-2">
                    {LFT_ACCENTS.map((a) => (
                      <button
                        key={a.id}
                        type="button"
                        aria-pressed={draft.accent === a.id}
                        aria-label={t(`team.lft.accents.${a.id}`)}
                        title={t(`team.lft.accents.${a.id}`)}
                        onClick={() => set({ accent: a.id })}
                        className={cn('h-7 w-7 rounded-full border-2 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold', draft.accent === a.id ? 'scale-110 border-white' : 'border-transparent hover:scale-105')}
                        style={{ background: `linear-gradient(135deg, ${a.soft}, ${a.main} 55%, ${a.deep})` }}
                      />
                    ))}
                  </div>
                </Section>
                <Segmented
                  label={t('team.lft.language')}
                  value={draft.lang}
                  onChange={(v) => set({ lang: v })}
                  options={[{ value: 'fr', label: 'FR' }, { value: 'en', label: 'EN' }]}
                />
              </div>

              <DesignSection
                design={draft.design}
                multi={draft.mode === 'multi'}
                onChange={(patch) => setDraft((d) => ({ ...d, design: { ...d.design, ...patch } }))}
              />

              <Section title={t('team.lft.content')}>
                <div className="space-y-2.5">
                  <Field label={t('team.lft.fields.lookingFor')}>
                    <Input value={draft.lookingFor} maxLength={LFT_LIMITS.lookingFor} placeholder={posterT('team.lft.placeholders.lookingFor')} onChange={(e) => set({ lookingFor: e.target.value })} />
                  </Field>
                  <Field label={t('team.lft.fields.languages')}>
                    <Input value={draft.languages} maxLength={LFT_LIMITS.languages} placeholder={posterT('team.lft.placeholders.languages')} onChange={(e) => set({ languages: e.target.value })} />
                  </Field>
                  <Field label={t('team.lft.fields.discord')}>
                    <Input value={draft.discord} maxLength={LFT_LIMITS.discord} placeholder={t('team.lft.placeholders.discord')} onChange={(e) => set({ discord: e.target.value })} />
                  </Field>
                  <Field label={t('team.lft.fields.tags')}>
                    <TagsField
                      tags={draft.tags}
                      onChange={(tags) => set({ tags })}
                      presets={TAG_PRESETS.map((p) => posterT(`team.lft.tagPresets.${p}`))}
                    />
                  </Field>
                  <Field label={t('team.lft.fields.message')} counter={`${draft.message.length}/${LFT_LIMITS.message}`}>
                    <Textarea
                      value={draft.message}
                      maxLength={LFT_LIMITS.message}
                      rows={3}
                      placeholder={posterT('team.lft.placeholders.message')}
                      onChange={(e) => set({ message: e.target.value })}
                      className="resize-none"
                    />
                  </Field>
                </div>
              </Section>
            </aside>

            <section className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto p-5">
              <div className="flex items-center justify-between gap-3">
                <h3 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-hextech-text-dim">
                  {t('team.lft.preview')} · {width}×{height} PNG
                </h3>
                {ranks.available && (
                  <Button size="sm" variant="ghost" className="h-7 gap-1.5 px-2 text-xs" onClick={() => void ranks.reload()} disabled={ranks.loading}>
                    {ranks.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    {t('team.lft.ranks.refresh')}
                  </Button>
                )}
              </div>

              <ScaledPreview width={width} height={height} label={t('team.lft.preview')} boxRef={posterBox}>
                <LftPoster
                  mode={draft.mode}
                  format={draft.format}
                  players={players}
                  wanted={wanted}
                  profile={profile}
                  design={{ ...draft.design, kicker: cleanLine(draft.design.kicker, LFT_LIMITS.lookingFor), title: cleanLine(draft.design.title, LFT_LIMITS.lookingFor) }}
                  region={region}
                  content={content}
                  accent={accent}
                  version={version}
                  t={posterT}
                />
              </ScaledPreview>

              {notices.length > 0 && (
                <ul className="space-y-1">
                  {notices.map((n) => (
                    <li key={n.key} className={cn('flex items-start gap-2 text-xs leading-relaxed', n.tone === 'warn' ? 'text-amber-200/90' : 'text-hextech-text-dim')}>
                      {n.tone === 'busy' ? <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
                      <span>{n.text}</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-1">
                <Button variant="outline" onClick={() => void runExport('copy')} disabled={!canExport || busy !== null}>
                  {busy === 'copy' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Copy className="mr-1.5 h-4 w-4" />}
                  {t('team.lft.copy')}
                </Button>
                <Button onClick={() => void runExport('save')} disabled={!canExport || busy !== null}>
                  {busy === 'save' ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Download className="mr-1.5 h-4 w-4" />}
                  {t('team.lft.save')}
                </Button>
              </div>
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ── Pieces of the form ─────────────────────────────────────────────────────

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-hextech-text-dim">{title}</h3>
      {children}
      {hint && <p className="mt-1.5 text-[11px] leading-relaxed text-hextech-text-dim">{hint}</p>}
    </section>
  )
}

function Field({ label, counter, children }: { label: string; counter?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 flex items-baseline justify-between text-xs text-hextech-text">
        {label}
        {counter && <span className="font-mono text-[10px] text-hextech-text-dim tabular-nums">{counter}</span>}
      </span>
      {children}
    </label>
  )
}

function Segmented<V extends string>({ label, value, onChange, options }: {
  label: string
  value: V
  onChange: (v: V) => void
  options: Array<{ value: V; label: string; icon?: ReactNode }>
}) {
  return (
    <div>
      <div className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-wider text-hextech-text-dim">{label}</div>
      <div role="radiogroup" aria-label={label} className="flex rounded-md border border-hextech-border-dim bg-hextech-black/40 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            onClick={() => onChange(o.value)}
            className={cn(
              'flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hextech-gold',
              value === o.value ? 'bg-hextech-gold/15 text-hextech-gold-bright' : 'text-hextech-text-dim hover:text-hextech-text-bright',
            )}
          >
            {o.icon}
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function RankChip({ result, loading }: { result: MemberRankResult | undefined; loading: boolean }) {
  const { t } = useTranslation()
  if (!result) {
    return loading ? <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-hextech-text-dim" aria-label={t('team.lft.ranks.loading')} /> : null
  }
  if (result.status !== 'ok') {
    const text = result.status === 'no-riot-id' ? t('team.lft.ranks.noRiotIdShort') : t('team.lft.ranks.errorShort')
    return <span title={result.status === 'error' ? result.message : undefined} className="shrink-0 font-mono text-[10px] text-hextech-text-dim">{text}</span>
  }
  const rank = displayRank(result.ranks)
  return (
    <span className="shrink-0 font-mono text-[10px] text-hextech-text">
      {rankLabel(rank, { tierName: (tier) => t(`team.lft.tiers.${tier}`), unranked: t('team.lft.poster.unranked') })}
    </span>
  )
}

function MemberRow({ member, mode, selected, full, seat, rank, ranksLoading, onPick, onSeat, skinPicker, traitPicker }: {
  member: TeamMember
  mode: LftMode
  selected: boolean
  full: boolean
  seat: LftRole | undefined
  rank: MemberRankResult | undefined
  ranksLoading: boolean
  onPick: () => void
  onSeat: (role: LftRole) => void
  /** Shown under the row while the player is in the announcement. */
  skinPicker?: ReactNode
  traitPicker?: ReactNode
}) {
  const { t } = useTranslation()
  const role = asLftRole(member.role)
  const disabled = mode === 'multi' && !selected && full
  const riotId = member.ign ? `${member.ign}${member.tagLine ? `#${member.tagLine}` : ''}` : t('team.lft.noRiotId')
  return (
    <li>
      <button
        type="button"
        onClick={onPick}
        disabled={disabled}
        aria-pressed={selected}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hextech-gold disabled:cursor-not-allowed disabled:opacity-40',
          selected ? 'border-hextech-gold/70 bg-hextech-gold/10' : 'border-hextech-border-dim bg-hextech-black/30 hover:border-hextech-border',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'flex h-4 w-4 shrink-0 items-center justify-center border',
            mode === 'solo' ? 'rounded-full' : 'rounded',
            selected ? 'border-hextech-gold bg-hextech-gold text-hextech-black' : 'border-hextech-border',
          )}
        >
          {selected && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
        {role ? <RoleGlyph role={role} className="h-4 w-4 text-hextech-text-dim" /> : <span className="h-4 w-4" />}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-hextech-text-bright">{member.displayName}</span>
          <span className="block truncate font-mono text-[10px] text-hextech-text-dim">{riotId}</span>
        </span>
        <RankChip result={rank} loading={ranksLoading} />
      </button>
      {mode === 'multi' && selected && (
        <div className="ml-7 mt-1 flex items-center gap-1" role="radiogroup" aria-label={t('team.lft.seat', { name: member.displayName })}>
          <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim">{t('team.lft.seatLabel')}</span>
          {LFT_ROLES.map((r) => (
            <button
              key={r}
              type="button"
              role="radio"
              aria-checked={seat === r}
              title={t(`team.roster.roles.${r}`)}
              onClick={() => onSeat(r)}
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded border transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hextech-gold',
                seat === r ? 'border-hextech-gold bg-hextech-gold/15 text-hextech-gold-bright' : 'border-hextech-border-dim text-hextech-text-dim hover:text-hextech-text-bright',
              )}
            >
              <RoleGlyph role={r} className="h-3.5 w-3.5" />
            </button>
          ))}
        </div>
      )}
      {selected && skinPicker}
      {selected && traitPicker}
    </li>
  )
}

function TagsField({ tags, onChange, presets }: { tags: string[]; onChange: (tags: string[]) => void; presets: string[] }) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const add = () => {
    if (!text.trim()) return
    onChange(parseTags([...tags, ...parseTags(text)]))
    setText('')
  }
  const full = tags.length >= LFT_LIMITS.tags
  return (
    <div className="space-y-1.5">
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={tag} className="inline-flex items-center gap-1 rounded-full border border-hextech-gold/50 bg-hextech-gold/10 py-0.5 pl-2.5 pr-1 text-xs text-hextech-gold-bright">
              {tag}
              <button
                type="button"
                aria-label={t('team.lft.removeTag', { tag })}
                onClick={() => onChange(tags.filter((x) => x !== tag))}
                className="rounded-full p-0.5 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hextech-gold"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
      <Input
        value={text}
        disabled={full}
        maxLength={LFT_LIMITS.tag * 2}
        placeholder={full ? t('team.lft.tagsFull', { max: LFT_LIMITS.tags }) : t('team.lft.placeholders.tags')}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            add()
          }
        }}
        onBlur={add}
      />
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => {
          const on = tags.some((x) => x.toLocaleLowerCase() === p.toLocaleLowerCase())
          return (
            <button
              key={p}
              type="button"
              aria-pressed={on}
              disabled={!on && full}
              onClick={() => onChange(toggleTag(tags, p))}
              className={cn(
                'rounded-full border px-2 py-0.5 text-[11px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hextech-gold disabled:opacity-40',
                on ? 'border-hextech-gold/60 text-hextech-gold-bright' : 'border-hextech-border-dim text-hextech-text-dim hover:text-hextech-text-bright',
              )}
            >
              {on ? '✓ ' : '+ '}{p}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** The announcement at its real size, scaled down to the panel. */
function ScaledPreview({ width, height, label, boxRef, children }: {
  width: number
  height: number
  label: string
  boxRef: RefObject<HTMLDivElement>
  children: ReactNode
}) {
  const outer = useRef<HTMLDivElement>(null)
  const [avail, setAvail] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = outer.current
    if (!el) return
    const measure = () => setAvail({ w: el.clientWidth, h: window.innerHeight * 0.6 })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
    }
  }, [])
  const scale = avail.w > 0 ? Math.min(avail.w / width, avail.h / height) : 0.4
  return (
    <div ref={outer} className="w-full">
      <div
        role="img"
        aria-label={label}
        className="mx-auto overflow-hidden rounded-md border border-hextech-border-dim bg-black shadow-lg"
        style={{ width: Math.round(width * scale), height: Math.round(height * scale) }}
      >
        <div ref={boxRef} style={{ width, height, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
          {children}
        </div>
      </div>
    </div>
  )
}

interface Notice { key: string; text: string; tone: 'busy' | 'warn' | 'info' }

/** What may be missing from the announcement, and why. */
function noticesFor(
  players: LftPlayerView[],
  ranks: { results: Record<string, MemberRankResult>; loading: boolean; failure: string | null },
  t: ReturnType<typeof useTranslation>['t'],
): Notice[] {
  const out: Notice[] = []
  if (ranks.loading) out.push({ key: 'loading', text: t('team.lft.ranks.loading'), tone: 'busy' })
  if (ranks.failure) out.push({ key: 'failure', text: t('team.lft.ranks.failed', { message: ranks.failure }), tone: 'warn' })
  let account = false
  for (const p of players) {
    const r = ranks.results[p.id]
    if (r?.status === 'no-riot-id') out.push({ key: `id-${p.id}`, text: t('team.lft.ranks.noRiotId', { name: p.name }), tone: 'warn' })
    if (r?.status === 'error') {
      if (r.code === 'login' || r.code === 'not-configured') {
        if (!account) out.push({ key: 'account', text: t(r.code === 'login' ? 'team.lft.ranks.login' : 'team.lft.ranks.notConfigured'), tone: 'warn' })
        account = true
      } else {
        out.push({ key: `err-${p.id}`, text: t(r.code === 'not-found' ? 'team.lft.ranks.notFound' : 'team.lft.ranks.error', { name: p.name }), tone: 'warn' })
      }
    }
    if (p.champions.length === 0) out.push({ key: `champ-${p.id}`, text: t('team.lft.noChampions', { name: p.name }), tone: 'info' })
  }
  return out
}

/** Skins of the player's first champion (its art fills the announcement). */
/** Fundamentals as chips, plus a list (by category) to add one. */
function TraitPicker({ label, value, max, lang, onToggle, weak }: {
  label: string
  value: string[]
  max: number
  lang: 'fr' | 'en'
  onToggle: (id: string) => void
  weak?: boolean
}) {
  const { t } = useTranslation()
  const full = value.length >= max
  return (
    <div>
      <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim">{label}</div>
      <div className="flex flex-wrap items-center gap-1">
        {value.map((id) => (
          <span
            key={id}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border py-0.5 pl-2 pr-1 text-[11px]',
              weak ? 'border-hextech-border-dim text-hextech-text' : 'border-hextech-gold/50 bg-hextech-gold/10 text-hextech-gold-bright',
            )}
          >
            {fundamentalLabel(id, lang)}
            <button
              type="button"
              aria-label={t('team.lft.removeTag', { tag: fundamentalLabel(id, lang) })}
              onClick={() => onToggle(id)}
              className="rounded-full p-0.5 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hextech-gold"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {!full && (
          <select
            value=""
            aria-label={label}
            onChange={(e) => { if (e.target.value) onToggle(e.target.value) }}
            className="h-6 max-w-[11rem] rounded-full border border-dashed border-hextech-border-dim bg-hextech-black/40 px-2 text-[11px] text-hextech-text-dim hover:border-hextech-border focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hextech-gold"
          >
            <option value="">{t('team.lft.traits.add')}</option>
            {fundamentalCatalog(lang).map((c) => (
              <optgroup key={c.id} label={c.label}>
                {c.fundamentals.filter((f) => !value.includes(f.id)).map((f) => (
                  <option key={f.id} value={f.id}>{f.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </div>
    </div>
  )
}

/** Background, filters, what to show, custom texts. */
function DesignSection({ design, multi, onChange }: { design: LftDesign; multi: boolean; onChange: (patch: Partial<LftDesign>) => void }) {
  const { t } = useTranslation()
  const setLook = (patch: Partial<CardLook>) => onChange({ look: sanitizeCardLook({ ...design.look, ...patch }) })
  const slider = (label: string, value: number, min: number, max: number, suffix: string, on: (v: number) => void) => (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-hextech-text">{label}</span>
        <span className="font-mono text-hextech-text-dim">{value > 0 && min < 0 ? '+' : ''}{value}{suffix}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={1} onValueChange={([v]) => on(v)} aria-label={label} />
    </div>
  )
  return (
    <Section title={t('team.lft.design.title')}>
      <div className="space-y-3">
        <Segmented
          label={t('team.lft.design.art')}
          value={design.art}
          onChange={(art) => onChange({ art })}
          options={[{ value: 'splash', label: t('team.lft.design.splash') }, { value: 'pattern', label: t('team.lft.design.pattern') }]}
        />
        {design.art === 'pattern' && (
          <div role="radiogroup" aria-label={t('team.lft.design.pattern')} className="grid grid-cols-7 gap-1">
            {CARD_BACKGROUNDS.map((id) => (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={design.look.background === id}
                title={t(`team.cardLook.patterns.${id}`)}
                onClick={() => setLook({ background: id })}
                className={cn('rounded-md border-2 p-px focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-hextech-gold', design.look.background === id ? 'border-hextech-gold' : 'border-transparent hover:border-hextech-border')}
              >
                <CardPatternThumb id={id} look={{ ...design.look, blur: 0 }} className="aspect-[4/7] w-full" />
              </button>
            ))}
          </div>
        )}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] text-hextech-text">
            {t('team.lft.design.filter')}
            <label className="relative ml-auto flex h-5 cursor-pointer items-center gap-1 rounded border border-hextech-border-dim px-1.5 font-mono text-[10px]">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: design.look.tintColor }} />
              {design.look.tintColor}
              <input
                type="color"
                value={design.look.tintColor.toLowerCase()}
                onChange={(e) => setLook({ tintColor: e.target.value, tintStrength: design.look.tintStrength || 40 })}
                className="absolute inset-0 cursor-pointer opacity-0"
                aria-label={t('team.cardLook.filterColor')}
              />
            </label>
          </div>
          <Slider value={[design.look.tintStrength]} min={0} max={100} step={1} onValueChange={([v]) => setLook({ tintStrength: v })} aria-label={t('team.lft.design.filter')} />
        </div>
        {slider(t('team.cardLook.light'), design.look.light, -CARD_LOOK_LIMITS.light, CARD_LOOK_LIMITS.light, '', (light) => setLook({ light }))}
        {slider(t('team.cardLook.blur'), design.look.blur, 0, CARD_LOOK_LIMITS.blur, 'px', (blur) => setLook({ blur }))}

        <div>
          <div className="mb-1 font-mono text-[10px] uppercase tracking-wider text-hextech-text-dim">{t('team.lft.design.show')}</div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1">
            {SHOW_KEYS.map((k) => (
              <label key={k} className="flex cursor-pointer items-center gap-1.5 text-[11px] text-hextech-text">
                <input
                  type="checkbox"
                  checked={design.show[k]}
                  onChange={(e) => onChange({ show: { ...design.show, [k]: e.target.checked } })}
                  className="h-3.5 w-3.5 accent-[#D4A24C]"
                />
                {t(`team.lft.design.shows.${k}`)}
              </label>
            ))}
          </div>
        </div>

        <Segmented
          label={t('team.lft.design.championCount')}
          value={String(design.championCount) as '3' | '4' | '5'}
          onChange={(v) => onChange({ championCount: Number(v) })}
          options={[{ value: '3', label: '3' }, { value: '4', label: '4' }, { value: '5', label: '5' }]}
        />

        <Field label={t('team.lft.design.kicker')}>
          <Input value={design.kicker} maxLength={LFT_LIMITS.lookingFor} placeholder={t('team.lft.design.kickerPlaceholder')} onChange={(e) => onChange({ kicker: e.target.value })} />
        </Field>
        {multi && (
          <Field label={t('team.lft.design.lobbyTitle')}>
            <Input value={design.title} maxLength={LFT_LIMITS.lookingFor} placeholder={t('team.lft.design.lobbyTitlePlaceholder')} onChange={(e) => onChange({ title: e.target.value })} />
          </Field>
        )}
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs text-hextech-text-dim" onClick={() => onChange(DEFAULT_DESIGN)}>
          {t('team.lft.design.reset')}
        </Button>
      </div>
    </Section>
  )
}
