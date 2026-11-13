import { describe, it, expect } from 'vitest'
import { scrub } from '../../src/lib/diagnostics'

describe('bug report diagnostics scrubbing', () => {
  it('removes e-mails, keys, tokens and Windows / Unix user names', () => {
    const raw = [
      'user john.doe@gmail.com failed',
      'key RGAPI-12345678-aaaa-bbbb and ghp_abcdefghijklmnop',
      'token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
      'at C:\\Users\\Ariso\\AppData\\Roaming\\nexusmind\\x.js',
      'at /home/ariso/app.js',
    ].join('\n')
    const out = scrub(raw)
    expect(out).not.toMatch(/john\.doe|RGAPI-1234|ghp_abc|eyJhbGci|Ariso|ariso/)
    expect(out).toContain('<email>')
    expect(out).toContain('<secret>')
    expect(out).toContain('<jwt>')
    expect(out).toContain('C:\\Users\\<user>\\AppData')
    expect(out).toContain('/home/<user>/app.js')
  })
})
