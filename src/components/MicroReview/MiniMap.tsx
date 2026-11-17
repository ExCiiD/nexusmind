import { useTranslation } from 'react-i18next'
import { BARON_PIT, DRAGON_PIT, OBJECTIVE_RADIUS, type Point } from '@/lib/microReview/geometry'

const S = 15000
const px = (p: Point) => ({ cx: (p.x / S) * 100, cy: 100 - (p.y / S) * 100 })

/**
 * Schematic Summoner's Rift (no game art): lanes, river, both pits with the
 * "near objective" radius, and where the moment happened. Shown when the
 * game has no VOD.
 */
export function MiniMap({ position, team }: { position: Point | null; team: 100 | 200 }) {
  const { t } = useTranslation()
  const baron = px(BARON_PIT)
  const dragon = px(DRAGON_PIT)
  const r = (OBJECTIVE_RADIUS / S) * 100
  const me = position ? px(position) : null
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label={t('microReview.vod.mapLabel')}>
      <rect x="0" y="0" width="100" height="100" rx="3" fill="var(--hextech-black)" />
      {/* River (anti-diagonal) */}
      <path d="M 0 0 L 100 100" stroke="var(--hextech-cyan)" strokeOpacity="0.25" strokeWidth="9" />
      {/* Lanes */}
      <path d="M 7 93 L 7 7 L 93 7" fill="none" stroke="var(--hextech-border)" strokeWidth="2.2" />
      <path d="M 7 93 L 93 93 L 93 7" fill="none" stroke="var(--hextech-border)" strokeWidth="2.2" />
      <path d="M 9 91 L 91 9" stroke="var(--hextech-border)" strokeWidth="2.2" />
      {/* Bases */}
      <circle cx="5" cy="95" r="6" fill={team === 100 ? 'var(--hextech-cyan)' : 'var(--hextech-red)'} fillOpacity="0.35" />
      <circle cx="95" cy="5" r="6" fill={team === 200 ? 'var(--hextech-cyan)' : 'var(--hextech-red)'} fillOpacity="0.35" />
      {/* Pits + objective radius */}
      {[baron, dragon].map((p, i) => (
        <g key={i}>
          <circle cx={p.cx} cy={p.cy} r={r} fill="none" stroke="var(--hextech-gold)" strokeOpacity="0.35" strokeDasharray="1.5 1.5" strokeWidth="0.5" />
          <circle cx={p.cx} cy={p.cy} r="2.2" fill="var(--hextech-gold)" fillOpacity="0.7" />
        </g>
      ))}
      {me && (
        <g>
          <circle cx={me.cx} cy={me.cy} r="4.5" fill="var(--hextech-red)" fillOpacity="0.25" />
          <circle cx={me.cx} cy={me.cy} r="2" fill="var(--hextech-red)" stroke="var(--hextech-text-bright)" strokeWidth="0.6" />
        </g>
      )}
    </svg>
  )
}
