/**
 * Roster player card (Team → Roster): the player's own profile banner and
 * icon (picked on their Profile page, shared through the cloud groups), name
 * and Riot ID, and their 5 best win rates among their most-played champions
 * (src/lib/playerCard.ts). Members without a shared look get their initials
 * and the default banner.
 */
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Edit2, Info, Loader2, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ROLE_ICON_URLS, type Role } from '@/components/team/RoleIconPicker'
import { useChampionIconUrl } from '@/hooks/useChampionIconUrl'
import { bannerUrl, iconUrl } from '@/lib/profile'
import { CARD_CHAMPIONS, MIN_GAMES, MOST_PLAYED_POOL, initialsOf, type CardChampion, type CardChampions, type Look } from '@/lib/playerCard'
import type { TeamMember } from '@/lib/ipc'
import { cn } from '@/lib/utils'

/** Same scale as the team stats (SynergyPlayerCard, DashboardLayout). */
function wrTone(winRate: number): string {
  if (winRate >= 60) return 'text-emerald-300'
  if (winRate >= 50) return 'text-yellow-200'
  if (winRate >= 40) return 'text-orange-300'
  return 'text-red-300'
}

/** Fades the banner into the card instead of ending on a hard edge. */
const BANNER_FADE = '[mask-image:linear-gradient(to_bottom,black_35%,transparent)]'

export function RolePill({ role, className }: { role: Role; className?: string }) {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-black/60 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-hextech-text-bright',
        className,
      )}
    >
      <img src={ROLE_ICON_URLS[role]} alt="" className="h-3.5 w-3.5 opacity-90" draggable={false} />
      {t(`team.roster.roles.${role}`, { defaultValue: role })}
    </span>
  )
}

function CardBanner({ bannerId }: { bannerId: string | null }) {
  const url = bannerUrl(bannerId ?? 'theme')
  return (
    <div className={cn('absolute inset-x-0 top-0 h-28', BANNER_FADE)} aria-hidden>
      {url ? (
        <img src={url} alt="" className="h-full w-full object-cover" draggable={false} />
      ) : (
        <div className="h-full w-full bg-gradient-to-br from-hextech-gold/35 via-hextech-elevated to-hextech-cyan/25" />
      )}
    </div>
  )
}

function CardAvatar({ look, name }: { look: Look | null; name: string }) {
  const { t } = useTranslation()
  if (look?.iconId) {
    return (
      <img
        src={iconUrl(look.iconId)}
        alt=""
        className="h-[4.5rem] w-[4.5rem] shrink-0 rounded-full border-2 border-hextech-black object-cover ring-2 ring-hextech-gold/70"
        draggable={false}
      />
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          className="flex h-[4.5rem] w-[4.5rem] shrink-0 cursor-help items-center justify-center rounded-full border-2 border-hextech-black bg-hextech-elevated font-display text-2xl text-hextech-text ring-1 ring-hextech-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold"
        >
          {initialsOf(name)}
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs px-3 py-2 leading-relaxed">
        {t('team.roster.card.noLook')}
      </TooltipContent>
    </Tooltip>
  )
}

function ChampionTile({ champion, name }: { champion: CardChampion; name: string }) {
  const { t } = useTranslation()
  const icon = useChampionIconUrl(champion.championKey)
  const losses = champion.games - champion.wins
  return (
    <li className="min-w-0">
      <Tooltip>
        <TooltipTrigger asChild>
          <div tabIndex={0} className="flex cursor-default flex-col items-center gap-1 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold">
            <div className="relative w-full">
              {icon ? (
                <img src={icon} alt={name} className="aspect-square w-full rounded-md border border-hextech-border-dim object-cover" draggable={false} />
              ) : (
                <div className="aspect-square w-full rounded-md border border-hextech-border-dim bg-hextech-elevated" />
              )}
              <span className="absolute -bottom-1 -right-1 rounded border border-hextech-border-dim bg-hextech-black/90 px-1 font-mono text-[9px] leading-tight text-hextech-text tabular-nums">
                {champion.games}
              </span>
            </div>
            <span className={cn('font-mono text-[11px] font-semibold tabular-nums', champion.lowSample ? 'text-hextech-text-dim' : wrTone(champion.winRate))}>
              {champion.winRate}%
            </span>
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="px-3 py-2">
          <p className="font-semibold text-hextech-text-bright">{name}</p>
          <p className="mt-0.5 text-hextech-text">
            {t('team.roster.card.championLine', { count: champion.games, wins: champion.wins, losses, winRate: champion.winRate })}
          </p>
          {champion.lowSample && <p className="mt-0.5 text-hextech-text-dim">{t('team.roster.card.lowSample', { min: MIN_GAMES })}</p>}
        </TooltipContent>
      </Tooltip>
    </li>
  )
}

function ChampionsSection({ data, nameOf, hasRiotId, fetching, onFetch }: {
  data: CardChampions
  nameOf: (key: string) => string
  hasRiotId: boolean
  fetching: boolean
  onFetch: (() => void) | null
}) {
  const { t } = useTranslation()
  const empty = data.champions.length === 0
  return (
    <section className="mt-4 border-t border-hextech-border-dim/60 pt-3">
      <div className="mb-2 flex justify-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex cursor-help items-center gap-1 text-center font-mono text-[10px] font-semibold uppercase tracking-wider text-hextech-text-dim hover:text-hextech-text-bright focus-visible:text-hextech-text-bright focus-visible:outline-none"
            >
              {t('team.roster.card.best')}
              <Info className="h-3 w-3 shrink-0" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs px-3 py-2 leading-relaxed">
            {t('team.roster.card.bestHelp', { n: CARD_CHAMPIONS, pool: MOST_PLAYED_POOL, min: MIN_GAMES })}
          </TooltipContent>
        </Tooltip>
      </div>

      {empty ? (
        <div className="flex min-h-[5.25rem] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-hextech-border-dim px-3 py-3 text-center">
          {!hasRiotId ? (
            <span className="text-xs text-hextech-text-dim">{t('team.roster.card.noRiotId')}</span>
          ) : fetching ? (
            <span role="status" className="inline-flex items-center gap-1.5 text-xs text-hextech-text-dim">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
              {t('team.roster.card.fetching')}
            </span>
          ) : (
            <>
              <span className="text-xs text-hextech-text-dim">{t('team.roster.card.noChampions')}</span>
              {onFetch && (
                <Button size="sm" variant="outline" className="max-w-full" onClick={onFetch}>
                  <Download className="mr-1.5 h-3 w-3 shrink-0" />
                  {t('team.roster.card.fetch')}
                </Button>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-5 gap-2">
            {data.champions.map((c) => <ChampionTile key={c.championKey} champion={c} name={nameOf(c.championKey)} />)}
            {Array.from({ length: Math.max(0, CARD_CHAMPIONS - data.champions.length) }, (_, i) => (
              <li key={`empty-${i}`} aria-hidden className="aspect-square w-full rounded-md border border-dashed border-hextech-border-dim" />
            ))}
          </ul>
          <p className="mt-2 text-center font-mono text-[10px] text-hextech-text-dim tabular-nums">
            {t('team.roster.card.games', { count: data.games })}
          </p>
        </>
      )}
    </section>
  )
}

interface PlayerCardProps {
  member: TeamMember
  role: Role
  look: Look | null
  champions: CardChampions
  nameOf: (key: string) => string
  /** A champion fetch is running for this team. */
  fetching: boolean
  /** Starts the champion fetch; null when the member has no Riot ID. */
  onFetch: (() => void) | null
  onEdit: () => void
  onRemove: () => void
  /** The edit form, shown instead of the champions while editing. */
  editForm?: ReactNode
}

export function PlayerCard({ member, role, look, champions, nameOf, fetching, onFetch, onEdit, onRemove, editForm }: PlayerCardProps) {
  const { t } = useTranslation()
  const riotId = member.ign ? `${member.ign}${member.tagLine ? `#${member.tagLine}` : ''}` : null
  return (
    <Card className="relative flex flex-col overflow-hidden">
      <CardBanner bannerId={look?.bannerId ?? null} />
      <div className="relative flex items-start justify-between p-3">
        <RolePill role={role} />
        <button
          type="button"
          onClick={onRemove}
          title={t('team.roster.card.remove')}
          aria-label={t('team.roster.card.remove')}
          className="rounded-md border border-white/10 bg-black/60 p-1.5 text-hextech-text-dim transition-colors hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="relative flex flex-1 flex-col px-4 pb-4">
        <div className="mt-3 flex flex-col items-center text-center">
          <CardAvatar look={look} name={member.displayName} />
          <h3 className="mt-2.5 max-w-full truncate text-xl leading-none text-hextech-text-bright">{member.displayName}</h3>
          {(riotId || member.region) && (
            <p className="mt-1 max-w-full truncate font-mono text-[11px] text-hextech-text-dim">
              {[riotId, member.region].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>

        {editForm ? (
          <div className="mt-4">{editForm}</div>
        ) : (
          <>
            <ChampionsSection
              data={champions}
              nameOf={nameOf}
              hasRiotId={!!(member.ign && member.tagLine)}
              fetching={fetching}
              onFetch={onFetch}
            />
            <Button size="sm" variant="outline" className="mt-4 w-full" onClick={onEdit}>
              <Edit2 className="mr-1 h-3 w-3" />
              {t('team.roster.card.edit')}
            </Button>
          </>
        )}
      </div>
    </Card>
  )
}

export function EmptySlotCard({ role, children }: { role: Role; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <Card className="flex min-h-[18rem] flex-col border-dashed p-3">
      <div>
        <RolePill role={role} />
      </div>
      <div className="flex flex-1 items-center justify-center text-xs italic text-hextech-text-dim">
        {t('team.roster.empty', { defaultValue: 'Empty slot' })}
      </div>
      {children}
    </Card>
  )
}
