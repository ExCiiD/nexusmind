import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatGameTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function formatKDA(kills: number, deaths: number, assists: number): string {
  return `${kills}/${deaths}/${assists}`
}

export function calculateKDA(kills: number, deaths: number, assists: number): number {
  if (deaths === 0) return kills + assists
  return Number(((kills + assists) / deaths).toFixed(2))
}

export function formatCSPerMin(cs: number, durationSeconds: number): string {
  const cspm = cs / (durationSeconds / 60)
  return cspm.toFixed(1)
}

export function getRankColor(tier: string): string {
  const colors: Record<string, string> = {
    IRON: '#5e5e5e',
    BRONZE: '#8c6239',
    SILVER: '#8c8c8c',
    GOLD: '#c8aa6e',
    PLATINUM: '#4e9996',
    EMERALD: '#0ace83',
    DIAMOND: '#576cce',
    MASTER: '#9d48e0',
    GRANDMASTER: '#e04848',
    CHALLENGER: '#f4c874',
  }
  return colors[tier.toUpperCase()] ?? '#a09b8c'
}

export function xpForLevel(level: number): number {
  return Math.floor(100 * Math.pow(1.15, level - 1))
}

export function getLevelFromXp(totalXp: number): { level: number; currentXp: number; nextLevelXp: number } {
  let level = 1
  let remaining = totalXp
  while (true) {
    const needed = xpForLevel(level)
    if (remaining < needed) {
      return { level, currentXp: remaining, nextLevelXp: needed }
    }
    remaining -= needed
    level++
  }
}
