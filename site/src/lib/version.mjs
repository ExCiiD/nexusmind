/**
 * Is release `candidate` strictly newer than `current`? Handles the tags
 * Ascend publishes: `1.0.0`, `1.0.0-beta.2`. A final release is newer than
 * its own betas; numeric parts compare as numbers.
 */
export function isNewer(candidate, current) {
  const parse = (v) => {
    const [core, pre = ''] = String(v).replace(/^v/, '').split('-')
    return { core: core.split('.').map(Number), pre: pre ? pre.split('.') : [] }
  }
  const a = parse(candidate)
  const b = parse(current)
  if (a.core.some(Number.isNaN) || b.core.some(Number.isNaN)) return false
  for (let i = 0; i < Math.max(a.core.length, b.core.length); i++) {
    const d = (a.core[i] ?? 0) - (b.core[i] ?? 0)
    if (d !== 0) return d > 0
  }
  if (!a.pre.length || !b.pre.length) return !a.pre.length && b.pre.length > 0
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    const x = a.pre[i]
    const y = b.pre[i]
    if (x === undefined) return false
    if (y === undefined) return true
    if (x === y) continue
    const nx = Number(x)
    const ny = Number(y)
    if (!Number.isNaN(nx) && !Number.isNaN(ny)) return nx > ny
    return x > y
  }
  return false
}
