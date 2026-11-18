import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useDdragonVersion } from '@/hooks/useChampionIconUrl'
import {
  BARON_PIT,
  DRAGON_PIT,
  FOUNTAIN,
  OBJECTIVE_RADIUS,
  RIFT_BOUNDS,
  TURRETS,
  toMinimap,
  type Point,
  type TeamId,
} from '@/lib/microReview/geometry'

/** A game position in the 100 × 100 viewBox, through the same bounds as
 *  Riot's minimap (geometry.ts toMinimap), so what the calculations measure
 *  is where it shows. */
const at = (p: Point) => {
  const m = toMinimap(p)
  return { x: m.x * 100, y: m.y * 100 }
}
const RADIUS = {
  x: (OBJECTIVE_RADIUS / (RIFT_BOUNDS.maxX - RIFT_BOUNDS.minX)) * 100,
  y: (OBJECTIVE_RADIUS / (RIFT_BOUNDS.maxY - RIFT_BOUNDS.minY)) * 100,
}
/** Side colours, as the game and Riot's minimap draw them. */
const SIDE: Record<TeamId, string> = { 100: '#4E9BE0', 200: '#E24C3A' }

/**
 * Summoner's Rift for the micro-review moment when the game has no VOD:
 * Riot's minimap, every turret in its side's colour, a gold ring on the
 * player's own fountain, both pits with the "near an objective" radius the
 * analysis uses, and where the moment happened. Offline, a schematic of the
 * same map stands in.
 */
export function MiniMap({ position, team }: { position: Point | null; team: TeamId }) {
  const { t } = useTranslation()
  const version = useDdragonVersion()
  const clip = useId()
  const [loaded, setLoaded] = useState(false)
  const me = position ? at(position) : null
  const home = at(FOUNTAIN[team])

  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" role="img" aria-label={t('microReview.vod.mapLabel')}>
      <defs>
        <clipPath id={clip}>
          <rect width="100" height="100" rx="3" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clip})`}>
        <rect width="100" height="100" fill="var(--hextech-black)" />
        {!loaded && <Schematic />}
        <image
          href={`https://ddragon.leagueoflegends.com/cdn/${version}/img/map/map11.png`}
          width="100"
          height="100"
          preserveAspectRatio="none"
          opacity={loaded ? 1 : 0}
          style={{ filter: 'brightness(0.5) saturate(0.75) contrast(1.15)' }}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(false)}
        />
        {/* The player's side */}
        <circle cx={home.x} cy={home.y} r="5.2" fill="none" stroke="var(--hextech-gold)" strokeWidth="0.8" />
        {/* Turrets */}
        {([100, 200] as const).map((owner) => TURRETS[owner].map((p, i) => {
          const c = at(p)
          return (
            <rect
              key={`${owner}-${i}`}
              x={c.x - 0.9}
              y={c.y - 0.9}
              width="1.8"
              height="1.8"
              rx="0.3"
              fill={SIDE[owner]}
              stroke="var(--hextech-black)"
              strokeWidth="0.35"
            />
          )
        }))}
        {/* Pits, with the radius that counts as "near the objective" */}
        {[BARON_PIT, DRAGON_PIT].map((pit, i) => {
          const c = at(pit)
          return (
            <g key={i}>
              <ellipse cx={c.x} cy={c.y} rx={RADIUS.x} ry={RADIUS.y} fill="none" stroke="var(--hextech-gold)" strokeOpacity="0.7" strokeDasharray="1.5 1.5" strokeWidth="0.5" />
              <circle cx={c.x} cy={c.y} r="1.6" fill="var(--hextech-gold)" stroke="var(--hextech-black)" strokeWidth="0.4" />
            </g>
          )
        })}
        {/* The moment */}
        {me && (
          <g>
            <circle cx={me.x} cy={me.y} r="4.2" fill="var(--hextech-gold-bright)" fillOpacity="0.22" />
            <circle cx={me.x} cy={me.y} r="2" fill="var(--hextech-gold-bright)" stroke="var(--hextech-black)" strokeWidth="0.7" />
          </g>
        )}
      </g>
      <rect x="0.25" y="0.25" width="99.5" height="99.5" rx="3" fill="none" stroke="var(--hextech-border-dim)" strokeWidth="0.5" />
    </svg>
  )
}

/** The map without Riot's art, from the same coordinates: lanes, river, bases. */
function Schematic() {
  const corner = { blue: at({ x: 1200, y: 1200 }), red: at({ x: 13600, y: 13600 }) }
  const topLeft = at({ x: 1200, y: 13600 })
  const bottomRight = at({ x: 13600, y: 1200 })
  const river = { a: at({ x: 2600, y: 12300 }), b: at({ x: 12300, y: 2600 }) }
  return (
    <g>
      <path d={`M ${river.a.x} ${river.a.y} L ${river.b.x} ${river.b.y}`} stroke="#2B6E85" strokeOpacity="0.45" strokeWidth="9" strokeLinecap="round" />
      <path
        d={`M ${corner.blue.x} ${corner.blue.y} L ${topLeft.x} ${topLeft.y} L ${corner.red.x} ${corner.red.y} L ${bottomRight.x} ${bottomRight.y} Z M ${corner.blue.x} ${corner.blue.y} L ${corner.red.x} ${corner.red.y}`}
        fill="none"
        stroke="var(--hextech-border)"
        strokeWidth="2.2"
        strokeLinejoin="round"
      />
    </g>
  )
}
