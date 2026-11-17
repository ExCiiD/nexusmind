import { radarPolygonPoints, type RadarAxisPoint } from '@/lib/fundamentalsRadarCore'

interface Props {
  points: RadarAxisPoint[]
  size?: number
}

/**
 * "Empreinte des fondamentaux" — compact SVG radar, same construction as
 * the reference design: a solid gold polygon for recent form, a dashed
 * slate polygon for the longer-window snapshot, laid out clockwise from
 * the top. Hand-rolled (not recharts' RadarChart) so it stays small and
 * dense enough for a dashboard sidebar slot — recharts' own radar wants
 * more breathing room to stay legible.
 */
export function FundamentalsRadarChart({ points, size = 180 }: Props) {
  const center = size / 2
  const radius = size * 0.355

  const recentPoly = radarPolygonPoints(points, 'recentScore', center, radius)
  const snapshotPoly = radarPolygonPoints(points, 'snapshotScore', center, radius)

  return (
    <svg className="w-full overflow-visible" viewBox={`0 0 ${size} ${size}`} style={{ maxHeight: size }}>
      {/* Grid rings */}
      {[0.33, 0.66, 1].map((scale, idx) => (
        <circle
          key={idx}
          cx={center}
          cy={center}
          r={radius * scale}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeDasharray={idx === 2 ? 'none' : '2 2'}
        />
      ))}

      {/* Axes + labels */}
      {points.map((p, idx) => {
        const angle = (Math.PI * 2 * idx) / points.length - Math.PI / 2
        const x = center + radius * Math.cos(angle)
        const y = center + radius * Math.sin(angle)
        const lx = center + (radius + size * 0.1) * Math.cos(angle)
        const ly = center + (radius + size * 0.09) * Math.sin(angle)
        return (
          <g key={p.key}>
            <line x1={center} y1={center} x2={x} y2={y} stroke="rgba(255,255,255,0.08)" />
            <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-hextech-text-dim text-[8.5px] font-medium">
              {p.label}
            </text>
          </g>
        )
      })}

      {/* Snapshot (longer window) — dashed */}
      <polygon points={snapshotPoly} fill="rgba(148, 163, 184, 0.10)" stroke="rgba(148, 163, 184, 0.45)" strokeWidth={1} strokeDasharray="3 2" />
      {/* Recent form — solid gold */}
      <polygon points={recentPoly} fill="rgba(212, 162, 76, 0.22)" stroke="#D4A24C" strokeWidth={2} />
    </svg>
  )
}
