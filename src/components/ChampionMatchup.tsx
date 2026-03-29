import { useChampionIconUrl } from '@/hooks/useChampionIconUrl'
import { cn } from '@/lib/utils'

interface ChampionMatchupProps {
  playerChampion: string | null | undefined
  opponentChampion: string | null | undefined
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

const SIZE_MAP = {
  sm: { icon: 'h-6 w-6', text: 'text-[10px]', vs: 'text-[8px] px-0.5' },
  md: { icon: 'h-8 w-8', text: 'text-xs', vs: 'text-[10px] px-1' },
  lg: { icon: 'h-10 w-10', text: 'text-sm', vs: 'text-xs px-1' },
}

function ChampionIcon({
  name,
  size,
}: {
  name: string | null | undefined
  size: 'sm' | 'md' | 'lg'
}) {
  const url = useChampionIconUrl(name)
  const s = SIZE_MAP[size]

  if (!name) return null

  if (url) {
    return (
      <img
        src={url}
        alt={name}
        title={name}
        className={cn('rounded-full object-cover border border-hextech-border-dim shrink-0', s.icon)}
        onError={(e) => {
          ;(e.target as HTMLImageElement).style.display = 'none'
        }}
      />
    )
  }

  return (
    <div
      className={cn(
        'rounded-full bg-hextech-elevated border border-hextech-border-dim flex items-center justify-center shrink-0',
        s.icon,
      )}
    >
      <span className={cn('font-medium text-hextech-text-dim', s.text)}>{name.slice(0, 2)}</span>
    </div>
  )
}

export function ChampionMatchup({
  playerChampion,
  opponentChampion,
  size = 'sm',
  className,
}: ChampionMatchupProps) {
  const s = SIZE_MAP[size]

  return (
    <div className={cn('flex items-center gap-1 shrink-0', className)}>
      <ChampionIcon name={playerChampion} size={size} />
      {opponentChampion && (
        <>
          <span className={cn('font-bold text-hextech-text-dim select-none', s.vs)}>vs</span>
          <ChampionIcon name={opponentChampion} size={size} />
        </>
      )}
    </div>
  )
}
