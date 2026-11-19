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

export function formatCSPerMin(cs: number, durationSeconds: number): string {
  const cspm = cs / (durationSeconds / 60)
  return cspm.toFixed(1)
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
