/**
 * Pieces of the looking-for-team announcements. Sizes are in pixels of the
 * exported picture: the preview scales the whole announcement down. Styles
 * are inline and explicit so the preview and the off-screen render (which
 * gets the app's stylesheet too) draw the same picture.
 */
import type { CSSProperties, ReactNode } from 'react'
import type { TFunction } from 'i18next'
import { RoleGlyph } from '@/components/team/RoleGlyph'
import { AscendMark } from '@/components/Brand/AscendMark'
import { gamesOf, rankEmblemUrl, rankLabel, rankWinRate, type QueueRank, type Tier } from '@/lib/rankCore'
import type { LftRole } from '@/lib/lftCore'
import { initialsOf } from '@/lib/playerCard'
import { alpha, FONT_BODY, FONT_DISPLAY, FONT_MONO, INK, TEXT_DIM, type LftAccent } from './theme'
import type { LftRankState } from './types'

export const abs = (s: CSSProperties): CSSProperties => ({ position: 'absolute', ...s })

export function PosterRoot({ width, height, children }: { width: number; height: number; children: ReactNode }) {
  return (
    <div
      data-lft-poster=""
      style={{
        position: 'relative',
        width,
        height,
        overflow: 'hidden',
        background: INK,
        color: '#F5E3BE',
        fontFamily: FONT_BODY,
        lineHeight: 1.2,
        WebkitFontSmoothing: 'antialiased',
        textAlign: 'left',
      }}
    >
      {children}
    </div>
  )
}

/** A picture filling its box. */
export function Cover({ src, position = 'center', style }: { src: string; position?: string; style?: CSSProperties }) {
  return (
    <img
      src={src}
      alt=""
      draggable={false}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', maxWidth: 'none', objectFit: 'cover', objectPosition: position, ...style }}
    />
  )
}

/** Thin double frame with a diamond on each corner. */
export function Frame({ accent, inset, gap = 7, diamond = 11 }: { accent: LftAccent; inset: number; gap?: number; diamond?: number }) {
  const at = inset - diamond / 2
  const corner = (s: CSSProperties) => (
    <div style={abs({ ...s, width: diamond, height: diamond, transform: 'rotate(45deg)', background: accent.main, boxShadow: `0 0 0 2px ${INK}, 0 0 14px ${alpha(accent.main, 0.6)}` })} />
  )
  return (
    <>
      <div style={abs({ inset, border: `1px solid ${alpha(accent.main, 0.6)}` })} />
      <div style={abs({ inset: inset + gap, border: `1px solid ${alpha(accent.main, 0.22)}` })} />
      {corner({ left: at, top: at })}
      {corner({ right: at, top: at })}
      {corner({ left: at, bottom: at })}
      {corner({ right: at, bottom: at })}
    </>
  )
}

export function RoleIcon({ role, size, color }: { role: LftRole; size: number; color: string }) {
  return (
    <div style={{ width: size, height: size, color, flexShrink: 0 }}>
      <RoleGlyph role={role} className="h-full w-full" />
    </div>
  )
}

/** Small capitals in the mono face: section labels. */
export function Kicker({ children, accent, size, style }: { children: ReactNode; accent: LftAccent; size: number; style?: CSSProperties }) {
  return (
    <div style={{ fontFamily: FONT_MONO, fontSize: size, fontWeight: 700, letterSpacing: '0.26em', textTransform: 'uppercase', color: accent.main, lineHeight: 1.1, ...style }}>
      {children}
    </div>
  )
}

/** A kicker followed by a fading line. */
export function RuleKicker({ children, accent, size, width }: { children: ReactNode; accent: LftAccent; size: number; width: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.8, width }}>
      <Kicker accent={accent} size={size}>{children}</Kicker>
      <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${alpha(accent.main, 0.6)}, transparent)` }} />
    </div>
  )
}

/** The emblem of a tier, cropped out of its transparent 16:9 picture. */
export function RankEmblem({ tier, width }: { tier: Tier; width: number }) {
  const height = Math.round(width * 0.75)
  const imgW = width / 0.3
  const imgH = (imgW * 9) / 16
  return (
    <div style={{ position: 'relative', width, height, flexShrink: 0 }}>
      <img
        src={rankEmblemUrl(tier)}
        alt=""
        draggable={false}
        style={{ position: 'absolute', width: imgW, height: imgH, maxWidth: 'none', left: (width - imgW) / 2, top: height / 2 - imgH * 0.475 }}
      />
    </div>
  )
}

export function tierName(t: TFunction) {
  return (tier: Tier) => t(`team.lft.tiers.${tier}`)
}

/** "Diamant II", "Non classé" when Riot says so, "…" while loading; null
 *  when the rank is unknown (no Riot ID, Riot didn't answer): the
 *  announcement then shows no rank rather than a wrong one. */
export function rankTitle(rank: QueueRank | null, state: LftRankState, t: TFunction): string | null {
  if (rank) return rankLabel(rank, { tierName: tierName(t) })
  if (state === 'loading') return '…'
  if (state === 'ok') return t('team.lft.poster.unranked')
  return null
}

/** "Solo/Duo · 45 LP · 58 % WR · 120 parties"; each part can be left out. */
export function rankDetails(rank: QueueRank | null, t: TFunction, opts: { queue?: boolean; lp?: boolean; winRate?: boolean } = {}): string {
  if (!rank) return ''
  const parts: string[] = []
  if (opts.queue !== false) parts.push(t(rank.queue === 'solo' ? 'team.lft.poster.queueSolo' : 'team.lft.poster.queueFlex'))
  if (opts.lp !== false) parts.push(`${rank.lp} LP`)
  const wr = rankWinRate(rank)
  if (opts.winRate !== false && wr != null) parts.push(t('team.lft.poster.winRate', { winRate: wr, games: gamesOf(rank) }))
  return parts.join('  ·  ')
}

/** Champion square icon with a coloured edge. */
export function ChampionSquare({ src, size, accent, radius = 10, edge = 2 }: { src: string; size: number; accent: LftAccent; radius?: number; edge?: number }) {
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: radius,
        overflow: 'hidden',
        border: `${edge}px solid ${alpha(accent.main, 0.75)}`,
        boxShadow: `0 0 0 1px ${INK}, 0 10px 26px rgba(0,0,0,0.55)`,
        background: accent.deep,
        flexShrink: 0,
      }}
    >
      <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', maxWidth: 'none', objectFit: 'cover', transform: 'scale(1.1)' }} />
    </div>
  )
}

/** Round avatar: the shared profile icon, else a champion, else initials. */
export function Avatar({ src, name, size, accent }: { src: string | null; name: string; size: number; accent: LftAccent }) {
  return (
    <div
      style={{
        position: 'relative',
        width: size,
        height: size,
        borderRadius: '50%',
        overflow: 'hidden',
        flexShrink: 0,
        border: `3px solid ${accent.main}`,
        boxShadow: `0 0 0 4px ${INK}, 0 0 0 5px ${alpha(accent.main, 0.45)}, 0 0 34px ${alpha(accent.main, 0.35)}`,
        background: accent.deep,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {src ? (
        <img src={src} alt="" draggable={false} style={{ width: '100%', height: '100%', maxWidth: 'none', objectFit: 'cover', transform: 'scale(1.08)' }} />
      ) : (
        <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: size * 0.38, color: accent.bright }}>{initialsOf(name)}</span>
      )}
    </div>
  )
}

export function TagPills({ tags, accent, size, style }: { tags: string[]; accent: LftAccent; size: number; style?: CSSProperties }) {
  if (tags.length === 0) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: size * 0.55, ...style }}>
      {tags.map((tag) => (
        <span
          key={tag}
          style={{
            padding: `${size * 0.42}px ${size * 0.9}px`,
            borderRadius: 999,
            border: `1px solid ${alpha(accent.main, 0.55)}`,
            background: 'rgba(8, 6, 4, 0.62)',
            color: accent.bright,
            fontSize: size,
            fontWeight: 600,
            lineHeight: 1,
            whiteSpace: 'nowrap',
          }}
        >
          {tag}
        </span>
      ))}
    </div>
  )
}

export function MessageBox({ text, accent, size, lines, style }: { text: string; accent: LftAccent; size: number; lines: number; style?: CSSProperties }) {
  if (!text) return null
  return (
    <div
      style={{
        border: `1px solid ${alpha(accent.main, 0.3)}`,
        borderLeft: `${Math.max(3, Math.round(size * 0.18))}px solid ${accent.main}`,
        background: 'rgba(8, 6, 4, 0.66)',
        padding: `${size * 0.75}px ${size}px`,
        borderRadius: 6,
        ...style,
      }}
    >
      <div
        style={{
          fontSize: size,
          lineHeight: 1.4,
          color: '#EFE6D4',
          display: '-webkit-box',
          WebkitLineClamp: lines,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          overflowWrap: 'anywhere',
        }}
      >
        {text}
      </div>
    </div>
  )
}

/** Label + value pair ("Je cherche" / "SLE ou équivalent"). */
export function InfoPair({ label, value, accent, labelSize, valueSize, align = 'left', maxWidth }: {
  label: string
  value: string
  accent: LftAccent
  labelSize: number
  valueSize: number
  align?: 'left' | 'right' | 'center'
  maxWidth: number
}) {
  if (!value) return null
  return (
    <div style={{ textAlign: align, maxWidth }}>
      <div style={{ fontFamily: FONT_MONO, fontSize: labelSize, fontWeight: 700, letterSpacing: '0.24em', textTransform: 'uppercase', color: TEXT_DIM }}>{label}</div>
      <div
        style={{
          marginTop: labelSize * 0.45,
          fontFamily: FONT_DISPLAY,
          fontWeight: 700,
          fontSize: valueSize,
          lineHeight: 1.05,
          color: accent.soft,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {value}
      </div>
    </div>
  )
}

/** Strengths or weaknesses as a short list: a label, then one fundamental
 *  per line. Weaknesses are drawn quieter. */
export function TraitList({ label, items, accent, size, weak }: { label: string; items: string[]; accent: LftAccent; size: number; weak?: boolean }) {
  if (items.length === 0) return null
  return (
    <div>
      <div style={{ fontFamily: FONT_MONO, fontSize: size * 0.56, fontWeight: 700, letterSpacing: '0.24em', textTransform: 'uppercase', color: weak ? TEXT_DIM : accent.main }}>{label}</div>
      <div style={{ marginTop: size * 0.35, display: 'flex', flexDirection: 'column', gap: size * 0.22 }}>
        {items.map((item) => (
          <div key={item} style={{ display: 'flex', alignItems: 'center', gap: size * 0.4, whiteSpace: 'nowrap' }}>
            <span style={{ width: size * 0.26, height: size * 0.26, transform: 'rotate(45deg)', flexShrink: 0, background: weak ? 'transparent' : accent.main, border: `1px solid ${weak ? '#8F8470' : accent.main}` }} />
            <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: size, lineHeight: 1.05, color: weak ? '#B9AD95' : accent.bright, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** One line: "LABEL  a · b · c", cut when too long. */
export function TraitLine({ label, items, accent, size, weak, separator = ' · ', maxWidth }: {
  label: string
  items: string[]
  accent: LftAccent
  size: number
  weak?: boolean
  separator?: string
  maxWidth?: number
}) {
  if (items.length === 0) return null
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: size * 0.55, maxWidth, minWidth: 0, whiteSpace: 'nowrap' }}>
      <span style={{ fontFamily: FONT_MONO, fontSize: size * 0.68, fontWeight: 700, letterSpacing: '0.2em', textTransform: 'uppercase', color: weak ? TEXT_DIM : accent.main, flexShrink: 0 }}>{label}</span>
      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 700, fontSize: size, color: weak ? '#B9AD95' : accent.soft, overflow: 'hidden', textOverflow: 'ellipsis' }}>{items.join(separator)}</span>
    </span>
  )
}

/** Discord handle line. */
export function DiscordLine({ handle, accent, size, t }: { handle: string; accent: LftAccent; size: number; t: TFunction }) {
  if (!handle) return null
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: size * 0.7, whiteSpace: 'nowrap' }}>
      <span style={{ fontFamily: FONT_MONO, fontSize: size * 0.62, fontWeight: 700, letterSpacing: '0.24em', textTransform: 'uppercase', color: accent.main }}>
        {t('team.lft.poster.discord')}
      </span>
      <span style={{ fontSize: size, fontWeight: 600, color: '#F5EEDF' }}>{handle}</span>
    </div>
  )
}

/** Ascend's mark and name, bottom right of every announcement. */
export function Watermark({ size, style }: { size: number; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: size * 0.3, opacity: 0.92, ...style }}>
      <AscendMark size={size} variant="full" />
      <span style={{ fontFamily: FONT_DISPLAY, fontWeight: 800, fontSize: size * 0.62, letterSpacing: '0.16em', color: '#F5E3BE', lineHeight: 1 }}>ASCEND</span>
    </div>
  )
}

/** Fades over a background picture so the text stays readable. */
export function Shade({ style }: { style: CSSProperties }) {
  return <div style={abs({ inset: 0, ...style })} />
}

export { FONT_BODY, FONT_DISPLAY, FONT_MONO, INK, TEXT_DIM }
