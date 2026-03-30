interface AccountBadgeProps {
  name: string
  profileIconId?: number | null
  /** 'sm' = 18px icon (default), 'md' = 24px icon */
  size?: 'sm' | 'md'
}

export function getProfileIconUrl(profileIconId: number | null | undefined): string | null {
  if (!profileIconId) return null
  return `https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/profile-icons/${profileIconId}.jpg`
}

export function AccountBadge({ name, profileIconId, size = 'sm' }: AccountBadgeProps) {
  const iconUrl = getProfileIconUrl(profileIconId)
  const iconSize = size === 'md' ? 'h-6 w-6' : 'h-[18px] w-[18px]'
  const textSize = size === 'md' ? 'text-xs' : 'text-[10px]'

  return (
    <div className={`inline-flex items-center gap-1.5 rounded-full border border-hextech-border-dim bg-hextech-elevated px-2 py-0.5 ${textSize} text-hextech-text-dim`}>
      {iconUrl ? (
        <img
          src={iconUrl}
          alt={name}
          className={`${iconSize} rounded-full object-cover shrink-0 ring-1 ring-hextech-border-dim`}
          onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none' }}
        />
      ) : (
        <div className={`${iconSize} rounded-full bg-hextech-border-dim shrink-0`} />
      )}
      <span className="font-medium text-hextech-text-bright truncate max-w-[120px]">{name}</span>
    </div>
  )
}
