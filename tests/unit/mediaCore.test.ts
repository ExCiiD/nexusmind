import { describe, it, expect } from 'vitest'
import { formatFileSize, formatMs, parseMmSs, toNxmUrl } from '../../src/lib/mediaCore'

describe('toNxmUrl', () => {
  it('turns a Windows path into an nxm:/// URL with forward slashes', () => {
    expect(toNxmUrl('C:\\Users\\me\\Videos\\game.mp4')).toBe('nxm:///C:/Users/me/Videos/game.mp4')
  })
  it('keeps a POSIX path absolute', () => {
    expect(toNxmUrl('/home/me/game.mp4')).toBe('nxm:///home/me/game.mp4')
  })
})

describe('formatMs', () => {
  it('floors to whole seconds and pads them', () => {
    expect(formatMs(0)).toBe('0:00')
    expect(formatMs(65_999)).toBe('1:05')
    expect(formatMs(3_600_000)).toBe('60:00')
  })
})

describe('formatFileSize', () => {
  it('uses KB below 1 MB and MB with one decimal above', () => {
    expect(formatFileSize(512_000)).toBe('500 KB')
    expect(formatFileSize(1_048_576)).toBe('1.0 MB')
    expect(formatFileSize(8 * 1_048_576 + 104_858)).toBe('8.1 MB')
  })
})

describe('parseMmSs', () => {
  it('reads m:ss and plain seconds', () => {
    expect(parseMmSs('1:30')).toBe(90_000)
    expect(parseMmSs('12.5')).toBe(12_500)
    expect(parseMmSs(':30')).toBe(30_000)
  })
  it('returns null for unreadable input', () => {
    expect(parseMmSs('abc')).toBeNull()
  })
})
