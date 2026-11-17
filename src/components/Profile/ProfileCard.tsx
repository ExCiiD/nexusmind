import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Quote, Swords, Gamepad2, ClipboardCheck, Clapperboard, CalendarDays } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  RARITY_STYLE,
  bannerUrl,
  iconUrl,
  loadProfile,
  tierProgress,
  type ProfilePrefs,
  type ProfileStats,
  type Tier,
  type TitleState,
} from '@/lib/profile'

/** Keeps a component in sync with the saved profile (edits from the
 *  Profile page re-render the sidebar dock right away). */
export function useProfilePrefs(userId: string | undefined): ProfilePrefs | null {
  const [prefs, setPrefs] = useState<ProfilePrefs | null>(() => (userId ? loadProfile(userId) : null))
  useEffect(() => {
    if (!userId) return
    const reload = () => setPrefs(loadProfile(userId))
    reload()
    window.addEventListener('ascend-profile-changed', reload)
    return () => window.removeEventListener('ascend-profile-changed', reload)
  }, [userId])
  return prefs
}

/** Avatar inside a tier-colored ring, with the level on a small plate. */
export function TierAvatar({ iconId, tier, level, size = 40, className }: { iconId: string; tier: Tier; level?: number; size?: number; className?: string }) {
  const ring = Math.max(2, Math.round(size / 24))
  return (
    <div className={cn('relative shrink-0', className)} style={{ width: size, height: size }}>
      <div
        className="h-full w-full rounded-full"
        style={{ padding: ring, background: `conic-gradient(from 210deg, ${tier.from}, ${tier.to}, ${tier.from}, ${tier.to}, ${tier.from})`, boxShadow: `0 0 ${size / 4}px ${tier.glow}` }}
      >
        <img src={iconUrl(iconId)} alt="" className="h-full w-full rounded-full border-2 border-hextech-black object-cover" draggable={false} />
      </div>
      {level !== undefined && (
        <span
          className="absolute left-1/2 -translate-x-1/2 rounded-md border px-1.5 font-mono font-bold leading-tight text-hextech-black"
          style={{ bottom: -Math.max(4, size / 14), fontSize: Math.max(9, size / 7), background: `linear-gradient(180deg, ${tier.to}, ${tier.from})`, borderColor: tier.from }}
        >
          {level}
        </span>
      )}
    </div>
  )
}

export function TitlePill({ title, className }: { title: Pick<TitleState, 'id' | 'rarity'>; className?: string }) {
  const { t } = useTranslation()
  const s = RARITY_STYLE[title.rarity]
  return (
    <span
      className={cn('inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wider', className)}
      style={{ color: s.text, borderColor: s.border, backgroundColor: s.bg }}
    >
      {t(`profile.titles.${title.id}.name`)}
    </span>
  )
}

interface ProfileCardProps {
  prefs: ProfilePrefs
  stats: ProfileStats | null
  titles: TitleState[]
  displayName: string
  riotId: string
  mainRole: string | null
  totalXp: number
}

/**
 * The player card — banner, tier-framed avatar, equipped title, motto,
 * key counters and up to three showcased titles. Same visual language as
 * game/social profile cards (banner + overlapping avatar + flair), built
 * only from data the app actually has.
 */
export function ProfileCard({ prefs, stats, titles, displayName, riotId, mainRole, totalXp }: ProfileCardProps) {
  const { t } = useTranslation()
  const tp = tierProgress(totalXp)
  const banner = bannerUrl(prefs.bannerId)
  const equipped = titles.find((x) => x.id === prefs.titleId && x.unlocked)
  const showcase = prefs.showcase.map((id) => titles.find((x) => x.id === id)).filter((x): x is TitleState => !!x?.unlocked)
  const days = stats ? Math.max(1, Math.floor((Date.now() - new Date(stats.memberSince).getTime()) / 86_400_000)) : null

  return (
    <article className="overflow-hidden rounded-2xl border border-hextech-border-dim bg-hextech-dark shadow-2xl" style={{ boxShadow: `0 20px 60px -20px ${tp.tier.glow}` }}>
      {/* Banner */}
      <div className="relative h-36 overflow-hidden">
        {banner ? (
          <img src={banner} alt="" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <div className="h-full w-full bg-gradient-to-br from-hextech-gold/40 via-hextech-elevated to-hextech-cyan/30" />
        )}
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-hextech-dark/20 to-hextech-dark" />
        <div className="absolute right-4 top-3 flex items-center gap-2 rounded-full border border-white/10 bg-black/45 px-3 py-1 backdrop-blur-sm">
          <span className="h-2.5 w-2.5 rotate-45 rounded-[2px]" style={{ background: `linear-gradient(135deg, ${tp.tier.to}, ${tp.tier.from})` }} />
          <span className="text-[11px] font-bold uppercase tracking-widest" style={{ color: tp.tier.to }}>
            {t(`profile.tiers.${tp.tier.id}`)}
          </span>
        </div>
      </div>

      {/* Identity */}
      <div className="relative px-6 pb-5">
        <div className="-mt-14 flex flex-wrap items-end gap-4">
          <TierAvatar iconId={prefs.iconId} tier={tp.tier} level={tp.level} size={112} />
          <div className="min-w-0 flex-1 pb-1">
            <h2 className="truncate font-display text-2xl font-extrabold tracking-tight text-hextech-text-bright">{displayName}</h2>
            <div className="mt-0.5 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs text-hextech-text-dim">{riotId}</span>
              {mainRole && (
                <span className="inline-flex items-center gap-1 text-[11px] text-hextech-text">
                  <Swords className="h-3 w-3 text-hextech-gold" /> {mainRole}
                </span>
              )}
            </div>
            {equipped && <TitlePill title={equipped} className="mt-2" />}
          </div>
        </div>

        {prefs.bio && (
          <p className="mt-4 flex gap-2 text-sm italic text-hextech-text">
            <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0 text-hextech-gold/60" />
            {prefs.bio}
          </p>
        )}

        {/* Tier progress */}
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-[11px]">
            <span style={{ color: tp.tier.to }} className="font-semibold">{t(`profile.tiers.${tp.tier.id}`)}</span>
            <span className="text-hextech-text-dim">
              {tp.next ? t('profile.card.toNextTier', { count: tp.levelsToNext, tier: t(`profile.tiers.${tp.next.id}`) }) : t('profile.card.maxTier')}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-hextech-elevated">
            <div className="h-full rounded-full" style={{ width: `${tp.progress}%`, background: `linear-gradient(90deg, ${tp.tier.from}, ${tp.tier.to})` }} />
          </div>
        </div>

        {/* Counters */}
        <div className="mt-4 grid grid-cols-4 divide-x divide-hextech-border-dim/60 rounded-xl border border-hextech-border-dim/60 bg-hextech-black/40">
          <Counter icon={Gamepad2} value={stats?.games} label={t('profile.card.games')} />
          <Counter icon={ClipboardCheck} value={stats?.reviews} label={t('profile.card.reviews')} />
          <Counter icon={Clapperboard} value={stats?.clips} label={t('profile.card.clips')} />
          <Counter icon={CalendarDays} value={days} label={t('profile.card.days')} />
        </div>

        {/* Showcase */}
        {showcase.length > 0 && (
          <div className="mt-4">
            <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-hextech-text-dim">{t('profile.card.showcase')}</h3>
            <div className="grid grid-cols-3 gap-2">
              {showcase.map((title) => <ShowcaseMedal key={title.id} title={title} />)}
            </div>
          </div>
        )}
      </div>
    </article>
  )
}

function Counter({ icon: Icon, value, label }: { icon: any; value: number | null | undefined; label: string }) {
  return (
    <div className="flex flex-col items-center px-2 py-2.5">
      <Icon className="mb-1 h-3.5 w-3.5 text-hextech-gold/80" />
      <span className="font-mono text-lg font-bold tabular-nums text-hextech-text-bright">{value ?? '—'}</span>
      <span className="text-[10px] text-hextech-text-dim">{label}</span>
    </div>
  )
}

export function ShowcaseMedal({ title }: { title: TitleState }) {
  const { t } = useTranslation()
  const s = RARITY_STYLE[title.rarity]
  return (
    <div className="flex flex-col items-center rounded-xl border px-2 py-3 text-center" style={{ borderColor: s.border, background: `radial-gradient(circle at 50% 0%, ${s.bg}, transparent 70%)` }}>
      <span className="mb-1.5 flex h-8 w-8 rotate-45 items-center justify-center rounded-md border" style={{ borderColor: s.border, backgroundColor: s.bg }}>
        <span className="-rotate-45 text-xs font-black" style={{ color: s.text }}>{t(`profile.rarity.${title.rarity}`).charAt(0)}</span>
      </span>
      <span className="text-[11px] font-bold leading-tight" style={{ color: s.text }}>{t(`profile.titles.${title.id}.name`)}</span>
      <span className="mt-0.5 text-[9px] text-hextech-text-dim">{t(`profile.titles.${title.id}.desc`, { count: title.threshold })}</span>
    </div>
  )
}
