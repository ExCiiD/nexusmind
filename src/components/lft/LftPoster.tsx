/**
 * The looking-for-team announcement itself, drawn at the exported size:
 * one player (solo) as a 16:9 poster or a 2:1 card, or several players
 * searching together (multi search) as a lobby of five seats, the
 * searched ones marked "+".
 */
import type { CSSProperties } from 'react'
import { championArtUrl, fitFontSize, LFT_FORMATS, lobbySeats, type LftRole } from '@/lib/lftCore'
import type { LftDesign, LftPlayerView, LftPosterProps } from './types'
import { CARD_PATTERN_OPACITY, cardLookStyle } from '@/lib/cardLookCore'
import { CARD_PATTERN_URLS, scratchesUrl } from '@/components/team/cardBackgrounds'
import { alpha, type LftAccent } from './theme'
import {
  abs, Avatar, ChampionSquare, Cover, DiscordLine, Frame, FONT_DISPLAY, FONT_MONO, InfoPair, INK, Kicker,
  MessageBox, PosterRoot, RankEmblem, rankDetails, rankTitle, RoleIcon, RuleKicker, Shade, TagPills, TEXT_DIM, TraitLine, TraitList, Watermark,
} from './parts'

export function LftPoster(raw: LftPosterProps) {
  const props = raw.design.show.region ? raw : { ...raw, region: null }
  if (props.mode === 'multi') return props.format === 'banner' ? <LobbyBanner {...props} /> : <LobbyCard {...props} />
  const player = props.players[0]
  const { width, height } = LFT_FORMATS[props.format]
  if (!player) return <PosterRoot width={width} height={height}><Backdrop accent={props.accent} /></PosterRoot>
  return props.format === 'banner' ? <SoloBanner {...props} player={player} /> : <SoloCard {...props} player={player} />
}

type SoloProps = LftPosterProps & { player: LftPlayerView }

const roleName = (t: LftPosterProps['t'], role: LftRole) => t(`team.roster.roles.${role}`)

/**
 * What sits behind the announcement: the splash art (or the portrait of a
 * lobby seat), else a card pattern over the colour's glow; the design's
 * filter, blur and light apply to it, never to the text.
 */
function ArtLayer({ design, accent, src, position, coverStyle, width }: {
  design: LftDesign
  accent: LftAccent
  src: string | null
  position?: string
  coverStyle?: CSSProperties
  /** Width drawn, to scale the blur from card pixels. */
  width: number
}) {
  const look = cardLookStyle(design.look, width / 320)
  const id = design.look.background
  return (
    <>
      <div style={abs({ inset: design.look.blur > 0 ? '-3%' : 0, filter: look.filter })}>
        {design.art === 'splash' && src ? (
          <Cover src={src} position={position} style={coverStyle} />
        ) : design.art === 'pattern' ? (
          <>
            <Shade style={{ background: `radial-gradient(130% 85% at 50% 0%, ${alpha(accent.main, 0.32)} 0%, ${accent.deep} 48%, ${INK} 100%)` }} />
            <Shade style={{ opacity: Math.min(0.5, CARD_PATTERN_OPACITY[id] * 1.7), backgroundImage: `url(${CARD_PATTERN_URLS[id]})`, backgroundSize: `${Math.max(400, Math.round(width * 0.42))}px auto`, backgroundRepeat: 'repeat' }} />
            <Shade style={{ opacity: 0.4, backgroundImage: `url(${scratchesUrl})`, backgroundSize: `${Math.max(400, Math.round(width * 0.36))}px auto`, backgroundRepeat: 'repeat' }} />
          </>
        ) : (
          <Backdrop accent={accent} />
        )}
      </div>
      {look.tint && <Shade style={{ background: look.tint.color, opacity: look.tint.opacity, mixBlendMode: 'color' }} />}
    </>
  )
}

/** Without a champion to show: the announcement's colour on dark. */
function Backdrop({ accent }: { accent: LftAccent }) {
  return (
    <Shade
      style={{
        background: `radial-gradient(ellipse 60% 70% at 30% 20%, ${alpha(accent.main, 0.22)}, transparent 65%), radial-gradient(ellipse 50% 60% at 85% 90%, ${alpha(accent.main, 0.12)}, transparent 70%), linear-gradient(135deg, #1C140C, ${INK})`,
      }}
    />
  )
}

/** The player's name in the display face, gradient on dark. */
function NameText({ text, size, accent, maxWidth, style }: { text: string; size: number; accent: LftAccent; maxWidth: number; style?: CSSProperties }) {
  return (
    <div
      style={{
        maxWidth,
        fontFamily: FONT_DISPLAY,
        fontWeight: 800,
        fontSize: size,
        lineHeight: 1,
        padding: `${size * 0.04}px ${size * 0.05}px`,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        color: 'transparent',
        backgroundImage: `linear-gradient(180deg, #FFFBF2 25%, ${accent.soft} 100%)`,
        WebkitBackgroundClip: 'text',
        backgroundClip: 'text',
        filter: 'drop-shadow(0 4px 16px rgba(0, 0, 0, 0.85))',
        ...style,
      }}
    >
      {text}
    </div>
  )
}

// ── Solo: 16:9 poster ──────────────────────────────────────────────────────

function SoloBanner({ player, region, content, accent, version, t, design }: SoloProps) {
  const { width, height } = LFT_FORMATS.banner
  const main = player.champions[0]
  const rank = player.rank
  const title = rankTitle(rank, player.rankState, t)
  return (
    <PosterRoot width={width} height={height}>
      <ArtLayer design={design} accent={accent} src={main ? championArtUrl('splash', main.key, version, player.skin) : null} position="center 20%" width={width} />
      <Shade style={{ background: 'linear-gradient(90deg, rgba(11,8,5,0.94) 0%, rgba(11,8,5,0.5) 26%, rgba(11,8,5,0.4) 50%, rgba(11,8,5,0.62) 74%, rgba(11,8,5,0.95) 100%)' }} />
      <Shade style={{ background: 'linear-gradient(180deg, rgba(11,8,5,0.85) 0%, rgba(11,8,5,0) 25%, rgba(11,8,5,0) 55%, rgba(11,8,5,0.96) 100%)' }} />
      <Shade style={{ background: `radial-gradient(ellipse 30% 42% at 50% 48%, ${alpha(accent.main, 0.16)}, transparent 72%)` }} />
      {design.show.frame && <Frame accent={accent} inset={30} />}

      <div style={abs({ left: 80, top: 74 })}>
        <InfoPair label={t('team.lft.poster.lookingFor')} value={content.lookingFor} accent={accent} labelSize={19} valueSize={46} maxWidth={560} />
      </div>
      <div style={abs({ right: 80, top: 74 })}>
        <InfoPair label={t('team.lft.poster.languages')} value={content.languages} accent={accent} labelSize={19} valueSize={46} maxWidth={560} align="right" />
      </div>
      <div style={abs({ left: 0, right: 0, top: 58, display: 'flex', flexDirection: 'column', alignItems: 'center' })}>
        <Kicker accent={accent} size={19}>{design.kicker || t('team.lft.poster.kicker')}</Kicker>
        {region && (
          <div style={{ marginTop: 8, fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 100, lineHeight: 1, letterSpacing: '0.08em', color: '#F7EEDC' }}>{region}</div>
        )}
      </div>

      <div style={abs({ left: 430, right: 430, top: 262, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' })}>
        <RoleIcon role={player.role} size={76} color={accent.main} />
        <div style={{ marginTop: 12, fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 50, lineHeight: 1, letterSpacing: '0.2em', textTransform: 'uppercase', color: accent.bright, paddingLeft: '0.2em' }}>
          {roleName(t, player.role)}
        </div>
        <NameText text={player.name} size={fitFontSize(player.name, 1000, 172, 80)} accent={accent} maxWidth={1060} style={{ marginTop: 14 }} />
        {player.tag && <div style={{ marginTop: 4, fontFamily: FONT_MONO, fontSize: 28, color: '#D9CCB0', letterSpacing: '0.06em', textShadow: '0 2px 12px rgba(0,0,0,0.95)' }}>#{player.tag}</div>}
        {title && (
          <div style={{ marginTop: 22, display: 'flex', alignItems: 'center', gap: 22 }}>
            {rank && <RankEmblem tier={rank.tier} width={210} />}
            <div style={{ textAlign: rank ? 'left' : 'center' }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 64, lineHeight: 1, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#F7EEDC' }}>
                {title}
              </div>
              {rank && design.show.rankDetails && <div style={{ marginTop: 10, fontFamily: FONT_MONO, fontSize: 23, color: accent.soft, whiteSpace: 'nowrap' }}>{rankDetails(rank, t)}</div>}
            </div>
          </div>
        )}
      </div>

      {(player.strengths.length > 0 || player.weaknesses.length > 0) && (
        <div style={abs({ left: 80, top: 300, width: 330, display: 'flex', flexDirection: 'column', gap: 34 })}>
          <TraitList label={t('team.lft.poster.strengths')} items={player.strengths} accent={accent} size={32} />
          <TraitList label={t('team.lft.poster.weaknesses')} items={player.weaknesses} accent={accent} size={26} weak />
        </div>
      )}

      {design.show.mains && player.champions.length > 0 && (
        <div style={abs({ right: 80, top: 262, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 18 })}>
          <Kicker accent={accent} size={17} style={{ marginBottom: 4 }}>{t('team.lft.poster.mains')}</Kicker>
          {player.champions.slice(0, design.championCount).map((c) => (
            <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 30, lineHeight: 1, letterSpacing: '0.03em', textTransform: 'uppercase', color: '#F3EADA', whiteSpace: 'nowrap' }}>{c.name}</div>
                {design.show.champStats && c.games > 0 && (
                  <div style={{ marginTop: 5, fontFamily: FONT_MONO, fontSize: 15, color: TEXT_DIM, whiteSpace: 'nowrap' }}>
                    {t('team.lft.poster.champGames', { count: c.games, winRate: c.winRate ?? 0 })}
                  </div>
                )}
              </div>
              <ChampionSquare src={championArtUrl('icon', c.key, version)} size={100} accent={accent} />
            </div>
          ))}
        </div>
      )}

      <div style={abs({ left: 0, right: 0, bottom: 74, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 18 })}>
        <TagPills tags={content.tags} accent={accent} size={21} style={{ justifyContent: 'center' }} />
        <MessageBox text={content.message} accent={accent} size={23} lines={2} style={{ maxWidth: 940 }} />
      </div>
      <div style={abs({ left: 80, bottom: 76 })}>
        <DiscordLine handle={content.discord} accent={accent} size={30} t={t} />
      </div>
      <Watermark size={46} style={abs({ right: 80, bottom: 70 })} />
    </PosterRoot>
  )
}

// ── Solo: 2:1 card ─────────────────────────────────────────────────────────

const ROLE_ORDER: LftRole[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']

function SoloCard({ player, region, content, accent, version, t, design }: SoloProps) {
  const { width, height } = LFT_FORMATS.card
  const main = player.champions[0]
  const rank = player.rank
  const avatar = player.avatarUrl ?? (main ? championArtUrl('icon', main.key, version) : null)
  const info = [
    content.lookingFor && { label: t('team.lft.poster.lookingFor'), value: content.lookingFor },
    content.languages && { label: t('team.lft.poster.languages'), value: content.languages },
  ].filter(Boolean) as Array<{ label: string; value: string }>
  return (
    <PosterRoot width={width} height={height}>
      <ArtLayer design={design} accent={accent} src={main ? championArtUrl('splash', main.key, version, player.skin) : null} position="center 20%" coverStyle={{ opacity: 0.4 }} width={width} />
      <Shade style={{ background: `linear-gradient(100deg, rgba(11,8,5,0.96) 0%, rgba(11,8,5,0.78) 45%, rgba(11,8,5,0.7) 70%, rgba(11,8,5,0.9) 100%)` }} />
      <Shade style={{ background: `radial-gradient(ellipse 40% 55% at 12% 15%, ${alpha(accent.main, 0.2)}, transparent 70%), radial-gradient(ellipse 30% 45% at 88% 18%, ${alpha(accent.main, 0.14)}, transparent 70%)` }} />
      {design.show.frame && <Frame accent={accent} inset={16} gap={6} diamond={9} />}

      <div style={abs({ left: 50, top: 42, display: 'flex', gap: 26, alignItems: 'center' })}>
        <Avatar src={avatar} name={player.name} size={112} accent={accent} />
        <div style={{ width: 560 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, whiteSpace: 'nowrap' }}>
            <NameText text={player.name} size={fitFontSize(player.name, 420, 64, 34)} accent={accent} maxWidth={440} style={{ filter: 'none', padding: 0 }} />
            {player.tag && <span style={{ fontFamily: FONT_MONO, fontSize: 22, color: TEXT_DIM }}>#{player.tag}</span>}
            {region && <span style={{ fontFamily: FONT_MONO, fontSize: 15, fontWeight: 700, color: accent.main, letterSpacing: '0.12em', border: `1px solid ${alpha(accent.main, 0.5)}`, borderRadius: 4, padding: '3px 7px', alignSelf: 'center' }}>{region}</span>}
          </div>
          <div style={{ marginTop: 10, height: 1, width: 540, background: `linear-gradient(90deg, ${alpha(accent.main, 0.75)}, transparent)` }} />
          <div style={{ marginTop: 12 }}>
            <DiscordLine handle={content.discord} accent={accent} size={21} t={t} />
          </div>
        </div>
      </div>

      {rankTitle(rank, player.rankState, t) && (
        <div style={abs({ right: 46, top: 30, width: 250, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' })}>
          {rank ? <RankEmblem tier={rank.tier} width={196} /> : <div style={{ height: 40 }} />}
          <div style={{ marginTop: rank ? -6 : 0, fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 32, lineHeight: 1, textTransform: 'uppercase', color: '#F7EEDC', letterSpacing: '0.03em' }}>
            {rankTitle(rank, player.rankState, t)}
          </div>
          {rank && design.show.rankDetails && (
            <div style={{ marginTop: 6, fontFamily: FONT_MONO, fontSize: 13, lineHeight: 1.5, color: accent.soft, whiteSpace: 'nowrap' }}>
              <div>{rankDetails(rank, t, { winRate: false })}</div>
              <div style={{ color: TEXT_DIM }}>{rankDetails(rank, t, { queue: false, lp: false })}</div>
            </div>
          )}
        </div>
      )}

      {info.length > 0 && (
        <div style={abs({ left: 50, top: 176, display: 'flex', gap: 34, whiteSpace: 'nowrap' })}>
          {info.map((i) => (
            <div key={i.label} style={{ display: 'flex', alignItems: 'baseline', gap: 10, maxWidth: 420, overflow: 'hidden' }}>
              <span style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: TEXT_DIM }}>{i.label}</span>
              <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: 22, color: accent.soft, overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.value}</span>
            </div>
          ))}
        </div>
      )}

      {(player.strengths.length > 0 || player.weaknesses.length > 0) && (
        <div style={abs({ left: 50, top: 207, maxWidth: 830, display: 'flex', gap: 30, overflow: 'hidden' })}>
          <TraitLine label={t('team.lft.poster.strengths')} items={player.strengths} accent={accent} size={17} maxWidth={500} />
          <TraitLine label={t('team.lft.poster.weaknesses')} items={player.weaknesses} accent={accent} size={17} weak maxWidth={330} />
        </div>
      )}

      <div style={abs({ left: 50, top: 244 })}>
        <RuleKicker accent={accent} size={13} width={330}>{t('team.lft.poster.role')}</RuleKicker>
        <div style={{ marginTop: 30, display: 'flex', gap: 10 }}>
          {ROLE_ORDER.map((r) => {
            const on = r === player.role
            return (
              <div key={r} style={{ position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
                {on && (
                  <span style={abs({ top: -12, left: '50%', transform: 'translateX(-50%)', zIndex: 1, fontFamily: FONT_MONO, fontSize: 10, fontWeight: 800, letterSpacing: '0.12em', background: accent.main, color: INK, borderRadius: 3, padding: '2px 6px' })}>
                    {t('team.lft.poster.main')}
                  </span>
                )}
                <div
                  style={{
                    width: 56,
                    height: 56,
                    borderRadius: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: `${on ? 2 : 1}px solid ${on ? accent.main : 'rgba(255,255,255,0.12)'}`,
                    background: on ? alpha(accent.main, 0.16) : 'rgba(255,255,255,0.03)',
                    boxShadow: on ? `0 0 22px ${alpha(accent.main, 0.4)}` : 'none',
                    opacity: on ? 1 : 0.45,
                  }}
                >
                  <RoleIcon role={r} size={32} color={on ? accent.bright : '#CFC4AE'} />
                </div>
                <span style={{ fontFamily: FONT_MONO, fontSize: 12, fontWeight: 700, letterSpacing: '0.08em', color: on ? accent.bright : TEXT_DIM, opacity: on ? 1 : 0.6 }}>
                  {t(`team.lft.poster.roleShort.${r}`)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {design.show.mains && <div style={abs({ left: 432, top: 244 })}>
        <RuleKicker accent={accent} size={13} width={718}>{t('team.lft.poster.mains')}</RuleKicker>
        <div style={{ marginTop: 18, display: 'flex', gap: 22 }}>
          {player.champions.slice(0, design.championCount).map((c) => (
            <div key={c.key} style={{ width: 118, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
              <div style={{ position: 'relative' }}>
                <ChampionSquare src={championArtUrl('icon', c.key, version)} size={96} accent={accent} />
                <div style={abs({ right: -8, bottom: -8, width: 30, height: 30, borderRadius: '50%', background: INK, border: `1px solid ${alpha(accent.main, 0.8)}`, display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
                  <RoleIcon role={player.role} size={18} color={accent.main} />
                </div>
              </div>
              <span style={{ maxWidth: 118, fontSize: 15, fontWeight: 600, color: '#F3EADA', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{c.name}</span>
            </div>
          ))}
        </div>
      </div>}

      <div style={abs({ left: 50, right: 50, top: 420 })}>
        <TagPills tags={content.tags} accent={accent} size={15} />
        <MessageBox text={content.message} accent={accent} size={17} lines={2} style={{ marginTop: content.tags.length ? 14 : 0 }} />
      </div>
      <Watermark size={26} style={abs({ right: 40, bottom: 30 })} />
    </PosterRoot>
  )
}

// ── Multi search: lobby ────────────────────────────────────────────────────

interface SeatSizes {
  w: number
  h: number
  name: [max: number, min: number]
  tag: number
  emblem: number
  rank: number
  details: number
  champ: number
  badge: number
  plus: number
  roleIcon: number
  roleText: number
  label: number
}

function SeatPlayer({ player, accent, version, t, s, design }: { player: LftPlayerView; accent: LftAccent; version: string; t: LftPosterProps['t']; s: SeatSizes; design: LftDesign }) {
  const main = player.champions[0]
  const rank = player.rank
  return (
    <div style={{ position: 'relative', width: s.w, height: s.h, borderRadius: 10, overflow: 'hidden', border: `2px solid ${alpha(accent.main, 0.75)}`, background: accent.deep, boxShadow: `0 18px 40px rgba(0,0,0,0.55), 0 0 0 1px ${INK}` }}>
      <ArtLayer design={design} accent={accent} src={main ? championArtUrl('loading', main.key, version, player.skin) : null} position="center 18%" width={s.w * 2} />
      <Shade style={{ background: 'linear-gradient(180deg, rgba(11,8,5,0.35) 0%, rgba(11,8,5,0) 22%, rgba(11,8,5,0.25) 42%, rgba(11,8,5,0.88) 62%, rgba(11,8,5,0.98) 100%)' }} />
      <div style={abs({ left: 0, right: 0, top: 0, height: Math.max(3, s.w * 0.014), background: `linear-gradient(90deg, transparent, ${accent.main}, transparent)` })} />
      <div style={abs({ left: s.w * 0.06, top: s.w * 0.06, width: s.badge, height: s.badge, borderRadius: '50%', background: 'rgba(11,8,5,0.78)', border: `1px solid ${alpha(accent.main, 0.85)}`, display: 'flex', alignItems: 'center', justifyContent: 'center' })}>
        <RoleIcon role={player.role} size={s.badge * 0.6} color={accent.bright} />
      </div>
      <div style={abs({ left: 0, right: 0, bottom: s.h * 0.035, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', padding: `0 ${s.w * 0.05}px` })}>
        <NameText text={player.name} size={fitFontSize(player.name, s.w * 0.86, s.name[0], s.name[1])} accent={accent} maxWidth={s.w * 0.92} />
        {player.tag && <div style={{ fontFamily: FONT_MONO, fontSize: s.tag, color: TEXT_DIM, marginTop: 2 }}>#{player.tag}</div>}
        {rank ? <RankEmblem tier={rank.tier} width={s.emblem} /> : <div style={{ height: s.emblem * 0.25 }} />}
        {rankTitle(rank, player.rankState, t) && (
          <div style={{ marginTop: rank ? -s.emblem * 0.06 : 0, fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: s.rank, lineHeight: 1, textTransform: 'uppercase', color: '#F7EEDC', whiteSpace: 'nowrap' }}>
            {rankTitle(rank, player.rankState, t)}
          </div>
        )}
        {rank && design.show.rankDetails && <div style={{ marginTop: s.details * 0.4, fontFamily: FONT_MONO, fontSize: s.details, color: accent.soft, whiteSpace: 'nowrap' }}>{rankDetails(rank, t, { queue: false })}</div>}
        {player.strengths.length > 0 && (
          <div
            style={{
              marginTop: s.details * 0.7,
              maxWidth: s.w * 0.9,
              fontFamily: FONT_DISPLAY,
              fontWeight: 700,
              fontSize: s.details * 1.15,
              lineHeight: 1.2,
              color: accent.soft,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            <span style={{ fontFamily: FONT_MONO, fontSize: s.details * 0.75, letterSpacing: '0.2em', textTransform: 'uppercase', color: accent.main, marginRight: s.details * 0.5 }}>
              {t('team.lft.poster.strengthsShort')}
            </span>
            {player.strengths.join(' · ')}
          </div>
        )}
        {design.show.mains && player.champions.length > 0 && (
          <div style={{ marginTop: s.champ * 0.32, display: 'flex', gap: s.champ * 0.16 }}>
            {player.champions.slice(0, Math.min(3, design.championCount)).map((c) => (
              <ChampionSquare key={c.key} src={championArtUrl('icon', c.key, version)} size={s.champ} accent={accent} radius={s.champ * 0.16} edge={Math.max(1, s.champ * 0.03)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SeatWanted({ role, accent, t, s }: { role: LftRole; accent: LftAccent; t: LftPosterProps['t']; s: SeatSizes }) {
  const bar = s.plus * 0.07
  return (
    <div
      style={{
        position: 'relative',
        width: s.w,
        height: s.h,
        borderRadius: 10,
        border: `2px dashed ${alpha(accent.main, 0.8)}`,
        background: `radial-gradient(ellipse 70% 45% at 50% 42%, ${alpha(accent.main, 0.2)}, transparent 75%), linear-gradient(180deg, ${alpha(accent.deep, 0.85)}, rgba(11,8,5,0.9))`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          position: 'relative',
          width: s.plus,
          height: s.plus,
          borderRadius: '50%',
          border: `2px solid ${accent.main}`,
          background: 'rgba(11,8,5,0.6)',
          boxShadow: `0 0 ${s.plus * 0.3}px ${alpha(accent.main, 0.45)}, inset 0 0 ${s.plus * 0.2}px ${alpha(accent.main, 0.25)}`,
        }}
      >
        <div style={abs({ left: '50%', top: '50%', width: s.plus * 0.46, height: bar, marginLeft: -s.plus * 0.23, marginTop: -bar / 2, borderRadius: bar, background: accent.bright })} />
        <div style={abs({ left: '50%', top: '50%', width: bar, height: s.plus * 0.46, marginLeft: -bar / 2, marginTop: -s.plus * 0.23, borderRadius: bar, background: accent.bright })} />
      </div>
      <div style={{ marginTop: s.plus * 0.24 }}>
        <RoleIcon role={role} size={s.roleIcon} color={accent.main} />
      </div>
      <div style={{ marginTop: s.roleText * 0.3, fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: s.roleText, lineHeight: 1, letterSpacing: '0.12em', textTransform: 'uppercase', color: accent.bright, paddingLeft: '0.12em' }}>
        {roleName(t, role)}
      </div>
      <Kicker accent={accent} size={s.label} style={{ marginTop: s.label * 0.7, paddingLeft: '0.26em' }}>{t('team.lft.poster.wanted')}</Kicker>
    </div>
  )
}

function SeatOpen({ role, t, s }: { role: LftRole; t: LftPosterProps['t']; s: SeatSizes }) {
  return (
    <div
      style={{
        width: s.w,
        height: s.h,
        borderRadius: 10,
        border: '1px solid rgba(255,255,255,0.1)',
        background: 'rgba(11,8,5,0.55)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: 0.55,
      }}
    >
      <RoleIcon role={role} size={s.roleIcon} color="#8F8470" />
      <div style={{ marginTop: s.roleText * 0.3, fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: s.roleText * 0.85, letterSpacing: '0.12em', textTransform: 'uppercase', color: '#8F8470' }}>
        {roleName(t, role)}
      </div>
      <div style={{ marginTop: s.label * 0.6, fontFamily: FONT_MONO, fontSize: s.label, letterSpacing: '0.24em', textTransform: 'uppercase', color: '#8F8470' }}>{t('team.lft.poster.seatTaken')}</div>
    </div>
  )
}

function Seats({ players, wanted, accent, version, t, s, gap, design }: LftPosterProps & { s: SeatSizes; gap: number }) {
  return (
    <div style={{ display: 'flex', gap }}>
      {lobbySeats(players.map((p) => ({ ...p, seat: p.role })), wanted).map((seat) =>
        seat.kind === 'player' ? (
          <SeatPlayer key={seat.role} player={seat.player} accent={accent} version={version} t={t} s={s} design={design} />
        ) : seat.kind === 'wanted' ? (
          <SeatWanted key={seat.role} role={seat.role} accent={accent} t={t} s={s} />
        ) : (
          <SeatOpen key={seat.role} role={seat.role} t={t} s={s} />
        ),
      )}
    </div>
  )
}

function lobbyTitle(t: LftPosterProps['t'], wanted: number): string {
  return wanted > 0 ? t('team.lft.poster.multiTitle', { count: wanted }) : t('team.lft.poster.multiTitleNone')
}

/** "EUW ◆ Je cherche SLE ◆ Langues FR, EN". */
function LobbySubline({ region, content, accent, t, size }: Pick<LftPosterProps, 'region' | 'content' | 'accent' | 't'> & { size: number }) {
  const items = [
    region && { label: null, value: region },
    content.lookingFor && { label: t('team.lft.poster.lookingForMulti'), value: content.lookingFor },
    content.languages && { label: t('team.lft.poster.languages'), value: content.languages },
  ].filter(Boolean) as Array<{ label: string | null; value: string }>
  if (items.length === 0) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: size * 0.9, whiteSpace: 'nowrap' }}>
      {items.map((i, n) => (
        <div key={n} style={{ display: 'flex', alignItems: 'center', gap: size * 0.9 }}>
          {n > 0 && <span style={{ width: size * 0.32, height: size * 0.32, transform: 'rotate(45deg)', background: accent.main, display: 'inline-block' }} />}
          <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: size * 0.45 }}>
            {i.label && <span style={{ fontFamily: FONT_MONO, fontSize: size * 0.62, fontWeight: 700, letterSpacing: '0.22em', textTransform: 'uppercase', color: TEXT_DIM }}>{i.label}</span>}
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: size, letterSpacing: i.label ? '0.02em' : '0.1em', color: i.label ? accent.soft : '#F7EEDC' }}>{i.value}</span>
          </span>
        </div>
      ))}
    </div>
  )
}

/** "Points forts recherchés  a · b  ◆  Minimum requis  c / d". */
function ProfileLine({ profile, accent, t, size }: Pick<LftPosterProps, 'profile' | 'accent' | 't'> & { size: number }) {
  if (profile.strengths.length === 0 && profile.required.length === 0) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: size * 1.1, maxWidth: '92%', overflow: 'hidden' }}>
      <TraitLine label={t('team.lft.poster.wantedStrengths')} items={profile.strengths} accent={accent} size={size} />
      {profile.strengths.length > 0 && profile.required.length > 0 && (
        <span style={{ width: size * 0.3, height: size * 0.3, transform: 'rotate(45deg)', background: accent.main, flexShrink: 0 }} />
      )}
      <TraitLine label={t('team.lft.poster.required')} items={profile.required} accent={accent} size={size} separator=" / " />
    </div>
  )
}

const hasProfile = (p: LftPosterProps['profile']) => p.strengths.length > 0 || p.required.length > 0

function LobbyBackground({ players, accent, version, design, width }: Pick<LftPosterProps, 'players' | 'accent' | 'version' | 'design'> & { width: number }) {
  const main = players[0]?.champions[0]
  return (
    <>
      <ArtLayer design={design} accent={accent} src={main ? championArtUrl('splash', main.key, version, players[0]?.skin) : null} position="center 25%" coverStyle={{ filter: 'blur(10px) saturate(1.1)', transform: 'scale(1.08)', opacity: 0.55 }} width={width} />
      <Shade style={{ background: 'linear-gradient(180deg, rgba(11,8,5,0.9) 0%, rgba(11,8,5,0.62) 30%, rgba(11,8,5,0.7) 70%, rgba(11,8,5,0.95) 100%)' }} />
      <Shade style={{ background: `radial-gradient(ellipse 55% 40% at 50% 55%, ${alpha(accent.main, 0.14)}, transparent 75%)` }} />
    </>
  )
}

const BANNER_SEATS: SeatSizes = { w: 300, h: 590, name: [50, 28], tag: 17, emblem: 150, rank: 30, details: 15, champ: 52, badge: 56, plus: 156, roleIcon: 56, roleText: 40, label: 17 }
const CARD_SEATS: SeatSizes = { w: 194, h: 322, name: [32, 17], tag: 11, emblem: 92, rank: 19, details: 10, champ: 32, badge: 34, plus: 92, roleIcon: 32, roleText: 24, label: 11 }

function LobbyBanner(props: LftPosterProps) {
  const { content, accent, t, wanted } = props
  const { width, height } = LFT_FORMATS.banner
  return (
    <PosterRoot width={width} height={height}>
      <LobbyBackground {...props} width={width} />
      {props.design.show.frame && <Frame accent={accent} inset={30} />}
      <div style={abs({ left: 0, right: 0, top: 62, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 })}>
        <Kicker accent={accent} size={20} style={{ paddingLeft: '0.26em' }}>{props.design.kicker || t('team.lft.poster.multiKicker')}</Kicker>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 86, lineHeight: 1, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#F7EEDC', textShadow: '0 4px 24px rgba(0,0,0,0.8)' }}>
          {props.design.title || lobbyTitle(t, wanted.length)}
        </div>
        <LobbySubline {...props} size={30} />
        <ProfileLine {...props} size={24} />
      </div>
      <div style={abs({ left: 0, right: 0, top: hasProfile(props.profile) ? 300 : 268, display: 'flex', justifyContent: 'center' })}>
        <Seats {...props} s={hasProfile(props.profile) ? { ...BANNER_SEATS, h: 562 } : BANNER_SEATS} gap={26} />
      </div>
      <div style={abs({ left: 0, right: 0, bottom: 72, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 })}>
        <TagPills tags={content.tags} accent={accent} size={20} style={{ justifyContent: 'center' }} />
        <MessageBox text={content.message} accent={accent} size={22} lines={2} style={{ maxWidth: 900 }} />
      </div>
      <div style={abs({ left: 80, bottom: 76 })}>
        <DiscordLine handle={content.discord} accent={accent} size={28} t={t} />
      </div>
      <Watermark size={44} style={abs({ right: 80, bottom: 70 })} />
    </PosterRoot>
  )
}

function LobbyCard(props: LftPosterProps) {
  const { content, accent, t, wanted } = props
  const { width, height } = LFT_FORMATS.card
  return (
    <PosterRoot width={width} height={height}>
      <LobbyBackground {...props} width={width} />
      {props.design.show.frame && <Frame accent={accent} inset={16} gap={6} diamond={9} />}
      <div style={abs({ left: 0, right: 0, top: 34, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 })}>
        <Kicker accent={accent} size={12} style={{ paddingLeft: '0.26em' }}>{props.design.kicker || t('team.lft.poster.multiKicker')}</Kicker>
        <div style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: 46, lineHeight: 1, letterSpacing: '0.04em', textTransform: 'uppercase', color: '#F7EEDC', textShadow: '0 3px 16px rgba(0,0,0,0.8)' }}>
          {props.design.title || lobbyTitle(t, wanted.length)}
        </div>
        <LobbySubline {...props} size={17} />
        <ProfileLine {...props} size={13} />
      </div>
      <div style={abs({ left: 0, right: 0, top: hasProfile(props.profile) ? 156 : 140, display: 'flex', justifyContent: 'center' })}>
        <Seats {...props} s={hasProfile(props.profile) ? { ...CARD_SEATS, h: 308 } : CARD_SEATS} gap={14} />
      </div>
      <div style={abs({ left: 0, right: 0, top: 478, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 9 })}>
        <TagPills tags={content.tags} accent={accent} size={12} style={{ justifyContent: 'center' }} />
        <MessageBox text={content.message} accent={accent} size={13} lines={1} style={{ maxWidth: 640 }} />
      </div>
      <div style={abs({ left: 44, bottom: 32 })}>
        <DiscordLine handle={content.discord} accent={accent} size={16} t={t} />
      </div>
      <Watermark size={22} style={abs({ right: 42, bottom: 28 })} />
    </PosterRoot>
  )
}
