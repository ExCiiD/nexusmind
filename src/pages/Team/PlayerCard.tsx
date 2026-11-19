/**
 * Player card of Espace d'équipe: a two-sided collectible card.
 *
 * Front: the team's crest (the group's logo, else its tag), the role and
 * its icon (the user's own set, src/lib/roleGlyphs.ts), the player's main
 * champion in the loading-screen art, their name in big vertical capitals,
 * topographic lines and scratches behind. It tilts toward the pointer with
 * a glare and a parallax between the layers (TiltCard).
 * Back (a click on the front turns it over): their own profile banner and
 * icon (picked on their Profile page, shared through the cloud groups), Riot
 * ID, their 5 best win rates among their most-played champions
 * (src/lib/playerCard.ts), and the edit and remove actions.
 *
 * The weekly awards (team:weekly-awards) frame the card: gold MVP frame with
 * a sweeping sheen and a flame coloured by the MVP streak, blue Grinder frame.
 */
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Download, Edit2, Info, Loader2, RotateCcw, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { Role } from '@/components/team/RoleIconPicker'
import { RoleGlyph } from '@/components/team/RoleGlyph'
import { CardGlare, TiltCard, parallax } from '@/components/team/TiltCard'
import { AwardFrame } from '@/components/team/AwardFrame'
import { CardChampionArt } from './CardChampionArt'
import { useChampionIconUrl } from '@/hooks/useChampionIconUrl'
import { bannerUrl, iconUrl } from '@/lib/profile'
import {
  CARD_CHAMPIONS, MIN_GAMES, MOST_PLAYED_POOL, cardSeed, initialsOf, verticalNameSize,
  type CardChampion, type CardChampions, type Look,
} from '@/lib/playerCard'
import type { AwardHolder, TeamMember } from '@/lib/ipc'
import { cn } from '@/lib/utils'
import { CARD_PATTERN_URLS, scratchesUrl, useCardLook } from '@/components/team/cardBackgrounds'
import { CARD_PATTERN_OPACITY, cardLookStyle } from '@/lib/cardLookCore'

/** Same scale as the team stats (SynergyPlayerCard, DashboardLayout). */
function wrTone(winRate: number): string {
  if (winRate >= 60) return 'text-emerald-300'
  if (winRate >= 50) return 'text-yellow-200'
  if (winRate >= 40) return 'text-orange-300'
  return 'text-red-300'
}

/** Gold capitals outlined in the card's darkest violet (stroke under the fill). */
const OUTLINED = '[paint-order:stroke_fill] [-webkit-text-stroke:var(--stroke)_#14091d]'

export interface CardTeam {
  name: string
  tag?: string | null
  /** The cloud group's logo, when it has one. */
  logoUrl?: string | null
}

/** The team's logo, else a crest with its tag (or initials). */
function TeamCrest({ team }: { team: CardTeam }) {
  const [broken, setBroken] = useState<string | null>(null)
  if (team.logoUrl && broken !== team.logoUrl) {
    return (
      <img
        src={team.logoUrl}
        alt={team.name}
        draggable={false}
        onError={() => setBroken(team.logoUrl ?? null)}
        className="h-[17cqw] max-w-[44cqw] object-contain drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]"
      />
    )
  }
  const label = (team.tag?.trim() || initialsOf(team.name)).slice(0, 4).toUpperCase()
  return (
    <svg viewBox="0 0 40 46" className="h-[15cqw] w-auto drop-shadow-[0_2px_4px_rgba(0,0,0,0.6)]" role="img" aria-label={team.name}>
      <path d="M20 1 38 7v15c0 11-8 19-18 23C10 41 2 33 2 22V7Z" fill="#1b1026" stroke="#E4C285" strokeWidth="1.6" />
      <path d="M20 5 34 9.6V22c0 8.7-6.2 15.2-14 18.6C12.2 37.2 6 30.7 6 22V9.6Z" fill="none" stroke="#E4C285" strokeOpacity=".35" strokeWidth=".8" />
      <text
        x="20" y="27" textAnchor="middle" fill="#E4C285"
        fontFamily='"Big Shoulders Display", "Arial Narrow", sans-serif' fontWeight="800"
        fontSize={label.length > 3 ? 10 : 13}
      >{label}</text>
    </svg>
  )
}

function CardFront({ member, role, team, artChampion, holders, totals, onFlip }: {
  member: TeamMember
  role: Role
  team: CardTeam
  artChampion: string | null
  holders: AwardHolder[]
  totals?: { mvp: number; grinder: number }
  onFlip: () => void
}) {
  const { t } = useTranslation()
  const [artBroken, setArtBroken] = useState(false)
  const [look] = useCardLook()
  const lookStyle = cardLookStyle(look)
  const [sx, sy] = cardSeed(member.id)
  const name = member.displayName.trim() || member.ign || '?'
  const roleLabel = t(`team.roster.roles.${role}`, { defaultValue: role })
  const badges = [
    { kind: 'mvp' as const, count: totals?.mvp ?? 0, held: holders.some((h) => h.kind === 'mvp') },
    { kind: 'grinder' as const, count: totals?.grinder ?? 0, held: holders.some((h) => h.kind === 'grinder') },
  ].filter((b) => b.count > 0 || b.held)

  return (
    <button
      type="button"
      onClick={onFlip}
      aria-label={t('team.roster.card.showDetails', { name })}
      className="group/front absolute inset-0 overflow-hidden rounded-lg bg-[#120b19] text-left shadow-[0_10px_30px_rgba(0,0,0,0.45)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold"
      style={{ ['--stroke' as string]: '0.55cqw' }}
    >
      {/* Background: violet glow, the chosen line pattern, scratches; the
          card look (Espace d'équipe → Apparence des cartes) filters them. */}
      <div aria-hidden className="absolute inset-0" style={{ filter: lookStyle.filter }}>
      <div aria-hidden className="absolute inset-0 bg-[radial-gradient(130%_80%_at_50%_0%,#432a5e_0%,#1f1430_48%,#0c0812_100%)]" />
      <div
        aria-hidden
        className="absolute inset-[-6%]"
        style={{ opacity: CARD_PATTERN_OPACITY[look.background], backgroundImage: `url(${CARD_PATTERN_URLS[look.background]})`, backgroundSize: '135% auto', backgroundPosition: `${(sx * 100).toFixed(0)}% ${(sy * 100).toFixed(0)}%`, transform: parallax(-5) }}
      />
      <div
        aria-hidden
        className="absolute inset-[-6%] opacity-50"
        style={{ backgroundImage: `url(${scratchesUrl})`, backgroundSize: '120% auto', backgroundPosition: `${(sy * 100).toFixed(0)}% ${(sx * 100).toFixed(0)}%`, transform: parallax(-3) }}
      />
      </div>
      {lookStyle.tint && (
        <div aria-hidden className="absolute inset-0" style={{ background: lookStyle.tint.color, opacity: lookStyle.tint.opacity, mixBlendMode: 'color' }} />
      )}

      {/* The main champion: the faded art, then cut out of its scene. */}
      {artChampion && !artBroken ? (
        <CardChampionArt championKey={artChampion} onBroken={() => setArtBroken(true)} />
      ) : (
        <div aria-hidden className="absolute inset-x-0 bottom-[10%] flex justify-center text-white/[0.06]" style={{ transform: parallax(6) }}>
          <RoleGlyph role={role} className="h-[70cqw] w-[70cqw]" />
        </div>
      )}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-[38%] bg-gradient-to-t from-[#0c0812]/85 via-[#0c0812]/35 to-transparent" />

      {/* Double frame. */}
      <div aria-hidden className="absolute inset-[3.5cqw] rounded-[2px] border border-[#E4C285]/55" />
      <div aria-hidden className="absolute inset-[5.5cqw] rounded-[1px] border border-[#E4C285]/20" />

      {/* Crest, role, role icon. */}
      <div className="absolute inset-x-0 top-[8cqw] flex flex-col items-center" style={{ transform: parallax(-4) }}>
        <TeamCrest team={team} />
        <span className={cn('mt-[3cqw] font-display text-[10.5cqw] uppercase leading-none tracking-[0.1em] text-[#E4C285]', OUTLINED)}>
          {roleLabel}
        </span>
        <RoleGlyph role={role} tone="gradient" className="mt-[2.5cqw] h-[11cqw] w-[11cqw] drop-shadow-[0_2px_3px_rgba(0,0,0,0.7)]" />
      </div>

      {/* The name, reading downward along the right edge. */}
      <div className="absolute bottom-[8cqw] right-[6.5cqw] top-[55cqw] flex flex-col justify-end" style={{ transform: parallax(-11) }}>
        <span
          className={cn('whitespace-nowrap font-display uppercase leading-[0.86] tracking-[0.02em] text-[#F3DCA4] [writing-mode:vertical-rl] drop-shadow-[0_3px_6px_rgba(0,0,0,0.75)]', OUTLINED)}
          style={{ fontSize: `${verticalNameSize(name)}cqw`, ['--stroke' as string]: '0.09em' }}
        >
          {name}
        </span>
      </div>

      {/* Weekly awards won. */}
      {badges.length > 0 && (
        // Above the frames' corner ornaments.
        <div className="absolute bottom-[16cqw] left-[8cqw] flex flex-col items-start gap-[1.5cqw]" style={{ transform: parallax(-6) }}>
          {badges.map((b) => (
            <span
              key={b.kind}
              className={cn(
                'rounded-[3px] border px-[2cqw] py-[0.6cqw] font-mono text-[4.4cqw] font-bold uppercase leading-none tracking-wider shadow',
                b.kind === 'mvp' ? 'border-[#E4C285]/70 bg-[#2a1a08]/85 text-[#F3DCA4]' : 'border-sky-300/60 bg-[#071a33]/85 text-sky-200',
              )}
            >
              {b.kind === 'mvp' ? 'MVP' : 'Grinder'}{b.count > 1 ? ` ×${b.count}` : ''}
            </span>
          ))}
        </div>
      )}

      <span aria-hidden className="absolute right-[7cqw] top-[7cqw] rounded-full bg-black/40 p-[1.6cqw] text-[#E4C285]/70 opacity-0 transition-opacity group-hover/front:opacity-100 group-focus-visible/front:opacity-100">
        <RotateCcw className="h-[5cqw] w-[5cqw]" />
      </span>
      <CardGlare />
    </button>
  )
}

function CardBanner({ bannerId }: { bannerId: string | null }) {
  const url = bannerUrl(bannerId ?? 'theme')
  return (
    <div className="absolute inset-x-0 top-0 h-[38cqw] [mask-image:linear-gradient(to_bottom,black_35%,transparent)]" aria-hidden>
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
        className="h-[25cqw] w-[25cqw] shrink-0 rounded-full border-2 border-hextech-black object-cover ring-2 ring-hextech-gold/70"
        draggable={false}
      />
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          tabIndex={0}
          className="flex h-[25cqw] w-[25cqw] shrink-0 cursor-help items-center justify-center rounded-full border-2 border-hextech-black bg-hextech-elevated font-display text-[9cqw] text-hextech-text ring-1 ring-hextech-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold"
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
          <div tabIndex={0} className="flex cursor-default flex-col items-center gap-[1cqw] rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold">
            <div className="relative w-full">
              {icon ? (
                <img src={icon} alt={name} className="aspect-square w-full rounded-[4px] border border-hextech-border-dim object-cover" draggable={false} />
              ) : (
                <div className="aspect-square w-full rounded-[4px] border border-hextech-border-dim bg-hextech-elevated" />
              )}
              <span className="absolute -bottom-[1cqw] -right-[1cqw] rounded-[3px] border border-hextech-border-dim bg-hextech-black/90 px-[0.8cqw] font-mono text-[3.6cqw] leading-tight text-hextech-text tabular-nums">
                {champion.games}
              </span>
            </div>
            <span className={cn('font-mono text-[4.6cqw] font-semibold tabular-nums', champion.lowSample ? 'text-hextech-text-dim' : wrTone(champion.winRate))}>
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
    <section className="mt-[3cqw] border-t border-hextech-border-dim/60 pt-[2.5cqw]">
      <div className="mb-[2cqw] flex justify-center">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              className="inline-flex cursor-help items-center gap-1 text-center font-mono text-[4.2cqw] font-semibold uppercase tracking-wider text-hextech-text-dim hover:text-hextech-text-bright focus-visible:text-hextech-text-bright focus-visible:outline-none"
            >
              {t('team.roster.card.best')}
              <Info className="h-[4.5cqw] w-[4.5cqw] shrink-0" aria-hidden />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs px-3 py-2 leading-relaxed">
            {t('team.roster.card.bestHelp', { n: CARD_CHAMPIONS, pool: MOST_PLAYED_POOL, min: MIN_GAMES })}
          </TooltipContent>
        </Tooltip>
      </div>

      {empty ? (
        <div className="flex min-h-[24cqw] flex-col items-center justify-center gap-2 rounded-md border border-dashed border-hextech-border-dim px-2 py-2 text-center">
          {!hasRiotId ? (
            <span className="text-[11px] text-hextech-text-dim">{t('team.roster.card.noRiotId')}</span>
          ) : fetching ? (
            <span role="status" className="inline-flex items-center gap-1.5 text-[11px] text-hextech-text-dim">
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
              {t('team.roster.card.fetching')}
            </span>
          ) : (
            <>
              <span className="text-[11px] text-hextech-text-dim">{t('team.roster.card.noChampions')}</span>
              {onFetch && (
                <Button size="sm" variant="outline" className="h-7 max-w-full px-2 text-xs" onClick={onFetch}>
                  <Download className="mr-1.5 h-3 w-3 shrink-0" />
                  {t('team.roster.card.fetch')}
                </Button>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-5 gap-[2cqw]">
            {data.champions.map((c) => <ChampionTile key={c.championKey} champion={c} name={nameOf(c.championKey)} />)}
            {Array.from({ length: Math.max(0, CARD_CHAMPIONS - data.champions.length) }, (_, i) => (
              <li key={`empty-${i}`} aria-hidden className="aspect-square w-full rounded-[4px] border border-dashed border-hextech-border-dim" />
            ))}
          </ul>
          <p className="mt-[2cqw] text-center font-mono text-[4cqw] text-hextech-text-dim tabular-nums">
            {t('team.roster.card.games', { count: data.games })}
          </p>
        </>
      )}
    </section>
  )
}

/** One line per award the player holds, on the back of the card. */
function AwardLines({ holders }: { holders: AwardHolder[] }) {
  const { t } = useTranslation()
  if (holders.length === 0) return null
  return (
    <ul className="mt-[2cqw] space-y-[1cqw]">
      {holders.map((h) => (
        <li
          key={h.kind}
          className={cn(
            'rounded-[4px] border px-[2.5cqw] py-[1.2cqw] text-center text-[4.4cqw] leading-snug',
            h.kind === 'mvp' ? 'border-[#E4C285]/40 bg-[#E4C285]/10 text-[#F3DCA4]' : 'border-sky-400/35 bg-sky-500/10 text-sky-200',
          )}
        >
          <span className="font-semibold">{t(`team.roster.card.award.${h.kind}`)}</span>
          {h.live && <span className="text-hextech-text-dim"> · {t('team.roster.card.award.live')}</span>}
          <span className="block font-mono text-[4cqw] text-hextech-text-dim">
            {t(`team.roster.card.award.${h.kind}Value`, { count: h.games, value: Math.round(h.value) })}
            {h.streak > 1 && ` · ${t('team.roster.card.award.streak', { count: h.streak })}`}
          </span>
        </li>
      ))}
    </ul>
  )
}

interface PlayerCardProps {
  member: TeamMember
  role: Role
  look: Look | null
  champions: CardChampions
  nameOf: (key: string) => string
  team: CardTeam
  /** Champion of the front art (Data Dragon key); null: the role icon. */
  artChampion: string | null
  /** The weekly awards this player holds (at most one per kind). */
  holders?: AwardHolder[]
  /** Completed weeks this player won, per award. */
  totals?: { mvp: number; grinder: number }
  /** A champion fetch is running for this team. */
  fetching: boolean
  /** Starts the champion fetch; null when the member has no Riot ID. */
  onFetch: (() => void) | null
  onEdit: () => void
  /** Removes the member; omitted when the roster follows the group's players. */
  onRemove?: () => void
  /** The edit form, shown on the back instead of the champions. */
  editForm?: ReactNode
}

export function PlayerCard({
  member, role, look, champions, nameOf, team, artChampion, holders = [], totals, fetching, onFetch, onEdit, onRemove, editForm,
}: PlayerCardProps) {
  const { t } = useTranslation()
  const [turned, setTurned] = useState(false)
  const flipped = turned || !!editForm
  const riotId = member.ign ? `${member.ign}${member.tagLine ? `#${member.tagLine}` : ''}` : null
  // MVP first: a player holding both wears the gold frame.
  const frame = holders.find((h) => h.kind === 'mvp') ?? holders.find((h) => h.kind === 'grinder') ?? null

  return (
    <TiltCard
      className="mx-auto w-full max-w-[250px]"
      flipped={flipped}
      around={frame && <AwardFrame kind={frame.kind} mvpStreak={frame.kind === 'mvp' ? frame.streak : 0} />}
      front={(
        <CardFront
          member={member}
          role={role}
          team={team}
          artChampion={artChampion}
          holders={holders}
          totals={totals}
          onFlip={() => setTurned(true)}
        />
      )}
      back={(
        <div className="absolute inset-0 flex flex-col overflow-hidden rounded-lg border border-hextech-border-dim bg-hextech-elevated shadow-[0_10px_30px_rgba(0,0,0,0.45)]">
          <CardBanner bannerId={look?.bannerId ?? null} />
          <div className="relative flex items-start justify-between p-[3cqw]">
            <button
              type="button"
              onClick={() => setTurned(false)}
              disabled={!!editForm}
              title={t('team.roster.card.back')}
              aria-label={t('team.roster.card.back')}
              className="rounded-md border border-white/10 bg-black/60 p-[2cqw] text-hextech-text-dim transition-colors hover:text-hextech-text-bright focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold disabled:opacity-40"
            >
              <RotateCcw className="h-[5cqw] w-[5cqw]" />
            </button>
            <span className="inline-flex items-center gap-[1.5cqw] rounded-md border border-white/10 bg-black/60 px-[2cqw] py-[1cqw] font-mono text-[4cqw] font-semibold uppercase tracking-wider text-hextech-text-bright">
              <RoleGlyph role={role} tone="gold" className="h-[4.6cqw] w-[4.6cqw]" />
              {t(`team.roster.roles.${role}`, { defaultValue: role })}
            </span>
            {onRemove ? <button
              type="button"
              onClick={onRemove}
              title={t('team.roster.card.remove')}
              aria-label={t('team.roster.card.remove')}
              className="rounded-md border border-white/10 bg-black/60 p-[2cqw] text-hextech-text-dim transition-colors hover:text-red-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hextech-gold"
            >
              <Trash2 className="h-[5cqw] w-[5cqw]" />
            </button> : <span className="w-[9cqw]" aria-hidden />}
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col px-[4.5cqw] pb-[4.5cqw]">
            <div className="flex flex-col items-center text-center">
              <CardAvatar look={look} name={member.displayName} />
              <h3 className="mt-[2cqw] max-w-full truncate text-[8.5cqw] leading-none text-hextech-text-bright">{member.displayName}</h3>
              {(riotId || member.region) && (
                <p className="mt-[1cqw] max-w-full truncate font-mono text-[4.2cqw] text-hextech-text-dim">
                  {[riotId, member.region].filter(Boolean).join(' · ')}
                </p>
              )}
            </div>

            {editForm ? (
              <div className="mt-[3cqw]">{editForm}</div>
            ) : (
              <>
                <AwardLines holders={holders} />
                <ChampionsSection
                  data={champions}
                  nameOf={nameOf}
                  hasRiotId={!!(member.ign && member.tagLine)}
                  fetching={fetching}
                  onFetch={onFetch}
                />
                <Button size="sm" variant="outline" className="mt-auto h-8 w-full text-xs" onClick={onEdit}>
                  <Edit2 className="mr-1 h-3 w-3" />
                  {t('team.roster.card.edit')}
                </Button>
              </>
            )}
          </div>
        </div>
      )}
    />
  )
}

/** A free role slot, card-shaped: the role, and the add form or button. */
export function EmptySlotCard({ role, children }: { role: Role; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="mx-auto flex aspect-[1/1.75] w-full max-w-[250px] flex-col rounded-lg border border-dashed border-hextech-border-dim bg-hextech-black/30 p-3 [container-type:inline-size]">
      <div className="flex flex-1 flex-col items-center justify-center gap-[3cqw] text-center">
        <RoleGlyph role={role} className="h-[30cqw] w-[30cqw] text-hextech-text-dim/40" />
        <span className="font-display text-[9cqw] uppercase leading-none tracking-[0.1em] text-hextech-text-dim">
          {t(`team.roster.roles.${role}`, { defaultValue: role })}
        </span>
        <span className="text-xs italic text-hextech-text-dim">{t('team.roster.empty', { defaultValue: 'Empty slot' })}</span>
      </div>
      {children}
    </div>
  )
}
