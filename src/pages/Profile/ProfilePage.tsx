import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Lock, Check, X, Sparkles, Trophy, Mountain } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/useToast'
import { useUserStore } from '@/store/useUserStore'
import { cn } from '@/lib/utils'
import {
  BIO_MAX,
  PROFILE_BANNERS,
  PROFILE_ICONS,
  RARITY_STYLE,
  SHOWCASE_MAX,
  TIERS,
  evaluateTitles,
  isTierReached,
  loadProfile,
  saveProfile,
  tierProgress,
  type ProfilePrefs,
  type ProfileStats,
  type TitleState,
} from '@/lib/profile'
import { ProfileCard, TitlePill, TierAvatar } from '@/components/Profile/ProfileCard'

type EditTab = 'icon' | 'banner' | 'titles' | 'bio'
const EDIT_TABS: EditTab[] = ['icon', 'banner', 'titles', 'bio']
const panel = 'rounded-2xl border border-hextech-border-dim/70 panel-surface p-5 shadow-lg backdrop-blur-sm'

export function ProfilePage() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const user = useUserStore((s) => s.user)
  const [stats, setStats] = useState<ProfileStats | null>(null)
  const [saved, setSaved] = useState<ProfilePrefs | null>(() => (user ? loadProfile(user.id) : null))
  const [draft, setDraft] = useState<ProfilePrefs | null>(null)
  const [tab, setTab] = useState<EditTab>('icon')

  useEffect(() => {
    window.api.getProfileStats().then(setStats).catch(() => setStats(null))
  }, [])

  const titles = useMemo(() => (stats && saved ? evaluateTitles(stats, saved.earned) : []), [stats, saved])

  // Remember newly reached titles (so a broken streak never takes one back)
  // and celebrate them once.
  useEffect(() => {
    if (!user || !saved || titles.length === 0) return
    const fresh = titles.filter((x) => x.unlocked && !saved.earned.includes(x.id))
    if (fresh.length === 0) return
    const next = { ...saved, earned: [...saved.earned, ...fresh.map((x) => x.id)] }
    saveProfile(user.id, next)
    setSaved(next)
    // A first visit unlocks everything at once — only toast genuine news.
    if (saved.earned.length > 0) {
      for (const f of fresh) toast({ title: t('profile.newTitle'), description: t(`profile.titles.${f.id}.name`) })
    }
  }, [titles, saved, user, toast, t])

  if (!user || !saved) return null
  const prefs = draft ?? saved
  const tp = tierProgress(user.xp)
  const editing = draft !== null

  const startEdit = () => { setDraft(saved); setTab('icon') }
  const cancel = () => setDraft(null)
  const save = () => {
    if (!draft) return
    saveProfile(user.id, draft)
    setSaved(draft)
    setDraft(null)
    toast({ title: t('profile.saved') })
  }
  const patch = (p: Partial<ProfilePrefs>) => setDraft((d) => (d ? { ...d, ...p } : d))

  const unlockedCount = titles.filter((x) => x.unlocked).length

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-extrabold text-hextech-text-bright">{t('profile.title')}</h1>
          <p className="mt-0.5 text-sm text-hextech-text">{t('profile.subtitle')}</p>
        </div>
        {editing ? (
          <div className="flex gap-2">
            <Button variant="outline" onClick={cancel} className="gap-1.5"><X className="h-4 w-4" />{t('common.cancel')}</Button>
            <Button onClick={save} className="gap-1.5"><Check className="h-4 w-4" />{t('profile.save')}</Button>
          </div>
        ) : (
          <Button onClick={startEdit} className="gap-1.5"><Pencil className="h-4 w-4" />{t('profile.edit')}</Button>
        )}
      </div>

      <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-12">
        <div className="space-y-2 xl:sticky xl:top-4 xl:col-span-5">
          <ProfileCard
            prefs={prefs}
            stats={stats}
            titles={titles}
            displayName={user.displayName || user.summonerName}
            riotId={`${user.summonerName}#${user.tagLine}`}
            mainRole={user.mainRole}
            totalXp={user.xp}
          />
          {editing && <p className="text-center text-[11px] text-hextech-text-dim">{t('profile.livePreview')}</p>}
        </div>

        <div className="space-y-6 xl:col-span-7">
          {editing ? (
            <section className={panel}>
              <div role="tablist" aria-label={t('profile.editTabsLabel')} className="mb-4 flex flex-wrap gap-1 rounded-lg border border-hextech-border-dim p-1">
                {EDIT_TABS.map((id, i) => (
                  <button key={id} id={`profile-tab-${id}`} type="button" role="tab" aria-selected={tab === id} aria-controls="profile-tabpanel"
                    tabIndex={tab === id ? 0 : -1}
                    onClick={() => setTab(id)}
                    onKeyDown={(e) => {
                      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
                      if (!d) return
                      e.preventDefault()
                      const next = EDIT_TABS[(i + d + EDIT_TABS.length) % EDIT_TABS.length]
                      setTab(next)
                      document.getElementById(`profile-tab-${next}`)?.focus()
                    }}
                    className={cn('flex-1 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring', tab === id ? 'bg-hextech-gold text-hextech-black' : 'text-hextech-text hover:text-hextech-text-bright')}>
                    {t(`profile.editTabs.${id}`)}
                  </button>
                ))}
              </div>
              <div id="profile-tabpanel" role="tabpanel" aria-labelledby={`profile-tab-${tab}`}>

              {tab === 'icon' && (
                <div className="grid grid-cols-4 gap-3 sm:grid-cols-5 lg:grid-cols-7">
                  {PROFILE_ICONS.map((icon, i) => {
                    const open = isTierReached(tp.tier.id, icon.unlockTier)
                    const active = prefs.iconId === icon.id
                    return (
                      <button key={icon.id} type="button" aria-disabled={!open || undefined} onClick={() => { if (open) patch({ iconId: icon.id }) }}
                        aria-pressed={active}
                        aria-label={open ? t('profile.iconLabel', { n: i + 1 }) : t('profile.iconLabelLocked', { n: i + 1, tier: t(`profile.tiers.${icon.unlockTier}`) })}
                        title={open ? undefined : t('profile.unlockAt', { tier: t(`profile.tiers.${icon.unlockTier}`) })}
                        className={cn('group relative aspect-square overflow-hidden rounded-xl border-2 transition-all', active ? 'border-hextech-gold shadow-[0_0_16px_rgba(0,0,0,0.4)]' : 'border-transparent hover:border-hextech-border', !open && 'cursor-not-allowed')}>
                        <img src={icon.url} alt="" className={cn('h-full w-full object-cover transition-transform group-hover:scale-105', !open && 'grayscale opacity-35')} />
                        {!open && (
                          <span aria-hidden className="absolute inset-0 flex flex-col items-center justify-center gap-0.5 text-[9px] font-bold uppercase text-hextech-text-bright">
                            <Lock className="h-4 w-4" />{t(`profile.tiers.${icon.unlockTier}`)}
                          </span>
                        )}
                        {active && <Check className="absolute right-1 top-1 h-4 w-4 rounded-full bg-hextech-gold p-0.5 text-hextech-black" />}
                      </button>
                    )
                  })}
                </div>
              )}

              {tab === 'banner' && (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {PROFILE_BANNERS.map((b) => {
                    const active = prefs.bannerId === b.id
                    return (
                      <button key={b.id} type="button" aria-pressed={active} onClick={() => patch({ bannerId: b.id })}
                        className={cn('relative h-16 overflow-hidden rounded-lg border-2 transition-all', active ? 'border-hextech-gold' : 'border-transparent hover:border-hextech-border')}>
                        {b.url ? <img src={b.url} alt="" className="h-full w-full object-cover" /> : <div className="h-full w-full bg-gradient-to-br from-hextech-gold/40 via-hextech-elevated to-hextech-cyan/30" />}
                        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1 pt-3 text-left text-[10px] font-medium text-white">{t(`profile.banners.${b.id}`)}</span>
                        {active && <Check className="absolute right-1 top-1 h-4 w-4 rounded-full bg-hextech-gold p-0.5 text-hextech-black" />}
                      </button>
                    )
                  })}
                </div>
              )}

              {tab === 'titles' && (
                <TitlePicker titles={titles} prefs={prefs} onChange={patch} />
              )}

              {tab === 'bio' && (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-hextech-text-bright">{t('profile.bioLabel')}</label>
                  <Textarea value={prefs.bio} maxLength={BIO_MAX} rows={3} placeholder={t('profile.bioPlaceholder')} onChange={(e) => patch({ bio: e.target.value })} />
                  <p className="text-right font-mono text-[10px] text-hextech-text-dim">{prefs.bio.length}/{BIO_MAX}</p>
                </div>
              )}
              </div>
            </section>
          ) : (
            <TierPath currentTierId={tp.tier.id} level={tp.level} iconId={prefs.iconId} />
          )}

          <section className={panel}>
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-bold text-hextech-text-bright">
                <Trophy className="h-4 w-4 text-hextech-gold" /> {t('profile.titlesHeading')}
              </h3>
              <span className="font-mono text-xs text-hextech-text-dim">{unlockedCount} / {titles.length}</span>
            </div>
            {titles.length === 0 ? (
              <p className="py-6 text-center text-xs text-hextech-text-dim">{t('profile.loadingStats')}</p>
            ) : (
              // Unlocked first, then the closest to unlocking; 12 at most, in a short scrolling box.
              <div className="grid max-h-[17rem] grid-cols-1 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {[...titles].sort((a, b) => Number(b.unlocked) - Number(a.unlocked) || b.progress - a.progress).slice(0, TITLES_SHOWN).map((title) => (
                  <TitleRow key={title.id} title={title} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

/** Titles listed in the Profile's titles block. */
const TITLES_SHOWN = 12

function TitleRow({ title }: { title: TitleState }) {
  const { t } = useTranslation()
  const s = RARITY_STYLE[title.rarity]
  return (
    <div className={cn('rounded-xl border px-3 py-2 transition-colors', !title.unlocked && 'opacity-60')} style={{ borderColor: title.unlocked ? s.border : undefined, backgroundColor: title.unlocked ? s.bg : undefined }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold" style={{ color: title.unlocked ? s.text : undefined }}>
            {!title.unlocked && <Lock className="mr-1 inline h-3 w-3 text-hextech-text-dim" />}
            {t(`profile.titles.${title.id}.name`)}
          </p>
          <p className="text-[11px] text-hextech-text-dim">{t(`profile.titles.${title.id}.desc`, { count: title.threshold })}</p>
        </div>
        <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider" style={{ color: s.text }}>{t(`profile.rarity.${title.rarity}`)}</span>
      </div>
      {!title.unlocked && (
        <div className="mt-2 flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-hextech-elevated">
            <div className="h-full rounded-full" style={{ width: `${title.progress}%`, backgroundColor: s.text }} />
          </div>
          <span className="font-mono text-[10px] text-hextech-text-dim">{Math.min(title.value, title.threshold)}/{title.threshold}</span>
        </div>
      )}
    </div>
  )
}

function TitlePicker({ titles, prefs, onChange }: { titles: TitleState[]; prefs: ProfilePrefs; onChange: (p: Partial<ProfilePrefs>) => void }) {
  const { t } = useTranslation()
  const unlocked = titles.filter((x) => x.unlocked)
  if (unlocked.length === 0) return <p className="py-6 text-center text-xs text-hextech-text-dim">{t('profile.noTitlesYet')}</p>

  const toggleShowcase = (id: string) => {
    const has = prefs.showcase.includes(id)
    if (has) onChange({ showcase: prefs.showcase.filter((x) => x !== id) })
    else if (prefs.showcase.length < SHOWCASE_MAX) onChange({ showcase: [...prefs.showcase, id] })
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-2 text-xs font-medium text-hextech-text-bright">{t('profile.equipTitle')}</p>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onChange({ titleId: null })} className={cn('rounded-md border px-2 py-0.5 text-[11px]', prefs.titleId === null ? 'border-hextech-gold text-hextech-gold-bright' : 'border-hextech-border-dim text-hextech-text-dim')}>
            {t('profile.noTitle')}
          </button>
          {unlocked.map((x) => (
            <button key={x.id} onClick={() => onChange({ titleId: x.id })} className={cn('rounded-md ring-offset-2 ring-offset-hextech-dark transition', prefs.titleId === x.id && 'ring-2 ring-hextech-gold')}>
              <TitlePill title={x} />
            </button>
          ))}
        </div>
      </div>
      <div>
        <p className="mb-2 text-xs font-medium text-hextech-text-bright">{t('profile.showcasePick', { count: SHOWCASE_MAX })} <span className="font-mono text-hextech-text-dim">({prefs.showcase.length}/{SHOWCASE_MAX})</span></p>
        <div className="flex flex-wrap gap-2">
          {unlocked.map((x) => {
            const on = prefs.showcase.includes(x.id)
            return (
              <button key={x.id} onClick={() => toggleShowcase(x.id)} disabled={!on && prefs.showcase.length >= SHOWCASE_MAX}
                className={cn('flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] transition disabled:opacity-40', on ? 'border-hextech-gold bg-hextech-gold/10 text-hextech-gold-bright' : 'border-hextech-border-dim text-hextech-text')}>
                {on && <Check className="h-3 w-3" />}{t(`profile.titles.${x.id}.name`)}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** Iron → Master ladder: where the player is, and which icons each tier unlocks. */
function TierPath({ currentTierId, level, iconId }: { currentTierId: string; level: number; iconId: string }) {
  const { t } = useTranslation()
  const currentIdx = TIERS.findIndex((x) => x.id === currentTierId)
  return (
    <section className={panel}>
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-hextech-text-bright">
        <Mountain className="h-4 w-4 text-hextech-gold" /> {t('profile.path.title')}
      </h3>
      <p className="mb-5 text-[11px] text-hextech-text-dim">{t('profile.path.desc')}</p>
      <div className="relative">
        <div className="absolute left-0 right-0 top-6 h-0.5 bg-hextech-border-dim" />
        <div className="absolute left-0 top-6 h-0.5 bg-gradient-to-r from-hextech-gold/40 to-hextech-gold" style={{ width: `${(currentIdx / (TIERS.length - 1)) * 100}%` }} />
        <div className="relative grid grid-cols-8 gap-1">
          {TIERS.map((tier, i) => {
            const reached = i <= currentIdx
            const current = i === currentIdx
            const unlocks = PROFILE_ICONS.filter((ic) => ic.unlockTier === tier.id && tier.id !== 'recrue')
            return (
              <div key={tier.id} className="flex flex-col items-center text-center">
                {current ? (
                  <TierAvatar iconId={iconId} tier={tier} level={level} size={48} />
                ) : (
                  <span className={cn('mt-2 h-8 w-8 rotate-45 rounded-md border-2', !reached && 'opacity-40')}
                    style={{ borderColor: tier.to, background: reached ? `linear-gradient(135deg, ${tier.to}, ${tier.from})` : 'transparent' }} />
                )}
                <span className={cn('mt-3 text-[10px] font-bold uppercase tracking-wider', !reached && 'opacity-50')} style={{ color: tier.to }}>{t(`profile.tiers.${tier.id}`)}</span>
                <span className="text-[9px] text-hextech-text-dim">{t('profile.path.level', { level: tier.minLevel })}</span>
                {unlocks.length > 0 && (
                  <div className="mt-1.5 flex -space-x-1.5">
                    {unlocks.map((ic) => (
                      <img key={ic.id} src={ic.url} alt="" title={t('profile.path.unlocksIcon')} className={cn('h-5 w-5 rounded-full border border-hextech-dark object-cover', !reached && 'grayscale opacity-50')} />
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <p className="mt-5 flex items-center gap-1.5 text-[11px] text-hextech-text-dim">
        <Sparkles className="h-3 w-3 text-hextech-gold" /> {t('profile.path.howToXp')}
      </p>
    </section>
  )
}
