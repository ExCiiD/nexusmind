/**
 * Small pure helpers for recordings and clips, shared by the record, review
 * and micro-review screens (they each had their own copy).
 */

/** `nxm://` URL of a local video file (the main process serves it with Range support). */
export function toNxmUrl(filePath: string): string {
  const n = filePath.replace(/\\/g, '/')
  return n.startsWith('/') ? `nxm://${n}` : `nxm:///${n}`
}

/** Milliseconds as m:ss (seconds floored). */
export function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000)
  const m = Math.floor(s / 60)
  return `${m}:${(s % 60).toString().padStart(2, '0')}`
}

/** File size in KB below 1 MB, else in MB with one decimal. */
export function formatFileSize(bytes: number): string {
  return bytes < 1_048_576 ? `${(bytes / 1024).toFixed(0)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`
}

/** "m:ss" or plain seconds ("12.5") to milliseconds; null when unreadable. */
export function parseMmSs(v: string): number | null {
  const p = v.split(':')
  if (p.length === 2) {
    const [m, s] = p.map(Number)
    if (!isNaN(m) && !isNaN(s)) return (m * 60 + s) * 1000
  }
  const sec = parseFloat(v)
  return isNaN(sec) ? null : Math.round(sec * 1000)
}
