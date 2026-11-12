/**
 * RoleIconPicker — 5-button row of position icons, used wherever the user
 * needs to pick a role (TOP / JUNGLE / MID / ADC / SUPPORT) and a dropdown
 * would be heavier than necessary.
 *
 * Supports a "default" slot: pass `defaultRole` and a sixth pill renders
 * to the left with a "DEFAULT" badge. Clicking the currently-active icon
 * toggles back to "ALL" (default). Internal state is fully controlled by
 * the parent via `value` / `onChange`.
 */

import { cn } from '@/lib/utils'

export type Role = 'TOP' | 'JUNGLE' | 'MID' | 'ADC' | 'SUPPORT'
export type RoleOrAll = 'ALL' | Role

const ROLES: Role[] = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT']

// Community Dragon position icons — same set the live client uses in champ
// select, so they're instantly recognizable to LoL players. Hosted on the
// public Riot CDN. Mapping uses Riot's own position naming (bottom = ADC,
// utility = support).
const ICON_URLS: Record<Role, string> = {
  TOP: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-top.png',
  JUNGLE: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-jungle.png',
  MID: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-middle.png',
  ADC: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-bottom.png',
  SUPPORT: 'https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-clash/global/default/assets/images/position-selector/positions/icon-position-utility.png',
}

interface Props {
  value: RoleOrAll
  onChange: (next: RoleOrAll) => void
  /** Role pre-selected when value is 'ALL' (visually highlighted). */
  defaultRole?: Role
  size?: 'sm' | 'md'
  /** Hide the "ALL" pill entirely; force a concrete role. */
  hideAll?: boolean
  className?: string
}

export function RoleIconPicker({ value, onChange, defaultRole, size = 'md', hideAll, className }: Props) {
  const px = size === 'sm' ? 'h-7 w-7 p-1' : 'h-9 w-9 p-1.5'

  return (
    <div className={cn('flex items-center gap-1', className)}>
      {!hideAll && (
        <button
          type="button"
          onClick={() => onChange('ALL')}
          className={cn(
            'rounded-md flex items-center justify-center transition-all border',
            px,
            value === 'ALL'
              ? 'border-hextech-gold bg-hextech-gold/10 ring-1 ring-hextech-gold/40'
              : 'border-hextech-border bg-white/5 hover:bg-white/10 hover:border-hextech-border-bright',
          )}
          title={defaultRole ? `Default (${defaultRole})` : 'Default'}
        >
          {defaultRole ? (
            <img
              src={ICON_URLS[defaultRole]}
              alt={defaultRole}
              className={cn('w-full h-full object-contain', value === 'ALL' ? 'opacity-100' : 'opacity-50')}
            />
          ) : (
            <span className="text-[9px] font-bold text-hextech-text-dim">ALL</span>
          )}
        </button>
      )}
      {ROLES.map((role) => {
        const active = value === role
        return (
          <button
            key={role}
            type="button"
            // When the "ALL" pill is hidden the picker is single-select-only:
            // clicking the active icon must be a no-op (otherwise we'd send
            // an invalid 'ALL' value the parent can't represent).
            onClick={() => {
              if (active && hideAll) return
              onChange(active ? 'ALL' : role)
            }}
            className={cn(
              'rounded-md flex items-center justify-center transition-all border',
              px,
              active
                ? 'border-hextech-gold bg-hextech-gold/10 ring-1 ring-hextech-gold/40'
                : 'border-hextech-border bg-white/5 hover:bg-white/10 hover:border-hextech-border-bright',
            )}
            title={role}
          >
            <img
              src={ICON_URLS[role]}
              alt={role}
              className={cn(
                'w-full h-full object-contain transition-opacity',
                active ? 'opacity-100' : 'opacity-50 hover:opacity-90',
              )}
            />
          </button>
        )
      })}
    </div>
  )
}
